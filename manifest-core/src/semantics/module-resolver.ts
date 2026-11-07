import { FnDecl, SemanticModule } from '../core/ast-v2.ts';
import { parseSemanticModule } from '../core/parse-unified.ts';
import { SyntaxProfile } from '../core/profile.ts';
import { SemanticDiagnostic } from './types.ts';

export interface WorkspaceFiles {
  [path: string]: string;
}

export interface LinkedModuleGraph {
  entryModule: SemanticModule;
  orderedModules: SemanticModule[];
  mergedModule: SemanticModule;
  diagnostics: SemanticDiagnostic[];
}

function normalizeImportPath(fromFile: string | undefined, importSpec: string): string[] {
  const cleanSpec = importSpec.trim().replace(/^\.\//, '');
  const dir = fromFile && fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const base = dir ? `${dir}/${cleanSpec}` : cleanSpec;
  const normalized = normalizeSegments(base);

  const candidates = [normalized];
  if (!normalized.endsWith('.manifest')) {
    candidates.push(`${normalized}.manifest`);
  }
  if (!cleanSpec.endsWith('.manifest')) {
    candidates.push(`${cleanSpec}.manifest`);
  }
  candidates.push(cleanSpec);
  return Array.from(new Set(candidates));
}

function normalizeSegments(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Resolves multi-file `import` / `export` graphs across a workspace map, detects circular imports,
 * enforces export visibility, and links exported declarations into a unified SemanticModule.
 */
export function resolveModuleGraph(
  entrySource: string,
  options: {
    entryFile?: string;
    profile?: SyntaxProfile | 'auto';
    files?: WorkspaceFiles;
  } = {}
): LinkedModuleGraph {
  const diagnostics: SemanticDiagnostic[] = [];
  const files = options.files || {};
  const entryPath = options.entryFile || 'src/main.manifest';

  const parsedCache = new Map<string, SemanticModule>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: SemanticModule[] = [];

  const loadModule = (pathKey: string, sourceText: string, explicitProf?: SyntaxProfile | 'auto'): SemanticModule => {
    const existing = parsedCache.get(pathKey);
    if (existing) return existing;
    const mod = parseSemanticModule(sourceText, {
      file: pathKey,
      profile: explicitProf ?? 'auto',
    });
    parsedCache.set(pathKey, mod);
    return mod;
  };

  const entryMod = loadModule(entryPath, entrySource, options.profile);

  const visit = (pathKey: string, mod: SemanticModule) => {
    if (visited.has(pathKey)) return;
    visiting.add(pathKey);

    for (const imp of mod.imports) {
      const candidates = normalizeImportPath(pathKey, imp.from);
      const foundPath = candidates.find((c) => Object.prototype.hasOwnProperty.call(files, c));
      if (!foundPath) {
        diagnostics.push({
          code: 'E_MODULE_NOT_FOUND',
          severity: 'error',
          message: `Cannot resolve imported module '${imp.from}'`,
          line: imp.span.line,
          column: imp.span.column,
          file: pathKey,
          hint: `Ensure '${candidates[0]}' exists in the workspace.`,
        });
        continue;
      }

      if (visiting.has(foundPath)) {
        diagnostics.push({
          code: 'E_CIRCULAR_IMPORT',
          severity: 'error',
          message: `Circular module import detected: '${pathKey}' -> '${foundPath}'`,
          line: imp.span.line,
          column: imp.span.column,
          file: pathKey,
        });
        continue;
      }

      const depMod = loadModule(foundPath, files[foundPath], 'auto');
      visit(foundPath, depMod);

      // Verify visibility (`export`) for each requested symbol
      for (const sym of imp.symbols) {
        const exportedFn = depMod.functions.find((f) => f.name === sym.name);
        const exportedConst = depMod.constants.find((c) => c.name === sym.name);
        const exportedStruct = depMod.structs.find((s) => s.name === sym.name);
        const exportedEnum = depMod.enums.find((e) => e.name === sym.name);
        const target = exportedFn || exportedConst || exportedStruct || exportedEnum;

        if (!target) {
          diagnostics.push({
            code: 'E_IMPORT_SYMBOL_MISSING',
            severity: 'error',
            message: `Module '${imp.from}' has no declaration named '${sym.name}'`,
            line: imp.span.line,
            column: imp.span.column,
            file: pathKey,
          });
        } else if (!target.exported) {
          diagnostics.push({
            code: 'E_IMPORT_PRIVATE_SYMBOL',
            severity: 'error',
            message: `Symbol '${sym.name}' in module '${imp.from}' is private (missing 'export' / 'EXPORT')`,
            line: imp.span.line,
            column: imp.span.column,
            file: pathKey,
          });
        }
      }
    }

    visiting.delete(pathKey);
    visited.add(pathKey);
    ordered.push(mod);
  };

  visit(entryPath, entryMod);

  if (ordered.length <= 1) {
    return {
      entryModule: entryMod,
      orderedModules: [entryMod],
      mergedModule: entryMod,
      diagnostics,
    };
  }

  // Link imported symbols into a combined compilation unit while preserving entry module capability policy!
  // Note: Entry module's `denies` AND `requires` govern imported code (transitive cross-module capability check!).
  const mergedFunctions: FnDecl[] = [];
  const mergedConstants = [...entryMod.constants];
  const mergedStructs = [...entryMod.structs];
  const mergedEnums = [...entryMod.enums];

  for (const dep of ordered) {
    if (dep === entryMod) continue;

    // Collect alias map if entryMod imports from dep
    const aliasMap = new Map<string, string>();
    for (const imp of entryMod.imports) {
      for (const s of imp.symbols) {
        if (s.alias) aliasMap.set(s.name, s.alias);
      }
    }

    for (const st of dep.structs) {
      if (st.exported && !mergedStructs.some((x) => x.name === st.name)) {
        mergedStructs.unshift({
          ...st,
          name: aliasMap.get(st.name) || st.name,
          exported: false,
        });
      }
    }
    for (const en of dep.enums) {
      if (en.exported && !mergedEnums.some((x) => x.name === en.name)) {
        mergedEnums.unshift({
          ...en,
          name: aliasMap.get(en.name) || en.name,
          exported: false,
        });
      }
    }
    for (const c of dep.constants) {
      if (c.exported && !mergedConstants.some((x) => x.name === c.name)) {
        mergedConstants.unshift({
          ...c,
          name: aliasMap.get(c.name) || c.name,
          exported: false,
        });
      }
    }
    // Build a map of internal function renames for this dependency
    const internalRenames = new Map<string, string>();
    for (const fn of dep.functions) {
      if (!fn.exported) {
        internalRenames.set(fn.name, `${dep.moduleName}__${fn.name}`);
      } else if (aliasMap.has(fn.name)) {
        internalRenames.set(fn.name, aliasMap.get(fn.name)!);
      }
    }

    // Helper to rewrite CallExpr callee names inside statements
    const rewriteCallsInExpr = (expr: any): any => {
      if (!expr || typeof expr !== 'object') return expr;
      if (expr.kind === 'CallExpr' && internalRenames.has(expr.callee)) {
        return {
          ...expr,
          callee: internalRenames.get(expr.callee)!,
          args: (expr.args || []).map(rewriteCallsInExpr),
        };
      }
      const next: any = Array.isArray(expr) ? [] : { ...expr };
      for (const k of Object.keys(expr)) {
        if (k !== 'callee' && typeof expr[k] === 'object' && expr[k] !== null) {
          next[k] = rewriteCallsInExpr(expr[k]);
        }
      }
      return next;
    };

    for (const fn of dep.functions) {
      const targetName = fn.exported ? aliasMap.get(fn.name) || fn.name : `${dep.moduleName}__${fn.name}`;
      if (!mergedFunctions.some((x) => x.name === targetName)) {
        // Rewrite internal calls inside function body so calls to private helpers match the new prefix
        const rewrittenBody = fn.body.map((stmt) => rewriteCallsInExpr(stmt));
        mergedFunctions.push({
          ...fn,
          name: targetName,
          body: rewrittenBody,
          exported: false,
        });
      }
    }
  }

  mergedFunctions.push(...entryMod.functions);

  const mergedModule: SemanticModule = {
    ...entryMod,
    structs: mergedStructs,
    enums: mergedEnums,
    constants: mergedConstants,
    functions: mergedFunctions,
  };

  return {
    entryModule: entryMod,
    orderedModules: ordered,
    mergedModule,
    diagnostics,
  };
}

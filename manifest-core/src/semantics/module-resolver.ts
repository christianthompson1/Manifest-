import {
  AssignTarget,
  ConstDecl,
  EnumDecl,
  FnDecl,
  MatchPattern,
  SemanticExpr,
  SemanticModule,
  SemanticStmt,
  StructDecl,
  TypeNode,
  VarDecl,
} from '../core/ast-v2.ts';
import { parseSemanticModule } from '../core/parse-unified.ts';
import { SyntaxProfile } from '../core/profile.ts';
import { StdLibraryRegistry } from '../stdlib/std-modules.ts';
import { SemanticDiagnostic } from './types.ts';

export interface WorkspaceFiles {
  [path: string]: string;
}

export interface ModuleGlobalBinding {
  exportedName: string;
  canonicalName: string;
  mutable: boolean;
  isConst: boolean;
  exported: boolean;
}

export interface ModuleEnvironment {
  moduleName: string;
  pathKey: string;
  bindings: Map<string, ModuleGlobalBinding>;
  dependencies: string[];
  initOnce: boolean;
}

export interface LinkedModuleGraph {
  entryModule: SemanticModule;
  orderedModules: SemanticModule[];
  mergedModule: SemanticModule;
  environments?: Map<string, ModuleEnvironment>;
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

function sanitizeModPrefix(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_') || 'mod';
}

class ScopedAstRenamer {
  private scopes: Array<Set<string>> = [];

  constructor(private readonly renameMap: Map<string, string>) {}

  private pushScope(names: string[] = []): void {
    this.scopes.push(new Set(names));
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private declareLocal(name: string): void {
    if (this.scopes.length > 0) {
      this.scopes[this.scopes.length - 1].add(name);
    }
  }

  private isShadowed(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return true;
    }
    return false;
  }

  private resolveName(name: string): string {
    if (this.isShadowed(name)) return name;
    return this.renameMap.get(name) ?? name;
  }

  public rewriteType(t: TypeNode): TypeNode {
    switch (t.kind) {
      case 'NamedType':
        return {
          ...t,
          name: this.renameMap.get(t.name) ?? t.name,
          typeArgs: t.typeArgs.map((a) => this.rewriteType(a)),
        };
      case 'ArrayType':
        return { ...t, elementType: this.rewriteType(t.elementType) };
      case 'MapType':
        return {
          ...t,
          keyType: this.rewriteType(t.keyType),
          valueType: this.rewriteType(t.valueType),
        };
      case 'ResultType':
        return {
          ...t,
          okType: this.rewriteType(t.okType),
          errType: this.rewriteType(t.errType),
        };
      default:
        return t;
    }
  }

  public rewriteExpr(expr: SemanticExpr): SemanticExpr {
    switch (expr.kind) {
      case 'Identifier':
        return { ...expr, name: this.resolveName(expr.name) };
      case 'CallExpr':
        return {
          ...expr,
          callee: this.resolveName(expr.callee),
          typeArgs: expr.typeArgs.map((t) => this.rewriteType(t)),
          args: expr.args.map((a) => this.rewriteExpr(a)),
        };
      case 'StructLiteral':
        return {
          ...expr,
          structName: this.renameMap.get(expr.structName) ?? expr.structName,
          typeArgs: expr.typeArgs.map((t) => this.rewriteType(t)),
          fields: expr.fields.map((f) => ({ ...f, value: this.rewriteExpr(f.value) })),
        };
      case 'EnumConstructExpr':
        return {
          ...expr,
          enumName: this.renameMap.get(expr.enumName) ?? expr.enumName,
          args: expr.args.map((a) => this.rewriteExpr(a)),
        };
      case 'BinaryExpr':
        return {
          ...expr,
          left: this.rewriteExpr(expr.left),
          right: this.rewriteExpr(expr.right),
        };
      case 'UnaryExpr':
        return { ...expr, operand: this.rewriteExpr(expr.operand) };
      case 'FieldAccessExpr':
        return { ...expr, object: this.rewriteExpr(expr.object) };
      case 'IndexAccessExpr':
        return {
          ...expr,
          object: this.rewriteExpr(expr.object),
          index: this.rewriteExpr(expr.index),
        };
      case 'ArrayLiteral':
        return { ...expr, elements: expr.elements.map((e) => this.rewriteExpr(e)) };
      case 'MapLiteral':
        return {
          ...expr,
          entries: expr.entries.map((kv) => ({
            key: this.rewriteExpr(kv.key),
            value: this.rewriteExpr(kv.value),
          })),
        };
      case 'AwaitExpr':
      case 'TryPropagateExpr':
        return { ...expr, operand: this.rewriteExpr(expr.operand) };
      default:
        return expr;
    }
  }

  private rewriteAssignTarget(target: AssignTarget): AssignTarget {
    switch (target.kind) {
      case 'VarTarget':
        return { ...target, name: this.resolveName(target.name) };
      case 'FieldTarget':
        return { ...target, object: this.rewriteExpr(target.object) };
      case 'IndexTarget':
        return {
          ...target,
          object: this.rewriteExpr(target.object),
          index: this.rewriteExpr(target.index),
        };
    }
  }

  private rewritePattern(pat: MatchPattern): MatchPattern {
    if (pat.kind === 'EnumVariantPattern' && pat.enumName) {
      return {
        ...pat,
        enumName: this.renameMap.get(pat.enumName) ?? pat.enumName,
      };
    }
    return pat;
  }

  public rewriteBlockStmts(stmts: SemanticStmt[], isModuleTopLevel = false): SemanticStmt[] {
    return stmts.map((stmt) => this.rewriteStmt(stmt, isModuleTopLevel));
  }

  private rewriteStmt(stmt: SemanticStmt, isModuleTopLevel: boolean): SemanticStmt {
    switch (stmt.kind) {
      case 'VarStmt': {
        const d = stmt.decl;
        const nextInit = this.rewriteExpr(d.init);
        const nextType = this.rewriteType(d.typeAnnotation);
        let nextName = d.name;
        if (isModuleTopLevel) {
          nextName = this.renameMap.get(d.name) ?? d.name;
        } else {
          this.declareLocal(d.name);
        }
        return {
          ...stmt,
          decl: {
            ...d,
            name: nextName,
            typeAnnotation: nextType,
            init: nextInit,
            exported: false,
          },
        };
      }
      case 'ConstStmt': {
        const d = stmt.decl;
        const nextInit = this.rewriteExpr(d.init);
        const nextType = this.rewriteType(d.typeAnnotation);
        let nextName = d.name;
        if (isModuleTopLevel) {
          nextName = this.renameMap.get(d.name) ?? d.name;
        } else {
          this.declareLocal(d.name);
        }
        return {
          ...stmt,
          decl: {
            ...d,
            name: nextName,
            typeAnnotation: nextType,
            init: nextInit,
            exported: false,
          },
        };
      }
      case 'AssignStmt':
        return {
          ...stmt,
          target: this.rewriteAssignTarget(stmt.target),
          value: this.rewriteExpr(stmt.value),
        };
      case 'ExprStmt':
        return { ...stmt, expr: this.rewriteExpr(stmt.expr) };
      case 'IfStmt': {
        const cond = this.rewriteExpr(stmt.condition);
        this.pushScope();
        const thenBranch = this.rewriteBlockStmts(stmt.thenBranch, false);
        this.popScope();
        this.pushScope();
        const elseBranch = this.rewriteBlockStmts(stmt.elseBranch, false);
        this.popScope();
        return { ...stmt, condition: cond, thenBranch, elseBranch };
      }
      case 'WhileStmt': {
        const cond = this.rewriteExpr(stmt.condition);
        this.pushScope();
        const body = this.rewriteBlockStmts(stmt.body, false);
        this.popScope();
        return { ...stmt, condition: cond, body };
      }
      case 'ForInStmt': {
        const iterable = this.rewriteExpr(stmt.iterable);
        this.pushScope([stmt.itemName]);
        const body = this.rewriteBlockStmts(stmt.body, false);
        this.popScope();
        return { ...stmt, iterable, body };
      }
      case 'RepeatStmt': {
        const count = this.rewriteExpr(stmt.count);
        this.pushScope();
        const body = this.rewriteBlockStmts(stmt.body, false);
        this.popScope();
        return { ...stmt, count, body };
      }
      case 'ReturnStmt':
        return stmt.value ? { ...stmt, value: this.rewriteExpr(stmt.value) } : stmt;
      case 'MatchStmt': {
        const subject = this.rewriteExpr(stmt.subject);
        const arms = stmt.arms.map((arm) => {
          const pat = this.rewritePattern(arm.pattern);
          const bindings = pat.kind === 'EnumVariantPattern' ? pat.bindings : [];
          this.pushScope(bindings);
          const body = this.rewriteBlockStmts(arm.body, false);
          this.popScope();
          return { ...arm, pattern: pat, body };
        });
        return { ...stmt, subject, arms };
      }
      case 'TryStmt': {
        this.pushScope();
        const tryBody = this.rewriteBlockStmts(stmt.tryBody, false);
        this.popScope();
        this.pushScope(stmt.errBinding ? [stmt.errBinding] : []);
        const catchBody = this.rewriteBlockStmts(stmt.catchBody, false);
        this.popScope();
        return { ...stmt, tryBody, catchBody };
      }
      default:
        return stmt;
    }
  }

  public rewriteFunction(fn: FnDecl, newName: string, keepExported: boolean): FnDecl {
    this.pushScope(fn.params.map((p) => p.name));
    const params = fn.params.map((p) => ({ ...p, type: this.rewriteType(p.type) }));
    const returnType = this.rewriteType(fn.returnType);
    const body = this.rewriteBlockStmts(fn.body, false);
    this.popScope();
    return {
      ...fn,
      name: newName,
      params,
      returnType,
      body,
      exported: keepExported,
    };
  }
}

/**
 * Resolves multi-file `import` / `export` graphs across a workspace map, detects circular imports,
 * enforces export visibility, isolates private module bindings/globals, preserves topological
 * single-execution module initialization, and links declarations into a unified SemanticModule.
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
  const pathByMod = new Map<SemanticModule, string>();
  const depEdges = new Map<
    SemanticModule,
    Array<{ targetPath: string; targetMod: SemanticModule; symbols: Array<{ name: string; alias?: string }> }>
  >();
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
    pathByMod.set(mod, pathKey);
    return mod;
  };

  const entryMod = loadModule(entryPath, entrySource, options.profile);

  const visit = (pathKey: string, mod: SemanticModule) => {
    if (visited.has(pathKey)) return;
    visiting.add(pathKey);
    const edges: Array<{
      targetPath: string;
      targetMod: SemanticModule;
      symbols: Array<{ name: string; alias?: string }>;
    }> = [];
    depEdges.set(mod, edges);

    for (const imp of mod.imports) {
      const stdName = imp.from.startsWith('std.') ? imp.from.replace('std.', 'std::') : imp.from;
      const isStd = StdLibraryRegistry.getInstance().isStdModule(stdName);
      let foundPath: string | undefined;
      let sourceToLoad: string | undefined;

      if (isStd) {
        const stdDef = StdLibraryRegistry.getInstance().getModule(stdName)!;
        foundPath = `stdlib/${stdName.replace('::', '/')}.manifest`;
        sourceToLoad = stdDef.source;
      } else {
        const candidates = normalizeImportPath(pathKey, imp.from);
        foundPath = candidates.find((c) => Object.prototype.hasOwnProperty.call(files, c));
        if (foundPath) {
          sourceToLoad = files[foundPath];
        } else {
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

      const depMod = loadModule(foundPath, sourceToLoad!, 'auto');
      visit(foundPath, depMod);
      edges.push({ targetPath: foundPath, targetMod: depMod, symbols: imp.symbols });

      for (const sym of imp.symbols) {
        const exportedFn = depMod.functions.find((f) => f.name === sym.name);
        const exportedConst = depMod.constants.find((c) => c.name === sym.name);
        const exportedGlobal = depMod.globals.find((g) => g.name === sym.name);
        const exportedStruct = depMod.structs.find((s) => s.name === sym.name);
        const exportedEnum = depMod.enums.find((e) => e.name === sym.name);
        const target = exportedFn || exportedConst || exportedGlobal || exportedStruct || exportedEnum;

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

  const environments = new Map<string, ModuleEnvironment>();

  if (ordered.length <= 1) {
    const bindings = new Map<string, ModuleGlobalBinding>();
    for (const c of entryMod.constants) {
      bindings.set(c.name, {
        exportedName: c.name,
        canonicalName: c.name,
        mutable: false,
        isConst: true,
        exported: c.exported,
      });
    }
    for (const g of entryMod.globals) {
      bindings.set(g.name, {
        exportedName: g.name,
        canonicalName: g.name,
        mutable: true,
        isConst: false,
        exported: g.exported,
      });
    }
    environments.set(entryPath, {
      moduleName: entryMod.moduleName,
      pathKey: entryPath,
      bindings,
      dependencies: [],
      initOnce: true,
    });
    return {
      entryModule: entryMod,
      orderedModules: [entryMod],
      mergedModule: entryMod,
      environments,
      diagnostics,
    };
  }

  // Assign globally unique canonical symbol names for every dependency module so private globals,
  // private helpers, and overloaded export aliases never collide across dependency graphs.
  const depCanonicalMap = new Map<SemanticModule, Map<string, string>>();
  ordered.forEach((mod, idx) => {
    if (mod === entryMod) return;
    const prefix = `__m${idx}_${sanitizeModPrefix(mod.moduleName)}__`;
    const ownMap = new Map<string, string>();
    for (const st of mod.structs) ownMap.set(st.name, `${prefix}${st.name}`);
    for (const en of mod.enums) ownMap.set(en.name, `${prefix}${en.name}`);
    for (const c of mod.constants) ownMap.set(c.name, `${prefix}${c.name}`);
    for (const g of mod.globals) ownMap.set(g.name, `${prefix}${g.name}`);
    for (const fn of mod.functions) ownMap.set(fn.name, `${prefix}${fn.name}`);
    depCanonicalMap.set(mod, ownMap);
  });

  const buildModuleRenameMap = (mod: SemanticModule): Map<string, string> => {
    const renameMap = new Map<string, string>();
    // Map imported symbols (using exact target dependency edges and local aliases)
    const edges = depEdges.get(mod) || [];
    for (const edge of edges) {
      const targetOwn = depCanonicalMap.get(edge.targetMod);
      if (!targetOwn) continue;
      for (const sym of edge.symbols) {
        const canonical = targetOwn.get(sym.name);
        if (canonical) {
          renameMap.set(sym.alias || sym.name, canonical);
        }
      }
    }
    // Dependency's own declarations override/populate renameMap with its prefixed names
    const ownMap = depCanonicalMap.get(mod);
    if (ownMap) {
      for (const [k, v] of ownMap.entries()) {
        renameMap.set(k, v);
      }
    }
    return renameMap;
  };

  const mergedStructs: StructDecl[] = [];
  const mergedEnums: EnumDecl[] = [];
  const mergedConstants: ConstDecl[] = [];
  const mergedGlobals: VarDecl[] = [];
  const mergedFunctions: FnDecl[] = [];
  const mergedTopLevelStmts: SemanticStmt[] = [];

  for (const dep of ordered) {
    if (dep === entryMod) continue;

    const depPath = pathByMod.get(dep) || dep.moduleName;
    const renameMap = buildModuleRenameMap(dep);
    const ownMap = depCanonicalMap.get(dep)!;
    const renamer = new ScopedAstRenamer(renameMap);

    const envBindings = new Map<string, ModuleGlobalBinding>();

    for (const st of dep.structs) {
      const cname = ownMap.get(st.name)!;
      mergedStructs.push({
        ...st,
        name: cname,
        fields: st.fields.map((f) => ({ ...f, type: renamer.rewriteType(f.type) })),
        exported: false,
      });
    }

    for (const en of dep.enums) {
      const cname = ownMap.get(en.name)!;
      mergedEnums.push({
        ...en,
        name: cname,
        variants: en.variants.map((v) => ({
          ...v,
          payloadTypes: v.payloadTypes.map((pt) => renamer.rewriteType(pt)),
        })),
        exported: false,
      });
    }

    for (const c of dep.constants) {
      const cname = ownMap.get(c.name)!;
      mergedConstants.push({
        ...c,
        name: cname,
        typeAnnotation: renamer.rewriteType(c.typeAnnotation),
        init: renamer.rewriteExpr(c.init),
        exported: false,
      });
      envBindings.set(c.name, {
        exportedName: c.name,
        canonicalName: cname,
        mutable: false,
        isConst: true,
        exported: c.exported,
      });
    }

    for (const g of dep.globals) {
      const cname = ownMap.get(g.name)!;
      mergedGlobals.push({
        ...g,
        name: cname,
        mutable: true,
        typeAnnotation: renamer.rewriteType(g.typeAnnotation),
        init: renamer.rewriteExpr(g.init),
        exported: false,
      });
      envBindings.set(g.name, {
        exportedName: g.name,
        canonicalName: cname,
        mutable: true,
        isConst: false,
        exported: g.exported,
      });
    }

    for (const fn of dep.functions) {
      const cname = ownMap.get(fn.name)!;
      mergedFunctions.push(renamer.rewriteFunction(fn, cname, false));
    }

    // Rewrite top-level statements of this dependency in exact topological order (executed once)
    const rewrittenTop = renamer.rewriteBlockStmts(dep.topLevelStmts, true);
    mergedTopLevelStmts.push(...rewrittenTop);

    environments.set(depPath, {
      moduleName: dep.moduleName,
      pathKey: depPath,
      bindings: envBindings,
      dependencies: (depEdges.get(dep) || []).map((e) => e.targetPath),
      initOnce: true,
    });
  }

  // Rewrite entry module references to imported symbols (without renaming entry's own declarations!)
  const entryImportsOnly = buildModuleRenameMap(entryMod);
  // If entry declares a top-level symbol with the same local name as nothing imported, keep its name;
  // if entry imported `foo` (or `foo as bar`), `entryImportsOnly` maps `bar -> canonicalName`.
  const entryOwnNames = new Set<string>([
    ...entryMod.structs.map((s) => s.name),
    ...entryMod.enums.map((e) => e.name),
    ...entryMod.constants.map((c) => c.name),
    ...entryMod.globals.map((g) => g.name),
    ...entryMod.functions.map((f) => f.name),
  ]);
  for (const own of entryOwnNames) {
    entryImportsOnly.delete(own);
  }
  const entryRenamer = new ScopedAstRenamer(entryImportsOnly);

  for (const st of entryMod.structs) {
    mergedStructs.push({
      ...st,
      fields: st.fields.map((f) => ({ ...f, type: entryRenamer.rewriteType(f.type) })),
    });
  }
  for (const en of entryMod.enums) {
    mergedEnums.push({
      ...en,
      variants: en.variants.map((v) => ({
        ...v,
        payloadTypes: v.payloadTypes.map((pt) => entryRenamer.rewriteType(pt)),
      })),
    });
  }
  for (const c of entryMod.constants) {
    mergedConstants.push({
      ...c,
      typeAnnotation: entryRenamer.rewriteType(c.typeAnnotation),
      init: entryRenamer.rewriteExpr(c.init),
    });
  }
  for (const g of entryMod.globals) {
    mergedGlobals.push({
      ...g,
      typeAnnotation: entryRenamer.rewriteType(g.typeAnnotation),
      init: entryRenamer.rewriteExpr(g.init),
    });
  }
  for (const fn of entryMod.functions) {
    mergedFunctions.push(entryRenamer.rewriteFunction(fn, fn.name, fn.exported));
  }
  mergedTopLevelStmts.push(...entryRenamer.rewriteBlockStmts(entryMod.topLevelStmts, true));

  const entryBindings = new Map<string, ModuleGlobalBinding>();
  for (const c of entryMod.constants) {
    entryBindings.set(c.name, {
      exportedName: c.name,
      canonicalName: c.name,
      mutable: false,
      isConst: true,
      exported: c.exported,
    });
  }
  for (const g of entryMod.globals) {
    entryBindings.set(g.name, {
      exportedName: g.name,
      canonicalName: g.name,
      mutable: true,
      isConst: false,
      exported: g.exported,
    });
  }
  environments.set(entryPath, {
    moduleName: entryMod.moduleName,
    pathKey: entryPath,
    bindings: entryBindings,
    dependencies: (depEdges.get(entryMod) || []).map((e) => e.targetPath),
    initOnce: true,
  });

  const mergedModule: SemanticModule = {
    ...entryMod,
    structs: mergedStructs,
    enums: mergedEnums,
    constants: mergedConstants,
    globals: mergedGlobals,
    functions: mergedFunctions,
    topLevelStmts: mergedTopLevelStmts,
  };

  return {
    entryModule: entryMod,
    orderedModules: ordered,
    mergedModule,
    environments,
    diagnostics,
  };
}

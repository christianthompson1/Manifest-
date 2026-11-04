import {
  FnDecl,
  SemanticExpr,
  SemanticModule,
  SemanticStmt,
  SourceSpan,
} from '../core/ast-v2.ts';
import { lookupStdIntrinsic, SemanticDiagnostic } from './types.ts';

export interface FunctionEffectAudit {
  name: string;
  exported: boolean;
  declaredEffects: string[];
  hasExplicitEffects: boolean;
  directEffects: string[];
  inferredEffects: string[];
  isPure: boolean;
  callees: string[];
}

export interface CapabilityAuditReport {
  moduleName: string;
  declaredRequires: string[];
  declaredProvides: string[];
  declaredDenies: string[];
  inferredModuleEffects: string[];
  functions: FunctionEffectAudit[];
  valid: boolean;
  diagnostics: SemanticDiagnostic[];
}

function capabilityMatches(declaredOrDenied: string, actualEffect: string): boolean {
  return (
    declaredOrDenied === actualEffect ||
    actualEffect.startsWith(`${declaredOrDenied}.`) ||
    declaredOrDenied.startsWith(`${actualEffect}.`)
  );
}

function isDeniedBy(denied: string, actualEffect: string): boolean {
  return denied === actualEffect || actualEffect.startsWith(`${denied}.`);
}

/**
 * Performs static capability and transitive effect verification over a SemanticModule:
 * 1. Computes direct intrinsic effects of every function and top-level script.
 * 2. Computes fixed-point transitive closure over the call graph.
 * 3. Rejects conflicts between `requires` and `denies`.
 * 4. Rejects any direct or transitive effect forbidden by `denies`.
 * 5. Rejects undeclared effects on functions that specify `effects(...)` or `pure`.
 * 6. Rejects privileged effects (`fs.*`, `net`, `db`, `time`, `crypto`, `env`) or any effect
 *    outside an explicit `requires [...]` declaration.
 */
export function analyzeCapabilitiesAndEffects(module: SemanticModule): CapabilityAuditReport {
  const diagnostics: SemanticDiagnostic[] = [];
  const requires = module.capabilities.requires.map((r) => r.name);
  const provides = module.capabilities.provides.map((p) => p.name);
  const denies = module.capabilities.denies.map((d) => d.name);

  // 1. Check `requires` vs `denies` contradictions
  for (const req of module.capabilities.requires) {
    for (const den of module.capabilities.denies) {
      if (isDeniedBy(den.name, req.name)) {
        diagnostics.push({
          code: 'E_CAPABILITY_CONTRADICTION',
          severity: 'error',
          message: `Capability '${req.name}' cannot be both required and denied ('${den.name}')`,
          line: req.span.line,
          column: req.span.column,
          file: req.span.file,
        });
      }
    }
  }

  // 2. Collect direct effects & callees per function
  const fnMap = new Map<string, FnDecl>();
  const directEffects = new Map<string, Map<string, SourceSpan>>();
  const callGraph = new Map<string, Array<{ callee: string; span: SourceSpan }>>();

  for (const fn of module.functions) {
    fnMap.set(fn.name, fn);
    const effs = new Map<string, SourceSpan>();
    const calls: Array<{ callee: string; span: SourceSpan }> = [];
    collectStmtsEffects(fn.body, effs, calls);
    directEffects.set(fn.name, effs);
    callGraph.set(fn.name, calls);
  }

  // Top-level script virtual node `__top__`
  const topDirect = new Map<string, SourceSpan>();
  const topCalls: Array<{ callee: string; span: SourceSpan }> = [];
  collectStmtsEffects(module.topLevelStmts, topDirect, topCalls);
  for (const c of module.constants) {
    collectExprEffects(c.init, topDirect, topCalls);
  }
  directEffects.set('__top__', topDirect);
  callGraph.set('__top__', topCalls);

  // 3. Fixed-point transitive effect propagation across call graph
  const transitive = new Map<string, Map<string, { span: SourceSpan; via?: string }>>();
  for (const [fnName, dir] of directEffects.entries()) {
    const m = new Map<string, { span: SourceSpan; via?: string }>();
    for (const [eff, sp] of dir.entries()) {
      m.set(eff, { span: sp });
    }
    transitive.set(fnName, m);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [caller, edges] of callGraph.entries()) {
      const callerEffects = transitive.get(caller)!;
      for (const edge of edges) {
        const calleeEffects = transitive.get(edge.callee);
        if (!calleeEffects) continue;
        for (const eff of calleeEffects.keys()) {
          if (!callerEffects.has(eff)) {
            callerEffects.set(eff, { span: edge.span, via: edge.callee });
            changed = true;
          }
        }
      }
    }
  }

  // 4. Verify function-level `effects(...)` / `pure` contracts
  const fnAudits: FunctionEffectAudit[] = [];
  for (const fn of module.functions) {
    const infMap = transitive.get(fn.name)!;
    const inferredList = Array.from(infMap.keys()).sort();
    const directList = Array.from(directEffects.get(fn.name)!.keys()).sort();
    const callees = Array.from(new Set(callGraph.get(fn.name)!.map((c) => c.callee)));

    if (fn.hasExplicitEffects) {
      for (const [eff, origin] of infMap.entries()) {
        const allowedByFn = fn.effects.some((decl) => capabilityMatches(decl, eff));
        if (!allowedByFn) {
          const viaSuffix = origin.via ? ` (propagated via call to '${origin.via}')` : '';
          diagnostics.push({
            code: 'E_UNDECLARED_EFFECT',
            severity: 'error',
            message: `Function '${fn.name}' performs effect '${eff}'${viaSuffix}, which is not declared in its effects(${fn.effects.join(', ')}) signature`,
            line: origin.span.line,
            column: origin.span.column,
            file: origin.span.file,
            hint: `Add '${eff}' to effects(...) on '${fn.name}' or remove the effectful call.`,
          });
        }
      }
    }

    fnAudits.push({
      name: fn.name,
      exported: fn.exported,
      declaredEffects: [...fn.effects],
      hasExplicitEffects: fn.hasExplicitEffects,
      directEffects: directList,
      inferredEffects: inferredList,
      isPure: inferredList.length === 0,
      callees,
    });
  }

  // 5. Verify module-level `denies` and `requires` across ALL reachable/defined code
  const moduleEffects = new Map<string, { span: SourceSpan; owner: string; via?: string }>();
  for (const [owner, infMap] of transitive.entries()) {
    for (const [eff, info] of infMap.entries()) {
      if (!moduleEffects.has(eff)) {
        moduleEffects.set(eff, { span: info.span, owner, via: info.via });
      }
    }
  }

  for (const [eff, origin] of moduleEffects.entries()) {
    // 5a. Check `denies`
    const matchingDeny = denies.find((d) => isDeniedBy(d, eff));
    if (matchingDeny) {
      const ctx = origin.owner === '__top__' ? 'top-level module scope' : `function '${origin.owner}'`;
      const via = origin.via ? ` via '${origin.via}'` : '';
      diagnostics.push({
        code: 'E_CAPABILITY_DENIED',
        severity: 'error',
        message: `Forbidden capability '${eff}' used in ${ctx}${via}: module explicitly denies '${matchingDeny}'`,
        line: origin.span.line,
        column: origin.span.column,
        file: origin.span.file,
      });
      continue;
    }

    // 5b. Check `requires`:
    // - If module explicitly wrote `requires [...]`, EVERY effect must be covered by `requires`.
    // - Even if `requires` was omitted, privileged capabilities (`fs.*`, `net`, `db`, `time`, `crypto`, `env`)
    //   MUST be explicitly declared in `requires`. (Only `console` is implicitly permitted in simple scripts.)
    const isImplicitConsoleAllowed = eff === 'console' && requires.length === 0;
    if (!isImplicitConsoleAllowed) {
      const covered = requires.some((r) => capabilityMatches(r, eff));
      if (!covered) {
        diagnostics.push({
          code: 'E_MISSING_CAPABILITY',
          severity: 'error',
          message: `Module '${module.moduleName}' uses capability '${eff}' without declaring it in 'requires'`,
          line: origin.span.line,
          column: origin.span.column,
          file: origin.span.file,
          hint:
            module.profile === 'professional'
              ? `Add 'requires [${[...requires, eff].join(', ')}];' to the module header.`
              : `Add 'REQUIRES ${[...requires, eff].join(', ')}' to the module header.`,
        });
      }
    }
  }

  return {
    moduleName: module.moduleName,
    declaredRequires: requires,
    declaredProvides: provides,
    declaredDenies: denies,
    inferredModuleEffects: Array.from(moduleEffects.keys()).sort(),
    functions: fnAudits,
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
  };
}

function collectStmtsEffects(
  stmts: SemanticStmt[],
  direct: Map<string, SourceSpan>,
  calls: Array<{ callee: string; span: SourceSpan }>
): void {
  for (const s of stmts) {
    switch (s.kind) {
      case 'VarStmt':
        collectExprEffects(s.decl.init, direct, calls);
        break;
      case 'ConstStmt':
        collectExprEffects(s.decl.init, direct, calls);
        break;
      case 'AssignStmt':
        if (s.target.kind === 'FieldTarget') collectExprEffects(s.target.object, direct, calls);
        if (s.target.kind === 'IndexTarget') {
          collectExprEffects(s.target.object, direct, calls);
          collectExprEffects(s.target.index, direct, calls);
        }
        collectExprEffects(s.value, direct, calls);
        break;
      case 'ExprStmt':
        collectExprEffects(s.expr, direct, calls);
        break;
      case 'IfStmt':
        collectExprEffects(s.condition, direct, calls);
        collectStmtsEffects(s.thenBranch, direct, calls);
        collectStmtsEffects(s.elseBranch, direct, calls);
        break;
      case 'WhileStmt':
        collectExprEffects(s.condition, direct, calls);
        collectStmtsEffects(s.body, direct, calls);
        break;
      case 'ForInStmt':
        collectExprEffects(s.iterable, direct, calls);
        collectStmtsEffects(s.body, direct, calls);
        break;
      case 'RepeatStmt':
        collectExprEffects(s.count, direct, calls);
        collectStmtsEffects(s.body, direct, calls);
        break;
      case 'ReturnStmt':
        if (s.value) collectExprEffects(s.value, direct, calls);
        break;
      case 'MatchStmt':
        collectExprEffects(s.subject, direct, calls);
        for (const arm of s.arms) collectStmtsEffects(arm.body, direct, calls);
        break;
      case 'TryStmt':
        collectStmtsEffects(s.tryBody, direct, calls);
        collectStmtsEffects(s.catchBody, direct, calls);
        break;
      case 'BreakStmt':
      case 'ContinueStmt':
        break;
    }
  }
}

function collectExprEffects(
  expr: SemanticExpr,
  direct: Map<string, SourceSpan>,
  calls: Array<{ callee: string; span: SourceSpan }>
): void {
  switch (expr.kind) {
    case 'UnaryExpr':
      collectExprEffects(expr.operand, direct, calls);
      break;
    case 'BinaryExpr':
      collectExprEffects(expr.left, direct, calls);
      collectExprEffects(expr.right, direct, calls);
      break;
    case 'CallExpr': {
      for (const a of expr.args) collectExprEffects(a, direct, calls);
      const std = lookupStdIntrinsic(expr.callee);
      if (std) {
        if (std.capability !== 'pure') {
          if (!direct.has(std.capability)) {
            direct.set(std.capability, expr.span);
          }
        }
      } else {
        calls.push({ callee: expr.callee, span: expr.span });
      }
      break;
    }
    case 'FieldAccessExpr':
      collectExprEffects(expr.object, direct, calls);
      break;
    case 'IndexAccessExpr':
      collectExprEffects(expr.object, direct, calls);
      collectExprEffects(expr.index, direct, calls);
      break;
    case 'ArrayLiteral':
      for (const e of expr.elements) collectExprEffects(e, direct, calls);
      break;
    case 'MapLiteral':
      for (const kv of expr.entries) {
        collectExprEffects(kv.key, direct, calls);
        collectExprEffects(kv.value, direct, calls);
      }
      break;
    case 'StructLiteral':
      for (const f of expr.fields) collectExprEffects(f.value, direct, calls);
      break;
    case 'EnumConstructExpr':
      for (const a of expr.args) collectExprEffects(a, direct, calls);
      break;
    case 'AwaitExpr':
    case 'TryPropagateExpr':
      collectExprEffects(expr.operand, direct, calls);
      break;
    default:
      break;
  }
}

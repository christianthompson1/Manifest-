import { SemanticDiagnostic, T_BOOL, T_F64, T_I64, T_STR } from '../semantics/types.ts';
import {
  isPureMIRExpr,
  MIRExpr,
  MIRFunction,
  MIRMatchArm,
  MIRModule,
  MIRStmt,
} from './typed-ir.ts';

export interface OptimizationPassStats {
  constantsFolded: number;
  algebraicSimplifications: number;
  unreachableStmtsRemoved: number;
  deadLocalsEliminated: number;
  deadFunctionsEliminated: number;
}

export interface OptimizationResult {
  module: MIRModule;
  stats: OptimizationPassStats;
  warnings: SemanticDiagnostic[];
}

const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;

function inI64Bounds(v: bigint): boolean {
  return v >= I64_MIN && v <= I64_MAX;
}

/**
 * Semantics-preserving optimizer for Typed Manifest IR (MIRModule).
 *
 * Strictly preserves observable side effects, host calls, division-by-zero traps,
 * and checked 64-bit integer overflow traps.
 */
export function optimizeMIR(input: MIRModule): OptimizationResult {
  const stats: OptimizationPassStats = {
    constantsFolded: 0,
    algebraicSimplifications: 0,
    unreachableStmtsRemoved: 0,
    deadLocalsEliminated: 0,
    deadFunctionsEliminated: 0,
  };
  const warnings: SemanticDiagnostic[] = [];

  const optGlobals = input.globals.map((g) => ({
    ...g,
    init: optimizeExpr(g.init, stats),
  }));

  let optFunctions = input.functions.map((fn) => optimizeFunction(fn, stats, warnings));

  // Dead function elimination: remove private non-entry non-synthetic functions with zero callers
  const reachableFns = computeReachableFunctions(optFunctions, input.entryFunction);
  const keptFunctions: MIRFunction[] = [];
  for (const fn of optFunctions) {
    if (
      fn.exported ||
      fn.isEntry ||
      fn.name === '__init__' ||
      fn.name === '__script__' ||
      reachableFns.has(fn.name)
    ) {
      keptFunctions.push(fn);
    } else {
      stats.deadFunctionsEliminated++;
    }
  }
  optFunctions = keptFunctions;

  return {
    module: {
      ...input,
      globals: optGlobals,
      functions: optFunctions,
    },
    stats,
    warnings,
  };
}

function optimizeFunction(
  fn: MIRFunction,
  stats: OptimizationPassStats,
  warnings: SemanticDiagnostic[]
): MIRFunction {
  // Pass 1 & 2 & 3: Constant folding, algebraic simplification, and unreachable-code pruning
  let body = optimizeBlock(fn.body, stats, warnings);

  // Pass 4: Dead local variable elimination (unused pure StoreLocal declarations)
  const readCounts = new Map<number, number>();
  const writeCounts = new Map<number, number>();
  countSlotUsageInBlock(body, readCounts, writeCounts);

  body = eliminateDeadStoresInBlock(body, readCounts, writeCounts, stats);

  return {
    ...fn,
    body,
  };
}

function optimizeBlock(
  stmts: MIRStmt[],
  stats: OptimizationPassStats,
  warnings: SemanticDiagnostic[]
): MIRStmt[] {
  const out: MIRStmt[] = [];
  let terminated = false;
  let warnedUnreachable = false;

  for (const stmt of stmts) {
    if (terminated) {
      stats.unreachableStmtsRemoved++;
      if (!warnedUnreachable) {
        // Avoid warning on synthetic trailing `ret void` appended by IR builder
        const isSyntheticTrailingVoidReturn = stmt.kind === 'Return' && !stmt.value;
        if (!isSyntheticTrailingVoidReturn) {
          warnedUnreachable = true;
          warnings.push({
            code: 'W_UNREACHABLE_CODE',
            severity: 'warning',
            message: 'Unreachable statement after control-flow terminator',
            line: stmt.span.line,
            column: stmt.span.column,
            file: stmt.span.file,
          });
        }
      }
      continue;
    }

    switch (stmt.kind) {
      case 'StoreLocal': {
        const value = optimizeExpr(stmt.value, stats);
        out.push({ ...stmt, value });
        break;
      }
      case 'StoreGlobal': {
        const value = optimizeExpr(stmt.value, stats);
        out.push({ ...stmt, value });
        break;
      }
      case 'ArraySet': {
        out.push({
          ...stmt,
          array: optimizeExpr(stmt.array, stats),
          index: optimizeExpr(stmt.index, stats),
          value: optimizeExpr(stmt.value, stats),
        });
        break;
      }
      case 'MapSetStmt': {
        out.push({
          ...stmt,
          map: optimizeExpr(stmt.map, stats),
          key: optimizeExpr(stmt.key, stats),
          value: optimizeExpr(stmt.value, stats),
        });
        break;
      }
      case 'FieldSet': {
        out.push({
          ...stmt,
          object: optimizeExpr(stmt.object, stats),
          value: optimizeExpr(stmt.value, stats),
        });
        break;
      }
      case 'ExprStmt': {
        const expr = optimizeExpr(stmt.expr, stats);
        if (isPureMIRExpr(expr)) {
          // Pure standalone expression has zero side effects
          stats.deadLocalsEliminated++;
        } else {
          out.push({ ...stmt, expr });
        }
        break;
      }
      case 'If': {
        const condition = optimizeExpr(stmt.condition, stats);
        const thenBranch = optimizeBlock(stmt.thenBranch, stats, warnings);
        const elseBranch = optimizeBlock(stmt.elseBranch, stats, warnings);

        if (condition.kind === 'ConstBool') {
          stats.constantsFolded++;
          const chosen = condition.value ? thenBranch : elseBranch;
          const discarded = condition.value ? elseBranch : thenBranch;
          stats.unreachableStmtsRemoved += discarded.length;
          for (const s of chosen) {
            out.push(s);
            if (isTerminator(s)) {
              terminated = true;
              break;
            }
          }
        } else {
          const optIf: MIRStmt = { ...stmt, condition, thenBranch, elseBranch };
          out.push(optIf);
          if (
            thenBranch.length > 0 &&
            elseBranch.length > 0 &&
            blockAlwaysTerminates(thenBranch) &&
            blockAlwaysTerminates(elseBranch)
          ) {
            terminated = true;
          }
        }
        break;
      }
      case 'While': {
        const condition = optimizeExpr(stmt.condition, stats);
        if (condition.kind === 'ConstBool' && condition.value === false) {
          stats.constantsFolded++;
          stats.unreachableStmtsRemoved += stmt.body.length;
          break;
        }
        const body = optimizeBlock(stmt.body, stats, warnings);
        out.push({ ...stmt, condition, body });
        break;
      }
      case 'Match': {
        const subject = optimizeExpr(stmt.subject, stats);
        const arms: MIRMatchArm[] = stmt.arms.map((a) => ({
          ...a,
          body: optimizeBlock(a.body, stats, warnings),
        }));
        out.push({ ...stmt, subject, arms });
        break;
      }
      case 'Return': {
        out.push({
          ...stmt,
          value: stmt.value ? optimizeExpr(stmt.value, stats) : undefined,
        });
        terminated = true;
        break;
      }
      case 'Break':
      case 'Continue': {
        out.push(stmt);
        terminated = true;
        break;
      }
    }
  }

  return out;
}

function isTerminator(stmt: MIRStmt): boolean {
  return stmt.kind === 'Return' || stmt.kind === 'Break' || stmt.kind === 'Continue';
}

function blockAlwaysTerminates(stmts: MIRStmt[]): boolean {
  const last = stmts[stmts.length - 1];
  if (!last) return false;
  if (isTerminator(last)) return true;
  if (last.kind === 'If') {
    return blockAlwaysTerminates(last.thenBranch) && blockAlwaysTerminates(last.elseBranch);
  }
  return false;
}

function optimizeExpr(expr: MIRExpr, stats: OptimizationPassStats): MIRExpr {
  switch (expr.kind) {
    case 'ConstInt':
    case 'ConstFloat':
    case 'ConstBool':
    case 'ConstStr':
    case 'ConstVoid':
    case 'LoadLocal':
    case 'LoadGlobal':
      return expr;

    case 'Unary': {
      const opd = optimizeExpr(expr.operand, stats);
      if (expr.op === '-' && opd.kind === 'ConstInt') {
        const neg = -opd.value;
        // Preserve runtime trap if -i64::MIN overflows!
        if (inI64Bounds(neg)) {
          stats.constantsFolded++;
          return { kind: 'ConstInt', value: neg, type: T_I64, span: expr.span };
        }
      }
      if (expr.op === '-' && opd.kind === 'ConstFloat') {
        stats.constantsFolded++;
        return { kind: 'ConstFloat', value: -opd.value, type: T_F64, span: expr.span };
      }
      if (expr.op === '!' && opd.kind === 'ConstBool') {
        stats.constantsFolded++;
        return { kind: 'ConstBool', value: !opd.value, type: T_BOOL, span: expr.span };
      }
      // Algebraic double negation `!!b -> b`
      if (expr.op === '!' && opd.kind === 'Unary' && opd.op === '!') {
        stats.algebraicSimplifications++;
        return opd.operand;
      }
      return { ...expr, operand: opd };
    }

    case 'Cast': {
      const opd = optimizeExpr(expr.operand, stats);
      if (expr.castKind === 'i64_to_f64' && opd.kind === 'ConstInt') {
        stats.constantsFolded++;
        return { kind: 'ConstFloat', value: Number(opd.value), type: T_F64, span: expr.span };
      }
      if (expr.castKind === 'to_str') {
        if (opd.kind === 'ConstInt') {
          stats.constantsFolded++;
          return { kind: 'ConstStr', value: opd.value.toString(), type: T_STR, span: expr.span };
        }
        if (opd.kind === 'ConstBool') {
          stats.constantsFolded++;
          return { kind: 'ConstStr', value: opd.value ? 'true' : 'false', type: T_STR, span: expr.span };
        }
        if (opd.kind === 'ConstStr') {
          stats.algebraicSimplifications++;
          return opd;
        }
      }
      return { ...expr, operand: opd };
    }

    case 'Binary': {
      const left = optimizeExpr(expr.left, stats);
      const right = optimizeExpr(expr.right, stats);

      // Constant folding: i64 (checked!)
      if (left.kind === 'ConstInt' && right.kind === 'ConstInt') {
        const a = left.value;
        const b = right.value;
        switch (expr.op) {
          case '+': {
            const r = a + b;
            if (inI64Bounds(r)) {
              stats.constantsFolded++;
              return { kind: 'ConstInt', value: r, type: T_I64, span: expr.span };
            }
            break;
          }
          case '-': {
            const r = a - b;
            if (inI64Bounds(r)) {
              stats.constantsFolded++;
              return { kind: 'ConstInt', value: r, type: T_I64, span: expr.span };
            }
            break;
          }
          case '*': {
            const r = a * b;
            if (inI64Bounds(r)) {
              stats.constantsFolded++;
              return { kind: 'ConstInt', value: r, type: T_I64, span: expr.span };
            }
            break;
          }
          case '/': {
            // Never fold division by zero or i64::MIN / -1!
            if (b !== 0n && !(a === I64_MIN && b === -1n)) {
              stats.constantsFolded++;
              return { kind: 'ConstInt', value: a / b, type: T_I64, span: expr.span };
            }
            break;
          }
          case '%': {
            if (b !== 0n && !(a === I64_MIN && b === -1n)) {
              stats.constantsFolded++;
              return { kind: 'ConstInt', value: a % b, type: T_I64, span: expr.span };
            }
            break;
          }
          case '==':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a === b, type: T_BOOL, span: expr.span };
          case '!=':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a !== b, type: T_BOOL, span: expr.span };
          case '<':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a < b, type: T_BOOL, span: expr.span };
          case '<=':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a <= b, type: T_BOOL, span: expr.span };
          case '>':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a > b, type: T_BOOL, span: expr.span };
          case '>=':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a >= b, type: T_BOOL, span: expr.span };
        }
      }

      // Constant folding: f64
      if (left.kind === 'ConstFloat' && right.kind === 'ConstFloat') {
        const a = left.value;
        const b = right.value;
        switch (expr.op) {
          case '+':
            stats.constantsFolded++;
            return { kind: 'ConstFloat', value: a + b, type: T_F64, span: expr.span };
          case '-':
            stats.constantsFolded++;
            return { kind: 'ConstFloat', value: a - b, type: T_F64, span: expr.span };
          case '*':
            stats.constantsFolded++;
            return { kind: 'ConstFloat', value: a * b, type: T_F64, span: expr.span };
          case '/':
            if (b !== 0) {
              stats.constantsFolded++;
              return { kind: 'ConstFloat', value: a / b, type: T_F64, span: expr.span };
            }
            break;
          case '==':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a === b, type: T_BOOL, span: expr.span };
          case '!=':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a !== b, type: T_BOOL, span: expr.span };
          case '<':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a < b, type: T_BOOL, span: expr.span };
          case '<=':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a <= b, type: T_BOOL, span: expr.span };
          case '>':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a > b, type: T_BOOL, span: expr.span };
          case '>=':
            stats.constantsFolded++;
            return { kind: 'ConstBool', value: a >= b, type: T_BOOL, span: expr.span };
        }
      }

      // Constant folding: str
      if (left.kind === 'ConstStr' && right.kind === 'ConstStr') {
        if (expr.op === '+') {
          stats.constantsFolded++;
          return { kind: 'ConstStr', value: left.value + right.value, type: T_STR, span: expr.span };
        }
        if (expr.op === '==') {
          stats.constantsFolded++;
          return { kind: 'ConstBool', value: left.value === right.value, type: T_BOOL, span: expr.span };
        }
        if (expr.op === '!=') {
          stats.constantsFolded++;
          return { kind: 'ConstBool', value: left.value !== right.value, type: T_BOOL, span: expr.span };
        }
      }

      // Constant folding: bool
      if (left.kind === 'ConstBool' && right.kind === 'ConstBool') {
        if (expr.op === '&&') {
          stats.constantsFolded++;
          return { kind: 'ConstBool', value: left.value && right.value, type: T_BOOL, span: expr.span };
        }
        if (expr.op === '||') {
          stats.constantsFolded++;
          return { kind: 'ConstBool', value: left.value || right.value, type: T_BOOL, span: expr.span };
        }
        if (expr.op === '==') {
          stats.constantsFolded++;
          return { kind: 'ConstBool', value: left.value === right.value, type: T_BOOL, span: expr.span };
        }
        if (expr.op === '!=') {
          stats.constantsFolded++;
          return { kind: 'ConstBool', value: left.value !== right.value, type: T_BOOL, span: expr.span };
        }
      }

      // Algebraic simplifications (preserving side effects!)
      if (expr.op === '+' && right.kind === 'ConstInt' && right.value === 0n) {
        stats.algebraicSimplifications++;
        return left;
      }
      if (expr.op === '+' && left.kind === 'ConstInt' && left.value === 0n) {
        stats.algebraicSimplifications++;
        return right;
      }
      if (expr.op === '-' && right.kind === 'ConstInt' && right.value === 0n) {
        stats.algebraicSimplifications++;
        return left;
      }
      if (expr.op === '*' && right.kind === 'ConstInt' && right.value === 1n) {
        stats.algebraicSimplifications++;
        return left;
      }
      if (expr.op === '*' && left.kind === 'ConstInt' && left.value === 1n) {
        stats.algebraicSimplifications++;
        return right;
      }
      if (expr.op === '/' && right.kind === 'ConstInt' && right.value === 1n) {
        stats.algebraicSimplifications++;
        return left;
      }
      if (expr.op === '+' && right.kind === 'ConstStr' && right.value === '') {
        stats.algebraicSimplifications++;
        return left;
      }
      if (expr.op === '+' && left.kind === 'ConstStr' && left.value === '') {
        stats.algebraicSimplifications++;
        return right;
      }
      if (expr.op === '&&' && left.kind === 'ConstBool' && left.value === true) {
        stats.algebraicSimplifications++;
        return right;
      }
      if (expr.op === '&&' && left.kind === 'ConstBool' && left.value === false) {
        stats.algebraicSimplifications++;
        return { kind: 'ConstBool', value: false, type: T_BOOL, span: expr.span };
      }
      if (expr.op === '||' && left.kind === 'ConstBool' && left.value === false) {
        stats.algebraicSimplifications++;
        return right;
      }
      if (expr.op === '||' && left.kind === 'ConstBool' && left.value === true) {
        stats.algebraicSimplifications++;
        return { kind: 'ConstBool', value: true, type: T_BOOL, span: expr.span };
      }

      return { ...expr, left, right };
    }

    case 'CallFunction':
      return { ...expr, args: expr.args.map((a) => optimizeExpr(a, stats)) };

    case 'CallIntrinsic':
      return { ...expr, args: expr.args.map((a) => optimizeExpr(a, stats)) };

    case 'ArrayNew':
      return { ...expr, elements: expr.elements.map((e) => optimizeExpr(e, stats)) };

    case 'ArrayGet':
      return {
        ...expr,
        array: optimizeExpr(expr.array, stats),
        index: optimizeExpr(expr.index, stats),
      };

    case 'ArrayLen':
      return { ...expr, target: optimizeExpr(expr.target, stats) };

    case 'ArrayPush':
      return {
        ...expr,
        array: optimizeExpr(expr.array, stats),
        value: optimizeExpr(expr.value, stats),
      };

    case 'MapNew':
      return {
        ...expr,
        entries: expr.entries.map((e) => ({
          key: optimizeExpr(e.key, stats),
          value: optimizeExpr(e.value, stats),
        })),
      };

    case 'MapGet':
    case 'MapHas':
      return {
        ...expr,
        map: optimizeExpr(expr.map, stats),
        key: optimizeExpr(expr.key, stats),
      };

    case 'MapSet':
      return {
        ...expr,
        map: optimizeExpr(expr.map, stats),
        key: optimizeExpr(expr.key, stats),
        value: optimizeExpr(expr.value, stats),
      };

    case 'StructNew':
      return { ...expr, fields: expr.fields.map((f) => optimizeExpr(f, stats)) };

    case 'FieldGet':
      return { ...expr, object: optimizeExpr(expr.object, stats) };

    case 'EnumNew':
      return { ...expr, args: expr.args.map((a) => optimizeExpr(a, stats)) };

    case 'TryPropagate':
      return { ...expr, operand: optimizeExpr(expr.operand, stats) };
  }
}

function countSlotUsageInBlock(
  stmts: MIRStmt[],
  reads: Map<number, number>,
  writes: Map<number, number>
): void {
  for (const s of stmts) {
    switch (s.kind) {
      case 'StoreLocal':
        writes.set(s.slot, (writes.get(s.slot) || 0) + 1);
        countSlotUsageInExpr(s.value, reads);
        break;
      case 'StoreGlobal':
        countSlotUsageInExpr(s.value, reads);
        break;
      case 'ArraySet':
        countSlotUsageInExpr(s.array, reads);
        countSlotUsageInExpr(s.index, reads);
        countSlotUsageInExpr(s.value, reads);
        break;
      case 'MapSetStmt':
        countSlotUsageInExpr(s.map, reads);
        countSlotUsageInExpr(s.key, reads);
        countSlotUsageInExpr(s.value, reads);
        break;
      case 'FieldSet':
        countSlotUsageInExpr(s.object, reads);
        countSlotUsageInExpr(s.value, reads);
        break;
      case 'ExprStmt':
        countSlotUsageInExpr(s.expr, reads);
        break;
      case 'If':
        countSlotUsageInExpr(s.condition, reads);
        countSlotUsageInBlock(s.thenBranch, reads, writes);
        countSlotUsageInBlock(s.elseBranch, reads, writes);
        break;
      case 'While':
        countSlotUsageInExpr(s.condition, reads);
        countSlotUsageInBlock(s.body, reads, writes);
        break;
      case 'Match':
        reads.set(s.tempSlot, (reads.get(s.tempSlot) || 0) + 1);
        writes.set(s.tempSlot, (writes.get(s.tempSlot) || 0) + 1);
        countSlotUsageInExpr(s.subject, reads);
        for (const a of s.arms) {
          if (a.pattern.kind === 'EnumVariant') {
            for (const b of a.pattern.bindingSlots) {
              writes.set(b.slot, (writes.get(b.slot) || 0) + 1);
            }
          }
          countSlotUsageInBlock(a.body, reads, writes);
        }
        break;
      case 'Return':
        if (s.value) countSlotUsageInExpr(s.value, reads);
        break;
      case 'Break':
      case 'Continue':
        break;
    }
  }
}

function countSlotUsageInExpr(expr: MIRExpr, reads: Map<number, number>): void {
  switch (expr.kind) {
    case 'LoadLocal':
      reads.set(expr.slot, (reads.get(expr.slot) || 0) + 1);
      break;
    case 'Unary':
    case 'Cast':
    case 'TryPropagate':
      countSlotUsageInExpr(expr.operand, reads);
      break;
    case 'Binary':
      countSlotUsageInExpr(expr.left, reads);
      countSlotUsageInExpr(expr.right, reads);
      break;
    case 'CallFunction':
    case 'CallIntrinsic':
    case 'EnumNew':
      for (const a of expr.args) countSlotUsageInExpr(a, reads);
      break;
    case 'ArrayNew':
      for (const e of expr.elements) countSlotUsageInExpr(e, reads);
      break;
    case 'ArrayGet':
      countSlotUsageInExpr(expr.array, reads);
      countSlotUsageInExpr(expr.index, reads);
      break;
    case 'ArrayLen':
      countSlotUsageInExpr(expr.target, reads);
      break;
    case 'ArrayPush':
      countSlotUsageInExpr(expr.array, reads);
      countSlotUsageInExpr(expr.value, reads);
      break;
    case 'MapNew':
      for (const e of expr.entries) {
        countSlotUsageInExpr(e.key, reads);
        countSlotUsageInExpr(e.value, reads);
      }
      break;
    case 'MapGet':
    case 'MapHas':
      countSlotUsageInExpr(expr.map, reads);
      countSlotUsageInExpr(expr.key, reads);
      break;
    case 'MapSet':
      countSlotUsageInExpr(expr.map, reads);
      countSlotUsageInExpr(expr.key, reads);
      countSlotUsageInExpr(expr.value, reads);
      break;
    case 'StructNew':
      for (const f of expr.fields) countSlotUsageInExpr(f, reads);
      break;
    case 'FieldGet':
      countSlotUsageInExpr(expr.object, reads);
      break;
    default:
      break;
  }
}

function eliminateDeadStoresInBlock(
  stmts: MIRStmt[],
  reads: Map<number, number>,
  writes: Map<number, number>,
  stats: OptimizationPassStats
): MIRStmt[] {
  const out: MIRStmt[] = [];
  for (const s of stmts) {
    if (
      s.kind === 'StoreLocal' &&
      (reads.get(s.slot) || 0) === 0 &&
      (writes.get(s.slot) || 0) === 1
    ) {
      if (isPureMIRExpr(s.value)) {
        stats.deadLocalsEliminated++;
        continue;
      } else {
        // Keep side effect as ExprStmt, drop dead local store
        stats.deadLocalsEliminated++;
        out.push({ kind: 'ExprStmt', expr: s.value, span: s.span });
        continue;
      }
    }

    if (s.kind === 'If') {
      out.push({
        ...s,
        thenBranch: eliminateDeadStoresInBlock(s.thenBranch, reads, writes, stats),
        elseBranch: eliminateDeadStoresInBlock(s.elseBranch, reads, writes, stats),
      });
    } else if (s.kind === 'While') {
      out.push({
        ...s,
        body: eliminateDeadStoresInBlock(s.body, reads, writes, stats),
      });
    } else if (s.kind === 'Match') {
      out.push({
        ...s,
        arms: s.arms.map((a) => ({
          ...a,
          body: eliminateDeadStoresInBlock(a.body, reads, writes, stats),
        })),
      });
    } else {
      out.push(s);
    }
  }
  return out;
}

function computeReachableFunctions(functions: MIRFunction[], entry?: string): Set<string> {
  const fnMap = new Map<string, MIRFunction>();
  for (const f of functions) fnMap.set(f.name, f);

  const visited = new Set<string>();
  const queue: string[] = [];

  for (const f of functions) {
    if (f.exported || f.isEntry || f.name === '__init__' || f.name === '__script__' || f.name === entry) {
      visited.add(f.name);
      queue.push(f.name);
    }
  }

  while (queue.length > 0) {
    const cur = queue.pop()!;
    const fn = fnMap.get(cur);
    if (!fn) continue;
    const callees = new Set<string>();
    collectCalleesInBlock(fn.body, callees);
    for (const c of callees) {
      if (!visited.has(c)) {
        visited.add(c);
        queue.push(c);
      }
    }
  }

  return visited;
}

function collectCalleesInBlock(stmts: MIRStmt[], out: Set<string>): void {
  for (const s of stmts) {
    switch (s.kind) {
      case 'StoreLocal':
      case 'StoreGlobal':
        collectCalleesInExpr(s.value, out);
        break;
      case 'ArraySet':
        collectCalleesInExpr(s.array, out);
        collectCalleesInExpr(s.index, out);
        collectCalleesInExpr(s.value, out);
        break;
      case 'MapSetStmt':
        collectCalleesInExpr(s.map, out);
        collectCalleesInExpr(s.key, out);
        collectCalleesInExpr(s.value, out);
        break;
      case 'FieldSet':
        collectCalleesInExpr(s.object, out);
        collectCalleesInExpr(s.value, out);
        break;
      case 'ExprStmt':
        collectCalleesInExpr(s.expr, out);
        break;
      case 'If':
        collectCalleesInExpr(s.condition, out);
        collectCalleesInBlock(s.thenBranch, out);
        collectCalleesInBlock(s.elseBranch, out);
        break;
      case 'While':
        collectCalleesInExpr(s.condition, out);
        collectCalleesInBlock(s.body, out);
        break;
      case 'Match':
        collectCalleesInExpr(s.subject, out);
        for (const a of s.arms) collectCalleesInBlock(a.body, out);
        break;
      case 'Return':
        if (s.value) collectCalleesInExpr(s.value, out);
        break;
      default:
        break;
    }
  }
}

function collectCalleesInExpr(expr: MIRExpr, out: Set<string>): void {
  switch (expr.kind) {
    case 'CallFunction':
      out.add(expr.callee);
      for (const a of expr.args) collectCalleesInExpr(a, out);
      break;
    case 'CallIntrinsic':
    case 'EnumNew':
      for (const a of expr.args) collectCalleesInExpr(a, out);
      break;
    case 'Unary':
    case 'Cast':
    case 'TryPropagate':
      collectCalleesInExpr(expr.operand, out);
      break;
    case 'Binary':
      collectCalleesInExpr(expr.left, out);
      collectCalleesInExpr(expr.right, out);
      break;
    case 'ArrayNew':
      for (const e of expr.elements) collectCalleesInExpr(e, out);
      break;
    case 'ArrayGet':
      collectCalleesInExpr(expr.array, out);
      collectCalleesInExpr(expr.index, out);
      break;
    case 'ArrayLen':
      collectCalleesInExpr(expr.target, out);
      break;
    case 'ArrayPush':
      collectCalleesInExpr(expr.array, out);
      collectCalleesInExpr(expr.value, out);
      break;
    case 'MapNew':
      for (const e of expr.entries) {
        collectCalleesInExpr(e.key, out);
        collectCalleesInExpr(e.value, out);
      }
      break;
    case 'MapGet':
    case 'MapHas':
      collectCalleesInExpr(expr.map, out);
      collectCalleesInExpr(expr.key, out);
      break;
    case 'MapSet':
      collectCalleesInExpr(expr.map, out);
      collectCalleesInExpr(expr.key, out);
      collectCalleesInExpr(expr.value, out);
      break;
    case 'StructNew':
      for (const f of expr.fields) collectCalleesInExpr(f, out);
      break;
    case 'FieldGet':
      collectCalleesInExpr(expr.object, out);
      break;
    default:
      break;
  }
}

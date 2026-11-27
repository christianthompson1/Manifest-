import { MIRExpr, MIRFunction, MIRModule, MIRStmt } from '../ir/typed-ir.ts';
import { sha256Utf8Hex } from '../stdlib/sha256.ts';
import { checkedF64ToI64 } from '../stdlib/num-conv.ts';

export type SemValue =
  | { kind: 'void' }
  | { kind: 'i64'; value: bigint }
  | { kind: 'f64'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'array'; items: SemValue[] }
  | { kind: 'map'; entries: Map<string, SemValue> }
  | { kind: 'struct'; structName: string; fields: SemValue[] }
  | { kind: 'enum'; enumName: string; variantName: string; variantTag: number; payload: SemValue[] };

const V_VOID: SemValue = { kind: 'void' };
const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;

export interface SemanticEvalOptions {
  grantedCapabilities?: string[];
  maxSteps?: number;
  maxCallDepth?: number;
  virtualFiles?: Record<string, string>;
}

export interface SemanticEvalResult {
  ok: boolean;
  returnValue: string;
  returnType: string;
  stdout: string[];
  steps: number;
  error?: string;
  virtualFiles: Record<string, string>;
}

class EvalAbort extends Error {
  constructor(message: string) {
    super(message);
  }
}

type FlowSignal =
  | { kind: 'none' }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: SemValue };

export function formatSemValue(v: SemValue, active: Set<object> = new Set()): string {
  switch (v.kind) {
    case 'void':
      return 'void';
    case 'i64':
      return v.value.toString();
    case 'f64':
      return Number.isInteger(v.value) ? `${v.value}.0` : String(v.value);
    case 'bool':
      return v.value ? 'true' : 'false';
    case 'str':
      return v.value;
    case 'array': {
      if (active.has(v)) return '<Cycle>';
      active.add(v);
      const formatted = `[${v.items.map((it) => formatSemValue(it, active)).join(', ')}]`;
      active.delete(v);
      return formatted;
    }
    case 'map': {
      if (active.has(v)) return '<Cycle>';
      active.add(v);
      const sorted = Array.from(v.entries.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const formatted = `{${sorted.map(([k, val]) => `${k}: ${formatSemValue(val, active)}`).join(', ')}}`;
      active.delete(v);
      return formatted;
    }
    case 'struct': {
      if (active.has(v)) return '<Cycle>';
      active.add(v);
      const formatted = `${v.structName} { ${v.fields.map((f) => formatSemValue(f, active)).join(', ')} }`;
      active.delete(v);
      return formatted;
    }
    case 'enum': {
      if (active.has(v)) return '<Cycle>';
      active.add(v);
      const formatted =
        v.payload.length === 0
          ? `${v.enumName}::${v.variantName}`
          : `${v.enumName}::${v.variantName}(${v.payload.map((p) => formatSemValue(p, active)).join(', ')})`;
      active.delete(v);
      return formatted;
    }
  }
}

function valuesEqual(a: SemValue, b: SemValue): boolean {
  const worklist: Array<{ left: SemValue; right: SemValue }> = [{ left: a, right: b }];
  const objIds = new WeakMap<object, number>();
  let nextObjId = 1;
  const getId = (obj: object): number => {
    let id = objIds.get(obj);
    if (!id) {
      id = nextObjId++;
      objIds.set(obj, id);
    }
    return id;
  };
  const visitedPairs = new Set<string>();

  while (worklist.length > 0) {
    const { left, right } = worklist.pop()!;
    if (left.kind !== right.kind) return false;

    switch (left.kind) {
      case 'void':
        break;
      case 'i64':
        if (left.value !== (right as typeof left).value) return false;
        break;
      case 'f64':
        if (left.value !== (right as typeof left).value) return false;
        break;
      case 'bool':
        if (left.value !== (right as typeof left).value) return false;
        break;
      case 'str':
        if (left.value !== (right as typeof left).value) return false;
        break;
      case 'array': {
        const rb = right as typeof left;
        if (left === rb) break;
        const pairKey = `${getId(left)}:${getId(rb)}`;
        if (visitedPairs.has(pairKey)) break;
        visitedPairs.add(pairKey);
        if (left.items.length !== rb.items.length) return false;
        for (let i = 0; i < left.items.length; i++) {
          worklist.push({ left: left.items[i], right: rb.items[i] });
        }
        break;
      }
      case 'map': {
        const rb = right as typeof left;
        if (left === rb) break;
        const pairKey = `${getId(left)}:${getId(rb)}`;
        if (visitedPairs.has(pairKey)) break;
        visitedPairs.add(pairKey);
        if (left.entries.size !== rb.entries.size) return false;
        for (const [k, valA] of left.entries.entries()) {
          if (!rb.entries.has(k)) return false;
          worklist.push({ left: valA, right: rb.entries.get(k)! });
        }
        break;
      }
      case 'struct': {
        const rb = right as typeof left;
        if (left === rb) break;
        const pairKey = `${getId(left)}:${getId(rb)}`;
        if (visitedPairs.has(pairKey)) break;
        visitedPairs.add(pairKey);
        if (left.structName !== rb.structName || left.fields.length !== rb.fields.length) {
          return false;
        }
        for (let i = 0; i < left.fields.length; i++) {
          worklist.push({ left: left.fields[i], right: rb.fields[i] });
        }
        break;
      }
      case 'enum': {
        const rb = right as typeof left;
        if (left === rb) break;
        const pairKey = `${getId(left)}:${getId(rb)}`;
        if (visitedPairs.has(pairKey)) break;
        visitedPairs.add(pairKey);
        if (
          left.enumName !== rb.enumName ||
          left.variantTag !== rb.variantTag ||
          left.payload.length !== rb.payload.length
        ) {
          return false;
        }
        for (let i = 0; i < left.payload.length; i++) {
          worklist.push({ left: left.payload[i], right: rb.payload[i] });
        }
        break;
      }
    }
  }
  return true;
}

function checkI64(n: bigint, op: string): bigint {
  if (n < I64_MIN || n > I64_MAX) {
    throw new EvalAbort(`Integer overflow in i64 '${op}'`);
  }
  return n;
}

/**
 * Deterministic TypeScript reference evaluator over Typed Manifest IR (MIRModule).
 * Used as an independent oracle to cross-verify the Rust Manifest Virtual Machine (`mvm`).
 */
export function evaluateMIRModule(
  mir: MIRModule,
  options: SemanticEvalOptions = {}
): SemanticEvalResult {
  const maxSteps = options.maxSteps ?? 500_000;
  const maxCallDepth = options.maxCallDepth ?? 256;
  const granted = new Set(options.grantedCapabilities ?? ['console']);
  const vfs: Record<string, string> = { ...(options.virtualFiles || {}) };
  const stdout: string[] = [];
  let steps = 0;

  const fnMap = new Map<string, MIRFunction>();
  for (const fn of mir.functions) {
    fnMap.set(fn.name, fn);
  }

  const globals: SemValue[] = mir.globals.map(() => V_VOID);
  const globalInitialized: boolean[] = mir.globals.map(() => false);

  const checkCapability = (cap: string, sym: string): void => {
    if (cap === 'pure') return;
    for (const d of mir.denies) {
      if (cap === d || cap.startsWith(`${d}.`)) {
        throw new EvalAbort(`Capability denied: '${cap}' (required by '${sym}')`);
      }
    }
    const inRequires = mir.requires.some((r) => cap === r || cap.startsWith(`${r}.`));
    if (!inRequires) {
      throw new EvalAbort(`Capability '${cap}' not declared in module requires (for '${sym}')`);
    }
    const isGranted = Array.from(granted).some((g) => g === '*' || cap === g || cap.startsWith(`${g}.`));
    if (!isGranted) {
      throw new EvalAbort(`Host environment did not grant capability '${cap}' (for '${sym}')`);
    }
  };

  const step = (): void => {
    steps++;
    if (steps > maxSteps) {
      throw new EvalAbort(`Execution step limit (${maxSteps}) exceeded`);
    }
  };

  const callFn = (name: string, args: SemValue[], depth: number): SemValue => {
    if (depth > maxCallDepth) {
      throw new EvalAbort(`Call stack depth limit (${maxCallDepth}) exceeded`);
    }
    const fn = fnMap.get(name);
    if (!fn) {
      throw new EvalAbort(`Undefined function '${name}'`);
    }
    const locals: SemValue[] = fn.locals.map(() => V_VOID);
    for (let i = 0; i < args.length; i++) {
      locals[i] = args[i];
    }
    const sig = execBlock(fn.body, locals, depth);
    if (sig.kind === 'return') return sig.value;
    return V_VOID;
  };

  const execBlock = (stmts: MIRStmt[], locals: SemValue[], depth: number): FlowSignal => {
    for (const stmt of stmts) {
      step();
      switch (stmt.kind) {
        case 'StoreLocal':
          locals[stmt.slot] = evalExpr(stmt.value, locals, depth);
          break;
        case 'StoreGlobal':
          globals[stmt.slot] = evalExpr(stmt.value, locals, depth);
          globalInitialized[stmt.slot] = true;
          break;
        case 'ArraySet': {
          const arr = evalExpr(stmt.array, locals, depth);
          const idx = evalExpr(stmt.index, locals, depth);
          const val = evalExpr(stmt.value, locals, depth);
          if (arr.kind !== 'array' || idx.kind !== 'i64') {
            throw new EvalAbort('Type mismatch in ArraySet');
          }
          const n = Number(idx.value);
          if (n < 0 || n >= arr.items.length) {
            throw new EvalAbort(`Array index ${n} out of bounds (length ${arr.items.length})`);
          }
          arr.items[n] = val;
          break;
        }
        case 'MapSetStmt': {
          const map = evalExpr(stmt.map, locals, depth);
          const key = evalExpr(stmt.key, locals, depth);
          const val = evalExpr(stmt.value, locals, depth);
          if (map.kind !== 'map') throw new EvalAbort('Type mismatch in MapSet');
          map.entries.set(formatSemValue(key), val);
          break;
        }
        case 'FieldSet': {
          const obj = evalExpr(stmt.object, locals, depth);
          const val = evalExpr(stmt.value, locals, depth);
          if (obj.kind !== 'struct') throw new EvalAbort('Type mismatch in FieldSet');
          obj.fields[stmt.fieldIndex] = val;
          break;
        }
        case 'ExprStmt':
          evalExpr(stmt.expr, locals, depth);
          break;
        case 'If': {
          const cond = evalExpr(stmt.condition, locals, depth);
          if (cond.kind !== 'bool') throw new EvalAbort('If condition must be bool');
          const sig = execBlock(cond.value ? stmt.thenBranch : stmt.elseBranch, locals, depth);
          if (sig.kind !== 'none') return sig;
          break;
        }
        case 'While': {
          while (true) {
            step();
            const cond = evalExpr(stmt.condition, locals, depth);
            if (cond.kind !== 'bool') throw new EvalAbort('While condition must be bool');
            if (!cond.value) break;
            const sig = execBlock(stmt.body, locals, depth);
            if (sig.kind === 'break') break;
            if (sig.kind === 'return') return sig;
          }
          break;
        }
        case 'Break':
          return { kind: 'break' };
        case 'Continue':
          return { kind: 'continue' };
        case 'Return':
          return {
            kind: 'return',
            value: stmt.value ? evalExpr(stmt.value, locals, depth) : V_VOID,
          };
        case 'Match': {
          const subj = evalExpr(stmt.subject, locals, depth);
          locals[stmt.tempSlot] = subj;
          for (const arm of stmt.arms) {
            let matched = false;
            if (arm.pattern.kind === 'Wildcard') {
              matched = true;
            } else if (arm.pattern.kind === 'Literal') {
              if (arm.pattern.litKind === 'i64' && subj.kind === 'i64') {
                matched = subj.value === arm.pattern.value;
              } else if (arm.pattern.litKind === 'f64' && subj.kind === 'f64') {
                matched = subj.value === arm.pattern.value;
              } else if (arm.pattern.litKind === 'bool' && subj.kind === 'bool') {
                matched = subj.value === arm.pattern.value;
              } else if (arm.pattern.litKind === 'str' && subj.kind === 'str') {
                matched = subj.value === arm.pattern.value;
              }
            } else if (arm.pattern.kind === 'EnumVariant' && subj.kind === 'enum') {
              if (subj.variantTag === arm.pattern.variantTag) {
                matched = true;
                for (let i = 0; i < arm.pattern.bindingSlots.length; i++) {
                  locals[arm.pattern.bindingSlots[i].slot] = subj.payload[i] || V_VOID;
                }
              }
            }
            if (matched) {
              const sig = execBlock(arm.body, locals, depth);
              if (sig.kind !== 'none') return sig;
              break;
            }
          }
          break;
        }
      }
    }
    return { kind: 'none' };
  };

  const evalExpr = (expr: MIRExpr, locals: SemValue[], depth: number): SemValue => {
    step();
    switch (expr.kind) {
      case 'ConstInt':
        return { kind: 'i64', value: expr.value };
      case 'ConstFloat':
        return { kind: 'f64', value: expr.value };
      case 'ConstBool':
        return { kind: 'bool', value: expr.value };
      case 'ConstStr':
        return { kind: 'str', value: expr.value };
      case 'ConstVoid':
        return V_VOID;
      case 'LoadLocal':
        return locals[expr.slot] || V_VOID;
      case 'LoadGlobal':
        if (!globalInitialized[expr.slot]) {
          throw new EvalAbort(`Read of uninitialized module variable '${expr.name}'`);
        }
        return globals[expr.slot] || V_VOID;
      case 'Unary': {
        const v = evalExpr(expr.operand, locals, depth);
        if (expr.op === '-') {
          if (v.kind === 'i64') return { kind: 'i64', value: checkI64(-v.value, 'neg') };
          if (v.kind === 'f64') return { kind: 'f64', value: -v.value };
        }
        if (expr.op === '!' && v.kind === 'bool') return { kind: 'bool', value: !v.value };
        throw new EvalAbort('Invalid unary operand');
      }
      case 'Cast': {
        const v = evalExpr(expr.operand, locals, depth);
        if (expr.castKind === 'i64_to_f64' && v.kind === 'i64') {
          return { kind: 'f64', value: Number(v.value) };
        }
        if (expr.castKind === 'f64_to_i64' && v.kind === 'f64') {
          try {
            return { kind: 'i64', value: checkedF64ToI64(v.value) };
          } catch (err: any) {
            throw new EvalAbort(err?.message || `Numeric conversion trap (${v.value})`);
          }
        }
        return { kind: 'str', value: formatSemValue(v) };
      }
      case 'Binary': {
        if (expr.op === '&&') {
          const l = evalExpr(expr.left, locals, depth);
          if (l.kind !== 'bool') throw new EvalAbort('Expected bool');
          if (!l.value) return { kind: 'bool', value: false };
          const r = evalExpr(expr.right, locals, depth);
          if (r.kind !== 'bool') throw new EvalAbort('Expected bool');
          return r;
        }
        if (expr.op === '||') {
          const l = evalExpr(expr.left, locals, depth);
          if (l.kind !== 'bool') throw new EvalAbort('Expected bool');
          if (l.value) return { kind: 'bool', value: true };
          const r = evalExpr(expr.right, locals, depth);
          if (r.kind !== 'bool') throw new EvalAbort('Expected bool');
          return r;
        }

        const l = evalExpr(expr.left, locals, depth);
        const r = evalExpr(expr.right, locals, depth);

        if (expr.op === '==') return { kind: 'bool', value: valuesEqual(l, r) };
        if (expr.op === '!=') return { kind: 'bool', value: !valuesEqual(l, r) };

        if (l.kind === 'i64' && r.kind === 'i64') {
          switch (expr.op) {
            case '+':
              return { kind: 'i64', value: checkI64(l.value + r.value, 'add') };
            case '-':
              return { kind: 'i64', value: checkI64(l.value - r.value, 'sub') };
            case '*':
              return { kind: 'i64', value: checkI64(l.value * r.value, 'mul') };
            case '/':
              if (r.value === 0n) throw new EvalAbort('Division by zero');
              return { kind: 'i64', value: checkI64(l.value / r.value, 'div') };
            case '%':
              if (r.value === 0n) throw new EvalAbort('Division by zero');
              return { kind: 'i64', value: checkI64(l.value % r.value, 'rem') };
            case '<':
              return { kind: 'bool', value: l.value < r.value };
            case '<=':
              return { kind: 'bool', value: l.value <= r.value };
            case '>':
              return { kind: 'bool', value: l.value > r.value };
            case '>=':
              return { kind: 'bool', value: l.value >= r.value };
          }
        }
        if (l.kind === 'f64' && r.kind === 'f64') {
          switch (expr.op) {
            case '+':
              return { kind: 'f64', value: l.value + r.value };
            case '-':
              return { kind: 'f64', value: l.value - r.value };
            case '*':
              return { kind: 'f64', value: l.value * r.value };
            case '/':
              if (r.value === 0) throw new EvalAbort('Division by zero');
              return { kind: 'f64', value: l.value / r.value };
            case '<':
              return { kind: 'bool', value: l.value < r.value };
            case '<=':
              return { kind: 'bool', value: l.value <= r.value };
            case '>':
              return { kind: 'bool', value: l.value > r.value };
            case '>=':
              return { kind: 'bool', value: l.value >= r.value };
          }
        }
        if (expr.op === '+' && (l.kind === 'str' || r.kind === 'str')) {
          return { kind: 'str', value: formatSemValue(l) + formatSemValue(r) };
        }
        if (l.kind === 'str' && r.kind === 'str') {
          switch (expr.op) {
            case '<':
              return { kind: 'bool', value: l.value < r.value };
            case '<=':
              return { kind: 'bool', value: l.value <= r.value };
            case '>':
              return { kind: 'bool', value: l.value > r.value };
            case '>=':
              return { kind: 'bool', value: l.value >= r.value };
          }
        }
        throw new EvalAbort(`Unsupported binary operation ${expr.op}`);
      }
      case 'CallFunction': {
        const args = expr.args.map((a) => evalExpr(a, locals, depth));
        return callFn(expr.callee, args, depth + 1);
      }
      case 'CallIntrinsic': {
        checkCapability(expr.capability, expr.symbol);
        const args = expr.args.map((a) => evalExpr(a, locals, depth));
        return evalIntrinsic(expr.symbol, args, stdout, vfs);
      }
      case 'ArrayNew':
        return { kind: 'array', items: expr.elements.map((e) => evalExpr(e, locals, depth)) };
      case 'ArrayGet': {
        const arr = evalExpr(expr.array, locals, depth);
        const idx = evalExpr(expr.index, locals, depth);
        if (arr.kind !== 'array' || idx.kind !== 'i64') throw new EvalAbort('Invalid ArrayGet');
        const n = Number(idx.value);
        if (n < 0 || n >= arr.items.length) {
          throw new EvalAbort(`Array index ${n} out of bounds (length ${arr.items.length})`);
        }
        return arr.items[n];
      }
      case 'ArrayLen': {
        const t = evalExpr(expr.target, locals, depth);
        if (t.kind === 'array') return { kind: 'i64', value: BigInt(t.items.length) };
        if (t.kind === 'str') return { kind: 'i64', value: BigInt(Array.from(t.value).length) };
        throw new EvalAbort('Invalid ArrayLen target');
      }
      case 'ArrayPush': {
        const arr = evalExpr(expr.array, locals, depth);
        const val = evalExpr(expr.value, locals, depth);
        if (arr.kind !== 'array') throw new EvalAbort('Invalid ArrayPush');
        arr.items.push(val);
        return V_VOID;
      }
      case 'MapNew': {
        const m = new Map<string, SemValue>();
        for (const e of expr.entries) {
          const k = evalExpr(e.key, locals, depth);
          const v = evalExpr(e.value, locals, depth);
          m.set(formatSemValue(k), v);
        }
        return { kind: 'map', entries: m };
      }
      case 'MapGet': {
        const m = evalExpr(expr.map, locals, depth);
        const k = evalExpr(expr.key, locals, depth);
        if (m.kind !== 'map') throw new EvalAbort('Invalid MapGet');
        const keyStr = formatSemValue(k);
        const found = m.entries.get(keyStr);
        if (!found) throw new EvalAbort(`Map key '${keyStr}' not found`);
        return found;
      }
      case 'MapSet': {
        const m = evalExpr(expr.map, locals, depth);
        const k = evalExpr(expr.key, locals, depth);
        const v = evalExpr(expr.value, locals, depth);
        if (m.kind !== 'map') throw new EvalAbort('Invalid MapSet');
        m.entries.set(formatSemValue(k), v);
        return V_VOID;
      }
      case 'MapHas': {
        const m = evalExpr(expr.map, locals, depth);
        const k = evalExpr(expr.key, locals, depth);
        if (m.kind !== 'map') throw new EvalAbort('Invalid MapHas');
        return { kind: 'bool', value: m.entries.has(formatSemValue(k)) };
      }
      case 'StructNew':
        return {
          kind: 'struct',
          structName: expr.structName,
          fields: expr.fields.map((f) => evalExpr(f, locals, depth)),
        };
      case 'FieldGet': {
        const obj = evalExpr(expr.object, locals, depth);
        if (obj.kind !== 'struct') throw new EvalAbort('Invalid FieldGet');
        return obj.fields[expr.fieldIndex] || V_VOID;
      }
      case 'EnumNew':
        return {
          kind: 'enum',
          enumName: expr.enumName,
          variantName: expr.variantName,
          variantTag: expr.variantTag,
          payload: expr.args.map((a) => evalExpr(a, locals, depth)),
        };
      case 'TryPropagate': {
        const v = evalExpr(expr.operand, locals, depth);
        if (v.kind === 'enum' && v.enumName === 'Result') {
          if (v.variantTag === 0) return v.payload[0] || V_VOID;
          throw new EvalAbort(`Uncaught Err(${formatSemValue(v.payload[0] || V_VOID)})`);
        }
        return v;
      }
    }
  };

  try {
    if (fnMap.has('__init__') && mir.entryFunction !== '__init__') {
      callFn('__init__', [], 0);
    }
    const entry = mir.entryFunction || (fnMap.has('main') ? 'main' : undefined);
    if (!entry) {
      return {
        ok: true,
        returnValue: 'void',
        returnType: 'void',
        stdout,
        steps,
        virtualFiles: vfs,
      };
    }
    const ret = callFn(entry, [], 0);
    return {
      ok: true,
      returnValue: formatSemValue(ret),
      returnType: ret.kind,
      stdout,
      steps,
      virtualFiles: vfs,
    };
  } catch (err: any) {
    return {
      ok: false,
      returnValue: 'void',
      returnType: 'void',
      stdout,
      steps,
      error: err?.message || String(err),
      virtualFiles: vfs,
    };
  }
}

function evalIntrinsic(
  symbol: string,
  args: SemValue[],
  stdout: string[],
  vfs: Record<string, string>
): SemValue {
  switch (symbol) {
    case 'console.print':
      stdout.push(args.map((arg) => formatSemValue(arg)).join(' '));
      return V_VOID;
    case 'std::math::abs':
      if (args[0]?.kind === 'i64') {
        const v = args[0].value;
        return { kind: 'i64', value: checkI64(v < 0n ? -v : v, 'abs') };
      }
      return V_VOID;
    case 'std::math::abs_f64':
      if (args[0]?.kind === 'f64') return { kind: 'f64', value: Math.abs(args[0].value) };
      return V_VOID;
    case 'std::math::min':
      if (args[0]?.kind === 'i64' && args[1]?.kind === 'i64') {
        return { kind: 'i64', value: args[0].value < args[1].value ? args[0].value : args[1].value };
      }
      return V_VOID;
    case 'std::math::max':
      if (args[0]?.kind === 'i64' && args[1]?.kind === 'i64') {
        return { kind: 'i64', value: args[0].value > args[1].value ? args[0].value : args[1].value };
      }
      return V_VOID;
    case 'std::math::sqrt':
      if (args[0]?.kind === 'f64') return { kind: 'f64', value: Math.sqrt(args[0].value) };
      return V_VOID;
    case 'std::str::upper':
      if (args[0]?.kind === 'str') return { kind: 'str', value: args[0].value.toUpperCase() };
      return V_VOID;
    case 'std::str::lower':
      if (args[0]?.kind === 'str') return { kind: 'str', value: args[0].value.toLowerCase() };
      return V_VOID;
    case 'std::str::trim':
      if (args[0]?.kind === 'str') return { kind: 'str', value: args[0].value.trim() };
      return V_VOID;
    case 'std::str::contains':
      if (args[0]?.kind === 'str' && args[1]?.kind === 'str') {
        return { kind: 'bool', value: args[0].value.includes(args[1].value) };
      }
      return V_VOID;
    case 'time.now':
      return { kind: 'i64', value: BigInt(Date.now()) };
    case 'fs.read_text': {
      const p = args[0]?.kind === 'str' ? args[0].value : '';
      if (!(p in vfs)) throw new EvalAbort(`File not found: ${p}`);
      return { kind: 'str', value: vfs[p] };
    }
    case 'fs.write_text': {
      const p = args[0]?.kind === 'str' ? args[0].value : '';
      const content = args[1] ? formatSemValue(args[1]) : '';
      vfs[p] = content;
      return { kind: 'bool', value: true };
    }
    case 'crypto.hash':
    case 'std::crypto::sha256':
    case 'std::crypto::hash': {
      if (args.length !== 1 || args[0]?.kind !== 'str') {
        throw new EvalAbort(`${symbol} expects a single str argument`);
      }
      return { kind: 'str', value: sha256Utf8Hex(args[0].value) };
    }
    default:
      return { kind: 'str', value: '' };
  }
}

import { MIRExpr, MIRFunction, MIRModule, MIRStmt } from '../ir/typed-ir.ts';

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

export function formatSemValue(v: SemValue): string {
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
    case 'array':
      return `[${v.items.map(formatSemValue).join(', ')}]`;
    case 'map': {
      const sorted = Array.from(v.entries.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${sorted.map(([k, val]) => `${k}: ${formatSemValue(val)}`).join(', ')}}`;
    }
    case 'struct':
      return `${v.structName} { ${v.fields.map(formatSemValue).join(', ')} }`;
    case 'enum':
      return v.payload.length === 0
        ? `${v.enumName}::${v.variantName}`
        : `${v.enumName}::${v.variantName}(${v.payload.map(formatSemValue).join(', ')})`;
  }
}

function valuesEqual(a: SemValue, b: SemValue): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'void':
      return true;
    case 'i64':
      return a.value === (b as typeof a).value;
    case 'f64':
      return a.value === (b as typeof a).value;
    case 'bool':
      return a.value === (b as typeof a).value;
    case 'str':
      return a.value === (b as typeof a).value;
    default:
      return a === b;
  }
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
          return { kind: 'i64', value: BigInt(Math.trunc(v.value)) };
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
      stdout.push(args.map(formatSemValue).join(' '));
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
    case 'crypto.hash': {
      // Pure JS SHA-256 matching FIPS 180-4 / Rust MVM
      const text = args[0] ? formatSemValue(args[0]) : '';
      return { kind: 'str', value: sha256HexSync(text) };
    }
    default:
      return { kind: 'str', value: '' };
  }
}

function sha256HexSync(asciiOrUtf8: string): string {
  const bytes = new TextEncoder().encode(asciiOrUtf8);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 9 + 63) & ~63);
  const msg = new Uint8Array(padLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);

  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H)
    .map((x) => x.toString(16).padStart(8, '0'))
    .join('');
}

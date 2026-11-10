/**
 * Manifest Virtual Machine (MVM) - High-Fidelity Bytecode Interpreter
 *
 * Implements:
 * - Deterministic instruction dispatch and fuel consumption
 * - Managed HeapArena with Mark-and-Sweep garbage collection and root tracking
 * - Hard bounds: call-stack depth, operand-stack size, memory allocation limits
 * - Strict 64-bit integer arithmetic overflow and division-by-zero checks
 * - Explicit host capability gates and sandbox policy enforcement
 * - Structured runtime diagnostics with error categories
 */

import {
  DecodedMbcInstruction,
  DecodedMbcModule,
  MbcConstKind,
  MbcOpcode,
} from '../bytecode/mbc-format.ts';
import { decodeMbcContainer } from '../bytecode/mbc-reader.ts';
import { MvmHeapArena, MvmValue, RootProvider, GcStatistics } from './mvm-heap.ts';

const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;

export interface MvmInterpreterOptions {
  grantedCapabilities?: string[];
  maxSteps?: number;
  maxCallDepth?: number;
  maxStackSlots?: number;
  maxHeapObjects?: number;
  entryFunction?: string;
  virtualFiles?: Record<string, string>;
  onConsoleLog?: (line: string) => void;
  networkHandler?: (url: string) => string;
  dbHandler?: (query: string) => string;
  cancellationToken?: { isCancelled: boolean };
}

export interface MvmInterpreterResult {
  ok: boolean;
  phase: 'decode' | 'verify' | 'runtime';
  returnType: string;
  returnValue: string;
  stdout: string[];
  steps: number;
  heapObjects: number;
  gcStats: GcStatistics;
  error?: string;
  virtualFiles: Record<string, string>;
}

export class MvmRuntimeTrap extends Error {
  constructor(public readonly code: string, message: string, public readonly pc?: number) {
    super(`[${code}] ${message}`);
  }
}

interface CallFrame {
  fnIdx: number;
  fnName: string;
  returnPc: number;
  locals: MvmValue[];
}

export class MvmInterpreter {
  public static execute(
    moduleOrBytes: DecodedMbcModule | Uint8Array,
    options: MvmInterpreterOptions = {}
  ): MvmInterpreterResult {
    const granted = new Set(options.grantedCapabilities ?? ['console']);
    const vfs: Record<string, string> = { ...(options.virtualFiles || {}) };
    const stdout: string[] = [];
    const maxSteps = options.maxSteps ?? 2_000_000;
    const maxCallDepth = options.maxCallDepth ?? 512;
    const maxStackSlots = options.maxStackSlots ?? 16_384;
    const maxHeapObjects = options.maxHeapObjects ?? 65_536;

    let mod: DecodedMbcModule;
    if (moduleOrBytes instanceof Uint8Array) {
      try {
        mod = decodeMbcContainer(moduleOrBytes);
      } catch (err: any) {
        return {
          ok: false,
          phase: 'decode',
          returnType: 'void',
          returnValue: 'void',
          stdout,
          steps: 0,
          heapObjects: 0,
          gcStats: {
            collections: 0,
            objectsAllocated: 0,
            objectsReclaimed: 0,
            currentLive: 0,
            peakLive: 0,
            maxHeapLimit: maxHeapObjects,
          },
          error: `E_MVM_DECODE_FAILED: ${err?.message || String(err)}`,
          virtualFiles: vfs,
        };
      }
    } else {
      mod = moduleOrBytes;
    }

    // Capability policy verification against module denies
    for (const d of mod.denies) {
      if (granted.has(d)) {
        return {
          ok: false,
          phase: 'verify',
          returnType: 'void',
          returnValue: 'void',
          stdout,
          steps: 0,
          heapObjects: 0,
          gcStats: {
            collections: 0,
            objectsAllocated: 0,
            objectsReclaimed: 0,
            currentLive: 0,
            peakLive: 0,
            maxHeapLimit: maxHeapObjects,
          },
          error: `E_MVM_CAPABILITY_DENIED: Execution denied by module policy for capability '${d}'`,
          virtualFiles: vfs,
        };
      }
    }

    // Locate entry function
    let targetFnIdx: number;
    if (options.entryFunction) {
      const idx = mod.functions.findIndex((f) => f.name === options.entryFunction);
      if (idx < 0) {
        return {
          ok: false,
          phase: 'verify',
          returnType: 'void',
          returnValue: 'void',
          stdout,
          steps: 0,
          heapObjects: 0,
          gcStats: {
            collections: 0,
            objectsAllocated: 0,
            objectsReclaimed: 0,
            currentLive: 0,
            peakLive: 0,
            maxHeapLimit: maxHeapObjects,
          },
          error: `E_MVM_MISSING_FN: Entry function '${options.entryFunction}' not found`,
          virtualFiles: vfs,
        };
      }
      targetFnIdx = idx;
    } else if (mod.entryFnIndex !== null && mod.entryFnIndex < mod.functions.length) {
      targetFnIdx = mod.entryFnIndex;
    } else {
      const mainIdx = mod.functions.findIndex((f) => f.name === 'main');
      if (mainIdx < 0) {
        return {
          ok: false,
          phase: 'verify',
          returnType: 'void',
          returnValue: 'void',
          stdout,
          steps: 0,
          heapObjects: 0,
          gcStats: {
            collections: 0,
            objectsAllocated: 0,
            objectsReclaimed: 0,
            currentLive: 0,
            peakLive: 0,
            maxHeapLimit: maxHeapObjects,
          },
          error: `E_MVM_MISSING_FN: No entry function 'main' found in module`,
          virtualFiles: vfs,
        };
      }
      targetFnIdx = mainIdx;
    }

    // Initialize runtime structures
    const heap = new MvmHeapArena(maxHeapObjects);
    const globals: MvmValue[] = new Array(mod.globalCount).fill({ kind: 'void' });
    const stack: MvmValue[] = [];
    const frames: CallFrame[] = [];
    let stepsExecuted = 0;

    const rootProvider: RootProvider = {
      getStackRoots: () => stack,
      getGlobalRoots: () => globals,
      getFrameRoots: () => frames.flatMap((f) => f.locals),
    };

    const push = (v: MvmValue): void => {
      if (stack.length >= maxStackSlots) {
        throw new MvmRuntimeTrap(
          'E_MVM_RESOURCE_EXHAUSTED',
          `Operand stack overflow (${stack.length}/${maxStackSlots})`
        );
      }
      stack.push(v);
    };

    const pop = (): MvmValue => {
      if (stack.length === 0) {
        throw new MvmRuntimeTrap('E_MVM_STACK_UNDERFLOW', 'Operand stack underflow');
      }
      return stack.pop()!;
    };

    const peek = (): MvmValue => {
      if (stack.length === 0) {
        throw new MvmRuntimeTrap('E_MVM_STACK_UNDERFLOW', 'Operand stack underflow on peek');
      }
      return stack[stack.length - 1];
    };

    const checkI64 = (val: bigint, op: string): bigint => {
      if (val < I64_MIN || val > I64_MAX) {
        throw new MvmRuntimeTrap('E_MVM_OVERFLOW', `64-bit signed integer overflow in '${op}'`);
      }
      return val;
    };

    // Helper to run a function call
    const executeCall = (fnIdx: number, args: MvmValue[]): MvmValue => {
      if (frames.length >= maxCallDepth) {
        throw new MvmRuntimeTrap(
          'E_MVM_CALL_DEPTH_EXCEEDED',
          `Maximum call stack depth of ${maxCallDepth} exceeded (infinite recursion)`
        );
      }

      const fnDesc = mod.functions[fnIdx];
      if (!fnDesc) {
        throw new MvmRuntimeTrap('E_MVM_INVALID_CALL', `Invalid function index ${fnIdx}`);
      }

      const locals: MvmValue[] = new Array(fnDesc.localCount).fill({ kind: 'void' });
      for (let i = 0; i < args.length && i < locals.length; i++) {
        locals[i] = args[i];
      }

      const frame: CallFrame = {
        fnIdx,
        fnName: fnDesc.name,
        returnPc: 0,
        locals,
      };
      frames.push(frame);

      // Precompute offset -> instruction-index map
      const insts = fnDesc.instructions;
      const offsetToIdx = new Map<number, number>();
      insts.forEach((ins, idx) => offsetToIdx.set(ins.offset, idx));

      let pc = 0;

      while (pc < insts.length) {
        if (options.cancellationToken?.isCancelled) {
          throw new MvmRuntimeTrap('E_MVM_CANCELLED', 'Execution cancelled by host');
        }

        stepsExecuted++;
        if (stepsExecuted > maxSteps) {
          throw new MvmRuntimeTrap(
            'E_MVM_FUEL_EXHAUSTED',
            `Instruction fuel exhausted (${stepsExecuted}/${maxSteps} steps)`
          );
        }

        const inst = insts[pc];
        pc++; // Advance default next PC

        switch (inst.opcode) {
          case MbcOpcode.NOP:
            break;

          case MbcOpcode.CONST: {
            const cIdx = inst.operands[0];
            const c = mod.constants[cIdx];
            if (!c) {
              throw new MvmRuntimeTrap('E_MVM_INVALID_BYTECODE', `Constant index ${cIdx} out of bounds`);
            }
            switch (c.kind) {
              case 'i64':
                push({ kind: 'i64', value: c.value });
                break;
              case 'f64':
                push({ kind: 'f64', value: c.value });
                break;
              case 'bool':
                push({ kind: 'bool', value: c.value });
                break;
              case 'str':
                push({ kind: 'str', value: c.value });
                break;
            }
            break;
          }

          case MbcOpcode.PUSH_VOID:
            push({ kind: 'void' });
            break;

          case MbcOpcode.POP:
            pop();
            break;

          case MbcOpcode.DUP:
            push(peek());
            break;

          case MbcOpcode.LOAD_LOCAL: {
            const locIdx = inst.operands[0];
            push(frame.locals[locIdx] ?? { kind: 'void' });
            break;
          }

          case MbcOpcode.STORE_LOCAL: {
            const locIdx = inst.operands[0];
            frame.locals[locIdx] = pop();
            break;
          }

          case MbcOpcode.LOAD_GLOBAL: {
            const gIdx = inst.operands[0];
            push(globals[gIdx] ?? { kind: 'void' });
            break;
          }

          case MbcOpcode.STORE_GLOBAL: {
            const gIdx = inst.operands[0];
            globals[gIdx] = pop();
            break;
          }

          case MbcOpcode.ADD_I64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'i64' || b.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for ADD_I64 must be i64');
            }
            push({ kind: 'i64', value: checkI64(a.value + b.value, 'ADD_I64') });
            break;
          }

          case MbcOpcode.SUB_I64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'i64' || b.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for SUB_I64 must be i64');
            }
            push({ kind: 'i64', value: checkI64(a.value - b.value, 'SUB_I64') });
            break;
          }

          case MbcOpcode.MUL_I64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'i64' || b.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for MUL_I64 must be i64');
            }
            push({ kind: 'i64', value: checkI64(a.value * b.value, 'MUL_I64') });
            break;
          }

          case MbcOpcode.DIV_I64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'i64' || b.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for DIV_I64 must be i64');
            }
            if (b.value === 0n) {
              throw new MvmRuntimeTrap('E_MVM_DIV_ZERO', 'Division by zero in integer arithmetic');
            }
            if (a.value === I64_MIN && b.value === -1n) {
              throw new MvmRuntimeTrap('E_MVM_OVERFLOW', 'Integer overflow in i64::MIN / -1');
            }
            push({ kind: 'i64', value: a.value / b.value });
            break;
          }

          case MbcOpcode.MOD_I64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'i64' || b.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for MOD_I64 must be i64');
            }
            if (b.value === 0n) {
              throw new MvmRuntimeTrap('E_MVM_DIV_ZERO', 'Modulo by zero in integer arithmetic');
            }
            push({ kind: 'i64', value: a.value % b.value });
            break;
          }

          case MbcOpcode.NEG_I64: {
            const a = pop();
            if (a.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operand for NEG_I64 must be i64');
            }
            if (a.value === I64_MIN) {
              throw new MvmRuntimeTrap('E_MVM_OVERFLOW', 'Integer overflow in NEG(i64::MIN)');
            }
            push({ kind: 'i64', value: -a.value });
            break;
          }

          case MbcOpcode.ADD_F64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'f64' || b.kind !== 'f64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for ADD_F64 must be f64');
            }
            push({ kind: 'f64', value: a.value + b.value });
            break;
          }

          case MbcOpcode.SUB_F64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'f64' || b.kind !== 'f64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for SUB_F64 must be f64');
            }
            push({ kind: 'f64', value: a.value - b.value });
            break;
          }

          case MbcOpcode.MUL_F64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'f64' || b.kind !== 'f64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for MUL_F64 must be f64');
            }
            push({ kind: 'f64', value: a.value * b.value });
            break;
          }

          case MbcOpcode.DIV_F64: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'f64' || b.kind !== 'f64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for DIV_F64 must be f64');
            }
            push({ kind: 'f64', value: a.value / b.value });
            break;
          }

          case MbcOpcode.NEG_F64: {
            const a = pop();
            if (a.kind !== 'f64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operand for NEG_F64 must be f64');
            }
            push({ kind: 'f64', value: -a.value });
            break;
          }

          case MbcOpcode.I64_TO_F64: {
            const a = pop();
            if (a.kind !== 'i64') throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Expected i64');
            push({ kind: 'f64', value: Number(a.value) });
            break;
          }

          case MbcOpcode.F64_TO_I64: {
            const a = pop();
            if (a.kind !== 'f64') throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Expected f64');
            push({ kind: 'i64', value: BigInt(Math.trunc(a.value)) });
            break;
          }

          case MbcOpcode.CONCAT_STR: {
            const b = pop();
            const a = pop();
            const strA = a.kind === 'str' ? a.value : heap.formatValue(a);
            const strB = b.kind === 'str' ? b.value : heap.formatValue(b);
            push({ kind: 'str', value: strA + strB });
            break;
          }

          case MbcOpcode.TO_STR: {
            const a = pop();
            push({ kind: 'str', value: a.kind === 'str' ? a.value : heap.formatValue(a) });
            break;
          }

          case MbcOpcode.EQ: {
            const b = pop();
            const a = pop();
            push({ kind: 'bool', value: heap.equals(a, b) });
            break;
          }

          case MbcOpcode.NEQ: {
            const b = pop();
            const a = pop();
            push({ kind: 'bool', value: !heap.equals(a, b) });
            break;
          }

          case MbcOpcode.LT: {
            const b = pop();
            const a = pop();
            if (a.kind === 'i64' && b.kind === 'i64') {
              push({ kind: 'bool', value: a.value < b.value });
            } else if (a.kind === 'f64' && b.kind === 'f64') {
              push({ kind: 'bool', value: a.value < b.value });
            } else if (a.kind === 'str' && b.kind === 'str') {
              push({ kind: 'bool', value: a.value < b.value });
            } else {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Incompatible operands for LT');
            }
            break;
          }

          case MbcOpcode.LTE: {
            const b = pop();
            const a = pop();
            if (a.kind === 'i64' && b.kind === 'i64') {
              push({ kind: 'bool', value: a.value <= b.value });
            } else if (a.kind === 'f64' && b.kind === 'f64') {
              push({ kind: 'bool', value: a.value <= b.value });
            } else if (a.kind === 'str' && b.kind === 'str') {
              push({ kind: 'bool', value: a.value <= b.value });
            } else {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Incompatible operands for LTE');
            }
            break;
          }

          case MbcOpcode.GT: {
            const b = pop();
            const a = pop();
            if (a.kind === 'i64' && b.kind === 'i64') {
              push({ kind: 'bool', value: a.value > b.value });
            } else if (a.kind === 'f64' && b.kind === 'f64') {
              push({ kind: 'bool', value: a.value > b.value });
            } else if (a.kind === 'str' && b.kind === 'str') {
              push({ kind: 'bool', value: a.value > b.value });
            } else {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Incompatible operands for GT');
            }
            break;
          }

          case MbcOpcode.GTE: {
            const b = pop();
            const a = pop();
            if (a.kind === 'i64' && b.kind === 'i64') {
              push({ kind: 'bool', value: a.value >= b.value });
            } else if (a.kind === 'f64' && b.kind === 'f64') {
              push({ kind: 'bool', value: a.value >= b.value });
            } else if (a.kind === 'str' && b.kind === 'str') {
              push({ kind: 'bool', value: a.value >= b.value });
            } else {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Incompatible operands for GTE');
            }
            break;
          }

          case MbcOpcode.NOT: {
            const a = pop();
            if (a.kind !== 'bool') throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Expected bool for NOT');
            push({ kind: 'bool', value: !a.value });
            break;
          }

          case MbcOpcode.BOOL_AND: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'bool' || b.kind !== 'bool') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for BOOL_AND must be bool');
            }
            push({ kind: 'bool', value: a.value && b.value });
            break;
          }

          case MbcOpcode.BOOL_OR: {
            const b = pop();
            const a = pop();
            if (a.kind !== 'bool' || b.kind !== 'bool') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Operands for BOOL_OR must be bool');
            }
            push({ kind: 'bool', value: a.value || b.value });
            break;
          }

          case MbcOpcode.JMP: {
            const targetOff = inst.operands[0];
            const nextIdx = offsetToIdx.get(targetOff);
            if (nextIdx === undefined) {
              throw new MvmRuntimeTrap(
                'E_MVM_INVALID_JUMP',
                `Invalid jump target byte offset 0x${targetOff.toString(16)}`
              );
            }
            pc = nextIdx;
            break;
          }

          case MbcOpcode.JMP_IF_FALSE: {
            const cond = pop();
            if (cond.kind !== 'bool') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Conditional jump expects bool operand');
            }
            if (!cond.value) {
              const targetOff = inst.operands[0];
              const nextIdx = offsetToIdx.get(targetOff);
              if (nextIdx === undefined) {
                throw new MvmRuntimeTrap(
                  'E_MVM_INVALID_JUMP',
                  `Invalid jump target byte offset 0x${targetOff.toString(16)}`
                );
              }
              pc = nextIdx;
            }
            break;
          }

          case MbcOpcode.JMP_IF_TRUE: {
            const cond = pop();
            if (cond.kind !== 'bool') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'Conditional jump expects bool operand');
            }
            if (cond.value) {
              const targetOff = inst.operands[0];
              const nextIdx = offsetToIdx.get(targetOff);
              if (nextIdx === undefined) {
                throw new MvmRuntimeTrap(
                  'E_MVM_INVALID_JUMP',
                  `Invalid jump target byte offset 0x${targetOff.toString(16)}`
                );
              }
              pc = nextIdx;
            }
            break;
          }

          case MbcOpcode.CALL: {
            const calleeIdx = inst.operands[0];
            const callee = mod.functions[calleeIdx];
            if (!callee) {
              throw new MvmRuntimeTrap('E_MVM_INVALID_CALL', `Unknown function #${calleeIdx}`);
            }
            const callArgs: MvmValue[] = [];
            for (let i = 0; i < callee.paramCount; i++) {
              callArgs.unshift(pop());
            }
            const ret = executeCall(calleeIdx, callArgs);
            push(ret);
            break;
          }

          case MbcOpcode.HOST_CALL: {
            const impIdx = inst.operands[0];
            const imp = mod.imports[impIdx];
            if (!imp) {
              throw new MvmRuntimeTrap('E_MVM_INVALID_CALL', `Invalid host import #${impIdx}`);
            }

            // Capability enforcement: check if granted
            const reqCap = imp.capability;
            if (!granted.has(reqCap) && !granted.has(reqCap.split('.')[0])) {
              throw new MvmRuntimeTrap(
                'E_MVM_CAPABILITY_DENIED',
                `Access to host capability '${reqCap}' required by '${imp.symbol}' was denied by host policy`
              );
            }

            const hostArgs: MvmValue[] = [];
            for (let i = 0; i < imp.arity; i++) {
              hostArgs.unshift(pop());
            }

            // Host Dispatch
            switch (imp.symbol) {
              case 'console.print':
              case 'print':
              case 'println':
              case 'std::io::print':
              case 'std::io::println': {
                const line = hostArgs.map((a) => (a.kind === 'str' ? a.value : heap.formatValue(a))).join(' ');
                stdout.push(line);
                if (options.onConsoleLog) options.onConsoleLog(line);
                push({ kind: 'void' });
                break;
              }
              case 'time.now':
              case 'std::time::now':
              case 'std::time::now_ms': {
                push({ kind: 'i64', value: BigInt(Date.now()) });
                break;
              }
              case 'fs.read_text':
              case 'std::fs::read_text': {
                const path = hostArgs[0]?.kind === 'str' ? hostArgs[0].value : '';
                if (!(path in vfs)) {
                  throw new MvmRuntimeTrap('E_MVM_HOST_ERROR', `File '${path}' not found in virtual filesystem`);
                }
                push({ kind: 'str', value: vfs[path] });
                break;
              }
              case 'fs.write_text':
              case 'std::fs::write_text': {
                const path = hostArgs[0]?.kind === 'str' ? hostArgs[0].value : '';
                const content = hostArgs[1]?.kind === 'str' ? hostArgs[1].value : heap.formatValue(hostArgs[1] || { kind: 'void' });
                vfs[path] = content;
                push({ kind: 'bool', value: true });
                break;
              }
              case 'fs.exists':
              case 'std::fs::exists': {
                const path = hostArgs[0]?.kind === 'str' ? hostArgs[0].value : '';
                push({ kind: 'bool', value: path in vfs });
                break;
              }
              case 'net.get':
              case 'std::net::get': {
                const url = hostArgs[0]?.kind === 'str' ? hostArgs[0].value : '';
                if (options.networkHandler) {
                  push({ kind: 'str', value: options.networkHandler(url) });
                } else {
                  throw new MvmRuntimeTrap(
                    'E_MVM_HOST_ERROR',
                    `Synchronous network request to '${url}' blocked by host sandbox`
                  );
                }
                break;
              }
              case 'db.query':
              case 'std::db::query': {
                const q = hostArgs[0]?.kind === 'str' ? hostArgs[0].value : '';
                if (options.dbHandler) {
                  push({ kind: 'str', value: options.dbHandler(q) });
                } else {
                  push({ kind: 'str', value: '[]' });
                }
                break;
              }
              case 'std::crypto::sha256': {
                const text = hostArgs[0]?.kind === 'str' ? hostArgs[0].value : '';
                // Deterministic string hash
                let hash = 0x811c9dc5;
                for (let i = 0; i < text.length; i++) {
                  hash ^= text.charCodeAt(i);
                  hash = Math.imul(hash, 0x01000193);
                }
                push({ kind: 'str', value: (hash >>> 0).toString(16).padStart(8, '0') });
                break;
              }
              default:
                throw new MvmRuntimeTrap('E_MVM_HOST_ERROR', `Unsupported host intrinsic '${imp.symbol}'`);
            }
            break;
          }

          case MbcOpcode.RET: {
            const ret = pop();
            frames.pop();
            return ret;
          }

          case MbcOpcode.RET_VOID: {
            frames.pop();
            return { kind: 'void' };
          }

          case MbcOpcode.HALT: {
            frames.pop();
            return { kind: 'void' };
          }

          case MbcOpcode.TRAP: {
            throw new MvmRuntimeTrap('E_MVM_USER_TRAP', 'Explicit trap instruction encountered');
          }

          case MbcOpcode.ARRAY_NEW: {
            const count = inst.operands[0];
            const items: MvmValue[] = [];
            for (let i = 0; i < count; i++) {
              items.unshift(pop());
            }
            const id = heap.alloc({ kind: 'array', items }, rootProvider);
            push({ kind: 'array_ref', id });
            break;
          }

          case MbcOpcode.ARRAY_GET: {
            const idxVal = pop();
            const arrVal = pop();
            if (arrVal.kind !== 'array_ref' || idxVal.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'ARRAY_GET expects array_ref and i64 index');
            }
            const arr = heap.getArray(arrVal.id);
            const idx = Number(idxVal.value);
            if (idx < 0 || idx >= arr.items.length) {
              throw new MvmRuntimeTrap(
                'E_MVM_OUT_OF_BOUNDS',
                `Array index ${idx} out of bounds (length ${arr.items.length})`
              );
            }
            push(arr.items[idx]);
            break;
          }

          case MbcOpcode.ARRAY_SET: {
            const val = pop();
            const idxVal = pop();
            const arrVal = pop();
            if (arrVal.kind !== 'array_ref' || idxVal.kind !== 'i64') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'ARRAY_SET expects array_ref and i64 index');
            }
            const arr = heap.getArray(arrVal.id);
            const idx = Number(idxVal.value);
            if (idx < 0 || idx >= arr.items.length) {
              throw new MvmRuntimeTrap(
                'E_MVM_OUT_OF_BOUNDS',
                `Array index ${idx} out of bounds (length ${arr.items.length})`
              );
            }
            arr.items[idx] = val;
            break;
          }

          case MbcOpcode.ARRAY_LEN: {
            const arrVal = pop();
            if (arrVal.kind === 'array_ref') {
              const arr = heap.getArray(arrVal.id);
              push({ kind: 'i64', value: BigInt(arr.items.length) });
            } else if (arrVal.kind === 'bytes_ref') {
              const b = heap.getBytes(arrVal.id);
              push({ kind: 'i64', value: BigInt(b.buffer.length) });
            } else if (arrVal.kind === 'str') {
              push({ kind: 'i64', value: BigInt(arrVal.value.length) });
            } else {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'ARRAY_LEN expects array, bytes, or string');
            }
            break;
          }

          case MbcOpcode.ARRAY_PUSH: {
            const val = pop();
            const arrVal = pop();
            if (arrVal.kind !== 'array_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'ARRAY_PUSH expects array_ref');
            }
            const arr = heap.getArray(arrVal.id);
            arr.items.push(val);
            push({ kind: 'void' });
            break;
          }

          case MbcOpcode.MAP_NEW: {
            const pairCount = inst.operands[0];
            const entries = new Map<string, MvmValue>();
            for (let i = 0; i < pairCount; i++) {
              const v = pop();
              const k = pop();
              const keyStr = k.kind === 'str' ? k.value : heap.formatValue(k);
              entries.set(keyStr, v);
            }
            const id = heap.alloc({ kind: 'map', entries }, rootProvider);
            push({ kind: 'map_ref', id });
            break;
          }

          case MbcOpcode.MAP_GET: {
            const keyVal = pop();
            const mapVal = pop();
            if (mapVal.kind !== 'map_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'MAP_GET expects map_ref');
            }
            const m = heap.getMap(mapVal.id);
            const keyStr = keyVal.kind === 'str' ? keyVal.value : heap.formatValue(keyVal);
            push(m.entries.get(keyStr) ?? { kind: 'void' });
            break;
          }

          case MbcOpcode.MAP_SET: {
            const val = pop();
            const keyVal = pop();
            const mapVal = pop();
            if (mapVal.kind !== 'map_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'MAP_SET expects map_ref');
            }
            const m = heap.getMap(mapVal.id);
            const keyStr = keyVal.kind === 'str' ? keyVal.value : heap.formatValue(keyVal);
            m.entries.set(keyStr, val);
            push({ kind: 'void' });
            break;
          }

          case MbcOpcode.MAP_HAS: {
            const keyVal = pop();
            const mapVal = pop();
            if (mapVal.kind !== 'map_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'MAP_HAS expects map_ref');
            }
            const m = heap.getMap(mapVal.id);
            const keyStr = keyVal.kind === 'str' ? keyVal.value : heap.formatValue(keyVal);
            push({ kind: 'bool', value: m.entries.has(keyStr) });
            break;
          }

          case MbcOpcode.STRUCT_NEW: {
            const structIdx = inst.operands[0];
            const stDesc = mod.structs[structIdx];
            if (!stDesc) {
              throw new MvmRuntimeTrap('E_MVM_INVALID_BYTECODE', `Unknown struct index #${structIdx}`);
            }
            const fields: MvmValue[] = [];
            for (let i = 0; i < stDesc.fields.length; i++) {
              fields.unshift(pop());
            }
            const id = heap.alloc(
              {
                kind: 'struct',
                structIdx,
                name: stDesc.name,
                fields,
              },
              rootProvider
            );
            push({ kind: 'struct_ref', id });
            break;
          }

          case MbcOpcode.FIELD_GET: {
            const fieldIdx = inst.operands[0];
            const target = pop();
            if (target.kind !== 'struct_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'FIELD_GET expects struct_ref');
            }
            const st = heap.getStruct(target.id);
            if (fieldIdx >= st.fields.length) {
              throw new MvmRuntimeTrap(
                'E_MVM_OUT_OF_BOUNDS',
                `Field index ${fieldIdx} out of bounds on struct '${st.name}'`
              );
            }
            push(st.fields[fieldIdx]);
            break;
          }

          case MbcOpcode.FIELD_SET: {
            const fieldIdx = inst.operands[0];
            const val = pop();
            const target = pop();
            if (target.kind !== 'struct_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'FIELD_SET expects struct_ref');
            }
            const st = heap.getStruct(target.id);
            if (fieldIdx >= st.fields.length) {
              throw new MvmRuntimeTrap(
                'E_MVM_OUT_OF_BOUNDS',
                `Field index ${fieldIdx} out of bounds on struct '${st.name}'`
              );
            }
            st.fields[fieldIdx] = val;
            break;
          }

          case MbcOpcode.ENUM_NEW: {
            const enumIdx = inst.operands[0];
            const variantIdx = inst.operands[1];
            const enDesc = mod.enums[enumIdx];
            const vrDesc = enDesc?.variants[variantIdx];
            if (!enDesc || !vrDesc) {
              throw new MvmRuntimeTrap('E_MVM_INVALID_BYTECODE', 'Invalid enum/variant index');
            }
            const payload: MvmValue[] = [];
            for (let i = 0; i < vrDesc.arity; i++) {
              payload.unshift(pop());
            }
            const id = heap.alloc(
              {
                kind: 'enum',
                enumIdx,
                variantIdx,
                variantName: `${enDesc.name}::${vrDesc.name}`,
                payload,
              },
              rootProvider
            );
            push({ kind: 'enum_ref', id });
            break;
          }

          case MbcOpcode.ENUM_TAG: {
            const target = pop();
            if (target.kind !== 'enum_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'ENUM_TAG expects enum_ref');
            }
            const en = heap.getEnum(target.id);
            push({ kind: 'i64', value: BigInt(en.variantIdx) });
            break;
          }

          case MbcOpcode.ENUM_PAYLOAD: {
            const payloadIdx = inst.operands[0];
            const target = pop();
            if (target.kind !== 'enum_ref') {
              throw new MvmRuntimeTrap('E_MVM_TYPE_ERROR', 'ENUM_PAYLOAD expects enum_ref');
            }
            const en = heap.getEnum(target.id);
            if (payloadIdx >= en.payload.length) {
              throw new MvmRuntimeTrap('E_MVM_OUT_OF_BOUNDS', `Enum payload index ${payloadIdx} out of bounds`);
            }
            push(en.payload[payloadIdx]);
            break;
          }

          default:
            throw new MvmRuntimeTrap(
              'E_MVM_INVALID_OPCODE',
              `Unknown or unsupported opcode 0x${(inst.opcode as any).toString(16)}`
            );
        }
      }

      frames.pop();
      return { kind: 'void' };
    };

    // Execute __init__ first if present
    const initIdx = mod.functions.findIndex((f) => f.name === '__init__');
    try {
      if (initIdx >= 0 && initIdx !== targetFnIdx) {
        executeCall(initIdx, []);
      }
      const finalRet = executeCall(targetFnIdx, []);
      return {
        ok: true,
        phase: 'runtime',
        returnType: finalRet.kind,
        returnValue: heap.formatValue(finalRet),
        stdout,
        steps: stepsExecuted,
        heapObjects: heap.getLiveCount(),
        gcStats: heap.getStats(),
        virtualFiles: vfs,
      };
    } catch (err: any) {
      return {
        ok: false,
        phase: 'runtime',
        returnType: 'void',
        returnValue: 'void',
        stdout,
        steps: stepsExecuted,
        heapObjects: heap.getLiveCount(),
        gcStats: heap.getStats(),
        error: err?.message || String(err),
        virtualFiles: vfs,
      };
    }
  }
}

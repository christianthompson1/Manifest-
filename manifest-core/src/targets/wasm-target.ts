import { MIRExpr, MIRFunction, MIRModule, MIRStmt } from '../ir/typed-ir.ts';
import { formatSemanticType, SemanticDiagnostic, SemanticType } from '../semantics/types.ts';

const WASM_I32 = 0x7f;
const WASM_I64 = 0x7e;
const WASM_F64 = 0x7c;
const WASM_VOID_BLOCK = 0x40;

function encodeULEB128(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function encodeSLEB128BigInt(value: bigint): number[] {
  const out: number[] = [];
  let v = value;
  let more = true;
  while (more) {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    if ((v === 0n && !signBit) || (v === -1n && signBit)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte);
  }
  return out;
}

function encodeF64LE(value: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  return Array.from(new Uint8Array(buf));
}

function encodeStr(s: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(s));
  return [...encodeULEB128(bytes.length), ...bytes];
}

function encodeSection(id: number, payload: number[]): number[] {
  return [id, ...encodeULEB128(payload.length), ...payload];
}

function mapWasmValType(t: SemanticType): number | null {
  switch (t.kind) {
    case 'i64':
      return WASM_I64;
    case 'f64':
      return WASM_F64;
    case 'bool':
      return WASM_I32;
    default:
      return null;
  }
}

export interface WasmTargetBuildResult {
  success: boolean;
  wasmBytes?: Uint8Array;
  watText?: string;
  validated: boolean;
  diagnostics: SemanticDiagnostic[];
}

/**
 * Compiles a Typed Manifest IR (`MIRModule`) directly into a W3C WebAssembly v1.0
 * binary module (`.wasm`) + readable `.wat` text inspection.
 *
 * Imports `env.print_i32` and `env.print_f64` for `console` output compatibility
 * with `WasmExecutionProvider` and standard browser/Node WebAssembly hosts.
 */
export function compileMIRToWasm(mir: MIRModule): WasmTargetBuildResult {
  const diagnostics: SemanticDiagnostic[] = [];

  const fail = (message: string, line = 1, column = 1): WasmTargetBuildResult => {
    diagnostics.push({
      code: 'E_WASM_UNSUPPORTED_CONSTRUCT',
      severity: 'error',
      message,
      line,
      column,
      hint: 'Switch target to Manifest VM (.mbc) for full string, array, map, struct, and enum runtime support.',
    });
    return { success: false, validated: false, diagnostics };
  };

  if (mir.structs.length > 0) {
    return fail(`Direct WebAssembly target does not support heap struct '${mir.structs[0].name}' yet`);
  }
  const userEnums = mir.enums.filter((e) => e.name !== 'Result');
  if (userEnums.length > 0) {
    return fail(`Direct WebAssembly target does not support algebraic enum '${userEnums[0].name}' yet`);
  }

  // Imports:
  // func 0: (import "env" "print_i32" (param i32))
  // func 1: (import "env" "print_f64" (param f64))
  const IMPORT_PRINT_I32 = 0;
  const IMPORT_PRINT_F64 = 1;
  const IMPORT_COUNT = 2;

  const fnIndices = new Map<string, number>();
  mir.functions.forEach((fn, idx) => {
    fnIndices.set(fn.name, IMPORT_COUNT + idx);
  });

  // Validate global types
  const globalValTypes: number[] = [];
  for (const g of mir.globals) {
    const wt = mapWasmValType(g.type);
    if (wt === null) {
      return fail(
        `Global '${g.name}' has non-numeric type '${formatSemanticType(g.type)}' unsupported by standalone WASM target`,
        g.span.line,
        g.span.column
      );
    }
    globalValTypes.push(wt);
  }

  // Type section entries
  // type 0: (i32) -> ()
  // type 1: (f64) -> ()
  const typeEntries: number[][] = [
    [0x60, 0x01, WASM_I32, 0x00],
    [0x60, 0x01, WASM_F64, 0x00],
  ];

  const fnTypeIndices: number[] = [];
  const fnBodies: number[][] = [];
  const watLines: string[] = [
    `(module ;; Manifest Direct WebAssembly Target (${mir.moduleName})`,
    `  (import "env" "print_i32" (func $print_i32 (param i32)))`,
    `  (import "env" "print_f64" (func $print_f64 (param f64)))`,
    `  (memory (export "memory") 1)`,
  ];

  mir.globals.forEach((g, idx) => {
    const wt = globalValTypes[idx];
    const tName = wt === WASM_I64 ? 'i64' : wt === WASM_F64 ? 'f64' : 'i32';
    watLines.push(`  (global $${g.name} (mut ${tName}) (${tName}.const 0))`);
  });

  // Control stack tracks Wasm structured blocks ('if' | 'loop_break' | 'loop_cont')
  type BlockFrame = 'other' | 'loop_break' | 'loop_cont';

  for (const fn of mir.functions) {
    const paramWasmTypes: number[] = [];
    for (const p of fn.params) {
      const wt = mapWasmValType(p.type);
      if (wt === null) {
        return fail(
          `Parameter '${p.name}' in '${fn.name}' has type '${formatSemanticType(p.type)}' unsupported by direct WASM target`,
          p.span.line,
          p.span.column
        );
      }
      paramWasmTypes.push(wt);
    }

    let retWasmTypes: number[] = [];
    if (fn.returnType.kind !== 'void' && fn.returnType.kind !== 'any') {
      const rt = mapWasmValType(fn.returnType);
      if (rt === null) {
        return fail(
          `Return type '${formatSemanticType(fn.returnType)}' of '${fn.name}' is unsupported by direct WASM target`,
          fn.span.line,
          fn.span.column
        );
      }
      retWasmTypes = [rt];
    } else if (fn.returnType.kind === 'any') {
      // Check if body returns a concrete numeric value
      const retValType = inferConcreteReturnFromBody(fn.body);
      if (retValType !== null) retWasmTypes = [retValType];
    }

    const typeIdx = typeEntries.length;
    typeEntries.push([
      0x60,
      ...encodeULEB128(paramWasmTypes.length),
      ...paramWasmTypes,
      ...encodeULEB128(retWasmTypes.length),
      ...retWasmTypes,
    ]);
    fnTypeIndices.push(typeIdx);

    // Local slots >= fn.params.length
    const extraLocals: number[] = [];
    for (let i = fn.params.length; i < fn.locals.length; i++) {
      const lt = mapWasmValType(fn.locals[i].type) ?? WASM_I64;
      extraLocals.push(lt);
    }

    const code: number[] = [];
    const blockStack: BlockFrame[] = [];
    let unsupportedMsg: { msg: string; line: number; col: number } | null = null;

    const emitExpr = (expr: MIRExpr): number => {
      if (unsupportedMsg) return WASM_I64;
      switch (expr.kind) {
        case 'ConstInt':
          code.push(0x42, ...encodeSLEB128BigInt(expr.value)); // i64.const
          return WASM_I64;
        case 'ConstFloat':
          code.push(0x44, ...encodeF64LE(expr.value)); // f64.const
          return WASM_F64;
        case 'ConstBool':
          code.push(0x41, ...encodeSLEB128BigInt(expr.value ? 1n : 0n)); // i32.const
          return WASM_I32;
        case 'LoadLocal': {
          code.push(0x20, ...encodeULEB128(expr.slot)); // local.get
          const slotT =
            expr.slot < fn.params.length
              ? paramWasmTypes[expr.slot]
              : extraLocals[expr.slot - fn.params.length] ?? WASM_I64;
          return slotT;
        }
        case 'LoadGlobal': {
          code.push(0x23, ...encodeULEB128(expr.slot)); // global.get
          return globalValTypes[expr.slot] ?? WASM_I64;
        }
        case 'Unary': {
          const ot = emitExpr(expr.operand);
          if (expr.op === '-') {
            if (ot === WASM_F64) {
              code.push(0x9a); // f64.neg
              return WASM_F64;
            }
            // 0 - operand for i64: use temp or i64.const -1 * operand
            code.push(0x42, ...encodeSLEB128BigInt(-1n), 0x7e); // i64.const -1, i64.mul
            return WASM_I64;
          }
          code.push(0x45); // i32.eqz
          return WASM_I32;
        }
        case 'Cast': {
          const ot = emitExpr(expr.operand);
          if (expr.castKind === 'i64_to_f64') {
            if (ot === WASM_I64) code.push(0xb9); // f64.convert_i64_s
            return WASM_F64;
          }
          if (expr.castKind === 'f64_to_i64') {
            if (ot === WASM_F64) code.push(0xb0); // i64.trunc_f64_s
            return WASM_I64;
          }
          unsupportedMsg = {
            msg: `String conversion 'to_str' requires heap strings (use Manifest VM target)`,
            line: expr.span.line,
            col: expr.span.column,
          };
          return WASM_I32;
        }
        case 'Binary': {
          if (expr.op === '&&') {
            emitExpr(expr.left);
            code.push(0x04, WASM_I32); // if (result i32)
            blockStack.push('other');
            emitExpr(expr.right);
            code.push(0x05); // else
            code.push(0x41, 0x00); // i32.const 0
            code.push(0x0b); // end
            blockStack.pop();
            return WASM_I32;
          }
          if (expr.op === '||') {
            emitExpr(expr.left);
            code.push(0x04, WASM_I32); // if (result i32)
            blockStack.push('other');
            code.push(0x41, 0x01); // i32.const 1
            code.push(0x05); // else
            emitExpr(expr.right);
            code.push(0x0b); // end
            blockStack.pop();
            return WASM_I32;
          }

          const lt = emitExpr(expr.left);
          const rt = emitExpr(expr.right);
          if (lt === WASM_I64 && rt === WASM_I64) {
            switch (expr.op) {
              case '+':
                code.push(0x7c);
                return WASM_I64;
              case '-':
                code.push(0x7d);
                return WASM_I64;
              case '*':
                code.push(0x7e);
                return WASM_I64;
              case '/':
                code.push(0x7f); // i64.div_s (traps on / 0 and i64::MIN / -1!)
                return WASM_I64;
              case '%':
                code.push(0x81); // i64.rem_s
                return WASM_I64;
              case '==':
                code.push(0x51);
                return WASM_I32;
              case '!=':
                code.push(0x52);
                return WASM_I32;
              case '<':
                code.push(0x53);
                return WASM_I32;
              case '<=':
                code.push(0x57);
                return WASM_I32;
              case '>':
                code.push(0x55);
                return WASM_I32;
              case '>=':
                code.push(0x59);
                return WASM_I32;
            }
          } else if (lt === WASM_F64 && rt === WASM_F64) {
            switch (expr.op) {
              case '+':
                code.push(0xa0);
                return WASM_F64;
              case '-':
                code.push(0xa1);
                return WASM_F64;
              case '*':
                code.push(0xa2);
                return WASM_F64;
              case '/':
                code.push(0xa3);
                return WASM_F64;
              case '==':
                code.push(0x61);
                return WASM_I32;
              case '!=':
                code.push(0x62);
                return WASM_I32;
              case '<':
                code.push(0x63);
                return WASM_I32;
              case '<=':
                code.push(0x65);
                return WASM_I32;
              case '>':
                code.push(0x64);
                return WASM_I32;
              case '>=':
                code.push(0x66);
                return WASM_I32;
            }
          } else if (lt === WASM_I32 && rt === WASM_I32) {
            if (expr.op === '==') {
              code.push(0x46);
              return WASM_I32;
            }
            if (expr.op === '!=') {
              code.push(0x47);
              return WASM_I32;
            }
          }
          unsupportedMsg = {
            msg: `Binary operator '${expr.op}' on non-numeric operands is unsupported in direct WASM target`,
            line: expr.span.line,
            col: expr.span.column,
          };
          return WASM_I32;
        }
        case 'CallFunction': {
          for (const a of expr.args) emitExpr(a);
          const calleeWasmIdx = fnIndices.get(expr.callee);
          if (calleeWasmIdx === undefined) {
            unsupportedMsg = {
              msg: `Unknown function '${expr.callee}' in WASM target`,
              line: expr.span.line,
              col: expr.span.column,
            };
            return WASM_I32;
          }
          code.push(0x10, ...encodeULEB128(calleeWasmIdx)); // call
          const calleeFn = mir.functions.find((f) => f.name === expr.callee);
          if (!calleeFn || calleeFn.returnType.kind === 'void') {
            return 0; // void
          }
          return mapWasmValType(calleeFn.returnType) ?? WASM_I64;
        }
        case 'CallIntrinsic': {
          if (expr.symbol === 'console.print') {
            for (const a of expr.args) {
              const at = emitExpr(a);
              if (at === WASM_I64) {
                code.push(0xa7); // i32.wrap_i64
                code.push(0x10, ...encodeULEB128(IMPORT_PRINT_I32));
              } else if (at === WASM_F64) {
                code.push(0x10, ...encodeULEB128(IMPORT_PRINT_F64));
              } else if (at === WASM_I32) {
                code.push(0x10, ...encodeULEB128(IMPORT_PRINT_I32));
              }
            }
            return 0;
          }
          if (expr.symbol === 'std::math::sqrt' && expr.args.length === 1) {
            emitExpr(expr.args[0]);
            code.push(0x9f); // f64.sqrt
            return WASM_F64;
          }
          if (expr.symbol === 'std::math::abs_f64' && expr.args.length === 1) {
            emitExpr(expr.args[0]);
            code.push(0x99); // f64.abs
            return WASM_F64;
          }
          unsupportedMsg = {
            msg: `Host/stdlib intrinsic '${expr.symbol}' requires the Manifest VM (.mbc) or Native target`,
            line: expr.span.line,
            col: expr.span.column,
          };
          return 0;
        }
        default:
          unsupportedMsg = {
            msg: `Construct '${expr.kind}' requires heap runtime support (use Manifest VM target)`,
            line: expr.span.line,
            col: expr.span.column,
          };
          return 0;
      }
    };

    const emitStmts = (stmts: MIRStmt[]): void => {
      for (const s of stmts) {
        if (unsupportedMsg) return;
        switch (s.kind) {
          case 'StoreLocal': {
            emitExpr(s.value);
            code.push(0x21, ...encodeULEB128(s.slot)); // local.set
            break;
          }
          case 'StoreGlobal': {
            emitExpr(s.value);
            code.push(0x24, ...encodeULEB128(s.slot)); // global.set
            break;
          }
          case 'ExprStmt': {
            const rt = emitExpr(s.expr);
            if (rt !== 0) {
              code.push(0x1a); // drop
            }
            break;
          }
          case 'If': {
            emitExpr(s.condition);
            code.push(0x04, WASM_VOID_BLOCK); // if
            blockStack.push('other');
            emitStmts(s.thenBranch);
            if (s.elseBranch.length > 0) {
              code.push(0x05); // else
              emitStmts(s.elseBranch);
            }
            code.push(0x0b); // end
            blockStack.pop();
            break;
          }
          case 'While': {
            code.push(0x02, WASM_VOID_BLOCK); // block $break
            blockStack.push('loop_break');
            code.push(0x03, WASM_VOID_BLOCK); // loop $cont
            blockStack.push('loop_cont');

            emitExpr(s.condition);
            code.push(0x45); // i32.eqz
            code.push(0x0d, ...encodeULEB128(1)); // br_if 1 ($break)

            emitStmts(s.body);
            code.push(0x0c, ...encodeULEB128(0)); // br 0 ($cont)

            code.push(0x0b); // end loop
            blockStack.pop();
            code.push(0x0b); // end block
            blockStack.pop();
            break;
          }
          case 'Break': {
            const depth = findRelativeDepth(blockStack, 'loop_break');
            if (depth >= 0) code.push(0x0c, ...encodeULEB128(depth));
            break;
          }
          case 'Continue': {
            const depth = findRelativeDepth(blockStack, 'loop_cont');
            if (depth >= 0) code.push(0x0c, ...encodeULEB128(depth));
            break;
          }
          case 'Return': {
            if (s.value && retWasmTypes.length > 0) {
              emitExpr(s.value);
            }
            code.push(0x0f); // return
            break;
          }
          case 'Match': {
            const st = emitExpr(s.subject);
            code.push(0x21, ...encodeULEB128(s.tempSlot)); // local.set tempSlot
            code.push(0x02, WASM_VOID_BLOCK); // block $match_exit
            blockStack.push('other');
            for (const arm of s.arms) {
              if (arm.pattern.kind === 'Wildcard') {
                emitStmts(arm.body);
                code.push(0x0c, ...encodeULEB128(0)); // br $match_exit
              } else if (arm.pattern.kind === 'Literal') {
                code.push(0x20, ...encodeULEB128(s.tempSlot));
                if (arm.pattern.litKind === 'i64' && st === WASM_I64) {
                  code.push(0x42, ...encodeSLEB128BigInt(arm.pattern.value as bigint), 0x51);
                } else if (arm.pattern.litKind === 'bool' && st === WASM_I32) {
                  code.push(0x41, (arm.pattern.value as boolean) ? 1 : 0, 0x46);
                } else {
                  unsupportedMsg = {
                    msg: `Match pattern '${arm.pattern.litKind}' unsupported in direct WASM target`,
                    line: arm.span.line,
                    col: arm.span.column,
                  };
                  break;
                }
                code.push(0x04, WASM_VOID_BLOCK); // if matched
                blockStack.push('other');
                emitStmts(arm.body);
                code.push(0x0c, ...encodeULEB128(1)); // br $match_exit
                code.push(0x0b); // end if
                blockStack.pop();
              } else {
                unsupportedMsg = {
                  msg: `Enum variant pattern matching requires the Manifest VM (.mbc) target`,
                  line: arm.span.line,
                  col: arm.span.column,
                };
                break;
              }
            }
            code.push(0x0b); // end block $match_exit
            blockStack.pop();
            break;
          }
          default:
            unsupportedMsg = {
              msg: `Statement '${s.kind}' requires heap runtime support (use Manifest VM target)`,
              line: s.span.line,
              col: s.span.column,
            };
            break;
        }
      }
    };

    // If `__init__` exists and this is the entry function, call `__init__` first!
    const initWasmIdx = fnIndices.get('__init__');
    if (fn.isEntry && initWasmIdx !== undefined && fn.name !== '__init__') {
      code.push(0x10, ...encodeULEB128(initWasmIdx));
    }

    emitStmts(fn.body);
    if (unsupportedMsg) {
      const errInfo: { msg: string; line: number; col: number } = unsupportedMsg;
      return fail(errInfo.msg, errInfo.line, errInfo.col);
    }

    // Ensure Wasm stack has default value at function fallthrough if function returns a value
    if (retWasmTypes.length === 1) {
      if (retWasmTypes[0] === WASM_I64) code.push(0x42, 0x00);
      else if (retWasmTypes[0] === WASM_F64) code.push(0x44, ...encodeF64LE(0));
      else code.push(0x41, 0x00);
    }
    code.push(0x0b); // end of function

    // Encode locals vector: each local as (1, valtype)
    const localDecls: number[] = [...encodeULEB128(extraLocals.length)];
    for (const lt of extraLocals) {
      localDecls.push(0x01, lt);
    }

    const fullBody = [...localDecls, ...code];
    fnBodies.push([...encodeULEB128(fullBody.length), ...fullBody]);

    const watParams = paramWasmTypes
      .map((t, idx) => `(param $${fn.params[idx].name} ${t === WASM_I64 ? 'i64' : t === WASM_F64 ? 'f64' : 'i32'})`)
      .join(' ');
    const watResult =
      retWasmTypes.length === 1
        ? ` (result ${retWasmTypes[0] === WASM_I64 ? 'i64' : retWasmTypes[0] === WASM_F64 ? 'f64' : 'i32'})`
        : '';
    watLines.push(
      `  (func $${fn.name}${fn.exported || fn.isEntry ? ` (export "${fn.isEntry && fn.name === '__script__' ? 'main' : fn.name}")` : ''} ${watParams}${watResult} ;; ${code.length} bytes of Wasm ops)`
    );
  }
  watLines.push(`)`);

  // Assemble W3C WebAssembly v1.0 Binary
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  // Section 1: Type
  const secTypePayload: number[] = [...encodeULEB128(typeEntries.length)];
  for (const te of typeEntries) secTypePayload.push(...te);
  out.push(...encodeSection(1, secTypePayload));

  // Section 2: Import (env.print_i32, env.print_f64)
  const importsList: number[][] = [
    [...encodeStr('env'), ...encodeStr('print_i32'), 0x00, ...encodeULEB128(0)],
    [...encodeStr('env'), ...encodeStr('print_f64'), 0x00, ...encodeULEB128(1)],
  ];
  const secImportPayload: number[] = [...encodeULEB128(importsList.length)];
  for (const imp of importsList) secImportPayload.push(...imp);
  out.push(...encodeSection(2, secImportPayload));

  // Section 3: Function
  const secFuncPayload: number[] = [...encodeULEB128(fnTypeIndices.length)];
  for (const ti of fnTypeIndices) secFuncPayload.push(...encodeULEB128(ti));
  out.push(...encodeSection(3, secFuncPayload));

  // Section 5: Memory (1 page = 64 KiB)
  out.push(...encodeSection(5, [0x01, 0x00, 0x01]));

  // Section 6: Global
  if (globalValTypes.length > 0) {
    const secGlobPayload: number[] = [...encodeULEB128(globalValTypes.length)];
    for (const gt of globalValTypes) {
      secGlobPayload.push(gt, 0x01); // mutable
      if (gt === WASM_I64) secGlobPayload.push(0x42, 0x00, 0x0b);
      else if (gt === WASM_F64) secGlobPayload.push(0x44, ...encodeF64LE(0), 0x0b);
      else secGlobPayload.push(0x41, 0x00, 0x0b);
    }
    out.push(...encodeSection(6, secGlobPayload));
  }

  // Section 7: Export
  const exportsPayload: number[][] = [[...encodeStr('memory'), 0x02, 0x00]];
  const exportedNames = new Set<string>(['memory']);
  mir.functions.forEach((fn, idx) => {
    const wasmFnIdx = IMPORT_COUNT + idx;
    if (fn.isEntry && !exportedNames.has('main')) {
      exportsPayload.push([...encodeStr('main'), 0x00, ...encodeULEB128(wasmFnIdx)]);
      exportedNames.add('main');
    }
    if ((fn.exported || !fn.isSynthetic) && !exportedNames.has(fn.name)) {
      exportsPayload.push([...encodeStr(fn.name), 0x00, ...encodeULEB128(wasmFnIdx)]);
      exportedNames.add(fn.name);
    }
  });
  const secExport: number[] = [...encodeULEB128(exportsPayload.length)];
  for (const ex of exportsPayload) secExport.push(...ex);
  out.push(...encodeSection(7, secExport));

  // Section 10: Code
  const secCodePayload: number[] = [...encodeULEB128(fnBodies.length)];
  for (const fb of fnBodies) secCodePayload.push(...fb);
  out.push(...encodeSection(10, secCodePayload));

  const wasmBytes = new Uint8Array(out);
  const validated = typeof WebAssembly !== 'undefined' ? WebAssembly.validate(wasmBytes as BufferSource) : true;

  if (!validated) {
    diagnostics.push({
      code: 'E_WASM_VALIDATION_FAILED',
      severity: 'error',
      message: 'Emitted WebAssembly module failed WebAssembly.validate()',
      line: 1,
      column: 1,
    });
    return { success: false, wasmBytes, watText: watLines.join('\n'), validated: false, diagnostics };
  }

  return {
    success: true,
    wasmBytes,
    watText: watLines.join('\n'),
    validated: true,
    diagnostics,
  };
}

function findRelativeDepth(stack: Array<'other' | 'loop_break' | 'loop_cont'>, target: 'loop_break' | 'loop_cont'): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === target) {
      return stack.length - 1 - i;
    }
  }
  return -1;
}

function inferConcreteReturnFromBody(stmts: MIRStmt[]): number | null {
  for (const s of stmts) {
    if (s.kind === 'Return' && s.value) {
      return mapWasmValType(s.value.type);
    }
    if (s.kind === 'If') {
      const t = inferConcreteReturnFromBody(s.thenBranch) ?? inferConcreteReturnFromBody(s.elseBranch);
      if (t !== null) return t;
    }
  }
  return null;
}

import { MIRExpr, MIRFunction, MIRModule, MIRStmt } from '../ir/typed-ir.ts';
import { SemanticType } from '../semantics/types.ts';
import {
  MBC_MAGIC,
  MBC_VERSION_MAJOR,
  MBC_VERSION_MINOR,
  MbcConstant,
  MbcConstKind,
  MbcDebugEntry,
  MbcImportDesc,
  MbcOpcode,
  MbcSectionTag,
} from './mbc-format.ts';

class ByteWriter {
  private buf: number[] = [];

  public get length(): number {
    return this.buf.length;
  }

  public writeU8(v: number): void {
    this.buf.push(v & 0xff);
  }

  public writeU16(v: number): void {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff);
  }

  public writeU32(v: number): void {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }

  public patchU32(offset: number, v: number): void {
    this.buf[offset] = v & 0xff;
    this.buf[offset + 1] = (v >>> 8) & 0xff;
    this.buf[offset + 2] = (v >>> 16) & 0xff;
    this.buf[offset + 3] = (v >>> 24) & 0xff;
  }

  public writeI64(v: bigint): void {
    const tmp = new ArrayBuffer(8);
    new DataView(tmp).setBigInt64(0, v, true);
    const bytes = new Uint8Array(tmp);
    for (let i = 0; i < 8; i++) this.buf.push(bytes[i]);
  }

  public writeF64(v: number): void {
    const tmp = new ArrayBuffer(8);
    new DataView(tmp).setFloat64(0, v, true);
    const bytes = new Uint8Array(tmp);
    for (let i = 0; i < 8; i++) this.buf.push(bytes[i]);
  }

  public writeStr(s: string): void {
    const encoded = new TextEncoder().encode(s);
    this.writeU32(encoded.length);
    for (let i = 0; i < encoded.length; i++) this.buf.push(encoded[i]);
  }

  public writeBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
  }

  public toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

class ConstantPoolBuilder {
  public readonly entries: MbcConstant[] = [];
  private readonly strIndex = new Map<string, number>();
  private readonly i64Index = new Map<bigint, number>();
  private readonly f64Index = new Map<string, number>();
  private readonly boolIndex = new Map<boolean, number>();

  public internStr(s: string): number {
    const found = this.strIndex.get(s);
    if (found !== undefined) return found;
    const idx = this.entries.length;
    this.entries.push({ kind: 'str', value: s });
    this.strIndex.set(s, idx);
    return idx;
  }

  public internI64(v: bigint): number {
    const found = this.i64Index.get(v);
    if (found !== undefined) return found;
    const idx = this.entries.length;
    this.entries.push({ kind: 'i64', value: v });
    this.i64Index.set(v, idx);
    return idx;
  }

  public internF64(v: number): number {
    const key = Object.is(v, -0) ? '-0' : String(v);
    const found = this.f64Index.get(key);
    if (found !== undefined) return found;
    const idx = this.entries.length;
    this.entries.push({ kind: 'f64', value: v });
    this.f64Index.set(key, idx);
    return idx;
  }

  public internBool(v: boolean): number {
    const found = this.boolIndex.get(v);
    if (found !== undefined) return found;
    const idx = this.entries.length;
    this.entries.push({ kind: 'bool', value: v });
    this.boolIndex.set(v, idx);
    return idx;
  }
}

function encodeTypeTag(t: SemanticType): number {
  switch (t.kind) {
    case 'void':
      return 0;
    case 'i64':
      return 1;
    case 'f64':
      return 2;
    case 'bool':
      return 3;
    case 'str':
      return 4;
    case 'array':
      return 5;
    case 'map':
      return 6;
    case 'struct':
      return 7;
    case 'enum':
    case 'result':
      return 8;
    default:
      return 9;
  }
}

interface LoopPatchContext {
  continueTargetOffset: number;
  breakPatchLocations: number[];
}

export interface CompiledMbcResult {
  bytes: Uint8Array;
  moduleName: string;
  functionCount: number;
  constantCount: number;
  importCount: number;
}

/**
 * Compiles a Typed Manifest IR (`MIRModule`) into a binary `.mbc` v1.0 module
 * verifiable and executable by the Rust Manifest Virtual Machine (`mvm`).
 */
export function compileMIRToMbc(mir: MIRModule): CompiledMbcResult {
  const consts = new ConstantPoolBuilder();
  const imports: MbcImportDesc[] = [];
  const importKeyMap = new Map<string, number>();

  const internImport = (
    symbol: string,
    capability: string,
    arity: number,
    hasReturn: boolean
  ): number => {
    const key = `${symbol}|${capability}|${arity}|${hasReturn ? 1 : 0}`;
    const existing = importKeyMap.get(key);
    if (existing !== undefined) return existing;
    const idx = imports.length;
    imports.push({ symbol, capability, arity, hasReturn });
    importKeyMap.set(key, idx);
    // Ensure symbol and capability strings exist in CONST_POOL
    consts.internStr(symbol);
    consts.internStr(capability);
    return idx;
  };

  // Pre-intern struct & enum names in CONST_POOL
  for (const st of mir.structs) {
    consts.internStr(st.name);
    for (const f of st.fields) consts.internStr(f.name);
  }
  for (const en of mir.enums) {
    consts.internStr(en.name);
    for (const v of en.variants) consts.internStr(v.name);
  }

  // Assign deterministic function indices
  const fnIndexMap = new Map<string, number>();
  mir.functions.forEach((fn, idx) => {
    fnIndexMap.set(fn.name, idx);
    consts.internStr(fn.name);
    for (const eff of fn.effects) consts.internStr(eff);
  });

  for (const g of mir.globals) {
    if (g.exported) consts.internStr(g.name);
  }

  const codeSection = new ByteWriter();
  const debugMap: MbcDebugEntry[] = [];
  const compiledFuncs: Array<{
    fn: MIRFunction;
    localCount: number;
    maxStack: number;
    codeOffset: number;
    codeLength: number;
  }> = [];

  for (let fnIdx = 0; fnIdx < mir.functions.length; fnIdx++) {
    const fn = mir.functions[fnIdx];
    const fnCode = new ByteWriter();
    let localCount = Math.max(fn.locals.length, fn.params.length);
    let currentStack = 0;
    let maxStack = 8;
    const patchedJumpTargets = new Set<number>();
    const loopStack: LoopPatchContext[] = [];
    let lastDebugLine = -1;

    const adjustStack = (delta: number): void => {
      currentStack += delta;
      if (currentStack < 0) currentStack = 0;
      if (currentStack > maxStack) maxStack = currentStack;
    };

    const recordDebug = (line: number, column: number): void => {
      if (line > 0 && line !== lastDebugLine) {
        lastDebugLine = line;
        debugMap.push({
          fnIndex: fnIdx,
          codeOffset: fnCode.length,
          line,
          column: Math.max(1, column),
        });
      }
    };

    const emitJumpPlaceholder = (op: MbcOpcode): number => {
      fnCode.writeU8(op);
      if (op === MbcOpcode.JMP_IF_FALSE || op === MbcOpcode.JMP_IF_TRUE) {
        adjustStack(-1);
      }
      const patchAt = fnCode.length;
      fnCode.writeU32(0);
      return patchAt;
    };

    const patchJumpTo = (patchAt: number, targetOffset: number): void => {
      fnCode.patchU32(patchAt, targetOffset);
      patchedJumpTargets.add(targetOffset);
    };

    const allocSyntheticSlot = (): number => {
      const slot = localCount;
      localCount++;
      return slot;
    };

    const emitExpr = (expr: MIRExpr): void => {
      recordDebug(expr.span.line, expr.span.column);
      switch (expr.kind) {
        case 'ConstInt': {
          const idx = consts.internI64(expr.value);
          fnCode.writeU8(MbcOpcode.CONST);
          fnCode.writeU32(idx);
          adjustStack(1);
          break;
        }
        case 'ConstFloat': {
          const idx = consts.internF64(expr.value);
          fnCode.writeU8(MbcOpcode.CONST);
          fnCode.writeU32(idx);
          adjustStack(1);
          break;
        }
        case 'ConstBool': {
          const idx = consts.internBool(expr.value);
          fnCode.writeU8(MbcOpcode.CONST);
          fnCode.writeU32(idx);
          adjustStack(1);
          break;
        }
        case 'ConstStr': {
          const idx = consts.internStr(expr.value);
          fnCode.writeU8(MbcOpcode.CONST);
          fnCode.writeU32(idx);
          adjustStack(1);
          break;
        }
        case 'ConstVoid': {
          fnCode.writeU8(MbcOpcode.PUSH_VOID);
          adjustStack(1);
          break;
        }
        case 'LoadLocal': {
          fnCode.writeU8(MbcOpcode.LOAD_LOCAL);
          fnCode.writeU16(expr.slot);
          adjustStack(1);
          break;
        }
        case 'LoadGlobal': {
          fnCode.writeU8(MbcOpcode.LOAD_GLOBAL);
          fnCode.writeU32(expr.slot);
          adjustStack(1);
          break;
        }
        case 'Unary': {
          emitExpr(expr.operand);
          if (expr.op === '-') {
            fnCode.writeU8(
              expr.operand.type.kind === 'f64' ? MbcOpcode.NEG_F64 : MbcOpcode.NEG_I64
            );
          } else {
            fnCode.writeU8(MbcOpcode.NOT);
          }
          break;
        }
        case 'Cast': {
          emitExpr(expr.operand);
          if (expr.castKind === 'i64_to_f64') fnCode.writeU8(MbcOpcode.I64_TO_F64);
          else if (expr.castKind === 'f64_to_i64') fnCode.writeU8(MbcOpcode.F64_TO_I64);
          else fnCode.writeU8(MbcOpcode.TO_STR);
          break;
        }
        case 'Binary': {
          // Short-circuit boolean operators with balanced stack height at merge!
          if (expr.op === '&&') {
            const baseH = currentStack;
            emitExpr(expr.left);
            const jumpFalse = emitJumpPlaceholder(MbcOpcode.JMP_IF_FALSE);
            currentStack = baseH;
            emitExpr(expr.right);
            const jumpEnd = emitJumpPlaceholder(MbcOpcode.JMP);
            const falseOffset = fnCode.length;
            patchJumpTo(jumpFalse, falseOffset);
            currentStack = baseH;
            const falseConst = consts.internBool(false);
            fnCode.writeU8(MbcOpcode.CONST);
            fnCode.writeU32(falseConst);
            adjustStack(1);
            const endOffset = fnCode.length;
            patchJumpTo(jumpEnd, endOffset);
            currentStack = baseH + 1;
            break;
          }

          if (expr.op === '||') {
            const baseH = currentStack;
            emitExpr(expr.left);
            const jumpTrue = emitJumpPlaceholder(MbcOpcode.JMP_IF_TRUE);
            currentStack = baseH;
            emitExpr(expr.right);
            const jumpEnd = emitJumpPlaceholder(MbcOpcode.JMP);
            const trueOffset = fnCode.length;
            patchJumpTo(jumpTrue, trueOffset);
            currentStack = baseH;
            const trueConst = consts.internBool(true);
            fnCode.writeU8(MbcOpcode.CONST);
            fnCode.writeU32(trueConst);
            adjustStack(1);
            const endOffset = fnCode.length;
            patchJumpTo(jumpEnd, endOffset);
            currentStack = baseH + 1;
            break;
          }

          emitExpr(expr.left);
          emitExpr(expr.right);
          const isFloat = expr.left.type.kind === 'f64' || expr.right.type.kind === 'f64';
          const isStrConcat =
            expr.op === '+' &&
            (expr.type.kind === 'str' ||
              expr.left.type.kind === 'str' ||
              expr.right.type.kind === 'str');

          if (isStrConcat) {
            fnCode.writeU8(MbcOpcode.CONCAT_STR);
          } else {
            switch (expr.op) {
              case '+':
                fnCode.writeU8(isFloat ? MbcOpcode.ADD_F64 : MbcOpcode.ADD_I64);
                break;
              case '-':
                fnCode.writeU8(isFloat ? MbcOpcode.SUB_F64 : MbcOpcode.SUB_I64);
                break;
              case '*':
                fnCode.writeU8(isFloat ? MbcOpcode.MUL_F64 : MbcOpcode.MUL_I64);
                break;
              case '/':
                fnCode.writeU8(isFloat ? MbcOpcode.DIV_F64 : MbcOpcode.DIV_I64);
                break;
              case '%':
                fnCode.writeU8(MbcOpcode.MOD_I64);
                break;
              case '==':
                fnCode.writeU8(MbcOpcode.EQ);
                break;
              case '!=':
                fnCode.writeU8(MbcOpcode.NEQ);
                break;
              case '<':
                fnCode.writeU8(MbcOpcode.LT);
                break;
              case '<=':
                fnCode.writeU8(MbcOpcode.LTE);
                break;
              case '>':
                fnCode.writeU8(MbcOpcode.GT);
                break;
              case '>=':
                fnCode.writeU8(MbcOpcode.GTE);
                break;
            }
          }
          adjustStack(-1); // popped 2, pushed 1
          break;
        }
        case 'CallFunction': {
          for (const a of expr.args) emitExpr(a);
          const targetIdx = fnIndexMap.get(expr.callee) ?? 0;
          fnCode.writeU8(MbcOpcode.CALL);
          fnCode.writeU32(targetIdx);
          adjustStack(-expr.args.length + 1); // CALL always pushes 1 value (ret or Void)
          break;
        }
        case 'CallIntrinsic': {
          for (const a of expr.args) emitExpr(a);
          const hasReturn = expr.type.kind !== 'void';
          const impIdx = internImport(expr.symbol, expr.capability, expr.args.length, hasReturn);
          fnCode.writeU8(MbcOpcode.HOST_CALL);
          fnCode.writeU32(impIdx);
          adjustStack(-expr.args.length + 1); // HOST_CALL always pushes 1 value (res or Void)
          break;
        }
        case 'ArrayNew': {
          for (const e of expr.elements) emitExpr(e);
          fnCode.writeU8(MbcOpcode.ARRAY_NEW);
          fnCode.writeU32(expr.elements.length);
          adjustStack(-expr.elements.length + 1);
          break;
        }
        case 'ArrayGet': {
          emitExpr(expr.array);
          emitExpr(expr.index);
          fnCode.writeU8(MbcOpcode.ARRAY_GET);
          adjustStack(-1);
          break;
        }
        case 'ArrayLen': {
          emitExpr(expr.target);
          fnCode.writeU8(MbcOpcode.ARRAY_LEN);
          break;
        }
        case 'ArrayPush': {
          emitExpr(expr.array);
          emitExpr(expr.value);
          fnCode.writeU8(MbcOpcode.ARRAY_PUSH);
          adjustStack(-1); // pops 2, pushes 1 (Void)
          break;
        }
        case 'MapNew': {
          for (const e of expr.entries) {
            emitExpr(e.key);
            emitExpr(e.value);
          }
          fnCode.writeU8(MbcOpcode.MAP_NEW);
          fnCode.writeU32(expr.entries.length);
          adjustStack(-(expr.entries.length * 2) + 1);
          break;
        }
        case 'MapGet': {
          emitExpr(expr.map);
          emitExpr(expr.key);
          fnCode.writeU8(MbcOpcode.MAP_GET);
          adjustStack(-1);
          break;
        }
        case 'MapSet': {
          emitExpr(expr.map);
          emitExpr(expr.key);
          emitExpr(expr.value);
          fnCode.writeU8(MbcOpcode.MAP_SET);
          adjustStack(-2); // pops 3, pushes 1 (Void)
          break;
        }
        case 'MapHas': {
          emitExpr(expr.map);
          emitExpr(expr.key);
          fnCode.writeU8(MbcOpcode.MAP_HAS);
          adjustStack(-1);
          break;
        }
        case 'StructNew': {
          for (const f of expr.fields) emitExpr(f);
          fnCode.writeU8(MbcOpcode.STRUCT_NEW);
          fnCode.writeU32(expr.structIndex);
          adjustStack(-expr.fields.length + 1);
          break;
        }
        case 'FieldGet': {
          emitExpr(expr.object);
          fnCode.writeU8(MbcOpcode.FIELD_GET);
          fnCode.writeU16(expr.fieldIndex);
          break;
        }
        case 'EnumNew': {
          for (const a of expr.args) emitExpr(a);
          fnCode.writeU8(MbcOpcode.ENUM_NEW);
          fnCode.writeU32(expr.enumIndex);
          fnCode.writeU16(expr.variantTag);
          adjustStack(-expr.args.length + 1);
          break;
        }
        case 'TryPropagate': {
          const baseH = currentStack;
          const tmpSlot = allocSyntheticSlot();
          emitExpr(expr.operand);
          fnCode.writeU8(MbcOpcode.STORE_LOCAL);
          fnCode.writeU16(tmpSlot);
          adjustStack(-1);

          fnCode.writeU8(MbcOpcode.LOAD_LOCAL);
          fnCode.writeU16(tmpSlot);
          adjustStack(1);
          fnCode.writeU8(MbcOpcode.ENUM_TAG);
          const errTagIdx = consts.internI64(1n);
          fnCode.writeU8(MbcOpcode.CONST);
          fnCode.writeU32(errTagIdx);
          adjustStack(1);
          fnCode.writeU8(MbcOpcode.EQ);
          adjustStack(-1);

          const jumpOk = emitJumpPlaceholder(MbcOpcode.JMP_IF_FALSE);
          // Err path: return Err(payload) immediately
          fnCode.writeU8(MbcOpcode.LOAD_LOCAL);
          fnCode.writeU16(tmpSlot);
          adjustStack(1);
          fnCode.writeU8(MbcOpcode.RET);
          adjustStack(-1);

          const okOffset = fnCode.length;
          patchJumpTo(jumpOk, okOffset);
          currentStack = baseH;
          fnCode.writeU8(MbcOpcode.LOAD_LOCAL);
          fnCode.writeU16(tmpSlot);
          adjustStack(1);
          fnCode.writeU8(MbcOpcode.ENUM_PAYLOAD);
          fnCode.writeU16(0);
          currentStack = baseH + 1;
          break;
        }
      }
    };

    const emitBlock = (stmts: MIRStmt[]): boolean => {
      let terminated = false;
      for (const stmt of stmts) {
        if (terminated) break;
        terminated = emitStmt(stmt);
      }
      return terminated;
    };

    const emitStmt = (stmt: MIRStmt): boolean => {
      recordDebug(stmt.span.line, stmt.span.column);
      switch (stmt.kind) {
        case 'StoreLocal': {
          emitExpr(stmt.value);
          fnCode.writeU8(MbcOpcode.STORE_LOCAL);
          fnCode.writeU16(stmt.slot);
          adjustStack(-1);
          return false;
        }
        case 'StoreGlobal': {
          emitExpr(stmt.value);
          fnCode.writeU8(MbcOpcode.STORE_GLOBAL);
          fnCode.writeU32(stmt.slot);
          adjustStack(-1);
          return false;
        }
        case 'ArraySet': {
          emitExpr(stmt.array);
          emitExpr(stmt.index);
          emitExpr(stmt.value);
          fnCode.writeU8(MbcOpcode.ARRAY_SET);
          adjustStack(-3);
          return false;
        }
        case 'MapSetStmt': {
          emitExpr(stmt.map);
          emitExpr(stmt.key);
          emitExpr(stmt.value);
          fnCode.writeU8(MbcOpcode.MAP_SET);
          adjustStack(-2); // MAP_SET pushes Void
          fnCode.writeU8(MbcOpcode.POP);
          adjustStack(-1);
          return false;
        }
        case 'FieldSet': {
          emitExpr(stmt.object);
          emitExpr(stmt.value);
          fnCode.writeU8(MbcOpcode.FIELD_SET);
          fnCode.writeU16(stmt.fieldIndex);
          adjustStack(-2);
          return false;
        }
        case 'ExprStmt': {
          emitExpr(stmt.expr);
          fnCode.writeU8(MbcOpcode.POP);
          adjustStack(-1);
          return false;
        }
        case 'If': {
          emitExpr(stmt.condition);
          const jumpElse = emitJumpPlaceholder(MbcOpcode.JMP_IF_FALSE);
          const savedStack = currentStack;
          const thenTerm = emitBlock(stmt.thenBranch);

          if (stmt.elseBranch.length > 0) {
            const jumpEnd = !thenTerm ? emitJumpPlaceholder(MbcOpcode.JMP) : -1;
            const elseOffset = fnCode.length;
            patchJumpTo(jumpElse, elseOffset);
            currentStack = savedStack;
            const elseTerm = emitBlock(stmt.elseBranch);
            const endOffset = fnCode.length;
            if (jumpEnd >= 0) patchJumpTo(jumpEnd, endOffset);
            currentStack = savedStack;
            return thenTerm && elseTerm;
          } else {
            const endOffset = fnCode.length;
            patchJumpTo(jumpElse, endOffset);
            currentStack = savedStack;
            return false;
          }
        }
        case 'While': {
          const loopStart = fnCode.length;
          patchedJumpTargets.add(loopStart);
          const savedStack = currentStack;

          emitExpr(stmt.condition);
          const jumpExit = emitJumpPlaceholder(MbcOpcode.JMP_IF_FALSE);

          const loopCtx: LoopPatchContext = {
            continueTargetOffset: loopStart,
            breakPatchLocations: [],
          };
          loopStack.push(loopCtx);
          const bodyTerm = emitBlock(stmt.body);
          loopStack.pop();

          if (!bodyTerm) {
            const jmpBack = emitJumpPlaceholder(MbcOpcode.JMP);
            patchJumpTo(jmpBack, loopStart);
          }

          const exitOffset = fnCode.length;
          patchJumpTo(jumpExit, exitOffset);
          for (const bPatch of loopCtx.breakPatchLocations) {
            patchJumpTo(bPatch, exitOffset);
          }
          currentStack = savedStack;
          return false;
        }
        case 'Break': {
          const loopCtx = loopStack[loopStack.length - 1];
          if (loopCtx) {
            const p = emitJumpPlaceholder(MbcOpcode.JMP);
            loopCtx.breakPatchLocations.push(p);
          }
          return true;
        }
        case 'Continue': {
          const loopCtx = loopStack[loopStack.length - 1];
          if (loopCtx) {
            const p = emitJumpPlaceholder(MbcOpcode.JMP);
            patchJumpTo(p, loopCtx.continueTargetOffset);
          }
          return true;
        }
        case 'Return': {
          if (stmt.value) {
            emitExpr(stmt.value);
            fnCode.writeU8(MbcOpcode.RET);
            adjustStack(-1);
          } else {
            fnCode.writeU8(MbcOpcode.RET_VOID);
          }
          return true;
        }
        case 'Match': {
          const savedStack = currentStack;
          emitExpr(stmt.subject);
          fnCode.writeU8(MbcOpcode.STORE_LOCAL);
          fnCode.writeU16(stmt.tempSlot);
          adjustStack(-1);

          const endJumps: number[] = [];
          let allArmsTerminated = stmt.arms.length > 0;
          let hasWildcard = false;

          for (const arm of stmt.arms) {
            currentStack = savedStack;
            let jumpNextArm = -1;

            if (arm.pattern.kind === 'Wildcard') {
              hasWildcard = true;
            } else if (arm.pattern.kind === 'Literal') {
              fnCode.writeU8(MbcOpcode.LOAD_LOCAL);
              fnCode.writeU16(stmt.tempSlot);
              adjustStack(1);
              let cIdx = 0;
              if (arm.pattern.litKind === 'i64') cIdx = consts.internI64(arm.pattern.value as bigint);
              else if (arm.pattern.litKind === 'f64') cIdx = consts.internF64(arm.pattern.value as number);
              else if (arm.pattern.litKind === 'bool') cIdx = consts.internBool(arm.pattern.value as boolean);
              else cIdx = consts.internStr(arm.pattern.value as string);
              fnCode.writeU8(MbcOpcode.CONST);
              fnCode.writeU32(cIdx);
              adjustStack(1);
              fnCode.writeU8(MbcOpcode.EQ);
              adjustStack(-1);
              jumpNextArm = emitJumpPlaceholder(MbcOpcode.JMP_IF_FALSE);
            } else if (arm.pattern.kind === 'EnumVariant') {
              fnCode.writeU8(MbcOpcode.LOAD_LOCAL);
              fnCode.writeU16(stmt.tempSlot);
              adjustStack(1);
              fnCode.writeU8(MbcOpcode.ENUM_TAG);
              const tagIdx = consts.internI64(BigInt(arm.pattern.variantTag));
              fnCode.writeU8(MbcOpcode.CONST);
              fnCode.writeU32(tagIdx);
              adjustStack(1);
              fnCode.writeU8(MbcOpcode.EQ);
              adjustStack(-1);
              jumpNextArm = emitJumpPlaceholder(MbcOpcode.JMP_IF_FALSE);

              for (let i = 0; i < arm.pattern.bindingSlots.length; i++) {
                fnCode.writeU8(MbcOpcode.LOAD_LOCAL);
                fnCode.writeU16(stmt.tempSlot);
                adjustStack(1);
                fnCode.writeU8(MbcOpcode.ENUM_PAYLOAD);
                fnCode.writeU16(i);
                fnCode.writeU8(MbcOpcode.STORE_LOCAL);
                fnCode.writeU16(arm.pattern.bindingSlots[i].slot);
                adjustStack(-1);
              }
            }

            const armTerm = emitBlock(arm.body);
            if (!armTerm) {
              allArmsTerminated = false;
              endJumps.push(emitJumpPlaceholder(MbcOpcode.JMP));
            }

            if (jumpNextArm >= 0) {
              const nextArmOff = fnCode.length;
              patchJumpTo(jumpNextArm, nextArmOff);
            }

            if (arm.pattern.kind === 'Wildcard') {
              break;
            }
          }

          const matchEndOff = fnCode.length;
          for (const ej of endJumps) {
            patchJumpTo(ej, matchEndOff);
          }
          currentStack = savedStack;
          return hasWildcard && allArmsTerminated;
        }
      }
    };

    const bodyTerminated = emitBlock(fn.body);
    // Guarantee non-empty instruction stream AND guarantee any branch targeting end-of-stream lands on a valid terminator
    if (!bodyTerminated || fnCode.length === 0 || patchedJumpTargets.has(fnCode.length)) {
      if (fn.returnType.kind === 'i64') {
        const z = consts.internI64(0n);
        fnCode.writeU8(MbcOpcode.CONST);
        fnCode.writeU32(z);
        fnCode.writeU8(MbcOpcode.RET);
      } else if (fn.returnType.kind === 'f64') {
        const z = consts.internF64(0.0);
        fnCode.writeU8(MbcOpcode.CONST);
        fnCode.writeU32(z);
        fnCode.writeU8(MbcOpcode.RET);
      } else if (fn.returnType.kind === 'bool') {
        const z = consts.internBool(false);
        fnCode.writeU8(MbcOpcode.CONST);
        fnCode.writeU32(z);
        fnCode.writeU8(MbcOpcode.RET);
      } else if (fn.returnType.kind === 'str') {
        const z = consts.internStr('');
        fnCode.writeU8(MbcOpcode.CONST);
        fnCode.writeU32(z);
        fnCode.writeU8(MbcOpcode.RET);
      } else {
        fnCode.writeU8(MbcOpcode.RET_VOID);
      }
      if (maxStack < 2) maxStack = 2;
    }

    const fnBytes = fnCode.toUint8Array();
    const codeOffset = codeSection.length;
    codeSection.writeBytes(fnBytes);

    compiledFuncs.push({
      fn,
      localCount,
      maxStack: Math.max(maxStack + 4, 8),
      codeOffset,
      codeLength: fnBytes.length,
    });
  }

  // Build individual sections matching mvm-core/src/decoder.rs byte-for-byte
  const secMeta = new ByteWriter();
  secMeta.writeStr(mir.moduleName || 'main');
  secMeta.writeU16(mir.requires.length);
  for (const r of mir.requires) secMeta.writeStr(r);
  secMeta.writeU16(mir.provides.length);
  for (const p of mir.provides) secMeta.writeStr(p);
  secMeta.writeU16(mir.denies.length);
  for (const d of mir.denies) secMeta.writeStr(d);

  const secConsts = new ByteWriter();
  secConsts.writeU32(consts.entries.length);
  for (const c of consts.entries) {
    switch (c.kind) {
      case 'i64':
        secConsts.writeU8(MbcConstKind.I64);
        secConsts.writeI64(c.value);
        break;
      case 'f64':
        secConsts.writeU8(MbcConstKind.F64);
        secConsts.writeF64(c.value);
        break;
      case 'bool':
        secConsts.writeU8(MbcConstKind.BOOL);
        secConsts.writeU8(c.value ? 1 : 0);
        break;
      case 'str':
        secConsts.writeU8(MbcConstKind.STR);
        secConsts.writeStr(c.value);
        break;
    }
  }

  const secTypes = new ByteWriter();
  secTypes.writeU32(mir.structs.length);
  for (const st of mir.structs) {
    secTypes.writeU32(consts.internStr(st.name));
    secTypes.writeU16(st.fields.length);
    for (const f of st.fields) {
      secTypes.writeU32(consts.internStr(f.name));
      secTypes.writeU8(encodeTypeTag(f.type));
    }
  }
  secTypes.writeU32(mir.enums.length);
  for (const en of mir.enums) {
    secTypes.writeU32(consts.internStr(en.name));
    secTypes.writeU16(en.variants.length);
    for (const v of en.variants) {
      secTypes.writeU32(consts.internStr(v.name));
      secTypes.writeU16(v.payloadTypes.length);
    }
  }

  const secImports = new ByteWriter();
  secImports.writeU32(imports.length);
  for (const imp of imports) {
    secImports.writeU32(consts.internStr(imp.symbol));
    secImports.writeU32(consts.internStr(imp.capability));
    secImports.writeU16(imp.arity);
    secImports.writeU8(imp.hasReturn ? 1 : 0);
  }

  const secExports = new ByteWriter();
  const exportItems: Array<{ name: string; kind: number; targetIdx: number }> = [];
  compiledFuncs.forEach((cf, idx) => {
    if (cf.fn.exported) {
      exportItems.push({ name: cf.fn.name, kind: 0, targetIdx: idx });
    }
  });
  mir.globals.forEach((g) => {
    if (g.exported) {
      exportItems.push({ name: g.name, kind: 1, targetIdx: g.slot });
    }
  });
  secExports.writeU32(exportItems.length);
  for (const ex of exportItems) {
    secExports.writeU32(consts.internStr(ex.name));
    secExports.writeU8(ex.kind);
    secExports.writeU32(ex.targetIdx);
  }

  const secFuncs = new ByteWriter();
  secFuncs.writeU32(mir.globals.length);
  const entryIdx = mir.entryFunction ? (fnIndexMap.get(mir.entryFunction) ?? 0xffffffff) : 0xffffffff;
  secFuncs.writeU32(entryIdx);
  secFuncs.writeU32(compiledFuncs.length);
  for (const cf of compiledFuncs) {
    secFuncs.writeU32(consts.internStr(cf.fn.name));
    secFuncs.writeU16(cf.fn.params.length);
    secFuncs.writeU16(cf.localCount);
    secFuncs.writeU16(cf.maxStack);
    secFuncs.writeU8(cf.fn.returnType.kind !== 'void' ? 1 : 0);
    secFuncs.writeU16(cf.fn.effects.length);
    for (const eff of cf.fn.effects) {
      secFuncs.writeU32(consts.internStr(eff));
    }
    secFuncs.writeU32(cf.codeOffset);
    secFuncs.writeU32(cf.codeLength);
  }

  const secDebug = new ByteWriter();
  secDebug.writeU32(debugMap.length);
  for (const dm of debugMap) {
    secDebug.writeU32(dm.fnIndex);
    secDebug.writeU32(dm.codeOffset);
    secDebug.writeU32(dm.line);
    secDebug.writeU32(dm.column);
  }

  // Note: Re-serialize secConsts after all internStr calls above so CONST_POOL is 100% complete!
  const finalSecConsts = new ByteWriter();
  finalSecConsts.writeU32(consts.entries.length);
  for (const c of consts.entries) {
    switch (c.kind) {
      case 'i64':
        finalSecConsts.writeU8(MbcConstKind.I64);
        finalSecConsts.writeI64(c.value);
        break;
      case 'f64':
        finalSecConsts.writeU8(MbcConstKind.F64);
        finalSecConsts.writeF64(c.value);
        break;
      case 'bool':
        finalSecConsts.writeU8(MbcConstKind.BOOL);
        finalSecConsts.writeU8(c.value ? 1 : 0);
        break;
      case 'str':
        finalSecConsts.writeU8(MbcConstKind.STR);
        finalSecConsts.writeStr(c.value);
        break;
    }
  }

  const sections: Array<{ tag: MbcSectionTag; payload: Uint8Array }> = [
    { tag: MbcSectionTag.MODULE_META, payload: secMeta.toUint8Array() },
    { tag: MbcSectionTag.CONST_POOL, payload: finalSecConsts.toUint8Array() },
    { tag: MbcSectionTag.TYPE_TABLE, payload: secTypes.toUint8Array() },
    { tag: MbcSectionTag.IMPORT_TABLE, payload: secImports.toUint8Array() },
    { tag: MbcSectionTag.EXPORT_TABLE, payload: secExports.toUint8Array() },
    { tag: MbcSectionTag.FUNC_TABLE, payload: secFuncs.toUint8Array() },
    { tag: MbcSectionTag.CODE, payload: codeSection.toUint8Array() },
    { tag: MbcSectionTag.DEBUG_MAP, payload: secDebug.toUint8Array() },
  ];

  const container = new ByteWriter();
  container.writeBytes(MBC_MAGIC);
  container.writeU16(MBC_VERSION_MAJOR);
  container.writeU16(MBC_VERSION_MINOR);
  container.writeU32(0); // flags
  container.writeU32(sections.length);

  let currentOffset = 16 + sections.length * 12;
  for (const sec of sections) {
    container.writeU32(sec.tag);
    container.writeU32(currentOffset);
    container.writeU32(sec.payload.length);
    currentOffset += sec.payload.length;
  }

  for (const sec of sections) {
    container.writeBytes(sec.payload);
  }

  return {
    bytes: container.toUint8Array(),
    moduleName: mir.moduleName || 'main',
    functionCount: compiledFuncs.length,
    constantCount: consts.entries.length,
    importCount: imports.length,
  };
}

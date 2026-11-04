import {
  DecodedMbcInstruction,
  DecodedMbcModule,
  MBC_MAGIC,
  MBC_VERSION_MAJOR,
  MBC_VERSION_MINOR,
  MbcConstant,
  MbcConstKind,
  MbcDebugEntry,
  MbcEnumDesc,
  MbcExportDesc,
  MbcFunctionDesc,
  MbcImportDesc,
  MbcOpcode,
  MbcSectionTag,
  MbcStructDesc,
} from './mbc-format.ts';

class ByteReader {
  private pos = 0;
  private dv: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public get offset(): number {
    return this.pos;
  }

  public get remaining(): number {
    return Math.max(0, this.bytes.length - this.pos);
  }

  public readU8(ctx: string): number {
    if (this.remaining < 1) throw new Error(`Truncated .mbc container while reading ${ctx}`);
    const v = this.dv.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  public readU16(ctx: string): number {
    if (this.remaining < 2) throw new Error(`Truncated .mbc container while reading ${ctx}`);
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  public readU32(ctx: string): number {
    if (this.remaining < 4) throw new Error(`Truncated .mbc container while reading ${ctx}`);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  public readI64(ctx: string): bigint {
    if (this.remaining < 8) throw new Error(`Truncated .mbc container while reading ${ctx}`);
    const v = this.dv.getBigInt64(this.pos, true);
    this.pos += 8;
    return v;
  }

  public readF64(ctx: string): number {
    if (this.remaining < 8) throw new Error(`Truncated .mbc container while reading ${ctx}`);
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  public readStr(ctx: string): string {
    const len = this.readU32(`${ctx} length`);
    if (this.remaining < len) {
      throw new Error(`Truncated .mbc container while reading ${ctx} (${len} bytes)`);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder('utf-8', { fatal: true }).decode(slice);
  }
}

export function decodeMbcInstructions(
  code: Uint8Array,
  fnName: string
): DecodedMbcInstruction[] {
  const r = new ByteReader(code);
  const out: DecodedMbcInstruction[] = [];

  while (r.remaining > 0) {
    const offset = r.offset;
    const op = r.readU8('opcode') as MbcOpcode;
    let mnemonic = MbcOpcode[op] || `UNKNOWN_0x${op.toString(16)}`;
    const operands: number[] = [];

    switch (op) {
      case MbcOpcode.NOP:
      case MbcOpcode.PUSH_VOID:
      case MbcOpcode.POP:
      case MbcOpcode.DUP:
      case MbcOpcode.ADD_I64:
      case MbcOpcode.SUB_I64:
      case MbcOpcode.MUL_I64:
      case MbcOpcode.DIV_I64:
      case MbcOpcode.MOD_I64:
      case MbcOpcode.NEG_I64:
      case MbcOpcode.ADD_F64:
      case MbcOpcode.SUB_F64:
      case MbcOpcode.MUL_F64:
      case MbcOpcode.DIV_F64:
      case MbcOpcode.NEG_F64:
      case MbcOpcode.CONCAT_STR:
      case MbcOpcode.I64_TO_F64:
      case MbcOpcode.F64_TO_I64:
      case MbcOpcode.TO_STR:
      case MbcOpcode.EQ:
      case MbcOpcode.NEQ:
      case MbcOpcode.LT:
      case MbcOpcode.LTE:
      case MbcOpcode.GT:
      case MbcOpcode.GTE:
      case MbcOpcode.NOT:
      case MbcOpcode.BOOL_AND:
      case MbcOpcode.BOOL_OR:
      case MbcOpcode.RET:
      case MbcOpcode.RET_VOID:
      case MbcOpcode.ARRAY_GET:
      case MbcOpcode.ARRAY_SET:
      case MbcOpcode.ARRAY_LEN:
      case MbcOpcode.ARRAY_PUSH:
      case MbcOpcode.MAP_GET:
      case MbcOpcode.MAP_SET:
      case MbcOpcode.MAP_HAS:
      case MbcOpcode.ENUM_TAG:
      case MbcOpcode.HALT:
        break;

      case MbcOpcode.LOAD_LOCAL:
      case MbcOpcode.STORE_LOCAL:
      case MbcOpcode.FIELD_GET:
      case MbcOpcode.FIELD_SET:
      case MbcOpcode.ENUM_PAYLOAD:
        operands.push(r.readU16(`${mnemonic} u16`));
        break;

      case MbcOpcode.CONST:
      case MbcOpcode.LOAD_GLOBAL:
      case MbcOpcode.STORE_GLOBAL:
      case MbcOpcode.JMP:
      case MbcOpcode.JMP_IF_FALSE:
      case MbcOpcode.JMP_IF_TRUE:
      case MbcOpcode.CALL:
      case MbcOpcode.HOST_CALL:
      case MbcOpcode.ARRAY_NEW:
      case MbcOpcode.MAP_NEW:
      case MbcOpcode.STRUCT_NEW:
      case MbcOpcode.TRAP:
        operands.push(r.readU32(`${mnemonic} u32`));
        break;

      case MbcOpcode.ENUM_NEW:
        operands.push(r.readU32('ENUM_NEW enum_idx'));
        operands.push(r.readU16('ENUM_NEW variant_idx'));
        break;

      default:
        throw new Error(
          `Bytecode verification failed in '${fnName}' at 0x${offset.toString(16).padStart(4, '0')}: Unknown opcode 0x${(op as number).toString(16)}`
        );
    }

    mnemonic = MbcOpcode[op];
    out.push({
      offset,
      length: r.offset - offset,
      opcode: op,
      mnemonic,
      operands,
    });
  }

  return out;
}

export function decodeMbcContainer(bytes: Uint8Array): DecodedMbcModule {
  if (bytes.length < 16) {
    throw new Error('Truncated .mbc file: smaller than 16-byte header');
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MBC_MAGIC[i]) {
      throw new Error('Invalid .mbc magic header (expected MBC\\0)');
    }
  }

  const hdr = new ByteReader(bytes.subarray(4));
  const majorVersion = hdr.readU16('major_version');
  const minorVersion = hdr.readU16('minor_version');
  if (majorVersion !== MBC_VERSION_MAJOR || minorVersion > MBC_VERSION_MINOR) {
    throw new Error(`Unsupported .mbc version ${majorVersion}.${minorVersion}`);
  }
  const flags = hdr.readU32('flags');
  const sectionCount = hdr.readU32('section_count');
  if (sectionCount > 64) {
    throw new Error(`Malformed .mbc directory: excessive section count ${sectionCount}`);
  }

  const directory: Array<{ tag: number; slice: Uint8Array }> = [];
  for (let i = 0; i < sectionCount; i++) {
    const tag = hdr.readU32('section_tag');
    const offset = hdr.readU32('section_offset');
    const length = hdr.readU32('section_length');
    if (offset + length > bytes.length) {
      throw new Error(
        `Truncated .mbc section 0x${tag.toString(16)}: range ${offset}..${offset + length} exceeds ${bytes.length}`
      );
    }
    directory.push({ tag, slice: bytes.subarray(offset, offset + length) });
  }

  let moduleName = 'main';
  const requires: string[] = [];
  const provides: string[] = [];
  const denies: string[] = [];
  const constants: MbcConstant[] = [];
  const structsRaw: Array<{ nameIdx: number; fields: Array<{ nameIdx: number; typeTag: number }> }> = [];
  const enumsRaw: Array<{ nameIdx: number; variants: Array<{ nameIdx: number; arity: number }> }> = [];
  const importsRaw: Array<{ symIdx: number; capIdx: number; arity: number; hasReturn: boolean }> = [];
  const exportsRaw: Array<{ nameIdx: number; kind: number; targetIdx: number }> = [];
  let globalCount = 0;
  let entryFnIndex: number | null = null;
  const funcsRaw: Array<{
    nameIdx: number;
    paramCount: number;
    localCount: number;
    maxStack: number;
    hasReturn: boolean;
    effIndices: number[];
    codeOffset: number;
    codeLength: number;
  }> = [];
  let codeBytes = new Uint8Array(0);
  const debugMap: MbcDebugEntry[] = [];

  for (const { tag, slice } of directory) {
    const sc = new ByteReader(slice);
    switch (tag) {
      case MbcSectionTag.MODULE_META: {
        moduleName = sc.readStr('module_name');
        const reqLen = sc.readU16('requires_count');
        for (let i = 0; i < reqLen; i++) requires.push(sc.readStr('requires_item'));
        const provLen = sc.readU16('provides_count');
        for (let i = 0; i < provLen; i++) provides.push(sc.readStr('provides_item'));
        const denyLen = sc.readU16('denies_count');
        for (let i = 0; i < denyLen; i++) denies.push(sc.readStr('denies_item'));
        break;
      }
      case MbcSectionTag.CONST_POOL: {
        const count = sc.readU32('const_count');
        for (let i = 0; i < count; i++) {
          const kind = sc.readU8('const_kind');
          if (kind === MbcConstKind.I64) constants.push({ kind: 'i64', value: sc.readI64('i64') });
          else if (kind === MbcConstKind.F64) constants.push({ kind: 'f64', value: sc.readF64('f64') });
          else if (kind === MbcConstKind.BOOL)
            constants.push({ kind: 'bool', value: sc.readU8('bool') !== 0 });
          else if (kind === MbcConstKind.STR) constants.push({ kind: 'str', value: sc.readStr('str') });
          else throw new Error(`Unknown constant tag 0x${kind.toString(16)}`);
        }
        break;
      }
      case MbcSectionTag.TYPE_TABLE: {
        const stCount = sc.readU32('struct_count');
        for (let i = 0; i < stCount; i++) {
          const nameIdx = sc.readU32('struct_name');
          const fCount = sc.readU16('field_count');
          const fields: Array<{ nameIdx: number; typeTag: number }> = [];
          for (let j = 0; j < fCount; j++) {
            fields.push({ nameIdx: sc.readU32('field_name'), typeTag: sc.readU8('field_type') });
          }
          structsRaw.push({ nameIdx, fields });
        }
        const enCount = sc.readU32('enum_count');
        for (let i = 0; i < enCount; i++) {
          const nameIdx = sc.readU32('enum_name');
          const vCount = sc.readU16('variant_count');
          const variants: Array<{ nameIdx: number; arity: number }> = [];
          for (let j = 0; j < vCount; j++) {
            variants.push({ nameIdx: sc.readU32('variant_name'), arity: sc.readU16('arity') });
          }
          enumsRaw.push({ nameIdx, variants });
        }
        break;
      }
      case MbcSectionTag.IMPORT_TABLE: {
        const count = sc.readU32('import_count');
        for (let i = 0; i < count; i++) {
          importsRaw.push({
            symIdx: sc.readU32('sym_idx'),
            capIdx: sc.readU32('cap_idx'),
            arity: sc.readU16('arity'),
            hasReturn: sc.readU8('has_ret') !== 0,
          });
        }
        break;
      }
      case MbcSectionTag.EXPORT_TABLE: {
        const count = sc.readU32('export_count');
        for (let i = 0; i < count; i++) {
          exportsRaw.push({
            nameIdx: sc.readU32('name_idx'),
            kind: sc.readU8('kind'),
            targetIdx: sc.readU32('target_idx'),
          });
        }
        break;
      }
      case MbcSectionTag.FUNC_TABLE: {
        globalCount = sc.readU32('global_count');
        const rawEntry = sc.readU32('entry_fn');
        entryFnIndex = rawEntry === 0xffffffff ? null : rawEntry;
        const fnCount = sc.readU32('fn_count');
        for (let i = 0; i < fnCount; i++) {
          const nameIdx = sc.readU32('fn_name');
          const paramCount = sc.readU16('param_count');
          const localCount = sc.readU16('local_count');
          const maxStack = sc.readU16('max_stack');
          const hasReturn = sc.readU8('has_ret') !== 0;
          const effCount = sc.readU16('eff_count');
          const effIndices: number[] = [];
          for (let j = 0; j < effCount; j++) effIndices.push(sc.readU32('eff_idx'));
          const codeOffset = sc.readU32('code_offset');
          const codeLength = sc.readU32('code_length');
          funcsRaw.push({
            nameIdx,
            paramCount,
            localCount,
            maxStack,
            hasReturn,
            effIndices,
            codeOffset,
            codeLength,
          });
        }
        break;
      }
      case MbcSectionTag.CODE:
        codeBytes = new Uint8Array(slice);
        break;
      case MbcSectionTag.DEBUG_MAP: {
        const count = sc.readU32('dbg_count');
        for (let i = 0; i < count; i++) {
          debugMap.push({
            fnIndex: sc.readU32('fn_idx'),
            codeOffset: sc.readU32('code_offset'),
            line: sc.readU32('line'),
            column: sc.readU32('col'),
          });
        }
        break;
      }
      default:
        break;
    }
  }

  const getStr = (idx: number): string => {
    const entry = constants[idx];
    if (!entry) throw new Error(`Constant index ${idx} out of bounds (pool size ${constants.length})`);
    if (entry.kind !== 'str') throw new Error(`Constant index ${idx} is not a string`);
    return entry.value;
  };

  const structs: MbcStructDesc[] = structsRaw.map((sr) => ({
    name: getStr(sr.nameIdx),
    fields: sr.fields.map((f) => ({ name: getStr(f.nameIdx), typeTag: f.typeTag })),
  }));

  const enums: MbcEnumDesc[] = enumsRaw.map((er) => ({
    name: getStr(er.nameIdx),
    variants: er.variants.map((v) => ({ name: getStr(v.nameIdx), arity: v.arity })),
  }));

  const imports: MbcImportDesc[] = importsRaw.map((ir) => ({
    symbol: getStr(ir.symIdx),
    capability: getStr(ir.capIdx),
    arity: ir.arity,
    hasReturn: ir.hasReturn,
  }));

  const exports: MbcExportDesc[] = exportsRaw.map((xr) => ({
    name: getStr(xr.nameIdx),
    kind: xr.kind === 1 ? 'global' : 'function',
    targetIndex: xr.targetIdx,
  }));

  const functions: MbcFunctionDesc[] = funcsRaw.map((fr) => {
    const name = getStr(fr.nameIdx);
    if (fr.codeOffset + fr.codeLength > codeBytes.length) {
      throw new Error(`Function '${name}' code slice exceeds CODE section bounds`);
    }
    const instructions = decodeMbcInstructions(
      codeBytes.subarray(fr.codeOffset, fr.codeOffset + fr.codeLength),
      name
    );
    return {
      name,
      paramCount: fr.paramCount,
      localCount: fr.localCount,
      maxStack: fr.maxStack,
      hasReturn: fr.hasReturn,
      effects: fr.effIndices.map(getStr),
      codeOffset: fr.codeOffset,
      codeLength: fr.codeLength,
      instructions,
    };
  });

  return {
    majorVersion,
    minorVersion,
    flags,
    moduleName,
    requires,
    provides,
    denies,
    constants,
    structs,
    enums,
    imports,
    exports,
    globalCount,
    entryFnIndex,
    functions,
    codeBytes,
    debugMap,
  };
}

export interface MbcVerificationResult {
  valid: boolean;
  errors: string[];
  module?: DecodedMbcModule;
}

/**
 * Static bytecode verifier in TypeScript mirroring Rust `mvm-core/src/verifier.rs`.
 */
export function verifyMbcBytes(bytes: Uint8Array): MbcVerificationResult {
  let mod: DecodedMbcModule;
  try {
    mod = decodeMbcContainer(bytes);
  } catch (err: any) {
    return { valid: false, errors: [err?.message || String(err)] };
  }

  const errors: string[] = [];

  for (const d of mod.denies) {
    if (mod.requires.includes(d)) {
      errors.push(`Capability '${d}' is simultaneously listed in requires and denies`);
    }
  }
  for (const imp of mod.imports) {
    if (mod.denies.some((d) => imp.capability === d || imp.capability.startsWith(`${d}.`))) {
      errors.push(`Host import '${imp.symbol}' requires denied capability '${imp.capability}'`);
    }
  }
  if (mod.entryFnIndex !== null && mod.entryFnIndex >= mod.functions.length) {
    errors.push(`Entry function index ${mod.entryFnIndex} out of bounds`);
  }

  for (const fn of mod.functions) {
    if (fn.localCount < fn.paramCount) {
      errors.push(`Function '${fn.name}': localCount (${fn.localCount}) < paramCount (${fn.paramCount})`);
      continue;
    }
    if (fn.instructions.length === 0) {
      errors.push(`Function '${fn.name}': empty instruction stream`);
      continue;
    }

    const offsetToPc = new Map<number, number>();
    fn.instructions.forEach((inst, idx) => offsetToPc.set(inst.offset, idx));

    const heights: Array<number | undefined> = new Array(fn.instructions.length).fill(undefined);
    const worklist: Array<{ pc: number; height: number }> = [{ pc: 0, height: 0 }];

    while (worklist.length > 0) {
      const { pc, height } = worklist.shift()!;
      const existing = heights[pc];
      if (existing !== undefined) {
        if (existing !== height) {
          errors.push(
            `Function '${fn.name}' at 0x${fn.instructions[pc].offset.toString(16)}: inconsistent stack height (${existing} vs ${height})`
          );
        }
        continue;
      }
      heights[pc] = height;
      const inst = fn.instructions[pc];

      let pops = 0;
      let pushes = 0;
      let flow: 'next' | 'jump' | 'branch' | 'return' = 'next';
      let targetOff = 0;

      switch (inst.opcode) {
        case MbcOpcode.NOP:
          break;
        case MbcOpcode.CONST:
          if (inst.operands[0] >= mod.constants.length) {
            errors.push(`Function '${fn.name}': CONST index ${inst.operands[0]} out of bounds`);
          }
          pushes = 1;
          break;
        case MbcOpcode.PUSH_VOID:
          pushes = 1;
          break;
        case MbcOpcode.POP:
          pops = 1;
          break;
        case MbcOpcode.DUP:
          pops = 1;
          pushes = 2;
          break;
        case MbcOpcode.LOAD_LOCAL:
          if (inst.operands[0] >= fn.localCount) {
            errors.push(`Function '${fn.name}': LOAD_LOCAL ${inst.operands[0]} out of bounds`);
          }
          pushes = 1;
          break;
        case MbcOpcode.STORE_LOCAL:
          if (inst.operands[0] >= fn.localCount) {
            errors.push(`Function '${fn.name}': STORE_LOCAL ${inst.operands[0]} out of bounds`);
          }
          pops = 1;
          break;
        case MbcOpcode.LOAD_GLOBAL:
          if (inst.operands[0] >= mod.globalCount) {
            errors.push(`Function '${fn.name}': LOAD_GLOBAL ${inst.operands[0]} out of bounds`);
          }
          pushes = 1;
          break;
        case MbcOpcode.STORE_GLOBAL:
          if (inst.operands[0] >= mod.globalCount) {
            errors.push(`Function '${fn.name}': STORE_GLOBAL ${inst.operands[0]} out of bounds`);
          }
          pops = 1;
          break;
        case MbcOpcode.ADD_I64:
        case MbcOpcode.SUB_I64:
        case MbcOpcode.MUL_I64:
        case MbcOpcode.DIV_I64:
        case MbcOpcode.MOD_I64:
        case MbcOpcode.ADD_F64:
        case MbcOpcode.SUB_F64:
        case MbcOpcode.MUL_F64:
        case MbcOpcode.DIV_F64:
        case MbcOpcode.CONCAT_STR:
        case MbcOpcode.EQ:
        case MbcOpcode.NEQ:
        case MbcOpcode.LT:
        case MbcOpcode.LTE:
        case MbcOpcode.GT:
        case MbcOpcode.GTE:
        case MbcOpcode.BOOL_AND:
        case MbcOpcode.BOOL_OR:
          pops = 2;
          pushes = 1;
          break;
        case MbcOpcode.NEG_I64:
        case MbcOpcode.NEG_F64:
        case MbcOpcode.I64_TO_F64:
        case MbcOpcode.F64_TO_I64:
        case MbcOpcode.TO_STR:
        case MbcOpcode.NOT:
        case MbcOpcode.ARRAY_LEN:
        case MbcOpcode.FIELD_GET:
        case MbcOpcode.ENUM_TAG:
        case MbcOpcode.ENUM_PAYLOAD:
          pops = 1;
          pushes = 1;
          break;
        case MbcOpcode.JMP:
          flow = 'jump';
          targetOff = inst.operands[0];
          break;
        case MbcOpcode.JMP_IF_FALSE:
        case MbcOpcode.JMP_IF_TRUE:
          pops = 1;
          flow = 'branch';
          targetOff = inst.operands[0];
          break;
        case MbcOpcode.CALL: {
          const callee = mod.functions[inst.operands[0]];
          if (!callee) {
            errors.push(`Function '${fn.name}': CALL fn index ${inst.operands[0]} out of bounds`);
          } else {
            pops = callee.paramCount;
            pushes = 1;
          }
          break;
        }
        case MbcOpcode.HOST_CALL: {
          const imp = mod.imports[inst.operands[0]];
          if (!imp) {
            errors.push(`Function '${fn.name}': HOST_CALL index ${inst.operands[0]} out of bounds`);
          } else {
            pops = imp.arity;
            pushes = 1;
          }
          break;
        }
        case MbcOpcode.RET:
          pops = 1;
          flow = 'return';
          break;
        case MbcOpcode.RET_VOID:
        case MbcOpcode.HALT:
        case MbcOpcode.TRAP:
          flow = 'return';
          break;
        case MbcOpcode.ARRAY_NEW:
          pops = inst.operands[0];
          pushes = 1;
          break;
        case MbcOpcode.ARRAY_GET:
        case MbcOpcode.ARRAY_PUSH:
        case MbcOpcode.MAP_GET:
        case MbcOpcode.MAP_HAS:
          pops = 2;
          pushes = 1;
          break;
        case MbcOpcode.ARRAY_SET:
          pops = 3;
          pushes = 0;
          break;
        case MbcOpcode.MAP_NEW:
          pops = inst.operands[0] * 2;
          pushes = 1;
          break;
        case MbcOpcode.MAP_SET:
          pops = 3;
          pushes = 1;
          break;
        case MbcOpcode.STRUCT_NEW: {
          const st = mod.structs[inst.operands[0]];
          if (!st) {
            errors.push(`Function '${fn.name}': STRUCT_NEW index ${inst.operands[0]} out of bounds`);
          } else {
            pops = st.fields.length;
            pushes = 1;
          }
          break;
        }
        case MbcOpcode.FIELD_SET:
          pops = 2;
          pushes = 0;
          break;
        case MbcOpcode.ENUM_NEW: {
          const en = mod.enums[inst.operands[0]];
          const vr = en?.variants[inst.operands[1]];
          if (!en || !vr) {
            errors.push(`Function '${fn.name}': ENUM_NEW invalid enum/variant`);
          } else {
            pops = vr.arity;
            pushes = 1;
          }
          break;
        }
      }

      if (height < pops) {
        errors.push(
          `Function '${fn.name}' at 0x${inst.offset.toString(16)}: stack underflow on ${inst.mnemonic} (needs ${pops}, has ${height})`
        );
        continue;
      }
      const nextH = height - pops + pushes;
      if (nextH > fn.maxStack) {
        errors.push(
          `Function '${fn.name}' at 0x${inst.offset.toString(16)}: stack overflow (${nextH} > max_stack ${fn.maxStack})`
        );
        continue;
      }

      if (flow === 'next') {
        if (pc + 1 >= fn.instructions.length) {
          errors.push(`Function '${fn.name}': execution falls off end without RET/RET_VOID`);
        } else {
          worklist.push({ pc: pc + 1, height: nextH });
        }
      } else if (flow === 'jump') {
        const tpc = offsetToPc.get(targetOff);
        if (tpc === undefined) {
          errors.push(
            `Function '${fn.name}' at 0x${inst.offset.toString(16)}: invalid jump target 0x${targetOff.toString(16)}`
          );
        } else {
          worklist.push({ pc: tpc, height: nextH });
        }
      } else if (flow === 'branch') {
        const tpc = offsetToPc.get(targetOff);
        if (tpc === undefined) {
          errors.push(
            `Function '${fn.name}' at 0x${inst.offset.toString(16)}: invalid branch target 0x${targetOff.toString(16)}`
          );
        } else {
          worklist.push({ pc: tpc, height: nextH });
        }
        if (pc + 1 >= fn.instructions.length) {
          errors.push(`Function '${fn.name}': branch fallthrough falls off end of function`);
        } else {
          worklist.push({ pc: pc + 1, height: nextH });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    module: mod,
  };
}

export function disassembleMbcBytes(bytes: Uint8Array): string {
  const mod = decodeMbcContainer(bytes);
  const lines: string[] = [];
  lines.push(`; Manifest Bytecode (.mbc) v${mod.majorVersion}.${mod.minorVersion}`);
  lines.push(`; Module:   ${mod.moduleName}`);
  lines.push(`; Size:     ${bytes.length} bytes`);
  lines.push(`; Requires: [${mod.requires.join(', ')}]`);
  lines.push(`; Provides: [${mod.provides.join(', ')}]`);
  lines.push(`; Denies:   [${mod.denies.join(', ')}]`);
  lines.push(`; Globals:  ${mod.globalCount}`);
  lines.push('');

  if (mod.constants.length > 0) {
    lines.push('.constants');
    mod.constants.forEach((c, idx) => {
      if (c.kind === 'i64') lines.push(`  #${idx} = i64 ${c.value}`);
      else if (c.kind === 'f64') lines.push(`  #${idx} = f64 ${c.value}`);
      else if (c.kind === 'bool') lines.push(`  #${idx} = bool ${c.value}`);
      else lines.push(`  #${idx} = str ${JSON.stringify(c.value)}`);
    });
    lines.push('');
  }

  if (mod.imports.length > 0) {
    lines.push('.imports');
    mod.imports.forEach((imp, idx) => {
      lines.push(`  @${idx} = ${imp.symbol} (cap: ${imp.capability}, arity: ${imp.arity})`);
    });
    lines.push('');
  }

  mod.functions.forEach((fn, idx) => {
    const entryTag = mod.entryFnIndex === idx ? ' [entry]' : '';
    lines.push(
      `.fn ${fn.name} (idx=${idx}, params=${fn.paramCount}, locals=${fn.localCount}, max_stack=${fn.maxStack}, effects=[${fn.effects.join(', ')}])${entryTag}`
    );
    for (const inst of fn.instructions) {
      const offHex = inst.offset.toString(16).toUpperCase().padStart(4, '0');
      let comment = '';
      if (inst.opcode === MbcOpcode.CONST) {
        const c = mod.constants[inst.operands[0]];
        if (c) {
          comment = ` ; ${c.kind === 'str' ? JSON.stringify(c.value) : String(c.value)}`;
        }
      } else if (inst.opcode === MbcOpcode.CALL) {
        const callee = mod.functions[inst.operands[0]];
        if (callee) comment = ` ; @${callee.name}`;
      } else if (inst.opcode === MbcOpcode.HOST_CALL) {
        const imp = mod.imports[inst.operands[0]];
        if (imp) comment = ` ; ${imp.symbol} [${imp.capability}]`;
      } else if (
        inst.opcode === MbcOpcode.JMP ||
        inst.opcode === MbcOpcode.JMP_IF_FALSE ||
        inst.opcode === MbcOpcode.JMP_IF_TRUE
      ) {
        comment = ` ; -> 0x${inst.operands[0].toString(16).toUpperCase().padStart(4, '0')}`;
      }
      const ops = inst.operands.join(', ');
      lines.push(`  ${offHex}: ${inst.mnemonic}${ops ? ' ' + ops : ''}${comment}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

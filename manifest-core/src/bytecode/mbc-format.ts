export const MBC_MAGIC = new Uint8Array([0x4d, 0x42, 0x43, 0x00]); // "MBC\0"
export const MBC_VERSION_MAJOR = 1;
export const MBC_VERSION_MINOR = 0;

export enum MbcSectionTag {
  MODULE_META = 0x01,
  CONST_POOL = 0x02,
  TYPE_TABLE = 0x03,
  IMPORT_TABLE = 0x04,
  EXPORT_TABLE = 0x05,
  FUNC_TABLE = 0x06,
  CODE = 0x07,
  DEBUG_MAP = 0x08,
}

export enum MbcConstKind {
  I64 = 0x01,
  F64 = 0x02,
  BOOL = 0x03,
  STR = 0x04,
}

export enum MbcOpcode {
  NOP = 0x01,
  CONST = 0x02,
  PUSH_VOID = 0x03,
  POP = 0x04,
  DUP = 0x05,

  LOAD_LOCAL = 0x10,
  STORE_LOCAL = 0x11,
  LOAD_GLOBAL = 0x12,
  STORE_GLOBAL = 0x13,

  ADD_I64 = 0x20,
  SUB_I64 = 0x21,
  MUL_I64 = 0x22,
  DIV_I64 = 0x23,
  MOD_I64 = 0x24,
  NEG_I64 = 0x25,

  ADD_F64 = 0x26,
  SUB_F64 = 0x27,
  MUL_F64 = 0x28,
  DIV_F64 = 0x29,
  NEG_F64 = 0x2a,

  CONCAT_STR = 0x2b,
  I64_TO_F64 = 0x2c,
  F64_TO_I64 = 0x2d,
  TO_STR = 0x2e,

  EQ = 0x30,
  NEQ = 0x31,
  LT = 0x32,
  LTE = 0x33,
  GT = 0x34,
  GTE = 0x35,
  NOT = 0x36,
  BOOL_AND = 0x37,
  BOOL_OR = 0x38,

  JMP = 0x40,
  JMP_IF_FALSE = 0x41,
  JMP_IF_TRUE = 0x42,
  CALL = 0x43,
  RET = 0x44,
  RET_VOID = 0x45,
  HOST_CALL = 0x46,

  ARRAY_NEW = 0x50,
  ARRAY_GET = 0x51,
  ARRAY_SET = 0x52,
  ARRAY_LEN = 0x53,
  ARRAY_PUSH = 0x54,

  MAP_NEW = 0x55,
  MAP_GET = 0x56,
  MAP_SET = 0x57,
  MAP_HAS = 0x58,

  STRUCT_NEW = 0x60,
  FIELD_GET = 0x61,
  FIELD_SET = 0x62,

  ENUM_NEW = 0x63,
  ENUM_TAG = 0x64,
  ENUM_PAYLOAD = 0x65,

  TRAP = 0x70,
  HALT = 0x7f,
}

export type MbcConstant =
  | { kind: 'i64'; value: bigint }
  | { kind: 'f64'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'str'; value: string };

export interface MbcStructDesc {
  name: string;
  fields: Array<{ name: string; typeTag: number }>;
}

export interface MbcEnumDesc {
  name: string;
  variants: Array<{ name: string; arity: number }>;
}

export interface MbcImportDesc {
  symbol: string;
  capability: string;
  arity: number;
  hasReturn: boolean;
}

export interface MbcExportDesc {
  name: string;
  kind: 'function' | 'global';
  targetIndex: number;
}

export interface DecodedMbcInstruction {
  offset: number;
  length: number;
  opcode: MbcOpcode;
  mnemonic: string;
  operands: number[];
}

export interface MbcFunctionDesc {
  name: string;
  paramCount: number;
  localCount: number;
  maxStack: number;
  hasReturn: boolean;
  effects: string[];
  codeOffset: number;
  codeLength: number;
  instructions: DecodedMbcInstruction[];
}

export interface MbcDebugEntry {
  fnIndex: number;
  codeOffset: number;
  line: number;
  column: number;
}

export interface DecodedMbcModule {
  majorVersion: number;
  minorVersion: number;
  flags: number;
  moduleName: string;
  requires: string[];
  provides: string[];
  denies: string[];
  constants: MbcConstant[];
  structs: MbcStructDesc[];
  enums: MbcEnumDesc[];
  imports: MbcImportDesc[];
  exports: MbcExportDesc[];
  globalCount: number;
  entryFnIndex: number | null;
  functions: MbcFunctionDesc[];
  codeBytes: Uint8Array;
  debugMap: MbcDebugEntry[];
}

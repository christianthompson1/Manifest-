/**
 * Manifest Solana Target-Independent Intermediate Representation (Solana IR)
 * Represents on-chain programs, account schemas, instructions, constraints, signers,
 * PDAs, checked arithmetic, CPI calls, events, and error codes independently of Rust or Anchor.
 */

export type SolanaTypeKind =
  | 'bool'
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'u128'
  | 'i64'
  | 'pubkey'
  | 'bytes'
  | 'string';

export const SUPPORTED_SOLANA_TYPES = new Set<string>([
  'bool',
  'boolean',
  'u8',
  'u16',
  'u32',
  'u64',
  'u128',
  'i64',
  'pubkey',
  'public_key',
  'address',
  'bytes',
  'string',
  'text',
  'number',
]);

export function normalizeSolanaType(rawType: string): SolanaTypeKind {
  const t = rawType.toLowerCase().trim();
  switch (t) {
    case 'bool':
    case 'boolean':
      return 'bool';
    case 'u8':
      return 'u8';
    case 'u16':
      return 'u16';
    case 'u32':
      return 'u32';
    case 'u64':
    case 'number':
      return 'u64';
    case 'u128':
      return 'u128';
    case 'i64':
      return 'i64';
    case 'pubkey':
    case 'public_key':
    case 'address':
      return 'pubkey';
    case 'bytes':
      return 'bytes';
    case 'string':
    case 'text':
      return 'string';
    default:
      throw new Error(`Unsupported Solana type: "${rawType}". Supported types: BOOL, U8, U16, U32, U64, U128, I64, PUBLIC_KEY, BYTES, STRING.`);
  }
}

export function calculateFieldSpace(fieldType: SolanaTypeKind): number {
  switch (fieldType) {
    case 'bool':
    case 'u8':
      return 1;
    case 'u16':
      return 2;
    case 'u32':
      return 4;
    case 'u64':
    case 'i64':
      return 8;
    case 'u128':
      return 16;
    case 'pubkey':
      return 32;
    case 'string':
      return 4 + 64; // 4-byte string length prefix + 64-byte payload
    case 'bytes':
      return 4 + 64; // 4-byte buffer length prefix + 64-byte payload
    default:
      return 8;
  }
}

export function calculateAccountSpace(fields: SolanaFieldIR[]): number {
  let space = 8; // 8-byte Anchor account discriminator
  for (const f of fields) {
    space += calculateFieldSpace(f.fieldType);
  }
  return space;
}

export interface SolanaFieldIR {
  name: string;
  fieldType: SolanaTypeKind;
  isSigner?: boolean;
  isMut?: boolean;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface SolanaAccountIR {
  name: string;
  fields: SolanaFieldIR[];
  spaceEstimate?: number;
  isPda?: boolean;
  pda?: SolanaPdaIR;
}

export interface SolanaPdaSeed {
  kind: 'literal' | 'account' | 'arg';
  value: string;
}

export interface SolanaPdaIR {
  seeds: SolanaPdaSeed[];
  bump?: string;
  payer?: string;
  space?: number;
}

export interface SolanaAccountConstraintIR {
  init?: boolean;
  payer?: string;
  space?: number;
  seeds?: SolanaPdaSeed[];
  bump?: string;
  mut?: boolean;
  signer?: boolean;
  hasOne?: string[];
  close?: string;
  customConstraint?: string;
}

export interface SolanaInstructionContextField {
  name: string;
  isMut: boolean;
  isSigner: boolean;
  accountType?: string;
  role?: 'SIGNER' | 'MUT' | 'READONLY' | 'PDA' | 'SYSTEM_ACCOUNT' | 'PROGRAM_ACCOUNT';
  pda?: SolanaPdaIR;
  constraints?: SolanaAccountConstraintIR;
}

export interface SolanaInstructionArgIR {
  name: string;
  argType: SolanaTypeKind;
}

export interface SolanaMutationIR {
  target: string;
  expression: string;
  operation?: 'assign' | 'checked_add' | 'checked_sub' | 'checked_mul';
  operand?: string;
}

export interface SolanaCpiIR {
  targetProgram: string;
  instructionName: string;
  params: Record<string, string>;
}

export interface SolanaEventFieldIR {
  name: string;
  fieldType: SolanaTypeKind;
}

export interface SolanaEventIR {
  name: string;
  fields: SolanaEventFieldIR[];
}

export interface SolanaErrorIR {
  code: number;
  name: string;
  msg: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface SolanaInstructionIR {
  name: string;
  accounts: SolanaInstructionContextField[];
  args?: SolanaInstructionArgIR[];
  requires: string[];
  mutations: SolanaMutationIR[];
  cpis: SolanaCpiIR[];
  events?: SolanaEventIR[];
  returnType?: SolanaTypeKind;
  rawRust?: string;
}

export interface SolanaProgramIR {
  programName: string;
  programId: string;
  accounts: SolanaAccountIR[];
  instructions: SolanaInstructionIR[];
  errors?: SolanaErrorIR[];
  events?: SolanaEventIR[];
  rawRustEscape?: string;
}

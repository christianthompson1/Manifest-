/**
 * Manifest Solana Target-Independent Intermediate Representation (Solana IR)
 * Represents on-chain programs, account schemas, instructions, constraints, signers,
 * CPI calls, and error codes independently of Rust or Anchor.
 */

export interface SolanaFieldIR {
  name: string;
  fieldType: 'u64' | 'u32' | 'u8' | 'i64' | 'bool' | 'string' | 'pubkey' | 'bytes';
  isSigner?: boolean;
  isMut?: boolean;
}

export interface SolanaAccountIR {
  name: string;
  fields: SolanaFieldIR[];
  spaceEstimate?: number;
}

export interface SolanaInstructionContextField {
  name: string;
  isMut: boolean;
  isSigner: boolean;
  accountType?: string;
}

export interface SolanaInstructionIR {
  name: string;
  accounts: SolanaInstructionContextField[];
  requires: string[];
  mutations: Array<{ target: string; expression: string }>;
  cpis: SolanaCpiIR[];
  rawRust?: string;
}

export interface SolanaCpiIR {
  targetProgram: string;
  instructionName: string;
  params: Record<string, string>;
}

export interface SolanaProgramIR {
  programName: string;
  programId: string;
  accounts: SolanaAccountIR[];
  instructions: SolanaInstructionIR[];
  rawRustEscape?: string;
}

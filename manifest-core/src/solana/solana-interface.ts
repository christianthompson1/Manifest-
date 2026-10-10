/**
 * Manifest Solana - Program Interface Abstraction
 * Section 34: Abstraction for existing Solana programs (System Program, SPL Token, ATP, Anchor)
 * Decouples program definitions from compiler internals.
 */

export interface InterfaceAccountMeta {
  name: string;
  isMut: boolean;
  isSigner: boolean;
  isOptional?: boolean;
  pda?: boolean;
  description?: string;
}

export interface InterfaceArgumentMeta {
  name: string;
  type: string;
  description?: string;
}

export interface InterfaceInstructionMeta {
  name: string;
  accounts: InterfaceAccountMeta[];
  args: InterfaceArgumentMeta[];
  discriminator?: number[];
  description?: string;
}

export interface InterfaceTypeField {
  name: string;
  type: string;
}

export interface InterfaceTypeMeta {
  name: string;
  kind: 'struct' | 'enum';
  fields?: InterfaceTypeField[];
  variants?: string[];
}

export interface InterfaceErrorMeta {
  code: number;
  name: string;
  msg: string;
}

export interface SolanaProgramInterface {
  programId: string;
  name: string;
  version?: string;
  instructions: InterfaceInstructionMeta[];
  accounts: Array<{ name: string; type: InterfaceTypeMeta }>;
  types: InterfaceTypeMeta[];
  errors: InterfaceErrorMeta[];
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Standard Built-in Protocol Interfaces
// ---------------------------------------------------------------------------

/**
 * Solana System Program Interface (11111111111111111111111111111111)
 */
export const SYSTEM_PROGRAM_INTERFACE: SolanaProgramInterface = {
  programId: '11111111111111111111111111111111',
  name: 'SystemProgram',
  version: '1.0.0',
  instructions: [
    {
      name: 'transfer',
      accounts: [
        { name: 'from', isMut: true, isSigner: true, description: 'Source account funding transfer' },
        { name: 'to', isMut: true, isSigner: false, description: 'Destination account' },
      ],
      args: [{ name: 'lamports', type: 'u64' }],
      description: 'Transfer lamports from source to destination account',
    },
    {
      name: 'createAccount',
      accounts: [
        { name: 'from', isMut: true, isSigner: true },
        { name: 'to', isMut: true, isSigner: true },
      ],
      args: [
        { name: 'lamports', type: 'u64' },
        { name: 'space', type: 'u64' },
        { name: 'owner', type: 'pubkey' },
      ],
      description: 'Create a new account on-chain',
    },
  ],
  accounts: [],
  types: [],
  errors: [],
};

/**
 * SPL Token Program Interface (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
 */
export const SPL_TOKEN_INTERFACE: SolanaProgramInterface = {
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  name: 'SplToken',
  version: '3.5.0',
  instructions: [
    {
      name: 'transfer',
      accounts: [
        { name: 'source', isMut: true, isSigner: false },
        { name: 'destination', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [{ name: 'amount', type: 'u64' }],
      description: 'Transfer tokens between accounts with authority signature',
    },
    {
      name: 'mintTo',
      accounts: [
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'account', isMut: true, isSigner: false },
        { name: 'owner', isMut: false, isSigner: true },
      ],
      args: [{ name: 'amount', type: 'u64' }],
      description: 'Mint new tokens to a destination token account',
    },
  ],
  accounts: [
    {
      name: 'TokenAccount',
      type: {
        name: 'TokenAccount',
        kind: 'struct',
        fields: [
          { name: 'mint', type: 'pubkey' },
          { name: 'owner', type: 'pubkey' },
          { name: 'amount', type: 'u64' },
        ],
      },
    },
  ],
  types: [],
  errors: [],
};

/**
 * Associated Token Program Interface (ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL)
 */
export const ASSOCIATED_TOKEN_PROGRAM_INTERFACE: SolanaProgramInterface = {
  programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  name: 'AssociatedTokenProgram',
  version: '1.0.0',
  instructions: [
    {
      name: 'create',
      accounts: [
        { name: 'payer', isMut: true, isSigner: true },
        { name: 'associatedToken', isMut: true, isSigner: false },
        { name: 'wallet', isMut: false, isSigner: false },
        { name: 'mint', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [],
      description: 'Create an associated token account for a given wallet and mint',
    },
  ],
  accounts: [],
  types: [],
  errors: [],
};

export class ProgramInterfaceRegistry {
  private static instance: ProgramInterfaceRegistry;
  private registry: Map<string, SolanaProgramInterface> = new Map();

  private constructor() {
    this.register(SYSTEM_PROGRAM_INTERFACE);
    this.register(SPL_TOKEN_INTERFACE);
    this.register(ASSOCIATED_TOKEN_PROGRAM_INTERFACE);
  }

  public static getInstance(): ProgramInterfaceRegistry {
    if (!ProgramInterfaceRegistry.instance) {
      ProgramInterfaceRegistry.instance = new ProgramInterfaceRegistry();
    }
    return ProgramInterfaceRegistry.instance;
  }

  public register(programInterface: SolanaProgramInterface): void {
    this.registry.set(programInterface.programId, programInterface);
    this.registry.set(programInterface.name.toLowerCase(), programInterface);
  }

  public get(idOrName: string): SolanaProgramInterface | undefined {
    return this.registry.get(idOrName) || this.registry.get(idOrName.toLowerCase());
  }

  public getAll(): SolanaProgramInterface[] {
    const seen = new Set<string>();
    const result: SolanaProgramInterface[] = [];
    for (const iface of this.registry.values()) {
      if (!seen.has(iface.programId)) {
        seen.add(iface.programId);
        result.push(iface);
      }
    }
    return result;
  }
}

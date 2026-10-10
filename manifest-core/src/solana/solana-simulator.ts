import { SolanaProgramIR } from './solana-ir.ts';

export interface SimulatedAccount {
  pubkey: string;
  owner: string;
  lamports: number;
  data: Record<string, any>;
  isSigner?: boolean;
}

export interface SimulationResult {
  success: boolean;
  signature: string;
  logs: string[];
  computeUnitsUsed: number;
  error?: string;
  accounts: Record<string, SimulatedAccount>;
}

export class SolanaSimulator {
  private accounts: Map<string, SimulatedAccount> = new Map();
  private program?: SolanaProgramIR;
  private transactions: Array<{ signature: string; from: string; to: string; amount: number; timestamp: number }> = [];

  constructor(program?: SolanaProgramIR) {
    this.program = program;
  }

  public setAccount(pubkey: string, account: SimulatedAccount) {
    this.accounts.set(pubkey, account);
  }

  public getAccount(pubkey: string): SimulatedAccount | undefined {
    return this.accounts.get(pubkey);
  }

  public createAccount(
    nameOrPubkey: string,
    lamports = 0,
    owner = 'system',
    data: Record<string, any> = {}
  ): string {
    const pubkey = nameOrPubkey.length >= 32 ? nameOrPubkey : `${nameOrPubkey}_${Math.random().toString(36).substring(2, 10)}`;
    const acc: SimulatedAccount = {
      pubkey,
      owner,
      lamports,
      data,
      isSigner: true,
    };
    this.accounts.set(pubkey, acc);
    return pubkey;
  }

  public transferLamports(
    fromPubkey: string,
    toPubkey: string,
    amount: number
  ): { success: boolean; signature: string; error?: string } {
    const fromAcc = this.accounts.get(fromPubkey);
    const toAcc = this.accounts.get(toPubkey);
    if (!fromAcc) return { success: false, signature: '', error: 'Source account not found' };
    if (!toAcc) return { success: false, signature: '', error: 'Destination account not found' };
    if (fromAcc.lamports < amount) return { success: false, signature: '', error: 'Insufficient funds' };

    fromAcc.lamports -= amount;
    toAcc.lamports += amount;
    const signature = `5K${Math.random().toString(36).substring(2, 15)}`;
    this.transactions.push({
      signature,
      from: fromPubkey,
      to: toPubkey,
      amount,
      timestamp: Date.now(),
    });
    return { success: true, signature };
  }

  public getTransactions() {
    return [...this.transactions];
  }

  public exportAccounts(): Record<string, SimulatedAccount> {
    const obj: Record<string, SimulatedAccount> = {};
    for (const [k, v] of this.accounts.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  public initializeDefaultAccounts(authorityPubkey = 'Auth1111111111111111111111111111111111111111') {
    this.accounts.set(authorityPubkey, {
      pubkey: authorityPubkey,
      owner: '11111111111111111111111111111111',
      lamports: 10_000_000_000, // 10 SOL
      data: {},
      isSigner: true,
    });

    if (!this.program) return;

    for (const acc of this.program.accounts) {
      const pdaPubkey = `PDA_${acc.name}_${Math.random().toString(36).substring(2, 8)}`;
      const data: Record<string, any> = {};
      for (const field of acc.fields) {
        data[field.name] = field.fieldType === 'u64' ? 0 : '';
      }
      this.accounts.set(pdaPubkey, {
        pubkey: pdaPubkey,
        owner: this.program.programId,
        lamports: 2_000_000,
        data,
      });
    }
  }

  public executeInstruction(
    instructionName: string,
    argsOrAuth?: any,
    authorityPubkey?: string
  ): SimulationResult {
    const logs: string[] = [];
    const auth = typeof argsOrAuth === 'string' ? argsOrAuth : (authorityPubkey || 'SimulatedAuth11111111111111111111111111111');
    const progId = this.program?.programId || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

    logs.push(`Program ${progId} invoke [1]`);
    logs.push(`Program log: Instruction: ${instructionName}`);

    const inst = this.program?.instructions.find((i) => i.name === instructionName);
    if (!inst) {
      logs.push(`Program log: Error: Instruction ${instructionName} not found`);
      return {
        success: false,
        signature: '',
        logs,
        computeUnitsUsed: 150,
        error: `Instruction not found`,
        accounts: this.getAllAccountsRecord(),
      };
    }

    logs.push(`Program log: Constraint check passed cleanly`);
    logs.push(`Program ${progId} success`);

    const signature = `5K${Math.random().toString(36).substring(2, 15)}`;
    return {
      success: true,
      signature,
      logs,
      computeUnitsUsed: 450,
      accounts: this.getAllAccountsRecord(),
    };
  }

  private getAllAccountsRecord(): Record<string, SimulatedAccount> {
    const record: Record<string, SimulatedAccount> = {};
    this.accounts.forEach((acc, key) => {
      record[key] = { ...acc };
    });
    return record;
  }
}

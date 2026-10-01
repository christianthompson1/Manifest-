/**
 * Manifest Solana Fast Local Simulation Layer (Level 1 Testing Architecture)
 * Runs in-browser / Web Worker without requiring local Cargo/Rust/Solana CLI.
 * Simulates Solana accounts, PDAs, signers, transaction execution, program logs,
 * and constraint validation for immediate sub-second feedback.
 */

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

  public initializeDefaultAccounts(authorityPubkey = 'Auth1111111111111111111111111111111111111111') {
    // 1. Authority signer account
    this.accounts.set(authorityPubkey, {
      pubkey: authorityPubkey,
      owner: '11111111111111111111111111111111',
      lamports: 10_000_000_000, // 10 SOL
      data: {},
      isSigner: true,
    });

    if (!this.program) return;

    // 2. Program-owned state accounts
    for (const accSchema of this.program.accounts) {
      const statePubkey = `State_${accSchema.name.toLowerCase()}_111111111111111111`;
      const initialData: Record<string, any> = {};
      for (const field of accSchema.fields) {
        if (field.fieldType === 'u64' || field.fieldType === 'u32' || field.fieldType === 'i64') {
          initialData[field.name] = 0;
        } else if (field.fieldType === 'bool') {
          initialData[field.name] = false;
        } else if ((field.fieldType as string) === 'pubkey' || (field.fieldType as string) === 'address') {
          initialData[field.name] = authorityPubkey;
        } else {
          initialData[field.name] = '';
        }
      }

      this.accounts.set(statePubkey, {
        pubkey: statePubkey,
        owner: this.program.programId,
        lamports: 2_000_000, // rent exempt
        data: initialData,
      });
    }
  }

  /**
   * Executes an instruction on the simulated program
   */
  public executeInstruction(
    instructionName: string,
    params: Record<string, any> = {},
    signerPubkey = 'Auth1111111111111111111111111111111111111111'
  ): SimulationResult {
    const logs: string[] = [];
    const signature = `5K${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

    if (!this.program) {
      return {
        success: false,
        signature,
        logs: ['Error: No program configured in simulator'],
        computeUnitsUsed: 0,
        error: 'No program configured in simulator',
        accounts: this.exportAccounts(),
      };
    }

    const program = this.program;
    logs.push(`Program ${program.programId} invoke [1]`);
    logs.push(`Program log: Instruction: ${instructionName}`);

    const inst = program.instructions.find(
      (i) => i.name.toLowerCase() === instructionName.toLowerCase()
    );

    if (!inst) {
      logs.push(`Program log: Error: Instruction '${instructionName}' not found`);
      logs.push(`Program ${program.programId} failed: custom program error: 0x1770`);
      return {
        success: false,
        signature,
        logs,
        computeUnitsUsed: 450,
        error: `Instruction '${instructionName}' not found on program ${program.programName}`,
        accounts: this.exportAccounts(),
      };
    }

    const signerAccount = this.accounts.get(signerPubkey);
    if (!signerAccount || !signerAccount.isSigner) {
      logs.push('Program log: Error: Missing required signature for authority');
      logs.push(`Program ${program.programId} failed: MissingRequiredSignature`);
      return {
        success: false,
        signature,
        logs,
        computeUnitsUsed: 800,
        error: 'Missing required signature',
        accounts: this.exportAccounts(),
      };
    }

    // Find state account for mutation
    let stateAccount: SimulatedAccount | undefined;
    for (const acc of this.accounts.values()) {
      if (acc.owner === program.programId) {
        stateAccount = acc;
        break;
      }
    }

    // Verify constraints
    for (const req of inst.requires) {
      if (req.includes('signer') && req.includes('authority')) {
        const expectedAuth = stateAccount?.data.authority || signerPubkey;
        if (signerPubkey !== expectedAuth) {
          logs.push(`Program log: Constraint failed: signer must match authority (${expectedAuth})`);
          logs.push(`Program ${program.programId} failed: ConstraintFailed`);
          return {
            success: false,
            signature,
            logs,
            computeUnitsUsed: 1200,
            error: `Constraint failed: signer !== authority`,
            accounts: this.exportAccounts(),
          };
        }
      }
    }

    // Execute state mutations
    if (stateAccount) {
      for (const mut of inst.mutations) {
        // e.g. target: count, expression: count + 1
        const field = mut.target.replace(/.*[\.\->]/, '').trim();
        if (field in stateAccount.data) {
          if (mut.expression.includes('+')) {
            const amount = parseInt(mut.expression.split('+')[1].trim()) || 1;
            stateAccount.data[field] += amount;
          } else if (mut.expression.includes('-')) {
            const amount = parseInt(mut.expression.split('-')[1].trim()) || 1;
            stateAccount.data[field] -= amount;
          } else if (params[field] !== undefined) {
            stateAccount.data[field] = params[field];
          }
          logs.push(`Program log: Mutated state field '${field}' to ${JSON.stringify(stateAccount.data[field])}`);
        }
      }
    }

    // CPI executions
    for (const cpi of inst.cpis) {
      logs.push(`Program log: Invoking CPI: ${cpi.targetProgram}::${cpi.instructionName}`);
      logs.push(`Program ${cpi.targetProgram} success`);
    }

    logs.push(`Program ${program.programId} success`);

    return {
      success: true,
      signature,
      logs,
      computeUnitsUsed: 2340,
      accounts: this.exportAccounts(),
    };
  }

  public exportAccounts(): Record<string, SimulatedAccount> {
    const res: Record<string, SimulatedAccount> = {};
    for (const [k, v] of this.accounts.entries()) {
      res[k] = { ...v, data: { ...v.data } };
    }
    return res;
  }
}

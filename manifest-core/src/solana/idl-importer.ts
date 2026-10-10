/**
 * Manifest Solana - Anchor IDL Importer
 * Section 35: Converts Anchor IDL JSON specifications into SolanaProgramInterface
 * enabling CPI calls, account lookups, and compiler autocompletion without hardcoded schemas.
 */

import {
  SolanaProgramInterface,
  InterfaceInstructionMeta,
  InterfaceAccountMeta,
  InterfaceArgumentMeta,
  InterfaceTypeMeta,
  InterfaceErrorMeta,
} from './solana-interface.ts';

export class AnchorIdlImporter {
  /**
   * Imports an Anchor IDL (JSON string or parsed Object) into a SolanaProgramInterface
   */
  public static importIdl(idlInput: string | Record<string, any>): SolanaProgramInterface {
    let idl: Record<string, any>;
    if (typeof idlInput === 'string') {
      try {
        idl = JSON.parse(idlInput);
      } catch (err: any) {
        throw new Error(`Failed to parse Anchor IDL JSON: ${err.message}`);
      }
    } else {
      idl = idlInput;
    }

    if (!idl || typeof idl !== 'object') {
      throw new Error('Invalid IDL: root must be a JSON object.');
    }

    const name = idl.name || idl.metadata?.name || 'ImportedAnchorProgram';
    const programId = idl.address || idl.metadata?.address || '11111111111111111111111111111111';
    const version = idl.version || idl.metadata?.version || '0.1.0';

    // 1. Parse instructions
    const instructions: InterfaceInstructionMeta[] = [];
    if (Array.isArray(idl.instructions)) {
      for (const rawIx of idl.instructions) {
        const accounts: InterfaceAccountMeta[] = [];
        if (Array.isArray(rawIx.accounts)) {
          for (const rawAcc of rawIx.accounts) {
            accounts.push({
              name: rawAcc.name,
              isMut: Boolean(rawAcc.isMut || rawAcc.writable),
              isSigner: Boolean(rawAcc.isSigner || rawAcc.signer),
              isOptional: Boolean(rawAcc.optional),
              pda: Boolean(rawAcc.pda),
              description: rawAcc.desc || rawAcc.docs?.join(' '),
            });
          }
        }

        const args: InterfaceArgumentMeta[] = [];
        if (Array.isArray(rawIx.args)) {
          for (const rawArg of rawIx.args) {
            args.push({
              name: rawArg.name,
              type: this.formatType(rawArg.type),
              description: rawArg.docs?.join(' '),
            });
          }
        }

        instructions.push({
          name: rawIx.name,
          accounts,
          args,
          discriminator: rawIx.discriminator,
          description: rawIx.docs?.join(' ') || rawIx.description,
        });
      }
    }

    // 2. Parse Accounts
    const accounts: Array<{ name: string; type: InterfaceTypeMeta }> = [];
    if (Array.isArray(idl.accounts)) {
      for (const rawAcc of idl.accounts) {
        accounts.push({
          name: rawAcc.name,
          type: {
            name: rawAcc.name,
            kind: 'struct',
            fields: Array.isArray(rawAcc.type?.fields)
              ? rawAcc.type.fields.map((f: any) => ({
                  name: f.name,
                  type: this.formatType(f.type),
                }))
              : [],
          },
        });
      }
    }

    // 3. Parse Types
    const types: InterfaceTypeMeta[] = [];
    if (Array.isArray(idl.types)) {
      for (const rawType of idl.types) {
        if (rawType.type?.kind === 'enum') {
          types.push({
            name: rawType.name,
            kind: 'enum',
            variants: Array.isArray(rawType.type.variants)
              ? rawType.type.variants.map((v: any) => (typeof v === 'string' ? v : v.name))
              : [],
          });
        } else {
          types.push({
            name: rawType.name,
            kind: 'struct',
            fields: Array.isArray(rawType.type?.fields)
              ? rawType.type.fields.map((f: any) => ({
                  name: f.name,
                  type: this.formatType(f.type),
                }))
              : [],
          });
        }
      }
    }

    // 4. Parse Errors
    const errors: InterfaceErrorMeta[] = [];
    if (Array.isArray(idl.errors)) {
      for (const rawErr of idl.errors) {
        errors.push({
          code: rawErr.code,
          name: rawErr.name,
          msg: rawErr.msg || rawErr.name,
        });
      }
    }

    return {
      programId,
      name,
      version,
      instructions,
      accounts,
      types,
      errors,
      metadata: idl.metadata,
    };
  }

  private static formatType(typeDef: any): string {
    if (!typeDef) return 'unknown';
    if (typeof typeDef === 'string') return typeDef;
    if (typeDef.defined) return typeDef.defined;
    if (typeDef.vec) return `Vec<${this.formatType(typeDef.vec)}>`;
    if (typeDef.option) return `Option<${this.formatType(typeDef.option)}>`;
    if (typeDef.array) return `[${this.formatType(typeDef.array[0])}; ${typeDef.array[1]}]`;
    return JSON.stringify(typeDef);
  }
}

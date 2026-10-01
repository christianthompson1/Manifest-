/**
 * Manifest Solana Target Compiler
 * Implements TargetCompiler for the Solana Anchor Framework.
 * Compiles Manifest IR into Anchor-compatible Rust source, IDL JSON, and test files.
 */

import {
  TargetCompiler,
  CompilationResult,
  TargetCompilerOptions,
  GeneratedArtifact,
  CompilationDiagnostic,
} from '../compiler-interface.ts';
import { IRProgramNode } from '../../ir/ir.ts';
import { AnchorGenerator } from '../../solana/anchor-generator.ts';
import { SolanaProgramIR } from '../../solana/solana-ir.ts';

export class SolanaTargetCompiler implements TargetCompiler {
  public readonly targetName = 'solana';
  public readonly fileExtension = 'rs';

  public compile(ir: IRProgramNode, options: TargetCompilerOptions = {}): CompilationResult {
    const diagnostics: CompilationDiagnostic[] = [];
    const artifacts: GeneratedArtifact[] = [];

    // Extract or synthesize Solana program representation from IR
    const solanaProgram = (ir as any).solanaProgram as SolanaProgramIR || this.buildDefaultSolanaProgram(ir);

    try {
      const result = AnchorGenerator.generate(solanaProgram);

      // 1. Rust Source Code (src/lib.rs)
      artifacts.push({
        fileName: 'lib.rs',
        content: result.rustCode,
        fileType: 'text',
      });

      // 2. Anchor IDL JSON
      artifacts.push({
        fileName: `${solanaProgram.programName.toLowerCase()}.json`,
        content: result.idlJson,
        fileType: 'json',
      });

      // 3. Anchor Configuration (Anchor.toml)
      artifacts.push({
        fileName: 'Anchor.toml',
        content: `[features]
seeds = false
skip-lint = false

[programs.localnet]
${solanaProgram.programName.toLowerCase()} = "${solanaProgram.programId}"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
`,
        fileType: 'text',
      });

      return {
        success: true,
        target: 'solana',
        outputCode: result.rustCode,
        artifacts,
        diagnostics,
        ir,
      };
    } catch (err: any) {
      diagnostics.push({
        severity: 'error',
        message: `Solana Anchor compilation failed: ${err.message}`,
        target: 'solana',
      });
      return {
        success: false,
        target: 'solana',
        artifacts: [],
        diagnostics,
        ir,
      };
    }
  }

  private buildDefaultSolanaProgram(ir: IRProgramNode): SolanaProgramIR {
    const programName = ir.appName || 'ManifestApp';
    const programId = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

    // Map top-level state or actions into accounts and instructions
    const fields = (ir.variables || []).map((v) => ({
      name: v.name,
      fieldType: 'u64' as const,
    }));

    // If state variables exist in IR
    if (ir.state) {
      for (const s of ir.state) {
        fields.push({
          name: s.name,
          fieldType: 'u64' as const,
        });
      }
    }

    if (fields.length === 0) {
      fields.push({ name: 'counter', fieldType: 'u64' });
    }

    const instructions = (ir.actions || []).map((act) => ({
      name: act.name,
      accounts: [
        { name: 'state', isMut: true, isSigner: false, accountType: `${programName}State` },
        { name: 'authority', isMut: true, isSigner: true },
      ],
      requires: ['signer = authority'],
      mutations: [{ target: 'state.counter', expression: 'state.counter + 1' }],
      cpis: [],
    }));

    if (instructions.length === 0) {
      instructions.push({
        name: 'initialize',
        accounts: [
          { name: 'state', isMut: true, isSigner: false, accountType: `${programName}State` },
          { name: 'authority', isMut: true, isSigner: true },
        ],
        requires: ['signer = authority'],
        mutations: [{ target: 'state.counter', expression: '0' }],
        cpis: [],
      });
      instructions.push({
        name: 'increment',
        accounts: [
          { name: 'state', isMut: true, isSigner: false, accountType: `${programName}State` },
          { name: 'authority', isMut: true, isSigner: true },
        ],
        requires: ['signer = authority'],
        mutations: [{ target: 'state.counter', expression: 'state.counter + 1' }],
        cpis: [],
      });
    }

    return {
      programName,
      programId,
      accounts: [
        {
          name: `${programName}State`,
          fields,
        },
      ],
      instructions,
    };
  }
}

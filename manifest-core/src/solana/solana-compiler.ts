import { SemanticDiagnostic } from '../semantics/types.ts';
import { CompilerTargetArtifact } from '../targets/target-registry.ts';
import { AnchorGenerator } from './anchor-generator.ts';
import { SolanaProgramIR } from './solana-ir.ts';
import { parseSolanaProgramSource } from './solana-program-parser.ts';

export interface SolanaGeneratedArtifact {
  fileName: string;
  content: string;
  fileType: 'text' | 'json';
}

export interface SolanaCompileResult {
  success: boolean;
  program?: SolanaProgramIR;
  rustCode?: string;
  idlJson?: string;
  idl?: any;
  artifacts: CompilerTargetArtifact[];
  legacyArtifacts: SolanaGeneratedArtifact[];
  diagnostics: SemanticDiagnostic[];
}

export class SolanaTargetCompiler {
  public readonly targetName = 'solana-sbf';
  public readonly fileExtension = 'rs';

  public compileProgramIR(program: SolanaProgramIR): SolanaCompileResult {
    try {
      const result = AnchorGenerator.generate(program);
      const snakeName = program.programName.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'manifest_program';

      const programCargo = `[package]
name = "${snakeName}"
version = "0.1.0"
description = "Created with Manifest Solana Compiler v1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "${snakeName}"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.30.1"
anchor-spl = "0.30.1"
`;

      const workspaceCargo = `[workspace]
members = [
    "programs/*"
]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
`;

      const anchorToml = `[features]
seeds = false
skip-lint = false

[programs.localnet]
${snakeName} = "${program.programId}"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "bun run manifest:test"
`;

      const legacyArtifacts: SolanaGeneratedArtifact[] = [
        { fileName: 'lib.rs', content: result.rustCode, fileType: 'text' },
        { fileName: `programs/${snakeName}/src/lib.rs`, content: result.rustCode, fileType: 'text' },
        { fileName: `programs/${snakeName}/Cargo.toml`, content: programCargo, fileType: 'text' },
        { fileName: 'Cargo.toml', content: workspaceCargo, fileType: 'text' },
        { fileName: `${snakeName}.json`, content: result.idlJson, fileType: 'json' },
        { fileName: 'Anchor.toml', content: anchorToml, fileType: 'text' },
      ];

      const artifacts: CompilerTargetArtifact[] = [
        { filename: 'build/lib.rs', mimeType: 'text/x-rust', isBinary: false, text: result.rustCode },
        { filename: 'build/idl.json', mimeType: 'application/json', isBinary: false, text: result.idlJson },
        {
          filename: `build/programs/${snakeName}/src/lib.rs`,
          mimeType: 'text/x-rust',
          isBinary: false,
          text: result.rustCode,
        },
        {
          filename: `build/programs/${snakeName}/Cargo.toml`,
          mimeType: 'text/plain',
          isBinary: false,
          text: programCargo,
        },
        { filename: 'build/Cargo.toml', mimeType: 'text/plain', isBinary: false, text: workspaceCargo },
        { filename: 'build/Anchor.toml', mimeType: 'text/plain', isBinary: false, text: anchorToml },
      ];

      return {
        success: true,
        program,
        rustCode: result.rustCode,
        idlJson: result.idlJson,
        idl: result.idl,
        artifacts,
        legacyArtifacts,
        diagnostics: [],
      };
    } catch (err: any) {
      return {
        success: false,
        artifacts: [],
        legacyArtifacts: [],
        diagnostics: [
          {
            code: 'E_SOLANA_CODEGEN',
            severity: 'error',
            message: `Solana Anchor compilation failed: ${err?.message || String(err)}`,
            line: 1,
            column: 1,
          },
        ],
      };
    }
  }
}

/**
 * Compiles standalone Manifest Solana smart-contract source (`PROGRAM <Name> ... END`)
 * directly into Anchor Rust source, Anchor workspace manifests, and IDL JSON.
 */
export function compileSolanaProgramSource(source: string): SolanaCompileResult {
  const parsed = parseSolanaProgramSource(source);
  if (!parsed.ok || !parsed.program) {
    return {
      success: false,
      artifacts: [],
      legacyArtifacts: [],
      diagnostics: parsed.diagnostics,
    };
  }
  const compiler = new SolanaTargetCompiler();
  const compiled = compiler.compileProgramIR(parsed.program);
  return {
    ...compiled,
    diagnostics: [...parsed.diagnostics, ...compiled.diagnostics],
  };
}

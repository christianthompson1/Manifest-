/**
 * Manifest Studio - Anchor Workspace Synthesizer
 * Generates a genuine Anchor workspace from Manifest Solana Program IR / templates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { AnchorGenerator } from '../src/solana/anchor-generator.ts';

export function synthesizeAnchorWorkspace(targetDir = process.cwd()) {
  const anchorTomlPath = path.join(targetDir, 'Anchor.toml');
  const cargoTomlPath = path.join(targetDir, 'Cargo.toml');
  const programsDir = path.join(targetDir, 'programs', 'counter');
  const programSrcDir = path.join(programsDir, 'src');

  console.log(`Synthesizing genuine Anchor workspace at ${targetDir}...`);

  fs.mkdirSync(programSrcDir, { recursive: true });

  // 1. Anchor.toml
  const anchorTomlContent = `[toolchain]
anchor_version = "0.30.1"
solana_version = "1.18.26"

[features]
seeds = false
skip-lint = false

[programs.localnet]
counter = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"

[programs.devnet]
counter = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "bun run manifest:test"
`;
  fs.writeFileSync(anchorTomlPath, anchorTomlContent, 'utf-8');

  // 2. Root Cargo.toml
  const rootCargoToml = `[workspace]
members = [
    "programs/*"
]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
`;
  fs.writeFileSync(cargoTomlPath, rootCargoToml, 'utf-8');

  // 3. Program Cargo.toml
  const programCargoToml = `[package]
name = "counter"
version = "0.1.0"
description = "Created with Manifest Solana Compiler"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "counter"

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
  fs.writeFileSync(path.join(programsDir, 'Cargo.toml'), programCargoToml, 'utf-8');

  // 4. Program lib.rs using AnchorGenerator
  const counterProgram = {
    programName: 'CounterProgram',
    programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
    accounts: [
      {
        name: 'CounterState',
        fields: [
          { name: 'count', fieldType: 'u64' as const },
          { name: 'authority', fieldType: 'pubkey' as const },
        ],
      },
    ],
    instructions: [
      {
        name: 'initialize',
        accounts: [
          { name: 'counter', isMut: true, isSigner: false, accountType: 'CounterState' },
          { name: 'authority', isMut: true, isSigner: true },
        ],
        requires: ['signer = authority'],
        mutations: [
          { target: 'counter.count', expression: '0' },
          { target: 'counter.authority', expression: 'authority.key()' },
        ],
        cpis: [],
      },
      {
        name: 'increment',
        accounts: [
          { name: 'counter', isMut: true, isSigner: false, accountType: 'CounterState' },
          { name: 'authority', isMut: false, isSigner: true },
        ],
        requires: ['counter.authority = authority.key()'],
        mutations: [{ target: 'counter.count', expression: 'counter.count + 1' }],
        cpis: [],
      },
      {
        name: 'decrement',
        accounts: [
          { name: 'counter', isMut: true, isSigner: false, accountType: 'CounterState' },
          { name: 'authority', isMut: false, isSigner: true },
        ],
        requires: ['counter.authority = authority.key()', 'counter.count > 0'],
        mutations: [{ target: 'counter.count', expression: 'counter.count - 1' }],
        cpis: [],
      },
    ],
  };

  const res = AnchorGenerator.generate(counterProgram);
  fs.writeFileSync(path.join(programSrcDir, 'lib.rs'), res.rustCode, 'utf-8');

  console.log('✓ Successfully synthesized Anchor workspace:');
  console.log(`  - ${anchorTomlPath}`);
  console.log(`  - ${cargoTomlPath}`);
  console.log(`  - ${path.join(programsDir, 'Cargo.toml')}`);
  console.log(`  - ${path.join(programSrcDir, 'lib.rs')}`);
}

const isCLI = typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('synthesize-anchor-workspace');
if (isCLI) {
  synthesizeAnchorWorkspace();
}

import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const cargoBin = path.join(process.env.HOME || '/root', '.cargo', 'bin');
const envPath = process.env.PATH ? `${cargoBin}:${process.env.PATH}` : cargoBin;

const skipCargo = process.argv.includes('--sync-only');

if (!skipCargo) {
  execFileSync(
    'cargo',
    [
      'build',
      '--manifest-path',
      'mvm/Cargo.toml',
      '-p',
      'mvm-wasm',
      '--target',
      'wasm32-unknown-unknown',
      '--release',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PATH: envPath },
    }
  );
}

const builtWasmPath = path.join(
  root,
  'mvm/target/wasm32-unknown-unknown/release/mvm_wasm.wasm'
);
const publicWasmPath = path.join(root, 'public/wasm/mvm_wasm.wasm');
const tsBytesPath = path.join(root, 'manifest-core/src/vm/mvm-wasm-bytes.ts');

if (!fs.existsSync(builtWasmPath)) {
  throw new Error(`Compiled WASM artifact not found at ${builtWasmPath}`);
}

const wasmBytes = fs.readFileSync(builtWasmPath);
const sha256 = crypto.createHash('sha256').update(wasmBytes).digest('hex');
const base64 = wasmBytes.toString('base64');

fs.mkdirSync(path.dirname(publicWasmPath), { recursive: true });
fs.copyFileSync(builtWasmPath, publicWasmPath);

const tsContent = [
  '// Auto-generated from compiled Rust crate mvm-wasm (wasm32-unknown-unknown)',
  `export const MVM_WASM_SHA256 = ${JSON.stringify(sha256)};`,
  `export const MVM_WASM_BYTE_LENGTH = ${wasmBytes.byteLength};`,
  `export const MVM_WASM_BASE64 = ${JSON.stringify(base64)};`,
  '',
].join('\n');

fs.writeFileSync(tsBytesPath, tsContent, 'utf8');

console.log(
  `Synced mvm_wasm.wasm (${wasmBytes.byteLength} bytes, sha256=${sha256}) -> public/wasm/mvm_wasm.wasm & manifest-core/src/vm/mvm-wasm-bytes.ts`
);

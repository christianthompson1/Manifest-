/**
 * Manifest — Stage 6 Performance Benchmark Suite
 *
 * Measures actual compilation and execution performance across:
 * 1. Rust WASM Compiler + MVM startup/init latency
 * 2. Rust WASM Compiler check & MIR emission vs TS Reference Compiler
 * 3. Rust WASM `.mbc` bytecode compilation
 * 4. Rust MVM WASM execution vs Direct `.wasm` execution vs Native `mvm` CLI (when built)
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  checkManifestInRust,
  compileManifestInRust,
  compileManifestV1,
  evaluateMIRModule,
  executeMbcInRustVm,
  inspectRustCompilerEngine,
} from '../src/index.ts';
import { parseSemanticModule } from '../src/core/parse-unified.ts';
import { TypeChecker } from '../src/semantics/type-checker.ts';
import { analyzeCapabilitiesAndEffects } from '../src/semantics/capability-analyzer.ts';
import { buildTypedIR } from '../src/ir/typed-ir-builder.ts';
import { optimizeMIR } from '../src/ir/ir-optimizer.ts';

const COLLATZ_PROG = `
module bench_collatz;
requires [console];
denies [net];

fn collatz(n0: i64) -> i64 {
    let mut n: i64 = n0;
    let mut steps: i64 = 0;
    while n > 1 {
        if (n % 2) == 0 {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    return steps;
}

fn main() -> i64 {
    let mut i: i64 = 2;
    let mut total: i64 = 0;
    while i <= 1500 {
        total = total + collatz(i);
        i = i + 1;
    }
    return total;
}
`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main(): Promise<void> {
  console.log('====================================================================');
  console.log('   MANIFEST STAGE 6 — RUST ENGINE & RUNTIME BENCHMARK');
  console.log('====================================================================');
  console.log(
    `Host: ${os.platform()} ${os.arch()} | CPU: ${os.cpus()[0]?.model || 'unknown'} | Node: ${process.version}\n`
  );

  const initStart = performance.now();
  await inspectRustCompilerEngine();
  await checkManifestInRust('module warmup; fn main() -> i64 { return 1; }');
  const wasmInitMs = performance.now() - initStart;

  const rustCheckTimes: number[] = [];
  const tsOracleCheckTimes: number[] = [];
  const rustCompileTimes: number[] = [];

  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await checkManifestInRust(COLLATZ_PROG);
    rustCheckTimes.push(performance.now() - t0);

    const t1 = performance.now();
    const ast = parseSemanticModule(COLLATZ_PROG);
    const tc = new TypeChecker().check(ast);
    const cap = analyzeCapabilitiesAndEffects(ast);
    const mir = buildTypedIR(ast, tc, cap);
    optimizeMIR(mir);
    tsOracleCheckTimes.push(performance.now() - t1);

    const t2 = performance.now();
    await compileManifestInRust(COLLATZ_PROG);
    rustCompileTimes.push(performance.now() - t2);
  }

  const builtMvm = await compileManifestV1(COLLATZ_PROG, { target: 'mvm' });
  const builtWasm = await compileManifestV1(COLLATZ_PROG, { target: 'wasm' });
  if (!builtMvm.mbcBytes || !builtWasm.wasmBytes || !builtMvm.mir) {
    throw new Error('Failed to compile Stage 6 benchmark program');
  }

  const tsEvalStart = performance.now();
  const tsEvalRes = evaluateMIRModule(builtMvm.mir, { maxSteps: 5_000_000 });
  const tsEvalMs = performance.now() - tsEvalStart;

  const mvmWasmStart = performance.now();
  const mvmWasmRes = await executeMbcInRustVm(builtMvm.mbcBytes, { maxSteps: 5_000_000 });
  const mvmWasmMs = performance.now() - mvmWasmStart;

  const wasmInst = await WebAssembly.instantiate(builtWasm.wasmBytes as BufferSource, {
    env: { print_i32: () => {}, print_f64: () => {}, print_i64: () => {} },
  });
  const directStart = performance.now();
  const directRet = ((wasmInst.instance.exports as any).main as () => bigint)();
  const directMs = performance.now() - directStart;

  let nativeCliMs: number | null = null;
  let nativeCliRet: string | null = null;
  const nativeBin = path.resolve('mvm/target/release/mvm');
  if (fs.existsSync(nativeBin)) {
    const tmpMbc = path.join(os.tmpdir(), 'stage6_bench.mbc');
    fs.writeFileSync(tmpMbc, builtMvm.mbcBytes);
    try {
      const n0 = performance.now();
      const out = execFileSync(nativeBin, ['run', tmpMbc, '--max-steps', '5000000'], {
        encoding: 'utf-8',
      });
      nativeCliMs = performance.now() - n0;
      nativeCliRet = (out.match(/=>\s*([^\r\n]+)/)?.[1] || '').trim();
    } finally {
      fs.rmSync(tmpMbc, { force: true });
    }
  }

  const report = {
    wasmInitMs: Number(wasmInitMs.toFixed(2)),
    rustCheckMedianMs: Number(median(rustCheckTimes).toFixed(2)),
    tsOracleCheckMedianMs: Number(median(tsOracleCheckTimes).toFixed(2)),
    rustCompileMbcMedianMs: Number(median(rustCompileTimes).toFixed(2)),
    mbcBytes: builtMvm.mbcBytes.byteLength,
    wasmBytes: builtWasm.wasmBytes.byteLength,
    mvmSteps: mvmWasmRes.steps,
    tsMirEvalMs: Number(tsEvalMs.toFixed(2)),
    rustMvmWasmMs: Number(mvmWasmMs.toFixed(2)),
    rustMvmNativeCliMs: nativeCliMs !== null ? Number(nativeCliMs.toFixed(2)) : 'skipped (native binary absent)',
    directWasmMs: Number(directMs.toFixed(3)),
    returnValueParity: {
      tsEval: String(tsEvalRes.returnValue),
      rustMvmWasm: mvmWasmRes.returnValue,
      directWasm: String(directRet),
      nativeCli: nativeCliRet ?? 'skipped',
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

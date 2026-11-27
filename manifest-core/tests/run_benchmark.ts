/**
 * Manifest — Canonical v1.0 Rust Compiler & MVM Runtime Benchmark Suite
 * Measures check/typecheck/MIR latency, .mbc & web-js compilation speed, memory delta,
 * pathological inputs, and execution performance across Rust MVM, TS MIR Evaluator,
 * Native CLI, and direct WebAssembly (.wasm).
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkManifestSource,
  compileManifestV1,
  evaluateMIRModule,
  executeMbcInRustVm,
} from '../src/index.ts';

interface BenchmarkRow {
  lineCount: number;
  checkMs: number;
  mbcBuildMs: number;
  webJsBuildMs: number;
  mbcBytes: number;
  heapDeltaKB: number;
  linesPerSec: number;
}

interface PathologicalRow {
  scenario: string;
  lineCount: number;
  checkMs: number;
  compileMs: number;
  success: boolean;
}

function generateRealisticV1Source(targetLines: number): string {
  const lines: string[] = [];
  lines.push('module realistic_bench;');
  lines.push('');
  lines.push('requires console;');
  lines.push('denies net, fs;');
  lines.push('');
  lines.push('struct BatchMetric {');
  lines.push('    id: i64,');
  lines.push('    weight: i64,');
  lines.push('}');
  lines.push('');
  lines.push('fn score_batch(m: BatchMetric) -> i64 {');
  lines.push('    if m.weight > 10 {');
  lines.push('        return (m.id * m.weight) + 5;');
  lines.push('    } else {');
  lines.push('        return m.id + m.weight;');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  let fnIdx = 0;
  while (lines.length < targetLines - 16) {
    fnIdx++;
    lines.push(`fn compute_stage_${fnIdx}(seed: i64) -> i64 {`);
    lines.push(`    let metric = BatchMetric { id: seed, weight: ${(fnIdx % 20) + 1} };`);
    lines.push(`    let base: i64 = score_batch(metric);`);
    lines.push(`    let mut acc: i64 = base;`);
    lines.push(`    if acc > 50 {`);
    lines.push(`        acc = acc - ${fnIdx % 7};`);
    lines.push(`    }`);
    lines.push(`    return acc;`);
    lines.push(`}`);
    lines.push('');
  }

  lines.push('fn main() -> i64 effects(console) {');
  lines.push(`    let res: i64 = compute_stage_${Math.max(1, fnIdx)}(42);`);
  lines.push('    console.print(res);');
  lines.push('    return res;');
  lines.push('}');
  return lines.join('\n');
}

function generateDeepExpressionSource(depth: number): string {
  let expr = '1';
  for (let i = 2; i <= depth; i++) {
    const op = i % 3 === 0 ? '*' : i % 2 === 0 ? '+' : '-';
    expr = `(${expr} ${op} ${i})`;
  }
  return [
    'module deep_expr_bench;',
    'fn main() -> i64 {',
    `    let result: i64 = ${expr};`,
    '    return result;',
    '}',
  ].join('\n');
}

function generateNestedControlFlowSource(depth: number): string {
  const lines: string[] = ['module nested_branch_bench;', 'fn main() -> i64 {', '    let mut acc: i64 = 1;'];
  for (let i = 0; i < depth; i++) {
    lines.push(`${'    '.repeat(i + 1)}if acc > 0 {`);
    lines.push(`${'    '.repeat(i + 2)}acc = acc + 1;`);
  }
  for (let i = depth - 1; i >= 0; i--) {
    lines.push(`${'    '.repeat(i + 1)}}`);
  }
  lines.push('    return acc;');
  lines.push('}');
  return lines.join('\n');
}

function generateForwardFunctionStressSource(fnCount: number): string {
  const lines: string[] = ['module forward_fn_stress;', 'fn main() -> i64 {', '    let mut sum: i64 = 0;'];
  for (let i = 1; i <= Math.min(fnCount, 50); i++) {
    lines.push(`    sum = sum + worker_${fnCount - i + 1}(${i});`);
  }
  lines.push('    return sum;');
  lines.push('}');
  for (let i = 1; i <= fnCount; i++) {
    lines.push(`fn worker_${i}(x: i64) -> i64 { return x + ${i}; }`);
  }
  return lines.join('\n');
}

async function runBenchmark() {
  console.log('================================================================================');
  console.log('   MANIFEST v1.0 — RUST COMPILER ENGINE & MVM BENCHMARK SUITE                   ');
  console.log('================================================================================\n');

  const sizes = [100, 1000, 5000];
  const results: BenchmarkRow[] = [];

  // JIT / WASM Warm-up
  const warmSrc = generateRealisticV1Source(120);
  await checkManifestSource(warmSrc);
  await compileManifestV1(warmSrc, { target: 'mvm' });

  console.log('1. REALISTIC MULTI-FUNCTION v1.0 PIPELINE SCALING (RUST ENGINE)');
  console.log('--------------------------------------------------------------------------------');

  for (const size of sizes) {
    const source = generateRealisticV1Source(size);
    const actualLines = source.split('\n').length;
    const heapBefore = process.memoryUsage().heapUsed;

    const c0 = performance.now();
    const checked = await checkManifestSource(source);
    const checkMs = performance.now() - c0;
    if (!checked.ok) {
      throw new Error(`Benchmark check failed at ${actualLines} lines: ${checked.diagnostics[0]?.message}`);
    }

    const m0 = performance.now();
    const mvmOut = await compileManifestV1(source, { target: 'mvm' });
    const mbcBuildMs = performance.now() - m0;
    if (!mvmOut.success || !mvmOut.mbcBytes) {
      throw new Error(`Benchmark .mbc build failed at ${actualLines} lines`);
    }

    const w0 = performance.now();
    const webOut = await compileManifestV1(source, { target: 'web-js' });
    const webJsBuildMs = performance.now() - w0;
    if (!webOut.success) {
      throw new Error(`Benchmark web-js build failed at ${actualLines} lines`);
    }

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaKB = Math.max(0, Math.round((heapAfter - heapBefore) / 1024));
    const linesPerSec = Math.round(actualLines / (Math.max(mbcBuildMs, 0.01) / 1000));

    results.push({
      lineCount: actualLines,
      checkMs: Number(checkMs.toFixed(2)),
      mbcBuildMs: Number(mbcBuildMs.toFixed(2)),
      webJsBuildMs: Number(webJsBuildMs.toFixed(2)),
      mbcBytes: mvmOut.mbcBytes.length,
      heapDeltaKB,
      linesPerSec,
    });

    console.log(
      `✓ [${actualLines.toString().padStart(5)} lines] Check+MIR: ${checkMs.toFixed(2)}ms | .mbc Build: ${mbcBuildMs.toFixed(2)}ms (${mvmOut.mbcBytes.length} B) | Web-JS: ${webJsBuildMs.toFixed(2)}ms | Heap: +${heapDeltaKB}KB (${linesPerSec.toLocaleString()} loc/s)`
    );
  }

  console.log('\n2. PATHOLOGICAL INPUT STRESS TESTS');
  console.log('--------------------------------------------------------------------------------');
  const pathologicalInputs: Array<{ name: string; source: string }> = [
    { name: '60-deep nested arithmetic expression', source: generateDeepExpressionSource(60) },
    { name: '25-level nested control-flow block hierarchy', source: generateNestedControlFlowSource(25) },
    { name: '250 forward function definitions & call resolution', source: generateForwardFunctionStressSource(250) },
  ];

  const pathologicalResults: PathologicalRow[] = [];
  for (const item of pathologicalInputs) {
    const pLines = item.source.split('\n').length;
    const c0 = performance.now();
    const ckRes = await checkManifestSource(item.source);
    const ckMs = performance.now() - c0;

    const b0 = performance.now();
    const cRes = await compileManifestV1(item.source, { target: 'mvm' });
    const bMs = performance.now() - b0;

    const ok = ckRes.ok && cRes.success;
    pathologicalResults.push({
      scenario: item.name,
      lineCount: pLines,
      checkMs: Number(ckMs.toFixed(2)),
      compileMs: Number(bMs.toFixed(2)),
      success: ok,
    });
    console.log(
      `✓ ${item.name.padEnd(52)} | ${pLines.toString().padStart(4)} lines | Check: ${ckMs.toFixed(2)}ms | Build: ${bMs.toFixed(2)}ms | Valid: ${ok}`
    );
  }

  console.log('\n3. MANIFEST v1.0 PIPELINE & RUST MVM vs TS EVALUATOR vs DIRECT WASM');
  console.log('--------------------------------------------------------------------------------');

  const v1NumericBenchSrc = `
module v1_loop_bench;

export fn sum_collatz_lengths(limit: i64) -> i64 {
    let mut total_steps: i64 = 0;
    let mut seed: i64 = 2;
    while seed <= limit {
        let mut n: i64 = seed;
        while n > 1 {
            if (n % 2) == 0 {
                n = n / 2;
            } else {
                n = 3 * n + 1;
            }
            total_steps = total_steps + 1;
        }
        seed = seed + 1;
    }
    return total_steps;
}

export fn main() -> i64 {
    return sum_collatz_lengths(2500);
}
`;

  const warmupMbc = await compileManifestV1(`module w; fn main() -> i64 { return 1; }`, { target: 'mvm' });
  await executeMbcInRustVm(warmupMbc.mbcBytes!);

  const c0 = performance.now();
  const checkedV1 = await checkManifestSource(v1NumericBenchSrc);
  const checkMs = performance.now() - c0;

  const b0 = performance.now();
  const mvmBuild = await compileManifestV1(v1NumericBenchSrc, { target: 'mvm' });
  const mbcBuildMs = performance.now() - b0;

  const w0 = performance.now();
  const wasmBuild = await compileManifestV1(v1NumericBenchSrc, { target: 'wasm' });
  const wasmBuildMs = performance.now() - w0;

  const te0 = performance.now();
  const tsEvalRes = evaluateMIRModule(checkedV1.mir!, { maxSteps: 5_000_000 });
  const tsEvalMs = performance.now() - te0;

  const rv0 = performance.now();
  const rustWasmRes = await executeMbcInRustVm(mvmBuild.mbcBytes!, { maxSteps: 5_000_000 });
  const rustWasmMs = performance.now() - rv0;

  const mvmBinPath = path.resolve('mvm/target/release/mvm');
  let rustNativeCliMs = 0;
  let nativeCliRet = 'skipped';
  if (fs.existsSync(mvmBinPath)) {
    const tmpMbc = path.join(os.tmpdir(), 'v1_bench.mbc');
    fs.writeFileSync(tmpMbc, mvmBuild.mbcBytes!);
    const nc0 = performance.now();
    const nativeCliRaw = execFileSync(
      mvmBinPath,
      ['run', tmpMbc, '--max-steps', '5000000'],
      { encoding: 'utf-8' }
    );
    rustNativeCliMs = performance.now() - nc0;
    nativeCliRet = (nativeCliRaw.match(/=>\s*([^\r\n]+)/)?.[1] || '').trim();
    fs.rmSync(tmpMbc, { force: true });
  }

  const wasmInst = await WebAssembly.instantiate(wasmBuild.wasmBytes! as BufferSource, {
    env: { print_i32: () => {}, print_f64: () => {}, print_i64: () => {} },
  });
  const dw0 = performance.now();
  const directWasmVal = ((wasmInst.instance.exports as any).main as () => bigint)();
  const directWasmMs = performance.now() - dw0;

  console.log(
    `✓ v1.0 Check (Parse+TypeCheck+Capability+MIR+Opt): ${checkMs.toFixed(2)}ms | .mbc Build+Verify: ${mbcBuildMs.toFixed(2)}ms (${mvmBuild.mbcBytes!.length} B) | .wasm Build: ${wasmBuildMs.toFixed(2)}ms (${wasmBuild.wasmBytes!.length} B)`
  );
  console.log(
    `✓ Collatz(2..2500) [${rustWasmRes.steps.toLocaleString()} VM steps, answer=${rustWasmRes.returnValue}]:`
  );
  console.log(`    • TypeScript MIR Reference Evaluator : ${tsEvalMs.toFixed(2)}ms (ret=${tsEvalRes.returnValue})`);
  console.log(`    • Rust MVM (WebAssembly embedded)    : ${rustWasmMs.toFixed(2)}ms (ret=${rustWasmRes.returnValue})`);
  console.log(`    • Rust MVM (Native CLI + spawn)      : ${rustNativeCliMs.toFixed(2)}ms (ret=${nativeCliRet})`);
  console.log(`    • Direct WebAssembly (.wasm target)  : ${directWasmMs.toFixed(3)}ms (ret=${String(directWasmVal)})`);

  const v1Summary = {
    checkMs: Number(checkMs.toFixed(2)),
    mbcBuildMs: Number(mbcBuildMs.toFixed(2)),
    mbcSizeBytes: mvmBuild.mbcBytes!.length,
    wasmBuildMs: Number(wasmBuildMs.toFixed(2)),
    wasmSizeBytes: wasmBuild.wasmBytes!.length,
    vmSteps: rustWasmRes.steps,
    tsMirEvalMs: Number(tsEvalMs.toFixed(2)),
    rustMvmWasmMs: Number(rustWasmMs.toFixed(2)),
    rustMvmNativeCliMs: Number(rustNativeCliMs.toFixed(2)),
    directWasmExecMs: Number(directWasmMs.toFixed(3)),
  };

  console.log('\n================================================================================');
  console.log('JSON SUMMARY:');
  console.log(JSON.stringify({ scaling: results, pathological: pathologicalResults, v1RuntimeComparison: v1Summary }, null, 2));
}

runBenchmark().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});

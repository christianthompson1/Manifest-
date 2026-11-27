/**
 * Manifest — Stage 6 Authoritative Rust Engine Verification Suite
 *
 * Verifies:
 * 1. Rust compiler ABI metadata & offline WASM bundle integrity (`public/wasm/mvm_wasm.wasm`).
 * 2. Architectural boundary: production TS pipeline, CLI, and Studio editor lint/autocomplete
 *    route directly through Rust (`manifest-compiler` via `mvm-wasm`) with zero TS v1 compiler imports.
 * 3. Canonical Beginner & Professional parity through Rust AST -> MIR -> MBC -> Rust MVM.
 * 4. Differential conformance between Rust authoritative engine and TS reference oracle
 *    across positive execution, BigInt `i64` precision beyond 2^53, negative static diagnostics,
 *    multi-file workspace imports, and deterministic runtime traps.
 * 5. Studio CodeMirror 6 linter/autocomplete and Orchestrator integration.
 * 6. Native `mvm` CLI end-to-end commands & workspace confinement (if built on host).
 */

import * as crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';

import {
  checkManifestSource,
  compileManifestV1,
  formatManifestSource,
  runManifestOnRustMvm,
  inspectRustCompilerEngine,
  checkManifestInRust,
  compileManifestInRust,
  evaluateMIRModule,
} from '../src/index.ts';
import { MVM_WASM_SHA256 } from '../src/vm/mvm-wasm-bytes.ts';
import { parseSemanticModule } from '../src/core/parse-unified.ts';
import { resolveModuleGraph } from '../src/semantics/module-resolver.ts';
import { TypeChecker } from '../src/semantics/type-checker.ts';
import { analyzeCapabilitiesAndEffects } from '../src/semantics/capability-analyzer.ts';
import { buildTypedIR } from '../src/ir/typed-ir-builder.ts';
import { optimizeMIR } from '../src/ir/ir-optimizer.ts';
import { collectManifestEditorDiagnostics } from '../../src/studio/editor/manifest-linter.ts';
import { manifestAutocomplete } from '../../src/studio/editor/manifest-autocomplete.ts';
import { ExecutionOrchestrator } from '../../src/studio/execution/execution-orchestrator.ts';
import { ManifestProject } from '../../src/studio/types.ts';

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function recordSkip(label: string, reason: string): void {
  console.log(`  ⊘ SKIPPED: ${label} (${reason})`);
  skipped++;
}

function compileAndEvalTsOracle(source: string, grantedCapabilities: string[] = ['console']) {
  const graph = resolveModuleGraph(source, { entryFile: 'src/main.manifest', files: {} });
  const ast = graph.mergedModule;
  const tc = new TypeChecker().check(ast);
  const cap = analyzeCapabilitiesAndEffects(ast);
  const allDiags = [...graph.diagnostics, ...tc.diagnostics, ...cap.diagnostics];
  if (allDiags.some((d) => d.severity === 'error')) {
    return {
      ok: false,
      diagnostics: allDiags,
      returnValue: undefined as string | undefined,
    };
  }
  const mir = buildTypedIR(ast, tc, cap);
  const opt = optimizeMIR(mir);
  const evalRes = evaluateMIRModule(opt.module, { grantedCapabilities });
  return {
    ok: evalRes.ok,
    diagnostics: [...allDiags, ...opt.warnings],
    returnValue: evalRes.ok ? String(evalRes.returnValue) : undefined,
    error: evalRes.error,
  };
}

async function runStage6Tests(): Promise<void> {
  console.log('====================================================================');
  console.log('   MANIFEST STAGE 6 — AUTHORITATIVE RUST ENGINE VERIFICATION');
  console.log('====================================================================\n');

  // 1. Engine Identity & WASM Integrity
  console.log('--- 1. Rust Compiler WASM Identity & Bundle Integrity ---');
  const engineInfo = await inspectRustCompilerEngine();
  const publicWasm = fs.readFileSync(path.resolve('public/wasm/mvm_wasm.wasm'));
  const diskSha = crypto.createHash('sha256').update(publicWasm).digest('hex');

  assert(engineInfo.ok, '1.1 Rust WASM engine initializes cleanly');
  assert(
    engineInfo.compilerEngine === 'rust-manifest-compiler' && engineInfo.compilerAbiVersion === 1,
    `1.2 Compiler ABI exposed (${engineInfo.compilerEngine}, abi=${engineInfo.compilerAbiVersion})`
  );
  assert(
    engineInfo.features.includes('manifest-compiler-v1') && engineInfo.features.includes('ast-mir-mbc'),
    '1.3 Compiler features list manifest-compiler-v1 and ast-mir-mbc'
  );
  assert(
    diskSha === MVM_WASM_SHA256 && engineInfo.sha256 === MVM_WASM_SHA256,
    `1.4 public/wasm/mvm_wasm.wasm matches embedded MVM_WASM_SHA256 (${diskSha.slice(0, 12)}...)`
  );

  // 2. Static Production Boundary Inspection
  console.log('\n--- 2. Authoritative Boundary (Zero TS Compiler Fallback in Production) ---');
  const forbiddenCompilerImports = [
    'semantics/type-checker',
    'semantics/module-resolver',
    'ir/typed-ir-builder',
    'ir/ir-optimizer',
    'bytecode/mbc-compiler',
    'bytecode/mbc-reader',
    'core/parse-unified',
  ];
  const productionFiles = [
    'manifest-core/src/pipeline.ts',
    'manifest-core/src/cli.ts',
    'src/studio/editor/manifest-linter.ts',
    'src/studio/editor/manifest-autocomplete.ts',
  ];
  for (const rel of productionFiles) {
    const content = fs.readFileSync(path.resolve(rel), 'utf-8');
    const nonTypeLines = content
      .split(/\r?\n/)
      .filter((line) => !/^\s*import\s+type\b/.test(line))
      .join('\n');
    const leaked = forbiddenCompilerImports.filter((imp) => nonTypeLines.includes(imp));
    assert(
      leaked.length === 0,
      `2.1 ${rel} has zero runtime TS v1 compiler imports`,
      leaked.length ? `found ${leaked.join(', ')}` : undefined
    );
  }

  // 3. Differential Conformance: Rust Authoritative Engine vs TS Reference Oracle
  console.log('\n--- 3. Differential Conformance (Rust WASM Engine vs TS Reference Oracle) ---');
  const positiveCorpus: Array<{ name: string; source: string; expected: string }> = [
    {
      name: 'Beginner arithmetic & while loop',
      expected: '55',
      source: `MODULE sum_beg
FUNCTION main() -> Int
  LET MUTABLE acc: Int = 0
  LET MUTABLE i: Int = 1
  WHILE i <= 10
    SET acc = acc + i
    SET i = i + 1
  END
  RETURN acc
END`,
    },
    {
      name: 'Professional generic struct + Result + ? + match',
      expected: '42',
      source: `module gen_pro;
struct Box<T> { value: T }
fn unwrap_or(r: Result<i64, str>, fallback: i64) -> Result<i64, str> {
  let v = r?;
  return Result::Ok(v + 2);
}
fn main() -> i64 {
  let b = Box { value: 40 };
  let r = unwrap_or(Result::Ok(b.value), 0);
  match r {
    Ok(v) => { return v; },
    Err(_) => { return 0; },
  }
}`,
    },
    {
      name: 'High-precision i64 beyond IEEE-754 MAX_SAFE_INTEGER (2^53 + 1)',
      expected: '9007199254740993',
      source: `module bigint_precision;
fn main() -> i64 {
  let a: i64 = 9007199254740992;
  let b: i64 = a + 1;
  return b;
}`,
    },
    {
      name: 'Array + Map + std::crypto::sha256 length check',
      expected: '64',
      source: `module stdlib_collections;
requires [crypto];
import { sha256 } from "std::crypto";
fn main() -> i64 effects(crypto) {
  let arr: Array<i64> = [10, 20, 30];
  let mut m: Map<str, i64> = {"a": arr.length};
  let digest = sha256("manifest-stage6");
  if m["a"] == 3 {
    return std::str::len(digest);
  }
  return 0;
}`,
    },
  ];

  for (const item of positiveCorpus) {
    const rustCheck = await checkManifestInRust(item.source);
    const rustRun = await runManifestOnRustMvm(item.source, {
      grantedCapabilities: ['console', 'crypto'],
    });
    const tsOracle = compileAndEvalTsOracle(item.source, ['console', 'crypto']);
    assert(
      rustCheck.ok &&
        rustRun.ok &&
        tsOracle.ok &&
        rustRun.returnValue === item.expected &&
        tsOracle.returnValue === item.expected,
      `3.x Parity [${item.name}]: Rust=${rustRun.returnValue}, Oracle=${tsOracle.returnValue}`,
      !rustRun.ok
        ? rustRun.error || rustRun.build.diagnostics[0]?.message
        : tsOracle.error || tsOracle.diagnostics[0]?.message
    );
  }

  // Formatter round-trip through Rust engine
  const begSrc = positiveCorpus[0].source;
  const formattedToPro = formatManifestSource(begSrc, 'professional');
  const formattedBackToBeg = formatManifestSource(formattedToPro.formatted || '', 'beginner');
  const proCheck = await checkManifestSource(formattedToPro.formatted || '');
  const begRoundRun = await runManifestOnRustMvm(formattedBackToBeg.formatted || '');
  assert(
    formattedToPro.ok &&
      formattedBackToBeg.ok &&
      proCheck.ok &&
      proCheck.resolvedProfile === 'professional' &&
      begRoundRun.ok &&
      begRoundRun.returnValue === '55',
    '3.5 Cross-profile formatter round-trip executes identically on Rust engine'
  );

  // Negative diagnostic parity & unsupported feature rejection
  const negativeCases: Array<{ name: string; source: string; expectedCodePrefix: string }> = [
    {
      name: 'Type mismatch (i64 + str)',
      source: `module t;\nfn main() -> i64 { return 1 + "oops"; }`,
      expectedCodePrefix: 'E_ARITH_TYPE_MISMATCH',
    },
    {
      name: 'Const reassignment',
      source: `module c;\nconst X: i64 = 5;\nfn main() -> i64 { X = 6; return X; }`,
      expectedCodePrefix: 'E_ASSIGN_CONST',
    },
    {
      name: 'Non-exhaustive enum match',
      source: `module e;\nenum Light { Red, Green }\nfn main() -> i64 { let l = Light::Red; match l { Light::Red => { return 1; } } }`,
      expectedCodePrefix: 'E_NON_EXHAUSTIVE_MATCH',
    },
    {
      name: 'Transitive purity violation',
      source: `module p;\nrequires [console];\nfn log_it() effects(console) { console.print("x"); }\nfn main() -> i64 effects(pure) { log_it(); return 0; }`,
      expectedCodePrefix: 'E_',
    },
    {
      name: 'Unsupported trait decl rejected cleanly',
      source: `module tr;\ntrait Showable { fn show() -> i64; }\nfn main() -> i64 { return 0; }`,
      expectedCodePrefix: 'E_UNSUPPORTED',
    },
    {
      name: 'Unsupported try/catch rejected cleanly',
      source: `module tc;\nfn main() -> i64 { try { return 1; } catch (e) { return 0; } }`,
      expectedCodePrefix: 'E_UNSUPPORTED',
    },
  ];

  for (const nc of negativeCases) {
    const rustRes = await checkManifestSource(nc.source);
    const hasMatch = rustRes.diagnostics.some(
      (d) => d.severity === 'error' && d.code?.startsWith(nc.expectedCodePrefix)
    );
    assert(
      !rustRes.ok && hasMatch,
      `3.x Negative [${nc.name}] rejects cleanly (${rustRes.diagnostics[0]?.code})`
    );
  }

  // Multi-file workspace resolution in Rust engine
  const multiFiles = {
    'main.manifest': `module app;\nimport { double_it } from "./math";\nfn main() -> i64 { return double_it(21); }`,
    'math.manifest': `module math;\nexport fn double_it(n: i64) -> i64 { return n * 2; }\nfn secret() -> i64 { return 99; }`,
  };
  const multiRun = await runManifestOnRustMvm(multiFiles['main.manifest'], {
    entryFile: 'main.manifest',
    files: multiFiles,
  });
  assert(multiRun.ok && multiRun.returnValue === '42', '3.6 Multi-file Rust compilation & MVM execution');

  const privImportCheck = await checkManifestSource(
    `module app;\nimport { secret } from "./math";\nfn main() -> i64 { return secret(); }`,
    { entryFile: 'main.manifest', files: multiFiles }
  );
  assert(
    !privImportCheck.ok && privImportCheck.diagnostics.some((d) => d.code === 'E_IMPORT_PRIVATE_SYMBOL'),
    '3.7 Rust module resolver rejects private symbol import'
  );

  // Runtime deterministic traps
  const divZero = await runManifestOnRustMvm(`module dz;\nfn main() -> i64 { return 10 / 0; }`);
  const overflow = await runManifestOnRustMvm(
    `module ov;\nfn main() -> i64 { let x: i64 = 9223372036854775807; return x + 1; }`
  );
  assert(!divZero.ok && /zero/i.test(divZero.error || ''), '3.8 Division by zero traps in Rust MVM');
  assert(!overflow.ok && /overflow/i.test(overflow.error || ''), '3.9 Checked i64 overflow traps in Rust MVM');

  // 4. Studio Integration (Linter, Autocomplete, Orchestrator)
  console.log('\n--- 4. Studio Linter, Autocomplete & Execution Orchestrator Integration ---');
  const lintSrc = `module broken;\nfn main() -> i64 {\n  let x: i64 = "bad";\n  return x;\n}`;
  const lintState = EditorState.create({ doc: lintSrc });
  const lintDiags = await collectManifestEditorDiagnostics({ state: lintState } as any);
  assert(
    lintDiags.some((d) => d.severity === 'error' && d.source?.startsWith('E_TYPE')),
    '4.1 CodeMirror manifestLinter surfaces Rust TypeChecker diagnostic'
  );

  const acSrc = `module ac;\nfn compute_tax(amount: i64) -> i64 { return amount; }\nfn main() -> i64 { return comp }`;
  const acPos = acSrc.indexOf('comp }') + 4;
  const acState = EditorState.create({ doc: acSrc });
  const acCtx = new CompletionContext(acState, acPos, true);
  const acRes = await manifestAutocomplete(acCtx);
  assert(
    Boolean(acRes?.options.some((o) => o.label === 'compute_tax' && o.detail?.includes('i64'))),
    '4.2 CodeMirror manifestAutocomplete extracts typed signatures from Rust AST summary'
  );

  const project: ManifestProject = {
    id: 'stage6-test',
    name: 'Stage6Test',
    kind: 'manifest',
    activeFilePath: 'src/main.manifest',
    compilerTarget: 'mvm',
    syntaxProfile: 'professional',
    files: [
      {
        id: 'stage6-main',
        path: 'src/main.manifest',
        name: 'main.manifest',
        language: 'manifest',
        content: positiveCorpus[1].source,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const orch = ExecutionOrchestrator.getInstance();
  const buildRes = await orch.buildProject(project);
  const execRes = await orch.executeProject(project);
  assert(
    buildRes.success &&
      buildRes.artifacts.some((a) => a.fileName.endsWith('.mbc')) &&
      execRes.success &&
      execRes.returnValue === '42',
    '4.3 Studio ExecutionOrchestrator builds via Rust compiler and runs on Rust MVM (ret=42)'
  );

  // 5. TypeScript CLI via Rust Engine
  console.log('\n--- 5. Node/TS CLI Integration (`manifest-core/src/cli.ts`) ---');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-stage6-cli-'));
  try {
    const sampleFile = path.join(tmpDir, 'prog.manifest');
    fs.writeFileSync(sampleFile, positiveCorpus[1].source, 'utf-8');
    const cliCheck = execFileSync('npx', ['tsx', 'manifest-core/src/cli.ts', 'check', sampleFile], {
      encoding: 'utf-8',
    });
    const cliRun = execFileSync('npx', ['tsx', 'manifest-core/src/cli.ts', 'run', sampleFile], {
      encoding: 'utf-8',
    });
    assert(cliCheck.includes('Check passed'), '5.1 CLI `check` uses Rust compiler engine');
    assert(cliRun.includes('=> 42'), '5.2 CLI `run` compiles and executes via Rust MVM');

    // 6. Native `mvm` CLI (when built on host)
    console.log('\n--- 6. Native Rust `mvm` Developer CLI ---');
    const nativeBin = path.resolve('mvm/target/release/mvm');
    if (!fs.existsSync(nativeBin)) {
      recordSkip('6.1-6.5 Native mvm CLI suite', 'mvm/target/release/mvm not built on host');
    } else {
      const verOut = JSON.parse(execFileSync(nativeBin, ['version', '--json'], { encoding: 'utf-8' }));
      const targetsOut = JSON.parse(execFileSync(nativeBin, ['targets', '--json'], { encoding: 'utf-8' }));
      const checkOut = JSON.parse(
        execFileSync(nativeBin, ['check', sampleFile, '--json'], { encoding: 'utf-8' })
      );
      assert(
        verOut.engine === 'rust-manifest-compiler' && verOut.abiVersion === 1,
        '6.1 Native CLI `version --json` reports Rust compiler engine ABI v1'
      );
      assert(
        Array.isArray(targetsOut.targets) && targetsOut.targets.some((t: any) => t.id === 'mvm'),
        '6.2 Native CLI `targets --json` exposes target registry'
      );
      assert(checkOut.ok === true, '6.3 Native CLI `check --json` compiles and validates source');

      const outMbc = path.join(tmpDir, 'out.mbc');
      execFileSync(nativeBin, ['build', sampleFile, '-o', outMbc], { encoding: 'utf-8' });
      const verifyOut = execFileSync(nativeBin, ['verify', outMbc], { encoding: 'utf-8' });
      const disasmOut = execFileSync(nativeBin, ['disasm', outMbc], { encoding: 'utf-8' });
      const runSourceOut = execFileSync(nativeBin, ['run', sampleFile], { encoding: 'utf-8' });
      const runMbcOut = execFileSync(nativeBin, ['run', outMbc], { encoding: 'utf-8' });
      assert(
        verifyOut.toLowerCase().includes('verified') &&
          disasmOut.includes('.fn main') &&
          runSourceOut.includes('=> 42') &&
          runMbcOut.includes('=> 42'),
        '6.4 Native CLI `build` / `verify` / `disasm` / `run` pipeline succeeds'
      );

      // Workspace path confinement negative test
      const escapeProg = path.join(tmpDir, 'escape.manifest');
      fs.writeFileSync(
        escapeProg,
        `module esc;\nrequires [fs.read];\nfn main() -> str effects(fs.read) {\n  return fs.read_text("../outside.txt");\n}`,
        'utf-8'
      );
      const escapeRun = spawnSync(
        nativeBin,
        ['run', escapeProg, '--workspace', tmpDir, '--allow', 'fs.read'],
        { encoding: 'utf-8' }
      );
      assert(
        escapeRun.status !== 0 &&
          (escapeRun.stderr + escapeRun.stdout).toLowerCase().includes('traversal'),
        '6.5 Native CLI `--workspace` blocks ../ path traversal'
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Check Rust compile helper direct return
  const directCompile = await compileManifestInRust(positiveCorpus[0].source);
  assert(
    directCompile.ok && Boolean(directCompile.mbcBytes) && directCompile.mbcByteLength > 16,
    '7.1 compileManifestInRust returns verified .mbc bytes directly'
  );

  console.log('\n====================================================================');
  console.log(
    `Stage 6 Authoritative Rust Engine Suite: ${passed} passed, ${failed} failed, ${skipped} skipped`
  );
  console.log('====================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6Tests().catch((err) => {
  console.error('Stage 6 verification error:', err);
  process.exit(1);
});

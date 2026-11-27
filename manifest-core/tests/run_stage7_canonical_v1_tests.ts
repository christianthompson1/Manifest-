/**
 * Manifest — Stage 7 Canonical v1.0 Architecture Verification Suite
 *
 * Verifies complete removal of legacy Manifest v0.x syntax, compiler/interpreter modules,
 * and declarative UI testbench while preserving:
 * 1. Canonical Manifest v1.0 (Beginner + Professional) -> Rust Compiler Engine -> Typed MIR -> .mbc / web-js / wasm / native.
 * 2. Standalone Solana PROGRAM smart-contract pipeline (Anchor Rust + IDL + deterministic simulator).
 * 3. Explicit opt-in v0.x -> v1.0 migration (`migrateV0ToV1`) without silent compiler fallback.
 * 4. Studio templates, linter diagnostics, Express HTTP server APIs, and codebase cleanliness.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { EditorState } from '@codemirror/state';
import {
  checkManifestSource,
  compileManifestV1,
  compileSolanaProgramSource,
  evaluateMIRModule,
  formatManifestSource,
  isSolanaProgramSource,
  migrateV0ToV1,
  parseSolanaProgramSource,
  runManifestOnRustMvm,
  SolanaSimulator,
} from '../src/index.ts';
import { collectManifestEditorDiagnostics } from '../../src/studio/editor/manifest-linter.ts';
import { TEMPLATES, createBlankProject } from '../../src/studio/project-store.ts';
import { ExecutionOrchestrator } from '../../src/studio/execution/execution-orchestrator.ts';
import { createManifestServerApp } from '../../server.ts';

export interface Stage7TestItemResult {
  name: string;
  passed: boolean;
  status: 'PASSED' | 'FAILED';
  reason?: string;
}

export interface Stage7TestSummary {
  passed: number;
  failed: number;
  total: number;
  results: Stage7TestItemResult[];
}

function collectFilesRecursive(dir: string, exts: Set<string>): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'target') {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectFilesRecursive(full, exts));
    } else if (exts.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

export async function runStage7CanonicalV1Tests(): Promise<Stage7TestSummary> {
  const results: Stage7TestItemResult[] = [];
  let passed = 0;
  let failed = 0;

  function record(name: string, cond: boolean, reason?: string): void {
    if (cond) {
      passed++;
      results.push({ name, passed: true, status: 'PASSED' });
    } else {
      failed++;
      results.push({ name, passed: false, status: 'FAILED', reason });
    }
  }

  // --------------------------------------------------------------------------
  // 1. Deleted Legacy Directories & Files Absence Check
  // --------------------------------------------------------------------------
  const deletedPaths = [
    'manifest-core/src/lexer',
    'manifest-core/src/ast',
    'manifest-core/src/parser',
    'manifest-core/src/validator',
    'manifest-core/src/events',
    'manifest-core/src/modules',
    'manifest-core/src/compiler',
    'manifest-core/examples',
    'manifest-core/src/runtime/runtime.ts',
    'manifest-core/src/runtime/scope.ts',
    'manifest-core/src/runtime/values.ts',
    'manifest-core/src/ir/ir.ts',
    'manifest-core/src/ir/ir-builder.ts',
    'manifest-core/src/ir/index.ts',
  ];
  const lingeringPaths = deletedPaths.filter((p) => fs.existsSync(path.resolve(p)));
  record(
    '1.1 Deleted legacy TS v0.x folders and runtime/IR files remain removed',
    lingeringPaths.length === 0,
    lingeringPaths.length ? `Found lingering legacy paths: ${lingeringPaths.join(', ')}` : undefined
  );

  // --------------------------------------------------------------------------
  // 2. Repository Scan for Forbidden Legacy Symbols & v0.x Examples
  // --------------------------------------------------------------------------
  const forbiddenRegex =
    /\b(isLegacyDomainManifestSource|inspectManifest|generateManifestIR|generateManifestIRFromAST|compileManifestIR|executeManifest|JavaScriptTargetCompiler|JSTargetCompiler|ReferenceTestbench|onSwitchToTestbench|generateCanvasHtml)\b/;
  const codeFiles = [
    ...collectFilesRecursive(path.resolve('src'), new Set(['.ts', '.tsx'])),
    ...collectFilesRecursive(path.resolve('manifest-core/src'), new Set(['.ts', '.tsx'])),
    path.resolve('server.ts'),
  ];
  const symbolHits: string[] = [];
  for (const f of codeFiles) {
    const text = fs.readFileSync(f, 'utf-8');
    const m = text.match(forbiddenRegex);
    if (m) {
      symbolHits.push(`${path.relative(process.cwd(), f)} (${m[1]})`);
    }
  }
  record(
    '2.1 Zero forbidden legacy TS compiler/testbench symbols in src/, manifest-core/src/, and server.ts',
    symbolHits.length === 0,
    symbolHits.length ? symbolHits.join('; ') : undefined
  );

  const exampleFiles = collectFilesRecursive(path.resolve('examples'), new Set(['.manifest']));
  const legacyExampleHits: string[] = [];
  for (const ef of exampleFiles) {
    const src = fs.readFileSync(ef, 'utf-8');
    if (!isSolanaProgramSource(src)) {
      const dir = path.dirname(ef);
      const siblingFiles: Record<string, string> = {};
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.manifest')) {
          siblingFiles[name] = fs.readFileSync(path.join(dir, name), 'utf-8');
        }
      }
      const ck = await checkManifestSource(src, {
        entryFile: path.basename(ef),
        files: siblingFiles,
      });
      if (!ck.ok) {
        legacyExampleHits.push(`${path.relative(process.cwd(), ef)}: ${ck.diagnostics[0]?.code}`);
      }
    } else {
      const sp = parseSolanaProgramSource(src);
      if (!sp.program || sp.diagnostics.some((d) => d.severity === 'error')) {
        legacyExampleHits.push(`${path.relative(process.cwd(), ef)}: invalid PROGRAM`);
      }
    }
  }
  record(
    '2.2 All repository examples/*.manifest compile cleanly under canonical v1.0 / Solana PROGRAM',
    exampleFiles.length >= 4 && legacyExampleHits.length === 0,
    legacyExampleHits.length ? legacyExampleHits.join('; ') : undefined
  );

  // --------------------------------------------------------------------------
  // 3. Explicit Rejection of Legacy v0.x Syntax (Zero Silent Fallback)
  // --------------------------------------------------------------------------
  const legacySnippets: Array<{ label: string; source: string }> = [
    { label: 'APP + PAGE', source: 'APP "Demo"\nPAGE Home\n  TEXT "Hi"\nEND' },
    { label: 'STATE + ACTION', source: 'STATE count TO 0\nACTION inc\n  SET count TO count + 1\nEND' },
    { label: 'DEFINE + COMPONENT', source: 'COMPONENT Card\n  DEFINE x TO 1\nEND' },
    { label: 'WHEN app.starts', source: 'WHEN app.starts\n  SHOW "Hi"\nEND' },
    { label: 'USE WEB', source: 'USE WEB\nFUNCTION main() -> Int\n  RETURN 0\nEND' },
    { label: 'USE SOLANA + APP wrapper', source: 'APP "V"\nUSE SOLANA\nPROGRAM Vault\n  ACCOUNT S\n    x: NUMBER\n  END\nEND' },
  ];

  for (const item of legacySnippets) {
    const ck = await checkManifestSource(item.source);
    const hasLegacyErr = !ck.ok && ck.diagnostics.some((d) => d.code === 'E_LEGACY_V0_REMOVED');
    record(
      `3.x Rust compiler rejects v0.x syntax [${item.label}] with E_LEGACY_V0_REMOVED`,
      hasLegacyErr,
      `codes=${ck.diagnostics.map((d) => d.code).join(',')}`
    );
  }

  const linterLegacy = await collectManifestEditorDiagnostics({
    state: EditorState.create({ doc: 'APP "Legacy"\nPAGE Home\n  TEXT "Old"\nEND' }),
  } as any);
  record(
    '3.7 Studio CodeMirror linter surfaces E_LEGACY_V0_REMOVED on v0.x source',
    linterLegacy.some((d) => d.severity === 'error' && d.source === 'E_LEGACY_V0_REMOVED')
  );

  const solanaWrapperParse = parseSolanaProgramSource('USE SOLANA\nPROGRAM Vault\nEND');
  record(
    '3.8 Solana parser rejects v0.x USE SOLANA / APP wrapper with E_LEGACY_V0_REMOVED',
    solanaWrapperParse.diagnostics.some((d) => d.code === 'E_LEGACY_V0_REMOVED')
  );

  // --------------------------------------------------------------------------
  // 4. Canonical Manifest v1.0 (Beginner & Professional) Multi-Target Pipeline
  // --------------------------------------------------------------------------
  const proSrc = `module payroll;
requires console;
denies net;

struct Line { base: i64, bonus: i64 }

fn total(l: Line) -> i64 {
    return l.base + l.bonus;
}

fn main() -> i64 effects(console) {
    let item = Line { base: 300, bonus: 50 };
    let t: i64 = total(item);
    console.print(t);
    return t;
}`;

  const begSrc = `MODULE payroll
REQUIRES console
DENIES net

FUNCTION total(base: Int, bonus: Int) RETURNS Int
    RETURN base + bonus
END

FUNCTION main() RETURNS Int EFFECTS console
    LET t: Int = total(300, 50)
    SHOW t
    RETURN t
END`;

  const proMvm = await runManifestOnRustMvm(proSrc, { grantedCapabilities: ['console'] });
  const begMvm = await runManifestOnRustMvm(begSrc, { grantedCapabilities: ['console'] });
  const proMirCheck = await checkManifestSource(proSrc);
  const proOracle = evaluateMIRModule(proMirCheck.mir!, { grantedCapabilities: ['console'] });

  record(
    '4.1 Professional & Beginner profiles compile via Rust engine and execute identically on Rust MVM (350)',
    proMvm.ok &&
      begMvm.ok &&
      proOracle.ok &&
      proMvm.returnValue === '350' &&
      begMvm.returnValue === '350' &&
      String(proOracle.returnValue) === '350',
    `pro=${proMvm.returnValue}, beg=${begMvm.returnValue}, oracle=${proOracle.returnValue}`
  );

  const webBuild = await compileManifestV1(proSrc, { target: 'web-js' });
  const wasmBuild = await compileManifestV1(
    `module w;\nexport fn main() -> i64 { return 21 + 21; }`,
    { target: 'wasm' }
  );
  const nativeBuild = await compileManifestV1(proSrc, { target: 'native' });
  record(
    '4.2 Canonical targets web-js, wasm, and native all emit real build artifacts',
    Boolean(
      webBuild.success &&
        webBuild.jsCode?.includes('__runManifestModule') &&
        wasmBuild.success &&
        wasmBuild.wasmBytes &&
        wasmBuild.wasmBytes.byteLength > 8 &&
        nativeBuild.success &&
        nativeBuild.rustCode?.includes('fn main')
    )
  );

  // --------------------------------------------------------------------------
  // 5. Standalone Solana PROGRAM Compilation & Honest Target Boundaries
  // --------------------------------------------------------------------------
  const solanaSrc = `PROGRAM VaultProgram
    ACCOUNT VaultState
        balance: NUMBER
        authority: ADDRESS
    END

    INSTRUCTION deposit
        REQUIRE signer = authority
        SET balance = balance + 100
    END
END`;

  record(
    '5.1 isSolanaProgramSource accepts standalone PROGRAM block and rejects APP/USE SOLANA wrappers',
    isSolanaProgramSource(solanaSrc) === true && isSolanaProgramSource(`APP "X"\n${solanaSrc}`) === false
  );

  const solBuild = await compileManifestV1(solanaSrc, { target: 'solana-sbf' });
  const solParsed = parseSolanaProgramSource(solanaSrc);
  const sim = solParsed.program ? new SolanaSimulator(solParsed.program) : null;
  let simBalanceOk = false;
  if (sim) {
    sim.initializeDefaultAccounts('Auth1111111111111111111111111111111111111111');
    const txRes = sim.executeInstruction('deposit', 'Auth1111111111111111111111111111111111111111');
    const badTx = sim.executeInstruction('deposit', 'Unauthorized999');
    const pdaAcc = Object.values(txRes.accounts).find((a) => 'balance' in (a.data || {}));
    simBalanceOk = txRes.success && Number(pdaAcc?.data?.balance) > 0 && badTx.success === false;
  }
  record(
    '5.2 Standalone Solana PROGRAM compiles to Anchor Rust + IDL JSON and simulates deterministically',
    Boolean(
      solBuild.success &&
        solBuild.rustCode?.includes('#[program]') &&
        solBuild.idlJson?.includes('"deposit"') &&
        simBalanceOk
    )
  );

  const plainModuleOnSolana = await compileManifestV1(proSrc, { target: 'solana-sbf' });
  record(
    '5.3 General-purpose module targeting solana-sbf fails cleanly with E_SOLANA_CONTRACT_REQUIRED',
    !plainModuleOnSolana.success &&
      plainModuleOnSolana.diagnostics.some((d) => d.code === 'E_SOLANA_CONTRACT_REQUIRED')
  );

  const programOnMvm = await compileManifestV1(solanaSrc, { target: 'mvm' });
  record(
    '5.4 Standalone Solana PROGRAM targeting mvm fails cleanly with E_SOLANA_TARGET_ONLY',
    !programOnMvm.success && programOnMvm.diagnostics.some((d) => d.code === 'E_SOLANA_TARGET_ONLY')
  );

  // --------------------------------------------------------------------------
  // 6. Explicit Opt-In Migration (`migrateV0ToV1`) Round-Trip
  // --------------------------------------------------------------------------
  const oldV0Program = `APP "LegacyCounter"
STATE count TO 10
WHEN app.starts
    SET count TO count + 5
    SHOW count
END`;
  const migrated = migrateV0ToV1(oldV0Program, { targetProfile: 'beginner' });
  const migratedRun = await runManifestOnRustMvm(migrated.migratedSource, {
    grantedCapabilities: ['console'],
  });
  record(
    '6.1 Explicit migrateV0ToV1 produces canonical v1.0 code that compiles and runs on Rust MVM',
    migrated.changes.length > 0 && migratedRun.ok && migratedRun.stdout.some((line) => line.includes('15')),
    migratedRun.error
  );

  // --------------------------------------------------------------------------
  // 7. Studio Templates & Orchestrator Integrity
  // --------------------------------------------------------------------------
  const badTemplates: string[] = [];
  for (const tpl of TEMPLATES) {
    for (const f of tpl.files) {
      if (f.path === 'manifest.toml' && (/\[app\]/.test(f.content) || /0\.[24]\.0/.test(f.content))) {
        badTemplates.push(`${tpl.id}:${f.path}`);
      }
      if (f.language === 'manifest' && /^\s*(APP|PAGE|STATE|ACTION|USE\s+SOLANA|USE\s+WEB)\b/m.test(f.content)) {
        badTemplates.push(`${tpl.id}:${f.path}`);
      }
    }
  }
  const blank = createBlankProject();
  record(
    '7.1 All Studio templates and blank starter use canonical v1.0 [package] + v1.0/PROGRAM source',
    badTemplates.length === 0 && blank.files.some((f) => f.content.includes('version = "1.0.0"')),
    badTemplates.length ? badTemplates.join(', ') : undefined
  );

  const formattedPro = formatManifestSource(begSrc, 'professional');
  const orch = ExecutionOrchestrator.getInstance();
  const blankRun = await orch.executeProject(blank);
  record(
    '7.2 Studio formatter + ExecutionOrchestrator compile and execute canonical starter cleanly',
    Boolean(formattedPro.ok && blankRun.success && blankRun.returnValue === '0')
  );

  // --------------------------------------------------------------------------
  // 8. Express Server APIs (/api/health, /api/compile, /api/solana/verify)
  // --------------------------------------------------------------------------
  const server = createManifestServerApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (err) => reject(err));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const health = await (await fetch(`${base}/api/health`)).json();
    const compilePro = await (
      await fetch(`${base}/api/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: proSrc, target: 'mvm' }),
      })
    ).json();
    const compileLegacy = await (
      await fetch(`${base}/api/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'APP "Legacy"\nPAGE Home\nEND', target: 'mvm' }),
      })
    ).json();
    const solVerify = await (
      await fetch(`${base}/api/solana/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: solanaSrc }),
      })
    ).json();

    record(
      '8.1 Express /api/health returns version 1.0.0',
      health.status === 'ok' && health.version === '1.0.0'
    );
    record(
      '8.2 Express /api/compile succeeds on v1.0 module and rejects v0.x with E_LEGACY_V0_REMOVED',
      Boolean(
        compilePro.success &&
          compilePro.disassembly &&
          compileLegacy.success === false &&
          compileLegacy.diagnostics?.some((d: any) => d.code === 'E_LEGACY_V0_REMOVED')
      )
    );
    record(
      '8.3 Express /api/solana/verify generates Anchor artifacts and passes LiteSVM simulation',
      Boolean(solVerify.success && solVerify.anchor?.rustCode && solVerify.litesvm?.passedCount > 0)
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return {
    passed,
    failed,
    total: passed + failed,
    results,
  };
}

export async function runAllTests(): Promise<Stage7TestSummary> {
  return runStage7CanonicalV1Tests();
}

const isDirectCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_stage7_canonical_v1_tests.ts'));

if (isDirectCLI) {
  runStage7CanonicalV1Tests()
    .then((summary) => {
      console.log('====================================================================');
      console.log('   MANIFEST STAGE 7 — CANONICAL v1.0 ARCHITECTURE VERIFICATION');
      console.log('====================================================================');
      for (const r of summary.results) {
        console.log(`  ${r.passed ? '✓' : '✗ FAIL:'} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`);
      }
      console.log(`\nStage 7 Canonical v1.0 Summary: ${summary.passed}/${summary.total} passed (${summary.failed} failed)`);
      if (summary.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('Fatal error in run_stage7_canonical_v1_tests:', err);
      process.exit(1);
    });
}

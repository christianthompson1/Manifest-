/**
 * Manifest v1.0 Major Upgrade — Comprehensive End-to-End Verification Suite
 * Covers Task 2 (Dual-Profile Parsers, Formatter, Multi-File Modules, Static TypeChecker,
 * Capability & Effect Verifier, Typed MIR & Optimizer, .mbc v1.0 Bytecode & Verifier,
 * Safe Rust MVM in WASM & Native CLI) and Task 3 (Direct .wasm, Sandboxed Web/JS,
 * Native rustc Backend, CLI, /examples/**, Studio Orchestrator Run vs Build, .mbc ZIP,
 * and Live Editor Linter Diagnostics).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import {
  checkManifestSource,
  compileManifestV1,
  runManifestOnRustMvm,
  formatManifestSource,
  evaluateMIRModule,
  compileMIRToMbc,
  verifyMbcBytes,
  disassembleMbcBytes,
  MbcOpcode,
  executeMbcInRustVm,
  verifyMbcInRustVm,
  emitStandaloneRustSource,
  COMPILER_TARGETS,
} from '../src/index.ts';
import { ExecutionOrchestrator } from '../../src/studio/execution/execution-orchestrator.ts';
import { encodeMbcDataUrl, decodeMbcFileContent } from '../../src/studio/compiler-service.ts';
import { exportProjectToZip, importProjectFromZip } from '../../src/studio/services/zip-service.ts';
import { collectManifestEditorDiagnostics } from '../../src/studio/editor/manifest-linter.ts';
import { ManifestProject } from '../../src/studio/types.ts';
import { EditorState } from '@codemirror/state';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log('   MANIFEST v1.0 — LANGUAGE CORE, BYTECODE, RUST MVM & STUDIO TESTS ');
  console.log('====================================================================');

  // ---------------------------------------------------------------------------
  // 1. Dual Syntax Profiles (Beginner <-> Professional) & Formatter Equivalence
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Dual Syntax Profiles & Formatter Equivalence ---');

  const beginnerProg = `
MODULE calc_equiv
REQUIRES console
DENIES net

FUNCTION sum_evens(limit: Int) -> Int
    MUTABLE acc: Int = 0
    MUTABLE i: Int = 1
    WHILE i <= limit
        IF (i % 2) == 0
            SET acc TO acc + i
        END
        SET i TO i + 1
    END
    RETURN acc
END

FUNCTION main() -> Int EFFECTS console
    LET ans: Int = sum_evens(10)
    SHOW "Evens=" + to_str(ans)
    RETURN ans
END
`;

  const proProg = `
module calc_equiv;
requires [console];
denies [net];

fn sum_evens(limit: i64) -> i64 {
    let mut acc: i64 = 0;
    let mut i: i64 = 1;
    while i <= limit {
        if (i % 2) == 0 {
            acc = acc + i;
        }
        i = i + 1;
    }
    return acc;
}

fn main() -> i64 effects(console) {
    let ans: i64 = sum_evens(10);
    print("Evens=" + to_str(ans));
    return ans;
}
`;

  const begRun = await runManifestOnRustMvm(beginnerProg);
  const proRun = await runManifestOnRustMvm(proProg);

  assert(begRun.ok && begRun.resolvedProfile === 'beginner', '1.1 Beginner profile compiles & runs on Rust MVM');
  assert(proRun.ok && proRun.resolvedProfile === 'professional', '1.2 Professional profile compiles & runs on Rust MVM');
  assert(
    begRun.returnValue === '30' && proRun.returnValue === '30',
    `1.3 Beginner (${begRun.returnValue}) and Professional (${proRun.returnValue}) produce identical return value 30`
  );
  assert(
    JSON.stringify(begRun.stdout) === JSON.stringify(proRun.stdout) && begRun.stdout[0] === 'Evens=30',
    '1.4 Beginner and Professional produce identical stdout on Rust MVM'
  );
  assert(
    begRun.build.irText === proRun.build.irText,
    '1.5 Beginner and Professional lower to byte-for-byte identical Typed MIR text'
  );

  const begToPro = formatManifestSource(beginnerProg, 'professional');
  assert(begToPro.ok && Boolean(begToPro.formatted?.includes('fn sum_evens')), '1.6 Formatter converts Beginner -> Professional');
  const proBackToBeg = formatManifestSource(begToPro.formatted!, 'beginner');
  assert(proBackToBeg.ok && Boolean(proBackToBeg.formatted?.includes('FUNCTION sum_evens')), '1.7 Formatter converts Professional -> Beginner');
  const roundTripRun = await runManifestOnRustMvm(proBackToBeg.formatted!);
  assert(
    roundTripRun.ok && roundTripRun.returnValue === '30' && roundTripRun.stdout[0] === 'Evens=30',
    '1.8 Cross-profile round-trip formatted program preserves exact Rust MVM behavior'
  );

  // ---------------------------------------------------------------------------
  // 2. Multi-File Module Graph Resolution (Valid, Private, Circular)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Multi-File Module Graph Resolution ---');

  const multiFiles = {
    'src/lib_rates.manifest': `
module lib_rates;
export const BASE_FEE: i64 = 25;
fn secret_internal() -> i64 { return 999; }
export fn apply_rate(v: i64) -> i64 { return v * 2 + BASE_FEE; }
`,
    'src/main.manifest': `
module app_entry;
import { apply_rate as calc, BASE_FEE } from "./lib_rates";
fn main() -> i64 {
    return calc(100) + BASE_FEE;
}
`,
  };

  const modRun = await runManifestOnRustMvm(multiFiles['src/main.manifest'], {
    entryFile: 'src/main.manifest',
    files: multiFiles,
  });
  assert(
    modRun.ok && modRun.returnValue === '250',
    `2.1 Multi-file import with alias + exported const executes on Rust MVM (250 == ${modRun.returnValue})`
  );

  const privCheck = checkManifestSource(
    `module bad_imp;\nimport { secret_internal } from "./lib_rates";\nfn main() -> i64 { return secret_internal(); }`,
    { entryFile: 'src/main.manifest', files: multiFiles }
  );
  assert(
    !privCheck.ok && privCheck.diagnostics.some((d) => d.severity === 'error'),
    '2.2 Importing non-exported private symbol is rejected statically'
  );

  const cycleFiles = {
    'src/a.manifest': `module a;\nimport { fb } from "./b";\nexport fn fa() -> i64 { return fb(); }`,
    'src/b.manifest': `module b;\nimport { fa } from "./a";\nexport fn fb() -> i64 { return fa(); }`,
  };
  const cycleCheck = checkManifestSource(cycleFiles['src/a.manifest'], {
    entryFile: 'src/a.manifest',
    files: cycleFiles,
  });
  assert(
    !cycleCheck.ok && cycleCheck.diagnostics.some((d) => d.code.includes('CIRCULAR') || d.message.toLowerCase().includes('circular')),
    '2.3 Circular module import graph (a <-> b) is rejected cleanly'
  );

  // ---------------------------------------------------------------------------
  // 3. Static TypeChecker, Generics, Structs, Enums, Result<T,E>? & Negatives
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Static TypeChecker, Generics, Result<T,E>? & Negative Checks ---');

  const richTypeProg = `
module rich_types;

struct Pair<T> {
    first: T,
    second: T,
}

fn pick_first<T>(p: Pair<T>) -> T {
    return p.first;
}

fn checked_half(n: i64) -> Result<i64, str> {
    if (n % 2) != 0 {
        return Result::Err("odd");
    }
    return Result::Ok(n / 2);
}

fn pipeline(x: i64) -> Result<i64, str> {
    let h: i64 = checked_half(x)?;
    let h2: i64 = checked_half(h)?;
    return Result::Ok(h2);
}

fn main() -> i64 {
    let p = Pair { first: 40, second: 99 };
    let v: i64 = pick_first(p);
    let ok_res: Result<i64, str> = pipeline(v);
    let err_res: Result<i64, str> = pipeline(14);
    let mut total: i64 = 0;

    match ok_res {
        Result::Ok(k) => { total = total + k; },
        Result::Err(_) => { total = -100; },
    }
    match err_res {
        Result::Ok(k) => { total = total + k; },
        Result::Err(msg) => {
            if msg == "odd" {
                total = total + 7;
            }
        },
    }
    return total;
}
`;
  const richRun = await runManifestOnRustMvm(richTypeProg);
  assert(
    richRun.ok && richRun.returnValue === '17',
    `3.1 Generics + Struct + Result<T,E> '?' propagation + Match runs on Rust MVM (17 == ${richRun.returnValue})`
  );

  const badAdd = checkManifestSource(`module t1;\nfn main() -> i64 { return 10 + "hello"; }`);
  assert(!badAdd.ok, '3.2 Rejects mismatched binary arithmetic (i64 + str)');

  const badImmut = checkManifestSource(`module t2;\nfn main() -> i64 { let x: i64 = 1; x = 2; return x; }`);
  assert(!badImmut.ok, '3.3 Rejects assignment to immutable let binding');

  const badConst = checkManifestSource(`module t3;\nconst MAX: i64 = 5;\nfn main() -> i64 { MAX = 6; return MAX; }`);
  assert(!badConst.ok, '3.4 Rejects assignment to const declaration');

  const badCond = checkManifestSource(`module t4;\nfn main() -> i64 { if 123 { return 1; } return 0; }`);
  assert(!badCond.ok, '3.5 Rejects non-boolean condition (if 123)');

  const nonExhaustive = checkManifestSource(`
module t5;
enum Color { Red, Green, Blue }
fn main() -> i64 {
    let c: Color = Color::Red;
    match c {
        Color::Red => { return 1; },
        Color::Green => { return 2; },
    }
    return 0;
}
`);
  assert(!nonExhaustive.ok, '3.6 Rejects non-exhaustive enum match missing Color::Blue');

  const breakOutside = checkManifestSource(`module t6;\nfn main() -> i64 { break; return 0; }`);
  assert(!breakOutside.ok, '3.7 Rejects break statement outside loop');

  // ---------------------------------------------------------------------------
  // 4. Capability & Transitive Call-Graph Effect Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Capability & Transitive Effect Verifier ---');

  const capConflict = checkManifestSource(`
module cap1;
requires [net];
denies [net];
fn main() -> i64 { return 0; }
`);
  assert(!capConflict.ok, '4.1 Rejects contradictory requires [net] + denies [net]');

  const undeclaredFs = checkManifestSource(`
module cap2;
requires [console];
fn main() -> i64 {
    let s: str = fs.read_text("secret.txt");
    console.print(s);
    return 0;
}
`);
  assert(!undeclaredFs.ok, '4.2 Rejects undeclared fs.read_text when module only requires [console]');

  const deniedNet = checkManifestSource(`
module cap3;
denies [net];
fn fetch_remote() -> str { return net.get("https://example.com"); }
fn main() -> i64 { let _x: str = fetch_remote(); return 0; }
`);
  assert(!deniedNet.ok, '4.3 Rejects denied net capability');

  const transitiveViolation = checkManifestSource(`
module cap4;
requires [console];
fn leaf_io() { console.print("side effect"); }
fn mid_layer() { leaf_io(); }
fn must_be_pure() -> i64 effects(pure) {
    mid_layer();
    return 1;
}
fn main() -> i64 { return must_be_pure(); }
`);
  assert(
    !transitiveViolation.ok,
    '4.4 Rejects 3-hop transitive console side effect inside function marked effects(pure)'
  );

  // ---------------------------------------------------------------------------
  // 5. Typed MIR Optimizer & Trap-Preserving Constant Folding
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Typed MIR Optimizer & Trap Preservation ---');

  const optCheck = checkManifestSource(`
module opt_mod;
fn compute(x: i64) -> i64 {
    let folded: i64 = (10 + 20) * 3;
    return (x + 0) * 1 + folded;
    let dead_after_return: i64 = 999;
}
fn main() -> i64 { return compute(5); }
`);
  assert(optCheck.ok && Boolean(optCheck.optimizationStats && optCheck.optimizationStats.constantsFolded >= 2), '5.1 Optimizer folds constant subexpressions and algebraic identities');
  assert(
    optCheck.diagnostics.some((d) => d.severity === 'warning' && d.message.toLowerCase().includes('unreachable')),
    '5.2 Optimizer emits unreachable-code warning after unconditional return'
  );

  const divZeroTrapRun = await runManifestOnRustMvm(`
module trap_div0;
fn main() -> i64 {
    let z: i64 = 0;
    return 100 / (1 - 1 + z);
}
`);
  assert(
    !divZeroTrapRun.ok && Boolean(divZeroTrapRun.error?.toLowerCase().includes('zero')),
    '5.3 Division by zero traps deterministically at runtime in Rust MVM'
  );

  const overflowTrapRun = await runManifestOnRustMvm(`
module trap_overflow;
fn main() -> i64 {
    let max_val: i64 = 9223372036854775807;
    return max_val + 1;
}
`);
  assert(
    !overflowTrapRun.ok && Boolean(overflowTrapRun.error?.toLowerCase().includes('overflow')),
    '5.4 Checked i64 signed integer overflow traps deterministically in Rust MVM'
  );

  // ---------------------------------------------------------------------------
  // 6. .mbc v1.0 Static Bytecode Verifier & Rust MVM Security / Resource Guards
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. .mbc Bytecode Verifier & Rust MVM Negative/Trap Guards ---');

  const validBuild = await compileManifestV1(`module ok_mbc;\nfn main() -> i64 { return 42; }`, { target: 'mvm' });
  const goodBytes = validBuild.mbcBytes!;
  assert(goodBytes[0] === 0x4d && goodBytes[1] === 0x42 && goodBytes[2] === 0x43, '6.1 Emitted .mbc begins with MBC\\0 magic header');

  // Corrupt magic
  const badMagic = new Uint8Array(goodBytes);
  badMagic[0] = 0x00;
  const rustBadMagic = await verifyMbcInRustVm(badMagic);
  assert(!verifyMbcBytes(badMagic).valid && !rustBadMagic.ok, '6.2 Both TS & Rust MVM verifiers reject corrupted .mbc magic header');

  // Truncated container
  const truncated = goodBytes.slice(0, 12);
  const rustTrunc = await verifyMbcInRustVm(truncated);
  assert(!verifyMbcBytes(truncated).valid && !rustTrunc.ok, '6.3 Both TS & Rust MVM verifiers reject truncated .mbc container');

  // Malicious opcode / stack underflow injection inside CODE section:
  // Replace first CONST opcode (0x02, 5 bytes) with POP (0x04) + NOPs so stack underflows at PC 0!
  const underflowBytes = new Uint8Array(goodBytes);
  // Find [0x02, 0x00, 0x00, 0x00, 0x00, 0x44] (CONST 0; RET) at tail of file
  let patchedUnderflow = false;
  for (let i = underflowBytes.length - 6; i >= 16; i--) {
    if (underflowBytes[i] === MbcOpcode.CONST && underflowBytes[i + 5] === MbcOpcode.RET) {
      underflowBytes[i] = MbcOpcode.POP;
      underflowBytes[i + 1] = MbcOpcode.NOP;
      underflowBytes[i + 2] = MbcOpcode.NOP;
      underflowBytes[i + 3] = MbcOpcode.NOP;
      underflowBytes[i + 4] = MbcOpcode.NOP;
      patchedUnderflow = true;
      break;
    }
  }
  const rustUnderflow = await verifyMbcInRustVm(underflowBytes);
  assert(
    patchedUnderflow && !verifyMbcBytes(underflowBytes).valid && !rustUnderflow.ok,
    '6.4 Static bytecode verifier rejects operand stack underflow before execution'
  );

  // Invalid jump into middle of 5-byte CONST instruction
  const badJumpBuild = await compileManifestV1(
    `module jmp_test;\nfn main() -> i64 { let x: i64 = 100; if x > 50 { return 1; } return 2; }`,
    { target: 'mvm', optimize: false }
  );
  const badJumpBytes = new Uint8Array(badJumpBuild.mbcBytes!);
  let patchedJump = false;
  for (let i = 16; i < badJumpBytes.length - 5; i++) {
    if (badJumpBytes[i] === MbcOpcode.JMP_IF_FALSE) {
      // Point jump target to offset 2 (middle of initial 5-byte CONST instruction!)
      badJumpBytes[i + 1] = 2;
      badJumpBytes[i + 2] = 0;
      badJumpBytes[i + 3] = 0;
      badJumpBytes[i + 4] = 0;
      patchedJump = true;
      break;
    }
  }
  const rustBadJump = await verifyMbcInRustVm(badJumpBytes);
  assert(
    patchedJump && !rustBadJump.ok,
    '6.5 Rust MVM static verifier rejects jump targeting middle of multi-byte instruction'
  );

  // Bounded step limit on infinite loop
  const infLoopRun = await runManifestOnRustMvm(
    `module inf;\nfn main() -> i64 { while true {} return 0; }`,
    { maxSteps: 500 }
  );
  assert(
    !infLoopRun.ok && Boolean(infLoopRun.error?.toLowerCase().includes('step')),
    '6.6 Rust MVM deterministically halts infinite loop on step-limit exhaustion'
  );

  // Runtime capability denial when host WITHHOLDS fs.write capability
  const fsBuild = await compileManifestV1(
    `module fs_cap;\nrequires [fs.write];\nfn main() -> i64 effects(fs.write) {\n  let ok: bool = fs.write_text("out.txt", "hi");\n  if ok { return 1; }\n  return 0;\n}`,
    { target: 'mvm' }
  );
  assert(fsBuild.success && Boolean(fsBuild.mbcBytes), '6.7 Module with requires [fs.write] compiles to .mbc');
  const deniedAtRuntime = await executeMbcInRustVm(fsBuild.mbcBytes!, {
    grantedCapabilities: ['console'], // Host withholds fs.write!
  });
  assert(
    !deniedAtRuntime.ok && Boolean(deniedAtRuntime.error?.toLowerCase().includes('capability')),
    '6.8 Rust MVM blocks HOST_CALL at runtime when host does not grant fs.write capability'
  );
  const allowedAtRuntime = await executeMbcInRustVm(fsBuild.mbcBytes!, {
    grantedCapabilities: ['console', 'fs.write'],
    virtualFiles: {},
  });
  assert(
    allowedAtRuntime.ok && allowedAtRuntime.returnValue === '1' && allowedAtRuntime.virtualFiles['out.txt'] === 'hi',
    '6.9 Rust MVM executes fs.write_text into virtual workspace FS when fs.write is granted'
  );

  // ---------------------------------------------------------------------------
  // 7. Cross-Target Conformance (TS MIR == Rust MVM WASM == Native MVM CLI ==
  //    Direct .wasm == Sandboxed Web JS == Native rustc ELF Binary)
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Six-Way Cross-Target Conformance & Planned Target Guards ---');

  const conformanceProg = `
module six_way_conformance;
requires [console];
denies [net];

export fn collatz_steps(start: i64) -> i64 {
    let mut n: i64 = start;
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

export fn main() -> i64 effects(console) {
    let res: i64 = collatz_steps(27);
    console.print(res);
    return res;
}
`;

  // (A) TypeScript MIR Reference Evaluator
  const confCheck = checkManifestSource(conformanceProg);
  const refEval = evaluateMIRModule(confCheck.mir!, { grantedCapabilities: ['console'] });

  // (B) Rust MVM via WebAssembly (mvm_wasm.wasm)
  const wasmMvmRun = await runManifestOnRustMvm(conformanceProg);

  // (C) Native Rust MVM CLI (/mvm/target/release/mvm — auto-built on fresh clones)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-v1-test-'));
  const mbcFile = path.join(tmpDir, 'conformance.mbc');
  fs.writeFileSync(mbcFile, wasmMvmRun.build.mbcBytes!);
  const mvmBinPath = path.resolve('mvm/target/release/mvm');
  if (!fs.existsSync(mvmBinPath)) {
    const cargoCmd = fs.existsSync('/usr/local/bin/cargo') ? '/usr/local/bin/cargo' : 'cargo';
    execFileSync(cargoCmd, ['build', '--release', '--manifest-path', 'mvm/Cargo.toml'], { stdio: 'pipe' });
  }
  const nativeMvmStdout = execFileSync(
    mvmBinPath,
    ['run', mbcFile, '--allow', 'console'],
    { encoding: 'utf-8' }
  );
  const nativeMvmMatch = nativeMvmStdout.match(/=>\s*([^\r\n]+)/);
  const nativeMvmRet = nativeMvmMatch ? nativeMvmMatch[1].trim() : '';

  // (D) Direct Standalone WebAssembly (.wasm) Target
  const directWasmBuild = await compileManifestV1(conformanceProg, { target: 'wasm' });
  assert(
    directWasmBuild.success && Boolean(directWasmBuild.wasmBytes) && WebAssembly.validate(directWasmBuild.wasmBytes! as BufferSource),
    '7.1 Direct Manifest-to-WASM backend emits valid standalone W3C .wasm binary'
  );
  const wasmLogs: string[] = [];
  const wasmInst = await WebAssembly.instantiate(directWasmBuild.wasmBytes! as BufferSource, {
    env: {
      print_i32: (v: number) => wasmLogs.push(String(v)),
      print_f64: (v: number) => wasmLogs.push(String(v)),
    },
  });
  const directWasmRet = String(((wasmInst.instance.exports as any).main as () => bigint)());

  // (E) Capability-Restricted JavaScript / Web Target
  const webJsBuild = await compileManifestV1(conformanceProg, { target: 'web-js' });
  assert(
    webJsBuild.success && Boolean(webJsBuild.jsCode?.includes("CapabilityDenied: 'net' capability is not granted")),
    '7.2 Web/JS backend injects network lockdown guard when net capability is not granted'
  );
  const strippedJs = webJsBuild.jsCode!.replace(/^export\s+function\s+/gm, 'function ');
  const webJsRun = new Function(strippedJs + '\nreturn __runManifestModule();')() as {
    returnValue: string;
    stdout: string[];
  };
  const webJsRet = webJsRun.returnValue;
  let fetchBlocked = false;
  try {
    new Function(strippedJs + '\nreturn fetch("https://example.com");')();
  } catch (e: any) {
    fetchBlocked = String(e?.message || e).includes('CapabilityDenied');
  }
  assert(fetchBlocked, '7.3 Web/JS runtime guard actively blocks unauthorized fetch() calls inside module scope');

  // (F) Native Executable Backend via host rustc
  const nativeRsPath = path.join(tmpDir, 'conformance_native.rs');
  const nativeBinPath = path.join(tmpDir, 'conformance_native');
  const nativeRsSource = emitStandaloneRustSource(confCheck.mir!);
  fs.writeFileSync(nativeRsPath, nativeRsSource, 'utf-8');
  const rustcCmd = fs.existsSync('/usr/local/bin/rustc') ? '/usr/local/bin/rustc' : 'rustc';
  execFileSync(rustcCmd, ['-O', nativeRsPath, '-o', nativeBinPath], { stdio: 'pipe' });
  assert(fs.existsSync(nativeBinPath), '7.4 Native backend compiles standalone Rust via host rustc into ELF executable');
  const nativeStdout = execFileSync(nativeBinPath, [], { encoding: 'utf-8' }).trim();

  assert(
    String(refEval.returnValue) === '111' &&
      wasmMvmRun.returnValue === '111' &&
      nativeMvmRet === '111' &&
      directWasmRet === '111' &&
      webJsRet === '111' &&
      nativeStdout.includes('111'),
    `7.5 Six-way conformance: Collatz(27) == 111 across TS-MIR (${refEval.returnValue}), Rust-MVM-WASM (${wasmMvmRun.returnValue}), Native-MVM-CLI (${nativeMvmRet}), Direct-WASM (${directWasmRet}), Web-JS (${webJsRet}), and Native-ELF (${nativeStdout.split('\n')[0]})`
  );

  // Planned targets fail honestly
  for (const plannedId of ['evm-solidity', 'move', 'ton-tact']) {
    const pRes = await compileManifestV1(conformanceProg, { target: plannedId });
    assert(
      !pRes.success && pRes.diagnostics.some((d) => d.code === 'E_TARGET_PLANNED'),
      `7.6 Planned target "${plannedId}" fails honestly with E_TARGET_PLANNED`
    );
  }
  assert(COMPILER_TARGETS.length === 8, '7.7 Target registry exposes all 8 documented compiler targets');

  // ---------------------------------------------------------------------------
  // 8. CLI Commands, All /examples/**, Studio Orchestrator & Binary .mbc ZIP
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. CLI Commands, /examples/** Suite, Studio Orchestrator & Editor Linter ---');

  const cliTargetsOut = execFileSync('npx', ['tsx', 'manifest-core/src/cli.ts', 'targets'], { encoding: 'utf-8' });
  assert(cliTargetsOut.includes('mvm') && cliTargetsOut.includes('evm-solidity'), '8.1 CLI `manifest targets` lists implemented and planned targets');

  const cliDisasmOut = execFileSync(
    'npx',
    ['tsx', 'manifest-core/src/cli.ts', 'disassemble', 'examples/beginner/01_basics_and_loops.manifest'],
    { encoding: 'utf-8' }
  );
  assert(cliDisasmOut.includes('.fn main') && cliDisasmOut.includes('HOST_CALL'), '8.2 CLI `manifest disassemble` prints .mbc bytecode instructions');

  // Verify every single .manifest file in /examples/
  const exampleFiles = [
    { path: 'examples/beginner/01_basics_and_loops.manifest', expectedRet: '70', mode: 'mvm' },
    { path: 'examples/beginner/02_inventory_records.manifest', expectedRet: '350', mode: 'mvm' },
    { path: 'examples/professional/01_algorithms_and_enums.manifest', expectedRet: '7', mode: 'mvm' },
    { path: 'examples/professional/02_capabilities_and_hash.manifest', expectedRet: '64', mode: 'mvm' },
    { path: 'examples/professional/03_multi_module.manifest', expectedRet: '1236', mode: 'mvm' },
    { path: 'examples/web/sandboxed_analytics.manifest', expectedRet: '22', mode: 'mvm' },
    { path: 'examples/backend/audit_pipeline.manifest', expectedRet: '1', mode: 'mvm-fs' },
    { path: 'examples/web/reactive_counter.manifest', expectedRet: '', mode: 'web-ui' },
    { path: 'examples/contracts/solana_escrow_vault.manifest', expectedRet: '', mode: 'solana' },
  ];

  for (const ex of exampleFiles) {
    const src = fs.readFileSync(ex.path, 'utf-8');
    if (ex.mode === 'mvm' || ex.mode === 'mvm-fs') {
      const siblingMap: Record<string, string> = {};
      const dir = path.dirname(ex.path);
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.manifest')) {
          siblingMap[path.join(dir, f).replace(/\\/g, '/')] = fs.readFileSync(path.join(dir, f), 'utf-8');
        }
      }
      const res = await runManifestOnRustMvm(src, {
        entryFile: ex.path,
        files: siblingMap,
        grantedCapabilities: ['console', 'crypto', 'fs.read', 'fs.write'],
        virtualFiles: { 'config/policy.txt': '  allow_strict_mode = true  \n' },
      });
      assert(
        res.ok && res.returnValue === ex.expectedRet,
        `8.3 Example ${ex.path} compiles & runs on Rust MVM (ret=${res.returnValue})`
      );
    } else if (ex.mode === 'web-ui') {
      const res = await compileManifestV1(src, { target: 'web-js', entryFile: ex.path });
      assert(res.success && Boolean(res.jsCode?.includes('startApp')), `8.3 Example ${ex.path} compiles to reactive Web UI JS`);
    } else if (ex.mode === 'solana') {
      const res = await compileManifestV1(src, { target: 'solana-sbf', entryFile: ex.path });
      assert(res.success && Boolean(res.rustCode?.includes('#[program]')), `8.3 Example ${ex.path} compiles to Solana Anchor Rust + IDL`);
    }
  }

  // Studio ExecutionOrchestrator: Build vs Run + Direct .mbc execution + Native honest refusal
  const orchestrator = ExecutionOrchestrator.getInstance();
  const studioProj: ManifestProject = {
    id: 'studio-v1-test',
    name: 'Studio v1 Verification',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    activeFilePath: 'src/main.manifest',
    files: [
      {
        id: 'f-main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module studio_demo;\nrequires [console];\nfn main() -> i64 effects(console) { console.print("hello mvm"); return 77; }`,
      },
    ],
  };

  const studioBuildMvm = await orchestrator.buildProject(studioProj, {
    activeFilePath: 'src/main.manifest',
    compilerTarget: 'mvm',
  });
  const mbcArtifact = studioBuildMvm.artifacts?.find((a) => a.fileName.endsWith('.mbc'));
  assert(
    studioBuildMvm.success && Boolean(mbcArtifact) && Boolean(studioBuildMvm.disassembly) && Boolean(studioBuildMvm.irText),
    '8.4 Studio buildProject(mvm) produces .mbc binary artifact, disassembly, Typed IR, and capability report'
  );

  const studioRunMvm = await orchestrator.executeProject(studioProj, {
    activeFilePath: 'src/main.manifest',
    compilerTarget: 'mvm',
  });
  assert(
    studioRunMvm.success && studioRunMvm.returnValue === '77' && studioRunMvm.logs.some((l) => l.includes('hello mvm')),
    '8.5 Studio executeProject(mvm) runs .mbc inside Rust MVM WASM and returns 77'
  );

  // Direct execution of emitted .mbc file inside Studio workspace
  const projWithMbc: ManifestProject = {
    ...studioProj,
    activeFilePath: mbcArtifact!.fileName,
    files: [
      ...studioProj.files,
      {
        id: 'f-mbc',
        name: 'studio_demo.mbc',
        path: mbcArtifact!.fileName,
        language: 'mbc',
        content: mbcArtifact!.content,
        isBinary: true,
        mimeType: 'application/x-manifest-bytecode',
      },
    ],
  };
  const directMbcExec = await orchestrator.executeProject(projWithMbc, {
    activeFilePath: mbcArtifact!.fileName,
  });
  assert(
    directMbcExec.success && directMbcExec.returnValue === '77',
    '8.6 Studio executes binary .mbc file directly on Rust MVM when selected in Explorer'
  );

  // Binary-safe ZIP round-trip for .mbc files
  const zipBlob = await exportProjectToZip(projWithMbc);
  const zipFile = new File([await zipBlob.arrayBuffer()], 'studio-v1.zip', { type: 'application/zip' });
  const importedProj = await importProjectFromZip(zipFile);
  const importedMbc = importedProj.files.find((f) => f.path.endsWith('.mbc'));
  const origBytes = decodeMbcFileContent(mbcArtifact!.content)!;
  const roundTripBytes = decodeMbcFileContent(importedMbc?.content || '')!;
  assert(
    Boolean(importedMbc?.isBinary) &&
      origBytes.length === roundTripBytes.length &&
      origBytes.every((b, idx) => b === roundTripBytes[idx]),
    '8.7 Binary .mbc bytecode survives Studio ZIP export/import byte-for-byte without UTF-8 corruption'
  );

  // Studio Native build succeeds (emits .rs) while Studio Native run refuses honestly in browser sandbox
  const studioNativeBuild = await orchestrator.buildProject(studioProj, {
    activeFilePath: 'src/main.manifest',
    compilerTarget: 'native',
  });
  const studioNativeRun = await orchestrator.executeProject(studioProj, {
    activeFilePath: 'src/main.manifest',
    compilerTarget: 'native',
  });
  assert(
    studioNativeBuild.success &&
      Boolean(studioNativeBuild.artifacts?.some((a) => a.fileName.endsWith('.rs'))) &&
      !studioNativeRun.success &&
      Boolean(studioNativeRun.error?.includes('browser sandbox')),
    '8.8 Studio separates Native Build (emits .rs) from Native Run (honest browser sandbox refusal)'
  );

  // Live CodeMirror 6 manifestLinter diagnostics (syntax + static type + capability errors)
  const badEditorState = EditorState.create({
    doc: `module broken_lint;\ndenies [net];\nfn main() -> i64 {\n  let _s: str = net.get("https://x.test");\n  return "wrong_return_type";\n}`,
  });
  const fakeView = { state: badEditorState } as any;
  const cmDiags = collectManifestEditorDiagnostics(fakeView);
  assert(
    cmDiags.length >= 2 &&
      cmDiags.some((d) => d.message.includes('E_CAPABILITY_DENIED')) &&
      cmDiags.some((d) => d.message.includes('E_RETURN_TYPE_MISMATCH')),
    '8.9 CodeMirror manifestLinter surfaces live static type and capability diagnostics with error codes'
  );

  const brokenUiSyntaxState = EditorState.create({
    doc: `APP "BrokenUI"\nPAGE Home\n  IF x >\nEND`,
  });
  const brokenUiDiags = collectManifestEditorDiagnostics({ state: brokenUiSyntaxState } as any);
  assert(
    brokenUiDiags.length >= 1 && brokenUiDiags[0].severity === 'error',
    '8.10 CodeMirror manifestLinter surfaces live syntax errors on legacy APP/PAGE files'
  );

  // Cleanup temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n====================================================================`);
  console.log(`Manifest v1.0 Upgrade Suite: ${passed}/${passed + failed} assertions passed.`);
  console.log(`====================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Unhandled v1 test failure:', err);
  process.exit(1);
});

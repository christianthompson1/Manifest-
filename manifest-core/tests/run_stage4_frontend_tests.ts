/**
 * Manifest v1.0 — Batch 2 / Stage 4 Regression Test Suite
 *
 * Tests all three Stage 4 language-frontend & semantic repairs across profiles and backends:
 * 1. Formatter Semantics Preservation:
 *    - Operator precedence & associativity (`*` over `+`, `a - (b + c)`, `a - (b - c)`, `a / (b * c)`,
 *      `(a / b) / c`, unary `-(a + b)`, `!(a && b)`, `(a + b)?`, member/index/call base `(a + b)`)
 *    - Nested unary `--` guard (`-(-x)` never formatted into `--x` line comment)
 *    - Struct literals in Pro header conditions (`if (Point { x: 1 }.x == 1)`)
 *    - Line comments, doc comments, block comments, and escapes (`\n`, `\t`, `\0`, `\x41`, `\u0042`, `\"`, `\\`)
 *    - Module-level `export let` preservation
 *    - Normalized AST equivalence, idempotence (`format(format(x)) === format(x)`),
 *      clean syntax-error rejection (`ok === false`), and Beginner <-> Professional execution equivalence on Rust MVM
 * 2. Mutable Module-Level `let` & Module Environments:
 *    - Reading & mutating module-level `let` (`let`, `let mut`, `LET`, `MUTABLE`) inside module & functions
 *    - Struct field and array index mutation on module-level `let`
 *    - Local shadowing does not overwrite module-level global
 *    - `const` reassignment still rejected (`E_ASSIGN_CONST`); local `let` still immutable (`E_ASSIGN_IMMUTABLE`)
 *    - Multi-file `export let` import/mutation, private module namespace & identical module-name isolation
 *    - Diamond dependency single-initialization (`base` initialized once, shared across `left` and `right`)
 *    - Circular import rejected (`E_CIRCULAR_IMPORT`) and private global/symbol import rejected (`E_IMPORT_PRIVATE_SYMBOL`)
 *    - Uninitialized global read caught statically (`E_UNDEFINED_VAR`) and dynamically (MIR evaluator, TS `MvmInterpreter`, Web-JS)
 *    - Independent per-run VM/Web-JS state isolation & Native Rust `thread_local!` + `m_fn___init__()` generation
 * 3. `TryStmt` and `TraitDecl` Honest Resolution:
 *    - Both constructs emit `E_UNSUPPORTED_FEATURE` consistently across Beginner & Professional profiles
 *      with source locations and actionable hints (never silently dropped or `E_UNIMPLEMENTED_FEATURE`)
 */

import { parseSemanticModule } from '../src/core/parse-unified.ts';
import {
  checkManifestSource,
  compileManifestV1,
  formatManifestSource,
  runManifestOnRustMvm,
} from '../src/pipeline.ts';
import { TypeChecker } from '../src/semantics/type-checker.ts';
import { buildTypedIR } from '../src/ir/typed-ir-builder.ts';
import { analyzeCapabilitiesAndEffects } from '../src/semantics/capability-analyzer.ts';
import { resolveModuleGraph } from '../src/semantics/module-resolver.ts';
import { evaluateMIRModule } from '../src/runtime/semantic-evaluator.ts';
import { compileMIRToMbc } from '../src/bytecode/mbc-compiler.ts';
import { MvmInterpreter } from '../src/vm/mvm-interpreter.ts';
import { compileMIRToWebJS } from '../src/targets/web-js-target.ts';
import { buildNativeTargetSourceOnly } from '../src/targets/native-target.ts';
import { MIRModule } from '../src/ir/typed-ir.ts';
import { T_I64, T_VOID } from '../src/semantics/types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

/**
 * Normalizes a SemanticModule AST by stripping source spans, comments,
 * header spans, profile tags, and synthetic location noise so two ASTs
 * can be compared purely on program structure and semantics.
 */
function normalizeAst(node: unknown): unknown {
  if (typeof node === 'bigint') {
    return `${node.toString()}n`;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(normalizeAst);
  }
  const rec = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(rec).sort()) {
    if (
      key === 'span' ||
      key === 'headerSpan' ||
      key === 'comments' ||
      key === 'profile'
    ) {
      continue;
    }
    out[key] = normalizeAst(rec[key]);
  }
  return out;
}

function astSemanticallyEqual(srcA: string, srcB: string): { equal: boolean; diff?: string } {
  const astA = normalizeAst(parseSemanticModule(srcA, { profile: 'auto' }));
  const astB = normalizeAst(parseSemanticModule(srcB, { profile: 'auto' }));
  const jsonA = JSON.stringify(astA);
  const jsonB = JSON.stringify(astB);
  if (jsonA === jsonB) return { equal: true };
  return {
    equal: false,
    diff: `AST mismatch:\n--- A ---\n${jsonA.slice(0, 400)}\n--- B ---\n${jsonB.slice(0, 400)}`,
  };
}

async function runWebJsModule(jsCode: string): Promise<{ returnValue: string; stdout: string[] }> {
  const runnable = jsCode.replace(
    /^export function __runManifestModule/m,
    'function __runManifestModule'
  );
  const fn = new Function(`${runnable}\nreturn __runManifestModule;`);
  const entry = fn() as () => { returnValue: string; stdout: string[] };
  return entry();
}

async function runStage4Tests(): Promise<void> {
  console.log('\n=== MANIFEST BATCH 2 / STAGE 4: V1 FRONTEND CORRECTNESS & SEMANTICS ===\n');

  // =========================================================================
  // PART 1: FORMATTER SEMANTIC PRESERVATION
  // =========================================================================
  console.log('1. Formatter Precedence, Associativity & Syntax Preservation');

  const precedenceSource = `
module fmt_prec;

struct Box {
    v: i64,
}

fn check_ok(flag: bool) -> Result<i64, str> {
    if flag {
        return Result::Ok(10);
    }
    return Result::Err("bad");
}

fn test_ops(x: i64, y: i64, z: i64, flag: bool) -> Result<i64, str> {
    let a = (1 + 2) * 3;
    let b = 1 + (2 * 3);
    let c = x - (y + z);
    let d = x - (y - z);
    let e = (x - y) - z;
    let f = x / (y * z);
    let g = (x / y) / z;
    let h = x / (y / z);
    let neg_sum = -(x + y);
    let double_neg = -(-x);
    let bool_neg = !(flag && true) || (x > 0 && y < 10);
    let prop = (check_ok(flag))?;
    let arr = [10, 20, 30];
    let elem = arr[(x - x) + 1];
    let bx = Box { v: a + b + c + d + e + f + g + h + neg_sum + double_neg + prop + elem };
    if (Box { v: 1 }.v == 1) && bool_neg {
        return Result::Ok(bx.v);
    }
    return Result::Ok(bx.v - 1);
}

fn main() -> i64 {
    let r = test_ops(6, 2, 1, true);
    let r_err = test_ops(6, 2, 1, false);
    let mut err_bonus = 0;
    match r_err {
        Result::Ok(_) => { err_bonus = 1000; },
        Result::Err(_) => { err_bonus = 100; },
    }
    match r {
        Result::Ok(v) => { return v + err_bonus; },
        Result::Err(_) => { return -1; },
    }
}
`;

  const fmtPro1 = formatManifestSource(precedenceSource, 'professional');
  assert(fmtPro1.ok && !!fmtPro1.formatted, '1.1 Precedence torture source formats cleanly in Pro profile');

  const astEq1 = astSemanticallyEqual(precedenceSource, fmtPro1.formatted!);
  assert(astEq1.equal, '1.2 Formatted Pro source preserves exact normalized AST', astEq1.diff);

  const fmtPro2 = formatManifestSource(fmtPro1.formatted!, 'professional');
  assert(
    fmtPro2.ok && fmtPro2.formatted === fmtPro1.formatted,
    '1.3 Formatter is idempotent on Pro precedence source'
  );
  assert(
    !fmtPro1.formatted!.includes('--x'),
    '1.4 Nested unary `-(-x)` is never formatted as `--x` comment hazard'
  );

  // Convert Pro -> Beginner -> Pro and verify AST & runtime execution parity
  const fmtBeg1 = formatManifestSource(precedenceSource, 'beginner');
  assert(fmtBeg1.ok && !!fmtBeg1.formatted, '1.5 Precedence source translates cleanly to Beginner profile');
  const fmtBeg2 = formatManifestSource(fmtBeg1.formatted!, 'beginner');
  assert(
    fmtBeg2.ok && fmtBeg2.formatted === fmtBeg1.formatted,
    '1.6 Formatter is idempotent in Beginner profile'
  );
  const fmtRoundTripPro = formatManifestSource(fmtBeg1.formatted!, 'professional');
  assert(fmtRoundTripPro.ok && !!fmtRoundTripPro.formatted, '1.7 Beginner -> Pro round-trip formats cleanly');
  const astEqRoundTrip = astSemanticallyEqual(precedenceSource, fmtRoundTripPro.formatted!);
  assert(astEqRoundTrip.equal, '1.8 Pro -> Beginner -> Pro preserves exact normalized AST', astEqRoundTrip.diff);

  const runOrigMvm = await runManifestOnRustMvm(precedenceSource, { profile: 'professional' });
  const runFmtProMvm = await runManifestOnRustMvm(fmtPro1.formatted!, { profile: 'professional' });
  const runFmtBegMvm = await runManifestOnRustMvm(fmtBeg1.formatted!, { profile: 'beginner' });
  const runRoundTripMvm = await runManifestOnRustMvm(fmtRoundTripPro.formatted!, { profile: 'professional' });

  assert(
    runOrigMvm.ok &&
      runFmtProMvm.ok &&
      runFmtBegMvm.ok &&
      runRoundTripMvm.ok &&
      runOrigMvm.returnValue === runFmtProMvm.returnValue &&
      runOrigMvm.returnValue === runFmtBegMvm.returnValue &&
      runOrigMvm.returnValue === runRoundTripMvm.returnValue,
    `1.9 Original, Formatted Pro, Beginner, and Round-Trip produce identical Rust MVM result (${runOrigMvm.returnValue})`,
    `orig=${runOrigMvm.returnValue}, pro=${runFmtProMvm.returnValue}, beg=${runFmtBegMvm.returnValue}, rt=${runRoundTripMvm.returnValue}`
  );

  // Comments, doc-comments, escapes, and export let preservation
  const metaPreserveSrc = `/// Module doc comment
module fmt_meta;

/* block comment preserved */
export let mut exported_counter: i64 = 1; // inline counter note

fn greet() -> str {
    // Escapes: newline, tab, null, hex, unicode, quote, backslash
    let s = "A\\nB\\t\\0\\x41\\u0042\\"\\\\";
    return s;
}

fn main() -> i64 {
    let g = greet();
    exported_counter = exported_counter + 4;
    return exported_counter + std::str::len(g);
}
`;
  const fmtMetaPro = formatManifestSource(metaPreserveSrc, 'professional');
  assert(fmtMetaPro.ok && !!fmtMetaPro.formatted, '1.10 Comments, doc-comments & escapes format cleanly');
  assert(
    fmtMetaPro.formatted!.includes('/// Module doc comment') &&
      fmtMetaPro.formatted!.includes('/* block comment preserved */') &&
      fmtMetaPro.formatted!.includes('inline counter note'),
    '1.11 Formatter preserves doc-comments, block comments, and inline comments'
  );
  assert(
    fmtMetaPro.formatted!.includes('export let mut exported_counter'),
    '1.12 Formatter preserves export modifier on module-level let'
  );
  const runMetaOrig = await runManifestOnRustMvm(metaPreserveSrc);
  const runMetaFmt = await runManifestOnRustMvm(fmtMetaPro.formatted!);
  assert(
    runMetaOrig.ok && runMetaFmt.ok && runMetaOrig.returnValue === runMetaFmt.returnValue,
    `1.13 Escape & export-let execution identical after formatting (${runMetaOrig.returnValue})`
  );

  // Beginner `#` and `NOTE:` comment preservation + Pro translation
  const begCommentSrc = `MODULE fmt_beg_comments
# hash note
NOTE: beginner note
LET total = 7
FUNCTION main() -> Int
    RETURN total * 2
END
`;
  const fmtBegCmtStay = formatManifestSource(begCommentSrc, 'beginner');
  const fmtBegCmtToPro = formatManifestSource(begCommentSrc, 'professional');
  assert(
    fmtBegCmtStay.ok &&
      fmtBegCmtStay.formatted!.includes('# hash note') &&
      fmtBegCmtStay.formatted!.includes('NOTE: beginner note'),
    '1.14 Beginner formatter retains # and NOTE: comments'
  );
  assert(
    fmtBegCmtToPro.ok &&
      fmtBegCmtToPro.formatted!.includes('// hash note') &&
      fmtBegCmtToPro.formatted!.includes('// beginner note'),
    '1.15 Converting Beginner comments (#, NOTE:) to Pro converts them to valid // comments'
  );

  // Invalid syntax fails cleanly
  const badSyntaxRes = formatManifestSource('fn broken( { let = ; }');
  assert(!badSyntaxRes.ok && badSyntaxRes.diagnostics.length > 0, '1.16 Invalid syntax rejected cleanly (ok: false)');

  // =========================================================================
  // PART 2: MUTABLE MODULE-LEVEL LET & MULTI-FILE MODULE ENVIRONMENTS
  // =========================================================================
  console.log('\n2. Mutable Module-Level let & Multi-File Module Environments');

  const modMutPro = `
module mod_mut;
requires [console];

let counter = 0;
let mut step_size: i64 = 2;
const BASE: i64 = 100;

struct Acc {
    total: i64,
}

let box = Acc { total: 5 };
let arr = [1, 2, 3];

counter = counter + 1;

fn bump(delta: i64) -> i64 {
    counter = counter + delta + step_size;
    box.total = box.total + delta;
    arr[0] = arr[0] + delta;
    return counter;
}

fn shadow_test() -> i64 {
    let counter = 999;
    return counter;
}

fn main() -> i64 {
    let a = bump(3);
    let sh = shadow_test();
    step_size = 5;
    let b = bump(1);
    std::io::println(std::conv::to_str(b));
    return BASE + a + b + box.total + arr[0] + sh;
}
`;
  // Trace expected value:
  // Initially: counter=0, step_size=2, BASE=100, box.total=5, arr[0]=1
  // Top-level: counter = 0 + 1 = 1
  // a = bump(3): counter = 1+3+2 = 6; box.total = 8; arr[0] = 4; returns 6
  // sh = shadow_test(): local counter = 999; returns 999 (does not touch global counter)
  // step_size = 5
  // b = bump(1): counter = 6+1+5 = 12; box.total = 9; arr[0] = 5; returns 12
  // return 100 + 6 + 12 + 9 + 5 + 999 = 1131
  const mvmMutPro = await runManifestOnRustMvm(modMutPro, {
    profile: 'professional',
    grantedCapabilities: ['console'],
  });
  assert(
    mvmMutPro.ok && mvmMutPro.returnValue === '1131' && mvmMutPro.stdout[0] === '12',
    `2.1 Module-level let, mut, struct field, array index & shadowing execute correctly on Rust MVM (got ${mvmMutPro.returnValue})`,
    mvmMutPro.error
  );

  // Beginner equivalent module-level mutable LET
  const modMutBeg = `
MODULE mod_mut_beg
LET counter = 0
MUTABLE step_size: Int = 2
SET counter TO counter + 1

FUNCTION bump(d: Int) -> Int
    SET counter TO counter + d + step_size
    RETURN counter
END

FUNCTION main() -> Int
    LET a = bump(4)
    SET step_size TO 3
    RETURN bump(1) + a
END
`;
  // Initial counter=1. bump(4)-> counter=1+4+2=7 (a=7). step_size=3. bump(1)-> counter=7+1+3=11. 11+7=18.
  const mvmMutBeg = await runManifestOnRustMvm(modMutBeg, { profile: 'beginner' });
  assert(
    mvmMutBeg.ok && mvmMutBeg.returnValue === '18',
    `2.2 Beginner module-level LET/MUTABLE/SET execute accurately on Rust MVM (got ${mvmMutBeg.returnValue})`,
    mvmMutBeg.error
  );

  // Web-JS, MIR evaluator, TS MvmInterpreter, and Native codegen on module-level mutable let
  const buildWebMut = await compileManifestV1(modMutPro, { target: 'web-js' });
  assert(buildWebMut.success && !!buildWebMut.jsCode, '2.3 Web-JS compiles module-level mutable let');
  const webRun1 = await runWebJsModule(buildWebMut.jsCode!);
  const webRun2 = await runWebJsModule(buildWebMut.jsCode!);
  assert(
    webRun1.returnValue === '1131' && webRun2.returnValue === '1131',
    `2.4 Web-JS runs & isolates per-invocation global state (run1=${webRun1.returnValue}, run2=${webRun2.returnValue})`
  );

  // Compile to MVM and execute twice via TS MvmInterpreter to confirm fresh state isolation
  const buildMbcMut = await compileManifestV1(modMutPro, { target: 'mvm' });
  assert(buildMbcMut.success && !!buildMbcMut.mbcBytes, '2.5 MVM target builds .mbc for mutable module globals');
  const tsVm1 = MvmInterpreter.execute(buildMbcMut.mbcBytes!, { grantedCapabilities: ['console'] });
  const tsVm2 = MvmInterpreter.execute(buildMbcMut.mbcBytes!, { grantedCapabilities: ['console'] });
  assert(
    tsVm1.ok && tsVm2.ok && tsVm1.returnValue === '1131' && tsVm2.returnValue === '1131',
    `2.6 TS MvmInterpreter produces 1131 cleanly across independent runs`
  );

  const mirEvalRes = evaluateMIRModule(buildMbcMut.mir!, { grantedCapabilities: ['console'] });
  assert(
    mirEvalRes.ok && mirEvalRes.returnValue === '1131',
    `2.7 MIR semantic evaluator matches Rust MVM & Web-JS (got ${mirEvalRes.returnValue})`
  );

  // Numeric WASM target test with module-level mutable let
  const numericWasmMod = `
module wasm_glob;
let g: i64 = 10;
fn add_g(x: i64) -> i64 {
    g = g + x;
    return g;
}
fn main() -> i64 {
    let first = add_g(5);
    return add_g(first);
}
`;
  const buildWasmMut = await compileManifestV1(numericWasmMod, { target: 'wasm' });
  assert(buildWasmMut.success && !!buildWasmMut.wasmBytes, '2.8 Direct WASM compiles numeric module-level globals');
  const wasmCompiled = await WebAssembly.compile(new Uint8Array(buildWasmMut.wasmBytes!));
  const wasmInst = await WebAssembly.instantiate(wasmCompiled, {
    env: { print_i32: () => {}, print_f64: () => {}, print_i64: () => {} },
  });
  const wasmMainRet = (wasmInst.exports.main as () => bigint)();
  assert(wasmMainRet === 30n, `2.9 Direct WASM executes module-level globals accurately (got ${wasmMainRet})`);

  // Native target inspection: thread_local!, StoreGlobal, LoadGlobal, m_fn___init__
  const buildNatMut = await compileManifestV1(modMutPro, { target: 'native' });
  assert(
    buildNatMut.success &&
      !!buildNatMut.rustCode &&
      buildNatMut.rustCode.includes('thread_local!') &&
      buildNatMut.rustCode.includes('m_fn___init__()') &&
      buildNatMut.rustCode.includes('M_G_0'),
    '2.10 Native Rust target lowers module-level globals with safe thread_local! and __init__ call'
  );

  // Const reassignment rejected & local let immutability preserved
  const constReassign = await checkManifestSource(`
module bad_const;
const K: i64 = 5;
fn main() -> i64 {
    K = 6;
    return K;
}
`);
  assert(
    !constReassign.ok && constReassign.diagnostics.some((d) => d.code === 'E_ASSIGN_CONST'),
    '2.11 Reassigning module const rejected with E_ASSIGN_CONST'
  );

  const localLetReassign = await checkManifestSource(`
module bad_local;
fn main() -> i64 {
    let x: i64 = 1;
    x = 2;
    return x;
}
`);
  assert(
    !localLetReassign.ok && localLetReassign.diagnostics.some((d) => d.code === 'E_ASSIGN_IMMUTABLE'),
    '2.12 Local non-mut let remains immutable (E_ASSIGN_IMMUTABLE)'
  );

  // =========================================================================
  // PART 2B: MULTI-FILE MODULE ENVIRONMENTS & DIAMOND SINGLE-INIT
  // =========================================================================
  console.log('\n3. Multi-File Module Environments, Exported let, Isolation & Diamond Init');

  const filesExportMut: Record<string, string> = {
    'src/main.manifest': `
module app_main;
import { shared_count, inc_shared } from "./store";
import { a_val } from "./mod_a";
import { b_val } from "./mod_b";

let private_val = 1000;

fn main() -> i64 {
    let before = shared_count;
    shared_count = shared_count + 5;
    let after = inc_shared(10);
    return private_val + before + after + a_val() + b_val();
}
`,
    'src/store.manifest': `
module state_store;
export let shared_count = 1;
let secret_val = 2;
shared_count = shared_count + 1;

export fn inc_shared(n: i64) -> i64 {
    shared_count = shared_count + n;
    return shared_count + secret_val;
}
`,
    // Notice mod_a and mod_b deliberately declare the SAME module name (`worker`) and same private global name (`secret_val`)!
    'src/mod_a.manifest': `
module worker;
import { shared_count } from "./store";
let secret_val = 10;
export fn a_val() -> i64 {
    secret_val = secret_val + 1;
    return secret_val + shared_count;
}
`,
    'src/mod_b.manifest': `
module worker;
let secret_val = 200;
export fn b_val() -> i64 {
    return secret_val;
}
`,
  };

  // Trace expected:
  // store init: shared_count=1 -> +1 => shared_count=2; store's secret_val=2
  // mod_a secret_val=10; mod_b secret_val=200; main private_val=1000
  // before = 2
  // shared_count = 2 + 5 = 7
  // after = inc_shared(10) -> shared_count=17, returns 17+2 = 19
  // a_val() -> mod_a.secret_val=11, returns 11 + 17 = 28
  // b_val() -> mod_b.secret_val=200
  // total = 1000 + 2 + 19 + 28 + 200 = 1249
  const multiRun = await runManifestOnRustMvm(filesExportMut['src/main.manifest'], {
    entryFile: 'src/main.manifest',
    files: filesExportMut,
  });
  assert(
    multiRun.ok && multiRun.returnValue === '1249',
    `3.1 Multi-file export let mutation, diamond single-init & identical-module private global isolation = 1249 (got ${multiRun.returnValue})`,
    multiRun.error
  );

  // Explicit diamond initialization counter test: verify base topLevelStmts run ONCE, not twice!
  const diamondFiles: Record<string, string> = {
    'src/main.manifest': `
module diamond_main;
import { init_runs } from "./base";
import { left_read } from "./left";
import { right_read } from "./right";

fn main() -> i64 {
    return init_runs * 100 + left_read() + right_read();
}
`,
    'src/left.manifest': `
module left;
import { init_runs } from "./base";
export fn left_read() -> i64 { return init_runs; }
`,
    'src/right.manifest': `
module right;
import { init_runs } from "./base";
export fn right_read() -> i64 { return init_runs; }
`,
    'src/base.manifest': `
module base;
export let init_runs = 0;
init_runs = init_runs + 1;
`,
  };
  const diamondRes = await runManifestOnRustMvm(diamondFiles['src/main.manifest'], {
    entryFile: 'src/main.manifest',
    files: diamondFiles,
  });
  assert(
    diamondRes.ok && diamondRes.returnValue === '102',
    `3.2 Diamond dependency initializes shared base module exactly ONCE (1*100 + 1 + 1 = 102, got ${diamondRes.returnValue})`,
    diamondRes.error
  );

  // Private global import error & circular import error
  const privErr = await checkManifestSource(
    `module m; import { hidden } from "./dep"; fn main() -> i64 { return hidden; }`,
    {
      entryFile: 'src/main.manifest',
      files: {
        'src/main.manifest': `module m; import { hidden } from "./dep"; fn main() -> i64 { return hidden; }`,
        'src/dep.manifest': `module dep; let hidden = 7;`,
      },
    }
  );
  assert(
    !privErr.ok && privErr.diagnostics.some((d) => d.code === 'E_IMPORT_PRIVATE_SYMBOL'),
    '3.3 Importing non-exported module-level let produces E_IMPORT_PRIVATE_SYMBOL'
  );

  const cycleErr = await checkManifestSource(
    `module a; import { b_fn } from "./b"; fn main() -> i64 { return b_fn(); }`,
    {
      entryFile: 'src/a.manifest',
      files: {
        'src/a.manifest': `module a; import { b_fn } from "./b"; export fn a_fn() -> i64 { return 1; } fn main() -> i64 { return b_fn(); }`,
        'src/b.manifest': `module b; import { a_fn } from "./a"; export fn b_fn() -> i64 { return a_fn(); }`,
      },
    }
  );
  assert(
    !cycleErr.ok && cycleErr.diagnostics.some((d) => d.code === 'E_CIRCULAR_IMPORT'),
    '3.4 Circular module dependency produces E_CIRCULAR_IMPORT'
  );

  // Static use-before-declaration on module globals
  const useBeforeDecl = await checkManifestSource(`
module order_err;
let a = b + 1;
let b = 2;
fn main() -> i64 { return a; }
`);
  assert(
    !useBeforeDecl.ok && useBeforeDecl.diagnostics.some((d) => d.code === 'E_UNDEFINED_VAR'),
    '3.5 Top-level forward reference before declaration is rejected statically (E_UNDEFINED_VAR)'
  );

  // Dynamic uninitialized global read trap on synthetic MIR ordering (MIR evaluator, TS MvmInterpreter, Web-JS)
  const syntheticUninitMir: MIRModule = {
    kind: 'MIRModule',
    moduleName: 'uninit_test',
    sourceProfile: 'professional',
    requires: [],
    provides: [],
    denies: [],
    structs: [],
    enums: [],
    globals: [
      {
        slot: 0,
        name: 'late_var',
        mutable: true,
        isConst: false,
        exported: false,
        type: T_I64,
        init: { kind: 'ConstInt', value: 0n, type: T_I64, span: { line: 1, column: 1, endLine: 1, endColumn: 1 } },
        span: { line: 1, column: 1, endLine: 1, endColumn: 1 },
      },
    ],
    functions: [
      {
        name: 'main',
        exported: true,
        isAsync: false,
        isEntry: true,
        isSynthetic: false,
        params: [],
        locals: [],
        returnType: T_I64,
        effects: [],
        body: [
          {
            kind: 'Return',
            value: { kind: 'LoadGlobal', slot: 0, name: 'late_var', type: T_I64, span: { line: 2, column: 1, endLine: 2, endColumn: 1 } },
            span: { line: 2, column: 1, endLine: 2, endColumn: 1 },
          },
        ],
        span: { line: 2, column: 1, endLine: 2, endColumn: 1 },
      },
    ],
    entryFunction: 'main',
  };
  const mirUninit = evaluateMIRModule(syntheticUninitMir);
  assert(
    !mirUninit.ok && (mirUninit.error || '').includes('uninitialized'),
    `3.6 MIR semantic evaluator rejects uninitialized global read (${mirUninit.error})`
  );
  const mbcUninit = compileMIRToMbc(syntheticUninitMir);
  const vmUninit = MvmInterpreter.execute(mbcUninit.bytes);
  assert(
    !vmUninit.ok && (vmUninit.error || '').includes('E_MVM_UNINITIALIZED_GLOBAL'),
    `3.7 TS MvmInterpreter traps on uninitialized global read (${vmUninit.error})`
  );
  const webUninit = compileMIRToWebJS(syntheticUninitMir);
  let webUninitCaught = false;
  try {
    await runWebJsModule(webUninit.jsCode);
  } catch (err: any) {
    webUninitCaught = String(err?.message || err).includes('UninitializedGlobalError');
  }
  assert(webUninitCaught, '3.8 Web-JS target throws UninitializedGlobalError on uninitialized global read');

  // =========================================================================
  // PART 3: TRY STATEMENTS & TRAIT DECLARATIONS HONEST RESOLUTION
  // =========================================================================
  console.log('\n4. TryStmt and TraitDecl Consistent E_UNSUPPORTED_FEATURE Across Profiles');

  const tryProSrc = `
module try_pro;
fn risky() -> i64 {
    try {
        let a = 1;
    } catch (e) {
        let b = 2;
    }
    return 0;
}
`;
  const tryBegSrc = `
MODULE try_beg
FUNCTION risky() -> Int
    TRY
        LET a = 1
    IF FAILED e
        LET b = 2
    END
    RETURN 0
END
`;
  const traitProSrc = `
module trait_pro;
trait Serializable {
    fn to_json(val: i64) -> str;
}
fn main() -> i64 { return 0; }
`;
  const traitBegSrc = `
MODULE trait_beg
TRAIT Serializable
    FUNCTION to_json(val: Int) -> Text
END
FUNCTION main() -> Int
    RETURN 0
END
`;

  for (const [label, src, prof] of [
    ['Pro TryStmt', tryProSrc, 'professional'],
    ['Beg TryStmt', tryBegSrc, 'beginner'],
    ['Pro TraitDecl', traitProSrc, 'professional'],
    ['Beg TraitDecl', traitBegSrc, 'beginner'],
  ] as const) {
    const res = await checkManifestSource(src, { profile: prof });
    const unsupported = res.diagnostics.find((d) => d.code === 'E_UNSUPPORTED_FEATURE');
    assert(
      !res.ok && !!unsupported && unsupported.line > 1 && !!unsupported.hint,
      `4.x ${label} fails compilation with E_UNSUPPORTED_FEATURE + location + hint`
    );
  }

  // Confirm MIR builder itself also rejects TryStmt with E_UNSUPPORTED_FEATURE if called directly
  const tryParsed = parseSemanticModule(tryProSrc, { profile: 'professional' });
  const tryTc = new TypeChecker().check(tryParsed);
  const tryCap = analyzeCapabilitiesAndEffects(tryParsed);
  let irRejected = false;
  try {
    buildTypedIR(tryParsed, tryTc, tryCap);
  } catch (err: any) {
    irRejected = err?.code === 'E_UNSUPPORTED_FEATURE';
  }
  assert(irRejected, '4.5 TypedIRBuilder independently rejects TryStmt with E_UNSUPPORTED_FEATURE');

  console.log(`\nStage 4 Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runStage4Tests().catch((err) => {
  console.error('Stage 4 test runner error:', err);
  process.exit(1);
});

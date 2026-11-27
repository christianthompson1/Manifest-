/**
 * Manifest Studio - Integrated Engineering Audit Verification Suite
 *
 * Verifies:
 * 1. Differential Behavioral Parity: Rust MVM vs TS MIR Evaluator vs Web-JS Target
 * 2. Rust Compiler Engine Diagnostics & Legacy v0.x Rejection (`E_LEGACY_V0_REMOVED`)
 * 3. Deterministic Entry Selection, Unsupported Language Refusal, & Async Run Superseding
 * 4. Multi-File Static Web Bundling, CSS url() Assets, Missing Asset Warnings, & Standalone JS Harness
 * 5. Real WebAssembly (.wasm) Binary Execution Provider (env.*, WASI fd_write stdout, error boundaries)
 * 6. Project Tree Hierarchy (.gitkeep handling) & Binary-Safe ZIP Export/Import Round-Trip
 */

import {
  checkManifestSource,
  compileManifestV1,
  evaluateMIRModule,
  runManifestOnRustMvm,
} from '../src/index.ts';
import { ExecutionOrchestrator } from '../../src/studio/execution/execution-orchestrator.ts';
import { StaticWebExecutionProvider } from '../../src/studio/execution/static-web-execution-provider.ts';
import {
  WasmExecutionProvider,
  STARTER_WASM_BYTES,
  encodeWasmDataUrl,
  decodeWasmFileContent,
} from '../../src/studio/execution/wasm-execution-provider.ts';
import { LanguageRegistry } from '../../src/studio/languages/language-registry.ts';
import { buildProjectTree } from '../../src/studio/explorer/ProjectTree.tsx';
import { exportProjectToZip, importProjectFromZip } from '../../src/studio/services/zip-service.ts';
import { ManifestProject, ProjectFile } from '../../src/studio/types.ts';

async function runCompiledWebJsProgram(source: string): Promise<{ outputs: string[]; returnValue: string }> {
  const compiled = await compileManifestV1(source, { target: 'web-js' });
  if (!compiled.success || !compiled.jsCode) {
    throw new Error(`Web-JS compilation failed: ${compiled.diagnostics.map((d) => d.message).join('; ')}`);
  }
  const executableCode =
    compiled.jsCode.replace('export function __runManifestModule', 'function __runManifestModule') +
    '\nreturn __runManifestModule();';

  const fn = new Function(executableCode);
  const res = fn();
  return { outputs: Array.isArray(res.stdout) ? res.stdout : [], returnValue: String(res.returnValue) };
}

/**
 * Hand-assembled minimal WASI WebAssembly module that writes "Hello WASI\n" via fd_write(1, iov, 1, nwritten)
 */
function buildWasiHelloWasmBytes(): Uint8Array {
  // Module imports wasi_snapshot_preview1.fd_write (i32, i32, i32, i32) -> i32
  // Memory 1 page, exports memory and _start
  // Data at offset 16: "Hello WASI\n" (11 bytes)
  // iovec at offset 0: ptr=16 (0x10,0,0,0), len=11 (0x0b,0,0,0)
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    // Type section (2 types: 0=(i32,i32,i32,i32)->i32, 1=()->())
    0x01, 0x0c, 0x02,
    0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x7f,
    0x60, 0x00, 0x00,
    // Import section: wasi_snapshot_preview1.fd_write : type 0 (1 + 23 + 9 + 2 = 35 = 0x23 bytes)
    0x02, 0x23, 0x01,
    0x16, 0x77, 0x61, 0x73, 0x69, 0x5f, 0x73, 0x6e, 0x61, 0x70, 0x73, 0x68, 0x6f, 0x74, 0x5f, 0x70, 0x72, 0x65, 0x76, 0x69, 0x65, 0x77, 0x31,
    0x08, 0x66, 0x64, 0x5f, 0x77, 0x72, 0x69, 0x74, 0x65,
    0x00, 0x00,
    // Function section: 1 function (_start : type 1)
    0x03, 0x02, 0x01, 0x01,
    // Memory section: 1 memory, min 1 page
    0x05, 0x03, 0x01, 0x00, 0x01,
    // Export section: memory (mem 0), _start (func 1)
    0x07, 0x13, 0x02,
    0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
    0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x01,
    // Code section: _start calls fd_write(1, 0, 1, 64), drop
    0x0a, 0x10, 0x01,
    0x0e, 0x00,
    0x41, 0x01, // fd = 1 (stdout)
    0x41, 0x00, // iovs_ptr = 0
    0x41, 0x01, // iovs_len = 1
    0x41, 0xc0, 0x00, // nwritten_ptr = 64
    0x10, 0x00, // call fd_write
    0x1a,       // drop
    0x0b,       // end
    // Data section: 2 segments (1 + 13 + 16 = 30 = 0x1e bytes)
    0x0b, 0x1e, 0x02,
    // Segment 0 at offset 0: iovec { ptr: 16, len: 11 }
    0x00, 0x41, 0x00, 0x0b, 0x08,
    0x10, 0x00, 0x00, 0x00, 0x0b, 0x00, 0x00, 0x00,
    // Segment 1 at offset 16: "Hello WASI\n"
    0x00, 0x41, 0x10, 0x0b, 0x0b,
    0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x41, 0x53, 0x49, 0x0a,
  ]);
}

function makeFile(path: string, content: string, language: ProjectFile['language'], isBinary = false): ProjectFile {
  return {
    id: `f-${path}`,
    name: path.split('/').pop() || path,
    path,
    content,
    language,
    isBinary,
  };
}

export async function runAuditVerificationTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, description: string) {
    if (condition) {
      console.log(`  ✓ ${description}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${description}`);
      failed++;
    }
  }

  console.log('\n--- Running Integrated Audit & Parity Verification Tests ---');

  // ============================================================================
  // 1. DIFFERENTIAL PARITY: RUST MVM vs MIR REFERENCE ORACLE vs WEB-JS TARGET
  // ============================================================================
  const differentialPrograms: Array<{
    name: string;
    source: string;
    expectedStdout: string[];
    expectedReturn: string;
  }> = [
    {
      name: 'Unary operators (-, !) and array indexing (nums[i])',
      source: `module parity_unary;
requires console;

fn main() -> i64 effects(console) {
    let nums: Array<i64> = [10, 25, 40];
    let flag: bool = false;
    let neg: i64 = -nums[1];
    if !flag {
        console.print(neg);
        console.print(nums[0] + nums[2]);
    }
    return nums[0] + nums[2];
}`,
      expectedStdout: ['-25', '50'],
      expectedReturn: '50',
    },
    {
      name: 'Control flow (if/else, for-in, while) + forward fn call',
      source: `module parity_flow;
requires console;

fn main() -> i64 effects(console) {
    let values: Array<i64> = [2, 4, 6];
    let res: i64 = summarize(values);
    console.print(res);
    return res;
}

fn summarize(values: Array<i64>) -> i64 {
    let mut acc: i64 = 0;
    for v in values {
        if v > 3 {
            let mut k: i64 = 0;
            while k < 2 {
                acc = acc + v;
                k = k + 1;
            }
        } else {
            acc = acc + 1;
        }
    }
    return acc;
}`,
      expectedStdout: ['21'],
      expectedReturn: '21',
    },
    {
      name: 'Recursive factorial with lexical parameter isolation',
      source: `module parity_rec;
requires console;

fn fact(n: i64) -> i64 {
    if n <= 1 {
        return 1;
    }
    let prev: i64 = fact(n - 1);
    return n * prev;
}

fn main() -> i64 effects(console) {
    let n: i64 = 999;
    let six_fact: i64 = fact(6);
    console.print(six_fact);
    console.print(n);
    return six_fact;
}`,
      expectedStdout: ['720', '999'],
      expectedReturn: '720',
    },
  ];

  for (const prog of differentialPrograms) {
    try {
      const checked = await checkManifestSource(prog.source);
      const mirEval = evaluateMIRModule(checked.mir!, { grantedCapabilities: ['console'] });
      const mvmRun = await runManifestOnRustMvm(prog.source, { grantedCapabilities: ['console'] });
      const webJsRun = await runCompiledWebJsProgram(prog.source);
      const mirMatch =
        mirEval.ok &&
        JSON.stringify(mirEval.stdout) === JSON.stringify(prog.expectedStdout) &&
        String(mirEval.returnValue) === prog.expectedReturn;
      const mvmMatch =
        mvmRun.ok &&
        JSON.stringify(mvmRun.stdout) === JSON.stringify(prog.expectedStdout) &&
        mvmRun.returnValue === prog.expectedReturn;
      const webMatch =
        JSON.stringify(webJsRun.outputs) === JSON.stringify(prog.expectedStdout) &&
        webJsRun.returnValue === prog.expectedReturn;
      assert(
        mirMatch && mvmMatch && webMatch,
        `1. Differential Parity [${prog.name}]: MVM=${mvmRun.returnValue} == MIR=${mirEval.returnValue} == WebJS=${webJsRun.returnValue}`
      );
    } catch (err: any) {
      assert(false, `1. Differential Parity [${prog.name}] threw: ${err.message}`);
    }
  }

  // Deterministic division by zero trap across MVM, MIR evaluator, and Web-JS
  try {
    const divZeroSrc = `module parity_div_zero;
fn main() -> i64 {
    return 100 / 0;
}`;
    const checkedDz = await checkManifestSource(divZeroSrc);
    const mirDz = evaluateMIRModule(checkedDz.mir!, { grantedCapabilities: [] });
    const mvmDz = await runManifestOnRustMvm(divZeroSrc, { grantedCapabilities: [] });
    let webDzError = '';
    try {
      await runCompiledWebJsProgram(divZeroSrc);
    } catch (e: any) {
      webDzError = String(e.message || e);
    }
    assert(
      !mirDz.ok && !mvmDz.ok && /zero/i.test(mvmDz.error || '') && /zero/i.test(webDzError),
      '1. Division by zero traps deterministically across Rust MVM, MIR evaluator, and Web-JS'
    );
  } catch (err: any) {
    assert(false, `1. Division by zero parity check failed: ${err.message}`);
  }

  // Recursion / call-depth guard test
  try {
    const infRecSource = `module inf_recursion;
fn ping(x: i64) -> i64 {
    return ping(x + 1);
}
fn main() -> i64 {
    return ping(1);
}`;
    const checkedInf = await checkManifestSource(infRecSource);
    const mirInf = evaluateMIRModule(checkedInf.mir!, { grantedCapabilities: [], maxSteps: 10000 });
    const mvmInf = await runManifestOnRustMvm(infRecSource, { grantedCapabilities: [], maxSteps: 10000 });
    assert(
      !mirInf.ok && !mvmInf.ok,
      '1. Recursion/execution budget guard protects both MIR evaluator and Rust MVM'
    );
  } catch (err: any) {
    assert(false, `1. Recursion guard check failed: ${err.message}`);
  }

  // ============================================================================
  // 2. RUST COMPILER ENGINE DIAGNOSTIC CHECKS
  // ============================================================================
  {
    const undefCall = await checkManifestSource(`module undef_call;
fn main() -> i64 {
    return does_not_exist(10);
}`);
    assert(
      !undefCall.ok && undefCall.diagnostics.some((d) => d.severity === 'error' && d.message.includes('does_not_exist')),
      '2. Rust engine rejects call to undeclared fn "does_not_exist"'
    );

    const dupFn = await checkManifestSource(`module dup_fn;
fn work(x: i64) -> i64 { return x; }
fn work(y: i64) -> i64 { return y; }
fn main() -> i64 { return 0; }`);
    assert(
      !dupFn.ok && dupFn.diagnostics.some((d) => d.severity === 'error' && (d.code?.includes('DUPLICATE') || d.message.toLowerCase().includes('duplicate'))),
      '2. Rust engine rejects duplicate fn declarations'
    );

    const badRet = await checkManifestSource(`module bad_ret;
fn main() -> i64 {
    return "not_an_int";
}`);
    assert(
      !badRet.ok && badRet.diagnostics.some((d) => d.severity === 'error'),
      '2. Rust engine rejects return type mismatch (str vs i64)'
    );

    const deniedCap = await checkManifestSource(`module denied_cap;
denies console;
fn main() -> i64 {
    console.print("blocked");
    return 0;
}`);
    assert(
      !deniedCap.ok && deniedCap.diagnostics.some((d) => d.severity === 'error' && d.code?.includes('CAPABILITY')),
      '2. Rust engine rejects usage of explicitly denied capability'
    );

    const legacyRejected = await checkManifestSource(`APP "LegacyV0"\nPAGE Home\n    TEXT "Hello"\nEND`);
    assert(
      !legacyRejected.ok && legacyRejected.diagnostics.some((d) => d.code === 'E_LEGACY_V0_REMOVED'),
      '2. Rust engine rejects legacy v0.x syntax with E_LEGACY_V0_REMOVED'
    );
  }

  // ============================================================================
  // 3. DETERMINISTIC ENTRY SELECTION & UNSUPPORTED LANGUAGE REFUSAL
  // ============================================================================
  {
    const mixedProject: ManifestProject = {
      id: 'proj-mixed-audit',
      name: 'Mixed Audit Workspace',
      description: 'Tests strict language routing',
      kind: 'manifest',
      activeFilePath: 'scripts/train.py',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: [
        makeFile('src/main.manifest', 'module main;\nrequires console;\nfn main() -> i64 effects(console) {\n  console.print("FROM_MAIN_MANIFEST");\n  return 0;\n}', 'manifest'),
        makeFile('src/other.manifest', 'module other;\nrequires console;\nfn main() -> i64 effects(console) {\n  console.print("FROM_OTHER_MANIFEST");\n  return 0;\n}', 'manifest'),
        makeFile('scripts/train.py', 'print("hello python")', 'python'),
        makeFile('native/lib.rs', 'pub fn main() {}', 'rust'),
        makeFile('firmware/core.c', 'int main() { return 0; }', 'c'),
        makeFile('web/client.ts', 'const x: number = 1;', 'typescript'),
        makeFile('manifest.toml', 'name = "Mixed"\nentry = "src/main.manifest"\ntarget = "web-js"', 'toml'),
      ],
    };

    const orchestrator = ExecutionOrchestrator.getInstance();
    const registry = LanguageRegistry.getInstance();

    for (const nonExecPath of ['scripts/train.py', 'native/lib.rs', 'firmware/core.c', 'web/client.ts']) {
      const res = await orchestrator.executeProject({
        ...mixedProject,
        activeFilePath: nonExecPath,
      });
      assert(
        res.success === false &&
          res.providerId === 'unsupported-language' &&
          !res.logs.some((l) => l.includes('FROM_MAIN_MANIFEST')),
        `3. Running ${nonExecPath} refuses execution honestly and NEVER runs src/main.manifest`
      );
    }

    // Running src/other.manifest must run src/other.manifest, NOT src/main.manifest
    const secondManifestRes = await orchestrator.executeProject({
      ...mixedProject,
      activeFilePath: 'src/other.manifest',
    });
    assert(
      secondManifestRes.success === true &&
        secondManifestRes.resolvedEntryPath === 'src/other.manifest' &&
        Boolean(secondManifestRes.outputCode?.includes('FROM_OTHER_MANIFEST')) &&
        !secondManifestRes.outputCode?.includes('FROM_MAIN_MANIFEST'),
      '3. Running active file src/other.manifest executes src/other.manifest (never switches to src/main.manifest)'
    );

    // Missing configured entry in manifest.toml must fail explicitly when on a neutral file
    const brokenEntryProj: ManifestProject = {
      ...mixedProject,
      activeFilePath: 'manifest.toml',
      files: [
        makeFile('src/main.manifest', 'module main;\nrequires console;\nfn main() -> i64 effects(console) {\n  console.print("MAIN");\n  return 0;\n}', 'manifest'),
        makeFile('manifest.toml', 'name = "Broken"\nentry = "src/deleted.manifest"', 'toml'),
      ],
    };
    const brokenEntryRes = await orchestrator.executeProject(brokenEntryProj);
    assert(
      brokenEntryRes.success === false &&
        brokenEntryRes.diagnostics.some((d) => d.message.includes('src/deleted.manifest')),
      '3. Missing configured entry in manifest.toml fails explicitly instead of silently running src/main.manifest'
    );

    // Concurrent run superseding check
    const [r1, r2] = await Promise.all([
      orchestrator.executeProject({ ...mixedProject, activeFilePath: 'src/main.manifest' }),
      orchestrator.executeProject({ ...mixedProject, activeFilePath: 'src/other.manifest' }),
    ]);
    assert(
      r1.superseded === true && !r2.superseded && r2.resolvedEntryPath === 'src/other.manifest',
      '3. Concurrent ExecutionOrchestrator runs mark superseded earlier runs with superseded=true'
    );

    // Language Registry checks
    assert(
      registry.detectProvider('manifest.toml').id === 'toml' &&
        registry.detectProvider('manifest.toml').capabilities.diagnostics === 'none',
      '3. LanguageRegistry classifies manifest.toml as TOML (not Manifest source)'
    );
    assert(
      registry.detectProvider('package.json').capabilities.diagnostics === 'native',
      '3. LanguageRegistry enables real JSON syntax diagnostics for .json files'
    );
  }

  // ============================================================================
  // 4. STATIC WEB MULTI-FILE ASSETS, DIAGNOSTICS, & STANDALONE JS
  // ============================================================================
  {
    const webProvider = new StaticWebExecutionProvider();
    const svgLogo = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#38bdf8"/></svg>';

    const validWebProj: ManifestProject = {
      id: 'web-assets-ok',
      name: 'Web Assets OK',
      description: '',
      kind: 'web',
      activeFilePath: 'index.html',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: [
        makeFile(
          'index.html',
          '<!DOCTYPE html><html><head><link rel="stylesheet" href="css/site.css"></head><body><img src="assets/logo.svg" alt="logo"><script src="js/app.js"></script></body></html>',
          'html'
        ),
        makeFile('css/site.css', '.hero { background-image: url("../assets/logo.svg"); }', 'css'),
        makeFile('js/app.js', 'console.log("web bundle ready");', 'javascript'),
        makeFile('assets/logo.svg', svgLogo, 'html'),
      ],
    };

    const webOkRes = await webProvider.execute(validWebProj);
    assert(
      webOkRes.success &&
        webOkRes.diagnostics.length === 0 &&
        webOkRes.resolvedEntryPath === 'index.html' &&
        Boolean(webOkRes.previewHtml?.includes('data:image/svg+xml;base64,')),
      '4. StaticWebExecutionProvider resolves HTML <img>, CSS url(...), and JS with 0 diagnostics'
    );

    const missingAssetProj: ManifestProject = {
      ...validWebProj,
      id: 'web-assets-missing',
      files: [
        makeFile(
          'index.html',
          '<!DOCTYPE html>\n<link rel="stylesheet" href="missing.css">\n<img src="assets/missing.png">\n<script src="missing.js"></script>',
          'html'
        ),
      ],
    };
    const missingRes = await webProvider.execute(missingAssetProj);
    assert(
      missingRes.success &&
        missingRes.diagnostics.length === 3 &&
        missingRes.diagnostics[0].line === 2 &&
        missingRes.diagnostics[1].line === 3 &&
        missingRes.diagnostics[2].line === 4,
      '4. StaticWebExecutionProvider emits line-accurate warnings for missing CSS, image, and JS assets'
    );

    // Standalone .js execution when no .html exists
    const standaloneJsProj: ManifestProject = {
      id: 'standalone-js',
      name: 'Standalone JS',
      description: '',
      kind: 'javascript',
      activeFilePath: 'index.js',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: [makeFile('index.js', 'console.log(6 * 7);', 'javascript')],
    };
    const jsRunRes = await ExecutionOrchestrator.getInstance().executeProject(standaloneJsProj);
    assert(
      jsRunRes.success &&
        jsRunRes.providerId === 'static-web-provider' &&
        jsRunRes.resolvedEntryPath === 'index.js' &&
        Boolean(jsRunRes.previewHtml?.includes('console.log(6 * 7)')),
      '4. Standalone .js file executes cleanly via StaticWebExecutionProvider JS console harness'
    );
  }

  // ============================================================================
  // 5. REAL WEBASSEMBLY (.WASM) BINARY EXECUTION PROVIDER
  // ============================================================================
  {
    const wasmProvider = new WasmExecutionProvider();

    // 5a. Starter .wasm binary (imports env.print_i32, exports add & main -> 42)
    const starterWasmProj: ManifestProject = {
      id: 'wasm-starter-test',
      name: 'Wasm Starter',
      description: '',
      kind: 'wasm',
      activeFilePath: 'module.wasm',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: [makeFile('module.wasm', encodeWasmDataUrl(STARTER_WASM_BYTES), 'wasm', true)],
    };
    const wasmRes = await ExecutionOrchestrator.getInstance().executeProject(starterWasmProj);
    assert(
      wasmRes.success === true &&
        wasmRes.providerId === 'wasm-provider' &&
        wasmRes.resolvedEntryPath === 'module.wasm' &&
        wasmRes.logs.some((l) => l.includes('42')),
      '5. WasmExecutionProvider validates, instantiates, and runs STARTER_WASM_BYTES (main() -> 42)'
    );

    // 5b. WASI fd_write stdout capture
    const wasiBytes = buildWasiHelloWasmBytes();
    const wasiProj: ManifestProject = {
      ...starterWasmProj,
      id: 'wasm-wasi-test',
      files: [makeFile('hello_wasi.wasm', encodeWasmDataUrl(wasiBytes), 'wasm', true)],
      activeFilePath: 'hello_wasi.wasm',
    };
    const wasiRes = await wasmProvider.execute(wasiProj);
    assert(
      wasiRes.success === true && wasiRes.logs.some((l) => l.includes('Hello WASI')),
      '5. WasmExecutionProvider captures UTF-8 stdout from WASI fd_write'
    );

    // 5c. Malformed .wasm binary fails clearly
    const badWasmProj: ManifestProject = {
      ...starterWasmProj,
      id: 'wasm-bad-bytes',
      files: [makeFile('corrupt.wasm', encodeWasmDataUrl(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), 'wasm', true)],
      activeFilePath: 'corrupt.wasm',
    };
    const badWasmRes = await wasmProvider.execute(badWasmProj);
    assert(
      badWasmRes.success === false && badWasmRes.diagnostics.length > 0,
      '5. WasmExecutionProvider rejects malformed .wasm binary with structured diagnostic'
    );
  }

  // ============================================================================
  // 6. PROJECT TREE HIERARCHY & BINARY-SAFE ZIP ROUND-TRIP
  // ============================================================================
  {
    const treeFiles: ProjectFile[] = [
      makeFile('src/main.manifest', 'module tree;\nfn main() -> i64 { return 0; }', 'manifest'),
      makeFile('src/components/Navbar.manifest', 'module navbar;\nexport fn label() -> str { return "ok"; }', 'manifest'),
      makeFile('assets/icons/logo.svg', '<svg></svg>', 'html', false),
      makeFile('empty_folder/.gitkeep', '', 'plaintext', false),
      makeFile('bin/module.wasm', encodeWasmDataUrl(STARTER_WASM_BYTES), 'wasm', true),
    ];

    const rootNode = buildProjectTree(treeFiles);
    const emptyFolderNode = rootNode.children.find((c) => c.name === 'empty_folder' && c.isFolder);
    const assetsNode = rootNode.children.find((c) => c.name === 'assets' && c.isFolder);
    const iconsNode = assetsNode?.children.find((c) => c.name === 'icons' && c.isFolder);
    const logoNode = iconsNode?.children.find((c) => c.name === 'logo.svg' && !c.isFolder);

    assert(
      Boolean(emptyFolderNode && emptyFolderNode.children.length === 0 && logoNode),
      '6. buildProjectTree preserves nested directories and empty folders while hiding .gitkeep sentinel rows'
    );

    // Binary ZIP export -> import round-trip
    const zipSourceProject: ManifestProject = {
      id: 'zip-roundtrip',
      name: 'ZipRoundTrip',
      description: 'Binary & SVG roundtrip',
      kind: 'manifest',
      activeFilePath: 'src/main.manifest',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: treeFiles,
    };

    const zipBlob = await exportProjectToZip(zipSourceProject);
    const zipBuffer = await zipBlob.arrayBuffer();
    const reimported = await importProjectFromZip(zipBuffer, 'ZipRoundTrip.zip');

    const reimportedWasm = reimported.files.find((f) => f.path === 'bin/module.wasm');
    const reimportedSvg = reimported.files.find((f) => f.path === 'assets/icons/logo.svg');
    const decodedWasm = reimportedWasm ? decodeWasmFileContent(reimportedWasm.content) : null;

    const bytesIdentical =
      decodedWasm !== null &&
      decodedWasm.length === STARTER_WASM_BYTES.length &&
      decodedWasm.every((b, idx) => b === STARTER_WASM_BYTES[idx]);

    assert(
      Boolean(reimportedWasm?.isBinary && bytesIdentical),
      '6. ZIP export/import preserves raw binary .wasm bytes identically without UTF-8 corruption'
    );
    assert(
      Boolean(reimportedSvg && !reimportedSvg.isBinary && reimportedSvg.content === '<svg></svg>'),
      '6. ZIP export/import preserves .svg files as editable XML text (isBinary === false)'
    );
  }

  return { passed, failed, total: passed + failed };
}

const isDirectCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_audit_verification_tests.ts'));

if (isDirectCLI) {
  runAuditVerificationTests()
    .then((res) => {
      console.log(`\nAudit Verification Summary: ${res.passed}/${res.total} passed (${res.failed} failed)`);
      if (res.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('Fatal error in run_audit_verification_tests:', err);
      process.exit(1);
    });
}

/**
 * Manifest Studio - Integrated Engineering Audit Verification Suite
 *
 * Verifies:
 * 1. Differential Behavioral Parity: AST Interpreter (Runtime) vs JS Target Compiler (JSTargetCompiler)
 * 2. Two-Pass Semantic Validator & IR/Codegen Completeness (Unary, IndexAccess, Badge/Progress/Icon/Escapes)
 * 3. Deterministic Entry Selection, Unsupported Language Refusal, & Async Run Superseding
 * 4. Multi-File Static Web Bundling, CSS url() Assets, Missing Asset Warnings, & Standalone JS Harness
 * 5. Real WebAssembly (.wasm) Binary Execution Provider (env.*, WASI fd_write stdout, error boundaries)
 * 6. Project Tree Hierarchy (.gitkeep handling) & Binary-Safe ZIP Export/Import Round-Trip
 */

import {
  executeManifest,
  compileManifest,
  inspectManifest,
  Lexer,
  Parser,
  Validator,
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

function createMockDOM() {
  class MockElement {
    tagName: string;
    className = '';
    id = '';
    textContent = '';
    src = '';
    alt = '';
    type = '';
    placeholder = '';
    value = '';
    children: MockElement[] = [];
    parentNode: MockElement | null = null;
    onclick: ((e: any) => any) | null = null;
    oninput: ((e: any) => any) | null = null;
    style: Record<string, any>;

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
      const props: Record<string, string> = {};
      this.style = new Proxy(props, {
        set(target, prop: string, val) {
          target[prop] = String(val);
          return true;
        },
        get(target, prop: string) {
          if (prop === 'setProperty') {
            return (k: string, v: string) => {
              target[k] = String(v);
            };
          }
          if (prop === 'getPropertyValue') {
            return (k: string) => target[k] || '';
          }
          return target[prop] || '';
        },
      });
    }

    appendChild(child: MockElement) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    addEventListener() {}

    set innerHTML(val: string) {
      if (val === '') {
        this.children = [];
        this.textContent = '';
      } else {
        this.textContent = val;
      }
    }

    querySelector(selector: string): MockElement | null {
      for (const child of this.children) {
        if (selector.startsWith('.') && child.className.split(/\s+/).includes(selector.slice(1))) {
          return child;
        }
        if (selector.startsWith('#') && child.id === selector.slice(1)) {
          return child;
        }
        if (child.tagName.toLowerCase() === selector.toLowerCase()) {
          return child;
        }
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
  }

  const body = new MockElement('body');
  const head = new MockElement('head');
  return {
    MockElement,
    mockDocument: {
      body,
      head,
      createElement: (tag: string) => new MockElement(tag),
    },
  };
}

async function runCompiledJSProgram(source: string): Promise<{ outputs: string[]; state: Record<string, any>; mountRoot: any }> {
  const compiled = await compileManifest(source, 'js');
  if (!compiled.success || !compiled.outputCode) {
    throw new Error(`JS compilation failed: ${compiled.diagnostics.map((d) => d.message).join('; ')}`);
  }
  const { mockDocument, MockElement } = createMockDOM();
  const mountRoot = mockDocument.createElement('div');
  const outputs: string[] = [];

  const executableCode =
    compiled.outputCode
      .replace('export const __manifest =', 'const __manifest =')
      .replace('export async function startApp', 'async function startApp') +
    '\nreturn { startApp, __manifest };';

  const fn = new Function('document', 'Element', executableCode);
  const mod = fn(mockDocument, MockElement);
  await mod.startApp(mountRoot, {
    onOutput: (msg: string) => outputs.push(msg),
  });

  return { outputs, state: { ...mod.__manifest.state }, mountRoot };
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
  // 1. DIFFERENTIAL PARITY: INTERPRETER vs JS TARGET COMPILER
  // ============================================================================
  const differentialPrograms: Array<{ name: string; source: string; expected: string[] }> = [
    {
      name: 'Unary operators (-, NOT) and array indexing (items[i])',
      source: `
        APP "ParityUnaryIndex"
        SET nums TO [10, 25, 40]
        SET flag TO false
        WHEN app.starts
            SET neg TO -nums[1]
            IF NOT flag
                SHOW neg
                SHOW nums[0] + nums[2]
            END
        END
      `,
      expected: ['-25', '50'],
    },
    {
      name: 'ACTION control flow (IF/ELSE, REPEAT, FOR EACH) + forward CALL',
      source: `
        APP "ParityActionControlFlow"
        WHEN app.starts
            SET res TO CALL summarize [2, 4, 6]
            SHOW res
        END

        ACTION summarize values
            SET acc TO 0
            FOR EACH v IN values
                IF v > 3
                    REPEAT 2 TIMES
                        SET acc TO acc + v
                    END
                ELSE
                    SET acc TO acc + 1
                END
            END
            RETURN acc
        END
      `,
      expected: ['21'],
    },
    {
      name: 'Recursive ACTION (factorial) with lexical parameter isolation',
      source: `
        APP "ParityRecursion"
        SET n TO 999
        ACTION fact n
            IF n <= 1
                RETURN 1
            END
            SET prev TO CALL fact (n - 1)
            RETURN n * prev
        END
        WHEN app.starts
            SET sixFact TO CALL fact 6
            SHOW sixFact
            SHOW n
        END
      `,
      expected: ['720', '999'],
    },
    {
      name: 'TRY / IF FAILED catching division by zero identically',
      source: `
        APP "ParityTryDivZero"
        WHEN app.starts
            TRY
                SET bad TO 100 / 0
                SHOW bad
            IF FAILED
                SHOW "CAUGHT_DIV_ZERO"
            END
        END
      `,
      expected: ['CAUGHT_DIV_ZERO'],
    },
  ];

  for (const prog of differentialPrograms) {
    try {
      const interpRes = await executeManifest(prog.source, { validate: true });
      const jsRes = await runCompiledJSProgram(prog.source);
      const interpMatch = JSON.stringify(interpRes.output) === JSON.stringify(prog.expected);
      const parityMatch = JSON.stringify(interpRes.output) === JSON.stringify(jsRes.outputs);
      assert(
        interpMatch && parityMatch,
        `1. Differential Parity [${prog.name}]: Interpreter=${JSON.stringify(interpRes.output)} == JS=${JSON.stringify(jsRes.outputs)}`
      );
    } catch (err: any) {
      assert(false, `1. Differential Parity [${prog.name}] threw: ${err.message}`);
    }
  }

  // Recursion depth guard test
  try {
    const infRecSource = `
      APP "InfRecursion"
      ACTION ping x
          RETURN CALL ping (x + 1)
      END
      WHEN app.starts
          CALL ping 1
      END
    `;
    let caughtInterp = false;
    try {
      await executeManifest(infRecSource, { validate: true });
    } catch (e: any) {
      caughtInterp = String(e.message || e).includes('Maximum recursion depth');
    }
    let caughtJs = false;
    try {
      await runCompiledJSProgram(infRecSource);
    } catch (e: any) {
      caughtJs = String(e.message || e).includes('Maximum recursion depth');
    }
    assert(caughtInterp && caughtJs, '1. Recursion depth guard (>200) protects both Interpreter and Compiled JS');
  } catch (err: any) {
    assert(false, `1. Recursion guard check failed: ${err.message}`);
  }

  // UI Primitives IR + JS Target lowering check (Badge, Progress, Icon, CssEscape)
  try {
    const uiPrimitivesSrc = `
      APP "AllPrimitives"
      PAGE Home
          BADGE "Beta"
          PROGRESS 75
          ICON "rocket"
          CSS ".custom-box { border: 1px solid red; }"
      END
    `;
    const uiRun = await runCompiledJSProgram(uiPrimitivesSrc);
    assert(uiRun.mountRoot.querySelector('.manifest-badge') !== null, '1. JS Target renders BADGE DOM element');
    assert(uiRun.mountRoot.querySelector('.manifest-progress') !== null, '1. JS Target renders PROGRESS DOM element');
    assert(uiRun.mountRoot.querySelector('.manifest-icon') !== null, '1. JS Target renders ICON DOM element');
  } catch (err: any) {
    assert(false, `1. UI primitives lowering failed: ${err.message}`);
  }

  // ============================================================================
  // 2. TWO-PASS SEMANTIC VALIDATOR CHECKS
  // ============================================================================
  {
    const undefCall = inspectManifest(`
      APP "UndefCall"
      WHEN app.starts
          CALL doesNotExist 10
      END
    `);
    assert(
      Boolean(undefCall.validation && !undefCall.validation.isValid && undefCall.validation.issues.some((i) => i.message.includes('doesNotExist'))),
      '2. Validator rejects CALL to undeclared ACTION "doesNotExist"'
    );

    const dupAction = inspectManifest(`
      APP "DupAction"
      ACTION work x
          RETURN x
      END
      ACTION work y
          RETURN y
      END
    `);
    assert(
      Boolean(dupAction.validation && !dupAction.validation.isValid && dupAction.validation.issues.some((i) => i.message.includes('Duplicate ACTION'))),
      '2. Validator rejects duplicate ACTION declarations'
    );

    const topReturn = inspectManifest(`
      APP "TopReturn"
      RETURN 42
    `);
    assert(
      Boolean(topReturn.validation && !topReturn.validation.isValid && topReturn.validation.issues.some((i) => i.message.includes('RETURN'))),
      '2. Validator rejects RETURN statement outside an ACTION'
    );

    const badRoute = inspectManifest(`
      APP "BadRoute"
      PAGE Home
          TEXT "Hi"
      END
      ROUTE "/ghost" -> GhostPage
    `);
    assert(
      Boolean(badRoute.validation && !badRoute.validation.isValid && badRoute.validation.issues.some((i) => i.message.includes('GhostPage'))),
      '2. Validator rejects ROUTE pointing to undefined PAGE "GhostPage"'
    );

    const divZeroWarn = inspectManifest(`
      APP "DivZeroWarn"
      SET val TO 50 / 0
    `);
    assert(
      Boolean(
        divZeroWarn.validation &&
          divZeroWarn.validation.isValid &&
          divZeroWarn.validation.issues.some((i) => i.severity === 'warning' && i.message.includes('Division or modulo by literal zero'))
      ),
      '2. Validator emits warning for literal division by zero outside TRY block'
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
        makeFile('src/main.manifest', 'APP "Main"\nWHEN app.starts\nSHOW "FROM_MAIN_MANIFEST"\nEND', 'manifest'),
        makeFile('src/other.manifest', 'APP "Other"\nWHEN app.starts\nSHOW "FROM_OTHER_MANIFEST"\nEND', 'manifest'),
        makeFile('scripts/train.py', 'print("hello python")', 'python'),
        makeFile('native/lib.rs', 'pub fn main() {}', 'rust'),
        makeFile('firmware/core.c', 'int main() { return 0; }', 'c'),
        makeFile('web/client.ts', 'const x: number = 1;', 'typescript'),
        makeFile('manifest.toml', 'name = "Mixed"\nentry = "src/main.manifest"', 'toml'),
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
        makeFile('src/main.manifest', 'APP "Main"\nWHEN app.starts\nSHOW "MAIN"\nEND', 'manifest'),
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
      makeFile('src/main.manifest', 'APP "Tree"', 'manifest'),
      makeFile('src/components/Navbar.manifest', 'CONTAINER\nEND', 'manifest'),
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

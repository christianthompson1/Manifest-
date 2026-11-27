/**
 * Batch 1 (Stages 1, 2, 3) Comprehensive Behavioral Security & Honesty Regression Suite
 */

import http from 'http';
import {
  escapeHtml,
  sanitizeHtmlCommentText,
  escapeInlineJsForScriptTag,
  escapeJsStringLiteral,
  isSafeImageDataUrl,
  isSvgAsset,
  validateSvgPreviewContent,
} from '../../src/studio/utils/security-sanitize.ts';
import {
  generatePreviewErrorHtml,
  generatePreviewDocument,
} from '../../src/studio/preview/PreviewPanel.tsx';
import { StaticWebExecutionProvider } from '../../src/studio/execution/static-web-execution-provider.ts';
import {
  GITHUB_PAT_STORAGE_KEY,
  getStoredGitHubToken,
  setStoredGitHubToken,
  clearStoredGitHubToken,
  GitHubProvider,
} from '../../src/studio/services/git-provider.ts';
import { analyzeCapabilitiesAndEffects, capabilityCovers } from '../src/semantics/capability-analyzer.ts';
import { parseSemanticModule } from '../src/core/parse-unified.ts';
import { compileManifestV1 } from '../src/index.ts';
import { MvmInterpreter } from '../src/vm/mvm-interpreter.ts';
import {
  validateWasmMemoryRange,
  readValidatedWasmBytes,
  writeValidatedWasmBytes,
  encodeProtocolField,
  decodeProtocolField,
  encodeWasmHostRequestV2,
  decodeWasmHostRequest,
  encodeWasmHostResponse,
  verifyMbcInRustVm,
  executeMbcInRustVm,
  MAX_WASM_HOST_IO_BYTES,
} from '../src/vm/mvm-runner.ts';
import { validateSolanaRpcRequest } from '../src/solana/rpc-policy.ts';
import { createManifestServerApp } from '../../server.ts';
import {
  computeAggregateCounts,
  reconcileCountsValid,
  parseTestRunApiResponse,
  executeAndParseTestRun,
} from '../src/verification/result-model.ts';
import { LiteSVMClient } from '../../src/studio/services/litesvm-client.ts';
import {
  SolanaLiteSVMBuildProvider,
  SolanaLocalSimulatorProvider,
} from '../../src/studio/services/build-providers.ts';
import { LiteSVMRunner } from '../src/solana/litesvm-runner.ts';
import { SolanaProgramIR } from '../src/solana/solana-ir.ts';
import { runBackendConformanceCheck } from './run_v1_upgrade_tests.ts';
import { runSolanaCounterTest } from './run_solana_counter_test.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

async function runBatch1Tests() {
  console.log('\n======================================================================');
  console.log('   BATCH 1 (STAGES 1-3) SECURITY & HONEST VERIFICATION REGRESSION SUITE');
  console.log('======================================================================\n');

  // =========================================================================
  // STAGE 1: STUDIO SECURITY HARDENING
  // =========================================================================
  console.log('--- Stage 1: Studio Security Hardening ---');

  // 1A. AssetManager SVG validation & active content neutralization
  const xssSvg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>fetch('https://evil.test')</script><foreignObject><div>hack</div></foreignObject><a xlink:href="javascript:alert(2)"><circle cx="10" cy="10" r="8" onclick="alert(3)"/></a></svg>`;
  const svgRes = validateSvgPreviewContent(xssSvg);
  assert(
    svgRes.valid &&
      Boolean(svgRes.cleanSvgText) &&
      !svgRes.cleanSvgText!.includes('<script') &&
      !svgRes.cleanSvgText!.includes('<foreignObject') &&
      !svgRes.cleanSvgText!.includes('onload=') &&
      !svgRes.cleanSvgText!.includes('onclick=') &&
      !svgRes.cleanSvgText!.includes('javascript:') &&
      svgRes.cleanSvgText!.includes('<circle'),
    '1.1 SVG sanitizer strips <script>, <foreignObject>, on* handlers, and javascript: links while preserving SVG geometry'
  );

  const entitySvg = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>`;
  assert(
    !validateSvgPreviewContent(entitySvg).valid,
    '1.2 SVG validator rejects <!DOCTYPE> / <!ENTITY> XML bombs'
  );

  const htmlDisguisedSvg = `<html><body><script>alert(1)</script></body></html>`;
  assert(
    !validateSvgPreviewContent(htmlDisguisedSvg).valid,
    '1.3 SVG validator rejects HTML payloads disguised as .svg'
  );

  const oversizedSvg = `<svg>` + 'a'.repeat(2 * 1024 * 1024 + 32) + `</svg>`;
  assert(
    !validateSvgPreviewContent(oversizedSvg).valid,
    '1.4 SVG validator rejects oversized SVGs (> 2 MiB)'
  );

  assert(
    validateSvgPreviewContent(`data:image/svg+xml;base64,${Buffer.from(xssSvg).toString('base64')}`).valid &&
      isSvgAsset({ path: 'assets/logo.svg', content: '<svg></svg>' }) &&
      !isSafeImageDataUrl('javascript:alert(1)') &&
      isSafeImageDataUrl('data:image/png;base64,iVBORw0KGgo='),
    '1.5 SVG data-URL decoding and raster data:image allowlist enforce safe preview boundaries'
  );

  // 1B. PreviewPanel diagnostic & appName XSS escaping
  const evilErrHtml = generatePreviewErrorHtml(
    [
      {
        line: 4,
        column: 2,
        message: `<img src=x onerror="alert(1)">`,
        hint: `</style><script>alert('xss')</script>`,
        example: `SHOW "<b>hello</b>"`,
      },
    ],
    `<script>alert('fallback')</script>`
  );
  assert(
    !evilErrHtml.includes('<img src=x') &&
      !evilErrHtml.includes(`<script>alert('xss')`) &&
      evilErrHtml.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'),
    '1.6 generatePreviewErrorHtml escapes diagnostic message, hint, and example against HTML/script injection'
  );

  const docHtml = generatePreviewDocument({
    success: true,
    timestamp: Date.now(),
    target: 'js',
    artifacts: [],
    diagnostics: [],
    ir: { appName: `</title><script>alert(1)</script>` },
    outputCode: `function __runManifestModule(){ console.log("</script><img onerror=1>"); return { stdout: [], returnValue: "0" }; }`,
    durationMs: 1,
  });
  assert(
    docHtml.includes('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>') &&
      docHtml.includes('<\\/script><img onerror=1>'),
    '1.7 generatePreviewDocument escapes appName title and escapes </script> sequences inside compiled JS without breaking module syntax'
  );

  // 1C. StaticWebExecutionProvider multi-vector escaping + Unicode preservation
  const webProvider = new StaticWebExecutionProvider();
  const staticProj = {
    id: 'static-sec-test',
    name: 'Static Web Escape Test',
    kind: 'web' as const,
    activeFilePath: 'index.html',
    files: [
      {
        id: 'f-html',
        name: 'index.html',
        path: 'index.html',
        language: 'html',
        content: `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="app.css?v=1">
<link rel="stylesheet" href="missing--comment.css">
</head><body>
<img src="assets/icon.png">
<script src="app.js"></script>
<script src="missing--script.js"></script>
</body></html>`,
      },
      {
        id: 'f-css',
        name: 'app.css',
        path: 'app.css',
        language: 'css',
        content: `body { background: url("assets/icon.png"); content: "</style><script>alert(2)</script>"; }`,
      },
      {
        id: 'f-js',
        name: 'app.js',
        path: 'app.js',
        language: 'javascript',
        content: `const tag = "</script><script>alert(3)</script>"; const uni = "Manifest ✓"; console.log(tag, uni);`,
      },
      {
        id: 'f-img',
        name: 'icon.png',
        path: 'assets/icon.png',
        language: 'plaintext',
        isBinary: true,
        mimeType: 'image/png',
        content: 'data:image/png;base64,iVBORw0KGgo=',
      },
    ],
  };

  const staticExec = await webProvider.execute(staticProj, { activeFilePath: 'index.html' });
  const bundled = staticExec.previewHtml || '';
  assert(
    staticExec.success &&
      bundled.includes('data:image/png;base64,iVBORw0KGgo=') &&
      bundled.includes('<!-- Missing local stylesheet: missing- -comment.css -->') &&
      bundled.includes('<!-- Missing local script: missing- -script.js -->') &&
      !bundled.includes('</style><script>alert(2)') &&
      bundled.includes('<\\/script><script>alert(3)<\\/script>') &&
      bundled.includes('Manifest ✓'),
    '1.8 StaticWebExecutionProvider sanitizes missing-file comments, </style>, </script>, and asset URLs while inlining data URLs & Unicode'
  );

  // Standalone JS harness filename/tag injection test
  const standaloneJsExec = await webProvider.execute(
    {
      id: 'js-harness-sec',
      name: 'JS Escape Test',
      kind: 'javascript',
      activeFilePath: 'bad</title><script>alert(1)</script>.js',
      files: [
        {
          id: 'f-standalone',
          name: 'bad.js',
          path: 'bad</title><script>alert(1)</script>.js',
          language: 'javascript',
          content: `console.log("hi </script> <!-- test");`,
        },
      ],
    },
    { activeFilePath: 'bad</title><script>alert(1)</script>.js' }
  );
  const harness = standaloneJsExec.previewHtml || '';
  assert(
    standaloneJsExec.success &&
      !harness.includes('bad</title><script>alert(1)</script>.js') &&
      harness.includes('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;') &&
      harness.includes('<\\/script> <\\!-- test'),
    '1.9 StaticWebExecutionProvider standalone JS harness escapes malicious filenames, HTML headers, </script>, and <!--'
  );

  assert(
    sanitizeHtmlCommentText('a-->b') === 'a- -&gt;b' &&
      !sanitizeHtmlCommentText('a-->b').includes('--') &&
      escapeJsStringLiteral('</script>\u2028') === '"\\u003c/script\\u003e\\u2028"',
    '1.10 sanitizeHtmlCommentText and escapeJsStringLiteral neutralize comment breakouts and JS string traps'
  );

  // 1D. GitHub PAT sessionStorage-only + zero silent localStorage migration + Provider auth header
  const origWindow = (globalThis as any).window;
  try {
    const mockLocal = makeMemoryStorage();
    const mockSession = makeMemoryStorage();
    mockLocal.setItem(GITHUB_PAT_STORAGE_KEY, 'ghp_legacy_leaked_token');
    (globalThis as any).window = {
      localStorage: mockLocal,
      sessionStorage: mockSession,
    };

    const readAfterLegacy = getStoredGitHubToken();
    assert(
      readAfterLegacy === undefined &&
        mockLocal.getItem(GITHUB_PAT_STORAGE_KEY) === null &&
        mockSession.getItem(GITHUB_PAT_STORAGE_KEY) === null,
      '1.11 Legacy localStorage GitHub PAT is purged and NOT silently migrated into sessionStorage'
    );

    setStoredGitHubToken('  ghp_session_secret_123  ');
    assert(
      getStoredGitHubToken() === 'ghp_session_secret_123' &&
        mockSession.getItem(GITHUB_PAT_STORAGE_KEY) === 'ghp_session_secret_123' &&
        mockLocal.getItem(GITHUB_PAT_STORAGE_KEY) === null,
      '1.12 setStoredGitHubToken writes ONLY to sessionStorage and never to localStorage'
    );

    let sentAuthHeader = '';
    const ghProvider = new GitHubProvider(undefined, (async (_url: any, init: any) => {
      sentAuthHeader = init?.headers?.Authorization || '';
      return new Response(
        JSON.stringify({
          default_branch: 'main',
          description: 'repo',
          stargazers_count: 1,
          private: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any);
    await ghProvider.getMetadata('https://github.com/octocat/hello-world');
    assert(
      sentAuthHeader === 'Bearer ghp_session_secret_123',
      '1.13 GitHubProvider reads PAT from sessionStorage helper and sends Bearer Authorization header'
    );

    clearStoredGitHubToken();
    assert(
      getStoredGitHubToken() === undefined && mockSession.getItem(GITHUB_PAT_STORAGE_KEY) === null,
      '1.14 clearStoredGitHubToken removes PAT from sessionStorage'
    );

    // SSR / throwing storage safety check
    (globalThis as any).window = {
      get sessionStorage() {
        throw new Error('SecurityError');
      },
      get localStorage() {
        throw new Error('SecurityError');
      },
    };
    assert(
      getStoredGitHubToken() === undefined,
      '1.15 Storage helpers fail closed without throwing when sessionStorage/localStorage access throws'
    );
  } finally {
    if (origWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  // =========================================================================
  // STAGE 2: RUNTIME SECURITY AND CAPABILITY HARDENING
  // =========================================================================
  console.log('\n--- Stage 2: Runtime Security & Capability Hardening ---');

  // 2A. Capability anti-escalation
  assert(
    capabilityCovers('fs', 'fs.read') &&
      capabilityCovers('fs', 'fs.write') &&
      capabilityCovers('fs.read', 'fs.read') &&
      !capabilityCovers('fs.read', 'fs') &&
      !capabilityCovers('fs.read', 'fs.write') &&
      !capabilityCovers('net.get', 'net') &&
      !capabilityCovers('fs', 'fs_extra'),
    '2.1 capabilityCovers enforces exact + parent->child hierarchy only (blocks child->parent, sibling, prefix coincidence)'
  );

  const siblingEscMod = parseSemanticModule(
    `module fs_esc;\nrequires [fs.read];\nfn main() -> i64 {\n  let _ok: bool = fs.write_text("pwn.txt", "x");\n  return 0;\n}`,
    { profile: 'professional' }
  );
  const siblingAudit = analyzeCapabilitiesAndEffects(siblingEscMod);
  assert(
    !siblingAudit.valid && siblingAudit.diagnostics.some((d) => d.code === 'E_MISSING_CAPABILITY'),
    '2.2 Static capability analyzer rejects fs.write_text when only fs.read is declared'
  );

  const partialDenyMod = parseSemanticModule(
    `module partial_deny;\nrequires [fs.read];\ndenies [fs.write];\nfn main() -> i64 {\n  let _s: str = fs.read_text("ok.txt");\n  return 0;\n}`,
    { profile: 'professional' }
  );
  const partialDenyAudit = analyzeCapabilitiesAndEffects(partialDenyMod);
  assert(
    partialDenyAudit.valid,
    '2.3 Denying sibling child capability [fs.write] allows unrelated [fs.read] while blocking fs.write'
  );

  const fsWriteBuild = await compileManifestV1(
    `module vm_fs;\nrequires [fs.write];\nfn main() -> i64 effects(fs.write) {\n  let _ok: bool = fs.write_text("a.txt", "hello");\n  return 1;\n}`,
    { target: 'mvm' }
  );
  const tsVmRes = MvmInterpreter.execute(fsWriteBuild.mbcBytes!, {
    grantedCapabilities: ['fs.read'],
  });
  assert(
    !tsVmRes.ok && Boolean(tsVmRes.error?.includes('E_MVM_CAPABILITY_DENIED')),
    '2.4 MvmInterpreter blocks fs.write runtime call when only fs.read is granted'
  );

  const wasmChildBlocked = await executeMbcInRustVm(fsWriteBuild.mbcBytes!, {
    grantedCapabilities: ['fs.read'],
  });
  assert(
    !wasmChildBlocked.ok && Boolean(wasmChildBlocked.error?.toLowerCase().includes('capability')),
    '2.5 Rust WASM MVM blocks fs.write when host grants only fs.read'
  );

  // 2B & 2C. WASM FFI memory safety + MVMHOST2 symmetric protocol
  const fakeMem = { buffer: new ArrayBuffer(1024) };
  let threwOob = false;
  let threwOverflow = false;
  let threwNull = false;
  try {
    validateWasmMemoryRange(fakeMem, 900, 200, 1024);
  } catch {
    threwOob = true;
  }
  try {
    validateWasmMemoryRange(fakeMem, Number.MAX_SAFE_INTEGER, 100, 1024);
  } catch {
    threwOverflow = true;
  }
  try {
    validateWasmMemoryRange(fakeMem, 0, 8, 1024);
  } catch {
    threwNull = true;
  }
  assert(
    threwOob && threwOverflow && threwNull && readValidatedWasmBytes(fakeMem, 0, 0, 1024).length === 0,
    '2.6 validateWasmMemoryRange / readValidatedWasmBytes reject OOB, integer overflow, null+nonzero, and accept empty slices'
  );

  // Simulate memory.grow() during mvm_alloc
  const wasmMem = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  const oldBuf = wasmMem.buffer;
  const mockExports: any = {
    memory: wasmMem,
    mvm_alloc(len: number) {
      wasmMem.grow(1); // Invalidates old ArrayBuffer!
      return 65540; // Inside grown second page
    },
  };
  const payload = new TextEncoder().encode('hello-after-grow');
  const writeRes = writeValidatedWasmBytes(mockExports, payload, MAX_WASM_HOST_IO_BYTES);
  const readBack = new TextDecoder().decode(
    readValidatedWasmBytes(wasmMem, writeRes.ptr, payload.length, MAX_WASM_HOST_IO_BYTES)
  );
  assert(
    wasmMem.buffer !== oldBuf && readBack === 'hello-after-grow',
    '2.7 writeValidatedWasmBytes re-reads memory.buffer after mvm_alloc triggers WebAssembly.Memory.grow()'
  );

  // MVMHOST2 protocol round-trip with special characters & rejection of malformed frames
  const specialStrings = [
    'line1\nstr:injected\nline2',
    'pipe|colon:percent%quote"backslash\\slash/unicode✓🚀',
    '',
    'crlf\r\ntab\tcontrol\x01end',
  ];
  const encodedFrame = encodeWasmHostRequestV2(
    'console.print',
    'console',
    specialStrings.map((s) => ({ tag: 'str', value: s }))
  );
  const decodedFrame = decodeWasmHostRequest(encodedFrame);
  assert(
    decodedFrame.protocolVersion === 2 &&
      decodedFrame.symbol === 'console.print' &&
      decodedFrame.capability === 'console' &&
      decodedFrame.args.length === specialStrings.length &&
      specialStrings.every((s, idx) => decodedFrame.args[idx] === s),
    '2.8 MVMHOST2 protocol round-trips newlines, pipes, colons, percents, quotes, backslashes, Unicode, and empty strings cleanly'
  );

  let badEscapeRejected = false;
  try {
    decodeProtocolField('broken\\qescape');
  } catch {
    badEscapeRejected = true;
  }
  let truncatedEscapeRejected = false;
  try {
    decodeProtocolField('truncated\\');
  } catch {
    truncatedEscapeRejected = true;
  }
  let forgedInjectionRejected = false;
  try {
    encodeProtocolField('foo\nbar');
    // Directly injecting raw unescaped str: line in v2 without proper newline breaks stays parsed inside line structure only if encoded
    decodeWasmHostRequest('MVMHOST2\nconsole.print\nconsole\nunknown_tag:val');
  } catch {
    forgedInjectionRejected = true;
  }
  assert(
    badEscapeRejected &&
      truncatedEscapeRejected &&
      forgedInjectionRejected &&
      encodeWasmHostResponse(2, { ok: false, payload: 'a\nb', tag: 'err', value: 'err:bad\nline' }) ===
        'err:err\\cbad\\nline',
    '2.9 MVMHOST2 rejects malformed/truncated escapes and invalid argument tags cleanly'
  );

  // Live WASM MVM verify & execute smoke check
  const mvmGoodBuild = await compileManifestV1(
    `module mvm_live;\nrequires [console];\nfn main() -> i64 effects(console) { console.print("line1\\npipe|colon:"); return 42; }`,
    { target: 'mvm' }
  );
  const verifyLive = await verifyMbcInRustVm(mvmGoodBuild.mbcBytes!);
  const execLive = await executeMbcInRustVm(mvmGoodBuild.mbcBytes!, { grantedCapabilities: ['console'] });
  assert(
    verifyLive.ok && execLive.ok && execLive.returnValue === '42' && execLive.stdout[0] === 'line1\npipe|colon:',
    '2.10 Live Rust WASM MVM executes verified .mbc bytecode with multi-line console output cleanly'
  );

  // 2E. Solana RPC allowlist policy + live Express HTTP server test
  assert(
    validateSolanaRpcRequest({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [] }, 'mainnet').allowed &&
      !validateSolanaRpcRequest({ jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [] }, 'mainnet').allowed &&
      validateSolanaRpcRequest({ jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [] }, 'devnet').allowed &&
      !validateSolanaRpcRequest({ jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: [] }, 'devnet').allowed &&
      !validateSolanaRpcRequest({ jsonrpc: '2.0', id: 1, method: 'getbalance', params: [] }, 'devnet').allowed &&
      !validateSolanaRpcRequest({ jsonrpc: '2.0', id: 1, method: 'getBalance ', params: [] }, 'devnet').allowed &&
      !validateSolanaRpcRequest([{ jsonrpc: '2.0', id: 1, method: 'getBalance' }], 'devnet').allowed,
    '2.11 Solana RPC policy enforces exact method allowlist, Devnet-only airdrop, case-sensitivity, and single non-batch JSON-RPC 2.0 object'
  );

  // Spin up real Express HTTP server on ephemeral localhost port
  let upstreamFetchCalls = 0;
  const testApp = createManifestServerApp({
    fetchImpl: (async (_url: any, init: any) => {
      upstreamFetchCalls++;
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 123456 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any,
  });

  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Disallowed method must NOT call upstream fetch
    const disallowedRes = await fetch(`${baseUrl}/api/solana/rpc?network=devnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'getProgramAccounts', params: [] }),
    });
    const disallowedJson = (await disallowedRes.json()) as any;
    assert(
      disallowedRes.status === 403 &&
        upstreamFetchCalls === 0 &&
        Boolean(disallowedJson.error?.message?.includes('not permitted')),
      '2.12 Live HTTP /api/solana/rpc blocks disallowed method with HTTP 403 BEFORE invoking upstream fetch()'
    );

    const airdropMainnetRes = await fetch(`${baseUrl}/api/solana/rpc?network=mainnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'requestAirdrop', params: ['abc', 1000] }),
    });
    assert(
      airdropMainnetRes.status === 403 && upstreamFetchCalls === 0,
      '2.13 Live HTTP /api/solana/rpc blocks requestAirdrop on mainnet with HTTP 403 BEFORE fetch()'
    );

    const allowedRes = await fetch(`${baseUrl}/api/solana/rpc?network=devnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'getBalance', params: ['11111111111111111111111111111111'] }),
    });
    const allowedJson = (await allowedRes.json()) as any;
    assert(
      allowedRes.status === 200 && upstreamFetchCalls === 1 && allowedJson.result?.value === 123456,
      '2.14 Live HTTP /api/solana/rpc forwards allowed getBalance method and returns upstream result'
    );

    // Real /api/tests/run endpoint test!
    const apiTestsRes = await fetch(`${baseUrl}/api/tests/run`, { method: 'POST' });
    const apiTestsRaw = await apiTestsRes.text();
    const parsedApiTests = parseTestRunApiResponse(apiTestsRes.ok, apiTestsRes.status, apiTestsRaw);
    assert(
      apiTestsRes.status === 200 &&
        parsedApiTests.ok &&
        parsedApiTests.passed > 0 &&
        parsedApiTests.failed === 0 &&
        parsedApiTests.passed === parsedApiTests.total &&
        parsedApiTests.results.length > 0,
      `2.15 Live HTTP /api/tests/run returns real reconciled test counts (${parsedApiTests.passed}/${parsedApiTests.total} passed)`
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  // =========================================================================
  // STAGE 3: HONEST VERIFICATION, TEST INTEGRITY AND EXECUTION REPORTING
  // =========================================================================
  console.log('\n--- Stage 3: Honest Verification & Execution Reporting ---');

  // 3A. Canonical counts reconciliation
  const sampleCounts = computeAggregateCounts([
    { status: 'passed' },
    { status: 'failed' },
    { status: 'skipped' },
    { status: 'unsupported' },
    { status: 'not-run' },
  ]);
  assert(
    reconcileCountsValid(sampleCounts) && sampleCounts.total === 5,
    '3.1 computeAggregateCounts reconciles passed + failed + skipped + unsupported + notRun === total'
  );

  // 3B. Client /api/tests/run parser edge cases (zero fake 20/20 fallbacks!)
  const pOk = parseTestRunApiResponse(true, 200, {
    success: true,
    passed: 15,
    failed: 0,
    skipped: 2,
    total: 17,
    results: [{ name: 't1', passed: true }],
    logs: ['ok'],
  });
  const pNonZeroFail = parseTestRunApiResponse(true, 200, {
    success: false,
    passed: 18,
    failed: 2,
    total: 20,
  });
  const pSuccessTrueWithFail = parseTestRunApiResponse(true, 200, {
    success: true,
    passed: 19,
    failed: 1,
    total: 20,
  });
  const pHttp429 = parseTestRunApiResponse(false, 429, { error: 'Already running' });
  const pHttp500 = parseTestRunApiResponse(false, 500, { error: 'Internal crash' });
  const pMalformedJson = parseTestRunApiResponse(true, 200, '{bad-json');
  const pMissingFields = parseTestRunApiResponse(true, 200, { success: true, logs: ['PASS'] });
  const pMismatchSum = parseTestRunApiResponse(true, 200, {
    success: true,
    passed: 10,
    failed: 0,
    skipped: 1,
    total: 99,
  });
  const pThrownErr = await executeAndParseTestRun((async () => {
    throw new Error('ECONNREFUSED');
  }) as any);

  assert(
    pOk.ok &&
      pOk.status === 'passed' &&
      pOk.passed === 15 &&
      pOk.skipped === 2 &&
      !pNonZeroFail.ok &&
      pNonZeroFail.status === 'failed' &&
      pNonZeroFail.failed === 2 &&
      !pSuccessTrueWithFail.ok &&
      pSuccessTrueWithFail.status === 'failed' &&
      !pHttp429.ok &&
      pHttp429.status === 'error' &&
      pHttp429.passed === 0 &&
      !pHttp500.ok &&
      pHttp500.status === 'error' &&
      pHttp500.passed === 0 &&
      !pMalformedJson.ok &&
      pMalformedJson.status === 'error' &&
      !pMissingFields.ok &&
      pMissingFields.status === 'error' &&
      !pMismatchSum.ok &&
      pMismatchSum.status === 'error' &&
      !pThrownErr.ok &&
      pThrownErr.status === 'error' &&
      pThrownErr.passed === 0,
    '3.2 parseTestRunApiResponse & executeAndParseTestRun reject HTTP errors, malformed JSON, missing fields, mismatched sums, and network exceptions without fabricating passed counts'
  );

  // 3C. LiteSVMClient refuses silent simulation fallback when /api/solana/litesvm fails or returns 404
  const dummyProgram: SolanaProgramIR = {
    programName: 'VaultTest',
    programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
    accounts: [{ name: 'VaultState', fields: [{ name: 'balance', fieldType: 'u64' }] }],
    instructions: [
      {
        name: 'deposit',
        accounts: [{ name: 'vault', isMut: true, isSigner: false, accountType: 'VaultState' }],
        requires: ['amount > 0'],
        mutations: [{ target: 'vault.balance', expression: 'vault.balance + 1' }],
        cpis: [],
      },
    ],
  };

  const client404 = await LiteSVMClient.executeTests(dummyProgram, (async () => {
    return new Response('Not Found', { status: 404 });
  }) as any);
  const clientNetworkFail = await LiteSVMClient.executeTests(dummyProgram, (async () => {
    throw new Error('offline');
  }) as any);
  assert(
    !client404.success &&
      client404.execution === 'unavailable' &&
      client404.backend === 'unavailable' &&
      client404.passedCount === 0 &&
      !clientNetworkFail.success &&
      clientNetworkFail.execution === 'unavailable',
    '3.3 LiteSVMClient reports honest failure/unavailable when /api/solana/litesvm returns HTTP 404 or throws (never substitutes SolanaSimulator)'
  );

  // Build provider honesty check
  const origGlobalFetch = globalThis.fetch;
  try {
    (globalThis as any).fetch = async () => new Response('Not Found', { status: 404 });
    const lsvmProviderRes = await new SolanaLiteSVMBuildProvider().build(dummyProgram);
    const simProviderRes = await new SolanaLocalSimulatorProvider().build(dummyProgram);
    assert(
      !lsvmProviderRes.success &&
        Boolean(lsvmProviderRes.error?.includes('unavailable')) &&
        simProviderRes.logs.some((l) => l.includes('Simulated Codegen Only')),
      '3.4 SolanaLiteSVMBuildProvider fails honestly when server runner is unavailable; SolanaLocalSimulatorProvider explicitly labels simulation-only'
    );
  } finally {
    globalThis.fetch = origGlobalFetch;
  }

  // 3D. LiteSVMRunner separates real SystemProgram execution from uncompiled instruction static analysis
  const lsvmRunnerReport = await LiteSVMRunner.runTestSuite(dummyProgram);
  const depositStep = lsvmRunnerReport.steps.find((s) => s.instructionName === 'deposit');
  const sbfEnvStep = lsvmRunnerReport.steps.find((s) => s.instructionName === 'sbf_environment_check');
  assert(
    lsvmRunnerReport.passedCount === 3 &&
      lsvmRunnerReport.skippedCount === 2 &&
      lsvmRunnerReport.passedCount +
        lsvmRunnerReport.failedCount +
        lsvmRunnerReport.skippedCount +
        lsvmRunnerReport.unsupportedCount +
        lsvmRunnerReport.notRunCount ===
        lsvmRunnerReport.stepsCount &&
      depositStep?.status === 'skipped' &&
      depositStep.execution === 'analyzed-only' &&
      depositStep.success === false &&
      sbfEnvStep?.status === 'skipped',
    '3.5 LiteSVMRunner excludes uncompiled custom instruction analysis from passedCount and reconciles all counts'
  );

  // 3E. Solana counter suite explicit separation of real LiteSVM vs simulated JS vs skipped SBF
  const counterReport = await runSolanaCounterTest();
  assert(
    counterReport.passed &&
      counterReport.scenarios.some((s) => s.backend === 'litesvm' && s.execution === 'executed' && s.status === 'passed') &&
      counterReport.scenarios.some((s) => s.backend === 'js-counter-model' && s.execution === 'simulated') &&
      counterReport.scenarios.some((s) => s.id === 'scenario-d-custom-sbf-program' && s.status === 'skipped') &&
      reconcileCountsValid(counterReport.counts),
    '3.6 run_solana_counter_test separates real LiteSVM SOL transfer, JS counter simulation, and skipped uncompiled SBF binary'
  );

  // 3F. run_v1_upgrade_tests conformance helper reports skipped/not-run honestly when native mvm CLI & rustc are unavailable
  const conformanceWithoutNative = await runBackendConformanceCheck({
    mvmBinExists: false,
    hasCargo: false,
    hasRustc: false,
  });
  const missingCli = conformanceWithoutNative.find((e) => e.id === 'native-mvm-cli');
  const missingElf = conformanceWithoutNative.find((e) => e.id === 'native-rustc-elf');
  const confCounts = computeAggregateCounts(conformanceWithoutNative);
  assert(
    missingCli?.status === 'skipped' &&
      missingCli.execution === 'not-run' &&
      missingElf?.status === 'skipped' &&
      missingElf.compilation === 'generated-source-only' &&
      missingElf.execution === 'not-run' &&
      confCounts.passed === 4 &&
      confCounts.skipped === 2 &&
      reconcileCountsValid(confCounts),
    '3.7 Conformance verification marks unavailable native MVM CLI & rustc ELF honestly as skipped/not-run without fabricating return values'
  );

  console.log(`\n======================================================================`);
  console.log(`Batch 1 Regression Summary: ${passed} passed, ${failed} failed (total=${passed + failed})`);
  console.log(`======================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runBatch1Tests().catch((err) => {
  console.error('Fatal Batch 1 test error:', err);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';
import {
  ManifestExecutionProvider,
  sanitizeAssetPath,
} from '../../src/studio/execution/manifest-execution-provider.ts';
import { runManifestPipeline, decodeMbcFileContent } from '../../src/studio/compiler-service.ts';
import { TEMPLATES } from '../../src/studio/project-store.ts';
import { executeMbcInRustVm, StdLibraryRegistry } from '../src/index.ts';
import { ManifestProject } from '../../src/studio/types.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

async function main() {
  console.log('=== Manifest Ecosystem, Official Site & Asset Pipeline Tests ===');

  // 1. Brand files present in assets/brand/ and public/assets/brand/
  const requiredBrandFiles = [
    'manifest-symbol.svg',
    'manifest-wordmark.svg',
    'manifest-logo-dark.svg',
    'manifest-logo-light.svg',
    'manifest-icon.svg',
    'favicon.svg',
    'manifest-brand-reference.png',
  ];
  for (const file of requiredBrandFiles) {
    assert(fs.existsSync(path.resolve('assets/brand', file)), `Brand asset exists in assets/brand/${file}`);
    assert(fs.existsSync(path.resolve('public/assets/brand', file)), `Brand asset mirrored in public/assets/brand/${file}`);
  }

  // 2. Official landing page & template parity + real build
  const repoLanding = fs.readFileSync(path.resolve('examples/web/manifest_official_landing.manifest'), 'utf8');
  const templateLanding = TEMPLATES.find((t) => t.id === 'landing');
  assert(Boolean(templateLanding), 'landing template exists in TEMPLATES');
  const templateSource = templateLanding!.files.find((f) => f.path === 'src/main.manifest')?.content || '';
  assert(repoLanding.trim() === templateSource.trim(), 'Studio landing template matches examples/web/manifest_official_landing.manifest');

  const provider = new ManifestExecutionProvider();
  const samplePngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  const landingProj: ManifestProject = {
    id: 'test-landing-proj',
    name: 'landing-test',
    kind: 'manifest',
    compilerTarget: 'web-js',
    entryPath: 'src/main.manifest',
    activeFilePath: 'src/main.manifest',
    files: [
      {
        id: 'main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: repoLanding,
      },
      {
        id: 'asset-png',
        name: 'banner.png',
        path: 'assets/images/banner.png',
        language: 'binary',
        isBinary: true,
        mimeType: 'image/png',
        content: samplePngDataUrl,
      },
      {
        id: 'asset-svg',
        name: 'badge.svg',
        path: 'assets/icons/badge.svg',
        language: 'html',
        isBinary: false,
        mimeType: 'image/svg+xml',
        content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#569cd6"/></svg>',
      },
    ],
  };

  const execRes = await provider.execute(landingProj);
  assert(execRes.success === true, 'Official landing page executes cleanly via ManifestExecutionProvider');
  assert(execRes.targetId === 'web-js', 'Landing page resolves targetId web-js');
  assert(Boolean(execRes.previewHtml?.includes('__manifestResolveAsset')), 'Preview HTML injects __manifestResolveAsset shim');
  assert(Boolean(execRes.previewHtml?.includes('assets/images/banner.png')), 'Preview HTML injects workspace binary asset data map');
  assert(Boolean(execRes.previewHtml?.includes(samplePngDataUrl)), 'Preview HTML preserves exact binary PNG data URL');
  assert(Boolean(execRes.previewHtml?.includes('Docs') || execRes.outputCode?.includes('Docs')), 'Landing compiled output includes Docs route label');

  const buildRes = await provider.build(landingProj);
  assert(buildRes.success === true, 'Landing page Web build succeeds');
  const bundledPng = buildRes.artifacts?.find((a) => a.fileName === 'build/assets/images/banner.png');
  const bundledSvg = buildRes.artifacts?.find((a) => a.fileName === 'build/assets/icons/badge.svg');
  const assetManifestArt = buildRes.artifacts?.find((a) => a.fileName === 'build/asset-manifest.json');
  assert(Boolean(bundledPng && bundledPng.content === samplePngDataUrl && bundledPng.isBinary), 'Build copies binary PNG to build/assets/images/banner.png');
  assert(Boolean(bundledSvg && bundledSvg.content.includes('<svg')), 'Build copies SVG text to build/assets/icons/badge.svg');
  assert(Boolean(assetManifestArt), 'Build emits build/asset-manifest.json');
  if (assetManifestArt) {
    const parsedManifest = JSON.parse(assetManifestArt.content);
    assert(parsedManifest.assets['assets/images/banner.png']?.outputPath === 'build/assets/images/banner.png', 'asset-manifest.json records binary PNG mapping');
  }

  // 3. Path traversal & missing asset diagnostic warnings
  assert(sanitizeAssetPath('assets/logo.png').normalized === 'assets/logo.png', 'Normalizes clean relative asset path');
  assert(sanitizeAssetPath('./assets/logo.png').normalized === 'assets/logo.png', 'Strips ./ from asset path');
  assert(sanitizeAssetPath('../secret.png').valid === false, 'Rejects parent traversal .. in asset path');
  assert(sanitizeAssetPath('/etc/passwd').valid === false, 'Rejects absolute POSIX asset path');
  assert(sanitizeAssetPath('assets/foo\0bar.png').valid === false, 'Rejects null byte in asset path');

  const diagSource = `module diag_test;\nrequires console;\nfn main() -> i64 {\n  let logo_missing: str = "assets/missing_logo.png";\n  let logo_traversal: str = "../outside/evil.png";\n  let logo_brand: str = "assets/brand/manifest-logo-dark.svg";\n  return 0;\n}`;
  const assetDiags = provider.auditAssetReferences(diagSource, landingProj);
  assert(assetDiags.some((d) => d.code === 'W_ASSET_MISSING' && d.message.includes('assets/missing_logo.png')), 'Emits non-fatal W_ASSET_MISSING warning for missing workspace asset');
  assert(assetDiags.some((d) => d.code === 'W_ASSET_UNSAFE_PATH'), 'Emits W_ASSET_UNSAFE_PATH warning for traversal asset reference');
  assert(!assetDiags.some((d) => d.message.includes('manifest-logo-dark.svg')), 'Recognizes built-in brand SVG without false missing warning');

  // 4. Real Interactive Playground snippets compile & execute end-to-end
  const helloRes = await runManifestPipeline(
    `module hello;\nrequires console;\n\nfn main() -> i64 effects(console) {\n    console.print("Welcome to Manifest v1.0!");\n    return 0;\n}`,
    'mvm'
  );
  assert(helloRes.success && Boolean(helloRes.mbcBytes), 'Playground Hello snippet compiles to .mbc');
  const helloVm = await executeMbcInRustVm(helloRes.mbcBytes!, { entryFunction: 'main', grantedCapabilities: ['console'] });
  assert(helloVm.ok && helloVm.stdout.includes('Welcome to Manifest v1.0!') && helloVm.returnValue === '0', 'Hello snippet runs on Rust MVM');

  const wasmRes = await runManifestPipeline(
    `module fib_wasm;\nrequires console;\nexport fn fib(n: i64) -> i64 {\n  if n <= 1 { return n; }\n  let mut a: i64 = 0;\n  let mut b: i64 = 1;\n  let mut i: i64 = 2;\n  while i <= n {\n    let next: i64 = a + b;\n    a = b;\n    b = next;\n    i = i + 1;\n  }\n  return b;\n}\nexport fn main() -> i64 effects(console) { return fib(10); }`,
    'wasm'
  );
  assert(wasmRes.success, 'Playground WASM Fibonacci snippet compiles');
  const wasmArt = wasmRes.artifacts.find((a) => a.fileName.endsWith('.wasm'));
  assert(Boolean(wasmArt), 'WASM compilation produces binary .wasm artifact');
  const wasmBytes = decodeMbcFileContent(wasmArt!.content)!;
  const wasmInst = await WebAssembly.instantiate(wasmBytes.slice().buffer, {
    env: { print_i32: () => {}, print_i64: () => {}, print_f64: () => {} },
  });
  const fibOut = (wasmInst.instance.exports as any).main();
  assert(String(fibOut) === '55', `WASM Fibonacci main() executes in VM and returns 55 (got ${fibOut})`);

  // 5. Stdlib Registry check
  const stdMods = StdLibraryRegistry.getInstance().listModules();
  assert(stdMods.length >= 10, `StdLibraryRegistry provides ${stdMods.length} modules cleanly`);

  console.log('ALL ECOSYSTEM, ASSET & LANDING TESTS PASSED!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

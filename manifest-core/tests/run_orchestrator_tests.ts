/**
 * Manifest Studio - Execution Orchestrator & Static Web Provider Test Suite
 * Validates Sections 7, 8, 9, 13:
 * - Shared ExecutionProvider interface and ExecutionOrchestrator registry
 * - Multi-file Static Web execution (HTML/CSS/JS inlining, relative path resolution)
 * - Manifest language execution provider integration
 * - Stale asynchronous run prevention (cancellation / race-condition handling)
 * - Offline readiness verification
 * - Error reporting and diagnostic handling
 */

import { ExecutionOrchestrator } from '../../src/studio/execution/execution-orchestrator.ts';
import { ManifestExecutionProvider } from '../../src/studio/execution/manifest-execution-provider.ts';
import { StaticWebExecutionProvider } from '../../src/studio/execution/static-web-execution-provider.ts';
import { ManifestProject } from '../../src/studio/types.ts';

export async function runOrchestratorTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✓ ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
      failed++;
    }
  }

  console.log('\n--- Running Execution Orchestrator & Multi-Language Provider Tests ---');

  const orchestrator = ExecutionOrchestrator.getInstance();

  // Test 1: Registry initialization and provider listing
  const providers = orchestrator.listProviders();
  assert(providers.length >= 2, '1. Orchestrator registers core execution providers (found ' + providers.length + ')');
  assert(providers.some((p) => p.id === 'manifest-provider'), '1. Manifest execution provider is registered');
  assert(providers.some((p) => p.id === 'static-web-provider'), '1. Static Web execution provider is registered');

  // Test 2: Project kind detection
  const manifestProj: ManifestProject = {
    id: 'test-manifest',
    name: 'Test Manifest',
    kind: 'manifest',
    files: [
      {
        id: 'f1',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: 'APP "Test"\nPAGE Home\nTEXT "Hello"\nEND',
      },
    ],
  };

  const webProj: ManifestProject = {
    id: 'test-web',
    name: 'Test Web App',
    kind: 'web',
    files: [
      {
        id: 'w1',
        name: 'index.html',
        path: 'index.html',
        language: 'html',
        content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Web Title</h1><script src="script.js"></script></body></html>',
      },
      {
        id: 'w2',
        name: 'styles.css',
        path: 'styles.css',
        language: 'css',
        content: 'body { background: #0f172a; color: #f8fafc; }',
      },
      {
        id: 'w3',
        name: 'script.js',
        path: 'script.js',
        language: 'javascript',
        content: 'console.log("Web project executed!");',
      },
    ],
  };

  assert(orchestrator.detectProjectKind(manifestProj) === 'manifest', '2. Detects Manifest project as "manifest"');
  assert(orchestrator.detectProjectKind(webProj) === 'web', '2. Detects HTML/CSS/JS project as "web"');

  // Test 3: Provider selection
  const selectedManifestProvider = orchestrator.selectProvider(manifestProj);
  assert(selectedManifestProvider.id === 'manifest-provider', '3. Selects ManifestExecutionProvider for Manifest project');

  const selectedWebProvider = orchestrator.selectProvider(webProj);
  assert(selectedWebProvider.id === 'static-web-provider', '3. Selects StaticWebExecutionProvider for Web project');

  // Test 4: Manifest Execution Provider
  const manifestExecResult = await selectedManifestProvider.execute(manifestProj);
  assert(manifestExecResult.success === true, '4. Manifest provider executes valid Manifest code');
  assert(manifestExecResult.previewKind === 'manifest-canvas', '4. Manifest provider specifies "manifest-canvas" preview');
  assert(manifestExecResult.previewHtml?.includes('id="manifest-root"'), '4. Manifest preview HTML includes mount root');
  assert(manifestExecResult.previewHtml?.includes('startApp'), '4. Manifest preview HTML includes runtime startApp invoker');

  // Test 5: Static Web Execution Provider (Multi-file bundling)
  const webProvider = new StaticWebExecutionProvider();
  const webExecResult = await webProvider.execute(webProj);

  assert(webExecResult.success === true, '5. Web provider executes static web project successfully');
  assert(webExecResult.previewKind === 'web-document', '5. Web provider specifies "web-document" preview');
  assert(webExecResult.previewHtml !== undefined, '5. Web provider generates bundled HTML');

  // Verify CSS inlining
  assert(webExecResult.previewHtml!.includes('<style>'), '5. Web provider inlines local stylesheet into <style>');
  assert(webExecResult.previewHtml!.includes('background: #0f172a'), '5. Inlined CSS preserves stylesheet rules');

  // Verify JS inlining
  assert(webExecResult.previewHtml!.includes('<script>'), '5. Web provider inlines local script into <script>');
  assert(webExecResult.previewHtml!.includes('console.log("Web project executed!")'), '5. Inlined script preserves JS code');

  // Verify Console & Error Forwarding bridge injection
  assert(webExecResult.previewHtml!.includes('preview-console'), '5. Injects preview-console postMessage bridge');
  assert(webExecResult.previewHtml!.includes('window.onerror'), '5. Injects window.onerror uncaught exception handler');

  // Test 6: Stale asynchronous run prevention (Race condition guard)
  let run1Promise = orchestrator.executeProject(manifestProj);
  let run2Promise = orchestrator.executeProject(manifestProj);

  const [res1, res2] = await Promise.all([run1Promise, run2Promise]);
  // The first run should either have been superseded or the second run is the authoritative active run
  assert(res2.runId === orchestrator.getActiveRunId(), '6. Latest asynchronous run matches orchestrator activeRunId');
  assert(res1.runId !== res2.runId, '6. Each run receives a distinct unique runId');

  // Test 7: Error handling in Web provider when root HTML is missing
  const brokenWebProj: ManifestProject = {
    id: 'broken-web',
    name: 'Broken Web',
    kind: 'web',
    files: [
      {
        id: 'b1',
        name: 'styles.css',
        path: 'styles.css',
        language: 'css',
        content: 'body { color: red; }',
      },
    ],
  };

  const brokenResult = await webProvider.execute(brokenWebProj);
  assert(brokenResult.success === false, '7. Web provider reports error when index.html is missing');
  assert(brokenResult.previewKind === 'diagnostic-error', '7. Broken execution produces "diagnostic-error" preview');
  assert(brokenResult.diagnostics.length > 0, '7. Broken execution provides diagnostic message');

  // Test 8: Offline readiness
  assert(selectedManifestProvider.isOfflineReady() === true, '8. Manifest provider honestly declares offlineReady: true');
  assert(selectedWebProvider.isOfflineReady() === true, '8. Static Web provider honestly declares offlineReady: true');
  assert(selectedManifestProvider.getCapabilities().offlineReady === true, '8. Manifest capability offlineReady is true');
  assert(selectedWebProvider.getCapabilities().offlineReady === true, '8. Web capability offlineReady is true');

  const total = passed + failed;
  console.log(`Execution Orchestrator tests completed: ${passed}/${total} passed.\n`);
  return { passed, failed, total };
}

// When run directly from CLI
const isNodeCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_orchestrator_tests.ts'));

if (isNodeCLI) {
  runOrchestratorTests()
    .then((summary) => {
      if (summary.failed > 0 && typeof process.exit === 'function') {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal orchestrator test error:', err);
      if (typeof process.exit === 'function') {
        process.exit(1);
      }
    });
}

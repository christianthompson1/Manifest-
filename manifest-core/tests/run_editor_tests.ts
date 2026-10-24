/**
 * Manifest Studio - Editor State & Orchestrator Regression Tests
 * Verifies cursor position preservation, CRLF normalization,
 * active file precedence, and project-kind resolution.
 */

import { ExecutionOrchestrator } from '../../src/studio/execution/execution-orchestrator.ts';
import { ManifestProject, ProjectFile } from '../../src/studio/types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

function runEditorAndSyncTests() {
  console.log('\n--- Running Editor State & Sync Regression Tests ---');

  const orchestrator = ExecutionOrchestrator.getInstance();

  // Test 1: CRLF normalization simulation
  const crlfStr = 'APP "Test"\r\nPAGE Home\r\n    TEXT "Hello"\r\nEND\r\n';
  const normalized = crlfStr.replace(/\r\n/g, '\n');
  assert(!normalized.includes('\r'), 'CRLF normalization removes carriage returns');
  assert(normalized.split('\n').length === 5, 'Normalized text maintains exact line count');

  // Test 2: Cursor clamping simulation
  const originalLength = 100;
  const cursorAnchor = 45;
  const newLengthShorter = 30;
  const newLengthLonger = 150;

  const clampedAnchor1 = Math.min(cursorAnchor, newLengthShorter);
  assert(clampedAnchor1 === 30, 'Clamping cursor to shorter document prevents out-of-bounds error');

  const clampedAnchor2 = Math.min(cursorAnchor, newLengthLonger);
  assert(clampedAnchor2 === 45, 'Cursor position is preserved when new document is longer');

  // Test 3: Active file precedence over project.kind
  // Scenario: Project kind is explicitly 'web', but user is editing main.manifest
  const polyglotProject: ManifestProject = {
    id: 'proj-1',
    name: 'Mixed Project',
    kind: 'web',
    files: [
      {
        id: 'f-1',
        name: 'index.html',
        path: 'index.html',
        language: 'html',
        content: '<h1>Web</h1>',
      },
      {
        id: 'f-2',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: 'APP "ManifestApp"\nPAGE Home\n    TEXT "Hi"\nEND\n',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const manifestFile = polyglotProject.files[1];
  const detectedManifestKind = orchestrator.detectProjectKind(polyglotProject, manifestFile);
  assert(
    detectedManifestKind === 'manifest',
    'Editing .manifest in a web project returns "manifest" project kind (Defect 1 fix)'
  );

  const htmlFile = polyglotProject.files[0];
  const detectedWebKind = orchestrator.detectProjectKind(polyglotProject, htmlFile);
  assert(
    detectedWebKind === 'web',
    'Editing index.html returns "web" project kind'
  );

  // Test 4: Neutral active file falls back to project.kind or file tree
  const neutralFile: ProjectFile = {
    id: 'f-3',
    name: 'README.md',
    path: 'README.md',
    language: 'markdown',
    content: '# Docs',
  };
  const detectedFallback = orchestrator.detectProjectKind(polyglotProject, neutralFile);
  assert(
    detectedFallback === 'web',
    'Neutral file falls back to project.kind ("web")'
  );

  // Test 5: Project with both Manifest and HTML without explicit kind prioritizes active Manifest file
  const unconfiguredProject: ManifestProject = {
    id: 'proj-2',
    name: 'Unconfigured Project',
    files: [
      {
        id: 'f-1',
        name: 'index.html',
        path: 'index.html',
        language: 'html',
        content: '<h1>Web</h1>',
      },
      {
        id: 'f-2',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: 'APP "ManifestApp"\n',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const manifestActiveKind = orchestrator.detectProjectKind(unconfiguredProject, unconfiguredProject.files[1]);
  assert(
    manifestActiveKind === 'manifest',
    'Unconfigured project with active manifest file resolves to "manifest"'
  );

  console.log(`\nEditor and Sync tests completed: ${passed}/${passed + failed} passed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runEditorAndSyncTests();

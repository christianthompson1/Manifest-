/**
 * Manifest Studio - Project Type Detector
 * Automatically recognizes project kinds based on root/source files:
 * - Manifest
 * - Node.js / TypeScript / React
 * - Rust / Cargo
 * - Python
 * - Web (HTML/CSS)
 * - Mixed / Multi-language
 */

import { ProjectFile, ProjectKind } from '../types.ts';

export function detectProjectType(files: ProjectFile[]): ProjectKind {
  const paths = files.map((f) => f.path.toLowerCase());

  const hasManifest = paths.some((p) => p.endsWith('.manifest') || p === 'manifest.toml');
  const hasNode = paths.some((p) => p === 'package.json' || p.endsWith('.jsx') || p.endsWith('.tsx'));
  const hasRust = paths.some((p) => p === 'cargo.toml' || p.endsWith('.rs'));
  const hasPython = paths.some((p) => p === 'requirements.txt' || p === 'pyproject.toml' || p.endsWith('.py'));
  const hasWeb = paths.some((p) => p === 'index.html' || p.endsWith('.html'));
  const hasWasm = paths.some((p) => p.endsWith('.wasm'));

  if (hasManifest && (hasNode || hasRust || hasPython)) {
    return 'mixed';
  }
  if (hasManifest) return 'manifest';
  if (hasNode) return 'node';
  if (hasRust) return 'rust';
  if (hasPython) return 'python';
  if (hasWeb) return 'web';
  if (hasWasm) return 'wasm';

  return 'mixed';
}

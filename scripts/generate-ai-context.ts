/**
 * Manifest Studio - Lightweight AI Context Generator
 * Scans repository sources, packages, tests, and metadata to generate
 * an accurate, grounded AI context summary.
 *
 * Run with: npx tsx scripts/generate-ai-context.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface ComponentSummary {
  name: string;
  filesCount: number;
  entryPoints: string[];
}

function scanDir(dir: string, ext = '.ts'): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(scanDir(fullPath, ext));
    } else if (fullPath.endsWith(ext) || fullPath.endsWith(ext + 'x')) {
      results.push(fullPath);
    }
  }
  return results;
}

export function generateContext(): string {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const manifestCoreFiles = scanDir('manifest-core/src');
  const studioFiles = scanDir('src/studio');
  const testFiles = scanDir('manifest-core/tests');

  const lines: string[] = [];
  lines.push('# Manifest Studio — Auto-Generated Repository Context Summary');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Package & Dependency Baseline');
  lines.push(`- Application: ${pkg.name} (v${pkg.version || '0.4.0'})`);
  lines.push(`- Dependencies: ${Object.keys(pkg.dependencies || {}).length} packages`);
  lines.push(`- Dev Dependencies: ${Object.keys(pkg.devDependencies || {}).length} packages`);
  lines.push('');
  lines.push('## Component Distribution');
  lines.push(`- Manifest Core: ${manifestCoreFiles.length} source files`);
  lines.push(`- Studio UI & Services: ${studioFiles.length} source files`);
  lines.push(`- Automated Test Suites: ${testFiles.length} test runners`);
  lines.push('');
  lines.push('## Key Architecture Subsystems');
  lines.push('- Manifest Parser & Validator: `manifest-core/src/parser/parser.ts`, `manifest-core/src/validator/validator.ts`');
  lines.push('- Manifest IR & JS Compiler: `manifest-core/src/ir/ir-builder.ts`, `manifest-core/src/compiler/targets/js-target.ts`');
  lines.push('- Execution Orchestrator: `src/studio/execution/execution-orchestrator.ts`');
  lines.push('- Static Web Provider: `src/studio/execution/static-web-execution-provider.ts`');
  lines.push('- Sandboxed Preview: `src/studio/preview/PreviewPanel.tsx`');
  lines.push('');
  lines.push('## Verification Commands');
  lines.push('- TypeScript typecheck: `npm run lint`');
  lines.push('- Manifest language & provider tests: `npm run manifest:test`');
  lines.push('- Production bundle: `npm run build`');

  return lines.join('\n');
}

if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('generate-ai-context.ts')) {
  const summary = generateContext();
  const outPath = path.join('docs', 'AI_CONTEXT_SUMMARY.md');
  fs.writeFileSync(outPath, summary, 'utf-8');
  console.log(`✓ AI context refreshed and written to ${outPath}`);
}

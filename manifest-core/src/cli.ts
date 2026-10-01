/**
 * Manifest Core v0.1 - Command Line Interface (CLI)
 *
 * Supported Commands:
 *   manifest <file.manifest>                   (Runs file directly with interpreter)
 *   manifest run <file.manifest>               (Runs file directly with interpreter)
 *   manifest check <file.manifest>             (Parses and validates without execution)
 *   manifest ir <file.manifest>                (Generates and prints target-agnostic Manifest IR)
 *   manifest build <file.manifest> [target]    (Compiles to target, defaults to 'js')
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  executeManifest,
  inspectManifest,
  generateManifestIR,
  compileManifest,
  Compiler,
} from './index.ts';
import { ManifestError } from './errors/manifest-error.ts';

function printHelp() {
  console.log('Manifest Core v0.1 - Compiler & Runtime CLI\n');
  console.log('Commands:');
  console.log('  run <file.manifest>               Execute a Manifest program in the interpreter');
  console.log('  check <file.manifest>             Verify syntax and semantic rules without running');
  console.log('  ir <file.manifest>                Generate and display intermediate representation');
  console.log('  build <file.manifest> [target]    Compile to target code (default target: "js")');
  console.log('  targets                           List available compilation targets');
  console.log('  help                              Display this help message');
  console.log('\nQuick Run:');
  console.log('  tsx manifest-core/src/cli.ts <file.manifest>');
  console.log('\nExamples:');
  console.log('  tsx manifest-core/src/cli.ts manifest-core/examples/hello.manifest');
  console.log('  tsx manifest-core/src/cli.ts check manifest-core/examples/hello.manifest');
  console.log('  tsx manifest-core/src/cli.ts ir manifest-core/examples/hello.manifest');
  console.log('  tsx manifest-core/src/cli.ts build manifest-core/examples/hello.manifest js');
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs[0] === 'help' || rawArgs[0] === '--help') {
    printHelp();
    process.exit(0);
  }

  // List targets command
  if (rawArgs[0] === 'targets') {
    const compiler = new Compiler();
    console.log('Supported Targets:');
    for (const t of compiler.getSupportedTargets()) {
      console.log(`  - ${t}`);
    }
    process.exit(0);
  }

  // Parse command vs direct file argument
  let command = 'run';
  let targetFile = '';
  let extraArg = '';

  const knownCommands = ['run', 'check', 'ir', 'build'];
  if (knownCommands.includes(rawArgs[0])) {
    command = rawArgs[0];
    targetFile = rawArgs[1] || '';
    extraArg = rawArgs[2] || '';
  } else {
    // Direct invocation: tsx cli.ts <file.manifest>
    targetFile = rawArgs[0];
    command = 'run';
  }

  if (!targetFile) {
    console.error(`Error: Missing file path for command '${command}'.`);
    console.error('Usage: tsx manifest-core/src/cli.ts ' + command + ' <path-to-file.manifest>');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), targetFile);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, 'utf-8');

  try {
    switch (command) {
      case 'run': {
        await executeManifest(source, {
          onOutput: (msg) => console.log(msg),
        });
        break;
      }

      case 'check': {
        console.log(`Checking '${path.basename(filePath)}'...`);
        const { validation } = inspectManifest(source);
        if (validation.isValid) {
          console.log('✓ Syntax and semantic validation passed cleanly! No issues found.');
        } else {
          console.error(`✗ Found ${validation.issues.length} issue(s):`);
          for (const issue of validation.issues) {
            console.error(`  - [Line ${issue.line}] ${issue.severity.toUpperCase()}: ${issue.message}`);
            if (issue.hint) {
              console.error(`    Hint: ${issue.hint}`);
            }
          }
          process.exit(1);
        }
        break;
      }

      case 'ir': {
        console.log(`Generating Manifest IR for '${path.basename(filePath)}'...\n`);
        const ir = generateManifestIR(source);
        console.log(JSON.stringify(ir, null, 2));
        break;
      }

      case 'build': {
        const target = extraArg || 'js';
        console.log(`Building '${path.basename(filePath)}' for target '${target}'...`);
        const result = await compileManifest(source, target);

        if (!result.success) {
          console.error(`\n✗ Compilation to target '${target}' failed:`);
          for (const diag of result.diagnostics) {
            console.error(`  - ${diag.message}`);
            if (diag.hint) {
              console.error(`    Hint: ${diag.hint}`);
            }
          }
          process.exit(1);
        }

        console.log(`✓ Compilation successful! (${result.artifacts.length} artifact(s) generated)\n`);
        for (const art of result.artifacts) {
          console.log(`--- [Artifact: ${art.fileName}] ---`);
          console.log(art.content);
        }
        break;
      }
    }
  } catch (err: unknown) {
    if (err instanceof ManifestError) {
      console.error('\n' + err.toFormattedString() + '\n');
    } else {
      console.error('\nInternal Error:', err);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal CLI execution error:', e);
  process.exit(1);
});

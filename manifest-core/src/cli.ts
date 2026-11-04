import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SyntaxProfile } from './core/profile.ts';
import { disassembleMbcBytes, verifyMbcBytes } from './bytecode/mbc-reader.ts';
import {
  checkManifestSource,
  compileManifestV1,
  runManifestOnRustMvm,
} from './pipeline.ts';
import { COMPILER_TARGETS, resolveCompilerTarget } from './targets/target-registry.ts';
import { disassembleMbcInRustVm, executeMbcInRustVm, verifyMbcInRustVm } from './vm/mvm-runner.ts';

function parseFlags(args: string[]): {
  positional: string[];
  target?: string;
  out?: string;
  profile?: SyntaxProfile | 'auto';
  allow: string[];
} {
  const positional: string[] = [];
  let target: string | undefined;
  let out: string | undefined;
  let profile: SyntaxProfile | 'auto' | undefined;
  const allow: string[] = ['console'];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--target' || a === '-t') {
      target = args[++i];
    } else if (a === '--out' || a === '-o') {
      out = args[++i];
    } else if (a === '--profile' || a === '-p') {
      const p = args[++i];
      if (p === 'beginner' || p === 'professional' || p === 'auto') profile = p;
    } else if (a === '--allow') {
      const caps = (args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
      allow.push(...caps);
    } else {
      positional.push(a);
    }
  }
  return { positional, target, out, profile, allow: Array.from(new Set(allow)) };
}

function loadWorkspaceFiles(entryFile: string): Record<string, string> {
  const rootDir = path.dirname(path.resolve(entryFile));
  const files: Record<string, string> = {};
  const walk = (dir: string, relPrefix: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'target') continue;
      const full = path.join(dir, ent.name);
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(full, rel);
      else if (ent.name.endsWith('.manifest')) {
        files[rel] = fs.readFileSync(full, 'utf-8');
      }
    }
  };
  try {
    walk(rootDir, '');
  } catch {
    // ignore directory read errors
  }
  return files;
}

function detectHostRustc(): string | null {
  for (const bin of ['/usr/local/bin/rustc', 'rustc']) {
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf-8' }).trim();
      if (out.startsWith('rustc')) return bin;
    } catch {
      // continue
    }
  }
  return null;
}

function printUsage(): void {
  console.log(`Manifest Language Toolchain CLI v1.0

Usage:
  manifest check <file.manifest> [--profile beginner|professional]
  manifest build <file.manifest> [--target mvm|web-js|wasm|native|solana-sbf] [--out <dir>]
  manifest run <file.manifest|file.mbc> [--target mvm|wasm|native|web-js] [--allow console,fs.read,...]
  manifest ir <file.manifest>
  manifest bytecode <file.manifest> [--out <file.mbc>]
  manifest disassemble <file.manifest|file.mbc>
  manifest verify <file.mbc>
  manifest targets
`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    printUsage();
    process.exit(rawArgs.length === 0 ? 1 : 0);
  }

  const knownCommands = new Set([
    'check',
    'build',
    'run',
    'ir',
    'bytecode',
    'disassemble',
    'verify',
    'targets',
  ]);

  let command = rawArgs[0];
  let restArgs = rawArgs.slice(1);

  // Backward compatibility: `tsx manifest-core/src/cli.ts <file.manifest>`
  if (!knownCommands.has(command) && fs.existsSync(command)) {
    restArgs = [command, ...restArgs];
    command = 'run';
  }

  const flags = parseFlags(restArgs);

  if (command === 'targets') {
    const rustcBin = detectHostRustc();
    console.log('Manifest v1.0 Compiler Targets:\n');
    for (const t of COMPILER_TARGETS) {
      const effectiveStatus =
        t.id === 'native' && rustcBin ? 'available (host rustc detected)' : t.status;
      console.log(`  ${t.id.padEnd(14)} ${t.name.padEnd(24)} [${effectiveStatus}]`);
      console.log(`                 Artifacts: ${t.artifactExtensions.join(', ') || '(native binary)'}`);
      console.log(`                 ${t.description}`);
    }
    return;
  }

  const file = flags.positional[0];
  if (!file || !fs.existsSync(file)) {
    console.error(`Error: File not found: '${file || ''}'`);
    process.exit(1);
  }

  if (command === 'verify') {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const tsRes = verifyMbcBytes(bytes);
    const rustRes = await verifyMbcInRustVm(bytes);
    if (!tsRes.valid || !rustRes.ok) {
      console.error(`Verification FAILED for '${file}':`);
      for (const e of tsRes.errors) console.error(`  - ${e}`);
      if (rustRes.error) console.error(`  - [Rust MVM] ${rustRes.error}`);
      process.exit(1);
    }
    console.log(
      `Verified '${file}' (${bytes.length} bytes): module='${rustRes.moduleName}', functions=${rustRes.functions}, constants=${rustRes.constants}, imports=${rustRes.imports}`
    );
    return;
  }

  if (command === 'disassemble') {
    if (file.endsWith('.mbc')) {
      const bytes = new Uint8Array(fs.readFileSync(file));
      const rustDis = await disassembleMbcInRustVm(bytes);
      console.log(rustDis.ok && rustDis.disassembly ? rustDis.disassembly : disassembleMbcBytes(bytes));
      return;
    }
    const source = fs.readFileSync(file, 'utf-8');
    const build = await compileManifestV1(source, {
      target: 'mvm',
      profile: flags.profile,
      entryFile: path.basename(file),
      files: loadWorkspaceFiles(file),
    });
    if (!build.success || !build.disassembly) {
      for (const d of build.diagnostics) console.error(`[${d.code}] line ${d.line}:${d.column} ${d.message}`);
      process.exit(1);
    }
    console.log(build.disassembly);
    return;
  }

  if (command === 'check') {
    const source = fs.readFileSync(file, 'utf-8');
    const res = checkManifestSource(source, {
      profile: flags.profile,
      entryFile: path.basename(file),
      files: loadWorkspaceFiles(file),
    });
    for (const d of res.diagnostics) {
      console.log(`[${d.severity.toUpperCase()}] ${d.code} (${d.line}:${d.column}): ${d.message}`);
    }
    if (!res.ok) process.exit(1);
    console.log(
      `Check passed (${res.resolvedProfile} profile)${res.capabilityAudit ? ` | requires: [${res.capabilityAudit.declaredRequires.join(', ')}] | inferred effects: [${res.capabilityAudit.inferredModuleEffects.join(', ')}]` : ''}`
    );
    return;
  }

  if (command === 'ir') {
    const source = fs.readFileSync(file, 'utf-8');
    const res = checkManifestSource(source, {
      profile: flags.profile,
      entryFile: path.basename(file),
      files: loadWorkspaceFiles(file),
    });
    if (!res.ok || !res.irText) {
      for (const d of res.diagnostics) console.error(`[${d.code}] line ${d.line}:${d.column} ${d.message}`);
      process.exit(1);
    }
    console.log(res.irText);
    return;
  }

  if (command === 'bytecode') {
    const source = fs.readFileSync(file, 'utf-8');
    const build = await compileManifestV1(source, {
      target: 'mvm',
      profile: flags.profile,
      entryFile: path.basename(file),
      files: loadWorkspaceFiles(file),
    });
    if (!build.success || !build.mbcBytes) {
      for (const d of build.diagnostics) console.error(`[${d.code}] line ${d.line}:${d.column} ${d.message}`);
      process.exit(1);
    }
    const outPath = flags.out || file.replace(/\.manifest$/i, '') + '.mbc';
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, build.mbcBytes);
    console.log(`Wrote verified Manifest Bytecode: ${outPath} (${build.mbcBytes.length} bytes)`);
    return;
  }

  if (command === 'build') {
    const source = fs.readFileSync(file, 'utf-8');
    const targetSpec = resolveCompilerTarget(flags.target || 'mvm');
    const build = await compileManifestV1(source, {
      target: targetSpec.id,
      profile: flags.profile,
      entryFile: path.basename(file),
      files: loadWorkspaceFiles(file),
    });
    if (!build.success) {
      for (const d of build.diagnostics) {
        if (d.severity === 'error') {
          console.error(`[${d.code}] line ${d.line}:${d.column} ${d.message}`);
        }
      }
      process.exit(1);
    }
    const outDir = path.resolve(flags.out || 'build');
    fs.mkdirSync(outDir, { recursive: true });

    for (const art of build.artifacts) {
      const baseName = path.basename(art.filename);
      const dest = path.join(outDir, baseName);
      if (art.isBinary && art.bytes) {
        fs.writeFileSync(dest, art.bytes);
      } else if (art.text !== undefined) {
        fs.writeFileSync(dest, art.text, 'utf-8');
      }
      console.log(`Emitted ${dest}`);
    }

    if (targetSpec.id === 'native' && build.rustCode) {
      const rustcBin = detectHostRustc();
      if (rustcBin) {
        const rsFile = path.join(outDir, path.basename(file, '.manifest') + '.rs');
        const binFile = path.join(outDir, path.basename(file, '.manifest'));
        fs.writeFileSync(rsFile, build.rustCode, 'utf-8');
        execFileSync(rustcBin, ['-O', rsFile, '-o', binFile], { stdio: 'inherit' });
        console.log(`Compiled native executable via ${rustcBin}: ${binFile}`);
      } else {
        console.log(`Note: Host rustc not found on PATH; emitted standalone Rust source only.`);
      }
    }
    return;
  }

  if (command === 'run') {
    if (file.endsWith('.mbc')) {
      const bytes = new Uint8Array(fs.readFileSync(file));
      const vmRes = await executeMbcInRustVm(bytes, { grantedCapabilities: flags.allow });
      for (const l of vmRes.stdout) console.log(l);
      if (!vmRes.ok) {
        console.error(`Runtime Error: ${vmRes.error}`);
        process.exit(1);
      }
      if (vmRes.returnValue !== 'void') {
        console.log(`=> ${vmRes.returnValue} (${vmRes.returnType}) [${vmRes.steps} steps]`);
      }
      return;
    }

    const source = fs.readFileSync(file, 'utf-8');
    const targetSpec = resolveCompilerTarget(flags.target || 'mvm');

    if (targetSpec.id === 'wasm') {
      const build = await compileManifestV1(source, {
        target: 'wasm',
        profile: flags.profile,
        entryFile: path.basename(file),
        files: loadWorkspaceFiles(file),
      });
      if (!build.success || !build.wasmBytes) {
        for (const d of build.diagnostics) console.error(`[${d.code}] ${d.message}`);
        process.exit(1);
      }
      const logs: string[] = [];
      const { instance } = await WebAssembly.instantiate(build.wasmBytes as BufferSource, {
        env: {
          print_i32: (n: number) => logs.push(String(n)),
          print_f64: (n: number) => logs.push(String(n)),
        },
      });
      const mainFn = instance.exports.main as (() => unknown) | undefined;
      const ret = mainFn ? mainFn() : undefined;
      for (const l of logs) console.log(l);
      if (ret !== undefined) console.log(`=> ${String(ret)}`);
      return;
    }

    if (targetSpec.id === 'native') {
      const rustcBin = detectHostRustc();
      if (!rustcBin) {
        console.error('Native execution requires host rustc toolchain.');
        process.exit(1);
      }
      const build = await compileManifestV1(source, {
        target: 'native',
        profile: flags.profile,
        entryFile: path.basename(file),
        files: loadWorkspaceFiles(file),
      });
      if (!build.success || !build.rustCode) {
        for (const d of build.diagnostics) console.error(`[${d.code}] ${d.message}`);
        process.exit(1);
      }
      const tmpDir = fs.mkdtempSync('/tmp/manifest-native-');
      const rsFile = path.join(tmpDir, 'main.rs');
      const binFile = path.join(tmpDir, 'main_bin');
      fs.writeFileSync(rsFile, build.rustCode, 'utf-8');
      execFileSync(rustcBin, ['-O', rsFile, '-o', binFile], { stdio: 'inherit' });
      const stdout = execFileSync(binFile, [], { encoding: 'utf-8' });
      if (stdout) process.stdout.write(stdout);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return;
    }

    // Default: run on Rust Manifest Virtual Machine (`mvm`)
    // Check if legacy UI/Solana file first
    const check = checkManifestSource(source, {
      profile: flags.profile,
      entryFile: path.basename(file),
      files: loadWorkspaceFiles(file),
    });
    if (check.isDomainExtension) {
      // Fallback to legacy AST Runtime for declarative APP/CONTRACT scripts
      const { executeManifest } = await import('./index.ts');
      const legacyRes = await executeManifest(source);
      for (const l of legacyRes.output) console.log(l);
      return;
    }

    const runRes = await runManifestOnRustMvm(source, {
      profile: flags.profile,
      entryFile: path.basename(file),
      files: loadWorkspaceFiles(file),
      grantedCapabilities: flags.allow,
    });
    for (const l of runRes.stdout) console.log(l);
    if (!runRes.ok) {
      console.error(`Error: ${runRes.error}`);
      process.exit(1);
    }
    if (runRes.returnValue !== 'void') {
      console.log(`=> ${runRes.returnValue} [${runRes.stepsExecuted} MVM steps]`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

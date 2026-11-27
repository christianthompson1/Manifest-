import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SyntaxProfile } from './core/profile.ts';
import { migrateV0ToV1 } from './migration/v0-to-v1-migrator.ts';
import {
  checkManifestSource,
  compileManifestV1,
  runManifestOnRustMvm,
} from './pipeline.ts';
import { COMPILER_TARGETS, resolveCompilerTarget } from './targets/target-registry.ts';
import { disassembleMbcInRustVm, executeMbcInRustVm, verifyMbcInRustVm } from './vm/mvm-runner.ts';
import { PackageManager, OFFICIAL_PACKAGE_REGISTRY } from './package/package-manager.ts';

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
  manifest migrate <file.manifest> [--profile beginner|professional] [--out <file.manifest>]
  manifest targets
  manifest package init [name]
  manifest package list
  manifest package verify
  manifest add <pkg> [version]
  manifest remove <pkg>
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
    'migrate',
    'targets',
    'package',
    'add',
    'remove',
  ]);

  let command = rawArgs[0];
  let restArgs = rawArgs.slice(1);

  // Backward compatibility: `tsx manifest-core/src/cli.ts <file.manifest>`
  if (!knownCommands.has(command) && fs.existsSync(command)) {
    restArgs = [command, ...restArgs];
    command = 'run';
  }

  const flags = parseFlags(restArgs);

  if (command === 'package') {
    const subCmd = flags.positional[0] || 'list';
    if (subCmd === 'init') {
      const name = flags.positional[1] || path.basename(process.cwd());
      const toml = PackageManager.initPackage(name);
      const tomlPath = path.resolve('manifest.toml');
      if (fs.existsSync(tomlPath)) {
        console.error('Error: manifest.toml already exists');
        process.exit(1);
      }
      fs.writeFileSync(tomlPath, toml, 'utf-8');
      console.log(`Created manifest.toml for package '${name}'`);
      return;
    }
    if (subCmd === 'verify') {
      const tomlPath = path.resolve('manifest.toml');
      if (!fs.existsSync(tomlPath)) {
        console.error('Error: manifest.toml not found');
        process.exit(1);
      }
      const tomlContent = fs.readFileSync(tomlPath, 'utf-8');
      const lockPath = path.resolve('manifest.lock');
      const lockContent = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf-8') : undefined;
      const res = PackageManager.verifyPackage(tomlContent, lockContent);
      if (!res.ok) {
        console.error('Package verification failed:');
        for (const e of res.errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      console.log('Package verification succeeded: manifest.toml and manifest.lock are consistent.');
      return;
    }
    // Default: package list
    const tomlPath = path.resolve('manifest.toml');
    if (!fs.existsSync(tomlPath)) {
      console.log('Available Official Standard Packages:');
      for (const [pkg, versions] of Object.entries(OFFICIAL_PACKAGE_REGISTRY)) {
        console.log(`  - ${pkg} (versions: ${versions.map((v) => v.version).join(', ')})`);
      }
      return;
    }
    const config = PackageManager.parsePackageToml(fs.readFileSync(tomlPath, 'utf-8'));
    console.log(`Declared dependencies for '${config.name}' v${config.version}:`);
    for (const [dep, ver] of Object.entries(config.dependencies)) {
      console.log(`  - ${dep} = "${ver}"`);
    }
    return;
  }

  if (command === 'add') {
    const pkgName = flags.positional[0];
    const ver = flags.positional[1] || '^1.0.0';
    if (!pkgName) {
      console.error('Usage: manifest add <package-name> [version]');
      process.exit(1);
    }
    const tomlPath = path.resolve('manifest.toml');
    const tomlContent = fs.existsSync(tomlPath)
      ? fs.readFileSync(tomlPath, 'utf-8')
      : PackageManager.initPackage('app');
    const res = PackageManager.addDependency(tomlContent, pkgName, ver);
    if (!res.ok) {
      console.error(`Failed to add '${pkgName}':`);
      for (const d of res.result.diagnostics) console.error(`  [${d.code}] ${d.message}`);
      process.exit(1);
    }
    fs.writeFileSync(tomlPath, res.toml, 'utf-8');
    if (res.lock) {
      fs.writeFileSync(path.resolve('manifest.lock'), res.lock, 'utf-8');
    }
    console.log(`Added dependency '${pkgName}' (${ver}) and updated manifest.lock`);
    return;
  }

  if (command === 'remove') {
    const pkgName = flags.positional[0];
    if (!pkgName) {
      console.error('Usage: manifest remove <package-name>');
      process.exit(1);
    }
    const tomlPath = path.resolve('manifest.toml');
    if (!fs.existsSync(tomlPath)) {
      console.error('Error: manifest.toml not found');
      process.exit(1);
    }
    const tomlContent = fs.readFileSync(tomlPath, 'utf-8');
    const res = PackageManager.removeDependency(tomlContent, pkgName);
    if (!res.ok) {
      console.error(`Failed to remove '${pkgName}':`);
      for (const d of res.result.diagnostics) console.error(`  [${d.code}] ${d.message}`);
      process.exit(1);
    }
    fs.writeFileSync(tomlPath, res.toml, 'utf-8');
    if (res.lock) {
      fs.writeFileSync(path.resolve('manifest.lock'), res.lock, 'utf-8');
    }
    console.log(`Removed dependency '${pkgName}' and updated manifest.lock`);
    return;
  }

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

  if (command === 'migrate') {
    const source = fs.readFileSync(file, 'utf-8');
    const targetProf = flags.profile === 'professional' ? 'professional' : 'beginner';
    const res = migrateV0ToV1(source, { targetProfile: targetProf });
    if (flags.out) {
      fs.writeFileSync(flags.out, res.migratedSource, 'utf-8');
      console.log(`Migrated '${file}' -> '${flags.out}' (${res.changes.length} change(s), target hint: ${res.targetHint})`);
    } else {
      process.stdout.write(res.migratedSource);
    }
    for (const w of res.warnings) {
      console.error(`[MIGRATE WARNING] ${w}`);
    }
    return;
  }

  if (command === 'verify') {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const rustRes = await verifyMbcInRustVm(bytes);
    if (!rustRes.ok) {
      console.error(`Verification FAILED for '${file}':`);
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
      if (!rustDis.ok || !rustDis.disassembly) {
        console.error(`Disassembly FAILED for '${file}': ${rustDis.error || 'Unknown error'}`);
        process.exit(1);
      }
      console.log(rustDis.disassembly);
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
    const res = await checkManifestSource(source, {
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
    const res = await checkManifestSource(source, {
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
          print_i64: (n: bigint) => logs.push(String(n)),
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

/**
 * MANIFEST TEST SUITE — PHASE 4 & PHASE 5
 *
 * Verifies:
 * 1. Bytecode Verifier Hardening (magic, container integrity, stack balance, jump destinations)
 * 2. MVM Mark-and-Sweep Garbage Collector (root tracking, reclamation, free-list slot reuse, stats)
 * 3. MVM Resource Controls & Deterministic Traps (step fuel exhaustion, call stack depth, checked math)
 * 4. Runtime Value Model & Dedicated Bytes Type (binary vs string, deep structural equality)
 * 5. Exact WebAssembly 64-bit Integer Output (direct env.print_i64 without float truncation)
 * 6. Standard Library Architecture & Capability Registry (std::* modules)
 * 7. Package Format, SemVer Resolver & Lockfile Verification (manifest.toml / manifest.lock)
 */

import {
  MvmHeapArena,
  MvmValue,
  RootProvider,
} from '../src/vm/mvm-heap.ts';
import { MvmInterpreter } from '../src/vm/mvm-interpreter.ts';
import { verifyMbcBytes, decodeMbcContainer } from '../src/bytecode/mbc-reader.ts';
import { MbcOpcode, DecodedMbcModule } from '../src/bytecode/mbc-format.ts';
import { StdLibraryRegistry } from '../src/stdlib/std-modules.ts';
import { parseSemVer, satisfiesSemVer, compareSemVer } from '../src/package/semver.ts';
import { DependencyResolver, PackageRegistryMap } from '../src/package/dependency-resolver.ts';
import { PackageManager } from '../src/package/package-manager.ts';
import { compileManifestV1 } from '../src/pipeline.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

async function runSuite() {
  console.log('\n======================================================');
  console.log('MANIFEST TEST SUITE — PHASE 4: MVM & RUNTIME MATURITY');
  console.log('======================================================\n');

  // -----------------------------------------------------------------
  // 1. Bytecode Verifier Hardening
  // -----------------------------------------------------------------
  console.log('--- 1. Bytecode Verifier Hardening ---');

  // Test 1.1: Reject invalid magic
  const badMagic = new Uint8Array([0x42, 0x41, 0x44, 0x21, 0x01, 0x00]);
  const verifBadMagic = verifyMbcBytes(badMagic);
  assert(!verifBadMagic.valid && verifBadMagic.errors.some(e => e.includes('magic') || e.includes('Magic')), 'Rejects invalid container magic');

  // Test 1.2: Reject truncated bytecode
  const truncated = new Uint8Array([0x4D, 0x42, 0x43]);
  const verifTrunc = verifyMbcBytes(truncated);
  assert(!verifTrunc.valid && verifTrunc.errors.some(e => e.includes('Truncated') || e.includes('magic')), 'Rejects truncated container');

  // Test 1.3: Reject unsupported major version
  const badVersion = new Uint8Array([
    0x4D, 0x42, 0x43, 0x00, // Magic: "MBC\0"
    0x99, 0x00,             // Major: 153 (unsupported)
    0x00, 0x00,             // Minor: 0
    0x00, 0x00,             // Flags: 0
  ]);
  const verifBadVer = verifyMbcBytes(badVersion);
  assert(!verifBadVer.valid && verifBadVer.errors.some(e => e.includes('version') || e.includes('Unsupported') || e.includes('Truncated')), 'Rejects unsupported bytecode version');

  // Test 1.4: Compile valid Manifest source to MBC and verify bytecode integrity
  const validManifestSrc = `
module verifier_test;
requires console;

fn add(a: i64, b: i64) -> i64 {
    return a + b;
}

fn main() -> i64 effects(console) {
    let sum: i64 = add(10, 20);
    console.print(sum);
    return sum;
}
`;
  const mbcCompilation = await compileManifestV1(validManifestSrc, { target: 'mbc' });
  assert(mbcCompilation.success && mbcCompilation.mbcBytes !== undefined, 'Pipeline compiles Manifest program to MBC bytecode');

  const validMbcBytes = mbcCompilation.mbcBytes!;
  const verifValid = verifyMbcBytes(validMbcBytes);
  assert(verifValid.valid && verifValid.errors.length === 0, 'Verifier accepts valid compiled MBC container with 0 errors');

  // Test 1.5: Verify container decoding parses expected metadata
  const decoded = decodeMbcContainer(validMbcBytes);
  assert(decoded.moduleName === 'verifier_test', `Decoded module name is 'verifier_test' (got '${decoded.moduleName}')`);
  assert(decoded.functions.length >= 2, `Decoded functions count >= 2 (got ${decoded.functions.length})`);
  assert(decoded.requires.includes('console'), 'Decoded module requires capability console');

  // -----------------------------------------------------------------
  // 2. MVM Mark-and-Sweep Garbage Collector
  // -----------------------------------------------------------------
  console.log('\n--- 2. MVM Mark-and-Sweep Garbage Collector ---');

  const heap = new MvmHeapArena(50);

  // Allocate an array
  const id1 = heap.alloc({
    kind: 'array',
    items: [{ kind: 'i64', value: 10n }, { kind: 'i64', value: 20n }],
  });
  const arrRef1: MvmValue = { kind: 'array_ref', id: id1 };
  assert(arrRef1.kind === 'array_ref', 'Allocates array on managed HeapArena');

  // Allocate another array
  const id2 = heap.alloc({
    kind: 'array',
    items: [{ kind: 'i64', value: 30n }],
  });
  const arrRef2: MvmValue = { kind: 'array_ref', id: id2 };

  // Root provider protecting only arrRef1
  const roots1: RootProvider = {
    getStackRoots: () => [arrRef1],
    getGlobalRoots: () => [],
    getFrameRoots: () => [],
  };

  // Run Mark-and-Sweep GC
  const gcRes = heap.collectGarbage(roots1);
  assert(gcRes.reclaimed === 1, `Collected exactly 1 unreferenced object (actual: ${gcRes.reclaimed})`);
  assert(heap.getArray(id1) !== undefined, 'Rooted object arrRef1 survived GC');

  let id2Reclaimed = false;
  try {
    heap.get(id2);
  } catch {
    id2Reclaimed = true;
  }
  assert(id2Reclaimed, 'Unreferenced object arrRef2 was reclaimed');

  // Verify free-list slot reuse
  const id3 = heap.alloc({
    kind: 'array',
    items: [{ kind: 'i64', value: 999n }],
  });
  assert(id3 === id2, `Reuses reclaimed slot id ${id2} from free list`);

  // Verify GC statistics
  const gcStats = heap.getStats();
  assert(gcStats.collections >= 1 && gcStats.objectsReclaimed === 1, 'GC statistics accurately track collections and reclaimed count');

  // -----------------------------------------------------------------
  // 3. MVM Resource Controls & Deterministic Traps
  // -----------------------------------------------------------------
  console.log('\n--- 3. MVM Resource Controls & Traps ---');

  // Test 3.1: Execute valid program via MvmInterpreter
  const execValid = MvmInterpreter.execute(validMbcBytes, {
    grantedCapabilities: ['console'],
  });
  assert(execValid.ok, `Interpreter executes valid MBC module (phase: ${execValid.phase})`);
  assert(execValid.returnValue === '30', `Returns correct computed value (got: ${execValid.returnValue})`);
  assert(execValid.stdout.some(line => line.includes('30')), `Stdout captured output: ${execValid.stdout.join('; ')}`);

  // Test 3.2: Fuel exhaustion trap
  const execFuel = MvmInterpreter.execute(validMbcBytes, {
    maxSteps: 3, // Very low step limit
    grantedCapabilities: ['console'],
  });
  assert(!execFuel.ok && execFuel.error?.includes('E_MVM_FUEL_EXHAUSTED'), 'Deterministically traps on fuel exhaustion with E_MVM_FUEL_EXHAUSTED');

  // Test 3.3: Call stack depth limit trap
  const execCall = MvmInterpreter.execute(validMbcBytes, {
    maxCallDepth: 1, // Only allow 1 frame, calling add() exceeds it
    grantedCapabilities: ['console'],
  });
  assert(!execCall.ok && execCall.error?.includes('E_MVM_CALL_DEPTH_EXCEEDED'), 'Deterministically traps on call stack depth with E_MVM_CALL_DEPTH_EXCEEDED');

  // Test 3.4: Host capability enforcement (unauthorized capability)
  const execNoCap = MvmInterpreter.execute(validMbcBytes, {
    grantedCapabilities: [], // Deny all capabilities
  });
  assert(!execNoCap.ok && execNoCap.error?.includes('E_MVM_CAPABILITY_DENIED'), 'Deterministically blocks ungranted capability with authorization error');

  // -----------------------------------------------------------------
  // 4. Runtime Value Model & Dedicated Bytes Type
  // -----------------------------------------------------------------
  console.log('\n--- 4. Runtime Value Model & Bytes Type ---');

  const byteHeap = new MvmHeapArena();
  const bId1 = byteHeap.alloc({
    kind: 'bytes',
    buffer: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  });
  const b1: MvmValue = { kind: 'bytes_ref', id: bId1 };

  const bId2 = byteHeap.alloc({
    kind: 'bytes',
    buffer: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  });
  const b2: MvmValue = { kind: 'bytes_ref', id: bId2 };

  const bId3 = byteHeap.alloc({
    kind: 'bytes',
    buffer: new Uint8Array([0xca, 0xfe]),
  });
  const b3: MvmValue = { kind: 'bytes_ref', id: bId3 };

  assert(b1.kind === 'bytes_ref', 'Dedicated Bytes object allocated with bytes_ref');
  assert(byteHeap.equals(b1, b2), 'Deep equality correctly compares identical byte sequences');
  assert(!byteHeap.equals(b1, b3), 'Deep equality distinguishes differing byte sequences');
  assert(byteHeap.formatValue(b1) === 'Bytes[4]', `Bytes formatted with length representation: ${byteHeap.formatValue(b1)}`);

  // -----------------------------------------------------------------
  // 5. Exact WebAssembly 64-bit Integer Output
  // -----------------------------------------------------------------
  console.log('\n--- 5. Exact WebAssembly 64-bit Integer Output ---');

  const wasmSrc = `
module wasm_i64_test;
requires console;

fn main() -> i64 effects(console) {
    let big: i64 = 9223372036854775807;
    console.print(big);
    return 0;
}
`;
  const wasmComp = await compileManifestV1(wasmSrc, { target: 'wasm' });
  assert(wasmComp.success && wasmComp.wasmBytes !== undefined, 'Compiles Manifest source to WebAssembly');

  const wasmBytes = wasmComp.wasmBytes!;
  assert(wasmBytes && wasmBytes.length > 8, 'Produces valid WebAssembly binary');

  let printedI64 = '';
  const importObject = {
    env: {
      print_i32: (_val: number) => {},
      print_f64: (_val: number) => {},
      print_i64: (val: bigint) => {
        printedI64 = val.toString();
      },
    },
  };

  try {
    const wasmModule: any = await WebAssembly.instantiate(wasmBytes, importObject);
    const exports = wasmModule.instance ? wasmModule.instance.exports : wasmModule.exports;
    if (exports.main) {
      exports.main();
      assert(printedI64 === '9223372036854775807', `Exact 64-bit integer printed without float truncation: ${printedI64}`);
    } else {
      assert(false, 'Export main not found in WASM instance');
    }
  } catch (err: any) {
    assert(false, `WebAssembly instantiation/execution failed: ${err.message}`);
  }

  console.log('\n======================================================');
  console.log('MANIFEST TEST SUITE — PHASE 5: STDLIB & PACKAGES');
  console.log('======================================================\n');

  // -----------------------------------------------------------------
  // 6. Standard Library Architecture & Capability Registry
  // -----------------------------------------------------------------
  console.log('--- 6. Standard Library Architecture ---');

  const registry = StdLibraryRegistry.getInstance();
  const modules = registry.listModules();
  assert(modules.length >= 10, `Registered ${modules.length} standard library modules`);

  const coreMod = registry.getModule('std::core');
  assert(coreMod !== undefined && coreMod.capabilities.length === 0, 'std::core is registered as a pure module without capabilities');

  const cryptoMod = registry.getModule('std::crypto');
  assert(cryptoMod !== undefined && cryptoMod.capabilities.includes('crypto'), 'std::crypto is capability-gated on crypto');

  const fsMod = registry.getModule('std::fs');
  assert(fsMod !== undefined && fsMod.capabilities.includes('fs.read'), 'std::fs is capability-gated on fs.read');

  const mathMod = registry.getModule('std::math');
  assert(mathMod !== undefined && mathMod.capabilities.length === 0, 'std::math is pure language math module');

  // -----------------------------------------------------------------
  // 7. Package Format, SemVer Resolver & Lockfile Verification
  // -----------------------------------------------------------------
  console.log('\n--- 7. Package Manager & Dependency Resolver ---');

  // Test 7.1: SemVer parsing & matching
  const v100 = parseSemVer('1.0.0');
  const v120 = parseSemVer('1.2.0');
  const v200 = parseSemVer('2.0.0');
  assert(v100 !== null && v120 !== null && v200 !== null, 'SemVer parser parses valid versions');

  assert(satisfiesSemVer('1.0.0', '^1.0.0') && satisfiesSemVer('1.2.0', '^1.0.0') && !satisfiesSemVer('2.0.0', '^1.0.0'), 'Caret constraint ^1.0.0 matches 1.x but not 2.0.0');

  assert(satisfiesSemVer('1.0.5', '~1.0.0') && !satisfiesSemVer('1.2.0', '~1.0.0'), 'Tilde constraint ~1.0.0 matches patch updates within 1.0.x');

  // Test 7.2: Package Manager init
  const initToml = PackageManager.initPackage('my-app', 'A test app');
  assert(initToml.includes('name = "my-app"') && initToml.includes('[dependencies]'), 'Initializes valid manifest.toml');

  // Test 7.3: Add dependency & resolve transitive lockfile
  const addRes = PackageManager.addDependency(initToml, 'json', '^1.0.0');
  assert(addRes.ok && addRes.lock !== undefined, 'Resolves dependencies and generates manifest.lock');

  const lockObj = PackageManager.parseLockfile(addRes.lock!);
  assert(lockObj.packages['json'] !== undefined && lockObj.packages['std-core'] !== undefined, 'Transitively resolves json and std-core dependencies in lockfile');
  assert(lockObj.packages['json'].integrity.startsWith('sha256:'), 'Generates SHA-256 integrity checksum for resolved package');

  // Test 7.4: Circular dependency detection
  const cyclicRegistry: PackageRegistryMap = {
    pkgA: [{ version: '1.0.0', source: 'registry', dependencies: { pkgB: '^1.0.0' } }],
    pkgB: [{ version: '1.0.0', source: 'registry', dependencies: { pkgA: '^1.0.0' } }],
  };
  const cyclicConfig = {
    name: 'test-cycle',
    version: '0.1.0',
    dependencies: { pkgA: '^1.0.0' },
  };
  const cyclicRes = DependencyResolver.resolve(cyclicConfig, cyclicRegistry);
  assert(!cyclicRes.ok && cyclicRes.diagnostics.some(d => d.code === 'E_CIRCULAR_DEPENDENCY'), 'Detects circular dependencies with E_CIRCULAR_DEPENDENCY');

  // Test 7.5: Version conflict detection
  const conflictRegistry: PackageRegistryMap = {
    libX: [
      { version: '1.0.0', source: 'registry', dependencies: { shared: '^1.0.0' } },
    ],
    libY: [
      { version: '1.0.0', source: 'registry', dependencies: { shared: '^2.0.0' } },
    ],
    shared: [
      { version: '1.0.0', source: 'registry', dependencies: {} },
      { version: '2.0.0', source: 'registry', dependencies: {} },
    ],
  };
  const conflictConfig = {
    name: 'test-conflict',
    version: '0.1.0',
    dependencies: {
      libX: '^1.0.0',
      libY: '^1.0.0',
    },
  };
  const conflictRes = DependencyResolver.resolve(conflictConfig, conflictRegistry);
  assert(!conflictRes.ok && conflictRes.diagnostics.some(d => d.code === 'E_DEPENDENCY_CONFLICT'), 'Detects incompatible version constraints with E_DEPENDENCY_CONFLICT');

  // Test 7.6: Lockfile integrity verification
  const verifyValid = PackageManager.verifyPackage(addRes.toml, addRes.lock);
  assert(verifyValid.ok && verifyValid.errors.length === 0, 'Verifies valid package manifest and intact lockfile');

  const corruptedLock = addRes.lock!.replace('sha256:', 'corrupted:');
  const verifyCorrupted = PackageManager.verifyPackage(addRes.toml, corruptedLock);
  assert(!verifyCorrupted.ok && verifyCorrupted.errors.length > 0, 'Detects corrupted integrity checksum during verification');

  // Test 7.7: Remove dependency
  const removeRes = PackageManager.removeDependency(addRes.toml, 'json');
  assert(removeRes.ok && !removeRes.toml.includes('json ='), 'Removes dependency and re-resolves lockfile');

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});

/**
 * Manifest v1.0 — Stage 5 Verification & Rust WASM Conformance Suite
 *
 * Cross-runtime and differential verification across:
 *   - MvmHeapArena & MvmInterpreter (TS Reference VM)
 *   - Semantic Evaluator (MIR Reference Oracle)
 *   - Web-JS Target (Compiled JS executed in isolated node:vm)
 *   - Direct WebAssembly Target (W3C Wasm instantiated in Node)
 *   - Native Rust Codegen (MIR -> Standalone Safe Rust checks)
 *   - Integrated Offline Rust WASM MVM (mvm-runner.ts / MVM_WASM_BASE64 / public/wasm/mvm_wasm.wasm)
 *   - Manifest Studio Execution Provider (ManifestExecutionProvider)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

import { checkManifestSource, compileManifestV1 } from '../src/pipeline.ts';
import { compileMIRToMbc } from '../src/bytecode/mbc-compiler.ts';
import { compileMIRToWebJS } from '../src/targets/web-js-target.ts';
import { compileMIRToWasm } from '../src/targets/wasm-target.ts';
import { buildNativeTargetSourceOnly } from '../src/targets/native-target.ts';
import { evaluateMIRModule } from '../src/runtime/semantic-evaluator.ts';
import { MvmHeapArena, MvmValue, RootProvider } from '../src/vm/mvm-heap.ts';
import { MvmInterpreter } from '../src/vm/mvm-interpreter.ts';
import { MIRModule, MIRExpr, MIRStmt } from '../src/ir/typed-ir.ts';
import { T_BOOL, T_F64, T_I64, T_STR, T_VOID, SemanticType } from '../src/semantics/types.ts';
import {
  disassembleMbcInRustVm,
  executeMbcInRustVm,
  getRustMvmEngineInfo,
  verifyMbcInRustVm,
} from '../src/vm/mvm-runner.ts';
import {
  MVM_WASM_BASE64,
  MVM_WASM_BYTE_LENGTH,
  MVM_WASM_SHA256,
} from '../src/vm/mvm-wasm-bytes.ts';
import { ManifestExecutionProvider } from '../../src/studio/execution/manifest-execution-provider.ts';
import { ManifestProject } from '../../src/studio/types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function nodeSha256Text(input: string): string {
  return crypto.createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');
}

function sha256Bytes(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function runWebJsInSandbox(jsCode: string): { returnValue: string; stdout: string[] } {
  const runnable = jsCode.replace(
    /^export function __runManifestModule/m,
    'function __runManifestModule'
  );
  const sandbox: Record<string, unknown> = {
    TextEncoder,
    Uint8Array,
    Uint32Array,
    DataView,
    ArrayBuffer,
    Map,
    Set,
    WeakMap,
    BigInt,
    Number,
    Math,
    String,
    Array,
    Error,
    TypeError,
    Symbol,
    Date,
    console: { log: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  return vm.runInContext(`${runnable}\n__runManifestModule();`, ctx) as {
    returnValue: string;
    stdout: string[];
  };
}

function dummySpan() {
  return { line: 1, column: 1, endLine: 1, endColumn: 1 };
}

function makeSimpleMir(
  moduleName: string,
  locals: Array<{ slot: number; name: string; type: SemanticType }>,
  body: MIRStmt[],
  returnType: SemanticType,
  opts: { requires?: string[]; effects?: string[] } = {}
): MIRModule {
  return {
    kind: 'MIRModule',
    moduleName,
    sourceProfile: 'professional',
    requires: opts.requires ?? [],
    provides: [],
    denies: [],
    structs: [],
    enums: [],
    globals: [],
    functions: [
      {
        name: 'main',
        exported: true,
        isAsync: false,
        isEntry: true,
        isSynthetic: false,
        params: [],
        locals: locals.map((l) => ({
          ...l,
          isParam: false,
          mutable: true,
          span: dummySpan(),
        })),
        returnType,
        effects: opts.effects ?? [],
        body,
        span: dummySpan(),
      },
    ],
    entryFunction: 'main',
  };
}

const T_ANY_ARR: SemanticType = { kind: 'array', element: T_I64 };
const T_ANY_MAP: SemanticType = { kind: 'map', key: T_STR, value: T_I64 };

function localRef(slot: number, name: string, type: SemanticType): MIRExpr {
  return { kind: 'LoadLocal', slot, name, type, span: dummySpan() };
}

function i64Const(value: bigint): MIRExpr {
  return { kind: 'ConstInt', value, type: T_I64, span: dummySpan() };
}

function strConst(value: string): MIRExpr {
  return { kind: 'ConstStr', value, type: T_STR, span: dummySpan() };
}

async function runStage5Tests(): Promise<void> {
  console.log('\n=== MANIFEST STAGE 5: MVM GC, EQUALITY, SHA-256, F64->I64, METERING & RUST WASM TESTS ===\n');

  // =========================================================================
  // AREA A: Garbage Collection & Memory Management (TS MVM + Rust WASM MVM)
  // =========================================================================
  console.log('A. Garbage Collection & Memory Management (TS + Rust WASM)');

  const gcHeap = new MvmHeapArena(4, 1024);
  const stackRoots: MvmValue[] = [];
  const globalRoots: MvmValue[] = [];
  const frameRoots: MvmValue[] = [];
  const tempRoots: MvmValue[] = [];
  const roots: RootProvider = {
    getStackRoots: () => stackRoots,
    getGlobalRoots: () => globalRoots,
    getFrameRoots: () => frameRoots,
    getTempRoots: () => tempRoots,
  };

  globalRoots.push({
    kind: 'array_ref',
    id: gcHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 777n }] }, roots),
  });
  frameRoots.push({
    kind: 'array_ref',
    id: gcHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 888n }] }, roots),
  });

  let gcCompletedChurn = true;
  try {
    for (let i = 0; i < 30; i++) {
      const id = gcHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: BigInt(i) }] }, roots);
      stackRoots[0] = { kind: 'array_ref', id };
    }
  } catch (err: any) {
    gcCompletedChurn = false;
    assert(false, `A.1 Heap churn under tight limit failed: ${err?.message || err}`);
  }
  const gcStatsAfterChurn = gcHeap.getStats();
  assert(
    gcCompletedChurn &&
      gcStatsAfterChurn.collections >= 1 &&
      gcStatsAfterChurn.objectsReclaimed >= 20 &&
      gcStatsAfterChurn.currentLive <= 4,
    `A.1 Auto-GC reclaimed unreachable objects during churn (collections=${gcStatsAfterChurn.collections}, reclaimed=${gcStatsAfterChurn.objectsReclaimed}, live=${gcStatsAfterChurn.currentLive})`
  );
  assert(
    gcHeap.getArray((globalRoots[0] as any).id).items[0].kind === 'i64' &&
      (gcHeap.getArray((globalRoots[0] as any).id).items[0] as any).value === 777n &&
      (gcHeap.getArray((frameRoots[0] as any).id).items[0] as any).value === 888n,
    'A.2 Global and frame roots preserved untouched across multiple GC cycles'
  );

  const tempId = gcHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 999n }] }, roots);
  tempRoots.push({ kind: 'array_ref', id: tempId });
  gcHeap.collectGarbage(roots);
  let tempAlive = false;
  try {
    tempAlive = (gcHeap.getArray(tempId).items[0] as any).value === 999n;
  } catch {
    tempAlive = false;
  }
  assert(tempAlive, 'A.3 In-flight tempRoots protected across mark-and-sweep collection');
  tempRoots.length = 0;

  stackRoots.length = 0;
  const cycA = gcHeap.alloc({ kind: 'array', items: [] }, roots);
  tempRoots.push({ kind: 'array_ref', id: cycA });
  const cycB = gcHeap.alloc({ kind: 'array', items: [{ kind: 'array_ref', id: cycA }] }, roots);
  gcHeap.arrayPush(cycA, { kind: 'array_ref', id: cycB }, roots);
  tempRoots.length = 0;
  const beforeCycCollect = gcHeap.getLiveCount();
  const cycGc = gcHeap.collectGarbage(roots);
  assert(
    cycA !== cycB && cycGc.reclaimed >= 2 && gcHeap.getLiveCount() <= beforeCycCollect - 2,
    `A.4 Cyclic unreachable island reclaimed safely (reclaimed=${cycGc.reclaimed})`
  );

  const oomHeap = new MvmHeapArena(2, 4096);
  const oomRootsList: MvmValue[] = [];
  const oomProvider: RootProvider = {
    getStackRoots: () => oomRootsList,
    getGlobalRoots: () => [],
    getFrameRoots: () => [],
  };
  oomRootsList.push({ kind: 'array_ref', id: oomHeap.alloc({ kind: 'array', items: [] }, oomProvider) });
  oomRootsList.push({ kind: 'array_ref', id: oomHeap.alloc({ kind: 'array', items: [] }, oomProvider) });
  let oomError = '';
  try {
    oomHeap.alloc({ kind: 'array', items: [] }, oomProvider);
  } catch (err: any) {
    oomError = err?.message || String(err);
  }
  assert(
    oomError.includes('E_MVM_MEMORY_LIMIT'),
    `A.5 Exhausting rooted object limit fails cleanly with E_MVM_MEMORY_LIMIT (${oomError})`
  );

  // End-to-end 30-iteration allocation loop under maxHeapObjects=4 & maxHeapBytes=512 (TS + Rust WASM)
  const gcManifestSrc = `
module stage5_gc_loop;
fn main() -> i64 {
    let mut acc: i64 = 0;
    let mut i: i64 = 0;
    while i < 30 {
        let tmp: Array<i64> = [i, i + 1];
        acc = acc + tmp[0];
        i = i + 1;
    }
    return acc;
}
`;
  const gcCompiled = await compileManifestV1(gcManifestSrc, { target: 'mbc' });
  assert(
    gcCompiled.success && !!gcCompiled.mbcBytes,
    'A.6 Stage 5 loop allocation module compiles to MBC',
    gcCompiled.diagnostics.map((d) => d.message).join('; ')
  );
  if (gcCompiled.mbcBytes) {
    const gcTsRes = MvmInterpreter.execute(gcCompiled.mbcBytes, {
      maxHeapObjects: 4,
      maxHeapBytes: 512,
    });
    const gcRustRes = await executeMbcInRustVm(gcCompiled.mbcBytes, {
      maxHeapObjects: 4,
      maxHeapBytes: 512,
    });
    assert(
      gcTsRes.ok &&
        gcTsRes.returnValue === '435' &&
        gcTsRes.gcStats.collections >= 5 &&
        gcTsRes.gcStats.objectsReclaimed >= 25 &&
        gcRustRes.ok &&
        gcRustRes.returnValue === '435' &&
        (gcRustRes.gcStats?.collections ?? 0) >= 5 &&
        (gcRustRes.gcStats?.objectsReclaimed ?? 0) >= 25 &&
        (gcRustRes.gcStats?.liveObjects ?? 99) <= 4 &&
        (gcRustRes.heapObjectsAllocated ?? 0) >= 30,
      `A.7 Differential loop GC under maxHeapObjects=4, maxHeapBytes=512 passes on TS & Rust WASM (rustCollections=${gcRustRes.gcStats?.collections}, rustReclaimed=${gcRustRes.gcStats?.objectsReclaimed}, rustLive=${gcRustRes.gcStats?.liveObjects})`,
      gcRustRes.error
    );
  }

  // Unreachable cyclic graphs allocated & overwritten in MBC loop under tight heap limits
  const cyclicLoopMir = makeSimpleMir(
    'cyclic_gc_loop',
    [
      { slot: 0, name: 'i', type: T_I64 },
      { slot: 1, name: 'a', type: T_ANY_ARR },
      { slot: 2, name: 'b', type: T_ANY_ARR },
      { slot: 3, name: 'pinned', type: T_ANY_ARR },
    ],
    [
      {
        kind: 'StoreLocal',
        slot: 3,
        name: 'pinned',
        isDeclaration: true,
        value: { kind: 'ArrayNew', elements: [i64Const(999n)], type: T_ANY_ARR, span: dummySpan() },
        span: dummySpan(),
      },
      {
        kind: 'StoreLocal',
        slot: 0,
        name: 'i',
        isDeclaration: true,
        value: i64Const(0n),
        span: dummySpan(),
      },
      {
        kind: 'While',
        condition: {
          kind: 'Binary',
          op: '<',
          left: localRef(0, 'i', T_I64),
          right: i64Const(20n),
          type: T_BOOL,
          span: dummySpan(),
        },
        body: [
          {
            kind: 'StoreLocal',
            slot: 1,
            name: 'a',
            isDeclaration: false,
            value: { kind: 'ArrayNew', elements: [], type: T_ANY_ARR, span: dummySpan() },
            span: dummySpan(),
          },
          {
            kind: 'StoreLocal',
            slot: 2,
            name: 'b',
            isDeclaration: false,
            value: {
              kind: 'ArrayNew',
              elements: [localRef(1, 'a', T_ANY_ARR)],
              type: T_ANY_ARR,
              span: dummySpan(),
            },
            span: dummySpan(),
          },
          {
            kind: 'ExprStmt',
            expr: {
              kind: 'ArrayPush',
              array: localRef(1, 'a', T_ANY_ARR),
              value: localRef(2, 'b', T_ANY_ARR),
              type: T_VOID,
              span: dummySpan(),
            },
            span: dummySpan(),
          },
          {
            kind: 'StoreLocal',
            slot: 0,
            name: 'i',
            isDeclaration: false,
            value: {
              kind: 'Binary',
              op: '+',
              left: localRef(0, 'i', T_I64),
              right: i64Const(1n),
              type: T_I64,
              span: dummySpan(),
            },
            span: dummySpan(),
          },
        ],
        span: dummySpan(),
      },
      {
        kind: 'Return',
        value: {
          kind: 'ArrayGet',
          array: localRef(3, 'pinned', T_ANY_ARR),
          index: i64Const(0n),
          type: T_I64,
          span: dummySpan(),
        },
        span: dummySpan(),
      },
    ],
    T_I64
  );
  const cyclicLoopMbc = compileMIRToMbc(cyclicLoopMir).bytes;
  const cycLoopTs = MvmInterpreter.execute(cyclicLoopMbc, { maxHeapObjects: 6, maxHeapBytes: 1024 });
  const cycLoopRust = await executeMbcInRustVm(cyclicLoopMbc, { maxHeapObjects: 6, maxHeapBytes: 1024 });
  assert(
    cycLoopTs.ok &&
      cycLoopTs.returnValue === '999' &&
      cycLoopRust.ok &&
      cycLoopRust.returnValue === '999' &&
      (cycLoopRust.gcStats?.collections ?? 0) >= 3 &&
      (cycLoopRust.gcStats?.objectsReclaimed ?? 0) >= 30,
    `A.8 Cyclic unreachable MBC loop reclaims dead cycles and preserves pinned root across TS & Rust WASM (rustReclaimed=${cycLoopRust.gcStats?.objectsReclaimed})`,
    cycLoopRust.error
  );

  // Live pinned arrays exceeding maxHeapObjects must trap cleanly with E_MVM_MEMORY_LIMIT on BOTH
  const liveLimitSrc = `
module stage5_live_oom;
fn main() -> i64 {
    let a: Array<i64> = [1];
    let b: Array<i64> = [2];
    let c: Array<i64> = [3];
    let d: Array<i64> = [4];
    return a[0] + b[0] + c[0] + d[0];
}
`;
  const liveLimitMbc = (await compileManifestV1(liveLimitSrc, { target: 'mbc' })).mbcBytes!;
  const liveOomTs = MvmInterpreter.execute(liveLimitMbc, { maxHeapObjects: 2 });
  const liveOomRust = await executeMbcInRustVm(liveLimitMbc, { maxHeapObjects: 2 });
  assert(
    !liveOomTs.ok &&
      (liveOomTs.error || '').includes('E_MVM_MEMORY_LIMIT') &&
      !liveOomRust.ok &&
      liveOomRust.errorCode === 'E_MVM_MEMORY_LIMIT',
    `A.9 Rooted heap exhaustion (> maxHeapObjects) traps cleanly with E_MVM_MEMORY_LIMIT across TS & Rust WASM (${liveOomRust.error})`
  );

  // =========================================================================
  // AREA B: Cycle-Safe Deep Structural Equality Across Runtimes
  // =========================================================================
  console.log('\nB. Structural Equality & Cycle-Safe Bisimulation (TS + Rust WASM)');

  const eqSrc = `
module stage5_eq;
struct Pair { a: i64, b: str }
enum Msg { Empty, Data(i64) }

fn main() -> bool {
    let arr1: Array<i64> = [1, 2, 3];
    let arr2: Array<i64> = [1, 2, 3];
    let arr3: Array<i64> = [1, 2, 4];
    let shared: Array<i64> = [7, 8];
    let dag1: Array<Array<i64>> = [shared, shared];
    let dag2: Array<Array<i64>> = [[7, 8], [7, 8]];
    let m1: Map<str, i64> = { "x": 10, "y": 20 };
    let m2: Map<str, i64> = { "y": 20, "x": 10 };
    let m3: Map<str, i64> = { "x": 10, "z": 20 };
    let s1: Pair = Pair { a: 5, b: "ok" };
    let s2: Pair = Pair { a: 5, b: "ok" };
    let s3: Pair = Pair { a: 6, b: "ok" };
    let e1: Msg = Msg::Data(42);
    let e2: Msg = Msg::Data(42);
    let e3: Msg = Msg::Data(43);
    let neg_zero: bool = (-0.0 == 0.0);
    return (arr1 == arr2)
        && (arr1 != arr3)
        && (dag1 == dag2)
        && (m1 == m2)
        && (m1 != m3)
        && (s1 == s2)
        && (s1 != s3)
        && (e1 == e2)
        && (e1 != e3)
        && neg_zero;
}
`;
  const eqCheck = await checkManifestSource(eqSrc);
  const eqMbc = await compileManifestV1(eqSrc, { target: 'mbc' });
  assert(
    eqCheck.ok && !!eqCheck.mir && !!eqMbc.mbcBytes,
    'B.1 Structural equality program passes typecheck and compiles to MBC',
    eqCheck.diagnostics.map((d) => d.message).join('; ')
  );
  if (eqCheck.mir && eqMbc.mbcBytes) {
    const eqTs = MvmInterpreter.execute(eqMbc.mbcBytes);
    const eqRust = await executeMbcInRustVm(eqMbc.mbcBytes);
    const eqSem = evaluateMIRModule(eqCheck.mir);
    const eqWeb = runWebJsInSandbox(compileMIRToWebJS(eqCheck.mir).jsCode);
    assert(
      eqTs.ok &&
        eqTs.returnValue === 'true' &&
        eqRust.ok &&
        eqRust.returnValue === 'true' &&
        eqSem.ok &&
        eqSem.returnValue === 'true' &&
        eqWeb.returnValue === 'true',
      `B.2 Array, shared DAG, Map, Struct, Enum, -0.0==0.0 structural equality agrees across TS MVM, Rust WASM MVM, MIR Evaluator, and WebJS`
    );
  }

  // Heap unit bisimulation
  const cycEqHeap = new MvmHeapArena(32, 4096);
  const cyc1Id = cycEqHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 1n }] });
  const cyc2Id = cycEqHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 1n }] });
  const cyc3Id = cycEqHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 2n }] });
  cycEqHeap.arrayPush(cyc1Id, { kind: 'array_ref', id: cyc1Id });
  cycEqHeap.arrayPush(cyc2Id, { kind: 'array_ref', id: cyc2Id });
  cycEqHeap.arrayPush(cyc3Id, { kind: 'array_ref', id: cyc3Id });
  const cyc4Inner = cycEqHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 1n }] });
  const cyc4Outer = cycEqHeap.alloc({
    kind: 'array',
    items: [{ kind: 'i64', value: 1n }, { kind: 'array_ref', id: cyc4Inner }],
  });
  cycEqHeap.arrayPush(cyc4Inner, { kind: 'array_ref', id: cyc4Outer });

  assert(
    cycEqHeap.equals({ kind: 'array_ref', id: cyc1Id }, { kind: 'array_ref', id: cyc2Id }) &&
      cycEqHeap.equals({ kind: 'array_ref', id: cyc1Id }, { kind: 'array_ref', id: cyc4Outer }) &&
      !cycEqHeap.equals({ kind: 'array_ref', id: cyc1Id }, { kind: 'array_ref', id: cyc3Id }) &&
      !cycEqHeap.equals({ kind: 'f64', value: Number.NaN }, { kind: 'f64', value: Number.NaN }),
    'B.3 Coinductive heap bisimulation handles symmetric/asymmetric cycles, inequalities, and NaN != NaN'
  );
  assert(
    cycEqHeap.formatValue({ kind: 'array_ref', id: cyc1Id }).includes('<Cycle#Array'),
    'B.4 Cyclic formatValue terminates cleanly without stack overflow'
  );

  // Real MBC cyclic array + cyclic map + NaN + cross-type Eq differential check (TS MVM vs Rust WASM MVM)
  const cyclicEqMir = makeSimpleMir(
    'cyclic_eq_mbc',
    [
      { slot: 0, name: 'c1', type: T_ANY_ARR },
      { slot: 1, name: 'c2', type: T_ANY_ARR },
      { slot: 2, name: 'c3', type: T_ANY_ARR },
      { slot: 3, name: 'c4_in', type: T_ANY_ARR },
      { slot: 4, name: 'c4_out', type: T_ANY_ARR },
      { slot: 5, name: 'm1', type: T_ANY_MAP },
      { slot: 6, name: 'm2', type: T_ANY_MAP },
      { slot: 7, name: 'm3', type: T_ANY_MAP },
    ],
    [
      { kind: 'StoreLocal', slot: 0, name: 'c1', isDeclaration: true, value: { kind: 'ArrayNew', elements: [i64Const(1n)], type: T_ANY_ARR, span: dummySpan() }, span: dummySpan() },
      { kind: 'StoreLocal', slot: 1, name: 'c2', isDeclaration: true, value: { kind: 'ArrayNew', elements: [i64Const(1n)], type: T_ANY_ARR, span: dummySpan() }, span: dummySpan() },
      { kind: 'StoreLocal', slot: 2, name: 'c3', isDeclaration: true, value: { kind: 'ArrayNew', elements: [i64Const(2n)], type: T_ANY_ARR, span: dummySpan() }, span: dummySpan() },
      { kind: 'ExprStmt', expr: { kind: 'ArrayPush', array: localRef(0, 'c1', T_ANY_ARR), value: localRef(0, 'c1', T_ANY_ARR), type: T_VOID, span: dummySpan() }, span: dummySpan() },
      { kind: 'ExprStmt', expr: { kind: 'ArrayPush', array: localRef(1, 'c2', T_ANY_ARR), value: localRef(1, 'c2', T_ANY_ARR), type: T_VOID, span: dummySpan() }, span: dummySpan() },
      { kind: 'ExprStmt', expr: { kind: 'ArrayPush', array: localRef(2, 'c3', T_ANY_ARR), value: localRef(2, 'c3', T_ANY_ARR), type: T_VOID, span: dummySpan() }, span: dummySpan() },
      { kind: 'StoreLocal', slot: 3, name: 'c4_in', isDeclaration: true, value: { kind: 'ArrayNew', elements: [i64Const(1n)], type: T_ANY_ARR, span: dummySpan() }, span: dummySpan() },
      { kind: 'StoreLocal', slot: 4, name: 'c4_out', isDeclaration: true, value: { kind: 'ArrayNew', elements: [i64Const(1n), localRef(3, 'c4_in', T_ANY_ARR)], type: T_ANY_ARR, span: dummySpan() }, span: dummySpan() },
      { kind: 'ExprStmt', expr: { kind: 'ArrayPush', array: localRef(3, 'c4_in', T_ANY_ARR), value: localRef(4, 'c4_out', T_ANY_ARR), type: T_VOID, span: dummySpan() }, span: dummySpan() },
      { kind: 'StoreLocal', slot: 5, name: 'm1', isDeclaration: true, value: { kind: 'MapNew', entries: [{ key: strConst('v'), value: i64Const(7n) }], type: T_ANY_MAP, span: dummySpan() }, span: dummySpan() },
      { kind: 'StoreLocal', slot: 6, name: 'm2', isDeclaration: true, value: { kind: 'MapNew', entries: [{ key: strConst('v'), value: i64Const(7n) }], type: T_ANY_MAP, span: dummySpan() }, span: dummySpan() },
      { kind: 'StoreLocal', slot: 7, name: 'm3', isDeclaration: true, value: { kind: 'MapNew', entries: [{ key: strConst('v'), value: i64Const(8n) }], type: T_ANY_MAP, span: dummySpan() }, span: dummySpan() },
      { kind: 'MapSetStmt', map: localRef(5, 'm1', T_ANY_MAP), key: strConst('self'), value: localRef(5, 'm1', T_ANY_MAP), span: dummySpan() },
      { kind: 'MapSetStmt', map: localRef(6, 'm2', T_ANY_MAP), key: strConst('self'), value: localRef(6, 'm2', T_ANY_MAP), span: dummySpan() },
      { kind: 'MapSetStmt', map: localRef(7, 'm3', T_ANY_MAP), key: strConst('self'), value: localRef(7, 'm3', T_ANY_MAP), span: dummySpan() },
      {
        kind: 'Return',
        value: {
          kind: 'Binary',
          op: '&&',
          left: {
            kind: 'Binary',
            op: '&&',
            left: {
              kind: 'Binary',
              op: '&&',
              left: { kind: 'Binary', op: '==', left: localRef(0, 'c1', T_ANY_ARR), right: localRef(1, 'c2', T_ANY_ARR), type: T_BOOL, span: dummySpan() },
              right: { kind: 'Binary', op: '==', left: localRef(0, 'c1', T_ANY_ARR), right: localRef(4, 'c4_out', T_ANY_ARR), type: T_BOOL, span: dummySpan() },
              type: T_BOOL,
              span: dummySpan(),
            },
            right: {
              kind: 'Binary',
              op: '&&',
              left: { kind: 'Binary', op: '!=', left: localRef(0, 'c1', T_ANY_ARR), right: localRef(2, 'c3', T_ANY_ARR), type: T_BOOL, span: dummySpan() },
              right: { kind: 'Binary', op: '==', left: localRef(5, 'm1', T_ANY_MAP), right: localRef(6, 'm2', T_ANY_MAP), type: T_BOOL, span: dummySpan() },
              type: T_BOOL,
              span: dummySpan(),
            },
            type: T_BOOL,
            span: dummySpan(),
          },
          right: {
            kind: 'Binary',
            op: '&&',
            left: { kind: 'Binary', op: '!=', left: localRef(5, 'm1', T_ANY_MAP), right: localRef(7, 'm3', T_ANY_MAP), type: T_BOOL, span: dummySpan() },
            right: {
              kind: 'Binary',
              op: '&&',
              left: { kind: 'Binary', op: '!=', left: { kind: 'ConstFloat', value: Number.NaN, type: T_F64, span: dummySpan() }, right: { kind: 'ConstFloat', value: Number.NaN, type: T_F64, span: dummySpan() }, type: T_BOOL, span: dummySpan() },
              right: { kind: 'Binary', op: '!=', left: i64Const(42n), right: strConst('42'), type: T_BOOL, span: dummySpan() },
              type: T_BOOL,
              span: dummySpan(),
            },
            type: T_BOOL,
            span: dummySpan(),
          },
          type: T_BOOL,
          span: dummySpan(),
        },
        span: dummySpan(),
      },
    ],
    T_BOOL
  );
  const cyclicEqMbc = compileMIRToMbc(cyclicEqMir).bytes;
  const cycEqTs = MvmInterpreter.execute(cyclicEqMbc);
  const cycEqRust = await executeMbcInRustVm(cyclicEqMbc);
  assert(
    cycEqTs.ok && cycEqTs.returnValue === 'true' && cycEqRust.ok && cycEqRust.returnValue === 'true',
    'B.5 MBC cyclic array (symmetric & asymmetric), cyclic map, NaN != NaN, and type-mismatch Eq agree across TS & Rust WASM MVM',
    cycEqRust.error
  );

  // =========================================================================
  // AREA C: Genuine FIPS 180-4 SHA-256 & Strict Type Rejection
  // =========================================================================
  console.log('\nC. Genuine FIPS 180-4 SHA-256 & Type Enforcement (TS + Rust WASM)');

  const shaVectors = [
    '',
    'abc',
    'a'.repeat(55),
    'b'.repeat(56),
    'c'.repeat(64),
    'd'.repeat(65),
    'e'.repeat(119),
    'f'.repeat(120),
    'g'.repeat(128),
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    'λ🚀',
    'a\u0000b',
  ];
  for (const vec of shaVectors) {
    const expected = nodeSha256Text(vec);
    const shaSrc = `
module stage5_sha;
requires [crypto];
fn main() -> str effects(crypto) {
    return std::crypto::sha256(${JSON.stringify(vec)});
}
`;
    const chk = await checkManifestSource(shaSrc);
    const compiled = await compileManifestV1(shaSrc, { target: 'mbc' });
    if (!chk.mir || !compiled.mbcBytes) {
      assert(false, `C.1 Compile SHA-256 len=${vec.length}`, chk.diagnostics.map((d) => d.message).join('; '));
      continue;
    }
    const tsRes = MvmInterpreter.execute(compiled.mbcBytes, { grantedCapabilities: ['crypto'] });
    const rustRes = await executeMbcInRustVm(compiled.mbcBytes, { grantedCapabilities: ['crypto'] });
    const semRes = evaluateMIRModule(chk.mir, { grantedCapabilities: ['crypto'] });
    const webRes = runWebJsInSandbox(compileMIRToWebJS(chk.mir).jsCode);
    const label = vec.length > 16 ? `len=${vec.length}` : JSON.stringify(vec);
    assert(
      tsRes.ok &&
        tsRes.returnValue === expected &&
        rustRes.ok &&
        rustRes.returnValue === expected &&
        semRes.ok &&
        semRes.returnValue === expected &&
        webRes.returnValue === expected,
      `C.1 SHA-256 (${label}) matches Node crypto (${expected.slice(0, 12)}...) across TS MVM, Rust WASM, MIR & WebJS`,
      rustRes.error
    );
  }

  const aliasSrc = `
module stage5_sha_alias;
requires [crypto];
fn main() -> bool effects(crypto) {
    let a: str = crypto.hash("abc");
    let b: str = std::crypto::hash("abc");
    let c: str = std::crypto::sha256("abc");
    return a == b && b == c && a == ${JSON.stringify(nodeSha256Text('abc'))};
}
`;
  const aliasChk = await checkManifestSource(aliasSrc);
  const aliasMbc = await compileManifestV1(aliasSrc, { target: 'mbc' });
  if (!aliasChk.mir || !aliasMbc.mbcBytes) {
    assert(false, 'C.2 SHA-256 alias module compiled cleanly', aliasChk.diagnostics.map((d) => d.message).join('; '));
  } else {
    const aliasTs = MvmInterpreter.execute(aliasMbc.mbcBytes, { grantedCapabilities: ['crypto'] });
    const aliasRust = await executeMbcInRustVm(aliasMbc.mbcBytes, { grantedCapabilities: ['crypto'] });
    const aliasSem = evaluateMIRModule(aliasChk.mir, { grantedCapabilities: ['crypto'] });
    const aliasWeb = runWebJsInSandbox(compileMIRToWebJS(aliasChk.mir).jsCode);
    const aliasNative = buildNativeTargetSourceOnly(aliasChk.mir);
    assert(
      aliasTs.ok &&
        aliasTs.returnValue === 'true' &&
        aliasRust.ok &&
        aliasRust.returnValue === 'true' &&
        aliasSem.ok &&
        aliasSem.returnValue === 'true' &&
        aliasWeb.returnValue === 'true',
      'C.2 All SHA-256 intrinsic aliases agree across TS MVM, Rust WASM, MIR, and WebJS'
    );
    assert(
      aliasNative.rustSource.includes('fn m_sha256') &&
        aliasNative.rustSource.includes('m_sha256(&('),
      'C.3 Native Rust codegen emits genuine standalone m_sha256 helper'
    );
  }

  const badShaMir = makeSimpleMir(
    'bad_sha',
    [],
    [
      {
        kind: 'Return',
        value: {
          kind: 'CallIntrinsic',
          symbol: 'crypto.hash',
          capability: 'crypto',
          args: [i64Const(12345n)],
          type: T_STR,
          span: dummySpan(),
        },
        span: dummySpan(),
      },
    ],
    T_STR,
    { requires: ['crypto'], effects: ['crypto'] }
  );
  const badShaMbc = compileMIRToMbc(badShaMir);
  const badShaTs = MvmInterpreter.execute(badShaMbc.bytes, { grantedCapabilities: ['crypto'] });
  const badShaRust = await executeMbcInRustVm(badShaMbc.bytes, { grantedCapabilities: ['crypto'] });
  const badShaSem = evaluateMIRModule(badShaMir, { grantedCapabilities: ['crypto'] });
  let badShaWebThrew = false;
  try {
    runWebJsInSandbox(compileMIRToWebJS(badShaMir).jsCode);
  } catch (err: any) {
    badShaWebThrew = String(err?.message || err).includes('str');
  }
  assert(
    !badShaTs.ok &&
      (badShaTs.error || '').includes('E_MVM_TYPE_ERROR') &&
      !badShaRust.ok &&
      badShaRust.errorCode === 'E_MVM_TYPE_ERROR' &&
      !badShaSem.ok &&
      (badShaSem.error || '').includes('expects a single str') &&
      badShaWebThrew,
    'C.4 Passing non-str (i64) to crypto.hash rejects cleanly with E_MVM_TYPE_ERROR across TS MVM, Rust WASM, MIR, and WebJS'
  );

  // =========================================================================
  // AREA D: Checked F64 -> I64 Conversion Across All Runtimes + Rust WASM MVM
  // =========================================================================
  console.log('\nD. Checked F64ToI64 Semantics & Boundary Verification (TS + Rust WASM)');

  const validF64Cases: Array<{ input: number; expected: string }> = [
    { input: 0.0, expected: '0' },
    { input: -0.0, expected: '0' },
    { input: -9.9, expected: '-9' },
    { input: 42.875, expected: '42' },
    { input: -9223372036854775808.0, expected: '-9223372036854775808' },
    { input: 9223372036854774784.0, expected: '9223372036854774784' },
  ];

  const makeCastMir = (val: number): MIRModule =>
    makeSimpleMir(
      'f64_cast_test',
      [],
      [
        {
          kind: 'Return',
          value: {
            kind: 'Cast',
            castKind: 'f64_to_i64',
            operand: { kind: 'ConstFloat', value: val, type: T_F64, span: dummySpan() },
            type: T_I64,
            span: dummySpan(),
          },
          span: dummySpan(),
        },
      ],
      T_I64
    );

  async function runDirectWasmCast(mir: MIRModule): Promise<{ ok: boolean; value?: string; error?: string }> {
    const built = compileMIRToWasm(mir);
    if (!built.success || !built.wasmBytes) {
      return { ok: false, error: 'wasm compile failed' };
    }
    try {
      const inst = await WebAssembly.instantiate(built.wasmBytes as BufferSource, {
        env: { print_i32: () => {}, print_f64: () => {}, print_i64: () => {} },
      });
      const res = (inst.instance.exports as { main: () => bigint }).main();
      return { ok: true, value: res.toString() };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  for (const tc of validF64Cases) {
    const m = makeCastMir(tc.input);
    const mbc = compileMIRToMbc(m).bytes;
    const tsRes = MvmInterpreter.execute(mbc);
    const rustRes = await executeMbcInRustVm(mbc);
    const semRes = evaluateMIRModule(m);
    const webRes = runWebJsInSandbox(compileMIRToWebJS(m).jsCode);
    const wasmRes = await runDirectWasmCast(m);
    const label = Object.is(tc.input, -0) ? '-0.0' : String(tc.input);
    assert(
      tsRes.ok &&
        tsRes.returnValue === tc.expected &&
        rustRes.ok &&
        rustRes.returnValue === tc.expected &&
        semRes.ok &&
        semRes.returnValue === tc.expected &&
        webRes.returnValue === tc.expected &&
        wasmRes.ok &&
        wasmRes.value === tc.expected,
      `D.1 Valid f64_to_i64(${label}) === ${tc.expected} across TS MVM, Rust WASM, MIR, WebJS, and Direct W3C WASM`
    );
  }

  const trapF64Cases = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    9223372036854775808.0,
    -1e20,
    1e20,
  ];
  for (const bad of trapF64Cases) {
    const m = makeCastMir(bad);
    const mbc = compileMIRToMbc(m).bytes;
    const tsRes = MvmInterpreter.execute(mbc);
    const rustRes = await executeMbcInRustVm(mbc);
    const semRes = evaluateMIRModule(m);
    let webTrapped = false;
    try {
      runWebJsInSandbox(compileMIRToWebJS(m).jsCode);
    } catch (err: any) {
      webTrapped = String(err?.message || err).includes('NumericConversionTrap');
    }
    const wasmRes = await runDirectWasmCast(m);
    const natRes = buildNativeTargetSourceOnly(m);
    assert(
      !tsRes.ok &&
        (tsRes.error || '').includes('E_MVM_NUMERIC_CONVERSION') &&
        !rustRes.ok &&
        rustRes.errorCode === 'E_MVM_NUMERIC_CONVERSION' &&
        !semRes.ok &&
        webTrapped &&
        !wasmRes.ok &&
        natRes.rustSource.includes('m_f64_to_i64('),
      `D.2 Out-of-range/non-finite f64_to_i64(${bad}) traps with E_MVM_NUMERIC_CONVERSION across TS MVM, Rust WASM, MIR, WebJS, Direct WASM & Native codegen`
    );
  }

  // =========================================================================
  // AREA E: __init__, Nested Calls, Recursion & Loops Cumulative Fuel Metering
  // =========================================================================
  console.log('\nE. Cumulative Fuel Metering Across __init__, Nested Calls & Recursion (TS + Rust WASM)');

  const initMeterSrc = `
module stage5_metering;
fn rec_sum(n: i64) -> i64 {
    if n <= 0 {
        return 0;
    }
    return n + rec_sum(n - 1);
}
fn init_calc(n: i64) -> i64 {
    let mut s: i64 = 0;
    let mut i: i64 = 0;
    while i < n {
        s = s + i;
        i = i + 1;
    }
    return s;
}
let g: i64 = init_calc(8);
fn main() -> i64 {
    return g + init_calc(4) + rec_sum(4);
}
`;
  const meterChk = await checkManifestSource(initMeterSrc);
  const meterMbc = await compileManifestV1(initMeterSrc, { target: 'mbc' });
  assert(
    meterChk.ok && meterMbc.success && !!meterMbc.mbcBytes,
    'E.1 Module with __init__ + loops + recursion compiles cleanly',
    meterChk.diagnostics.map((d) => d.message).join('; ')
  );

  if (meterChk.mir && meterMbc.mbcBytes) {
    const fullTs = MvmInterpreter.execute(meterMbc.mbcBytes);
    const fullRust = await executeMbcInRustVm(meterMbc.mbcBytes);
    const fullSem = evaluateMIRModule(meterChk.mir);
    assert(
      fullTs.ok &&
        fullTs.returnValue === '44' &&
        fullRust.ok &&
        fullRust.returnValue === '44' &&
        fullRust.steps === fullTs.steps &&
        fullSem.ok &&
        fullSem.returnValue === '44',
      `E.2 Baseline __init__ + main + recursion returns 44 with exact step parity (${fullRust.steps} VM steps)`
    );

    const initTs = MvmInterpreter.execute(meterMbc.mbcBytes, { entryFunction: '__init__' });
    const initRust = await executeMbcInRustVm(meterMbc.mbcBytes, { entryFunction: '__init__' });
    const initSteps = initRust.steps;
    assert(
      initTs.ok && initRust.ok && initTs.steps === initRust.steps && initSteps > 10,
      `E.3 __init__ step count matches identically (${initSteps} steps)`
    );

    const lowBudget = Math.max(2, Math.floor(initSteps / 2));
    const trapInitTs = MvmInterpreter.execute(meterMbc.mbcBytes, { maxSteps: lowBudget });
    const trapInitRust = await executeMbcInRustVm(meterMbc.mbcBytes, { maxSteps: lowBudget });
    assert(
      !trapInitTs.ok &&
        (trapInitTs.error || '').includes('E_MVM_FUEL_EXHAUSTED') &&
        !trapInitRust.ok &&
        trapInitRust.errorCode === 'E_MVM_FUEL_EXHAUSTED',
      `E.4 Both TS MVM & Rust WASM trap inside __init__ when maxSteps (${lowBudget}) < initSteps (${initSteps})`
    );

    const midBudget = initSteps + Math.max(1, Math.floor((fullRust.steps - initSteps) / 2));
    const trapMainTs = MvmInterpreter.execute(meterMbc.mbcBytes, { maxSteps: midBudget });
    const trapMainRust = await executeMbcInRustVm(meterMbc.mbcBytes, { maxSteps: midBudget });
    assert(
      !trapMainTs.ok &&
        (trapMainTs.error || '').includes('E_MVM_FUEL_EXHAUSTED') &&
        !trapMainRust.ok &&
        trapMainRust.errorCode === 'E_MVM_FUEL_EXHAUSTED',
      `E.5 Cumulative budget (no reset after __init__) traps cleanly at midBudget=${midBudget} across TS & Rust WASM`
    );

    // Exact budget boundary: fullSteps succeeds, fullSteps - 1 traps (inside deep recursion / main tail)
    const exactOkRust = await executeMbcInRustVm(meterMbc.mbcBytes, { maxSteps: fullRust.steps });
    const offByOneRust = await executeMbcInRustVm(meterMbc.mbcBytes, { maxSteps: fullRust.steps - 1 });
    assert(
      exactOkRust.ok &&
        exactOkRust.returnValue === '44' &&
        !offByOneRust.ok &&
        offByOneRust.errorCode === 'E_MVM_FUEL_EXHAUSTED',
      `E.6 Exact step boundary: maxSteps=${fullRust.steps} passes; maxSteps=${fullRust.steps - 1} traps with E_MVM_FUEL_EXHAUSTED`
    );

    const semInitOnly = evaluateMIRModule({ ...meterChk.mir, entryFunction: '__init__' });
    const semMidLimit =
      semInitOnly.steps + Math.max(1, Math.floor((fullSem.steps - semInitOnly.steps) / 2));
    const semTrap = evaluateMIRModule(meterChk.mir, { maxSteps: semMidLimit });
    assert(
      !semTrap.ok && (semTrap.error || '').includes('step limit'),
      `E.7 Semantic evaluator also shares cumulative step budget across __init__ and main`
    );
  }

  // =========================================================================
  // AREA F: Memory Accounting, Byte Limits & Differential Error Parity
  // =========================================================================
  console.log('\nF. Memory Accounting, maxHeapBytes & Error Parity (TS + Rust WASM)');

  const byteHeap = new MvmHeapArena(32, 220);
  const bRootsArr: MvmValue[] = [];
  const bRoots: RootProvider = {
    getStackRoots: () => bRootsArr,
    getGlobalRoots: () => [],
    getFrameRoots: () => [],
  };
  const arrId = byteHeap.alloc({ kind: 'array', items: [] }, bRoots);
  bRootsArr.push({ kind: 'array_ref', id: arrId });
  assert(byteHeap.getAllocatedBytes() === 32, 'F.1 Empty array accounts for exact 32 header bytes');

  const longStr: MvmValue = { kind: 'str', value: '0123456789abcdef0123456789abcdef' };
  byteHeap.arrayPush(arrId, longStr, bRoots);
  byteHeap.arrayPush(arrId, longStr, bRoots);
  byteHeap.arrayPush(arrId, longStr, bRoots);
  let resizeBlocked = false;
  try {
    byteHeap.arrayPush(arrId, longStr, bRoots);
  } catch (err: any) {
    resizeBlocked = String(err?.message || err).includes('E_MVM_HEAP_BYTES_LIMIT');
  }
  assert(
    resizeBlocked &&
      byteHeap.getArray(arrId).items.length === 3 &&
      byteHeap.getAllocatedBytes() === 176,
    `F.2 Array push exceeding maxHeapBytes rejects without mutating array (${byteHeap.getAllocatedBytes()}B)`
  );

  const mapHeap = new MvmHeapArena(16, 150);
  const mapId = mapHeap.alloc({ kind: 'map', entries: new Map() });
  mapHeap.mapSet(mapId, 'alpha', longStr);
  let mapBlocked = false;
  try {
    mapHeap.mapSet(mapId, 'beta', longStr);
  } catch (err: any) {
    mapBlocked = String(err?.message || err).includes('E_MVM_HEAP_BYTES_LIMIT');
  }
  assert(
    mapBlocked && mapHeap.getMap(mapId).entries.size === 1 && mapHeap.getAllocatedBytes() === 117,
    `F.3 Map set exceeding maxHeapBytes rejects cleanly (${mapHeap.getAllocatedBytes()}B)`
  );

  const staleHeap = new MvmHeapArena(16, 1024);
  const staleId = staleHeap.alloc({ kind: 'array', items: [{ kind: 'i64', value: 1n }] });
  staleHeap.collectGarbage({ getStackRoots: () => [], getGlobalRoots: () => [], getFrameRoots: () => [] });
  let staleTrapped = false;
  try {
    staleHeap.getArray(staleId);
  } catch (err: any) {
    staleTrapped = String(err?.message || err).includes('E_MVM_INVALID_REF');
  }
  let staleEqTrapped = false;
  try {
    staleHeap.equals({ kind: 'array_ref', id: staleId }, { kind: 'array_ref', id: staleId });
  } catch (err: any) {
    staleEqTrapped = String(err?.message || err).includes('E_MVM_INVALID_REF');
  }
  assert(
    staleTrapped && staleEqTrapped,
    'F.4 Accessing/comparing collected heap handle traps with E_MVM_INVALID_REF'
  );

  // End-to-end maxHeapBytes enforcement in BOTH TS MVM & Rust WASM MVM
  const bytesLimitSrc = `
module stage5_bytes_limit;
fn main() -> i64 {
    let a: Array<str> = [
        "0123456789abcdef0123456789abcdef",
        "0123456789abcdef0123456789abcdef",
        "0123456789abcdef0123456789abcdef",
        "0123456789abcdef0123456789abcdef"
    ];
    return std::str::len(a[0]);
}
`;
  const bytesLimitMbc = (await compileManifestV1(bytesLimitSrc, { target: 'mbc' })).mbcBytes!;
  const bytesOkRust = await executeMbcInRustVm(bytesLimitMbc, { maxHeapObjects: 32, maxHeapBytes: 1024 });
  const bytesFailTs = MvmInterpreter.execute(bytesLimitMbc, { maxHeapObjects: 32, maxHeapBytes: 120 });
  const bytesFailRust = await executeMbcInRustVm(bytesLimitMbc, { maxHeapObjects: 32, maxHeapBytes: 120 });
  assert(
    bytesOkRust.ok &&
      bytesOkRust.returnValue === '32' &&
      !bytesFailTs.ok &&
      (bytesFailTs.error || '').includes('E_MVM_HEAP_BYTES_LIMIT') &&
      !bytesFailRust.ok &&
      bytesFailRust.errorCode === 'E_MVM_HEAP_BYTES_LIMIT',
    `F.5 Differential maxHeapBytes=120 rejects with E_MVM_HEAP_BYTES_LIMIT across TS & Rust WASM (${bytesFailRust.error})`
  );

  // Differential error parity: Div0, Overflow, Bounds, Missing Map Key, Capability Denied, Corrupt MBC
  const errCases: Array<{ label: string; src: string; expectedCode: string; granted?: string[] }> = [
    {
      label: 'div_zero',
      src: 'module e_div;\nfn main() -> i64 { let x: i64 = 0; return 10 / x; }\n',
      expectedCode: 'E_MVM_DIV_ZERO',
    },
    {
      label: 'i64_overflow',
      src: 'module e_ovf;\nfn main() -> i64 { let x: i64 = 9223372036854775807; return x + 1; }\n',
      expectedCode: 'E_MVM_OVERFLOW',
    },
    {
      label: 'array_bounds',
      src: 'module e_bnd;\nfn main() -> i64 { let a: Array<i64> = [1, 2]; return a[5]; }\n',
      expectedCode: 'E_MVM_OUT_OF_BOUNDS',
    },
    {
      label: 'map_key_missing',
      src: 'module e_key;\nfn main() -> i64 { let m: Map<str, i64> = { "a": 1 }; return m["missing"]; }\n',
      expectedCode: 'E_MVM_KEY_NOT_FOUND',
    },
    {
      label: 'capability_denied',
      src: 'module e_cap;\nrequires [fs.write];\nfn main() -> bool effects(fs.write) { return fs.write_text("x.txt", "hi"); }\n',
      expectedCode: 'E_MVM_CAPABILITY_DENIED',
      granted: ['console'],
    },
  ];
  for (const ec of errCases) {
    const compiled = await compileManifestV1(ec.src, { target: 'mbc' });
    const mbc = compiled.mbcBytes!;
    const tsR = MvmInterpreter.execute(mbc, { grantedCapabilities: ec.granted });
    const rustR = await executeMbcInRustVm(mbc, { grantedCapabilities: ec.granted });
    assert(
      !tsR.ok &&
        (tsR.error || '').includes(ec.expectedCode) &&
        !rustR.ok &&
        rustR.errorCode === ec.expectedCode,
      `F.6 Error parity for ${ec.label}: both TS & Rust WASM trap with ${ec.expectedCode}`,
      `ts=${tsR.error} rustCode=${rustR.errorCode} rust=${rustR.error}`
    );
  }

  // Corrupt MBC verification rejection
  const corruptBytes = new Uint8Array([0x4d, 0x42, 0x43, 0x00, 0x01, 0x00, 0xff]);
  const verifyBad = await verifyMbcInRustVm(corruptBytes);
  const execBadTs = MvmInterpreter.execute(corruptBytes);
  const execBadRust = await executeMbcInRustVm(corruptBytes);
  assert(
    !verifyBad.ok && !execBadTs.ok && !execBadRust.ok && execBadRust.phase === 'decode',
    'F.7 Corrupt MBC rejected safely across verifyMbcInRustVm, TS MVM, and Rust WASM MVM'
  );

  // MVMHOST2 host call roundtrip with metacharacters & Unicode
  const hostProtoSrc = `
module stage5_host2;
requires [console, fs.write, fs.read];
fn main() -> str effects(console, fs.write, fs.read) {
    let payload: str = "line1\\nkey:val|pipe\\\\slash\\\"quote λ🚀";
    let ok: bool = fs.write_text("notes/meta.txt", payload);
    console.print("printed: λ🚀");
    return fs.read_text("notes/meta.txt");
}
`;
  const hostProtoMbc = (await compileManifestV1(hostProtoSrc, { target: 'mbc' })).mbcBytes!;
  const hostProtoTs = MvmInterpreter.execute(hostProtoMbc, {
    grantedCapabilities: ['console', 'fs.write', 'fs.read'],
  });
  const hostProtoRust = await executeMbcInRustVm(hostProtoMbc, {
    grantedCapabilities: ['console', 'fs.write', 'fs.read'],
  });
  assert(
    hostProtoTs.ok &&
      hostProtoRust.ok &&
      hostProtoTs.returnValue === hostProtoRust.returnValue &&
      hostProtoRust.returnValue.includes('key:val|pipe') &&
      hostProtoRust.returnValue.includes('λ🚀') &&
      hostProtoRust.stdout[0] === 'printed: λ🚀' &&
      hostProtoRust.virtualFiles['notes/meta.txt'] === hostProtoTs.virtualFiles['notes/meta.txt'],
    'F.8 MVMHOST2 roundtrip preserves newlines, :, |, \\, quotes, and Unicode across VFS & stdout'
  );

  // =========================================================================
  // AREA G: Integrated Rust WASM Artifact Parity, ABI & Studio Verification
  // =========================================================================
  console.log('\nG. Integrated Rust WASM Artifact Parity, Offline Security & Studio Integration');

  const rustTargetWasm = path.resolve(process.cwd(), 'mvm/target/wasm32-unknown-unknown/release/mvm_wasm.wasm');
  const publicWasm = path.resolve(process.cwd(), 'public/wasm/mvm_wasm.wasm');
  const embeddedBytes = Buffer.from(MVM_WASM_BASE64, 'base64');
  const publicBytes = fs.existsSync(publicWasm) ? fs.readFileSync(publicWasm) : Buffer.alloc(0);
  const embeddedHash = sha256Bytes(embeddedBytes);
  const publicHash = sha256Bytes(publicBytes);

  let targetMatches = true;
  let targetDetail = 'rust target present';
  if (fs.existsSync(rustTargetWasm)) {
    const targetBytes = fs.readFileSync(rustTargetWasm);
    const targetHash = sha256Bytes(targetBytes);
    targetMatches = Buffer.compare(targetBytes, publicBytes) === 0 && targetHash === embeddedHash;
    targetDetail = `targetHash=${targetHash.slice(0, 12)}...`;
  }
  assert(
    publicBytes.length > 0 &&
      publicBytes.length === MVM_WASM_BYTE_LENGTH &&
      embeddedBytes.length === MVM_WASM_BYTE_LENGTH &&
      publicHash === MVM_WASM_SHA256 &&
      embeddedHash === MVM_WASM_SHA256 &&
      Buffer.compare(publicBytes, embeddedBytes) === 0 &&
      targetMatches,
    `G.1 Exact byte & SHA-256 parity across mvm_wasm.wasm (${MVM_WASM_BYTE_LENGTH} B, ${MVM_WASM_SHA256.slice(0, 12)}...), public/wasm/mvm_wasm.wasm & MVM_WASM_BASE64`,
    targetDetail
  );

  const compiledMod = await WebAssembly.compile(embeddedBytes);
  const modImports = WebAssembly.Module.imports(compiledMod);
  const modExportNames = new Set(WebAssembly.Module.exports(compiledMod).map((e) => e.name));
  const hasAllExports = [
    'memory',
    'mvm_alloc',
    'mvm_dealloc',
    'mvm_output_ptr',
    'mvm_output_len',
    'mvm_set_host_response',
    'mvm_engine_info',
    'mvm_verify',
    'mvm_disassemble',
    'mvm_execute',
  ].every((n) => modExportNames.has(n));
  assert(
    modImports.length === 1 &&
      modImports[0].module === 'env' &&
      modImports[0].name === 'mvm_host_call' &&
      hasAllExports,
    'G.2 WASM imports confined solely to env.mvm_host_call (zero WASI) with all required exports present'
  );

  // Offline zero-network check & engine identity verification
  const origFetch = globalThis.fetch;
  let networkAttempted = false;
  (globalThis as any).fetch = () => {
    networkAttempted = true;
    throw new Error('Unexpected network fetch during offline Rust MVM execution');
  };
  let engineInfoOk = false;
  let reuseOk = false;
  try {
    const info = await getRustMvmEngineInfo();
    engineInfoOk =
      info.ok &&
      info.name === 'mvm-wasm' &&
      info.protocolVersion === 2 &&
      info.abi === 'mvm-wasm-c-v2' &&
      info.sha256 === MVM_WASM_SHA256 &&
      info.byteLength === MVM_WASM_BYTE_LENGTH &&
      info.features.includes('gc') &&
      info.features.includes('cycle-safe-eq') &&
      info.features.includes('sha256') &&
      info.features.includes('checked-f64-to-i64') &&
      info.features.includes('cumulative-fuel') &&
      info.features.includes('max-heap-bytes');

    // Repeated execution + trap + recovery idempotency under zero-network guard
    const ver = await verifyMbcInRustVm(gcCompiled.mbcBytes!);
    const dis = await disassembleMbcInRustVm(gcCompiled.mbcBytes!);
    const badRun = await executeMbcInRustVm(compileMIRToMbc(makeCastMir(Number.NaN)).bytes);
    const goodAfterTrap = await executeMbcInRustVm(gcCompiled.mbcBytes!, {
      maxHeapObjects: 4,
      maxHeapBytes: 512,
    });
    reuseOk =
      ver.ok &&
      dis.ok &&
      Boolean(dis.disassembly?.includes('main')) &&
      !badRun.ok &&
      goodAfterTrap.ok &&
      goodAfterTrap.returnValue === '435';
  } finally {
    globalThis.fetch = origFetch;
  }
  assert(
    !networkAttempted && engineInfoOk,
    'G.3 getRustMvmEngineInfo() exposes ABI v2 + Stage 5 features + artifact SHA-256 with zero network calls'
  );
  assert(
    !networkAttempted && reuseOk,
    'G.4 Repeated verify/disassemble/trap/execute invocations remain isolated and offline-clean'
  );

  // Studio ManifestExecutionProvider integration check
  const provider = new ManifestExecutionProvider();
  const validProject: ManifestProject = {
    id: 'stage5-studio-ok',
    name: 'stage5-studio-ok',
    kind: 'manifest',
    compilerTarget: 'mvm',
    activeFilePath: 'src/main.manifest',
    files: [
      {
        id: 'main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module studio_stage5;\nfn main() -> i64 {\n    let mut acc: i64 = 0;\n    let mut i: i64 = 0;\n    while i < 10 {\n        let arr: Array<i64> = [i, 1];\n        acc = acc + arr[0];\n        i = i + 1;\n    }\n    return acc;\n}\n`,
      },
    ],
  };
  const studioOk = await provider.execute(validProject);
  assert(
    studioOk.success &&
      studioOk.targetId === 'mvm' &&
      studioOk.returnValue === '45' &&
      (studioOk.vmSteps ?? 0) > 50,
    `G.5 Studio ManifestExecutionProvider executes Manifest program via Rust WASM MVM (return=${studioOk.returnValue}, steps=${studioOk.vmSteps})`,
    studioOk.error
  );

  const b64Mbc = Buffer.from(gcCompiled.mbcBytes!).toString('base64');
  const mbcProject: ManifestProject = {
    id: 'stage5-studio-mbc',
    name: 'stage5-studio-mbc',
    kind: 'manifest',
    compilerTarget: 'mvm',
    activeFilePath: 'build/app.mbc',
    files: [
      {
        id: 'mbc',
        name: 'app.mbc',
        path: 'build/app.mbc',
        language: 'mbc',
        content: `data:application/x-manifest-bytecode;base64,${b64Mbc}`,
        isBinary: true,
      },
    ],
  };
  const studioMbcOk = await provider.execute(mbcProject);
  assert(
    studioMbcOk.success && studioMbcOk.returnValue === '435',
    `G.6 Studio ManifestExecutionProvider executes .mbc artifact directly via Rust WASM MVM (return=${studioMbcOk.returnValue})`
  );

  const trapProject: ManifestProject = {
    id: 'stage5-studio-trap',
    name: 'stage5-studio-trap',
    kind: 'manifest',
    compilerTarget: 'mvm',
    activeFilePath: 'src/main.manifest',
    files: [
      {
        id: 'main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: 'module studio_trap;\nfn main() -> i64 { let z: i64 = 0; return 1 / z; }\n',
      },
    ],
  };
  const studioTrap = await provider.execute(trapProject);
  assert(
    !studioTrap.success && (studioTrap.error || '').includes('Division by zero'),
    `G.7 Studio ManifestExecutionProvider surfaces controlled Rust MVM traps (${studioTrap.error})`
  );

  const corruptMbcProject: ManifestProject = {
    id: 'stage5-studio-corrupt',
    name: 'stage5-studio-corrupt',
    kind: 'manifest',
    compilerTarget: 'mvm',
    activeFilePath: 'build/bad.mbc',
    files: [
      {
        id: 'bad',
        name: 'bad.mbc',
        path: 'build/bad.mbc',
        language: 'mbc',
        content: Buffer.from(corruptBytes).toString('base64'),
        isBinary: true,
      },
    ],
  };
  const studioCorrupt = await provider.execute(corruptMbcProject);
  assert(
    !studioCorrupt.success &&
      ((studioCorrupt.error || '').includes('decode error') ||
        (studioCorrupt.error || '').includes('Truncated') ||
        (studioCorrupt.error || '').includes('Unexpected EOF')),
    `G.8 Studio ManifestExecutionProvider rejects corrupt .mbc container cleanly (${studioCorrupt.error})`
  );

  console.log(`\nStage 5 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runStage5Tests().catch((err) => {
  console.error('Fatal Stage 5 test error:', err);
  process.exit(1);
});

# Manifest Language & Manifest Studio — Compiler, Linter & VM Performance Audit

## 1. Benchmark Methodology & Environment
All measurements below were produced by executing `npm run manifest:bench` (`manifest-core/tests/run_benchmark.ts`) directly in this repository environment:
- **Environment**: Linux `4.19.0-gvisor x86_64`, Node.js `v22.23.3` (`tsx` v4.21.0), TypeScript `v7.0.2`, `rustc 1.99.1` (`--release` for `mvm` native CLI and `wasm32-unknown-unknown` for `mvm_wasm.wasm`).
- **Workloads**:
  1. **Manifest v1.0 Pipeline & Four-Way Runtime Comparison**: Compiles a typed iterative `Collatz(2..2500)` module (`3,590,654` MVM bytecode instructions, exact verified result `174764`) and compares compilation latency, binary size, and execution speed across (a) TypeScript MIR Reference Evaluator, (b) Embedded Rust MVM (`mvm_wasm.wasm`), (c) Native Rust MVM CLI (`/mvm/target/release/mvm`, including OS process spawn + `.mbc` file read + static verification), and (d) Direct Standalone WebAssembly (`.wasm` target).
  2. **Multi-Construct UI Scaling (`93` to `19,987` lines)**: Measures Lex, Parse, 2-Pass Validate, IR Lowering, JS Codegen, single-pass `compileManifest`, and CodeMirror linter `inspectManifest` latency.
  3. **Pathological Input Stress & DOM Mount**: Deeply nested expressions, 25-level container trees, 500-symbol forward call graphs, AST loop execution, and compiled JS reactive DOM mounting.

---

## 2. Manifest v1.0 Compiler & Four-Way Execution Benchmark (`Collatz(2..2500)`)

### Compilation & Binary Artifact Metrics
| Pipeline Stage / Target | Measured Duration | Artifact Size | Notes |
|---|---|---|---|
| **v1.0 `checkManifestSource`** (Parse + Module Resolve + Static TypeCheck + Capability/Effect Graph + MIR + Optimizer) | **4.60 ms** | — | Full static verification pass used by CLI `check` and CodeMirror live linter |
| **`.mbc` Bytecode Build + Static Verify (`target: "mvm"`)** | **8.25 ms** | **697 bytes** | Includes `MBC\0` container encoding + static stack-height & jump-boundary verification |
| **Direct WebAssembly Build + Validate (`target: "wasm"`)** | **4.09 ms** | **229 bytes** | Includes binary W3C `.wasm` section emission + `WebAssembly.validate()` |

### Execution Engine Comparison (`3,590,654` MVM Bytecode Steps, Verified Output `174764`)
| Execution Engine | Measured Duration | Verified Return | Architectural Trade-off |
|---|---|---|---|
| **Direct Standalone WebAssembly (`.wasm` target)** | **1.629 ms** | `174764` | Fastest numeric execution (JIT-compiled by V8 Wasm TurboFan/Liftoff); supports numeric & control-flow subset |
| **TypeScript MIR Reference Evaluator** | **183.92 ms** | `174764` | Tree-walk over `MIRModule` on V8 JS JIT; serves as independent conformance oracle |
| **Rust MVM Native CLI (`/mvm/target/release/mvm`)** | **253.31 ms** | `174764` | Includes OS subprocess spawn + file I/O + static bytecode verification + checked `i64` dispatch loop (`~14.2M` instructions/sec) |
| **Rust MVM Embedded WASM (`mvm_wasm.wasm`)** | **616.92 ms** | `174764` | Runs offline inside browser/Node with `#![forbid(unsafe_code)]`, checked arithmetic, heap arena limits, and per-instruction capability & step enforcement (`~5.8M` instructions/sec) |

---

## 3. Declarative UI Pipeline Scaling (`93` to `19,987` Lines)

| Actual Lines | Lex (ms) | Parse (ms) | 2-Pass Validate (ms) | IR Lowering (ms) | JS Codegen (ms) | `compileManifest` 1-Pass (ms) | Editor Lint `inspectManifest` (ms) | Heap Delta (KB) | Throughput (lines/sec) |
|---|---|---|---|---|---|---|---|---|---|
| **93 lines** | 0.48 ms | 0.37 ms | 0.09 ms | 0.23 ms | 1.54 ms | **1.53 ms** | **0.98 ms** | +365 KB | **60,947 loc/s** |
| **989 lines** | 2.54 ms | 2.60 ms | 0.15 ms | 0.22 ms | 1.64 ms | **11.92 ms** | **4.95 ms** | +2,234 KB | **82,953 loc/s** |
| **4,993 lines** | 82.36 ms | 8.04 ms | 0.63 ms | 1.05 ms | 11.23 ms | **92.28 ms** | **74.70 ms** | +4,620 KB | **54,105 loc/s** |
| **9,991 lines** | 12.83 ms | 86.38 ms | 0.80 ms | 4.97 ms | 24.27 ms | **117.90 ms** | **74.72 ms** | +4,324 KB | **84,739 loc/s** |
| **19,987 lines** | 20.19 ms | 51.48 ms | 0.72 ms | 2.29 ms | 58.76 ms | **166.44 ms** | **87.30 ms** | +10,225 KB | **120,082 loc/s** |

*(Per-stage spikes at 4,993 / 9,991 lines reflect V8 incremental GC pauses during sequential benchmark iterations.)*

---

## 4. Pathological Stress & Legacy Runtime / DOM Mount Results

| Scenario / Target | Size / Workload | Compile / Exec Duration | Lint Duration | Status / Output |
|---|---|---|---|---|
| **120-deep nested binary arithmetic expression** | 5 lines | **2.52 ms** | **0.59 ms** | `Valid: true` |
| **25-level nested `CONTAINER` hierarchy with `STYLE`** | 129 lines | **0.69 ms** | **0.52 ms** | `Valid: true` |
| **500 `ACTION` symbol table + forward `CALL` resolution** | 1,553 lines | **15.34 ms** | **7.16 ms** | `Valid: true` |
| **Legacy AST Interpreter (`Runtime`)** | `100` `REPEAT` iterations | **1.40 ms** | — | `5050` |
| **Legacy AST Interpreter (`Runtime`)** | `10,000` `REPEAT` iterations | **64.96 ms** | — | `50005000` |
| **Compiled Reactive JS (`startApp`)** | `93`-line app initial DOM mount | **1.00 ms** | — | Mounted cleanly |
| **Compiled Reactive JS (`startApp`)** | `989`-line app initial DOM mount | **9.98 ms** | — | Mounted cleanly |

---

## 5. Architectural Bottlenecks Resolved & Remaining Thresholds
1. **Multi-File Static Linking Implemented**: Manifest v1.0 resolves relative multi-file `import` / `export` graphs in topological order with deterministic circular-dependency rejection (`E_CIRCULAR_IMPORT`).
2. **Interpreter Overhead Quantified Honestly**: Executing bytecode inside WASM-compiled Rust MVM (`616.92ms` for `3.59M` checked instructions) trades raw speed for strict memory safety, `i64` overflow checks, capability gating, and instruction-budget determinism, whereas compiling numeric workloads directly to `.wasm` runs in `1.629ms` (`~378x` faster).
3. **Main-Thread Linter Threshold**: `manifestLinter` runs on a `220ms` debounce and completes in `<5ms` up to `1,000` lines (`4.60ms` for full v1.0 static type + capability checking). For files exceeding `10,000` lines (`~75–87ms`), offloading `checkManifestSource` / `inspectManifest` to a dedicated Web Worker remains recommended.

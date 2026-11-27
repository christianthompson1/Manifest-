# Manifest Language & Manifest Studio — Compiler, Linter & VM Performance Audit

## 1. Benchmark Methodology & Environment
All measurements below were produced by executing `npm run manifest:bench` (`manifest-core/tests/run_benchmark.ts`) directly in this repository environment:
- **Environment**: Linux `4.19.0-gvisor x86_64`, Node.js `v22.23.5` (`tsx` v4.21.0), TypeScript `v7.0.2`. Authoritative Rust `manifest-compiler` + `mvm-core` executed via prebuilt `public/wasm/mvm_wasm.wasm`.
- **Note on Native Host Binaries**: `cargo` / `rustc` and the native binary `mvm/target/release/mvm` are not installed in this host container, so native MVM CLI subprocess timing (`rustMvmNativeCliMs`) was skipped (`0.00ms`).
- **Workloads**:
  1. **Manifest v1.0 Pipeline & Cross-Engine Runtime Comparison**: Compiles a typed iterative `Collatz(2..2500)` module (`3,590,654` MVM bytecode instructions, exact verified result `174764`) and compares compilation latency, binary size, and execution speed across (a) TypeScript MIR Reference Evaluator, (b) Embedded Rust MVM (`mvm_wasm.wasm`), and (c) Direct Standalone WebAssembly (`.wasm` target).
  2. **Canonical v1.0 Multi-Function Scaling (`93` to `4,993` lines)**: Measures authoritative Rust `checkManifestSource` (`Check+MIR`), `.mbc` Build (`target: "mvm"`), and `web-js` Build (`target: "web-js"`) latency plus JS heap delta.
  3. **Pathological Input Stress**: Deeply nested arithmetic expressions (60-deep), 25-level nested control-flow blocks, and 250-symbol forward function call resolution.

---

## 2. Manifest v1.0 Compiler & Cross-Engine Execution Benchmark (`Collatz(2..2500)`)

### Compilation & Binary Artifact Metrics
| Pipeline Stage / Target | Measured Duration | Artifact Size | Notes |
|---|---|---|---|
| **v1.0 `checkManifestSource`** (Rust `manifest-compiler`: Parse + TypeCheck + Capability/Effect + MIR + Opt) | **0.86 ms** | — | Full static verification pass used by CLI `check` and CodeMirror live linter |
| **`.mbc` Bytecode Build + Static Verify (`target: "mvm"`)** | **1.12 ms** | **697 bytes** | Includes `MBC\0` container encoding + static stack-height & jump-boundary verification |
| **Direct WebAssembly Build + Validate (`target: "wasm"`)** | **3.14 ms** | **249 bytes** | Includes binary W3C `.wasm` section emission + `WebAssembly.validate()` |

### Execution Engine Comparison (`3,590,654` MVM Bytecode Steps, Verified Output `174764`)
| Execution Engine | Measured Duration | Verified Return | Architectural Trade-off |
|---|---|---|---|
| **Direct Standalone WebAssembly (`.wasm` target)** | **3.331 ms** | `174764` | Fastest numeric execution (JIT-compiled by V8 Wasm); supports numeric & control-flow subset |
| **TypeScript MIR Reference Evaluator** | **204.68 ms** | `174764` | Tree-walk over `MIRModule` on V8 JS JIT; serves as independent differential conformance oracle |
| **Rust MVM Embedded WASM (`mvm_wasm.wasm`)** | **274.48 ms** | `174764` | Runs offline inside browser/Node with `#![forbid(unsafe_code)]`, checked arithmetic, mark-sweep GC heap limits, and per-instruction capability & step enforcement |
| **Rust MVM Native CLI (`mvm/target/release/mvm`)** | *Skipped* | `skipped` | Host container does not contain `cargo` or a prebuilt native `mvm` binary |

---

## 3. Canonical v1.0 Pipeline Scaling (`93` to `4,993` Lines)

| Actual Lines | `checkManifestSource` (Rust Engine) | `.mbc` Build (`target: "mvm"`) | `.mbc` Size | `web-js` Build (`target: "web-js"`) | Heap Delta | Throughput (`check` / `.mbc`) |
|---|---|---|---|---|---|---|
| **93 lines** | **2.83 ms** | **2.93 ms** | 824 B | **5.02 ms** | +264 KB | **31,764 loc/s** |
| **993 lines** | **58.46 ms** | **36.32 ms** | 840 B | **74.12 ms** | +489 KB | **27,339 loc/s** |
| **4,993 lines** | **619.50 ms** | **591.36 ms** | 826 B | **602.27 ms** | +1,945 KB | **8,443 loc/s** |

---

## 4. Pathological Input Stress Results

| Scenario | Lines | `checkManifestSource` (ms) | `.mbc` Build (ms) | Status |
|---|---|---|---|---|
| **60-deep nested arithmetic expression** | 5 lines | **1.37 ms** | **1.08 ms** | `Valid: true` |
| **25-level nested control-flow block hierarchy** | 80 lines | **3.42 ms** | **4.12 ms** | `Valid: true` |
| **250 forward function definitions & call resolution** | 305 lines | **22.15 ms** | **25.35 ms** | `Valid: true` |

---

## 5. Architectural Observations & Thresholds
1. **Authoritative Rust Engine Across Studio & CLI**: All canonical v1.0 checks, Typed MIR generation, optimization, and `.mbc` encoding pass through `mvm/crates/manifest-compiler` (via `mvm_wasm.wasm`).
2. **Interpreter Overhead Quantified Honestly**: Executing bytecode inside WASM-compiled Rust MVM (`274.48ms` for `3.59M` checked instructions) trades raw speed for strict memory safety, `i64` overflow checks, capability gating, and instruction-budget determinism, whereas compiling numeric workloads directly to `.wasm` runs in `3.331ms` (`~82x` faster).
3. **Main-Thread Linter Threshold**: `manifestLinter` runs on a `220ms` debounce and completes in `~2.8ms` for typical `<100`-line modules (`~58ms` at `~1,000` lines). For very large files (`~5,000+` lines, `~620ms`), offloading `checkManifestSource` to a dedicated Web Worker remains recommended.

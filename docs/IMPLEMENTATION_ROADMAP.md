# Manifest & Manifest Studio — Implementation Roadmap

This roadmap records verified deliverables implemented in the repository alongside partial capabilities and planned future work.

## Status Legend
- **[VERIFIED]**: Implemented in production source code and verified by automated tests (`cargo test`, `npm run manifest:test`, `npm run lint`, `npm run build`).
- **[PARTIAL]**: Implemented and verified within an explicit, documented scope boundary.
- **[PLANNED]**: Specified in architecture / target registry, not yet implemented.

---

## 1. Dual-Profile Language Core, Static Types & Capability Verification
- **Status**: **[VERIFIED]**
- **Delivered**:
  - Beginner Profile (`BeginnerParser`) and Professional Profile (`ProfessionalParser`) normalizing to `SemanticModule` (`ast-v2.ts`), plus lossless cross-profile formatting (`formatter.ts`).
  - Multi-file `import`/`export` module graph resolution with private-symbol and cycle rejection (`module-resolver.ts`).
  - Static `TypeChecker` with primitive types (`i64`, `f64`, `bool`, `str`, `void`), generics (`<T>`), structs, algebraic enums, `Result<T, E>`, `?` propagation, `Array<T>`, `Map<K, V>`, mutability checks, and `match` exhaustiveness checking.
  - Transitive call-graph `Capability & Effect Analyzer` enforcing `requires`, `provides`, `denies`, and per-function `effects(...)`.
- **Remaining / Future**:
  - Dynamic trait object dispatch (`dyn Trait`) and user-defined `impl Trait for Struct` method blocks (currently `trait` interface declarations are parsed and type-checked).
  - First-class lexical closures capturing mutable outer locals on the `.mbc` heap.

---

## 2. Typed Manifest IR, Binary `.mbc` v1.0 & Rust Virtual Machine (`mvm`)
- **Status**: **[VERIFIED]**
- **Delivered**:
  - Target-independent `MIRModule` (`typed-ir.ts`, `typed-ir-builder.ts`) with overflow-safe constant folding, algebraic simplification, dead-branch elimination, and unreachable-code diagnostics (`ir-optimizer.ts`).
  - Binary `.mbc` v1.0 compiler, reader, disassembler, and static abstract-stack/jump verifier (`manifest-core/src/bytecode/`).
  - Memory-safe Rust Virtual Machine (`mvm/crates/mvm-core`, `#![forbid(unsafe_code)]`) compiled to both native CLI (`mvm/target/release/mvm`) and WebAssembly (`public/wasm/mvm_wasm.wasm`) with step, call-depth, and heap bounds plus runtime capability enforcement.

---

## 3. Multi-Target Compilation Backends
- **Status**: **[VERIFIED]** (`mvm`, `web-js`) / **[PARTIAL]** (`wasm`, `native`, `solana-sbf`) / **[PLANNED]** (`evm-solidity`, `move`, `ton-tact`)
- **Delivered**:
  - **`mvm`**: Full v1.0 language support -> verified `.mbc` bytecode.
  - **`web-js`**: Both reactive UI (`APP`/`PAGE`) and capability-sandboxed v1.0 ES modules (blocking `fetch`/`WebSocket`/`XHR` when `net` is not granted).
  - **`wasm` ([PARTIAL])**: Direct W3C `.wasm` + `.wat` emission for numeric/boolean functions, globals, recursion, loops, and numeric console output. Heap-allocated strings/structs/enums require `mvm` or future linear-memory GC/WasmGC lowering.
  - **`native` ([PARTIAL])**: Emits standalone `#![forbid(unsafe_code)]` Rust source (`build/<mod>.rs`) in Studio and invokes host `rustc` in CLI builds to emit real native executables; browser sandboxes cannot link or execute native OS binaries directly.
  - **`solana-sbf` ([PARTIAL])**: Anchor Rust (`lib.rs`) + IDL (`idl.json`) codegen and local LiteSVM / `SolanaSimulator` verification; compiling deployable `.so` SBF binaries requires external `cargo-build-sbf`.
  - **`evm-solidity`, `move`, `ton-tact` ([PLANNED])**: Explicitly marked `Planned` in CLI and disabled in Studio UI.

---

## 4. Manifest Studio IDE, Inspector & Persistence
- **Status**: **[VERIFIED]**
- **Delivered**:
  - Visible **Syntax Profile** (`Auto` / `Beginner` / `Professional`), **Format**, and **Compiler Target** selectors in header and Project Settings.
  - Separated **Run** vs **Build** actions persisting real `build/*.mbc`, `build/*.disasm.txt`, `build/*.wasm`, `build/*.wat`, and `build/*.rs` artifacts into the workspace explorer.
  - Developer Inspector tabs for **Bytecode (.mbc)**, **Capabilities**, and **Typed IR**, plus direct execution of `.mbc` binary files in the editor.
  - CodeMirror 6 dual-profile syntax highlighting, completions, hover tooltips (`manifestHoverTooltip`), live type/capability squiggles (`manifestLinter`), dirty-tab indicators, IndexedDB multi-project storage, and binary-safe ZIP import/export (`.mbc`, `.wasm`, images).

---

## 5. Offline PWA Cold-Reload & Additional Runtimes
- **Status**: **[PARTIAL]**
- **Delivered**:
  - Complete post-load offline compilation and execution across Rust MVM (`mvm_wasm.wasm`), Direct `.wasm`, Web/JS, Static Web, and Solana simulation with zero network dependencies.
- **Planned**:
  - Service Worker (`sw.js`) registration for cold offline browser tab reloads.
  - Opt-in downloadable WebAssembly runtimes (e.g., Pyodide for Python) via dedicated `ExecutionProvider` plugins.

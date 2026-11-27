# Manifest & Manifest Studio — Implementation Roadmap

This roadmap records verified deliverables implemented in the repository alongside partial capabilities and planned future work.

## Status Legend
- **[VERIFIED]**: Implemented in production source code and verified by automated tests (`cargo test`, `npm run manifest:test`, `npm run lint`, `npm run build`).
- **[PARTIAL]**: Implemented and verified within an explicit, documented scope boundary.
- **[PLANNED]**: Specified in architecture / target registry, not yet implemented.

---

## 1. Dual-Profile Language Core, Authoritative Rust Compiler & Capability Verification
- **Status**: **[VERIFIED]**
- **Delivered**:
  - Authoritative Rust compiler (`mvm/crates/manifest-compiler`, exported via `mvm-wasm` and `mvm-cli`) owning Beginner & Professional parsing, multi-file `import`/`export` linking (`E_IMPORT_PRIVATE_SYMBOL`, `E_CIRCULAR_IMPORT`), static `TypeChecker`, fixed-point transitive `Capability & Effect Analyzer`, Typed MIR lowering/optimization, and `.mbc` v1.0 bytecode compilation.
  - Lossless cross-profile formatting (`Beginner <-> Professional`), plus explicit removal of legacy v0.x syntax (`APP`/`PAGE`/`STATE`/`ACTION`/`USE WEB`/`USE SOLANA`) with `E_LEGACY_V0_REMOVED` and opt-in `manifest migrate`.
  - Static `TypeChecker` with primitive types (`i64`, `f64`, `bool`, `str`, `void`), generics (`<T>`), structs, algebraic enums, `Result<T, E>`, `?` propagation, `Array<T>`, `Map<K, V>`, mutability checks, and `match` exhaustiveness checking.
- **Remaining / Future**:
  - Dynamic trait object dispatch (`dyn Trait`) and user-defined `impl Trait for Struct` method blocks (currently `trait` declarations are explicitly rejected at type checking with `E_UNSUPPORTED_FEATURE`).
  - First-class lexical closures capturing mutable outer locals on the `.mbc` heap.

---

## 2. Typed Manifest IR, Binary `.mbc` v1.0 & Rust Virtual Machine (`mvm`)
- **Status**: **[VERIFIED]**
- **Delivered**:
  - Target-independent `MIRModule` (`typed-ir.ts`, `manifest-compiler`) with overflow-safe constant folding, algebraic simplification, dead-branch elimination, and unreachable-code diagnostics.
  - Binary `.mbc` v1.0 compiler, reader, disassembler, and static abstract-stack/jump verifier (`manifest-core/src/bytecode/` and `mvm-core`).
  - Memory-safe Rust Virtual Machine (`mvm/crates/mvm-core`, `#![forbid(unsafe_code)]`) compiled to both native CLI (`mvm-cli`) and WebAssembly (`public/wasm/mvm_wasm.wasm`) with step, call-depth, and heap bounds plus runtime capability enforcement.

---

## 3. Multi-Target Compilation Backends
- **Status**: **[VERIFIED]** (`mvm`, `web-js`) / **[PARTIAL]** (`wasm`, `native`, `solana-sbf`) / **[PLANNED]** (`evm-solidity`, `move`, `ton-tact`)
- **Delivered**:
  - **`mvm`**: Full v1.0 language support -> verified `.mbc` bytecode.
  - **`web-js`**: Capability-sandboxed v1.0 ES modules (`__runManifestModule()`, blocking `fetch`/`WebSocket`/`XHR` when `net` is not granted).
  - **`wasm` ([PARTIAL])**: Direct W3C `.wasm` + `.wat` emission for numeric/boolean functions, globals, recursion, loops, and numeric console output. Heap-allocated strings/structs/enums require `mvm` or future linear-memory GC/WasmGC lowering.
  - **`native` ([PARTIAL])**: Emits standalone `#![forbid(unsafe_code)]` Rust source (`build/<mod>.rs`) in Studio and invokes host `rustc` in CLI builds to emit real native executables; browser sandboxes cannot link or execute native OS binaries directly.
  - **`solana-sbf` ([PARTIAL])**: Standalone `PROGRAM ... END` parser -> Anchor Rust (`lib.rs`) + IDL (`idl.json`) codegen and local LiteSVM / `SolanaSimulator` verification; compiling deployable `.so` SBF binaries requires external `cargo-build-sbf`.
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

# Manifest & Manifest Studio — System Architecture

## 1. Architectural Overview

Manifest Studio is an integrated development environment and multi-target compiler/VM workspace built around two tightly verified layers:

1. **The Manifest Language Toolchain & Rust Virtual Machine (`manifest-core/` + `mvm/`)**:
   - Dual-profile surface syntax (**Beginner Profile** and **Professional Profile**) normalizing into one canonical `SemanticModule` AST.
   - Multi-file `import`/`export` module graph resolver, static `TypeChecker`, and fixed-point transitive `Capability & Effect Analyzer`.
   - Target-independent **Typed Manifest IR (`MIRModule`)** with semantics-preserving optimization passes.
   - Binary **`.mbc` v1.0 Bytecode** emitter, static bytecode verifier, and disassembler.
   - **Rust Manifest Virtual Machine (`mvm-core`, `#![forbid(unsafe_code)]`)** compiled both to native CLI (`mvm/target/release/mvm`) and WebAssembly (`public/wasm/mvm_wasm.wasm`) for identical execution in Studio and CLI.
   - Additional backends for **JavaScript / Web** (`web-js`), **Direct WebAssembly** (`wasm`), **Native Rust** (`native`), and **Solana Anchor SBF** (`solana-sbf`).
2. **The Manifest Studio IDE (`src/studio/`)**:
   - React 19 + CodeMirror 6 workspace with visible **Syntax Profile** (`Auto`, `Beginner`, `Professional`), **Format**, and **Compiler Target** selectors, separated **Run** vs **Build** lifecycle, real-time editor diagnostics/hover tooltips, and Developer Inspector tabs (**Output**, **Bytecode (.mbc)**, **Capabilities**, **Typed IR**, **DOM / State**, **Preview HTML**).
   - Multi-language execution orchestrator supporting Manifest (`.manifest` & `.mbc`), multi-file Static Web (`.html`/`.css`/`.js`), standalone WebAssembly binaries (`.wasm`), and Solana contract simulation—while explicitly refusing unimplemented source runtimes (`.py`, `.rs`, `.ts`, `.c`, `.go`, `.java`).

---

## 2. End-to-End Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                           MANIFEST STUDIO UI (React 19)                           |
|  - Header Controls: Syntax Profile | Format | Compiler Target | Run | Build       |
|  - CodeMirror 6 Editor (Per-File LRU State, Compartments, Hover, Live Linter,     |
|    Read-Only Binary Inspector with Direct ".mbc -> Rust MVM" Execution)           |
|  - Recursive Explorer + Multi-Project IndexedDB Store + Binary-Safe ZIP Service   |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                   EXECUTION & BUILD ORCHESTRATOR (src/studio/)                    |
|  - Separates executeProject() vs buildProject() (Persists build/* Artifacts)      |
|  - Deterministic Active-File Routing & Monotonic Async Run Superseding            |
+-----------+-------------------+-------------------+-------------------+-----------+
            |                   |                   |                   |
            v                   v                   v                   v
  +-------------------+ +---------------+ +-------------------+ +-------------------+
  | Manifest Provider | |  Static Web   | |   WASM Provider   | | Unsupported Guard |
  | (.manifest, .mbc) | | (.html/.js)   | |     (.wasm)       | | (.py/.rs/.ts/...) |
  +---------+---------+ +-------+-------+ +---------+---------+ +---------+---------+
            |                   |                   |                     |
            v                   |                   |                     v
+-----------------------------+ |                   |           Explicit Diagnostic
|   manifest-core v1.0 Core   | |                   |           (Never Silent Switch)
| 1. Beginner / Pro Parsers   | |                   |
| 2. Module Graph Resolver    | |                   |
| 3. Static TypeChecker       | |                   |
| 4. Capability/Effect Audit  | |                   |
| 5. Typed MIR + Optimizer    | |                   |
+---+------+------+------+----+ |                   |
    |      |      |      |      |                   |
    v      |      |      |      |                   |
+--------+ |  +-------+  |      |                   |
| .mbc   | |  | .wasm |  |      |                   |
| Binary | |  | Emit  +--+------+-------------------+
+---+----+ |  +-------+  |      |                   |
    |      v             v      v                   v
    |  +--------+   +--------+ +------------+ +----------------+
    |  | Native |   | Solana | |  Web / JS  | |  WASM Runtime  |
    |  | (.rs)  |   | Anchor | | Sandbox    | |  (env + WASI)  |
    |  +--------+   +--------+ +-----+------+ +-------+--------+
    v                                |                |
+---------------------------------+  |                |
|   RUST MVM (mvm_wasm.wasm)      |  |                |
| - #![forbid(unsafe_code)]       |  |                |
| - Static Stack/Jump Verifier    |  |                |
| - Step/Call/Heap Bounded Engine |  |                |
| - Capability-Gated Host Calls   |  |                |
+----------------+----------------+  |                |
                 |                   |                |
                 +-------------------+----------------+
                                     |
                                     v
+-----------------------------------------------------------------------------------+
|                     PREVIEW & DEVELOPER INSPECTOR PANEL                           |
|  - Strict <iframe sandbox="allow-scripts"> (Null Origin)                          |
|  - Tabs: Output | Bytecode (.mbc) | Capabilities | Typed IR | State | HTML        |
+-----------------------------------------------------------------------------------+
```

---

## 3. Repository Navigation & Subsystems

- **`manifest-core/`**:
  - `src/core/`: `profile.ts`, `ast-v2.ts`, `beginner-parser.ts`, `professional-parser.ts`, `parse-unified.ts`, `formatter.ts`.
  - `src/semantics/`: `types.ts`, `module-resolver.ts`, `type-checker.ts`, `capability-analyzer.ts`.
  - `src/ir/`: `typed-ir.ts`, `typed-ir-builder.ts`, `ir-optimizer.ts` (v1.0 Typed MIR) and `ir.ts`, `ir-builder.ts` (legacy UI/Solana IR).
  - `src/bytecode/`: `mbc-format.ts`, `mbc-compiler.ts`, `mbc-reader.ts`.
  - `src/vm/`: `mvm-runner.ts`, `mvm-wasm-bytes.ts`.
  - `src/targets/`: `target-registry.ts`, `wasm-target.ts`, `web-js-target.ts`, `native-target.ts`.
  - `src/runtime/`: `semantic-evaluator.ts` (deterministic MIR reference evaluator) and `runtime.ts` (legacy AST interpreter).
  - `src/solana/`: `solana-ir.ts`, `anchor-generator.ts`, `solana-simulator.ts`.
  - `src/pipeline.ts` & `src/cli.ts`: Unified build/run/check/format/disassemble/verify API and CLI.
- **`mvm/`**:
  - `crates/mvm-core/`: Safe Rust bytecode decoder, static verifier, arena heap, capability gate, SHA-256/math/string/FS host, and VM loop.
  - `crates/mvm-cli/`: Native `mvm` executable (`run`, `verify`, `disasm`).
  - `crates/mvm-wasm/`: WebAssembly FFI wrapper compiled to `public/wasm/mvm_wasm.wasm`.
- **`src/studio/`**:
  - `Studio.tsx`: Top-level workspace state, IndexedDB hydration guard, Syntax Profile & Compiler Target selectors, Format action, dirty-tab tracking (`•`), and separated Run/Build handlers.
  - `compiler-service.ts`: Bridges `compileManifestV1` and legacy UI/Solana compilation, encoding binary `.mbc` and `.wasm` outputs as base64 data URLs.
  - `execution/`: `execution-orchestrator.ts`, `manifest-execution-provider.ts`, `static-web-execution-provider.ts`, `wasm-execution-provider.ts`.
  - `editor/`: `CodeMirrorEditor.tsx`, `manifest-language.ts`, `manifest-autocomplete.ts` (completions + `manifestHoverTooltip`), `manifest-linter.ts`.
  - `preview/PreviewPanel.tsx`: Sandboxed preview + Bytecode, Capabilities, and Typed IR inspector views.
  - `services/zip-service.ts` & `git-provider.ts`: Lossless binary (`.mbc`, `.wasm`, images) and text ZIP import/export.

---

## 4. Non-Negotiable Engineering Invariants

1. **Honest Execution & Target Boundaries**: Never claim Python, C/C++, Go, Java, or TypeScript run locally in the browser; never claim browser builds emit native ELF binaries without a host `rustc`; keep `evm-solidity`, `move`, and `ton-tact` visibly marked `Planned`.
2. **Deterministic Active-File Routing**: Running an active file executes *that* file (including secondary `.manifest` and binary `.mbc` files) and never silently falls back to `src/main.manifest`.
3. **Browser Sandbox Integrity**: Preserve `<iframe sandbox="allow-scripts">` (never add `allow-same-origin`) and avoid `window.alert`, `window.confirm`, `window.prompt`, and `window.open`.
4. **Offline Post-Load Operation**: Once loaded, `manifest-core`, `mvm_wasm.wasm`, `StaticWebExecutionProvider`, `WasmExecutionProvider`, `SolanaSimulator`, and IndexedDB storage run with zero external network calls. (Cold-reload Service Worker caching remains a separate future item; see [`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md).)

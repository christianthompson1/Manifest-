# Manifest Studio — Language & Runtime Capability Matrix

This document records the **actual, verified** capabilities of every source language, configuration format, and binary container registered in `LanguageRegistry` (`src/studio/languages/language-registry.ts`) and `ExecutionOrchestrator` (`src/studio/execution/execution-orchestrator.ts`).

Manifest Studio never claims that syntax highlighting implies execution, and never silently switches to `src/main.manifest` when an unsupported file is active.

---

## 1. Verified IDE & Runtime Capability Matrix

| Language / Format | Extensions / Files | Editing | Syntax Highlighting | Autocomplete & Hover | Live Diagnostics | Formatting | Studio `Run` | Studio `Build` | Offline (Post-Load) | Honest Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **Manifest v1.0 (Beginner & Professional)** | `.manifest` | Yes | Dual-Profile Stream Tokenizer | Profile Keywords, `std::*`, AST Symbols + **Type/Effect Hover** | Syntax + Static Types + Transitive Capabilities | **Yes** (`Beginner` <-> `Professional`) | **Yes** (Rust MVM `.mbc`, Sandboxed Web JS, Direct `.wasm`) | **Yes** (`.mbc`, `.disasm.txt`, `.wasm`, `.wat`, `.js`, `.rs`) | Yes | **Verified** |
| **Manifest Bytecode** | `.mbc` | Binary Inspector Card | Disassembly Inspector | N/A (Binary) | Static `.mbc` Verifier + Rust `mvm_verify` | N/A | **Yes** (Direct execution in Rust MVM WASM) | Emitted by `mvm` target | Yes | **Verified** |
| **Manifest Web UI & Solana DSL** | `.manifest` (`APP`/`PAGE`/`PROGRAM`) | Yes | Manifest Mode | UI & Solana Snippets | Lexer + Parser + 2-Pass Semantic Validator | Indentation Normalize | **Yes** (Reactive DOM Canvas / Solana Simulator) | **Yes** (`dist/app.js` or Anchor `lib.rs` + `idl.json`) | Yes | **Verified** |
| **HTML** | `.html`, `.htm` | Yes | `@codemirror/lang-html` | HTML Tag/Attr | Missing local asset warnings | None | **Yes** (`StaticWebExecutionProvider`) | **Yes** (`build/bundle.html`) | Yes | **Verified** |
| **CSS** | `.css`, `.scss`, `.less` | Yes | `@codemirror/lang-css` | CSS Properties | Missing `url(...)` asset warnings | None | **Yes** (Inlined into HTML preview) | **Yes** (`build/bundle.html`) | Yes | **Verified** |
| **JavaScript** | `.js`, `.mjs`, `.cjs` | Yes | `@codemirror/lang-javascript` | JS/DOM Keywords | Runtime `window.onerror` bridge | None | **Yes** (HTML bundle or standalone JS harness) | **Yes** (`build/bundle.html`) | Yes | **Verified** |
| **WebAssembly Binary** | `.wasm` | Read-Only Binary Card | `.wat` on Manifest WASM Build | None | Magic + `WebAssembly.validate` + Import Check | N/A | **Yes** (`WasmExecutionProvider`: `env.*` + WASI `fd_write`) | Emitted from Manifest `wasm` target | Yes | **Verified** |
| **JSON** | `.json`, `.jsonc` | Yes | `@codemirror/lang-json` | Basic | **Syntax Linter** (`jsonParseLinter`) | None | No (Data/Config) | No | Yes | **Verified** |
| **TOML** | `.toml`, `manifest.toml` | Yes | Config Mode | None | Separated from Manifest linter | None | Neutral config (resolves project entry) | No | Yes | **Verified** |
| **XML / SVG** | `.xml`, `.svg` | Yes (Editable Text) | `@codemirror/lang-xml` | XML Tags | None | None | Bundled as Data URL in Web projects | Inlined in Web bundle | Yes | **Verified** |
| **Markdown** | `.md`, `.markdown` | Yes | `@codemirror/lang-markdown` | None | None | None | Neutral doc (resolves project entry) | No | Yes | **Verified** |
| **Rust** | `.rs` | Yes | `@codemirror/lang-rust` | Basic | None in browser | None | **No** (`unsupported-language` on Run; requires host `rustc`/`cargo`) | Generated as output by `native` & `solana-sbf` targets | Yes (Editing) | **Editing Only** |
| **TypeScript / JSX / TSX** | `.ts`, `.tsx`, `.jsx` | Yes | `@codemirror/lang-javascript` | Basic | None in browser | None | **No** (Explicit `unsupported-language` diagnostic) | No | Yes (Editing) | **Editing Only** |
| **Python** | `.py`, `.pyw` | Yes | `@codemirror/lang-python` | Basic | None | None | **No** (No Pyodide bundled; explicit diagnostic) | No | Yes (Editing) | **Editing Only** |
| **C / C++ / Go / Java / C# / Kotlin / Swift / Dart / SQL / PHP / Ruby / Lua / Shell** | `.c`, `.cpp`, `.go`, `.java`, `.sql`, etc. | Yes | Lezer / Legacy Modes | Basic / None | None | None | **No** (Explicit `unsupported-language` diagnostic) | No | Yes (Editing) | **Editing Only** |

---

## 2. Deterministic Execution & Build Routing Rules

1. **Active Executable File Wins**:
   - `.manifest` -> Compiled and executed/built via `ManifestExecutionProvider` using the selected Syntax Profile (`auto` / `beginner` / `professional`) and Compiler Target (`mvm`, `web-js`, `wasm`, `native`, `solana-sbf`).
   - `.mbc` -> Decoded, statically verified, and executed directly on the Rust Manifest Virtual Machine (`mvm_wasm.wasm`).
   - `.html` / `.js` -> Bundled and executed via `StaticWebExecutionProvider`.
   - `.wasm` -> Validated and executed via `WasmExecutionProvider`.
2. **Active Editing-Only Language Refuses Honestly**:
   - Pressing **Run** or **Build** while editing `.py`, `.rs`, `.ts`, `.c`, `.cpp`, `.go`, `.java`, etc. returns `providerId: 'unsupported-language'` with a clear explanation of the required external runtime/toolchain—never silently running `src/main.manifest`.
3. **Neutral Config / Docs Fallback**:
   - Pressing **Run** while viewing `manifest.toml` or `README.md` resolves `project.entryPath` / `manifest.toml` `entry`, failing explicitly if a configured entry path does not exist.

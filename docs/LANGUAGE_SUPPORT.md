# Manifest Studio — Language & Runtime Capability Matrix

This document records the **actual, verified** capabilities of every language and binary format registered in `LanguageRegistry` (`src/studio/languages/language-registry.ts`) and `ExecutionOrchestrator` (`src/studio/execution/execution-orchestrator.ts`).

Manifest Studio never claims that syntax highlighting implies execution, and never silently falls back to running `src/main.manifest` when an unsupported language file is active.

---

## 1. Verified Capability Matrix

| Language / Format | Extensions / Files | Editing | Syntax Highlighting | Autocomplete | Diagnostics | Local Execution | Local Build / Artifacts | Sandboxed Preview | Offline (Post-Load) | Honest Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **Manifest** | `.manifest` | Yes | Custom Stream/Token Mode | Context + Symbol + Snippet | Lexer + Parser + 2-Pass Semantic Validator | **Yes** (`ManifestExecutionProvider` + AST `Runtime`) | **Yes** (`dist/app.js`, `dist/ir.json`, or Solana Anchor files) | **Yes** (`manifest-canvas`) | Yes | **Verified** |
| **HTML** | `.html`, `.htm` | Yes | `@codemirror/lang-html` | Tag/Attr (Lezer) | Missing local asset warnings on Run | **Yes** (`StaticWebExecutionProvider`) | **Yes** (`build/bundle.html`) | **Yes** (`web-document`) | Yes | **Verified** |
| **CSS** | `.css`, `.scss`, `.less` | Yes | `@codemirror/lang-css` | CSS Property (Lezer) | Missing `url(...)` asset warnings on Run | **Yes** (Inlined into active Web preview) | **Yes** (Bundled into `build/bundle.html`) | **Yes** (via HTML preview) | Yes | **Verified** |
| **JavaScript** | `.js`, `.mjs`, `.cjs` | Yes | `@codemirror/lang-javascript` | Basic Keyword/DOM | Runtime `window.onerror` bridge | **Yes** (Bundled in HTML or standalone JS console harness) | **Yes** (Bundled into `build/bundle.html`) | **Yes** (`web-document`) | Yes | **Verified** |
| **WebAssembly Binary** | `.wasm` | Read-Only Binary View | N/A (Binary) | None | Binary Magic, `WebAssembly.validate`, & Import Check | **Yes** (`WasmExecutionProvider`: `env.*` + minimal WASI `fd_write`) | No (Executes precompiled `.wasm` binaries) | **Yes** (`terminal-output`) | Yes | **Verified** (Binary execution only; **Manifest-to-WASM compilation is NOT implemented**) |
| **Solana Manifest** | `.manifest` (`PROGRAM`) | Yes | Manifest Mode | Manifest Keywords | Manifest Validator | **Yes** (LiteSVM in-memory instruction simulation) | **Yes** (Anchor `lib.rs`, `idl.json`, TS client) | **Yes** (Inspector / Terminal) | Yes | **Verified** |
| **JSON** | `.json`, `.jsonc` | Yes | `@codemirror/lang-json` | Basic | **Syntax Linter** (`jsonParseLinter`) | No (Data/Config) | No | No | Yes | **Verified** (Editing + Syntax Diagnostics) |
| **TOML** | `.toml`, `manifest.toml`, `Cargo.toml`, `Anchor.toml` | Yes | Highlighted Config Mode | None | None (Separated from Manifest linter) | No (Config; neutral fallback to project entry on Run) | No | No | Yes | **Verified** (Config Mode) |
| **XML / SVG** | `.xml`, `.svg` | Yes (Editable Text) | `@codemirror/lang-xml` | Tag Completion | None | Rendered as base64 Data URL in HTML/CSS `url()` | Inlined in Web Bundle | Via HTML | Yes | **Verified** (Editable Asset/Markup) |
| **Markdown** | `.md`, `.markdown` | Yes | `@codemirror/lang-markdown` | None | None | Neutral doc file (Runs project default entry if available) | No | No | Yes | **Verified** (Documentation) |
| **TypeScript / JSX / TSX** | `.ts`, `.tsx`, `.jsx` | Yes | `@codemirror/lang-javascript` | Basic | None in browser editor | **No** (Explicit `unsupported-language` diagnostic on Run) | No in-browser bundler | No | Yes (Editing) | **Editing Only** |
| **Python** | `.py`, `.pyw` | Yes | `@codemirror/lang-python` | Basic | None | **No** (No Pyodide/CPython bundled; explicit diagnostic on Run) | No | No | Yes (Editing) | **Editing Only** |
| **Rust** | `.rs` | Yes | `@codemirror/lang-rust` | Basic | None | **No** (Requires native `cargo`/`rustc`; explicit diagnostic on Run) | Remote CI workflow template only | No | Yes (Editing) | **Editing Only** |
| **C / C++** | `.c`, `.h`, `.cpp`, `.hpp` | Yes | `@codemirror/lang-cpp` | Basic | None | **No** (Requires native Clang/GCC; explicit diagnostic on Run) | No | No | Yes (Editing) | **Editing Only** |
| **Go** | `.go` | Yes | Legacy Go Mode | None | None | **No** (Requires Go toolchain; explicit diagnostic on Run) | No | No | Yes (Editing) | **Editing Only** |
| **Java / C# / Kotlin / Swift / Dart** | `.java`, `.cs`, `.kt`, `.swift`, `.dart` | Yes | Lezer / Legacy Modes | Basic / None | None | **No** (Explicit `unsupported-language` diagnostic on Run) | No | No | Yes (Editing) | **Editing Only** |
| **PHP / Ruby / Lua / R / Julia / Haskell / SQL / Shell** | `.php`, `.rb`, `.lua`, `.r`, `.jl`, `.hs`, `.sql`, `.sh` | Yes | Lezer / Legacy Modes | Basic / None | None | **No** (Explicit `unsupported-language` diagnostic on Run) | No | No | Yes (Editing) | **Editing Only** |

---

## 2. Deterministic Execution Routing Rules
1. **Active Executable File Wins**:
   - Active `.manifest` file -> Executes that exact `.manifest` file (`ManifestExecutionProvider`).
   - Active `.html`/`.htm` file -> Bundles and previews that exact HTML document (`StaticWebExecutionProvider`).
   - Active `.js`/`.mjs` file -> Bundles with project HTML if present, or synthesizes a standalone JS console harness (`StaticWebExecutionProvider`).
   - Active `.wasm` file -> Validates and instantiates that exact `.wasm` binary (`WasmExecutionProvider`).
2. **Active Unsupported Source Language Refuses Honestly**:
   - Active `.py`, `.rs`, `.ts`, `.tsx`, `.c`, `.cpp`, `.go`, `.java`, etc. -> Immediately returns `providerId: 'unsupported-language'` with `previewKind: 'diagnostic-error'`. Never runs an unrelated `.manifest` or `.html` file in the workspace.
3. **Neutral Configuration / Documentation Files**:
   - Active `README.md` or `manifest.toml` -> Resolves `project.entryPath` or `manifest.toml` `entry`. If the configured entry file is missing, fails explicitly with a diagnostic error rather than silently switching to another file.

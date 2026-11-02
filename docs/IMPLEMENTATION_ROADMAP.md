# Manifest Studio — Implementation Roadmap

This roadmap tracks verified engineering deliverables, partial subsystems, and future milestones based on actual repository verification.

## Status Legend
- **[VERIFIED]**: Implemented in source code and verified via automated tests (`npm run manifest:test`, `npm run lint`, `npm run build`).
- **[PARTIAL]**: Core mechanism works within explicit boundaries; remaining scope documented below.
- **[PLANNED]**: Designed in architecture; not yet implemented.
- **[BLOCKED]**: Requires host OS toolchains or external runtime downloads unavailable in a pure client-side browser sandbox.

---

## 1. Deterministic Execution Routing & Stale Preview Prevention
- **Status**: **[VERIFIED]**
- **Delivered**:
  - `ExecutionOrchestrator` strictly honors the active file: running `.py`, `.rs`, `.ts`, `.c`, `.cpp`, `.go`, `.java`, etc. returns an explicit `unsupported-language` diagnostic instead of silently running `src/main.manifest`.
  - Active secondary `.manifest` files execute directly (`resolvedEntryPath`) without switching to `src/main.manifest`.
  - Missing configured `entryPath` / `manifest.toml` `entry` fails explicitly.
  - Concurrent async runs carry monotonic IDs and mark superseded runs (`superseded: true`) so stale outputs cannot overwrite newer state.
  - `PreviewPanel.tsx` displays the resolved entry file badge and clears stale HTML immediately when compilation or execution fails.

---

## 2. Editor Stability, Per-File State & Language Honesty
- **Status**: **[VERIFIED]**
- **Delivered**:
  - `CodeMirrorEditor.tsx` preserves a single mounted `EditorView` (no `key` remounts), uses an LRU per-file `EditorState` cache (`fileId`) retaining cursor, selection, and undo/redo history across tab switches, reconfigures `fontSize`/`wordWrap`/`language`/`readOnly` via `Compartment`s, and guards external dispatches with `!view.composing`.
  - Binary files (`.wasm`, images) open in a safe read-only binary view instead of corrupting payloads.
  - `manifest.toml`, `Cargo.toml`, and `Anchor.toml` are separated into a `toml` provider so `manifestLinter` never flags TOML syntax.
  - `.json` files run real `@codemirror/lang-json` `jsonParseLinter` syntax diagnostics.

---

## 3. Project Explorer, Multi-Project Persistence & Binary ZIP Archiving
- **Status**: **[VERIFIED]**
- **Delivered**:
  - Recursive `ProjectTree.tsx` wired into `Sidebar.tsx` with nested folders, `.gitkeep` empty-folder support, inline file/folder creation, inline renaming, and two-step inline delete confirmation (zero `window.confirm`/`alert`/`prompt` calls).
  - Multi-project IndexedDB workspace persistence (`listWorkspaceProjectsAsync`, `deleteWorkspaceProjectAsync`) with mount-hydration race protection and storage quota error surfacing.
  - File rename synchronizes `activeFilePath`, `openTabPaths`, `entryPath`, `manifest.toml`, and HTML asset tags.
  - Binary-safe ZIP export/import (`zip-service.ts`) preserves raw `.wasm` and image bytes identically while keeping `.svg` editable as XML text.

---

## 4. Manifest Compiler, Two-Pass Validator & Interpreter/JS Parity
- **Status**: **[VERIFIED]**
- **Delivered**:
  - Single-pass compilation (`Lexer -> Parser -> Validator -> generateManifestIRFromAST -> compileManifestIR`).
  - Added unary operators (`NOT`, `!`, `-`, `+`), array/string indexing (`arr[i]`), `BADGE`, `PROGRESS`, `ICON`, `HEADING`, and `CSS`/`JS` escape lowering.
  - Two-pass semantic validation supporting forward `ACTION`/`PAGE` references, catching undefined `CALL`s, duplicate `ACTION`/`PAGE`s, top-level `RETURN`, invalid `ROUTE` targets, and literal division-by-zero warnings.
  - Full behavioral parity verified via differential tests between `Runtime` (`runtime.ts`) and `JSTargetCompiler` (`js-target.ts`) across control flow inside `ACTION`s, recursion (depth guard 200), loop bounds (100,000), and `TRY / IF FAILED`.

---

## 5. Multi-File Static Web & Standalone JavaScript Execution
- **Status**: **[VERIFIED]**
- **Delivered**:
  - `StaticWebExecutionProvider` bundles HTML, local `<link rel="stylesheet">`, `<script src="...">`, `<img src="...">`, and CSS `url(...)` assets (including base64 SVG data URLs), emits line-accurate `StudioDiagnostic` warnings for missing local assets, executes standalone `.js` files via a console harness when no HTML file exists, and supports `Build` -> `build/bundle.html`.

---

## 6. Compiled WebAssembly (`.wasm`) Binary Execution vs Manifest-to-WASM
- **Status**: **[PARTIAL]** (`.wasm` binary execution **[VERIFIED]**; Manifest-to-WASM compiler **[PLANNED]**)
- **Delivered**:
  - `WasmExecutionProvider` validates, compiles, and instantiates real `.wasm` binaries offline with bounded `WebAssembly.Memory` (up to 256 pages / 16 MiB), `env.{print_i32,print_f64,log,abort}`, minimal `wasi_snapshot_preview1` (`fd_write` UTF-8 stdout/stderr capture, `proc_exit`), and pre-instantiation import verification.
- **Not Yet Implemented**:
  - Compiling `.manifest` source code into `.wasm` bytecode (`wasm-target.ts`).
  - Multi-file Manifest module system (`IMPORT` / `EXPORT` across `.manifest` files).

---

## 7. Offline Development & PWA Cold-Reload Caching
- **Status**: **[PARTIAL]**
- **Delivered**:
  - Post-load offline compilation, execution (`Manifest`, `Static Web`, `.wasm`, `LiteSVM`), and IndexedDB multi-project persistence operate with zero network calls.
- **Planned**:
  - Service Worker (`sw.js`) + Web App Manifest registration for cold offline browser tab reload.
  - Optional opt-in downloadable Pyodide runtime for local Python execution.

---

## 8. Native Toolchains (Rust, C, C++, Go, Java)
- **Status**: **[BLOCKED]** in browser SPA; **[PLANNED]** for desktop host shell (Tauri/Electron) or remote build worker.

# Manifest Studio — System Architecture

## 1. Overview & Vision
Manifest Studio is a self-contained, offline-first development environment built for the Manifest programming language alongside first-class support for multi-file web development (HTML, CSS, JavaScript) and an extensible execution provider architecture accommodating future runtimes (WebAssembly, Python via Pyodide, Solana/Rust Anchor contracts, and native toolchains).

---

## 2. System Architecture & Flow

```
                      +---------------------------------------+
                      |       User Interface (React 19)       |
                      |  - CodeMirror 6 Editor                |
                      |  - File Explorer & Virtual Project    |
                      |  - Sandboxed Preview & Inspector      |
                      |  - Problems, Console & Terminal Tabs  |
                      +-------------------+-------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |     Workspace & Project Manager       |
                      |  - IndexedDB Persistence (idb-keyval) |
                      |  - Local Storage Fallback             |
                      |  - In-memory Virtual Filesystem       |
                      +-------------------+-------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |      Execution Orchestrator           |
                      |  - Project & File Detection           |
                      |  - Provider Selection & Capabilities  |
                      |  - Asynchronous Race/Stale Guard      |
                      +-------------------+-------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
        v                                 v                                 v
+-----------------------+     +-----------------------+     +-----------------------+
|   Manifest Provider   |     |   Static Web Provider |     |   Solana / LiteSVM    |
| - Lexer & Parser      |     | - Root HTML discovery |     | - Anchor Generator    |
| - Semantic Validator  |     | - CSS/JS inlining     |     | - LiteSVM In-browser  |
| - Manifest IR Builder |     | - Asset resolution    |     |   Execution & IDL     |
| - JS Target Compiler  |     | - Preview Console     |     | - Pinned toolchain    |
| - Runtime startApp    |     |   Bridge injection    |     |   specifications      |
+-----------------------+     +-----------------------+     +-----------------------+
        |                                 |                                 |
        +---------------------------------+---------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |       Sandboxed Preview Panel         |
                      |  - <iframe> sandbox="allow-scripts"   |
                      |  - postMessage bidirectional bridge   |
                      |  - Clean teardown on each run/reload  |
                      |  - Rich diagnostic error overlay      |
                      +---------------------------------------+
```

---

## 3. Core Subsystems & Responsibilities

### 3.1 Manifest Core (`manifest-core/`)
- **Lexer & Tokens** (`src/lexer/`): Tokenizes human-readable Manifest syntax (`APP`, `PAGE`, `CONTAINER`, `TEXT`, `BUTTON`, `STATE`, `WHEN CLICK`, `STYLE`, `END`).
- **Parser & AST** (`src/parser/`, `src/ast/`): Constructs a strongly typed Abstract Syntax Tree with full source location tracking (lines and columns) and styling declarations (`styles?: Record<string, string>`).
- **Semantic Validator** (`src/validator/`): Checks for duplicate variable declarations, unclosed blocks, type mismatches, and syntax violations before compilation.
- **Intermediate Representation (IR)** (`src/ir/`): Produces target-agnostic IR (`IRProgram`, `IRPage`, `IRContainer`, `IRText`, `IRButton`, `IRState`, `IRInstruction`).
- **Compiler Targets** (`src/compiler/targets/`):
  - `js-target.ts`: Emits self-contained browser-compatible JavaScript containing CSS rules, active page routing, reactive state scopes (`__manifest.state`), and `export async function startApp(mountElement, options)`.
  - `solana-target.ts`: Emits Anchor/Rust programs and IDL metadata.
- **Manifest Language Runtime** (`src/runtime/`):
  - `runtime.ts`: Provides discrete execution semantics for expressions, variables/scopes, action calls, conditionals, repeat/foreach loops, try/catch, event bus dispatching, and controlled host capabilities.

### 3.2 Studio Execution Architecture (`src/studio/execution/`)
- **ExecutionProvider Contract** (`execution-types.ts`): Unified interface implemented by all language engines (`detect`, `validate`, `execute`, `build`, `cancel`, `getCapabilities`, `isOfflineReady`).
- **ManifestExecutionProvider** (`manifest-execution-provider.ts`): Resolves Manifest entry points, runs the compiler pipeline, and packages output into a `UnifiedExecutionResult` with `previewKind: 'manifest-canvas'`.
- **StaticWebExecutionProvider** (`static-web-execution-provider.ts`): Resolves multi-file HTML/CSS/JavaScript projects without routing through the Manifest compiler, inlining local stylesheets and scripts, resolving assets, and injecting a console bridge.
- **ExecutionOrchestrator** (`execution-orchestrator.ts`): Singleton coordinator detecting project types, selecting providers, preventing stale asynchronous run results via unique run tokens, and canceling in-flight tasks.

### 3.3 Sandboxed Preview Panel (`src/studio/preview/PreviewPanel.tsx`)
- Renders an `<iframe>` configured with `sandbox="allow-scripts"` to strictly isolate user code from Studio cookies, storage, and secrets.
- Generates a fresh `srcDoc` for each execution or reload key, completely preventing DOM duplication or state bleeding across runs.
- Handles diagnostic errors gracefully by displaying formatted error cards with line numbers, hints, and code examples instead of rendering a blank view.
- Bridges console outputs (`preview-console`, `manifest-output`) and reactive state changes (`manifest-state`) back to the Studio inspector.

---

## 4. Platform Capabilities & Boundaries

| Capability | Browser SPA (Current) | Future Desktop (Tauri/Electron) |
|---|---|---|
| Manifest Language Compilation | 100% Native in-memory | 100% Native in-memory |
| Static Web (HTML/CSS/JS) Execution | 100% Native browser sandbox | Native Webview |
| Solana Contract Simulation | In-browser LiteSVM WASM | Native LiteSVM / local validator |
| Python Execution | Supported via Pyodide (WASM) | Native Python virtualenvs |
| WebAssembly (WASI) | Supported via WASI shim | Native WASM runtime (Wasmtime) |
| Rust / C / C++ / Go Compilation | Requires remote CI or downloaded WASM | Native local system toolchains |
| Filesystem Access | IndexedDB / File System Access API | Direct OS filesystem access |

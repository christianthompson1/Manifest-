# Manifest Studio — System Architecture

## 1. Overview & Architectural Truth
Manifest Studio is an integrated browser-based development environment built for the **Manifest** programming language alongside first-class execution support for **multi-file Static Web projects** (HTML, CSS, JavaScript, SVG/binary assets), **standalone JavaScript** files, **compiled WebAssembly (`.wasm`) binaries**, and **Solana / Anchor smart contract synthesis & LiteSVM simulation**.

### Critical Capability Boundaries
- **Manifest Execution**: Manifest compiles in a single pass (`Lexer -> Parser -> Two-Pass Validator -> Manifest IR -> JavaScript Target`) and runs inside a strict `<iframe sandbox="allow-scripts">` preview, with an AST interpreter (`manifest-core/src/runtime/runtime.ts`) verified for behavioral parity in headless CLI and test environments.
- **WebAssembly Boundary**: Manifest Studio executes **compiled `.wasm` binary modules** locally via `WasmExecutionProvider` (supporting `env.*` logging and minimal `wasi_snapshot_preview1` `fd_write` stdout capture). **Manifest-to-WASM compilation is NOT implemented.**
- **Non-Executable Source Languages**: Python (`.py`), Rust (`.rs`), TypeScript (`.ts`/`.tsx`), C/C++, Go, Java, SQL, PHP, Ruby, Swift, Kotlin, Dart, and Lua have CodeMirror 6 syntax highlighting and editing, **not** local execution. Pressing Run on any of these files reports an explicit `unsupported-language` diagnostic and never silently executes `src/main.manifest` or `index.html`.
- **Offline Boundary**: Once loaded in the browser, all compilers, runtimes (`Manifest`, `Static Web`, `.wasm`, `LiteSVM`), and IndexedDB project persistence operate with zero network requests. However, a PWA Service Worker (`sw.js`) for cold offline URL reload is **not** currently registered.

---

## 2. System Architecture & Data Flow

```
                      +---------------------------------------------------+
                      |             User Interface (React 19)             |
                      | - CodeMirror 6 Editor (Per-File EditorState LRU,  |
                      |   Compartments, IME Guard, Binary Read-Only View) |
                      | - Recursive ProjectTree Explorer & Multi-Project  |
                      |   Workspace Switcher                              |
                      | - Sandboxed Preview, Problems, Console & Terminal |
                      +-------------------------+-------------------------+
                                                |
                                                v
                      +---------------------------------------------------+
                      |          Workspace & Persistence Layer            |
                      | - Multi-Project IndexedDB Store (idb-keyval)      |
                      | - Synchronous localStorage Mirror + Quota Checks  |
                      | - Hydration Guard (Prevents Mount Race Overwrite) |
                      | - Binary-Safe JSZip Import / Export (.wasm, .png) |
                      +-------------------------+-------------------------+
                                                |
                                                v
                      +---------------------------------------------------+
                      |              Execution Orchestrator               |
                      | - Deterministic Active-File / Entry Routing       |
                      | - Explicit Refusal for Non-Executable Languages   |
                      | - Monotonic Run IDs & Stale Async Superseding     |
                      +-------------------------+-------------------------+
                                                |
      +--------------------+--------------------+--------------------+--------------------+
      |                    |                    |                    |                    |
      v                    v                    v                    v                    v
+--------------+   +---------------+   +----------------+   +----------------+   +----------------+
|   Manifest   |   |  Static Web   |   |  WASM Binary   |   | Solana/LiteSVM |   |  Unsupported   |
|   Provider   |   |   Provider    |   |    Provider    |   |   Simulation   |   | Language Guard |
| - 1-Pass AST |   | - HTML/CSS/JS |   | - .wasm Magic  |   | - Anchor Rust  |   | - Honest Error |
| - 2-Pass Val |   | - CSS url()   |   |   & Validate   |   |   Codegen/IDL  |   | - Zero Silent  |
| - IR Builder |   | - Asset Data  |   | - Bounded Mem  |   | - In-Memory    |   |   Fallback to  |
| - JS Target  |   |   URLs + Warn |   | - env.* & WASI |   |   LiteSVM CU   |   |   Manifest     |
| - startApp() |   | - JS Harness  |   |   fd_write     |   |   Verification |   |                |
+--------------+   +---------------+   +----------------+   +----------------+   +----------------+
                                                |
                                                v
                      +---------------------------------------------------+
                      |              Sandboxed Preview Panel              |
                      | - <iframe sandbox="allow-scripts"> (No Parent     |
                      |   DOM/Cookie/Storage Access)                      |
                      | - Displays Resolved Entry File Badge              |
                      | - Clears Stale Output Immediately on Error        |
                      | - Structured postMessage Console/State Bridge     |
                      +---------------------------------------------------+
```

---

## 3. Core Subsystems

### 3.1 Single-Pass Manifest Compiler & Runtime (`manifest-core/`)
1. **Lexer** (`src/lexer/lexer.ts`): Tokenizes Manifest source with 1-indexed line/column tracking, comments (`--`, `//`, `#`, `NOTE:`), Unicode comparison operators, hex colors, and CSS/JS escape blocks.
2. **Parser** (`src/parser/parser.ts`): Single-lookahead recursive descent parser supporting full operator precedence (`OR` -> `AND` -> equality/comparison -> additive -> multiplicative -> unary `NOT`/`!`/`-`/`+` -> postfix `arr[idx]` -> primary literals/identifiers/`CALL`).
3. **Two-Pass Semantic Validator** (`src/validator/validator.ts`):
   - **Pass 1**: Registers top-level `ACTION`, `PAGE`, `STATE`, and `SET` declarations so forward references to actions and pages succeed, while flagging duplicate `ACTION` and `PAGE` definitions.
   - **Pass 2**: Validates `CALL` targets and arity warnings, `RETURN` placement inside `ACTION` blocks, `ROUTE` target existence against declared `PAGE`s, and literal division/modulo by zero warnings outside `TRY` blocks.
4. **Manifest IR** (`src/ir/ir-builder.ts`): Lowers validated AST directly (`generateManifestIRFromAST`) without re-lexing or re-parsing, preserving UI primitives (`Page`, `Container`, `Card`, `List`, `Header`, `Nav`, `Footer`, `Modal`, `Form`, `Text`, `Button`, `Input`, `Select`, `Checkbox`, `Textarea`, `Link`, `Image`, `Badge`, `Progress`, `Icon`, `CssEscape`, `JsEscape`).
5. **Target Compilers & Interpreter**:
   - **JS Target (`src/compiler/targets/js-target.ts`)**: Generates ES module code exporting `__manifest` and `startApp()`, supporting lexical local scopes (`__locals`), recursive `ACTION` calls (guarded at depth 200), loop iteration guards (100,000), division-by-zero runtime traps catchable by `TRY / IF FAILED`, and reactive DOM bindings.
   - **AST Interpreter (`src/runtime/runtime.ts`)**: Headless tree-walking interpreter verified via differential tests to match `JSTargetCompiler` output across arithmetic, unary/index expressions, control flow, recursion, lexical parameter shadowing, and `TRY / IF FAILED`.
   - **Solana Target (`src/compiler/targets/solana-target.ts`)**: Synthesizes Anchor Rust (`lib.rs`), IDL JSON, and TypeScript client bindings.

### 3.2 Editor Subsystem (`src/studio/editor/`)
- **Single-Instance `EditorView`**: `CodeMirrorEditor.tsx` maintains one mounted `EditorView` across file switches and settings updates.
- **Per-File `EditorState` Cache**: An LRU cache (`MAX_CACHED_FILE_STATES = 40`) keyed by `fileId` preserves cursor position, selection ranges, and full undo/redo history across tab switches.
- **Dynamic Compartments**: `fontSize`, `wordWrap`, `language`, and `readOnly` reconfigure via CodeMirror 6 `Compartment`s without destroying editor state.
- **IME Composition Safety**: Incoming external sync dispatches check `!view.composing` and document inequality before dispatching changes.
- **Binary File Protection**: Binary files (`.wasm`, `.png`, `.jpg`, etc.) render a read-only binary inspection view rather than corrupting raw payloads in a text buffer.

### 3.3 Project Tree, Multi-Project Storage & Binary ZIP (`src/studio/`)
- **Recursive File Explorer** (`explorer/ProjectTree.tsx` + `sidebar/Sidebar.tsx`): Supports nested directories, empty folders via hidden `.gitkeep` sentinels, inline file/folder creation, inline renaming, and two-step inline confirmation for deletion (zero `window.confirm`/`window.alert`/`window.prompt` calls).
- **Reference Synchronization**: Renaming a project file updates `activeFilePath`, `openTabPaths`, `project.entryPath`, `manifest.toml` `entry`, and HTML `<link>`/`<script>`/`<img>` relative references.
- **Workspace Persistence** (`project-store.ts`): Stores both the active project and a multi-project workspace dictionary in IndexedDB (`idb-keyval`) with `localStorage` fallback and explicit storage-error reporting.
- **Binary-Safe Archiving** (`services/zip-service.ts`): Decodes base64 Data URLs back into raw binary bytes on ZIP export and re-encodes binary entries (`.wasm`, images, fonts) on ZIP import while keeping `.svg` files as editable XML text.

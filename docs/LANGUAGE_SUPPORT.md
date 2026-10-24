# Manifest Studio — Language & Runtime Capability Matrix

This matrix documents the actual, verified capabilities of each language and project type in the current Manifest Studio codebase.

| Language / Format | CodeMirror Editing | Syntax Highlighting | Semantic Validation | In-Browser Execution | Compilation Target | Sandboxed Preview | Offline Ready | Runtime / Toolchain Status | Current Verified Status |
|---|---|---|---|---|---|---|---|---|---|
| **Manifest** (`.manifest`) | ✅ Yes | ✅ Custom Lezer Grammar | ✅ AST Validator | ✅ Yes | JavaScript (`app.js`), Solana Anchor Rust | ✅ Interactive Canvas | ✅ 100% Offline | Bundled Manifest Core v0.4 | **[VERIFIED]** Full compiler & reactive preview |
| **HTML / CSS** (`.html`, `.css`) | ✅ Yes | ✅ `@codemirror/lang-html`, `lang-css` | ✅ Basic | ✅ Yes (Native) | N/A | ✅ Live Webview | ✅ 100% Offline | Browser Web Platform | **[VERIFIED]** Bundled multi-file preview |
| **JavaScript** (`.js`) | ✅ Yes | ✅ `@codemirror/lang-javascript` | ✅ Basic | ✅ Yes (Native) | ESBuild (dev/build) | ✅ Live Webview | ✅ 100% Offline | Browser V8 / WebKit | **[VERIFIED]** Integrated in Static Web Provider |
| **TypeScript** (`.ts`) | ✅ Yes | ✅ `@codemirror/lang-javascript` (TS) | ⚠️ Typecheck CLI | ⚠️ Dev server only | TypeScript 5.8 | ⚠️ Via bundle | ⚠️ Partial | TypeScript compiler installed in node_modules | **[PARTIAL]** Supported in project sources; client execution requires build |
| **Solana / Rust** (`.rs`) | ✅ Yes | ✅ `@codemirror/lang-rust` | ⚠️ In-memory AST | ✅ LiteSVM (Simulated instructions) | Anchor IDL Generator | ✅ Account State Inspector | ✅ 100% Offline | LiteSVM WASM runner | **[VERIFIED]** Counter instruction execution verified |
| **Python** (`.py`) | ✅ Yes | ✅ `@codemirror/lang-python` | ❌ None | ❌ Planned (Pyodide) | ❌ None | ❌ None | ⚠️ Blocked | Requires Pyodide WASM runtime download | **[PLANNED]** Provider interface ready; download needed |
| **WebAssembly** (`.wasm`, `.wat`) | ✅ Hex/Text | ⚠️ Text format | ❌ None | ❌ Planned | Clang/Emscripten (external) | ❌ None | ⚠️ Blocked | Requires WASI browser shim | **[PLANNED]** WasmProvider architected |
| **C / C++** (`.c`, `.cpp`) | ✅ Yes | ✅ `@codemirror/lang-cpp` | ❌ None | ❌ Unsupported in browser | ❌ Needs native GCC/Clang | ❌ None | ❌ Blocked | Host OS toolchain required | **[BLOCKED]** Desktop host required for local compilation |
| **Go** (`.go`) | ✅ Yes | ✅ `@codemirror/legacy-modes/mode/go` | ❌ None | ❌ Unsupported in browser | ❌ Needs Go toolchain | ❌ None | ❌ Blocked | Host OS toolchain required | **[BLOCKED]** Desktop host required for local compilation |
| **SQL** (`.sql`) | ✅ Yes | ✅ `@codemirror/lang-sql` | ❌ None | ❌ Unsupported | ❌ None | ❌ None | ❌ N/A | Database server required | **[BLOCKED]** External database required |
| **JSON / YAML / TOML** | ✅ Yes | ✅ Dedicated Lezer & Legacy Modes | ✅ Syntactic | N/A (Config) | N/A | N/A | ✅ 100% Offline | Native parsers | **[VERIFIED]** `manifest.toml` and configs parsed |

---

## Capability Definitions
- **Editing**: Full cursor navigation, bracket matching, indentation, code folding.
- **Syntax Highlighting**: Tokenizer/highlighter active with dark matte color palette.
- **Semantic Validation**: Detection of undefined variables, syntax errors, and missing declarations with line/column markers in the Problems panel.
- **In-Browser Execution**: Code runs directly inside the client without transmitting code to external remote servers.
- **Offline Ready**: Operates with no internet connection after initial page load.

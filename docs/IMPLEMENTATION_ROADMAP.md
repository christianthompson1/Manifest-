# Manifest Studio — Implementation Roadmap

This document serves as the master roadmap and single source of truth for features, architectural components, dependencies, acceptance criteria, and completion status.

---

## Roadmap Status Legend
- **[VERIFIED]**: Implemented and verified via automated test suites and compiler checks.
- **[PARTIAL]**: Partially implemented or foundation established; needs further runtime coverage.
- **[PLANNED]**: Designed in architecture; implementation scheduled.
- **[BLOCKED]**: Dependent on missing host capabilities, external packages, or platform constraints.

---

## 1. Repository Audit & Baseline Architecture
- **Status**: **[VERIFIED]**
- **Implementation**: Comprehensive audit completed across lexer, parser, validator, AST, IR, compiler targets, project store, preview runtime, and test runner.
- **Acceptance Criteria**: 268/268 automated tests pass cleanly with zero lint regressions.

---

## 2. Preview Correctness & Execution Reliability
- **Status**: **[VERIFIED]**
- **Implementation**:
  - Repaired `PreviewPanel.tsx` to handle `executionResult` and `buildResult` uniformly.
  - Eliminated blank canvas issue on diagnostic errors by injecting rich error cards.
  - Remount isolation verified: `key={\`${reloadKey}-${executionResult?.timestamp || buildResult?.timestamp || 0}\`}` completely teardown and rebuilds preview iframe on each Run or Reload.
  - Resolved `ProjectSettingsModal.tsx` React hook ordering defect.
- **Acceptance Criteria**: Running applications does not duplicate DOM elements; syntax/runtime errors display structured diagnostics rather than an empty screen.

---

## 3. Manifest Runtime & Language Semantics
- **Status**: **[VERIFIED]**
- **Implementation**:
  - `manifest-core/src/runtime/runtime.ts` defines explicit execution semantics for state (`StateDeclaration`), variables (`SetStatement`), actions (`ActionDefinition`, `CallStatement`), loops (`RepeatLoop`, `ForEachLoop`), conditions (`IfStatement`), error catching (`TryBlock`), and event bus (`EventBus`).
  - Separation between AST runtime evaluation and JavaScript compiler target (`js-target.ts`).
  - Strict host capability validation via `CapabilityRegistry`.
- **Acceptance Criteria**: Manifest programs evaluate correctly in Node.js test environment and browser JavaScript canvas.

---

## 4. Shared Execution Provider Architecture
- **Status**: **[VERIFIED]**
- **Implementation**:
  - `src/studio/execution/execution-types.ts`: `ExecutionProvider`, `UnifiedExecutionResult`, `ProviderCapability`.
  - `src/studio/execution/execution-orchestrator.ts`: Singleton managing provider registry, project type detection, provider selection, and race-condition cancellation guards.
- **Acceptance Criteria**: Unit tests in `manifest-core/tests/run_orchestrator_tests.ts` pass 29/29 assertions.

---

## 5. First-Class Ordinary Web Projects (HTML/CSS/JS)
- **Status**: **[VERIFIED]**
- **Implementation**:
  - `StaticWebExecutionProvider` discovers root HTML (`index.html` or active `.html` file).
  - Preserves relative paths by inlining local stylesheets (`<link rel="stylesheet" href="...">`) and scripts (`<script src="...">`).
  - Resolves local image assets and SVGs.
  - Injects console logging and error forwarding bridge to stream `console.log` and `window.onerror` back to Studio inspector.
  - Added `static-web` template to project templates.
- **Acceptance Criteria**: HTML/CSS/JS projects execute directly in the preview iframe without passing through the Manifest compiler.

---

## 6. Offline Runtime & Dependency Management
- **Status**: **[PARTIAL]**
- **Current Status**:
  - Manifest compiler and Static Web provider run 100% offline in browser memory without external network calls.
  - IndexedDB storage (`idb-keyval`) guarantees project persistence across offline reloads.
- **Planned Work**:
  - Service Worker offline cache manifest (`sw.js`) for full PWA asset caching.
  - Offline package manager for third-party libraries.

---

## 7. WebAssembly & WASI Execution
- **Status**: **[PLANNED]**
- **Architecture**:
  - `WasmExecutionProvider` to load and instantiate `.wasm` binaries.
  - Standard WASI syscall polyfill for stdout/stderr streaming into the Studio terminal.
- **Blockers**: Needs WASI runtime bundle (e.g. `@bjorn3/browser_wasi_shim`).

---

## 8. Python Execution (Browser via Pyodide)
- **Status**: **[PLANNED]**
- **Architecture**:
  - `PythonExecutionProvider` leveraging Pyodide WASM runtime.
  - Standard library and micropip package caching in IndexedDB.
- **Blockers**: Pyodide runtime (~15MB download) requires explicit user opt-in before downloading to avoid bloating initial load.

---

## 9. Solana Local Simulation & Deployment
- **Status**: **[VERIFIED]**
- **Implementation**:
  - In-browser LiteSVM simulator executes Solana instructions with exact Compute Unit measurement.
  - Anchor workspace generator creates complete Rust programs and Anchor.toml configs.
  - Mainnet protection state machine prevents accidental deployments.

---

## 10. Native Toolchains (Rust, C, C++, Go)
- **Status**: **[BLOCKED]** in pure browser SPA; **[PLANNED]** for desktop shell.
- **Notes**: Full native compilation of Rust (`rustc`), C (`clang`/`gcc`), or Go (`go build`) requires host OS processes, which cannot execute inside a client-side browser sandbox without a native desktop wrapper (e.g. Tauri) or remote build worker.

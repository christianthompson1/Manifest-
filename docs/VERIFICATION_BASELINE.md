# Manifest Studio — Verification Baseline

Date: 2026-10-21
Environment: Linux x86_64, Node.js v22.14.0, Vite v8.3.1, TypeScript v7.0.2

---

## 1. Baseline Test & Build Results

| Check / Command | Exit Code | Result Summary | Environment / Test Harness |
|---|---|---|---|
| `npm run lint` (`tsc --noEmit`) | **0** | Clean, 0 TypeScript type errors | Node.js TS compiler |
| `npm run manifest:test` | **0** | 268/268 tests passed, 0 failures | In-memory simulated DOM / Node.js test harness |
| `npm run build` (`vite build`) | **0** | Built production bundle in 1.42s | Rollup / Vite production build |
| Headless Browser Automation | **N/A** | Binary not available (`which chromium` returned 1) | In-memory DOM testing used |

---

## 2. Test Breakdown (268 Total Automated Tests)

1. **Manifest v0.1 Core Language Tests** (42 tests): Lexer tokens, basic AST statements, arithmetic, loops, assignments.
2. **Manifest v0.2 Application Tests** (29 tests): Multi-statement applications, page routing, state initialization.
3. **Manifest v0.3 UI Primitives & Styling Tests** (39 tests): Container, button, text, styles normalization, IR retention.
4. **Manifest v0.4 Solana & IDE Architecture Tests** (43 tests): Anchor generator, LiteSVM simulator, language providers.
5. **GitHub Import Tests** (18 tests): URL parsing, binary asset preservation, zip extraction.
6. **Mobile IDE Controls Tests** (21 tests): Narrow viewports (360px, 390px, 430px), touch targets >= 44px, bottom sheet reaches.
7. **Styled Dashboard Verification Tests** (47 tests): End-to-end pipeline trace from source code to simulated DOM computed styles, counter reactive state click update (0 -> 1), mount clearing.
8. **Execution Orchestrator & Static Web Provider Tests** (29 tests): Project detection, multi-file HTML/CSS/JS inlining, relative path resolution, console bridge, async race condition guard.
9. **Real Solana LiteSVM Counter Transition & Underflow Test**: Instructions execution and error reporting.

---

## 3. Known Issues Under Audit

1. **Editor Cursor Jumping to Line 1**: Reported cursor reset while typing.
2. **Preview Stale Synchronization**: Switching between Web and Manifest projects or editing Manifest source after deleting HTML can retain older preview state if project kind detection or entry file resolution defaults to old cache.
3. **Runtime vs JS Target Discrepancy**: Clarifying what `runtime.ts` interprets vs what `js-target.ts` compiles.
4. **Autocomplete & Diagnostics Completeness**: Distinguishing basic token lists from scope-aware semantic completions.
5. **WebAssembly Capability Status**: Determining whether WASM is executable, compilable, or future-planned.
6. **File Management Completeness**: Auditing operations (create, rename, move, duplicate, delete) across virtual filesystem and IndexedDB.

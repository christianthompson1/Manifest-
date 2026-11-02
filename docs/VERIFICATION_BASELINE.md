# Manifest Studio — Verification Baseline & Post-Audit Results

Environment: Linux `4.19.0-gvisor x86_64`, Node.js `v22.23.4`, npm `10.9.9`, Vite `v8.3.0`, TypeScript `v7.0.2`

---

## 1. Pre-Repair Baseline vs Post-Repair Verification

| Check / Command | Pre-Repair Baseline | Post-Repair Verified Result | Notes |
|---|---|---|---|
| `npm run lint` (`tsc --noEmit`) | Exit `0` (0 TS errors) | **Exit `0` (0 TS errors)** | Full strict TypeScript validation across `manifest-core` and `src/` |
| `npm run manifest:test` | Exit `0` (`268/268` core + LiteSVM + `29/29` orchestrator + `8/8` editor) | **Exit `0` (`299/299` core/audit + LiteSVM + `29/29` orchestrator + `8/8` editor)** | Added 31 differential parity, validator, routing, asset, `.wasm`, tree & binary ZIP assertions |
| `npm run manifest:bench` | 96–20,000 lines (`6.77ms`–`129.62ms`), 100-iter runtime (`1.29ms`) | **93–19,987 lines (`2.74ms`–`99.88ms` 1-pass), pathological stress, 10K-iter runtime (`11.52ms`), DOM mount** | Realistic multi-construct + pathological inputs + heap delta + linter pass latency |
| `npm run build` (`vite build`) | Exit `0` (`2.04s`) | **Exit `0`** | Full production SPA bundle |
| Headless Browser Automation | Unavailable (`NO_BROWSER_BINARY`) | **Unavailable (`NO_BROWSER_BINARY`)** | No Chromium/Playwright binary installed in container; interactive browser flows require manual verification |

---

## 2. Automated Test Suite Breakdown (`npm run manifest:test`)

1. **Manifest v0.1 Core & Compiler Tests**: `42/42` passed
2. **Manifest v0.2 Application Primitives Tests**: `29/29` passed
3. **Manifest v0.3 UI Primitives & Styling Tests**: `39/39` passed
4. **Manifest v0.4 Solana, IDE & Architecture Tests**: `43/43` passed
5. **GitHub Import Provider Tests**: `18/18` passed
6. **Mobile IDE Controls Tests**: `21/21` passed
7. **Styled Dashboard End-to-End Verification Tests**: `47/47` passed
8. **Execution Orchestrator & Static Web Provider Tests**: `29/29` passed (invoked in `run_tests.ts` and standalone CLI check)
9. **Integrated Audit & Differential Parity Suite (`run_audit_verification_tests.ts`)**: `31/31` passed:
   - Differential Interpreter (`Runtime`) vs JS Target (`JSTargetCompiler`) parity across unary operators, array indexing, `ACTION` control flow (`IF/ELSE`, `REPEAT`, `FOR EACH`), recursive `factorial` with lexical parameter shadowing, `TRY / IF FAILED` division-by-zero recovery, and recursion depth (`>200`) guards.
   - `BADGE`, `PROGRESS`, `ICON`, and `CSS` escape lowering to DOM elements.
   - Two-pass semantic validation (undefined `ACTION`, duplicate `ACTION`, top-level `RETURN`, missing `ROUTE` target `PAGE`, literal `/ 0` warning).
   - Honest refusal on `.py`, `.rs`, `.c`, `.ts` active files (never executing `src/main.manifest`), exact active secondary `.manifest` execution, explicit failure on missing `manifest.toml` `entry`, async run superseding (`superseded: true`), and `LanguageRegistry` TOML/JSON classification.
   - Multi-file HTML/CSS (`url(...)`)/JS/SVG data-URL bundling, line-accurate missing asset warnings, and standalone `.js` execution harness.
   - Real `.wasm` MVP (`STARTER_WASM_BYTES` -> `42`) and WASI `fd_write` (`"Hello WASI"`) execution + corrupt binary diagnostic rejection.
   - Recursive `buildProjectTree` `.gitkeep` handling and byte-exact binary `.wasm` + editable `.svg` ZIP export/import round-trip.
10. **Real Solana Counter LiteSVM State Transition & Underflow Test (`run_solana_counter_test.ts`)**: `ALL PASSED` (`150 CU` per instruction, controlled `0x1773` underflow error).
11. **Editor State & Sync Regression Tests (`run_editor_tests.ts`)**: `8/8` passed.

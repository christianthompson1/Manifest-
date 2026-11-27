# Manifest Language & Manifest Studio — Verification Baseline (Stage 6 & Stage 7)

Environment: Linux `4.19.0-gvisor x86_64`, Node.js `v22.23.5`, TypeScript `v7.0.2`, Vite `v8.3.0`. Authoritative Rust `manifest-compiler` + `mvm-core` executed via prebuilt `public/wasm/mvm_wasm.wasm` (SHA-256 verified).

> **Host Toolchain Limitation**: `cargo`, `rustc`, and native `mvm/target/release/mvm` are **not installed** in this host container. Consequently, `cargo test --manifest-path mvm/Cargo.toml`, native `rustc` ELF binary compilation, and native `mvm` CLI binary benchmarks were **not executed** in this container and are reported honestly as skipped / not-run.

---

## 1. End-to-End Verification Matrix

| Check / Command | Verified Result | Notes |
|---|---|---|
| `npm run lint` (`tsc --noEmit`) | **Exit `0` (`0` TS errors)** | Full TypeScript type-check across `manifest-core/`, `src/`, and `server.ts` |
| `npm run manifest:test` | **Exit `0`** | Runs `run_stage6_authoritative_rust_tests.ts`, `run_stage7_canonical_v1_tests.ts` (`23/23`), `run_solana_counter_test.ts` (`3 passed, 1 skipped`), `run_orchestrator_tests.ts` (`29/29`), `run_editor_tests.ts` (`8/8`), and `run_v1_upgrade_tests.ts` (`63 passed, 0 failed, 2 skipped`) |
| `npx tsx manifest-core/tests/run_batch1_security_and_honesty_tests.ts` | **Exit `0` (`37/37` passed)** | Live `/api/tests/run`, `/api/solana/*`, failure honesty, and capability enforcement |
| `npx tsx manifest-core/tests/run_audit_verification_tests.ts` | **Exit `0` (`28/28` passed)** | Cross-engine parity (`runManifestOnRustMvm` vs `evaluateMIRModule` vs `web-js`), static diagnostics, and v0.x removal |
| `npx tsx manifest-core/tests/run_ecosystem_assets_tests.ts` | **Exit `0` (All passed)** | Official brand assets, workspace asset path sanitization (`W_ASSET_UNSAFE_PATH`), and landing module checks |
| `npm run manifest:bench` | **Exit `0`** | Canonical v1.0 scaling (`93..4,993` lines), pathological inputs, and Collatz(`2..2500`) across TS MIR, Rust MVM WASM, and Direct `.wasm` (native CLI skipped) |
| `npm run context:refresh` | **Exit `0`** | Regenerates non-normative `/docs/AI_CONTEXT_SUMMARY.md` |
| Markdown Link Check (`21` `.md` files) | **Exit `0` (`0` broken relative links)** | Verified across `/README.md`, `/CONTRIBUTING.md`, `/manifest-core/README.md`, and `/docs/**/*.md` |
| `npm run build` (`vite build`) | **Exit `0`** | Full production SPA bundle including offline `mvm_wasm.wasm` |
| Headless Browser Verification (`playwright-cli` Chromium) | **Passed (`0` console errors)** | Verified Studio initial load + Rust MVM execution preview (`Hello World`), Testbench modal (`23/23 ALL PASSING`, Typed MIR, `.mbc` disassembly), `Manifest Official Landing & Ecosystem` `web-js` iframe execution (`Return: 4`), and mobile (`390x844`) responsive drawer |
| `cargo test --manifest-path mvm/Cargo.toml` | **Not run (`cargo` unavailable)** | Host container lacks `cargo` / `rustc`; Rust workspace tests require a Rust toolchain host |

---

## 2. Automated Verification Coverage Summary

1. **Stage 6 Authoritative Rust Engine (`run_stage6_authoritative_rust_tests.ts`)**:
   - SHA-256 verification of `public/wasm/mvm_wasm.wasm`, authoritative `manifest-compiler` diagnostics, Beginner/Professional MIR equivalence, transitive capability checks, and cross-target execution (`29 passed, 0 failed, 1 skipped` — native `mvm` binary suite skipped).
2. **Stage 7 Canonical Manifest v1.0 Architecture (`run_stage7_canonical_v1_tests.ts` — `23/23` Passed)**:
   - Complete removal of legacy v0.x compilation (`E_LEGACY_V0_REMOVED` for `APP`, `PAGE`, `STATE`, `ACTION`, `DEFINE`, `COMPONENT`, `WHEN app.starts`, `USE WEB`, `USE SOLANA`), explicit opt-in `migrateV0ToV1` / `manifest migrate`, canonical v1.0 Starter templates, standalone `PROGRAM` Solana Anchor + LiteSVM verification, and live Express HTTP `/api/compile` + `/api/tests/run` + `/api/solana/verify`.
3. **Manifest v1.0 Upgrade & Conformance Suite (`run_v1_upgrade_tests.ts` — `63 passed, 0 failed, 2 skipped`)**:
   - Dual syntax profiles & formatter round-trip (`8/8`), multi-file modules (`3/3`), generics/`Result<T, E>?`/`match` (`7/7`), capability & transitive effect verification (`4/4`), MIR optimizer & trap preservation (`4/4`), `.mbc` container verification & Rust MVM security guards (`9/9`), cross-target conformance (`ts-mir`, `rust-mvm-wasm`, `direct-wasm`, `web-js`, planned target guards; native CLI & `rustc` ELF skipped), CLI subcommands, and all 9 `/examples/**` programs.
4. **Solana & Studio Integration Suites**:
   - `run_solana_counter_test.ts`: `3 passed` (1 real LiteSVM SOL transfer `150 CU`, 2 JS-simulated Counter transitions), `1 skipped` (custom SBF `.so` compilation), `0 failed`.
   - `run_orchestrator_tests.ts`: `29/29` passed.
   - `run_editor_tests.ts`: `8/8` passed.
   - `run_batch1_security_and_honesty_tests.ts`: `37/37` passed.
   - `run_audit_verification_tests.ts`: `28/28` passed.
   - `run_ecosystem_assets_tests.ts`: All passed.

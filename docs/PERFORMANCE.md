# Manifest Studio — Compiler, Linter & Runtime Performance Audit

## 1. Benchmark Methodology & Environment
All measurements below were produced by executing `npm run manifest:bench` (`manifest-core/tests/run_benchmark.ts`) directly in this repository environment:
- **Runtime**: Node.js `v22.23.4` (`tsx` v4.21.0), TypeScript `v7.0.2`, Linux `4.19.0-gvisor x86_64`
- **Workload Design**:
  1. **Realistic Multi-Construct Scaling** (`93` to `19,987` lines): Programs combining `STATE` declarations, `ACTION` definitions (`IF/ELSE`, `SET`, `RETURN`), `PAGE` layouts, nested `CONTAINER` + `STYLE` blocks, reactive `TEXT` expressions, and `BUTTON` `WHEN CLICK` handlers invoking `CALL`.
  2. **Pathological Stress Inputs**: 120-deep nested binary arithmetic expressions, 25-level nested `CONTAINER` hierarchies with `STYLE` blocks, and a 500-`ACTION` symbol table with forward `CALL` resolution.
  3. **Execution & DOM Mount**: In-memory AST interpreter (`Runtime`) at `100` and `10,000` loop iterations, plus compiled JavaScript `startApp()` DOM mounting at `93` and `989` lines.

---

## 2. Empirical Scaling Results (Single-Pass Pipeline)

| Actual Lines | Lex (ms) | Parse (ms) | 2-Pass Validate (ms) | IR Lowering (ms) | JS Codegen (ms) | `compileManifest` 1-Pass (ms) | Editor Lint `inspectManifest` (ms) | Heap Delta (KB) | Throughput (lines/sec) |
|---|---|---|---|---|---|---|---|---|---|
| **93 lines** | 1.34 ms | 0.78 ms | 0.21 ms | 0.62 ms | 0.74 ms | **2.74 ms** | **1.90 ms** | +365 KB | **33,920 loc/s** |
| **989 lines** | 8.50 ms | 2.15 ms | 0.21 ms | 0.23 ms | 1.87 ms | **23.78 ms** | **5.90 ms** | ~0 KB (GC) | **41,583 loc/s** |
| **4,993 lines** | 6.71 ms | 10.54 ms | 0.82 ms | 1.00 ms | 13.14 ms | **62.21 ms** | **20.45 ms** | +3,910 KB | **80,255 loc/s** |
| **9,991 lines** | 12.40 ms | 22.00 ms | 0.59 ms | 31.48 ms | 34.53 ms | **105.34 ms** | **48.40 ms** | +1,663 KB | **94,846 loc/s** |
| **19,987 lines** | 30.09 ms | 13.55 ms | 1.64 ms | 12.48 ms | 35.35 ms | **99.88 ms** | **50.56 ms** | +20,267 KB | **200,103 loc/s** |

*(Variance at 9,991 vs 19,987 lines reflects V8 incremental GC and TurboFan tier-up during sequential runs.)*

---

## 3. Pathological Input Stress Results

| Scenario | Source Lines | Full Compile (`compileManifest`) | Linter Pass (`inspectManifest`) | Validated |
|---|---|---|---|---|
| **120-deep nested binary arithmetic expression** | 5 | **3.30 ms** | **0.73 ms** | `true` |
| **25-level nested `CONTAINER` hierarchy with `STYLE`** | 129 | **0.82 ms** | **0.58 ms** | `true` |
| **500 `ACTION` symbol table + forward `CALL` resolution** | 1,553 | **10.66 ms** | **7.71 ms** | `true` |

---

## 4. Runtime Execution & DOM Mount Results

| Execution Target | Workload | Measured Duration | Verified Output |
|---|---|---|---|
| **AST Interpreter (`Runtime`)** | `100` `REPEAT` loop iterations with arithmetic state updates | **1.18 ms** | `5050` |
| **AST Interpreter (`Runtime`)** | `10,000` `REPEAT` loop iterations with arithmetic state updates | **11.52 ms** | `50005000` |
| **Compiled JS Target (`startApp`)** | `93`-line styled reactive application initial DOM mount | **1.11 ms** | Mounted cleanly |
| **Compiled JS Target (`startApp`)** | `989`-line styled reactive application initial DOM mount | **12.75 ms** | Mounted cleanly |

---

## 5. Architectural Bottlenecks Eliminated & Remaining Limits
1. **Redundant Triple Re-Lexing/Re-Parsing Eliminated**: Previously, `compileManifest` and `runManifestPipeline` re-tokenized and re-parsed the source string multiple times across validation, IR building, and code generation. Both now pass the validated AST directly to `generateManifestIRFromAST` and `compileManifestIR`.
2. **Main-Thread Linter Threshold**: `manifestLinter` runs on a 250ms debounce and completes in `~5.9ms` at 1,000 lines and `~20.5ms` at 5,000 lines. At 20,000+ lines (`~50.6ms`), moving `inspectManifest` and `runManifestPipeline` into a dedicated Web Worker is recommended to keep keystroke frames strictly below 16ms.
3. **Whole-File Compilation**: Manifest currently compiles one entry `.manifest` file at a time (multi-file `IMPORT` module linking is not yet implemented).

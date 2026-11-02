# Manifest Studio — AI Context Grounding Document

This document provides a verified source of truth for engineers and AI agents working on the Manifest Studio repository.

---

## 1. Repository Layout & Subsystems

- `manifest-core/`: Pure TypeScript Manifest compiler and runtime package.
  - `src/lexer/`: Tokenizer (`tokens.ts`, `lexer.ts`).
  - `src/parser/`: Recursive descent parser with unary, postfix indexing, UI primitives, and Solana grammar (`parser.ts`, `ast/ast.ts`).
  - `src/validator/`: Two-pass semantic validator (`validator.ts`) supporting forward `ACTION`/`PAGE` references, arity warnings, `RETURN` scope checks, and `ROUTE` page checks.
  - `src/ir/`: Target-agnostic Manifest IR builder (`ir.ts`, `ir-builder.ts`).
  - `src/compiler/`: Single-pass pipeline (`compiler.ts`) and target generators (`targets/js-target.ts`, `targets/solana-target.ts`).
  - `src/runtime/`: Headless AST interpreter (`runtime.ts`, `scope.ts`) verified for behavioral parity with `js-target.ts`.
  - `tests/`: Automated test suites (`run_tests.ts`, `run_audit_verification_tests.ts`, `run_orchestrator_tests.ts`, `run_editor_tests.ts`, `run_solana_counter_test.ts`, `run_benchmark.ts`).
- `src/studio/`: React 19 + CodeMirror 6 IDE application.
  - `Studio.tsx`: Main workspace state, hydration guard, reference-aware file/folder operations, and Run/Build lifecycle.
  - `execution/`: `execution-orchestrator.ts`, `manifest-execution-provider.ts`, `static-web-execution-provider.ts`, `wasm-execution-provider.ts`, `execution-types.ts`.
  - `editor/`: `CodeMirrorEditor.tsx` (per-file LRU `EditorState` cache, `Compartment` reconfiguration, IME guard, binary read-only view), `manifest-language.ts`, `manifest-autocomplete.ts`, `manifest-linter.ts`.
  - `explorer/ProjectTree.tsx` & `sidebar/Sidebar.tsx`: Recursive folder/file explorer with inline two-step delete confirmation.
  - `languages/`: `language-registry.ts` & `language-provider.ts` (truthful capability metadata across 24 language/config/binary providers).
  - `preview/PreviewPanel.tsx`: Strict `<iframe sandbox="allow-scripts">` preview with entry badge and diagnostic error states.
  - `project-store.ts` & `services/zip-service.ts`: Multi-project IndexedDB storage (`idb-keyval`) and binary-safe ZIP import/export.

---

## 2. Non-Negotiable Engineering Rules

1. **Never Claim Unimplemented Execution**: Python, Rust, TypeScript, C/C++, Go, Java, SQL, etc. are editing-only in the browser SPA. Compiled `.wasm` binaries execute via `WasmExecutionProvider`, whereas **Manifest-to-WASM compilation is NOT implemented**.
2. **Never Silently Switch Entry Files**: Running an unsupported file must fail with `unsupported-language`; running a secondary `.manifest` file must execute that file; missing configured entry files must fail explicitly.
3. **Preserve Iframe & Browser Constraints**: Keep `<iframe sandbox="allow-scripts">` (never add `allow-same-origin`), and never use `window.alert`, `window.confirm`, `window.prompt`, or `window.open`.
4. **Preserve Matte Charcoal Aesthetic**: Keep `#181818` / `#1f1f1f` / `#252526` / `#2d2d2d` surfaces without neon glows.
5. **Run Full Verification**: Always verify `npm run lint`, `npm run manifest:test` (`299/299` + LiteSVM + `29/29` + `8/8`), and `npm run build`.

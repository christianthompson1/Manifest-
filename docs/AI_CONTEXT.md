# Manifest Studio — AI Context Grounding Document

This document provides a single, grounded source of truth for future AI agents working on the Manifest Studio repository. All statements below reflect verified files, interfaces, and behaviors in the codebase.

---

## 1. Repository Layout & Major Components

- `manifest-core/`: Pure TypeScript Manifest language core (zero external UI dependencies).
  - `src/lexer/`: Lexer and token definitions (`tokens.ts`, `lexer.ts`).
  - `src/parser/`: Recursive descent parser (`parser.ts`, `ast/ast.ts`).
  - `src/validator/`: Semantic analysis and error diagnostics (`validator.ts`).
  - `src/ir/`: Target-agnostic intermediate representation builder (`ir.ts`, `ir-builder.ts`).
  - `src/compiler/targets/`: Code generators (`js-target.ts`, `solana-target.ts`).
  - `src/runtime/`: Language runtime semantics (`runtime.ts`, `scope.ts`, `values.ts`).
  - `tests/`: Automated test runner and suites (`run_tests.ts`, `run_orchestrator_tests.ts`, `run_styled_dashboard_tests.ts`).
- `src/studio/`: React 19 web IDE interface.
  - `Studio.tsx`: Primary IDE layout, file management, active tabs, and Run/Build handlers.
  - `execution/`: Unified multi-language execution providers (`execution-orchestrator.ts`, `manifest-execution-provider.ts`, `static-web-execution-provider.ts`, `execution-types.ts`).
  - `preview/PreviewPanel.tsx`: Sandboxed iframe preview, Developer Inspector (Console, State, Elements, Events, IR, Target Code).
  - `editor/`: CodeMirror 6 editor wrapper with custom Lezer Manifest grammar, autocomplete, and linter.
  - `project-store.ts`: Project management and IndexedDB offline persistence (`idb-keyval`).
  - `types.ts`: Core data structures (`ManifestProject`, `ProjectFile`, `BuildResult`, `UnifiedExecutionResult`).
- `docs/`: Master architectural documents (`ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`, `LANGUAGE_SUPPORT.md`, `AI_CONTEXT.md`).
- `server.ts`: Lightweight Express backend serving the applet and optional Solana proxy RPC endpoints.

---

## 2. Key Entry Points & Interfaces

- **Run Trigger**: `Studio.tsx` -> `handleRun()`. Uses `ExecutionOrchestrator.getInstance().executeProject(project, options)` to select the proper provider and execute code without race conditions.
- **Manifest Pipeline**: `CompilerService.runManifestPipeline(source, target)`.
- **Preview Mount**: `PreviewPanel.tsx` -> `srcDoc={generatePreviewSrcDoc()}` in sandboxed iframe with `sandbox="allow-scripts"`.
- **Project Storage**: `project-store.ts` -> `saveProjectAsync(project)` writes to both `localStorage` and `IndexedDB`.

---

## 3. Ground Rules & Strict Boundaries for AI Engineers

1. **Never Invent Files or APIs**: Always verify paths using `view_file` or `list_dir`.
2. **Never Claim a Language Runs if it Only Parses**: A recognized file extension or syntax highlighter is NOT an execution provider.
3. **No Unsafe Code Evaluation**: Do not use unrestricted `eval()` or `new Function()` in main window scopes.
4. **Preserve the Matte Charcoal Theme**: Panels `#181818`, Editor `#1f1f1f`, Borders `#2d2d2d`. No neon colors.
5. **Multi-File Web Projects**: Ordinary HTML/CSS/JS projects MUST run through `StaticWebExecutionProvider`, NOT the Manifest compiler.
6. **Always Run Existing Tests Before Finishing**: Run `npm run lint` and `npm run manifest:test`. All 268 tests must pass.

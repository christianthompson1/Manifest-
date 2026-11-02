# Manifest Studio — Auto-Generated Repository Context Summary
Generated at: 2026-11-01T16:54:47.225Z

## Package & Dependency Baseline
- Application: react-example (v0.0.0)
- Dependencies: 41 packages
- Dev Dependencies: 10 packages

## Component Distribution
- Manifest Core: 31 source files
- Studio UI & Services: 40 source files
- Automated Test Suites: 13 test runners

## Key Architecture Subsystems
- Manifest Single-Pass Compiler & Two-Pass Validator: `manifest-core/src/compiler/compiler.ts`, `manifest-core/src/parser/parser.ts`, `manifest-core/src/validator/validator.ts`
- Manifest IR, JS Target & Parity Runtime: `manifest-core/src/ir/ir-builder.ts`, `manifest-core/src/compiler/targets/js-target.ts`, `manifest-core/src/runtime/runtime.ts`
- Execution Orchestrator & Providers: `src/studio/execution/execution-orchestrator.ts`, `manifest-execution-provider.ts`, `static-web-execution-provider.ts`, `wasm-execution-provider.ts`
- CodeMirror 6 Editor & Recursive Explorer: `src/studio/editor/CodeMirrorEditor.tsx`, `src/studio/explorer/ProjectTree.tsx`
- Sandboxed Preview: `src/studio/preview/PreviewPanel.tsx`

## Verification Commands
- TypeScript typecheck: `npm run lint`
- Manifest language, parity, .wasm & provider tests: `npm run manifest:test`
- Compiler & runtime benchmarks: `npm run manifest:bench`
- Production bundle: `npm run build`
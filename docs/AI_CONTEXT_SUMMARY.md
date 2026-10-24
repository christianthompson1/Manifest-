# Manifest Studio — Auto-Generated Repository Context Summary
Generated at: 2026-10-21T01:18:58.196Z

## Package & Dependency Baseline
- Application: react-example (v0.0.0)
- Dependencies: 41 packages
- Dev Dependencies: 10 packages

## Component Distribution
- Manifest Core: 31 source files
- Studio UI & Services: 39 source files
- Automated Test Suites: 10 test runners

## Key Architecture Subsystems
- Manifest Parser & Validator: `manifest-core/src/parser/parser.ts`, `manifest-core/src/validator/validator.ts`
- Manifest IR & JS Compiler: `manifest-core/src/ir/ir-builder.ts`, `manifest-core/src/compiler/targets/js-target.ts`
- Execution Orchestrator: `src/studio/execution/execution-orchestrator.ts`
- Static Web Provider: `src/studio/execution/static-web-execution-provider.ts`
- Sandboxed Preview: `src/studio/preview/PreviewPanel.tsx`

## Verification Commands
- TypeScript typecheck: `npm run lint`
- Manifest language & provider tests: `npm run manifest:test`
- Production bundle: `npm run build`
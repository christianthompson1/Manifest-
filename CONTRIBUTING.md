# Contributing to Manifest & Manifest Studio

Thank you for your interest in contributing to the **Manifest** programming language, compiler toolchain, runtime systems, and Manifest Studio development environment.

---

## 1. Repository Structure

```
├── manifest-core/               # Authoritative Manifest Compiler & Language Runtime
│   ├── src/
│   │   ├── core/                # Lexer, BeginnerParser, ProfessionalParser, AST-v2
│   │   ├── semantics/           # TypeChecker, ModuleResolver, CapabilityAnalyzer
│   │   ├── ir/                  # Typed Manifest IR (MIRModule, MIRFunction, Optimizer)
│   │   ├── bytecode/            # .mbc Compiler, Reader, Format, Verifier
│   │   ├── targets/             # WasmTarget, WebJSTarget, NativeTarget, SolanaTarget
│   │   ├── vm/                  # MvmHeapArena (Mark & Sweep GC), MvmInterpreter, Runner
│   │   ├── stdlib/              # Standard Library Registry (std::* modules)
│   │   ├── package/             # SemVer, DependencyResolver, PackageManager
│   │   ├── pipeline.ts          # Consolidated compilation pipeline (check & compile)
│   │   └── cli.ts               # CLI command entry point (`manifest`)
│   └── tests/                   # Automated regression and integration test suites
├── mvm/                         # Rust Manifest Virtual Machine Workspace
│   └── crates/
│       ├── mvm-core/            # Pure safe Rust MVM (#![forbid(unsafe_code)])
│       ├── mvm-cli/             # Native command-line runner
│       └── mvm-wasm/            # WebAssembly build for in-browser VM execution
├── src/                         # Manifest Studio React + TypeScript Frontend
│   └── studio/
│       ├── editor/              # CodeMirror 6 editor & live manifestLinter
│       ├── explorer/            # Multi-file explorer & project tree
│       ├── sidebar/             # Sidebar (Explorer, Packages, Solana, Settings)
│       └── execution/           # Execution providers (MVM, Web, Wasm, Solana)
└── docs/                        # Normative specifications & architecture guides
```

---

## 2. Prerequisites & Setup

- **Node.js**: v20+ or v22+
- **npm**: v9+
- **TypeScript**: 5.x
- **Rust** (optional, for native MVM binary builds): 1.80+

```bash
# Clone and install dependencies
git clone https://github.com/manifest-lang/manifest.git
cd manifest
npm install
```

---

## 3. Running Test Suites

All tests in Manifest run through `tsx` and are completely automated without flaky external mocks:

```bash
# Run Core Language & System Test Suites (300+ tests)
npm run manifest:test

# Run Phase 3 Compiler Consolidation & Parity Tests
npm run manifest:test:phase3

# Run Phase 4 & Phase 5 MVM Runtime & Package System Tests
npm run manifest:test:phase45

# Run Solana Anchor & Counter Integration Test
npx tsx manifest-core/tests/run_solana_counter_test.ts

# Type-check entire codebase
npm run lint
```

---

## 4. Engineering Standards & Rules

1. **Safety & Zero-Unsafe**: Rust code inside `mvm/crates/mvm-core` must maintain `#![forbid(unsafe_code)]`.
2. **Honesty Over Claims**: Never mark a feature, package, or target as implemented if it is a placeholder or mock. Always emit explicit diagnostics (such as `E_TARGET_PLANNED` or `E_UNIMPLEMENTED_FEATURE`) when a feature is not yet available.
3. **Deterministic Memory**: All MVM allocations must be tracked in `MvmHeapArena`. All references must be verified through the Mark-and-Sweep garbage collector with explicit root providers.
4. **Exact Numeric Semantics**: 64-bit integer calculations must maintain signed 64-bit precision without lossy floating-point conversions.
5. **Capability Gating**: Sensitive capabilities (`fs.read`, `fs.write`, `net`, `time`, `crypto`) must be declared, verified statically, and granted explicitly by the embedding host environment.
6. **Reproducible Packages**: Any changes to packages or dependencies must generate valid `manifest.toml` files and reproducible `manifest.lock` files with SHA-256 integrity checksums.

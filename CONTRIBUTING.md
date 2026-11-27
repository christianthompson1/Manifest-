# Contributing to Manifest & Manifest Studio

Thank you for your interest in contributing to the **Manifest** programming language, compiler toolchain, runtime systems, and Manifest Studio development environment.

---

## 1. Repository Structure

```
├── manifest-core/               # Manifest Compiler Bridge, Target Codegen & Tooling
│   ├── src/
│   │   ├── core/                # Canonical AST-v2, TS fallback parsers, profile & formatter
│   │   ├── engine/              # Authoritative Rust WASM engine loader & SHA-256 verification
│   │   ├── migration/           # Explicit opt-in v0.x -> v1.0 migrator (`manifest migrate`)
│   │   ├── semantics/           # ModuleResolver, TypeChecker & Capability/Effect metadata
│   │   ├── ir/                  # Typed Manifest IR types, Reference MIR Evaluator & Optimizer
│   │   ├── bytecode/            # .mbc Format, Reader & Verifier
│   │   ├── targets/             # Target registry, WebJSTarget, WasmTarget, NativeTarget, SolanaTarget
│   │   ├── vm/                  # MvmRunner (Rust MVM WASM + native CLI bridge) & VirtualFS
│   │   ├── solana/              # Standalone PROGRAM parser, Anchor generator & LiteSVM bridge
│   │   ├── stdlib/              # Standard Library Registry (`std::*` modules)
│   │   ├── package/             # SemVer, DependencyResolver, Lockfile & PackageManager
│   │   ├── pipeline.ts          # Authoritative compilation pipeline (check, compile, run)
│   │   └── cli.ts               # CLI command entry point (`manifest`)
│   └── tests/                   # Automated regression and integration test suites
├── mvm/                         # Authoritative Rust Compiler & MVM Workspace
│   └── crates/
│       ├── manifest-compiler/   # Authoritative Rust lexer, parser, semantics, MIR, optimizer & .mbc compiler
│       ├── mvm-core/            # Pure safe Rust MVM (#![forbid(unsafe_code)]) with mark-sweep GC
│       ├── mvm-cli/             # Native Rust CLI & MVM bytecode runner
│       └── mvm-wasm/            # WebAssembly build (`public/wasm/mvm_wasm.wasm`) for Node & browser
├── src/                         # Manifest Studio React + TypeScript Frontend
│   └── studio/
│       ├── editor/              # CodeMirror 6 editor & live manifestLinter
│       ├── explorer/            # Multi-file explorer & project tree
│       ├── sidebar/             # Sidebar (Explorer, Packages, Solana, Settings)
│       └── execution/           # Execution providers (MVM, Web, Wasm, Solana)
├── server.ts                    # Localhost Express API + Vite dev middleware
└── docs/                        # Normative specifications & architecture guides
```

---

## 2. Prerequisites & Setup

- **Node.js**: v20+ or v22+
- **npm**: v9+
- **TypeScript**: 5.x+ (repo uses TypeScript `7.0.2`)
- **Rust** (optional, required to run `cargo test` or rebuild `mvm_wasm.wasm` / native `mvm` CLI): 1.80+

```bash
# Clone and install dependencies
git clone https://github.com/manifest-lang/manifest.git
cd manifest
npm install
```

---

## 3. Running Test Suites

```bash
# Unified Manifest v1.0 + Stage 6 + Stage 7 + Studio + Solana Test Suite
npm run manifest:test

# Individual Verification Suites
npm run manifest:test:stage5
npm run manifest:test:stage6
npm run manifest:test:stage7
npx tsx manifest-core/tests/run_batch1_security_and_honesty_tests.ts
npx tsx manifest-core/tests/run_audit_verification_tests.ts
npx tsx manifest-core/tests/run_ecosystem_assets_tests.ts

# Type-check & Production Build
npm run lint
npm run build

# Benchmarks
npm run manifest:bench

# Rust Workspace Tests (requires cargo / rustc toolchain)
cargo test --manifest-path mvm/Cargo.toml
```

---

## 4. Engineering Standards & Rules

1. **Safety & Zero-Unsafe**: Rust code inside `mvm/crates/mvm-core` must maintain `#![forbid(unsafe_code)]`.
2. **Canonical v1.0 Language**: Legacy v0.x keywords (`APP`, `PAGE`, `STATE`, `ACTION`, `USE WEB`, `USE SOLANA`) are removed from compilation and rejected with `E_LEGACY_V0_REMOVED`; explicit opt-in conversion is handled exclusively by `manifest migrate`.
3. **Honesty Over Claims**: Never mark a feature, package, or target as implemented if it is a placeholder or mock. Always emit explicit diagnostics (such as `E_TARGET_PLANNED` or `E_UNIMPLEMENTED_FEATURE`) when a feature is not yet available.
4. **Deterministic Memory & Metering**: All MVM allocations must be tracked within configured heap limits with Mark-and-Sweep GC reclamation, and all bytecode execution (including `__init__` and invoked functions) must enforce cumulative step/fuel metering.
5. **Capability Gating**: Sensitive capabilities (`fs.read`, `fs.write`, `net`, `time`, `crypto`) must be declared, verified statically, and granted explicitly by the embedding host environment.
6. **Reproducible Packages**: Any changes to packages or dependencies must generate valid `manifest.toml` files and reproducible `manifest.lock` files with SHA-256 integrity checksums.

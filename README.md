
## 1. Core Identity & Domains

# Manifest & Manifest Studio

**Manifest** is a capability-secure, deterministic programming language and `#![forbid(unsafe_code)]` Rust Virtual Machine (`mvm`) built for running untrusted plugins, AI agent sandboxes, and verifiable programs with bounded resources.

**Manifest Studio** is a zero-install, offline-capable browser IDE for writing, statically verifying, compiling, and inspecting Manifest programs with support for `.mbc` bytecode, WebAssembly, and inspectable Solana Anchor Rust + IDL generation.

---

## Why Manifest?

Modern scripting runtimes (JS, Python, Lua) grant scripts ambient authority by default. Manifest enforces **explicit, verifiable capabilities** from source code down to the VM:

1. **Compile-Time & Runtime Capability Gates** — Scripts must explicitly declare `requires` / `denies` (`console`, `fs.read`, `fs.write`, `net`, `crypto`, `db`). Permissions are verified statically, embedded in the `.mbc` binary header, and enforced by the Rust VM at runtime.
2. **Deterministic Resource Bounds** — `mvm-core` (`#![forbid(unsafe_code)]`) executes bytecode with strict step budgets and explicit host FFI boundaries—ideal for embedding untrusted plugins or AI-generated code inside Rust applications.
3. **Two Interchangeable Syntax Profiles** — Write in concise **Professional** syntax (`fn`, `{}`) or readable **Beginner** syntax (`FUNCTION ... END`). Both normalize to the exact same AST, Typed IR, and `.mbc` bytecode.
4. **Zero-Install Browser IDE & Solana Anchor Lowering** — Author and inspect bytecode, Typed IR, or generated Anchor Rust + IDL directly in **Manifest Studio** without heavy local toolchains.

---


## 2. Two Syntax Profiles, One Language

Manifest provides **two first-class surface syntax profiles** that normalize to the **exact same `SemanticModule` AST**, static type checker, capability/effect analyzer, Typed Manifest IR, `.mbc` bytecode, and Rust Virtual Machine:

- **Beginner Profile** — Structured, keyword-guided blocks (`MODULE`, `REQUIRES`, `LET`, `MUTABLE`, `FUNCTION ... END`, `IF ... ELSE ... END`, `STRUCT ... END`, `MATCH ... WHEN ... END`) designed for readability and learners.
- **Professional Profile** — Concise, conventional brace-and-semicolon syntax (`module`, `requires`, `let`, `let mut`, `fn`, `struct`, `enum`, `match`, `if / while / for`) designed for experienced engineers.

Both profiles interoperate across multi-file `import` / `export` graphs and can be losslessly formatted into one another using `manifest format` or the **Format** control in Manifest Studio.

---

## 3. Repository Structure

| Path | Responsibility |
|---|---|
| [`manifest-core/`](./manifest-core/README.md) | Authoritative Rust compiler bridge (`engine/rust-engine.ts`), cross-profile formatter, TypeScript reference oracle (`core/`, `semantics/`, `ir/`, `bytecode/`), WASM/Web-JS/Native/Solana backends, explicit v0.x migrator (`migration/`), and CLI (`manifest-core/src/cli.ts`). |
| `mvm/` | **Authoritative Manifest Compiler & Rust Virtual Machine** Cargo workspace: `manifest-compiler` (canonical lexer, Beginner/Professional parsers, multi-file resolver, type checker, capability/effect verifier, Typed MIR + optimizer, `.mbc` v1.0 emitter), `mvm-core` (`#![forbid(unsafe_code)]` verifier & bounded VM), `mvm-cli` (native `mvm` binary), and `mvm-wasm` (`public/wasm/mvm_wasm.wasm`). |
| `src/studio/` | React 19 + CodeMirror 6 IDE with Syntax Profile & Compiler Target selectors, separated **Run** vs **Build** workflows, `.mbc` / Typed IR / Capabilities inspector tabs, multi-project IndexedDB storage, and binary-safe ZIP import/export. |
| `examples/` | Verified `.manifest` programs organized by `beginner/`, `professional/`, `web/`, `backend/`, and `contracts/`. |
| `docs/` | Authoritative specifications, architecture documentation, security model, target matrix, verification baseline, and benchmarks. |

---

## 4. Authoritative Documentation Index

- **[Language Overview (`docs/LANGUAGE.md`)](./docs/LANGUAGE.md)** — Quick tour of Manifest v1.0 and side-by-side Beginner vs Professional syntax equivalence.
- **[Formal Language Specification (`docs/LANGUAGE_SPEC.md`)](./docs/LANGUAGE_SPEC.md)** — Normative v1.0 specification covering all 26 language areas and formal EBNF grammars.
- **[Bytecode Specification (`docs/BYTECODE_SPEC.md`)](./docs/BYTECODE_SPEC.md)** — Binary `.mbc` v1.0 header, section directory, constant pool, opcode table (`0x00`–`0x81`), and static verification rules.
- **[Virtual Machine Specification (`docs/VM_SPEC.md`)](./docs/VM_SPEC.md)** — Rust MVM architecture (`mvm-core`, `mvm-cli`, `mvm-wasm`), memory model, resource bounds, and WASM host ABI.
- **[Compiler Targets (`docs/COMPILER_TARGETS.md`)](./docs/COMPILER_TARGETS.md)** — Honest status, artifacts, and toolchain requirements for `mvm`, `web-js`, `wasm`, `native`, `solana-sbf`, and planned targets (`evm-solidity`, `move`, `ton-tact`).
- **[Standard Library (`docs/STANDARD_LIBRARY.md`)](./docs/STANDARD_LIBRARY.md)** — `std::*` modules, signatures, and required host capabilities.
- **[Package & Dependency Management (`docs/PACKAGES.md`)](./docs/PACKAGES.md)** — Package configuration (`manifest.toml`), deterministic lockfile (`manifest.lock`), SemVer rules, and resolution.
- **[Contribution Guide (`CONTRIBUTING.md`)](./CONTRIBUTING.md)** — Development standards, repository layout, and verification commands.
- **[Security & Capability Model (`docs/SECURITY_MODEL.md`)](./docs/SECURITY_MODEL.md)** — Compile-time transitive effect verification, Rust MVM runtime capability gates, and browser preview sandboxing.
- **[System Architecture (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md)** — Complete compiler, Rust VM, and Manifest Studio IDE architecture.
- **[IDE Language Support Matrix (`docs/LANGUAGE_SUPPORT.md`)](./docs/LANGUAGE_SUPPORT.md)** — Verified editing, linting, build, and execution support across 25 file types.
- **[Implementation Roadmap (`docs/IMPLEMENTATION_ROADMAP.md`)](./docs/IMPLEMENTATION_ROADMAP.md)** — Verified deliverables vs partial and planned milestones.
- **[Verification Baseline (`docs/verification/VERIFICATION_BASELINE.md`)](./docs/verification/VERIFICATION_BASELINE.md)** & **[Performance Audit (`docs/verification/PERFORMANCE.md`)](./docs/verification/PERFORMANCE.md)** — Recorded test counts and empirical benchmarks.
- **[Historical v0.2 Archive (`docs/archive/MANIFEST_v0.2_SPEC.md`)](./docs/archive/MANIFEST_v0.2_SPEC.md)** — Archived v0.2 UI prototype specification.

---

## 5. Development, CLI & Verification Commands

```bash
# 1. Type-check TypeScript across manifest-core and Manifest Studio
npm run lint

# 2. Run Stage 6/7 Rust engine, canonical v1.0, Solana LiteSVM, Orchestrator, Editor & v1.0 upgrade test suites
npm run manifest:test

# 3. Run Stage 6 & Stage 7 verification suites directly
npm run manifest:test:stage6
npm run manifest:test:stage7

# 4. Run Track A & Batch 1 security/honesty regression suites
npx tsx manifest-core/tests/run_track_a_tests.ts
npx tsx manifest-core/tests/run_batch1_security_and_honesty_tests.ts

# 5. Run compiler, TS evaluator, Direct WASM, and Rust MVM benchmarks
npm run manifest:bench

# 6. Use the Manifest v1.0 CLI directly (including explicit opt-in v0.x migration)
npm run manifest:run -- check examples/professional/01_algorithms_and_enums.manifest
npm run manifest:run -- run examples/professional/01_algorithms_and_enums.manifest
npm run manifest:run -- disassemble examples/beginner/01_basics_and_loops.manifest
npm run manifest:run -- migrate legacy_v0.manifest --profile professional
npm run manifest:run -- targets
npm run manifest:run -- package list
npm run manifest:run -- package verify

# 8. Start full-stack development server (Port 3000) or build production bundle
npm run dev
npm run build
```


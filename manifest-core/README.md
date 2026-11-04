# Manifest Core (`manifest-core`) — v1.0 Compiler, Bytecode & Target Toolchain

`manifest-core` is the compiler frontend, static semantic analyzer, Typed Intermediate Representation (MIR) optimizer, `.mbc` v1.0 bytecode emitter/verifier/disassembler, Rust MVM bridge, and multi-target backend package for the **Manifest** programming language.

For the normative specifications, see:
- [`../docs/LANGUAGE_SPEC.md`](../docs/LANGUAGE_SPEC.md) — Language specification (Beginner & Professional syntax profiles)
- [`../docs/BYTECODE_SPEC.md`](../docs/BYTECODE_SPEC.md) — Binary `.mbc` v1.0 format & static verification rules
- [`../docs/VM_SPEC.md`](../docs/VM_SPEC.md) — Rust Manifest Virtual Machine (`mvm/`) architecture
- [`../docs/COMPILER_TARGETS.md`](../docs/COMPILER_TARGETS.md) — Target matrix & honest boundaries

---

## 1. Compiler & Execution Pipeline

```
Beginner Profile (.manifest)        Professional Profile (.manifest)
             \                                    /
       BeginnerParser                   ProfessionalParser
               \                                /
                +-----> SemanticModule AST <---+
                                |
                   Multi-File Module Resolver
                                |
                   Static TypeChecker & Inference
                                |
              Capability & Transitive Effect Verifier
                                |
                     Typed Manifest IR (MIR)
                                |
                 Semantics-Preserving MIR Optimizer
                                |
        +---------------+-------+-------+---------------+---------------+
        |               |               |               |               |
        v               v               v               v               v
  .mbc Bytecode   Web / JS Target  Direct .wasm    Native Target   Solana (SBF)
  (mbc-compiler)  (web-js-target)  (wasm-target)  (native-target) (Anchor + IDL)
        |               |               |               |               |
        v               v               v               v               v
   Rust MVM VM    Sandboxed ES     W3C WASM VM    Safe Rust (.rs)  LiteSVM Sim
 (WASM & Native)   Module / DOM                   -> host `rustc`
```

Backward compatibility is preserved for declarative Web UI (`APP` / `PAGE`) and Solana smart-contract (`PROGRAM`) files via `manifest-core/src/parser/`, `validator/`, `runtime/`, and `compiler/`.

---

## 2. Package Layout (`manifest-core/src/`)

- `core/` — `profile.ts`, `ast-v2.ts`, `beginner-parser.ts`, `professional-parser.ts`, `parse-unified.ts`, `formatter.ts` (cross-profile source formatting between Beginner and Professional profiles).
- `semantics/` — `types.ts` (canonical types & `std::*` intrinsics), `module-resolver.ts` (multi-file `import`/`export` graph + cycle detection), `type-checker.ts` (generics, structs, enums, `Result<T, E>`, `?`, exhaustiveness), `capability-analyzer.ts` (`requires`, `provides`, `denies`, fixed-point transitive call-graph effect inference).
- `ir/` — `typed-ir.ts`, `typed-ir-builder.ts`, `ir-optimizer.ts` (overflow-checked constant folding, algebraic simplification, dead branch & unreachable statement diagnostics).
- `bytecode/` — `mbc-format.ts`, `mbc-compiler.ts`, `mbc-reader.ts` (binary `.mbc` v1.0 encoder, decoder, static abstract-stack/jump verifier, and disassembler).
- `vm/` — `mvm-runner.ts` & `mvm-wasm-bytes.ts` (TypeScript/WebAssembly bridge to the compiled Rust `mvm-wasm` engine with capability-gated host handlers).
- `targets/` — `target-registry.ts`, `wasm-target.ts` (direct W3C `.wasm` + `.wat` emitter), `web-js-target.ts` (capability-sandboxed JS codegen), `native-target.ts` (standalone Rust emitter + host `rustc` driver).
- `runtime/` — `semantic-evaluator.ts` (deterministic MIR reference evaluator) and `runtime.ts` (legacy v0.1–v0.4 AST interpreter).
- `pipeline.ts` & `cli.ts` — High-level `checkManifestSource`, `compileManifestV1`, `runManifestOnRustMvm`, `formatManifestSource`, and CLI entrypoint.

---

## 3. CLI Reference (`manifest-core/src/cli.ts`)

```bash
# Validate syntax, static types, and capability/effect rules
npx tsx manifest-core/src/cli.ts check ../examples/professional/02_capabilities_and_hash.manifest

# Compile to .mbc v1.0 and execute on the Rust Manifest Virtual Machine
npx tsx manifest-core/src/cli.ts run ../examples/professional/01_algorithms_and_enums.manifest

# Inspect optimized Typed Manifest IR
npx tsx manifest-core/src/cli.ts ir ../examples/beginner/01_basics_and_loops.manifest

# Emit binary .mbc file and verify with the Rust MVM static verifier
npx tsx manifest-core/src/cli.ts bytecode ../examples/beginner/01_basics_and_loops.manifest -o /tmp/basics.mbc
npx tsx manifest-core/src/cli.ts verify /tmp/basics.mbc

# Print human-readable .mbc disassembly
npx tsx manifest-core/src/cli.ts disassemble ../examples/professional/01_algorithms_and_enums.manifest

# Build for specific targets (mvm | web-js | wasm | native | solana-sbf)
npx tsx manifest-core/src/cli.ts build ../examples/professional/01_algorithms_and_enums.manifest --target wasm -o /tmp/out.wasm
npx tsx manifest-core/src/cli.ts build ../examples/professional/01_algorithms_and_enums.manifest --target native -o /tmp/out_bin

# List all registered compiler targets and their implementation status
npx tsx manifest-core/src/cli.ts targets
```

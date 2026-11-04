# Manifest Compiler Targets Specification — Version 1.0

**Implementation Reference:** `manifest-core/src/targets/target-registry.ts`, `manifest-core/src/pipeline.ts`

Manifest separates its target-independent **Language Core & Typed IR (`MIRModule`)** from target-specific code generators. Every target registered in `COMPILER_TARGETS` reports its exact implementation status, emitted artifacts, browser vs CLI execution capabilities, and honest limitations.

---

## 1. Compiler Target Matrix

| Target ID | Display Name | Status | Studio `Build` | Studio `Run` | CLI `build` / `run` | Emitted Artifacts | Required Toolchain |
|---|---|---|---|---|---|---|---|
| `mvm` | **Manifest VM (`.mbc`)** | `available` | **Yes** | **Yes** (Rust MVM WASM) | **Yes** (WASM & Native `mvm`) | `build/<mod>.mbc`, `build/<mod>.disasm.txt`, `build/<mod>.mir.txt` | Built-in (`mvm_wasm.wasm` + `mvm` CLI) |
| `web-js` | **JavaScript / Web** | `available` | **Yes** | **Yes** (`<iframe sandbox>`) | **Yes** | `dist/app.js`, `dist/index.html` | Built-in Browser / Node ES Runtime |
| `wasm` | **WebAssembly (`.wasm`)** | `available-with-limitations` | **Yes** | **Yes** (`WasmExecutionProvider`) | **Yes** | `build/<mod>.wasm`, `build/<mod>.wat` | Built-in W3C Binary Emitter |
| `native` | **Native Executable** | `requires-toolchain` | **Yes** (Emits `.rs`) | **No** (Honest sandbox diagnostic) | **Yes** (Invokes host `rustc`) | `build/<mod>.rs` (+ native binary via CLI `rustc`) | Host `rustc >= 1.75` for machine binary |
| `solana-sbf` | **Solana (SBF)** | `available-with-limitations` | **Yes** | **Yes** (Local simulator) | **Yes** | `programs/<slug>/src/lib.rs`, `idl/<slug>.json` | External `cargo-build-sbf` / Anchor for `.so` |
| `evm-solidity` | **Solidity / EVM** | `planned` | Disabled (`Planned`) | Disabled | Refuses honestly | `.sol` (Planned) | `solc` / Foundry (Planned) |
| `move` | **Move** | `planned` | Disabled (`Planned`) | Disabled | Refuses honestly | `.move` (Planned) | Move CLI (Planned) |
| `ton-tact` | **Tact / TON** | `planned` | Disabled (`Planned`) | Disabled | Refuses honestly | `.tact` (Planned) | Tact Compiler (Planned) |

---

## 2. Target Details & Honest Boundaries

### 2.1 `mvm` — Manifest Virtual Machine (`.mbc` v1.0)
- **Full Language Coverage**: Supports all Manifest v1.0 types (`i64`, `f64`, `bool`, `str`, `void`, `Array<T>`, `Map<K, V>`, `Struct`, `Enum`, `Result<T, E>`), generics, pattern matching, multi-file imports, checked arithmetic, and capability-enforced host calls.
- **Verification**: Every build runs both TypeScript `verifyMbcBytes` and Rust `mvm_verify` before emitting `.mbc`.

### 2.2 `web-js` — Capability-Restricted JavaScript / Web
- **General-Purpose v1.0 Modules (`web-js-target.ts`)**: Lowers `MIRModule` to an isolated ES module using `BigInt` checked 64-bit arithmetic (`__add64`, `__sub64`, `__mul64`, `__div64`) and a runtime capability sandbox (`__caps`). When `net` is not granted, `window.fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` are overridden to throw `[Manifest Security] Network capability "net" is not granted` inside the preview iframe.
- **Declarative UI Modules (`APP` / `PAGE`)**: Lowers reactive UI blocks via `JSTargetCompiler` (`startApp()`).

### 2.3 `wasm` — Direct Standalone WebAssembly (`wasm-target.ts`)
- **Direct W3C Binary Codegen**: Emits raw W3C WebAssembly v1 binary sections (Type, Import, Function, Memory, Global, Export, Code) plus human-readable `.wat` directly from `MIRModule` and validates every binary via `WebAssembly.validate()`.
- **Documented Subset**: Supports `i64`, `f64`, `bool` (`i32`), module globals, multi-function calls, recursion, `if/else`, `while`, `repeat`, `break`, `continue`, checked division-by-zero traps (`unreachable`), and numeric `console.print` (`env.print_i64` / `env.print_f64` / `env.print_bool`). Programs using heap strings, arrays, maps, structs, or enums emit diagnostic `E_WASM_UNSUPPORTED_TYPE` directing the developer to the `mvm` target.

### 2.4 `native` — Standalone Safe Rust & Host Native Binary (`native-target.ts`)
- **Lowering**: Translates `MIRModule` into standalone, zero-dependency, `#![forbid(unsafe_code)]` Rust source (`build/<mod>.rs`) preserving checked `i64` arithmetic (`checked_add`/`sub`/`mul`/`div`), structs, enums, maps, arrays, and SHA-256/console/filesystem intrinsics.
- **Browser vs Host CLI**:
  - In **Manifest Studio (Browser)**: Clicking **Build** writes `build/<mod>.rs` into the workspace; clicking **Run** honestly explains that native OS binaries cannot execute inside a browser sandbox.
  - In **Host CLI (`manifest build <file> --target native -o <bin>`)**: Invokes `rustc -O --edition 2021` on the host machine when `rustc` is installed, producing a real native ELF/Mach-O/PE executable.

### 2.5 `solana-sbf` — Solana Anchor Rust + IDL (`AnchorGenerator` & `SolanaSimulator`)
- Requires a `PROGRAM <Name> ... END` smart-contract declaration.
- Generates Anchor Rust (`lib.rs`) and Anchor IDL (`idl.json`), and simulates instruction state transitions, signer checks, and checked arithmetic locally (verified with both `SolanaSimulator` and `@solana/kit-plugin-litesvm`). Compiling a deployable `.so` SBF binary requires an external `cargo-build-sbf` toolchain.

### 2.6 Planned Targets (`evm-solidity`, `move`, `ton-tact`)
- Listed as `Planned` in the target registry and disabled in the Studio Target Selector so users see the multi-target architecture without any fake or stubbed output. Passing `--target evm-solidity`, `--target move`, or `--target ton-tact` on the CLI fails cleanly with `E_TARGET_PLANNED`.

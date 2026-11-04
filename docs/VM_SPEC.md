# Manifest Virtual Machine Specification (`mvm`) — Version 1.0

**Status:** Normative VM Architecture Specification (v1.0)  
**Rust Workspace:** `mvm/` (`mvm-core`, `mvm-cli`, `mvm-wasm`)  
**TypeScript / Studio Bridge:** `manifest-core/src/vm/mvm-runner.ts` & `public/wasm/mvm_wasm.wasm`

---

## 1. Architecture & Memory-Safety Guarantees

The **Manifest Virtual Machine (`mvm`)** is a real, standalone virtual machine written in **Rust** (`edition = "2021"`). It is **not** a wrapper around `eval()`, Node `vm`, or JavaScript code generation.

### 1.1 Cargo Workspace Layout
1. **`mvm/crates/mvm-core` (`#![forbid(unsafe_code)]`)**:
   - Zero `unsafe` blocks anywhere in the crate (enforced by `#![forbid(unsafe_code)]` at crate root).
   - Zero external runtime crate dependencies — deterministic, auditable, portable across native OS targets and `wasm32-unknown-unknown`.
   - Submodules:
     - `bytecode.rs` — `.mbc` v1.0 structures, opcodes, and disassembler.
     - `decoder.rs` — Bounds-checked binary `.mbc` container and instruction stream decoder.
     - `verifier.rs` — Pre-execution static bytecode verifier (stack height dataflow, jump boundary checks, operand bounds, capability contradiction checks).
     - `value.rs` — Runtime `Value` representation (`Void`, `I64`, `F64`, `Bool`, `Str`, `ArrayRef`, `MapRef`, `StructRef`, `EnumRef`).
     - `memory.rs` — Bounded `OperandStack`, `CallFrame` stack, and deterministic `ArenaHeap`.
     - `capability.rs` — Runtime `CapabilityPolicy` gate enforcing module `requires`/`denies` intersected with host-granted capabilities.
     - `host.rs` — `HostEnvironment` trait + deterministic `StandardHost` (console capture, virtual filesystem, SHA-256, math/string intrinsics).
     - `error.rs` — Structured `DecodeError`, `VerifyError`, and `VmTrap` diagnostics with function name, byte offset, and `DEBUG_MAP` source line lookup.
     - `vm.rs` — Fetch-decode-execute engine with step metering and checked arithmetic.
2. **`mvm/crates/mvm-cli`**:
   - Native OS command-line binary (`mvm/target/release/mvm`) providing `mvm run <file.mbc>`, `mvm verify <file.mbc>`, and `mvm disasm <file.mbc>` with `--cap <cap>`, `--max-steps <N>`, `--entry <fn>`, and `--json` output mode.
3. **`mvm/crates/mvm-wasm`**:
   - Compiled to `wasm32-unknown-unknown` (`public/wasm/mvm_wasm.wasm`, embedded in `manifest-core/src/vm/mvm-wasm-bytes.ts` for zero-network offline execution in both Manifest Studio and Node tests).

---

## 2. Execution & Memory Model

### 2.1 Value Representation (`Value`)
- **Immediate Scalar Values**: `Void`, `I64(i64)`, `F64(f64)`, `Bool(bool)`, `Str(String)`.
- **Heap Handles (`HeapId(usize)`)**: `ArrayRef(HeapId)`, `MapRef(HeapId)`, `StructRef(HeapId)`, `EnumRef(HeapId)` indexing into `ArenaHeap`.

### 2.2 Stack & Call Frames
- Each `CallFrame` owns:
  - `fn_idx: u32`
  - `pc: usize` (instruction index within `module.functions[fn_idx].instructions`)
  - `locals: Vec<Value>` initialized to `fn.local_count` slots (`args[0..param_count]` copied into `locals[0..param_count]`, remaining slots initialized to `Value::Void`)
  - `stack_base: usize` recording the `OperandStack` watermark so `RET` / `RET_VOID` cleanly truncates frame temporaries before pushing the return value to the caller.

### 2.3 Bounded Arena Heap (`ArenaHeap`)
- Composite objects (`HeapObject::Array`, `HeapObject::Map`, `HeapObject::Struct`, `HeapObject::Enum`) are allocated sequentially in `ArenaHeap` up to `VmLimits::max_heap_objects` (default `65,536`). Exceeding `max_heap_objects` raises a deterministic `VmTrapKind::HeapLimitExceeded` trap rather than triggering an uncontrolled OOM panic.

---

## 3. Resource Limits & Trap Semantics

| Resource / Invariant | Default Limit | Trap / Error Kind |
|---|---|---|
| Instruction budget | `max_steps = 1,000,000` | `VmTrapKind::StepLimitExceeded` |
| Call-stack recursion depth | `max_call_depth = 256` | `VmTrapKind::CallDepthExceeded` |
| Per-function operand stack | Statically verified `<= max_stack` (`max_operand_stack = 4,096`) | `VerifyError` / `VmTrapKind::StackOverflow` |
| Arena heap allocations | `max_heap_objects = 65,536` | `VmTrapKind::HeapLimitExceeded` |
| `i64` arithmetic (`+`, `-`, `*`, `neg`, `MIN/-1`) | Signed 64-bit bounds | `VmTrapKind::IntegerOverflow` |
| Division / modulo by zero | Divisor `!= 0` / `!= 0.0` | `VmTrapKind::DivisionByZero` |
| Array indexing (`ARRAY_GET`, `ARRAY_SET`) | `0 <= idx < len` | `VmTrapKind::IndexOutOfBounds` |
| Host capability check (`HOST_CALL`) | Allowed by `CapabilityPolicy` | `VmTrapKind::CapabilityDenied` |

Every runtime `VmTrap` resolves the nearest `DEBUG_MAP` entry `(fn_idx, code_offset)` to report the exact Manifest source line and column alongside the bytecode PC.

---

## 4. Capability Enforcement in the VM

Even if an external caller crafts a custom `.mbc` file bypassing the TypeScript compiler, `mvm-core` enforces two independent barriers:
1. **Load-Time Verification (`verifier.rs`)**: Rejects any `.mbc` module where `requires` and `denies` overlap or where `IMPORT_TABLE` references a capability forbidden by `denies`.
2. **Runtime Dispatch Gate (`CapabilityPolicy::check_invocation`)**: On every `HOST_CALL(imp_idx)`, `mvm-core` verifies that `imp.capability`:
   - Is `'pure'`, **OR**
   - Is NOT matched by module `denies`, **AND**
   - Is covered by module `requires` (if `requires` is non-empty), **AND**
   - Was explicitly granted by the host environment in `granted_capabilities`!
   If any check fails, execution immediately halts with `VmTrapKind::CapabilityDenied` before invoking `host.invoke(...)`.

---

## 5. `mvm-wasm` Host ABI Bridge

`mvm-wasm` exposes a minimal, deterministic linear-memory C ABI consumed by `manifest-core/src/vm/mvm-runner.ts`:
- Exports:
  - `memory: WebAssembly.Memory`
  - `mvm_alloc(len: u32) -> u32` / `mvm_dealloc(ptr: u32, len: u32)`
  - `mvm_verify(mbc_ptr: u32, mbc_len: u32) -> u32` (writes JSON verification report to output buffer)
  - `mvm_disassemble(mbc_ptr: u32, mbc_len: u32) -> u32`
  - `mvm_execute(mbc_ptr: u32, mbc_len: u32, cfg_ptr: u32, cfg_len: u32) -> u32`
  - `mvm_output_ptr() -> u32` / `mvm_output_len() -> u32`
  - `mvm_set_host_response(ptr: u32, len: u32)`
- Host Import:
  - `env.mvm_host_call(req_ptr: u32, req_len: u32) -> u32` — Invoked only *after* `mvm-core` has verified `CapabilityPolicy` for external host capabilities (`time.now`, `net.get`, `db.query`). Pure intrinsics (`std::crypto::sha256`, `std::math::*`, `std::str::*`, `std::conv::*`) and virtual workspace `fs.read_text`/`fs.write_text` execute directly inside Rust `mvm-core`!

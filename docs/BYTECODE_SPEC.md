# Manifest Bytecode Specification (`.mbc`) — Version 1.0

**Status:** Normative Binary Specification (v1.0)  
**Compiler Implementation:** `manifest-core/src/bytecode/mbc-format.ts`, `mbc-compiler.ts`, `mbc-reader.ts`  
**Rust VM Decoder & Verifier:** `mvm/crates/mvm-core/src/bytecode.rs`, `decoder.rs`, `verifier.rs`

---

## 1. Design Goals

Manifest Bytecode (`.mbc`) is a compact, portable, little-endian binary module format designed specifically for deterministic verification and execution on the **Rust Manifest Virtual Machine (`mvm`)**. It is **not** JavaScript, JSON, or AST serialization. Every `.mbc` binary carries:
- Module capability contracts (`requires`, `provides`, `denies`)
- Deduplicated typed constant pool (`i64`, `f64`, `bool`, `str`)
- Nominal struct & algebraic enum metadata (`TYPE_TABLE`)
- Capability-tagged host imports (`IMPORT_TABLE`) and module exports (`EXPORT_TABLE`)
- Function descriptors with parameter counts, local slot counts, statically computed `max_stack`, and per-function effect sets (`FUNC_TABLE`)
- Dense bytecode instruction streams (`CODE`) and source-line debug mappings (`DEBUG_MAP`).

All multi-byte integers (`u16`, `u32`, `i64`) and IEEE-754 floats (`f64`) are encoded in **little-endian** byte order. Length-prefixed strings (`str`) are encoded as `u32 byte_length` followed by valid UTF-8 bytes (rejected if invalid UTF-8).

---

## 2. Binary File Header & Section Directory

### 2.1 16-Byte Fixed Header
| Offset | Size | Type | Field | Expected Value / Rule |
|---|---|---|---|---|
| `0x00` | 4 B | `[u8; 4]` | `magic` | `0x4D 0x42 0x43 0x00` (`"MBC\0"`) |
| `0x04` | 2 B | `u16` | `major_version` | `1` (reject if `!= 1`) |
| `0x06` | 2 B | `u16` | `minor_version` | `0` (reject if `> 0`) |
| `0x08` | 4 B | `u32` | `flags` | `0` (reserved flags bitmask) |
| `0x0C` | 4 B | `u32` | `section_count` | Number of directory entries (`<= 64`) |

### 2.2 Section Directory (`section_count * 12` bytes immediately after header)
Each directory entry has 3 `u32` fields:
- `tag: u32` — Section identifier (`MbcSectionTag`)
- `offset: u32` — Absolute byte offset from start of `.mbc` file
- `length: u32` — Byte length of section payload (`offset + length <= file_size` enforced before parsing).

| Section Tag | Name | Payload Layout |
|---|---|---|
| `0x01` | `MODULE_META` | `module_name: str`, `req_count: u16` + `str*`, `prov_count: u16` + `str*`, `deny_count: u16` + `str*` |
| `0x02` | `CONST_POOL` | `count: u32`, followed by `[kind: u8, payload]*`: `0x01`=`i64` (8B), `0x02`=`f64` (8B), `0x03`=`bool` (`u8`), `0x04`=`str` |
| `0x03` | `TYPE_TABLE` | `struct_count: u32` (`name_idx: u32`, `field_count: u16`, `[field_name_idx: u32, type_tag: u8]*`), `enum_count: u32` (`name_idx: u32`, `variant_count: u16`, `[variant_name_idx: u32, arity: u16]*`) |
| `0x04` | `IMPORT_TABLE` | `count: u32` of `[sym_str_idx: u32, cap_str_idx: u32, arity: u16, has_return: u8]` |
| `0x05` | `EXPORT_TABLE` | `count: u32` of `[name_str_idx: u32, kind: u8 (0=fn, 1=global), target_idx: u32]` |
| `0x06` | `FUNC_TABLE` | `global_count: u32`, `entry_fn_idx: u32` (`0xFFFFFFFF` if none), `fn_count: u32` of `[name_idx: u32, param_count: u16, local_count: u16, max_stack: u16, has_return: u8, eff_count: u16, eff_str_idx: u32*, code_offset: u32, code_length: u32]` |
| `0x07` | `CODE` | Concatenated function instruction byte streams sliced by `[code_offset .. code_offset + code_length]` |
| `0x08` | `DEBUG_MAP` | `count: u32` of `[fn_idx: u32, code_offset: u32, line: u32, column: u32]` |

---

## 3. Instruction Set Architecture (Opcodes `0x01`–`0x7F`)

Operands are encoded inline immediately following the 1-byte opcode. Jump offsets (`JMP`, `JMP_IF_FALSE`, `JMP_IF_TRUE`) are byte offsets **relative to the start of the enclosing function's `CODE` slice**.

| Opcode | Mnemonic | Operands | Stack Effect (`before -> after`) | Semantics |
|---|---|---|---|---|
| `0x01` | `NOP` | — | `[] -> []` | No operation |
| `0x02` | `CONST` | `const_idx: u32` | `[] -> [val]` | Push constant pool entry `#const_idx` |
| `0x03` | `PUSH_VOID` | — | `[] -> [void]` | Push unit `void` value |
| `0x04` | `POP` | — | `[v] -> []` | Discard top of operand stack |
| `0x05` | `DUP` | — | `[v] -> [v, v]` | Duplicate top of operand stack |
| `0x10` | `LOAD_LOCAL` | `slot: u16` | `[] -> [val]` | Push local slot `slot` (`< local_count`) |
| `0x11` | `STORE_LOCAL` | `slot: u16` | `[val] -> []` | Pop and store into local slot `slot` |
| `0x12` | `LOAD_GLOBAL` | `slot: u32` | `[] -> [val]` | Push module global slot `slot` (`< global_count`) |
| `0x13` | `STORE_GLOBAL` | `slot: u32` | `[val] -> []` | Pop and store into module global slot `slot` |
| `0x20` | `ADD_I64` | — | `[a, b] -> [a+b]` | Checked `i64` addition (traps on overflow) |
| `0x21` | `SUB_I64` | — | `[a, b] -> [a-b]` | Checked `i64` subtraction (traps on overflow) |
| `0x22` | `MUL_I64` | — | `[a, b] -> [a*b]` | Checked `i64` multiplication (traps on overflow) |
| `0x23` | `DIV_I64` | — | `[a, b] -> [a/b]` | Checked `i64` division (traps on `b == 0` or `MIN / -1`) |
| `0x24` | `MOD_I64` | — | `[a, b] -> [a%b]` | Checked `i64` remainder (traps on `b == 0` or `MIN % -1`) |
| `0x25` | `NEG_I64` | — | `[a] -> [-a]` | Checked `i64` negation (traps on `i64::MIN`) |
| `0x26` | `ADD_F64` | — | `[a, b] -> [a+b]` | IEEE-754 `f64` addition |
| `0x27` | `SUB_F64` | — | `[a, b] -> [a-b]` | IEEE-754 `f64` subtraction |
| `0x28` | `MUL_F64` | — | `[a, b] -> [a*b]` | IEEE-754 `f64` multiplication |
| `0x29` | `DIV_F64` | — | `[a, b] -> [a/b]` | Checked `f64` division (traps if `b == 0.0`) |
| `0x2A` | `NEG_F64` | — | `[a] -> [-a]` | IEEE-754 `f64` negation |
| `0x2B` | `CONCAT_STR` | — | `[s1, s2] -> [s1+s2]` | UTF-8 string concatenation |
| `0x2C` | `I64_TO_F64` | — | `[i] -> [f]` | Convert `i64` to `f64` |
| `0x2D` | `F64_TO_I64` | — | `[f] -> [i]` | Truncate finite `f64` to `i64` (traps on NaN/Inf/out-of-range) |
| `0x2E` | `TO_STR` | — | `[v] -> [s]` | Canonical deterministic string formatting |
| `0x30` | `EQ` | — | `[a, b] -> [bool]` | Deep structural equality |
| `0x31` | `NEQ` | — | `[a, b] -> [bool]` | Deep structural inequality |
| `0x32` | `LT` | — | `[a, b] -> [bool]` | Less-than (`i64`, `f64`, or `str`) |
| `0x33` | `LTE` | — | `[a, b] -> [bool]` | Less-than-or-equal |
| `0x34` | `GT` | — | `[a, b] -> [bool]` | Greater-than |
| `0x35` | `GTE` | — | `[a, b] -> [bool]` | Greater-than-or-equal |
| `0x36` | `NOT` | — | `[b] -> [!b]` | Boolean logical negation |
| `0x37` | `BOOL_AND` | — | `[a, b] -> [a&&b]` | Boolean logical conjunction |
| `0x38` | `BOOL_OR` | — | `[a, b] -> [a\|\|b]` | Boolean logical disjunction |
| `0x40` | `JMP` | `offset: u32` | `[] -> []` | Unconditional jump to byte `offset` in function |
| `0x41` | `JMP_IF_FALSE` | `offset: u32` | `[cond] -> []` | Pop `bool`; jump to `offset` if `false` |
| `0x42` | `JMP_IF_TRUE` | `offset: u32` | `[cond] -> []` | Pop `bool`; jump to `offset` if `true` |
| `0x43` | `CALL` | `fn_idx: u32` | `[arg_1..arg_k] -> [ret]` | Call internal function `fn_idx` (`void` functions push `void`) |
| `0x44` | `RET` | — | `[val] -> (caller)` | Pop return value and unwind frame |
| `0x45` | `RET_VOID` | — | `[] -> (caller)` | Return `void` and unwind frame |
| `0x46` | `HOST_CALL` | `imp_idx: u32` | `[arg_1..arg_k] -> [ret]` | Check capability policy & invoke host import `imp_idx` |
| `0x50` | `ARRAY_NEW` | `count: u32` | `[e_1..e_n] -> [arr]` | Allocate heap array with `count` elements |
| `0x51` | `ARRAY_GET` | — | `[arr, idx] -> [val]` | Bounds-checked element read (traps if OOB) |
| `0x52` | `ARRAY_SET` | — | `[arr, idx, val] -> []` | Bounds-checked element write (traps if OOB) |
| `0x53` | `ARRAY_LEN` | — | `[arr_or_str] -> [i64]` | Length of heap array or UTF-8 character count of string |
| `0x54` | `ARRAY_PUSH` | — | `[arr, val] -> [arr]` | Append `val` to array and push array reference |
| `0x55` | `MAP_NEW` | `pairs: u32` | `[k1, v1 .. kn, vn] -> [map]` | Allocate ordered map with `pairs` entries |
| `0x56` | `MAP_GET` | — | `[map, key] -> [val]` | Lookup `key` in map (traps if missing) |
| `0x57` | `MAP_SET` | — | `[map, key, val] -> [map]` | Insert/update `key` in map |
| `0x58` | `MAP_HAS` | — | `[map, key] -> [bool]` | Check whether `key` exists in map |
| `0x60` | `STRUCT_NEW` | `st_idx: u32` | `[f_1..f_n] -> [struct]` | Allocate struct `st_idx` popping `fields.length` values |
| `0x61` | `FIELD_GET` | `f_idx: u16` | `[struct] -> [val]` | Read struct field `f_idx` |
| `0x62` | `FIELD_SET` | `f_idx: u16` | `[struct, val] -> []` | Mutate struct field `f_idx` |
| `0x63` | `ENUM_NEW` | `en: u32, var: u16` | `[p_1..p_k] -> [enum]` | Allocate enum `en` variant `var` popping `arity` payloads |
| `0x64` | `ENUM_TAG` | — | `[enum] -> [i64]` | Push integer variant tag of enum value |
| `0x65` | `ENUM_PAYLOAD` | `p_idx: u16` | `[enum] -> [val]` | Extract payload `p_idx` of active enum variant |
| `0x70` | `TRAP` | `msg_const: u32` | `[] -> (abort)` | Deterministic trap with constant pool message |
| `0x7F` | `HALT` | — | `[] -> (halt)` | Terminate VM cleanly returning `void` |

---

## 4. Static Bytecode Verification Algorithm

Before **any** instruction executes, both `verifyMbcBytes` (TypeScript) and `mvm_core::verifier::verify_module` (Rust) enforce:

1. **Container & Bounds Integrity**: Valid `"MBC\0"` magic, version `1.0`, non-overlapping section slices within `bytes.length`, valid UTF-8 strings, and valid constant-pool string references across type/import/export/function tables.
2. **Capability Consistency**:
   - No capability appears in both `requires` and `denies`.
   - No `IMPORT_TABLE` entry requests a capability forbidden by `denies`.
3. **Operand Index Bounds**:
   - Every `CONST` index `< constants.length`
   - Every `LOAD_LOCAL` / `STORE_LOCAL` index `< fn.local_count` (and `fn.local_count >= fn.param_count`)
   - Every `LOAD_GLOBAL` / `STORE_GLOBAL` index `< mod.global_count`
   - Every `CALL` index `< mod.functions.length`
   - Every `HOST_CALL` index `< mod.imports.length`
   - Every `STRUCT_NEW` / `ENUM_NEW` index within `TYPE_TABLE` bounds.
4. **Control-Flow & Abstract Stack-Height Verification**:
   - Every `JMP`, `JMP_IF_FALSE`, and `JMP_IF_TRUE` target byte offset **must** land on an exact decoded instruction boundary inside the same function.
   - Worklist dataflow analysis computes the exact operand stack height at every reachable instruction PC:
     - Stack height never underflows (`height < pops` -> verification error).
     - Stack height never exceeds `fn.max_stack` (`next_height > fn.max_stack` -> verification error).
     - Control-flow merge points must arrive with **identical** stack heights (`existing_height != incoming_height` -> verification error).
     - Execution never falls off the end of a function without `RET`, `RET_VOID`, `JMP`, `TRAP`, or `HALT`.

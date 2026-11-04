# Manifest Standard Library Specification (`std`) — Version 1.0

**Implementation Reference:**
- Static signatures & capabilities: `manifest-core/src/semantics/types.ts` (`STD_INTRINSICS`)
- Rust MVM execution: `mvm/crates/mvm-core/src/host.rs`
- Reference evaluator & Web/Native targets: `manifest-core/src/runtime/semantic-evaluator.ts`, `manifest-core/src/targets/`

Every standard library function in Manifest has an explicit **static type signature** and an explicit **capability requirement** (`pure` or a named host capability).

---

## 1. Pure Deterministic Namespaces (`capability: pure`)

Pure intrinsics require **zero** module capabilities and may be called inside `pure` functions across both Beginner and Professional profiles.

### 1.1 Type Conversions (`std::conv`)
| Canonical Symbol | Accepted Call Aliases | Signature | Semantics |
|---|---|---|---|
| `std::conv::to_str` | `to_str`, `std::conv::to_str` | `(any) -> str` | Formats `i64`, `f64`, `bool`, `str`, arrays, structs, or enums deterministically as UTF-8 text. |
| `std::conv::to_f64` | `to_f64`, `std::conv::to_f64` | `(i64) -> f64` | Converts signed 64-bit integer to IEEE-754 `f64`. |
| `std::conv::to_i64` | `to_i64`, `std::conv::to_i64` | `(f64) -> i64` | Truncates finite `f64` toward zero to `i64` (traps on `NaN`, `±Infinity`, or out-of-range). |

### 1.2 Mathematics (`std::math`)
| Canonical Symbol | Accepted Call Aliases | Signature | Semantics |
|---|---|---|---|
| `std::math::abs` | `abs`, `math.abs`, `std::math::abs` | `(i64) -> i64` | Checked absolute value (traps on `i64::MIN`). |
| `std::math::abs_f64` | `abs_f64`, `std::math::abs_f64` | `(f64) -> f64` | Floating-point absolute value. |
| `std::math::min` | `min`, `math.min`, `std::math::min` | `(i64, i64) -> i64` | Smaller of two `i64` integers. |
| `std::math::max` | `max`, `math.max`, `std::math::max` | `(i64, i64) -> i64` | Larger of two `i64` integers. |
| `std::math::sqrt` | `sqrt`, `math.sqrt`, `std::math::sqrt` | `(f64) -> f64` | IEEE-754 square root. |

### 1.3 Strings & Collections (`std::str`)
| Canonical Symbol | Accepted Call Aliases | Signature | Semantics |
|---|---|---|---|
| `std::str::len` | `len`, `str.len`, `std::str::len` | `(str \| Array<T>) -> i64` | UTF-8 character count of string or element count of `Array<T>`. |
| `std::str::upper` | `str.upper`, `std::str::upper` | `(str) -> str` | Converts ASCII/Unicode string to uppercase. |
| `std::str::lower` | `str.lower`, `std::str::lower` | `(str) -> str` | Converts ASCII/Unicode string to lowercase. |
| `std::str::trim` | `str.trim`, `std::str::trim` | `(str) -> str` | Strips leading and trailing whitespace. |
| `std::str::contains` | `str.contains`, `std::str::contains` | `(str, str) -> bool` | Returns `true` if haystack contains needle substring. |

---

## 2. Capability-Gated Host Namespaces

Calling any function below requires:
1. The module must permit the capability (`requires [<cap>]` and not `denies [<cap>]`).
2. If the enclosing function declares an explicit `effects(...)` list, `<cap>` must be included.
3. At runtime, the host environment (`mvm` CLI `--cap` or Studio workspace) must grant `<cap>`.

### 2.1 Console I/O (`std::io` — Capability: `console`)
| Canonical Symbol | Accepted Call Aliases | Signature | Semantics |
|---|---|---|---|
| `console.print` | `print`, `println`, `console.print`, `std::io::print`, `std::io::println`, Beginner `SHOW expr` | `(any...) -> void` | Appends formatted line to VM/preview standard output stream. |

### 2.2 Time (`std::time` — Capability: `time`)
| Canonical Symbol | Accepted Call Aliases | Signature | Semantics |
|---|---|---|---|
| `time.now` | `time.now`, `std::time::now` | `() -> i64` | Returns current Unix epoch timestamp in milliseconds (`i64`). |

### 2.3 Sandboxed Filesystem (`std::fs` — Capabilities: `fs.read`, `fs.write`)
| Canonical Symbol | Accepted Call Aliases | Capability | Signature | Semantics |
|---|---|---|---|---|
| `fs.read_text` | `fs.read_text`, `std::fs::read_text` | `fs.read` | `(str) -> str` | Reads UTF-8 file from virtual workspace FS (Studio/WASM) or sandboxed host path (CLI). |
| `fs.write_text` | `fs.write_text`, `std::fs::write_text` | `fs.write` | `(str, str) -> bool` | Writes UTF-8 content to virtual workspace FS or host path when `fs.write` is granted. |

### 2.4 Cryptographic Primitives (`std::crypto` — Capability: `crypto`)
| Canonical Symbol | Accepted Call Aliases | Signature | Semantics |
|---|---|---|---|
| `crypto.hash` | `crypto.hash`, `std::crypto::sha256`, `std::crypto::hash` | `(str) -> str` | Computes deterministic FIPS 180-4 **SHA-256** lowercase hex digest (implemented natively in safe Rust inside `mvm-core/src/host.rs`). |

### 2.5 Network & Storage (`std::net`, `std::db` — Capabilities: `net`, `db`)
| Canonical Symbol | Accepted Call Aliases | Capability | Signature | Semantics |
|---|---|---|---|---|
| `net.get` | `net.get`, `std::net::get`, `fetch` | `net` | `(str) -> str` | Performs host-mediated HTTP GET only when `net` is both declared and granted by host. |
| `db.query` | `db.query`, `std::db::query` | `db` | `(str) -> str` | Executes host-mediated key/query lookup when `db` is declared and granted. |

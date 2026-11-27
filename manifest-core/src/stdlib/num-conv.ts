/**
 * Strict checked numeric conversions matching Rust MVM and W3C WASM i64.trunc_f64_s semantics.
 */

const MIN_I64_AS_F64 = -9223372036854775808.0; // -2^63 (exact in IEEE-754 f64)
const MAX_I64_UPPER_BOUND_F64 = 9223372036854775808.0; // +2^63 (exact in IEEE-754 f64, exclusive)

export function checkedF64ToI64(n: number): bigint {
  if (!Number.isFinite(n)) {
    throw new Error(`Numeric conversion trap: cannot convert non-finite f64 (${n}) to i64`);
  }
  const truncated = Math.trunc(n);
  if (truncated < MIN_I64_AS_F64 || truncated >= MAX_I64_UPPER_BOUND_F64) {
    throw new Error(
      `Numeric conversion trap: f64 value ${n} is out of representable i64 range [-2^63, 2^63)`
    );
  }
  if (truncated === 0) {
    return 0n; // Normalize -0.0 -> 0n
  }
  return BigInt(truncated);
}

use crate::errors::MvmError;
use crate::memory::{HeapArena, HeapObject};
use crate::value::Value;

pub fn try_invoke_pure(
    symbol: &str,
    args: &[Value],
    heap: &mut HeapArena,
) -> Result<Option<Value>, MvmError> {
    match symbol {
        "std::math::abs" | "math.abs" | "abs" => match args.first() {
            Some(Value::I64(n)) => n
                .checked_abs()
                .map(|v| Some(Value::I64(v)))
                .ok_or(MvmError::IntegerOverflow {
                    op: "abs",
                    line: None,
                }),
            Some(Value::F64(n)) => Ok(Some(Value::F64(n.abs()))),
            _ => Err(MvmError::TypeMismatch {
                expected: "i64 or f64",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        "std::math::min" | "math.min" | "min" => match (args.first(), args.get(1)) {
            (Some(Value::I64(a)), Some(Value::I64(b))) => Ok(Some(Value::I64((*a).min(*b)))),
            (Some(Value::F64(a)), Some(Value::F64(b))) => Ok(Some(Value::F64(a.min(*b)))),
            _ => Err(MvmError::TypeMismatch {
                expected: "(i64, i64) or (f64, f64)",
                actual: "mismatched args",
                line: None,
            }),
        },
        "std::math::max" | "math.max" | "max" => match (args.first(), args.get(1)) {
            (Some(Value::I64(a)), Some(Value::I64(b))) => Ok(Some(Value::I64((*a).max(*b)))),
            (Some(Value::F64(a)), Some(Value::F64(b))) => Ok(Some(Value::F64(a.max(*b)))),
            _ => Err(MvmError::TypeMismatch {
                expected: "(i64, i64) or (f64, f64)",
                actual: "mismatched args",
                line: None,
            }),
        },
        "std::math::sqrt" | "math.sqrt" | "sqrt" => match args.first() {
            Some(Value::F64(n)) => Ok(Some(Value::F64(n.sqrt()))),
            Some(Value::I64(n)) => Ok(Some(Value::F64((*n as f64).sqrt()))),
            _ => Err(MvmError::TypeMismatch {
                expected: "f64",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        "std::str::len" | "str.len" | "len" => match args.first() {
            Some(Value::Str(s)) => Ok(Some(Value::I64(s.chars().count() as i64))),
            Some(Value::ArrayRef(id)) => match heap.get(*id)? {
                HeapObject::Array(items) => Ok(Some(Value::I64(items.len() as i64))),
                _ => Err(MvmError::TypeMismatch {
                    expected: "Array",
                    actual: "non-array ref",
                    line: None,
                }),
            },
            Some(Value::MapRef(id)) => match heap.get(*id)? {
                HeapObject::Map(entries) => Ok(Some(Value::I64(entries.len() as i64))),
                _ => Err(MvmError::TypeMismatch {
                    expected: "Map",
                    actual: "non-map ref",
                    line: None,
                }),
            },
            _ => Err(MvmError::TypeMismatch {
                expected: "str, Array, or Map",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        "std::str::upper" | "str.upper" => match args.first() {
            Some(Value::Str(s)) => Ok(Some(Value::Str(s.to_uppercase()))),
            _ => Err(MvmError::TypeMismatch {
                expected: "str",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        "std::str::lower" | "str.lower" => match args.first() {
            Some(Value::Str(s)) => Ok(Some(Value::Str(s.to_lowercase()))),
            _ => Err(MvmError::TypeMismatch {
                expected: "str",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        "std::str::trim" | "str.trim" => match args.first() {
            Some(Value::Str(s)) => Ok(Some(Value::Str(s.trim().to_string()))),
            _ => Err(MvmError::TypeMismatch {
                expected: "str",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        "std::str::contains" | "str.contains" => match (args.first(), args.get(1)) {
            (Some(Value::Str(hay)), Some(Value::Str(needle))) => {
                Ok(Some(Value::Bool(hay.contains(needle.as_str()))))
            }
            _ => Err(MvmError::TypeMismatch {
                expected: "(str, str)",
                actual: "mismatched args",
                line: None,
            }),
        },
        "to_str" | "std::conv::to_str" => {
            let v = args.first().cloned().unwrap_or(Value::Void);
            Ok(Some(Value::Str(heap.format_value(&v, 0))))
        }
        "to_f64" | "std::conv::to_f64" => match args.first() {
            Some(Value::I64(n)) => Ok(Some(Value::F64(*n as f64))),
            Some(Value::F64(n)) => Ok(Some(Value::F64(*n))),
            _ => Err(MvmError::TypeMismatch {
                expected: "i64 or f64",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        "to_i64" | "std::conv::to_i64" => match args.first() {
            Some(Value::I64(n)) => Ok(Some(Value::I64(*n))),
            Some(Value::F64(n)) => Ok(Some(Value::I64(*n as i64))),
            _ => Err(MvmError::TypeMismatch {
                expected: "i64 or f64",
                actual: args.first().map(|v| v.type_name()).unwrap_or("none"),
                line: None,
            }),
        },
        _ => Ok(None),
    }
}

/// Real SHA-256 implementation (FIPS 180-4) in pure safe Rust with zero external crates.
pub fn deterministic_hash_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            let mut b = [0u8; 4];
            b.copy_from_slice(&chunk[i * 4..i * 4 + 4]);
            w[i] = u32::from_be_bytes(b);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut hex = String::with_capacity(64);
    for word in h {
        hex.push_str(&format!("{:08x}", word));
    }
    hex
}

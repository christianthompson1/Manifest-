use std::cell::RefCell;
use std::collections::BTreeMap;
use std::slice;

use mvm_core::memory::HeapArena;
use mvm_core::{
    decode_mbc, disassemble_module, stdlib, verify_module, CapabilityPolicy, HostEnvironment,
    MvmError, Value, VirtualMachine, VmLimits,
};

const MAX_WASM_ALLOC_BYTES: usize = 8 * 1024 * 1024;
const MAX_MBC_INPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_COMPILER_INPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_CFG_INPUT_BYTES: usize = 256 * 1024;
const MAX_HOST_PAYLOAD_BYTES: usize = 1024 * 1024;
const HOST_PROTOCOL_V2_HEADER: &str = "MVMHOST2";

#[link(wasm_import_module = "env")]
extern "C" {
    fn mvm_host_call(req_ptr: *const u8, req_len: usize) -> i32;
}

thread_local! {
    static OUTPUT_BUF: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static HOST_RESPONSE_BUF: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static ALLOC_REGISTRY: RefCell<BTreeMap<usize, usize>> = const { RefCell::new(BTreeMap::new()) };
}

fn set_output(s: String) {
    OUTPUT_BUF.with(|b| {
        *b.borrow_mut() = s.into_bytes();
    });
}

fn wasm_linear_memory_bytes() -> usize {
    #[cfg(target_arch = "wasm32")]
    {
        (core::arch::wasm32::memory_size(0) as usize).saturating_mul(65_536)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        usize::MAX
    }
}

/// Validates guest pointer & length bounds safely before forming a slice.
/// Rejects null non-zero pointers, zero-byte empty reads when prohibited, integer overflow,
/// oversized buffers, and ranges exceeding WASM linear memory.
unsafe fn read_validated_slice<'a>(
    ptr: *const u8,
    len: usize,
    max_len: usize,
    allow_empty: bool,
) -> Result<&'a [u8], &'static str> {
    if len > max_len {
        return Err("Buffer length exceeds maximum allowed FFI payload size");
    }
    if len == 0 {
        return if allow_empty {
            Ok(&[])
        } else {
            Err("Empty FFI buffer is not permitted for this operation")
        };
    }
    if ptr.is_null() {
        return Err("Null FFI pointer with non-zero length");
    }
    let start = ptr as usize;
    let end = start
        .checked_add(len)
        .ok_or("Pointer + length overflow in FFI boundary check")?;
    let mem_bytes = wasm_linear_memory_bytes();
    if end > mem_bytes {
        return Err("Pointer + length extends past WASM linear memory bounds");
    }
    Ok(slice::from_raw_parts(ptr, len))
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Symmetric string escaping for host-call v2 fields (lossless for `\n`, `\r`, `\t`, `:`, `|`, `%`, `\`, `"`, Unicode).
pub fn encode_protocol_field(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ':' => out.push_str("\\c"),
            '|' => out.push_str("\\p"),
            '%' => out.push_str("\\x25"),
            '"' => out.push_str("\\\""),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Symmetric strict decoder matching `encode_protocol_field`.
/// Rejects malformed or truncated escape sequences instead of silently corrupting payloads.
pub fn decode_protocol_field(raw: &str) -> Result<String, String> {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        let esc = chars
            .next()
            .ok_or_else(|| "Truncated escape sequence at end of host protocol field".to_string())?;
        match esc {
            '\\' => out.push('\\'),
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            'c' => out.push(':'),
            'p' => out.push('|'),
            '"' => out.push('"'),
            'x' => {
                let h1 = chars
                    .next()
                    .ok_or_else(|| "Truncated \\x escape in host protocol field".to_string())?;
                let h2 = chars
                    .next()
                    .ok_or_else(|| "Truncated \\x escape in host protocol field".to_string())?;
                let mut hex = String::with_capacity(2);
                hex.push(h1);
                hex.push(h2);
                let byte = u8::from_str_radix(&hex, 16)
                    .map_err(|_| format!("Invalid \\x hex escape '\\x{}'", hex))?;
                out.push(byte as char);
            }
            'u' => {
                let mut hex = String::with_capacity(4);
                for _ in 0..4 {
                    let h = chars
                        .next()
                        .ok_or_else(|| "Truncated \\u escape in host protocol field".to_string())?;
                    hex.push(h);
                }
                let code = u32::from_str_radix(&hex, 16)
                    .map_err(|_| format!("Invalid \\u hex escape '\\u{}'", hex))?;
                let decoded = char::from_u32(code)
                    .ok_or_else(|| format!("Invalid Unicode scalar '\\u{}'", hex))?;
                out.push(decoded);
            }
            other => {
                return Err(format!("Unsupported escape sequence '\\{}'", other));
            }
        }
    }
    Ok(out)
}

pub fn encode_host_request_v2(
    symbol: &str,
    capability: &str,
    args: &[Value],
    heap: &mut HeapArena,
) -> String {
    let mut req = String::new();
    req.push_str(HOST_PROTOCOL_V2_HEADER);
    req.push('\n');
    req.push_str(&encode_protocol_field(symbol));
    req.push('\n');
    req.push_str(&encode_protocol_field(capability));
    for arg in args {
        req.push('\n');
        match arg {
            Value::Void => req.push_str("void:"),
            Value::I64(n) => req.push_str(&format!("i64:{}", n)),
            Value::F64(n) => req.push_str(&format!("f64:{}", n)),
            Value::Bool(b) => req.push_str(&format!("bool:{}", b)),
            Value::Str(s) => req.push_str(&format!("str:{}", encode_protocol_field(s))),
            other => {
                let formatted = heap.format_value(other, 0);
                req.push_str(&format!("str:{}", encode_protocol_field(&formatted)));
            }
        }
    }
    req
}

pub fn decode_host_response_v2(raw: &str, operation: &str) -> Result<Value, MvmError> {
    let (tag, payload) = raw.split_once(':').ok_or_else(|| MvmError::HostError {
        operation: operation.to_string(),
        message: "Malformed host response frame (missing type tag separator ':')".to_string(),
    })?;

    match tag {
        "void" => {
            if !payload.is_empty() {
                return Err(MvmError::HostError {
                    operation: operation.to_string(),
                    message: "Unexpected non-empty payload for 'void' host response".to_string(),
                });
            }
            Ok(Value::Void)
        }
        "i64" => payload
            .trim()
            .parse::<i64>()
            .map(Value::I64)
            .map_err(|e| MvmError::HostError {
                operation: operation.to_string(),
                message: format!("Invalid i64 host response: {}", e),
            }),
        "f64" => {
            let n = payload
                .trim()
                .parse::<f64>()
                .map_err(|e| MvmError::HostError {
                    operation: operation.to_string(),
                    message: format!("Invalid f64 host response: {}", e),
                })?;
            if !n.is_finite() {
                return Err(MvmError::HostError {
                    operation: operation.to_string(),
                    message: "Non-finite f64 host response rejected".to_string(),
                });
            }
            Ok(Value::F64(n))
        }
        "bool" => match payload.trim() {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            other => Err(MvmError::HostError {
                operation: operation.to_string(),
                message: format!("Invalid bool host response '{}'", other),
            }),
        },
        "str" => decode_protocol_field(payload)
            .map(Value::Str)
            .map_err(|e| MvmError::HostError {
                operation: operation.to_string(),
                message: format!("Malformed escaped string host response: {}", e),
            }),
        "err" => {
            let msg = decode_protocol_field(payload).unwrap_or_else(|_| payload.to_string());
            Err(MvmError::HostError {
                operation: operation.to_string(),
                message: msg,
            })
        }
        other => Err(MvmError::HostError {
            operation: operation.to_string(),
            message: format!("Unknown host response tag '{}'", other),
        }),
    }
}

#[no_mangle]
pub extern "C" fn mvm_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_WASM_ALLOC_BYTES {
        return std::ptr::null_mut();
    }
    let mut buf = vec![0u8; len];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ALLOC_REGISTRY.with(|reg| {
        reg.borrow_mut().insert(ptr as usize, len);
    });
    ptr
}

/// Deallocates a buffer previously returned by `mvm_alloc`.
///
/// # Safety
/// `ptr` must be null or a pointer previously returned by `mvm_alloc` with the exact matching `len`
/// that has not already been deallocated.
#[no_mangle]
pub unsafe extern "C" fn mvm_dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let matched_len = ALLOC_REGISTRY.with(|reg| {
        let mut map = reg.borrow_mut();
        if map.get(&(ptr as usize)).copied() == Some(len) {
            map.remove(&(ptr as usize))
        } else {
            None
        }
    });
    if let Some(expected_len) = matched_len {
        let _ = Vec::from_raw_parts(ptr, 0, expected_len);
    }
}

#[no_mangle]
pub extern "C" fn mvm_output_ptr() -> *const u8 {
    OUTPUT_BUF.with(|b| b.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn mvm_output_len() -> usize {
    OUTPUT_BUF.with(|b| b.borrow().len())
}

/// Copies a host call response payload into the WASM module's response buffer.
///
/// # Safety
/// When `len > 0`, `ptr` must point to a valid readable buffer of `len` bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn mvm_set_host_response(ptr: *const u8, len: usize) {
    let bytes = match read_validated_slice(ptr, len, MAX_HOST_PAYLOAD_BYTES, true) {
        Ok(slice_bytes) => slice_bytes.to_vec(),
        Err(reason) => format!("err:{}", encode_protocol_field(reason)).into_bytes(),
    };
    HOST_RESPONSE_BUF.with(|b| {
        *b.borrow_mut() = bytes;
    });
}

struct WasmBridgeHost {
    logs: Vec<String>,
}

impl WasmBridgeHost {
    fn new() -> Self {
        Self { logs: Vec::new() }
    }
}

impl HostEnvironment for WasmBridgeHost {
    fn invoke(
        &mut self,
        symbol: &str,
        capability: &str,
        args: &[Value],
        heap: &mut HeapArena,
    ) -> Result<Value, MvmError> {
        if let Some(res) = stdlib::try_invoke_pure(symbol, args, heap)? {
            return Ok(res);
        }

        if matches!(
            symbol,
            "crypto.hash" | "std::crypto::sha256" | "std::crypto::hash"
        ) {
            return match args.first() {
                Some(Value::Str(s)) => Ok(Value::Str(stdlib::deterministic_hash_hex(s.as_bytes()))),
                Some(other) => Err(MvmError::TypeMismatch {
                    expected: "str",
                    actual: other.type_name(),
                    line: None,
                }),
                None => Err(MvmError::TypeMismatch {
                    expected: "str",
                    actual: "none",
                    line: None,
                }),
            };
        }

        let req = encode_host_request_v2(symbol, capability, args, heap);
        if req.len() > MAX_HOST_PAYLOAD_BYTES {
            return Err(MvmError::HostError {
                operation: symbol.to_string(),
                message: "Host call request exceeds maximum payload size".to_string(),
            });
        }

        let req_bytes = req.into_bytes();
        let status = unsafe { mvm_host_call(req_bytes.as_ptr(), req_bytes.len()) };

        let resp_bytes = HOST_RESPONSE_BUF.with(|b| b.borrow().clone());
        let resp = std::str::from_utf8(&resp_bytes).map_err(|_| MvmError::HostError {
            operation: symbol.to_string(),
            message: "Host response contained invalid UTF-8".to_string(),
        })?;

        if status == 0 {
            let err_msg = match resp.strip_prefix("err:") {
                Some(escaped) => {
                    decode_protocol_field(escaped).unwrap_or_else(|_| escaped.to_string())
                }
                None => resp.to_string(),
            };
            return Err(MvmError::HostError {
                operation: symbol.to_string(),
                message: if err_msg.is_empty() {
                    "Host call failed".to_string()
                } else {
                    err_msg
                },
            });
        }

        if matches!(
            symbol,
            "console.print" | "print" | "println" | "std::io::print" | "std::io::println"
        ) {
            let line: Vec<String> = args.iter().map(|v| heap.format_value(v, 0)).collect();
            self.logs.push(line.join(" "));
            return Ok(Value::Void);
        }

        decode_host_response_v2(resp, symbol)
    }

    fn stdout(&self) -> &[String] {
        &self.logs
    }
}

#[no_mangle]
pub extern "C" fn mvm_engine_info() -> i32 {
    set_output(format!(
        "{{\"ok\":true,\"name\":\"mvm-wasm\",\"version\":\"{}\",\"protocolVersion\":2,\"abi\":\"mvm-wasm-c-v2\",\"compilerEngine\":\"{}\",\"compilerVersion\":\"{}\",\"compilerAbiVersion\":{},\"features\":[\"gc\",\"cycle-safe-eq\",\"sha256\",\"checked-f64-to-i64\",\"cumulative-fuel\",\"max-heap-bytes\",\"manifest-compiler-v1\",\"ast-mir-mbc\"]}}",
        json_escape(env!("CARGO_PKG_VERSION")),
        json_escape(manifest_compiler::ENGINE_NAME),
        json_escape(manifest_compiler::ENGINE_VERSION),
        manifest_compiler::ENGINE_ABI_VERSION
    ));
    1
}

unsafe fn run_compiler_ffi<F>(req_ptr: *const u8, req_len: usize, func: F) -> i32
where
    F: FnOnce(&str) -> String,
{
    let bytes = match read_validated_slice(req_ptr, req_len, MAX_COMPILER_INPUT_BYTES, false) {
        Ok(b) => b,
        Err(reason) => {
            set_output(format!(
                "{{\"ok\":false,\"diagnostics\":[{{\"code\":\"E_FFI_BOUNDS\",\"severity\":\"error\",\"message\":\"{}\",\"line\":1,\"column\":1}}]}}",
                json_escape(reason)
            ));
            return 0;
        }
    };
    let req_str = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            set_output(
                "{\"ok\":false,\"diagnostics\":[{\"code\":\"E_FFI_UTF8\",\"severity\":\"error\",\"message\":\"Compiler request is not valid UTF-8\",\"line\":1,\"column\":1}]}"
                    .to_string(),
            );
            return 0;
        }
    };
    let resp = func(req_str);
    let ok = resp.starts_with("{\"ok\":true");
    set_output(resp);
    if ok {
        1
    } else {
        0
    }
}

/// Lexes, parses, links, type-checks, analyzes capabilities, and lowers Manifest source to Typed MIR.
///
/// # Safety
/// `req_ptr` must point to a valid readable UTF-8 JSON buffer of `req_len` bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn mvm_check_source(req_ptr: *const u8, req_len: usize) -> i32 {
    run_compiler_ffi(req_ptr, req_len, manifest_compiler::check_source_json)
}

/// Runs the authoritative Rust compiler pipeline through Typed MIR, optimization, MBC emission, and verification.
///
/// # Safety
/// `req_ptr` must point to a valid readable UTF-8 JSON buffer of `req_len` bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn mvm_compile_source(req_ptr: *const u8, req_len: usize) -> i32 {
    run_compiler_ffi(req_ptr, req_len, manifest_compiler::compile_source_json)
}

/// Returns Typed MIR (structured JSON + human-readable IR text) and capability audit for Manifest source.
///
/// # Safety
/// `req_ptr` must point to a valid readable UTF-8 JSON buffer of `req_len` bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn mvm_inspect_ir(req_ptr: *const u8, req_len: usize) -> i32 {
    run_compiler_ffi(req_ptr, req_len, manifest_compiler::inspect_ir_json)
}

/// Decodes and statically verifies an `.mbc` container, storing JSON result in the output buffer.
///
/// # Safety
/// `mbc_ptr` must point to a valid readable buffer of `mbc_len` bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn mvm_verify(mbc_ptr: *const u8, mbc_len: usize) -> i32 {
    let bytes = match read_validated_slice(mbc_ptr, mbc_len, MAX_MBC_INPUT_BYTES, false) {
        Ok(b) => b,
        Err(reason) => {
            set_output(format!(
                "{{\"ok\":false,\"error\":\"{}\"}}",
                json_escape(reason)
            ));
            return 0;
        }
    };
    match decode_mbc(bytes) {
        Ok(mut module) => match verify_module(&mut module) {
            Ok(()) => {
                set_output(format!(
                    "{{\"ok\":true,\"moduleName\":\"{}\",\"functions\":{},\"constants\":{},\"imports\":{}}}",
                    json_escape(&module.module_name),
                    module.functions.len(),
                    module.constants.len(),
                    module.imports.len()
                ));
                1
            }
            Err(e) => {
                set_output(format!(
                    "{{\"ok\":false,\"error\":\"{}\"}}",
                    json_escape(&e.to_string())
                ));
                0
            }
        },
        Err(e) => {
            set_output(format!(
                "{{\"ok\":false,\"error\":\"{}\"}}",
                json_escape(&e.to_string())
            ));
            0
        }
    }
}

/// Decodes, verifies, and disassembles an `.mbc` container, storing JSON result in the output buffer.
///
/// # Safety
/// `mbc_ptr` must point to a valid readable buffer of `mbc_len` bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn mvm_disassemble(mbc_ptr: *const u8, mbc_len: usize) -> i32 {
    let bytes = match read_validated_slice(mbc_ptr, mbc_len, MAX_MBC_INPUT_BYTES, false) {
        Ok(b) => b,
        Err(reason) => {
            set_output(format!(
                "{{\"ok\":false,\"error\":\"{}\"}}",
                json_escape(reason)
            ));
            return 0;
        }
    };
    match decode_mbc(bytes) {
        Ok(mut module) => {
            let verified = verify_module(&mut module).is_ok();
            let text = disassemble_module(&module);
            set_output(format!(
                "{{\"ok\":true,\"verified\":{},\"disassembly\":\"{}\"}}",
                verified,
                json_escape(&text)
            ));
            1
        }
        Err(e) => {
            set_output(format!(
                "{{\"ok\":false,\"error\":\"{}\"}}",
                json_escape(&e.to_string())
            ));
            0
        }
    }
}

/// Decodes, verifies, and executes an `.mbc` container inside the sandboxed Rust MVM.
///
/// # Safety
/// `mbc_ptr` must point to a valid readable buffer of `mbc_len` bytes, and when `cfg_len > 0`,
/// `cfg_ptr` must point to a valid readable buffer of `cfg_len` bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn mvm_execute(
    mbc_ptr: *const u8,
    mbc_len: usize,
    cfg_ptr: *const u8,
    cfg_len: usize,
) -> i32 {
    let bytes = match read_validated_slice(mbc_ptr, mbc_len, MAX_MBC_INPUT_BYTES, false) {
        Ok(b) => b,
        Err(reason) => {
            set_output(format!(
                "{{\"ok\":false,\"phase\":\"decode\",\"error\":\"{}\"}}",
                json_escape(reason)
            ));
            return 0;
        }
    };

    let cfg_bytes = match read_validated_slice(cfg_ptr, cfg_len, MAX_CFG_INPUT_BYTES, true) {
        Ok(b) => b,
        Err(reason) => {
            set_output(format!(
                "{{\"ok\":false,\"phase\":\"decode\",\"error\":\"{}\"}}",
                json_escape(reason)
            ));
            return 0;
        }
    };

    let cfg_str = match std::str::from_utf8(cfg_bytes) {
        Ok(s) => s,
        Err(_) => {
            set_output(
                "{\"ok\":false,\"phase\":\"decode\",\"error\":\"Execution configuration is not valid UTF-8\"}"
                    .to_string(),
            );
            return 0;
        }
    };

    let mut limits = VmLimits::default();
    let mut granted: Vec<String> = Vec::new();
    let mut entry_override: Option<String> = None;

    for line in cfg_str.lines() {
        if let Some((k, v)) = line.split_once('=') {
            match k.trim() {
                "MAX_STEPS" => {
                    if let Ok(n) = v.trim().parse::<u64>() {
                        limits.max_steps = n;
                    }
                }
                "MAX_DEPTH" => {
                    if let Ok(n) = v.trim().parse::<usize>() {
                        limits.max_call_depth = n;
                    }
                }
                "MAX_HEAP" => {
                    if let Ok(n) = v.trim().parse::<usize>() {
                        limits.max_heap_objects = n;
                    }
                }
                "MAX_HEAP_BYTES" => {
                    if let Ok(n) = v.trim().parse::<usize>() {
                        limits.max_heap_bytes = n;
                    }
                }
                "ENTRY" if !v.trim().is_empty() => {
                    entry_override = Some(v.trim().to_string());
                }
                "GRANT" if !v.trim().is_empty() => {
                    granted.push(v.trim().to_string());
                }
                _ => {}
            }
        }
    }

    let policy = CapabilityPolicy::with_granted(granted);

    let mut module = match decode_mbc(bytes) {
        Ok(m) => m,
        Err(e) => {
            set_output(format!(
                "{{\"ok\":false,\"phase\":\"decode\",\"errorCode\":\"{}\",\"error\":\"{}\"}}",
                e.code(),
                json_escape(&e.to_string())
            ));
            return 0;
        }
    };

    if let Err(e) = verify_module(&mut module) {
        set_output(format!(
            "{{\"ok\":false,\"phase\":\"verify\",\"errorCode\":\"{}\",\"error\":\"{}\"}}",
            e.code(),
            json_escape(&e.to_string())
        ));
        return 0;
    }

    let vm = VirtualMachine::new(limits, policy);
    let mut host = WasmBridgeHost::new();
    match vm.execute(&module, &mut host, entry_override.as_deref()) {
        Ok(summary) => {
            let stdout_json: Vec<String> = summary
                .stdout
                .iter()
                .map(|s| format!("\"{}\"", json_escape(s)))
                .collect();
            set_output(format!(
                "{{\"ok\":true,\"returnType\":\"{}\",\"returnValue\":\"{}\",\"stdout\":[{}],\"steps\":{},\"heapObjects\":{},\"heapObjectsAllocated\":{},\"gcStats\":{{\"collections\":{},\"objectsAllocated\":{},\"objectsReclaimed\":{},\"liveObjects\":{},\"allocatedBytes\":{},\"peakLive\":{},\"peakBytes\":{},\"bytesReclaimed\":{}}}}}",
                summary.return_value.type_name(),
                json_escape(&summary.formatted_return),
                stdout_json.join(","),
                summary.steps_executed,
                summary.gc_stats.live_objects,
                summary.heap_objects_allocated,
                summary.gc_stats.collections,
                summary.gc_stats.objects_allocated,
                summary.gc_stats.objects_reclaimed,
                summary.gc_stats.live_objects,
                summary.gc_stats.allocated_bytes,
                summary.gc_stats.peak_live,
                summary.gc_stats.peak_bytes,
                summary.gc_stats.bytes_reclaimed
            ));
            1
        }
        Err(e) => {
            let stdout_json: Vec<String> = host
                .stdout()
                .iter()
                .map(|s| format!("\"{}\"", json_escape(s)))
                .collect();
            set_output(format!(
                "{{\"ok\":false,\"phase\":\"runtime\",\"errorCode\":\"{}\",\"error\":\"{}\",\"stdout\":[{}]}}",
                e.code(),
                json_escape(&e.to_string()),
                stdout_json.join(",")
            ));
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_field_round_trips_metacharacters_and_unicode() {
        let samples = [
            "",
            "simple_text",
            "line1\nline2\r\n\ttab",
            "key:val|pipe%percent\\backslash\"quote",
            "sym\nforged_cap\ni64:99",
            "Unicode: λ -> 🚀",
        ];
        for s in samples {
            let encoded = encode_protocol_field(s);
            assert!(!encoded.contains('\n'));
            assert!(!encoded.contains(':'));
            assert!(!encoded.contains('|'));
            let decoded = decode_protocol_field(&encoded).expect("valid decode");
            assert_eq!(decoded, s);
        }
    }

    #[test]
    fn protocol_decoder_rejects_malformed_escapes_and_tags() {
        assert!(decode_protocol_field("trailing\\").is_err());
        assert!(decode_protocol_field("bad\\qescape").is_err());
        assert!(decode_protocol_field("short\\u12").is_err());
        assert!(decode_protocol_field("bad\\xZZ").is_err());

        assert!(decode_host_response_v2("no_tag_separator", "fs.read_text").is_err());
        assert!(decode_host_response_v2("unknown:abc", "fs.read_text").is_err());
        assert!(decode_host_response_v2("bool:maybe", "fs.read_text").is_err());
        assert!(decode_host_response_v2("f64:NaN", "fs.read_text").is_err());
        assert!(decode_host_response_v2("str:bad\\q", "fs.read_text").is_err());
        assert_eq!(
            decode_host_response_v2("str:a\\nb\\cc\\pd\\\\e", "fs.read_text").unwrap(),
            Value::Str("a\nb:c|d\\e".to_string())
        );
    }

    #[test]
    fn ffi_slice_validator_blocks_null_overflow_and_oversized() {
        unsafe {
            assert!(read_validated_slice(std::ptr::null(), 16, 1024, false).is_err());
            assert!(read_validated_slice(std::ptr::null(), 0, 1024, false).is_err());
            assert!(read_validated_slice(std::ptr::null(), 0, 1024, true).is_ok());

            let sample = [1u8, 2, 3, 4];
            assert!(read_validated_slice(sample.as_ptr(), 4, 3, false).is_err());
            assert!(read_validated_slice(sample.as_ptr(), usize::MAX, usize::MAX, false).is_err());
            assert_eq!(
                read_validated_slice(sample.as_ptr(), 4, 16, false).unwrap(),
                &sample
            );
        }
    }

    #[test]
    fn wasm_compiler_exports_check_compile_and_inspect_ir() {
        assert_eq!(mvm_engine_info(), 1);
        let info = OUTPUT_BUF.with(|b| String::from_utf8(b.borrow().clone()).unwrap());
        assert!(info.contains("\"manifest-compiler-v1\""));
        assert!(info.contains("\"compilerEngine\":\"rust-manifest-compiler\""));

        let req = r#"{"source":"module wasm_test;\nfn main() -> i64 { return 21 * 2; }","entryFile":"src/main.manifest","optimize":true}"#;
        unsafe {
            assert_eq!(mvm_check_source(req.as_ptr(), req.len()), 1);
            let check_json = OUTPUT_BUF.with(|b| String::from_utf8(b.borrow().clone()).unwrap());
            assert!(check_json.contains("\"ok\":true"));
            assert!(check_json.contains("\"astSummary\""));

            assert_eq!(mvm_inspect_ir(req.as_ptr(), req.len()), 1);
            let ir_json = OUTPUT_BUF.with(|b| String::from_utf8(b.borrow().clone()).unwrap());
            assert!(ir_json.contains("\"irText\""));

            assert_eq!(mvm_compile_source(req.as_ptr(), req.len()), 1);
            let comp_json = OUTPUT_BUF.with(|b| String::from_utf8(b.borrow().clone()).unwrap());
            assert!(comp_json.contains("\"mbcBase64\":\"TUJD"));
            assert!(comp_json.contains("\"disassembly\""));

            // Bad UTF-8 / null pointer cleanly rejected
            let bad_utf8 = [0xffu8, 0xfe, 0xfd];
            assert_eq!(mvm_check_source(bad_utf8.as_ptr(), bad_utf8.len()), 0);
            assert_eq!(mvm_check_source(std::ptr::null(), 10), 0);
        }
    }
}

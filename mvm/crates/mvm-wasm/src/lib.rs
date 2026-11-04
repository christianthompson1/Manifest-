use std::cell::RefCell;
use std::slice;

use mvm_core::memory::HeapArena;
use mvm_core::{
    decode_mbc, disassemble_module, stdlib, verify_module, CapabilityPolicy, HostEnvironment,
    MvmError, Value, VirtualMachine, VmLimits,
};

#[link(wasm_import_module = "env")]
extern "C" {
    fn mvm_host_call(req_ptr: *const u8, req_len: usize) -> i32;
}

thread_local! {
    static OUTPUT_BUF: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static HOST_RESPONSE_BUF: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_output(s: String) {
    OUTPUT_BUF.with(|b| {
        *b.borrow_mut() = s.into_bytes();
    });
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

#[no_mangle]
pub extern "C" fn mvm_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn mvm_dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        let _ = Vec::from_raw_parts(ptr, 0, len);
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

#[no_mangle]
pub unsafe extern "C" fn mvm_set_host_response(ptr: *const u8, len: usize) {
    let bytes = if ptr.is_null() || len == 0 {
        Vec::new()
    } else {
        slice::from_raw_parts(ptr, len).to_vec()
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
            let input = match args.first() {
                Some(Value::Str(s)) => s.as_bytes().to_vec(),
                Some(v) => heap.format_value(v, 0).into_bytes(),
                None => Vec::new(),
            };
            return Ok(Value::Str(stdlib::deterministic_hash_hex(&input)));
        }

        // Encode host call request as compact line protocol:
        // line 0: symbol
        // line 1: capability
        // lines 2..: type:json_escaped_value
        let mut req = String::new();
        req.push_str(symbol);
        req.push('\n');
        req.push_str(capability);
        for arg in args {
            req.push('\n');
            match arg {
                Value::Void => req.push_str("void:"),
                Value::I64(n) => req.push_str(&format!("i64:{}", n)),
                Value::F64(n) => req.push_str(&format!("f64:{}", n)),
                Value::Bool(b) => req.push_str(&format!("bool:{}", b)),
                Value::Str(s) => req.push_str(&format!("str:{}", json_escape(s))),
                other => req.push_str(&format!("str:{}", json_escape(&heap.format_value(other, 0)))),
            }
        }

        let req_bytes = req.into_bytes();
        let status = unsafe { mvm_host_call(req_bytes.as_ptr(), req_bytes.len()) };

        let resp = HOST_RESPONSE_BUF.with(|b| String::from_utf8_lossy(&b.borrow()).to_string());
        if status == 0 {
            return Err(MvmError::HostError {
                operation: symbol.to_string(),
                message: if resp.is_empty() {
                    "Host call failed".to_string()
                } else {
                    resp
                },
            });
        }

        if matches!(
            symbol,
            "console.print" | "print" | "std::io::print" | "std::io::println"
        ) {
            let line: Vec<String> = args.iter().map(|v| heap.format_value(v, 0)).collect();
            self.logs.push(line.join(" "));
            return Ok(Value::Void);
        }

        if let Some((tag, payload)) = resp.split_once(':') {
            match tag {
                "void" => Ok(Value::Void),
                "i64" => payload
                    .trim()
                    .parse::<i64>()
                    .map(Value::I64)
                    .map_err(|e| MvmError::HostError {
                        operation: symbol.to_string(),
                        message: e.to_string(),
                    }),
                "f64" => payload
                    .trim()
                    .parse::<f64>()
                    .map(Value::F64)
                    .map_err(|e| MvmError::HostError {
                        operation: symbol.to_string(),
                        message: e.to_string(),
                    }),
                "bool" => Ok(Value::Bool(payload.trim() == "true")),
                "str" => Ok(Value::Str(payload.to_string())),
                _ => Ok(Value::Str(resp)),
            }
        } else {
            Ok(Value::Void)
        }
    }

    fn stdout(&self) -> &[String] {
        &self.logs
    }
}

#[no_mangle]
pub unsafe extern "C" fn mvm_verify(mbc_ptr: *const u8, mbc_len: usize) -> i32 {
    let bytes = slice::from_raw_parts(mbc_ptr, mbc_len);
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
                set_output(format!("{{\"ok\":false,\"error\":\"{}\"}}", json_escape(&e.to_string())));
                0
            }
        },
        Err(e) => {
            set_output(format!("{{\"ok\":false,\"error\":\"{}\"}}", json_escape(&e.to_string())));
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn mvm_disassemble(mbc_ptr: *const u8, mbc_len: usize) -> i32 {
    let bytes = slice::from_raw_parts(mbc_ptr, mbc_len);
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
            set_output(format!("{{\"ok\":false,\"error\":\"{}\"}}", json_escape(&e.to_string())));
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn mvm_execute(
    mbc_ptr: *const u8,
    mbc_len: usize,
    cfg_ptr: *const u8,
    cfg_len: usize,
) -> i32 {
    let bytes = slice::from_raw_parts(mbc_ptr, mbc_len);
    let cfg_str = if cfg_ptr.is_null() || cfg_len == 0 {
        String::new()
    } else {
        String::from_utf8_lossy(slice::from_raw_parts(cfg_ptr, cfg_len)).to_string()
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
                "{{\"ok\":false,\"phase\":\"decode\",\"error\":\"{}\"}}",
                json_escape(&e.to_string())
            ));
            return 0;
        }
    };

    if let Err(e) = verify_module(&mut module) {
        set_output(format!(
            "{{\"ok\":false,\"phase\":\"verify\",\"error\":\"{}\"}}",
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
                "{{\"ok\":true,\"returnType\":\"{}\",\"returnValue\":\"{}\",\"stdout\":[{}],\"steps\":{},\"heapObjects\":{}}}",
                summary.return_value.type_name(),
                json_escape(&summary.formatted_return),
                stdout_json.join(","),
                summary.steps_executed,
                summary.heap_objects_allocated
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
                "{{\"ok\":false,\"phase\":\"runtime\",\"error\":\"{}\",\"stdout\":[{}]}}",
                json_escape(&e.to_string()),
                stdout_json.join(",")
            ));
            0
        }
    }
}

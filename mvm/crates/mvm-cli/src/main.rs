#![forbid(unsafe_code)]

use std::env;
use std::fs;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

use mvm_core::{
    decode_mbc, disassemble_module, stdlib, verify_module, CapabilityPolicy, HostEnvironment,
    MvmError, Value, VirtualMachine, VmLimits,
};
use mvm_core::memory::HeapArena;

struct NativeHostEnvironment {
    logs: Vec<String>,
}

impl NativeHostEnvironment {
    fn new() -> Self {
        Self { logs: Vec::new() }
    }
}

impl HostEnvironment for NativeHostEnvironment {
    fn invoke(
        &mut self,
        symbol: &str,
        _capability: &str,
        args: &[Value],
        heap: &mut HeapArena,
    ) -> Result<Value, MvmError> {
        if let Some(res) = stdlib::try_invoke_pure(symbol, args, heap)? {
            return Ok(res);
        }

        match symbol {
            "console.print" | "print" | "std::io::print" | "std::io::println" => {
                let text: Vec<String> = args.iter().map(|v| heap.format_value(v, 0)).collect();
                let line = text.join(" ");
                println!("{}", line);
                self.logs.push(line);
                Ok(Value::Void)
            }
            "time.now" | "std::time::now" => {
                let ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                Ok(Value::I64(ms))
            }
            "fs.read_text" | "std::fs::read_text" => {
                let path = match args.first() {
                    Some(Value::Str(s)) => s,
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected path string".to_string(),
                        })
                    }
                };
                let content = fs::read_to_string(path).map_err(|e| MvmError::HostError {
                    operation: symbol.to_string(),
                    message: e.to_string(),
                })?;
                Ok(Value::Str(content))
            }
            "fs.write_text" | "std::fs::write_text" => {
                let path = match args.first() {
                    Some(Value::Str(s)) => s,
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected path string".to_string(),
                        })
                    }
                };
                let body = match args.get(1) {
                    Some(Value::Str(s)) => s.clone(),
                    Some(v) => heap.format_value(v, 0),
                    None => String::new(),
                };
                fs::write(path, body).map_err(|e| MvmError::HostError {
                    operation: symbol.to_string(),
                    message: e.to_string(),
                })?;
                Ok(Value::Bool(true))
            }
            "crypto.hash" | "std::crypto::sha256" | "std::crypto::hash" => {
                let bytes = match args.first() {
                    Some(Value::Str(s)) => s.as_bytes().to_vec(),
                    Some(v) => heap.format_value(v, 0).into_bytes(),
                    None => Vec::new(),
                };
                Ok(Value::Str(stdlib::deterministic_hash_hex(&bytes)))
            }
            _ => Err(MvmError::HostError {
                operation: symbol.to_string(),
                message: format!("Unsupported native host call '{}'", symbol),
            }),
        }
    }

    fn stdout(&self) -> &[String] {
        &self.logs
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!(
            "Usage: mvm <verify|disasm|run> <file.mbc> [--allow <cap1,cap2,...>] [--max-steps <N>]"
        );
        process::exit(1);
    }

    let cmd = args[1].as_str();
    let file_path = &args[2];

    let mut policy = CapabilityPolicy::sandboxed_default();
    let mut limits = VmLimits::default();
    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--allow" if i + 1 < args.len() => {
                for cap in args[i + 1].split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    policy.grant(cap.to_string());
                }
                i += 2;
            }
            "--deny-console" => {
                policy.revoke("console");
                i += 1;
            }
            "--max-steps" if i + 1 < args.len() => {
                if let Ok(n) = args[i + 1].parse::<u64>() {
                    limits.max_steps = n;
                }
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    let bytes = match fs::read(file_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Failed to read '{}': {}", file_path, e);
            process::exit(1);
        }
    };

    let mut module = match decode_mbc(&bytes) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("Decode error: {}", e);
            process::exit(1);
        }
    };

    match cmd {
        "verify" => match verify_module(&mut module) {
            Ok(()) => {
                println!(
                    "Verified '{}' (v{}.{}, {} functions, {} constants)",
                    module.module_name,
                    module.major_version,
                    module.minor_version,
                    module.functions.len(),
                    module.constants.len()
                );
            }
            Err(e) => {
                eprintln!("Verification failed: {}", e);
                process::exit(1);
            }
        },
        "disasm" | "disassemble" => {
            if let Err(e) = verify_module(&mut module) {
                eprintln!("Warning: module failed verification: {}", e);
            }
            print!("{}", disassemble_module(&module));
        }
        "run" => {
            if let Err(e) = verify_module(&mut module) {
                eprintln!("Verification error: {}", e);
                process::exit(1);
            }
            let vm = VirtualMachine::new(limits, policy);
            let mut host = NativeHostEnvironment::new();
            match vm.execute(&module, &mut host, None) {
                Ok(summary) => {
                    if summary.return_value != Value::Void {
                        println!("=> {}", summary.formatted_return);
                    }
                }
                Err(e) => {
                    eprintln!("Runtime error: {}", e);
                    process::exit(1);
                }
            }
        }
        other => {
            eprintln!("Unknown command '{}'. Expected verify, disasm, or run.", other);
            process::exit(1);
        }
    }
}

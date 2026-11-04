use crate::errors::MvmError;
use crate::memory::HeapArena;
use crate::stdlib;
use crate::value::Value;

pub trait HostEnvironment {
    fn invoke(
        &mut self,
        symbol: &str,
        capability: &str,
        args: &[Value],
        heap: &mut HeapArena,
    ) -> Result<Value, MvmError>;

    fn stdout(&self) -> &[String];
}

/// Default deterministic in-memory host environment used for sandboxed execution and tests.
/// Supports `console` stdout capture, deterministic `time`, pure `stdlib`, and FNV/SHA-like hashing,
/// while rejecting unconfigured `fs` / `net` / `db` I/O unless overridden by a real host adapter.
pub struct MemoryHostEnvironment {
    logs: Vec<String>,
    virtual_files: std::collections::BTreeMap<String, String>,
    fixed_timestamp_ms: i64,
}

impl MemoryHostEnvironment {
    pub fn new() -> Self {
        Self {
            logs: Vec::new(),
            virtual_files: std::collections::BTreeMap::new(),
            fixed_timestamp_ms: 1_700_000_000_000,
        }
    }

    pub fn with_virtual_file(mut self, path: impl Into<String>, content: impl Into<String>) -> Self {
        self.virtual_files.insert(path.into(), content.into());
        self
    }

    pub fn set_timestamp_ms(&mut self, ts: i64) {
        self.fixed_timestamp_ms = ts;
    }

    pub fn virtual_files(&self) -> &std::collections::BTreeMap<String, String> {
        &self.virtual_files
    }
}

impl Default for MemoryHostEnvironment {
    fn default() -> Self {
        Self::new()
    }
}

impl HostEnvironment for MemoryHostEnvironment {
    fn invoke(
        &mut self,
        symbol: &str,
        _capability: &str,
        args: &[Value],
        heap: &mut HeapArena,
    ) -> Result<Value, MvmError> {
        // First check pure stdlib intrinsics
        if let Some(res) = stdlib::try_invoke_pure(symbol, args, heap)? {
            return Ok(res);
        }

        match symbol {
            "console.print" | "print" | "std::io::print" | "std::io::println" => {
                let text: Vec<String> = args.iter().map(|v| heap.format_value(v, 0)).collect();
                self.logs.push(text.join(" "));
                Ok(Value::Void)
            }
            "time.now" | "std::time::now" => Ok(Value::I64(self.fixed_timestamp_ms)),
            "fs.read_text" | "std::fs::read_text" => {
                let path = match args.first() {
                    Some(Value::Str(s)) => s,
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected string path argument".to_string(),
                        })
                    }
                };
                match self.virtual_files.get(path) {
                    Some(content) => Ok(Value::Str(content.clone())),
                    None => Err(MvmError::HostError {
                        operation: symbol.to_string(),
                        message: format!("Virtual file '{}' not found", path),
                    }),
                }
            }
            "fs.write_text" | "std::fs::write_text" => {
                let path = match args.first() {
                    Some(Value::Str(s)) => s.clone(),
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected string path argument".to_string(),
                        })
                    }
                };
                let content = match args.get(1) {
                    Some(Value::Str(s)) => s.clone(),
                    Some(other) => heap.format_value(other, 0),
                    None => String::new(),
                };
                self.virtual_files.insert(path, content);
                Ok(Value::Bool(true))
            }
            "crypto.hash" | "std::crypto::sha256" | "std::crypto::hash" => {
                let input = match args.first() {
                    Some(Value::Str(s)) => s.as_bytes().to_vec(),
                    Some(other) => heap.format_value(other, 0).into_bytes(),
                    None => Vec::new(),
                };
                Ok(Value::Str(stdlib::deterministic_hash_hex(&input)))
            }
            _ => Err(MvmError::HostError {
                operation: symbol.to_string(),
                message: format!(
                    "Host operation '{}' is not registered in this host environment",
                    symbol
                ),
            }),
        }
    }

    fn stdout(&self) -> &[String] {
        &self.logs
    }
}

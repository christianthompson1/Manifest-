#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

use manifest_compiler::json::JsonValue;
use manifest_compiler::{
    check_source, compile_source, CheckOutcome, CompileOutcome, CompileRequest, Diagnostic,
    Severity, ENGINE_ABI_VERSION, ENGINE_NAME, ENGINE_VERSION,
};
use mvm_core::bytecode::MBC_MAGIC;
use mvm_core::memory::HeapArena;
use mvm_core::{
    decode_mbc, disassemble_module, stdlib, verify_module, CapabilityPolicy, HostEnvironment,
    MvmError, Value, VirtualMachine, VmLimits,
};

const MAX_WORKSPACE_FILES: usize = 512;
const MAX_WORKSPACE_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_DIR_DEPTH: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkspaceAccessMode {
    ReadExisting,
    WriteFile,
    DeleteEntry,
    CreateDir,
}

fn canonicalize_workspace_root(root: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(root).map_err(|e| {
        format!(
            "Failed to canonicalize workspace root '{}': {}",
            root.display(),
            e
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "Workspace root '{}' is not a directory",
            canonical.display()
        ));
    }
    Ok(canonical)
}

/// Resolves `raw_path` strictly inside `workspace_root` (already canonicalized).
/// Blocks NUL bytes, absolute paths, drive prefixes, `..` traversal, intermediate symlinks,
/// and symlink targets resolving outside `workspace_root`.
fn resolve_confined_workspace_path(
    workspace_root: &Path,
    raw_path: &str,
    mode: WorkspaceAccessMode,
) -> Result<PathBuf, String> {
    if raw_path.is_empty() {
        return Err("Filesystem path must not be empty".to_string());
    }
    if raw_path.contains('\0') {
        return Err("Filesystem path contains invalid NUL byte".to_string());
    }

    let rel = Path::new(raw_path);
    if rel.is_absolute() {
        return Err(format!(
            "Absolute path '{}' is outside confined workspace '{}'",
            raw_path,
            workspace_root.display()
        ));
    }

    let mut clean_components: Vec<std::ffi::OsString> = Vec::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(part) => clean_components.push(part.to_os_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!(
                    "Path traversal ('..') denied for '{}' outside workspace '{}'",
                    raw_path,
                    workspace_root.display()
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "Root/prefix path component denied for '{}'",
                    raw_path
                ));
            }
        }
    }

    if clean_components.is_empty() {
        return Err(format!(
            "Target path '{}' does not specify a workspace entry",
            raw_path
        ));
    }

    let mut current = workspace_root.to_path_buf();
    let total = clean_components.len();

    for (idx, part) in clean_components.iter().enumerate() {
        current.push(part);
        let is_last = idx + 1 == total;

        match fs::symlink_metadata(&current) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err(format!(
                        "Symlink access denied inside confined workspace at '{}'",
                        current.display()
                    ));
                }
                let canonical = fs::canonicalize(&current).map_err(|e| {
                    format!("Failed to canonicalize '{}': {}", current.display(), e)
                })?;
                if !canonical.starts_with(workspace_root) {
                    return Err(format!(
                        "Resolved path '{}' escapes workspace '{}'",
                        canonical.display(),
                        workspace_root.display()
                    ));
                }
                if !is_last && !meta.is_dir() {
                    return Err(format!(
                        "Non-directory intermediate path component '{}'",
                        current.display()
                    ));
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                if mode == WorkspaceAccessMode::ReadExisting
                    || mode == WorkspaceAccessMode::DeleteEntry
                {
                    return Err(format!(
                        "Path '{}' does not exist inside workspace",
                        raw_path
                    ));
                }
                if let Some(parent) = current.parent() {
                    if parent.exists() {
                        let parent_canon = fs::canonicalize(parent).map_err(|e| {
                            format!(
                                "Failed to canonicalize parent '{}': {}",
                                parent.display(),
                                e
                            )
                        })?;
                        if !parent_canon.starts_with(workspace_root) {
                            return Err(format!(
                                "Parent directory '{}' escapes workspace '{}'",
                                parent_canon.display(),
                                workspace_root.display()
                            ));
                        }
                    }
                }
            }
            Err(err) => {
                return Err(format!(
                    "Filesystem check failed for '{}': {}",
                    raw_path, err
                ));
            }
        }
    }

    if matches!(
        mode,
        WorkspaceAccessMode::ReadExisting
            | WorkspaceAccessMode::CreateDir
            | WorkspaceAccessMode::DeleteEntry
    ) && current.exists()
    {
        let final_canon = fs::canonicalize(&current)
            .map_err(|e| format!("Failed to verify target '{}': {}", current.display(), e))?;
        if !final_canon.starts_with(workspace_root) {
            return Err(format!(
                "Resolved target '{}' escapes workspace '{}'",
                final_canon.display(),
                workspace_root.display()
            ));
        }
    }

    Ok(current)
}

fn collect_manifest_files_recursive(
    root: &Path,
    dir: &Path,
    depth: usize,
    total_bytes: &mut usize,
    out: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    if depth > MAX_DIR_DEPTH || out.len() >= MAX_WORKSPACE_FILES {
        return Ok(());
    }
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to list workspace directory '{}': {}", dir.display(), e))?;
    for entry_res in entries {
        if out.len() >= MAX_WORKSPACE_FILES {
            break;
        }
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if matches!(name_str.as_ref(), ".git" | "node_modules" | "target" | "dist") {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            collect_manifest_files_recursive(root, &path, depth + 1, total_bytes, out)?;
        } else if meta.is_file() && path.extension().is_some_and(|e| e == "manifest") {
            let Ok(canon) = fs::canonicalize(&path) else {
                continue;
            };
            if !canon.starts_with(root) {
                continue;
            }
            if *total_bytes + (meta.len() as usize) > MAX_WORKSPACE_TOTAL_BYTES {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&canon) {
                if let Ok(rel) = canon.strip_prefix(root) {
                    let rel_key = rel.to_string_lossy().replace('\\', "/");
                    *total_bytes += content.len();
                    out.insert(rel_key, content);
                }
            }
        }
    }
    Ok(())
}

struct NativeHostEnvironment {
    logs: Vec<String>,
    workspace_root: PathBuf,
    suppress_stdout: bool,
}

impl NativeHostEnvironment {
    fn new(workspace_root: PathBuf, suppress_stdout: bool) -> Self {
        Self {
            logs: Vec::new(),
            workspace_root,
            suppress_stdout,
        }
    }

    fn resolve_path(
        &self,
        raw_path: &str,
        mode: WorkspaceAccessMode,
        operation: &str,
    ) -> Result<PathBuf, MvmError> {
        resolve_confined_workspace_path(&self.workspace_root, raw_path, mode).map_err(|msg| {
            MvmError::HostError {
                operation: operation.to_string(),
                message: msg,
            }
        })
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
            "console.print" | "print" | "println" | "std::io::print" | "std::io::println" => {
                let text: Vec<String> = args.iter().map(|v| heap.format_value(v, 0)).collect();
                let line = text.join(" ");
                if !self.suppress_stdout {
                    println!("{}", line);
                }
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
                let raw_path = match args.first() {
                    Some(Value::Str(s)) => s,
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected path string".to_string(),
                        })
                    }
                };
                let target =
                    self.resolve_path(raw_path, WorkspaceAccessMode::ReadExisting, symbol)?;
                let content = fs::read_to_string(target).map_err(|e| MvmError::HostError {
                    operation: symbol.to_string(),
                    message: e.to_string(),
                })?;
                Ok(Value::Str(content))
            }
            "fs.write_text" | "std::fs::write_text" => {
                let raw_path = match args.first() {
                    Some(Value::Str(s)) => s,
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected path string".to_string(),
                        })
                    }
                };
                let target = self.resolve_path(raw_path, WorkspaceAccessMode::WriteFile, symbol)?;
                if let Some(parent) = target.parent() {
                    if !parent.exists() {
                        fs::create_dir_all(parent).map_err(|e| MvmError::HostError {
                            operation: symbol.to_string(),
                            message: e.to_string(),
                        })?;
                    }
                }
                let body = match args.get(1) {
                    Some(Value::Str(s)) => s.clone(),
                    Some(v) => heap.format_value(v, 0),
                    None => String::new(),
                };
                fs::write(target, body).map_err(|e| MvmError::HostError {
                    operation: symbol.to_string(),
                    message: e.to_string(),
                })?;
                Ok(Value::Bool(true))
            }
            "fs.delete" | "std::fs::delete" => {
                let raw_path = match args.first() {
                    Some(Value::Str(s)) => s,
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected path string".to_string(),
                        })
                    }
                };
                let target =
                    self.resolve_path(raw_path, WorkspaceAccessMode::DeleteEntry, symbol)?;
                fs::remove_file(target).map_err(|e| MvmError::HostError {
                    operation: symbol.to_string(),
                    message: e.to_string(),
                })?;
                Ok(Value::Bool(true))
            }
            "fs.mkdir" | "std::fs::mkdir" => {
                let raw_path = match args.first() {
                    Some(Value::Str(s)) => s,
                    _ => {
                        return Err(MvmError::HostError {
                            operation: symbol.to_string(),
                            message: "Expected path string".to_string(),
                        })
                    }
                };
                let target = self.resolve_path(raw_path, WorkspaceAccessMode::CreateDir, symbol)?;
                fs::create_dir_all(target).map_err(|e| MvmError::HostError {
                    operation: symbol.to_string(),
                    message: e.to_string(),
                })?;
                Ok(Value::Bool(true))
            }
            "crypto.hash" | "std::crypto::sha256" | "std::crypto::hash" => match args.first() {
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
            },
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

struct CliOptions {
    profile: Option<String>,
    target: String,
    out_path: Option<PathBuf>,
    workspace_arg: Option<PathBuf>,
    entry_override: Option<String>,
    policy: CapabilityPolicy,
    limits: VmLimits,
    json: bool,
    optimize: bool,
}

impl Default for CliOptions {
    fn default() -> Self {
        Self {
            profile: None,
            target: "mvm".to_string(),
            out_path: None,
            workspace_arg: None,
            entry_override: None,
            policy: CapabilityPolicy::sandboxed_default(),
            limits: VmLimits::default(),
            json: false,
            optimize: true,
        }
    }
}

fn print_usage() {
    eprintln!(
        "Manifest Native CLI & MVM ({ENGINE_NAME} v{ENGINE_VERSION})

Usage:
  mvm check <file.manifest> [--profile beginner|professional] [--workspace <dir>] [--no-opt] [--json]
  mvm build <file.manifest> [-o <out.mbc>] [--target mvm|mir] [--profile ...] [--workspace <dir>] [--no-opt] [--json]
  mvm run <file.manifest|file.mbc> [--allow <cap1,cap2>] [--deny-console] [--entry <fn>] [--workspace <dir>] [--max-steps <N>] [--max-depth <N>] [--max-heap <N>] [--max-heap-bytes <N>] [--profile ...] [--no-opt] [--json]
  mvm ir <file.manifest> [--profile ...] [--workspace <dir>] [--no-opt] [--json]
  mvm disasm <file.manifest|file.mbc> [--profile ...] [--workspace <dir>] [--no-opt]
  mvm verify <file.manifest|file.mbc> [--profile ...] [--workspace <dir>] [--no-opt] [--json]
  mvm targets [--json]
  mvm version [--json]"
    );
}

fn format_diagnostics(diags: &[Diagnostic]) {
    for d in diags {
        let sev = match d.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Info => "info",
        };
        let loc = match &d.file {
            Some(f) => format!("{f}:{}:{}", d.line, d.column),
            None => format!("{}:{}", d.line, d.column),
        };
        eprintln!("{sev}[{}] ({loc}): {}", d.code, d.message);
        if let Some(hint) = &d.hint {
            eprintln!("  hint: {hint}");
        }
    }
}

fn prepare_compile_request(
    file_path: &str,
    opts: &CliOptions,
    workspace_root: &Path,
    explicit_workspace: bool,
) -> Result<CompileRequest, String> {
    let raw_entry = Path::new(file_path);
    let canon_entry = fs::canonicalize(raw_entry)
        .map_err(|e| format!("Failed to read '{}': {}", file_path, e))?;

    let (scan_root, entry_key) = if explicit_workspace {
        if !canon_entry.starts_with(workspace_root) {
            return Err(format!(
                "Entry file '{}' is outside configured workspace '{}'",
                canon_entry.display(),
                workspace_root.display()
            ));
        }
        let rel = canon_entry
            .strip_prefix(workspace_root)
            .map_err(|e| format!("Failed to resolve relative entry path: {e}"))?;
        (
            workspace_root.to_path_buf(),
            rel.to_string_lossy().replace('\\', "/"),
        )
    } else {
        let parent = canon_entry
            .parent()
            .ok_or_else(|| format!("Entry file '{}' has no parent directory", file_path))?;
        let canon_parent = canonicalize_workspace_root(parent)?;
        let file_name = canon_entry
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "main.manifest".to_string());
        (canon_parent, file_name)
    };

    let source = fs::read_to_string(&canon_entry)
        .map_err(|e| format!("Failed to read source '{}': {}", canon_entry.display(), e))?;

    let mut files = BTreeMap::new();
    let mut total_bytes = source.len();
    collect_manifest_files_recursive(&scan_root, &scan_root, 0, &mut total_bytes, &mut files)?;

    Ok(CompileRequest {
        source,
        entry_file: entry_key,
        profile: opts.profile.clone(),
        files,
        optimize: opts.optimize,
    })
}

fn is_mbc_file(path: &str, bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0..4] == MBC_MAGIC
        || Path::new(path).extension().is_some_and(|e| e == "mbc")
}

fn targets_json() -> JsonValue {
    JsonValue::Object(vec![
        (
            "engine".to_string(),
            JsonValue::String(ENGINE_NAME.to_string()),
        ),
        (
            "version".to_string(),
            JsonValue::String(ENGINE_VERSION.to_string()),
        ),
        (
            "abiVersion".to_string(),
            JsonValue::Number(ENGINE_ABI_VERSION as f64),
        ),
        (
            "targets".to_string(),
            JsonValue::Array(vec![
                JsonValue::Object(vec![
                    ("id".to_string(), JsonValue::String("mvm".to_string())),
                    (
                        "name".to_string(),
                        JsonValue::String("Manifest Bytecode (.mbc) / Rust MVM".to_string()),
                    ),
                    (
                        "status".to_string(),
                        JsonValue::String("authoritative".to_string()),
                    ),
                    ("nativeCliSupported".to_string(), JsonValue::Bool(true)),
                ]),
                JsonValue::Object(vec![
                    ("id".to_string(), JsonValue::String("mir".to_string())),
                    (
                        "name".to_string(),
                        JsonValue::String("Typed Manifest IR (.mir.json)".to_string()),
                    ),
                    (
                        "status".to_string(),
                        JsonValue::String("authoritative".to_string()),
                    ),
                    ("nativeCliSupported".to_string(), JsonValue::Bool(true)),
                ]),
                JsonValue::Object(vec![
                    ("id".to_string(), JsonValue::String("web-js".to_string())),
                    (
                        "name".to_string(),
                        JsonValue::String("JavaScript / Web (via Rust MIR)".to_string()),
                    ),
                    ("status".to_string(), JsonValue::String("host-ts".to_string())),
                    ("nativeCliSupported".to_string(), JsonValue::Bool(false)),
                ]),
                JsonValue::Object(vec![
                    ("id".to_string(), JsonValue::String("wasm".to_string())),
                    (
                        "name".to_string(),
                        JsonValue::String("WebAssembly MVP (via Rust MIR)".to_string()),
                    ),
                    ("status".to_string(), JsonValue::String("host-ts".to_string())),
                    ("nativeCliSupported".to_string(), JsonValue::Bool(false)),
                ]),
                JsonValue::Object(vec![
                    ("id".to_string(), JsonValue::String("native".to_string())),
                    (
                        "name".to_string(),
                        JsonValue::String("Native Rust Source Codegen (via Rust MIR)".to_string()),
                    ),
                    ("status".to_string(), JsonValue::String("experimental".to_string())),
                    ("nativeCliSupported".to_string(), JsonValue::Bool(false)),
                ]),
            ]),
        ),
    ])
}

fn handle_check(file_path: &str, opts: &CliOptions, ws_root: &Path, explicit_ws: bool) -> i32 {
    let req = match prepare_compile_request(file_path, opts, ws_root, explicit_ws) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("{msg}");
            return 1;
        }
    };
    let outcome: CheckOutcome = check_source(&req);
    if opts.json {
        println!("{}", outcome.to_json_value().to_json_string());
    } else {
        format_diagnostics(&outcome.diagnostics);
        if outcome.ok {
            println!(
                "Checked '{}' (profile: {}, ok)",
                outcome.module_name,
                outcome.resolved_profile.as_str()
            );
        }
    }
    if outcome.ok {
        0
    } else {
        1
    }
}

fn handle_ir(file_path: &str, opts: &CliOptions, ws_root: &Path, explicit_ws: bool) -> i32 {
    let req = match prepare_compile_request(file_path, opts, ws_root, explicit_ws) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("{msg}");
            return 1;
        }
    };
    let outcome = check_source(&req);
    if opts.json {
        println!("{}", outcome.to_json_value().to_json_string());
    } else if !outcome.ok {
        format_diagnostics(&outcome.diagnostics);
    } else if let Some(text) = &outcome.ir_text {
        println!("{text}");
    }
    if outcome.ok {
        0
    } else {
        1
    }
}

fn handle_build(file_path: &str, opts: &CliOptions, ws_root: &Path, explicit_ws: bool) -> i32 {
    if opts.target != "mvm" && opts.target != "mir" {
        eprintln!(
            "Target '{}' is not directly emitted by the standalone native CLI (supported native CLI targets: mvm, mir).",
            opts.target
        );
        return 1;
    }

    let req = match prepare_compile_request(file_path, opts, ws_root, explicit_ws) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("{msg}");
            return 1;
        }
    };

    if opts.target == "mir" {
        let check = check_source(&req);
        if !check.ok {
            if opts.json {
                println!("{}", check.to_json_value().to_json_string());
            } else {
                format_diagnostics(&check.diagnostics);
            }
            return 1;
        }
        let mir_json = check
            .mir
            .as_ref()
            .map(|m| m.to_json().to_json_string())
            .unwrap_or_else(|| "null".to_string());
        let out_file = opts
            .out_path
            .clone()
            .unwrap_or_else(|| Path::new(file_path).with_extension("mir.json"));
        if let Err(e) = fs::write(&out_file, &mir_json) {
            eprintln!("Failed to write '{}': {e}", out_file.display());
            return 1;
        }
        if opts.json {
            println!("{}", check.to_json_value().to_json_string());
        } else {
            println!("Built MIR '{}'", out_file.display());
        }
        return 0;
    }

    let outcome: CompileOutcome = compile_source(&req);
    if !outcome.check.ok {
        if opts.json {
            println!("{}", outcome.to_json_value().to_json_string());
        } else {
            format_diagnostics(&outcome.check.diagnostics);
        }
        return 1;
    }

    let Some(mbc) = &outcome.mbc else {
        eprintln!("Compilation produced no bytecode artifact");
        return 1;
    };

    let out_file = opts
        .out_path
        .clone()
        .unwrap_or_else(|| Path::new(file_path).with_extension("mbc"));
    if let Err(e) = fs::write(&out_file, &mbc.bytes) {
        eprintln!("Failed to write '{}': {e}", out_file.display());
        return 1;
    }

    if opts.json {
        println!("{}", outcome.to_json_value().to_json_string());
    } else {
        format_diagnostics(&outcome.check.diagnostics);
        println!(
            "Built '{}' -> '{}' ({} bytes, {} functions, {} constants)",
            mbc.module_name,
            out_file.display(),
            mbc.bytes.len(),
            mbc.function_count,
            mbc.constant_count
        );
    }
    0
}

fn execute_mbc_bytes(
    bytes: &[u8],
    opts: &CliOptions,
    workspace_root: &Path,
) -> i32 {
    let mut module = match decode_mbc(bytes) {
        Ok(m) => m,
        Err(e) => {
            if opts.json {
                let obj = JsonValue::Object(vec![
                    ("ok".to_string(), JsonValue::Bool(false)),
                    ("phase".to_string(), JsonValue::String("decode".to_string())),
                    ("errorCode".to_string(), JsonValue::String(e.code().to_string())),
                    ("error".to_string(), JsonValue::String(e.to_string())),
                ]);
                println!("{}", obj.to_json_string());
            } else {
                eprintln!("Decode error: {e}");
            }
            return 1;
        }
    };

    if let Err(e) = verify_module(&mut module) {
        if opts.json {
            let obj = JsonValue::Object(vec![
                ("ok".to_string(), JsonValue::Bool(false)),
                ("phase".to_string(), JsonValue::String("verify".to_string())),
                ("errorCode".to_string(), JsonValue::String(e.code().to_string())),
                ("error".to_string(), JsonValue::String(e.to_string())),
            ]);
            println!("{}", obj.to_json_string());
        } else {
            eprintln!("Verification error: {e}");
        }
        return 1;
    }

    let vm = VirtualMachine::new(opts.limits.clone(), opts.policy.clone());
    let mut host = NativeHostEnvironment::new(workspace_root.to_path_buf(), opts.json);
    match vm.execute(&module, &mut host, opts.entry_override.as_deref()) {
        Ok(summary) => {
            if opts.json {
                let obj = JsonValue::Object(vec![
                    ("ok".to_string(), JsonValue::Bool(true)),
                    (
                        "returnType".to_string(),
                        JsonValue::String(summary.return_value.type_name().to_string()),
                    ),
                    (
                        "returnValue".to_string(),
                        JsonValue::String(summary.formatted_return),
                    ),
                    (
                        "stdout".to_string(),
                        JsonValue::Array(
                            summary
                                .stdout
                                .into_iter()
                                .map(JsonValue::String)
                                .collect(),
                        ),
                    ),
                    ("steps".to_string(), JsonValue::Number(summary.steps_executed as f64)),
                    (
                        "heapObjects".to_string(),
                        JsonValue::Number(summary.gc_stats.live_objects as f64),
                    ),
                    (
                        "heapObjectsAllocated".to_string(),
                        JsonValue::Number(summary.heap_objects_allocated as f64),
                    ),
                ]);
                println!("{}", obj.to_json_string());
            } else if summary.return_value != Value::Void {
                println!("=> {}", summary.formatted_return);
            }
            0
        }
        Err(e) => {
            if opts.json {
                let obj = JsonValue::Object(vec![
                    ("ok".to_string(), JsonValue::Bool(false)),
                    ("phase".to_string(), JsonValue::String("runtime".to_string())),
                    ("errorCode".to_string(), JsonValue::String(e.code().to_string())),
                    ("error".to_string(), JsonValue::String(e.to_string())),
                    (
                        "stdout".to_string(),
                        JsonValue::Array(
                            host.stdout()
                                .iter()
                                .cloned()
                                .map(JsonValue::String)
                                .collect(),
                        ),
                    ),
                ]);
                println!("{}", obj.to_json_string());
            } else {
                eprintln!("Runtime error: {e}");
            }
            1
        }
    }
}

fn load_mbc_or_compile(
    file_path: &str,
    opts: &CliOptions,
    ws_root: &Path,
    explicit_ws: bool,
) -> Result<(Vec<u8>, Option<CompileOutcome>), String> {
    let raw_bytes = fs::read(file_path).map_err(|e| format!("Failed to read '{}': {}", file_path, e))?;
    if is_mbc_file(file_path, &raw_bytes) {
        return Ok((raw_bytes, None));
    }
    let req = prepare_compile_request(file_path, opts, ws_root, explicit_ws)?;
    let out = compile_source(&req);
    if !out.check.ok {
        return Ok((Vec::new(), Some(out)));
    }
    let bytes = out
        .mbc
        .as_ref()
        .map(|m| m.bytes.clone())
        .ok_or_else(|| "Compilation failed to emit MBC bytes".to_string())?;
    Ok((bytes, Some(out)))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    let cmd = args[1].as_str();
    let mut opts = CliOptions::default();

    let mut idx = 2;
    let mut positional: Vec<String> = Vec::new();
    while idx < args.len() {
        match args[idx].as_str() {
            "--profile" if idx + 1 < args.len() => {
                opts.profile = Some(args[idx + 1].clone());
                idx += 2;
            }
            "--target" if idx + 1 < args.len() => {
                opts.target = args[idx + 1].clone();
                idx += 2;
            }
            "-o" | "--out" if idx + 1 < args.len() => {
                opts.out_path = Some(PathBuf::from(&args[idx + 1]));
                idx += 2;
            }
            "--allow" if idx + 1 < args.len() => {
                for cap in args[idx + 1]
                    .split(',')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    opts.policy.grant(cap.to_string());
                }
                idx += 2;
            }
            "--deny-console" => {
                opts.policy.revoke("console");
                idx += 1;
            }
            "--entry" if idx + 1 < args.len() => {
                opts.entry_override = Some(args[idx + 1].clone());
                idx += 2;
            }
            "--max-steps" if idx + 1 < args.len() => {
                if let Ok(n) = args[idx + 1].parse::<u64>() {
                    opts.limits.max_steps = n;
                }
                idx += 2;
            }
            "--max-depth" if idx + 1 < args.len() => {
                if let Ok(n) = args[idx + 1].parse::<usize>() {
                    opts.limits.max_call_depth = n;
                }
                idx += 2;
            }
            "--max-heap" if idx + 1 < args.len() => {
                if let Ok(n) = args[idx + 1].parse::<usize>() {
                    opts.limits.max_heap_objects = n;
                }
                idx += 2;
            }
            "--max-heap-bytes" if idx + 1 < args.len() => {
                if let Ok(n) = args[idx + 1].parse::<usize>() {
                    opts.limits.max_heap_bytes = n;
                }
                idx += 2;
            }
            "--workspace" if idx + 1 < args.len() => {
                opts.workspace_arg = Some(PathBuf::from(&args[idx + 1]));
                idx += 2;
            }
            "--json" => {
                opts.json = true;
                idx += 1;
            }
            "--no-opt" => {
                opts.optimize = false;
                idx += 1;
            }
            other => {
                positional.push(other.to_string());
                idx += 1;
            }
        }
    }

    match cmd {
        "targets" => {
            if opts.json {
                println!("{}", targets_json().to_json_string());
            } else {
                println!("Authoritative targets (Rust native CLI): mvm, mir");
                println!("Host JS/TS compiler targets (consuming Rust MIR): web-js, wasm, native");
            }
            return;
        }
        "version" | "--version" | "-V" => {
            if opts.json {
                let obj = JsonValue::Object(vec![
                    ("engine".to_string(), JsonValue::String(ENGINE_NAME.to_string())),
                    (
                        "version".to_string(),
                        JsonValue::String(ENGINE_VERSION.to_string()),
                    ),
                    (
                        "abiVersion".to_string(),
                        JsonValue::Number(ENGINE_ABI_VERSION as f64),
                    ),
                ]);
                println!("{}", obj.to_json_string());
            } else {
                println!("mvm {ENGINE_VERSION} ({ENGINE_NAME} ABI v{ENGINE_ABI_VERSION})");
            }
            return;
        }
        "--help" | "-h" | "help" => {
            print_usage();
            return;
        }
        _ => {}
    }

    let Some(file_path) = positional.first() else {
        print_usage();
        process::exit(1);
    };

    let explicit_ws = opts.workspace_arg.is_some();
    let workspace_raw = match &opts.workspace_arg {
        Some(dir) => dir.clone(),
        None => env::current_dir().unwrap_or_else(|e| {
            eprintln!("Failed to determine current working directory: {}", e);
            process::exit(1);
        }),
    };
    let workspace_root = match canonicalize_workspace_root(&workspace_raw) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{}", e);
            process::exit(1);
        }
    };

    let code = match cmd {
        "check" => handle_check(file_path, &opts, &workspace_root, explicit_ws),
        "build" | "compile" => handle_build(file_path, &opts, &workspace_root, explicit_ws),
        "ir" | "inspect" => handle_ir(file_path, &opts, &workspace_root, explicit_ws),
        "verify" => match load_mbc_or_compile(file_path, &opts, &workspace_root, explicit_ws) {
            Ok((_bytes, Some(out))) if !out.check.ok => {
                if opts.json {
                    println!("{}", out.to_json_value().to_json_string());
                } else {
                    format_diagnostics(&out.check.diagnostics);
                }
                1
            }
            Ok((bytes, _)) => match decode_mbc(&bytes) {
                Ok(mut module) => match verify_module(&mut module) {
                    Ok(()) => {
                        if opts.json {
                            let obj = JsonValue::Object(vec![
                                ("ok".to_string(), JsonValue::Bool(true)),
                                (
                                    "moduleName".to_string(),
                                    JsonValue::String(module.module_name.clone()),
                                ),
                                (
                                    "functions".to_string(),
                                    JsonValue::Number(module.functions.len() as f64),
                                ),
                                (
                                    "constants".to_string(),
                                    JsonValue::Number(module.constants.len() as f64),
                                ),
                            ]);
                            println!("{}", obj.to_json_string());
                        } else {
                            println!(
                                "Verified '{}' (v{}.{}, {} functions, {} constants)",
                                module.module_name,
                                module.major_version,
                                module.minor_version,
                                module.functions.len(),
                                module.constants.len()
                            );
                        }
                        0
                    }
                    Err(e) => {
                        eprintln!("Verification failed: {e}");
                        1
                    }
                },
                Err(e) => {
                    eprintln!("Decode error: {e}");
                    1
                }
            },
            Err(msg) => {
                eprintln!("{msg}");
                1
            }
        },
        "disasm" | "disassemble" => {
            match load_mbc_or_compile(file_path, &opts, &workspace_root, explicit_ws) {
                Ok((_bytes, Some(out))) if !out.check.ok => {
                    format_diagnostics(&out.check.diagnostics);
                    1
                }
                Ok((bytes, _)) => match decode_mbc(&bytes) {
                    Ok(mut module) => {
                        if let Err(e) = verify_module(&mut module) {
                            eprintln!("Warning: module failed verification: {e}");
                        }
                        print!("{}", disassemble_module(&module));
                        0
                    }
                    Err(e) => {
                        eprintln!("Decode error: {e}");
                        1
                    }
                },
                Err(msg) => {
                    eprintln!("{msg}");
                    1
                }
            }
        }
        "run" => match load_mbc_or_compile(file_path, &opts, &workspace_root, explicit_ws) {
            Ok((_bytes, Some(out))) if !out.check.ok => {
                if opts.json {
                    println!("{}", out.to_json_value().to_json_string());
                } else {
                    format_diagnostics(&out.check.diagnostics);
                }
                1
            }
            Ok((bytes, _)) => execute_mbc_bytes(&bytes, &opts, &workspace_root),
            Err(msg) => {
                eprintln!("{msg}");
                1
            }
        },
        other => {
            eprintln!(
                "Unknown command '{}'. Expected check, build, run, ir, verify, disasm, targets, or version.",
                other
            );
            1
        }
    };

    if code != 0 {
        process::exit(code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("mvm_cli_test_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn confines_reads_writes_and_blocks_traversal_and_absolute_paths() {
        let base = make_temp_dir("confinement");
        let workspace = base.join("ws");
        let outside = base.join("outside.txt");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(&outside, "secret-outside").unwrap();
        let root = canonicalize_workspace_root(&workspace).unwrap();

        let mut host = NativeHostEnvironment::new(root.clone(), true);
        let mut heap = HeapArena::new(64);
        let write_ok = host
            .invoke(
                "fs.write_text",
                "fs.write",
                &[
                    Value::Str("nested/note.txt".to_string()),
                    Value::Str("hello".to_string()),
                ],
                &mut heap,
            )
            .unwrap();
        assert_eq!(write_ok, Value::Bool(true));

        let read_ok = host
            .invoke(
                "fs.read_text",
                "fs.read",
                &[Value::Str("nested/note.txt".to_string())],
                &mut heap,
            )
            .unwrap();
        assert_eq!(read_ok, Value::Str("hello".to_string()));

        assert!(host
            .invoke(
                "fs.read_text",
                "fs.read",
                &[Value::Str("../outside.txt".to_string())],
                &mut heap,
            )
            .is_err());
        assert!(host
            .invoke(
                "fs.write_text",
                "fs.write",
                &[
                    Value::Str("nested/../../escape.txt".to_string()),
                    Value::Str("pwn".to_string()),
                ],
                &mut heap,
            )
            .is_err());
        assert!(host
            .invoke(
                "fs.read_text",
                "fs.read",
                &[Value::Str(outside.to_string_lossy().to_string())],
                &mut heap,
            )
            .is_err());
        assert!(resolve_confined_workspace_path(
            &root,
            "ok.txt\0.evil",
            WorkspaceAccessMode::WriteFile
        )
        .is_err());

        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn blocks_symlink_escapes_for_files_and_intermediate_directories() {
        use std::os::unix::fs::symlink;

        let base = make_temp_dir("symlink");
        let workspace = base.join("ws");
        let outside_dir = base.join("outside_dir");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        fs::write(outside_dir.join("secret.txt"), "top-secret").unwrap();

        symlink(&outside_dir, workspace.join("linked_dir")).unwrap();
        symlink(
            outside_dir.join("secret.txt"),
            workspace.join("linked_file.txt"),
        )
        .unwrap();

        let root = canonicalize_workspace_root(&workspace).unwrap();
        assert!(resolve_confined_workspace_path(
            &root,
            "linked_file.txt",
            WorkspaceAccessMode::ReadExisting
        )
        .is_err());
        assert!(resolve_confined_workspace_path(
            &root,
            "linked_dir/secret.txt",
            WorkspaceAccessMode::ReadExisting
        )
        .is_err());
        assert!(resolve_confined_workspace_path(
            &root,
            "linked_dir/new_file.txt",
            WorkspaceAccessMode::WriteFile
        )
        .is_err());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn cli_handlers_check_build_ir_and_run_manifest_sources() {
        let base = make_temp_dir("cli_pipeline");
        let ws = base.join("ws");
        fs::create_dir_all(&ws).unwrap();
        fs::write(
            ws.join("math.manifest"),
            "module math;\npub fn cube(x: i64) -> i64 { return x * x * x; }\n",
        )
        .unwrap();
        let entry = ws.join("app.manifest");
        fs::write(
            &entry,
            "module app;\nrequires [console];\nimport { cube } from \"./math.manifest\";\nfn main() -> i64 {\n  let c = cube(3);\n  print(to_str(c));\n  return c;\n}\n",
        )
        .unwrap();
        let root = canonicalize_workspace_root(&ws).unwrap();
        let opts = CliOptions::default();

        assert_eq!(
            handle_check(entry.to_str().unwrap(), &opts, &root, true),
            0
        );
        assert_eq!(handle_ir(entry.to_str().unwrap(), &opts, &root, true), 0);

        let mbc_out = ws.join("app.mbc");
        let build_opts = CliOptions {
            out_path: Some(mbc_out.clone()),
            ..CliOptions::default()
        };
        assert_eq!(
            handle_build(entry.to_str().unwrap(), &build_opts, &root, true),
            0
        );
        assert!(mbc_out.exists());

        let (bytes, _) =
            load_mbc_or_compile(mbc_out.to_str().unwrap(), &opts, &root, true).unwrap();
        assert_eq!(execute_mbc_bytes(&bytes, &opts, &root), 0);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn cli_rejects_entry_file_outside_explicit_workspace() {
        let base = make_temp_dir("cli_ws_escape");
        let ws = base.join("ws");
        let outside = base.join("outside.manifest");
        fs::create_dir_all(&ws).unwrap();
        fs::write(&outside, "module x; fn main() -> i64 { return 1; }").unwrap();
        let root = canonicalize_workspace_root(&ws).unwrap();
        let opts = CliOptions::default();
        assert!(prepare_compile_request(outside.to_str().unwrap(), &opts, &root, true).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}

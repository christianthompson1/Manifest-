use std::collections::BTreeMap;

use manifest_compiler::{
    check_source, check_source_json, compile_source, compile_source_json, CompileRequest,
    SyntaxProfile,
};
use mvm_core::{
    decode_mbc, verify_module, CapabilityPolicy, HostEnvironment, MemoryHostEnvironment, Value,
    VirtualMachine, VmLimits,
};

fn compile_and_run(
    source: &str,
    profile: Option<&str>,
    files: BTreeMap<String, String>,
    granted_caps: &[&str],
) -> Result<(Value, Vec<String>, usize), String> {
    let req = CompileRequest {
        source: source.to_string(),
        entry_file: "src/main.manifest".to_string(),
        profile: profile.map(|s| s.to_string()),
        files,
        optimize: true,
    };
    let out = compile_source(&req);
    if !out.check.ok {
        let msgs: Vec<String> = out
            .check
            .diagnostics
            .iter()
            .map(|d| format!("[{}] {}", d.code, d.message))
            .collect();
        return Err(msgs.join("; "));
    }
    let mbc = out.mbc.ok_or_else(|| "missing MBC output".to_string())?;
    let mut decoded = decode_mbc(&mbc.bytes).map_err(|e| format!("{e}"))?;
    verify_module(&mut decoded).map_err(|e| format!("{e}"))?;

    let policy = CapabilityPolicy::with_granted(granted_caps.iter().copied());
    let vm = VirtualMachine::new(VmLimits::default(), policy);
    let mut host = MemoryHostEnvironment::new();
    let res = vm
        .execute(&decoded, &mut host, None)
        .map_err(|e| format!("{e}"))?;
    Ok((res.return_value, host.stdout().to_vec(), mbc.function_count))
}

#[test]
fn compiles_and_executes_professional_profile_end_to_end() {
    let src = r#"
module app.math_demo;
requires [console];

struct Point { x: i64, y: i64 }

enum Status {
    OkVal(i64),
    Empty
}

let mut counter: i64 = 10;

fn add_points(a: Point, b: Point) -> i64 {
    return a.x + a.y + b.x + b.y;
}

fn main() -> i64 {
    let p1 = Point { x: 2, y: 3 };
    let p2 = Point { x: 4, y: 5 };
    counter = counter + add_points(p1, p2);
    let st = Status::OkVal(counter);
    match st {
        Status::OkVal(v) => {
            print(to_str(v));
            return v;
        }
        Status::Empty => {
            return 0;
        }
    }
}
"#;
    let (val, stdout, _) = compile_and_run(src, None, BTreeMap::new(), &["console"]).unwrap();
    assert_eq!(val, Value::I64(24));
    assert_eq!(stdout, vec!["24"]);
}

#[test]
fn compiles_and_executes_beginner_profile_equivalently() {
    let src = r#"
MUTABLE total TO 0
LET items TO [10, 20, 12]
FOR n IN items
    SET total TO total + n
END
IF total == 42 THEN
    SHOW total
END
"#;
    let req = CompileRequest {
        source: src.to_string(),
        entry_file: "main.manifest".to_string(),
        profile: None,
        files: BTreeMap::new(),
        optimize: true,
    };
    let check = check_source(&req);
    assert!(check.ok, "diagnostics: {:?}", check.diagnostics);
    assert_eq!(check.resolved_profile, SyntaxProfile::Beginner);

    let (_, stdout, _) = compile_and_run(src, None, BTreeMap::new(), &["console"]).unwrap();
    assert_eq!(stdout, vec!["42"]);
}

#[test]
fn supports_multi_file_workspace_imports_and_visibility() {
    let mut files = BTreeMap::new();
    files.insert(
        "src/math.manifest".to_string(),
        r#"
module math;
pub fn square(x: i64) -> i64 { return x * x; }
fn secret() -> i64 { return 99; }
"#
        .to_string(),
    );

    let ok_src = r#"
module app;
import { square } from "./math.manifest";
fn main() -> i64 {
    return square(7);
}
"#;
    let (val, _, _) = compile_and_run(ok_src, None, files.clone(), &[]).unwrap();
    assert_eq!(val, Value::I64(49));

    let bad_src = r#"
module app;
import { secret } from "./math.manifest";
fn main() -> i64 { return secret(); }
"#;
    let err = compile_and_run(bad_src, None, files, &[]).unwrap_err();
    assert!(err.contains("E_IMPORT_PRIVATE_SYMBOL"), "got: {err}");
}

#[test]
fn supports_generics_and_result_propagation() {
    let src = r#"
module app.generics;

struct Box<T> { value: T }

fn id<T>(x: T) -> T {
    return x;
}

fn checked_div(a: i64, b: i64) -> Result<i64, str> {
    if b == 0 {
        return Err("divide by zero");
    }
    return Ok(a / b);
}

fn compute(a: i64, b: i64) -> Result<i64, str> {
    let q = checked_div(a, b)?;
    let boxed = Box { value: id(q) };
    return Ok(boxed.value + 1);
}

fn main() -> i64 {
    match compute(20, 4) {
        Ok(v) => { return v; }
        Err(_) => { return -1; }
    }
}
"#;
    let (val, _, _) = compile_and_run(src, None, BTreeMap::new(), &[]).unwrap();
    assert_eq!(val, Value::I64(6));
}

#[test]
fn rejects_unsupported_trait_and_try_with_e_unsupported_feature() {
    let trait_src = r#"
module app.traits;
trait Printable {
    fn show() -> str;
}
fn main() -> i64 { return 0; }
"#;
    let err1 = compile_and_run(trait_src, None, BTreeMap::new(), &[]).unwrap_err();
    assert!(err1.contains("E_UNSUPPORTED_FEATURE"), "got: {err1}");

    let try_src = r#"
module app.tries;
fn main() -> i64 {
    try {
        let x = 1;
    } catch (e) {
        return 1;
    }
    return 0;
}
"#;
    let err2 = compile_and_run(try_src, None, BTreeMap::new(), &[]).unwrap_err();
    assert!(err2.contains("E_UNSUPPORTED_FEATURE"), "got: {err2}");
}

#[test]
fn preserves_overflow_traps_in_optimizer_and_rejects_missing_capabilities() {
    // 9223372036854775807 + 1 must NOT be folded away or crash compiler; it must trap in MVM!
    let overflow_src = r#"
module app.overflow;
fn main() -> i64 {
    return 9223372036854775807 + 1;
}
"#;
    let err = compile_and_run(overflow_src, None, BTreeMap::new(), &[]).unwrap_err();
    assert!(err.contains("Integer overflow"), "got: {err}");

    // UDC check: fs.read_text without requires [fs.read]
    let cap_src = r#"
module app.cap;
fn main() -> str {
    return fs.read_text("secret.txt");
}
"#;
    let err_cap = compile_and_run(cap_src, None, BTreeMap::new(), &["fs.read"]).unwrap_err();
    assert!(
        err_cap.contains("E_MISSING_CAPABILITY"),
        "got: {err_cap}"
    );
}

#[test]
fn json_api_preserves_i64_precision_and_returns_mbc_base64() {
    let src = r#"
module app.bigint;
fn main() -> i64 {
    return 9007199254740993;
}
"#;
    let json_req = format!(
        r#"{{"source":{:?},"entryFile":"src/main.manifest","optimize":false}}"#,
        src
    );
    let check_out = check_source_json(&json_req);
    assert!(check_out.contains("\"ok\":true"), "got: {check_out}");
    assert!(
        check_out.contains("\"value\":\"9007199254740993\""),
        "expected stringified i64 in MIR JSON, got: {check_out}"
    );

    let compile_out = compile_source_json(&json_req);
    assert!(compile_out.contains("\"ok\":true"), "got: {compile_out}");
    assert!(compile_out.contains("\"mbcBase64\":\"TUJD"), "got: {compile_out}");
}

#[test]
fn rejects_removed_v0_legacy_declarations_and_preserves_standalone_solana_program() {
    let legacy_samples = [
        "APP \"LegacyApp\"\nPAGE Home\n  TEXT \"Hi\"\nEND",
        "STATE count TO 0\nACTION inc\n  SET count TO count + 1\nEND",
        "USE SOLANA\nPROGRAM Vault\n  ACCOUNT S\n    v: NUMBER\n  END\nEND",
        "WHEN app.starts\n  SHOW \"hi\"\nEND",
    ];
    for src in legacy_samples {
        let req = CompileRequest {
            source: src.to_string(),
            entry_file: "legacy.manifest".to_string(),
            profile: None,
            files: BTreeMap::new(),
            optimize: true,
        };
        let chk = check_source(&req);
        assert!(!chk.ok, "Expected legacy sample to fail check: {src}");
        assert!(
            chk.diagnostics.iter().any(|d| d.code == "E_LEGACY_V0_REMOVED"),
            "Expected E_LEGACY_V0_REMOVED, got: {:?}",
            chk.diagnostics
        );
    }

    let solana_src = r#"
PROGRAM EscrowVault
    ACCOUNT EscrowState
        balance: NUMBER
        authority: ADDRESS
    END

    INSTRUCTION deposit
        REQUIRE signer = authority
        SET balance = balance + 100
    END
END
"#;
    let sol_req = CompileRequest {
        source: solana_src.to_string(),
        entry_file: "escrow.manifest".to_string(),
        profile: None,
        files: BTreeMap::new(),
        optimize: true,
    };
    let sol_chk = check_source(&sol_req);
    assert!(sol_chk.ok, "Standalone PROGRAM should pass check: {:?}", sol_chk.diagnostics);
    assert!(sol_chk.is_domain_extension);
    assert_eq!(sol_chk.domain_kind, Some("solana-contract"));

    let sol_cmp = compile_source(&sol_req);
    assert!(!sol_cmp.check.ok);
    assert!(sol_cmp
        .check
        .diagnostics
        .iter()
        .any(|d| d.code == "E_SOLANA_TARGET_ONLY"));
}


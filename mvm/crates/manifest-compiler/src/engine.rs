use std::collections::BTreeMap;

use mvm_core::{decode_mbc, disassemble_module, verify_module};

use crate::ast::{SemanticModule, TypeNode};
use crate::capabilities::{analyze_capabilities_and_effects, CapabilityAuditReport};
use crate::checker::{check_types, TypeCheckResult};
use crate::diagnostic::{Diagnostic, Severity, SourceSpan};
use crate::json::{encode_base64, parse_json, JsonValue};
use crate::lower::build_typed_ir;
use crate::mbc_emit::{compile_mir_to_mbc, CompiledMbcResult};
use crate::mir::{format_mir_module, MIRModule};
use crate::optimizer::{optimize_mir, OptimizationPassStats};
use crate::profile::{detect_syntax_profile, SyntaxProfile};
use crate::resolver::{resolve_module_graph, WorkspaceFiles};

pub const ENGINE_NAME: &str = "rust-manifest-compiler";
pub const ENGINE_VERSION: &str = "1.0.0";
pub const ENGINE_ABI_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct CompileRequest {
    pub source: String,
    pub entry_file: String,
    pub profile: Option<String>,
    pub files: WorkspaceFiles,
    pub optimize: bool,
}

impl CompileRequest {
    pub fn from_json(json_str: &str) -> Result<Self, String> {
        let val = parse_json(json_str)?;
        let source = val
            .get("source")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing required 'source' string field".to_string())?
            .to_string();
        let entry_file = val
            .get("entryFile")
            .and_then(|v| v.as_str())
            .unwrap_or("src/main.manifest")
            .to_string();
        let profile = val
            .get("profile")
            .and_then(|v| v.as_str())
            .filter(|p| *p == "beginner" || *p == "professional")
            .map(|p| p.to_string());
        let optimize = val
            .get("optimize")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let mut files = BTreeMap::new();
        if let Some(obj) = val.get("files").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                if let Some(content) = v.as_str() {
                    files.insert(k.clone(), content.to_string());
                }
            }
        }
        Ok(Self {
            source,
            entry_file,
            profile,
            files,
            optimize,
        })
    }
}

#[derive(Debug, Clone)]
pub struct AstSummaryParam {
    pub name: String,
    pub type_str: String,
}

#[derive(Debug, Clone)]
pub struct AstSummaryFunction {
    pub name: String,
    pub exported: bool,
    pub params: Vec<AstSummaryParam>,
    pub return_type_str: String,
    pub effects: Vec<String>,
    pub line: u32,
}

#[derive(Debug, Clone)]
pub struct AstSummaryField {
    pub name: String,
    pub type_str: String,
}

#[derive(Debug, Clone)]
pub struct AstSummaryStruct {
    pub name: String,
    pub exported: bool,
    pub fields: Vec<AstSummaryField>,
    pub line: u32,
}

#[derive(Debug, Clone)]
pub struct AstSummaryEnum {
    pub name: String,
    pub exported: bool,
    pub variants: Vec<String>,
    pub line: u32,
}

#[derive(Debug, Clone)]
pub struct AstSummaryConstant {
    pub name: String,
    pub type_str: String,
    pub line: u32,
}

#[derive(Debug, Clone)]
pub struct AstSummaryGlobal {
    pub name: String,
    pub mutable: bool,
    pub type_str: String,
    pub line: u32,
}

#[derive(Debug, Clone)]
pub struct AstSummary {
    pub module_name: String,
    pub profile: SyntaxProfile,
    pub functions: Vec<AstSummaryFunction>,
    pub structs: Vec<AstSummaryStruct>,
    pub enums: Vec<AstSummaryEnum>,
    pub constants: Vec<AstSummaryConstant>,
    pub globals: Vec<AstSummaryGlobal>,
}

impl AstSummary {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::Object(vec![
            (
                "moduleName".to_string(),
                JsonValue::String(self.module_name.clone()),
            ),
            (
                "profile".to_string(),
                JsonValue::String(self.profile.as_str().to_string()),
            ),
            (
                "functions".to_string(),
                JsonValue::Array(
                    self.functions
                        .iter()
                        .map(|f| {
                            JsonValue::Object(vec![
                                ("name".to_string(), JsonValue::String(f.name.clone())),
                                ("exported".to_string(), JsonValue::Bool(f.exported)),
                                (
                                    "params".to_string(),
                                    JsonValue::Array(
                                        f.params
                                            .iter()
                                            .map(|p| {
                                                JsonValue::Object(vec![
                                                    (
                                                        "name".to_string(),
                                                        JsonValue::String(p.name.clone()),
                                                    ),
                                                    (
                                                        "typeStr".to_string(),
                                                        JsonValue::String(p.type_str.clone()),
                                                    ),
                                                ])
                                            })
                                            .collect(),
                                    ),
                                ),
                                (
                                    "returnTypeStr".to_string(),
                                    JsonValue::String(f.return_type_str.clone()),
                                ),
                                (
                                    "effects".to_string(),
                                    JsonValue::Array(
                                        f.effects
                                            .iter()
                                            .map(|e| JsonValue::String(e.clone()))
                                            .collect(),
                                    ),
                                ),
                                ("line".to_string(), JsonValue::Number(f.line as f64)),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "structs".to_string(),
                JsonValue::Array(
                    self.structs
                        .iter()
                        .map(|s| {
                            JsonValue::Object(vec![
                                ("name".to_string(), JsonValue::String(s.name.clone())),
                                ("exported".to_string(), JsonValue::Bool(s.exported)),
                                (
                                    "fields".to_string(),
                                    JsonValue::Array(
                                        s.fields
                                            .iter()
                                            .map(|fl| {
                                                JsonValue::Object(vec![
                                                    (
                                                        "name".to_string(),
                                                        JsonValue::String(fl.name.clone()),
                                                    ),
                                                    (
                                                        "typeStr".to_string(),
                                                        JsonValue::String(fl.type_str.clone()),
                                                    ),
                                                ])
                                            })
                                            .collect(),
                                    ),
                                ),
                                ("line".to_string(), JsonValue::Number(s.line as f64)),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "enums".to_string(),
                JsonValue::Array(
                    self.enums
                        .iter()
                        .map(|e| {
                            JsonValue::Object(vec![
                                ("name".to_string(), JsonValue::String(e.name.clone())),
                                ("exported".to_string(), JsonValue::Bool(e.exported)),
                                (
                                    "variants".to_string(),
                                    JsonValue::Array(
                                        e.variants
                                            .iter()
                                            .map(|v| JsonValue::String(v.clone()))
                                            .collect(),
                                    ),
                                ),
                                ("line".to_string(), JsonValue::Number(e.line as f64)),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "constants".to_string(),
                JsonValue::Array(
                    self.constants
                        .iter()
                        .map(|c| {
                            JsonValue::Object(vec![
                                ("name".to_string(), JsonValue::String(c.name.clone())),
                                (
                                    "typeStr".to_string(),
                                    JsonValue::String(c.type_str.clone()),
                                ),
                                ("line".to_string(), JsonValue::Number(c.line as f64)),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "globals".to_string(),
                JsonValue::Array(
                    self.globals
                        .iter()
                        .map(|g| {
                            JsonValue::Object(vec![
                                ("name".to_string(), JsonValue::String(g.name.clone())),
                                ("mutable".to_string(), JsonValue::Bool(g.mutable)),
                                (
                                    "typeStr".to_string(),
                                    JsonValue::String(g.type_str.clone()),
                                ),
                                ("line".to_string(), JsonValue::Number(g.line as f64)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ])
    }
}

fn format_type_node(node: &TypeNode) -> String {
    match node {
        TypeNode::PrimitiveType { name, .. } => name.clone(),
        TypeNode::NamedType {
            name, type_args, ..
        } => {
            if type_args.is_empty() {
                name.clone()
            } else {
                let args: Vec<String> = type_args.iter().map(format_type_node).collect();
                format!("{name}<{}>", args.join(", "))
            }
        }
        TypeNode::ArrayType { element_type, .. } => {
            format!("Array<{}>", format_type_node(element_type))
        }
        TypeNode::MapType {
            key_type,
            value_type,
            ..
        } => {
            format!(
                "Map<{}, {}>",
                format_type_node(key_type),
                format_type_node(value_type)
            )
        }
        TypeNode::ResultType {
            ok_type, err_type, ..
        } => {
            format!(
                "Result<{}, {}>",
                format_type_node(ok_type),
                format_type_node(err_type)
            )
        }
        TypeNode::InferredType { .. } => "any".to_string(),
    }
}

fn build_ast_summary(ast: &SemanticModule, type_check: Option<&TypeCheckResult>) -> AstSummary {
    let functions = ast
        .functions
        .iter()
        .map(|f| {
            let sig = type_check.and_then(|tc| tc.functions.get(&f.name));
            let params = f
                .params
                .iter()
                .enumerate()
                .map(|(i, p)| AstSummaryParam {
                    name: p.name.clone(),
                    type_str: sig
                        .and_then(|s| s.params.get(i).map(|(_, t)| t.format_type()))
                        .unwrap_or_else(|| format_type_node(&p.param_type)),
                })
                .collect();
            let return_type_str = sig
                .map(|s| s.return_type.format_type())
                .unwrap_or_else(|| format_type_node(&f.return_type));
            AstSummaryFunction {
                name: f.name.clone(),
                exported: f.exported,
                params,
                return_type_str,
                effects: f.effects.clone(),
                line: f.span.line,
            }
        })
        .collect();

    let structs = ast
        .structs
        .iter()
        .map(|s| AstSummaryStruct {
            name: s.name.clone(),
            exported: s.exported,
            fields: s
                .fields
                .iter()
                .map(|fl| AstSummaryField {
                    name: fl.name.clone(),
                    type_str: format_type_node(&fl.field_type),
                })
                .collect(),
            line: s.span.line,
        })
        .collect();

    let enums = ast
        .enums
        .iter()
        .map(|e| AstSummaryEnum {
            name: e.name.clone(),
            exported: e.exported,
            variants: e.variants.iter().map(|v| v.name.clone()).collect(),
            line: e.span.line,
        })
        .collect();

    let constants = ast
        .constants
        .iter()
        .map(|c| AstSummaryConstant {
            name: c.name.clone(),
            type_str: format_type_node(&c.type_annotation),
            line: c.span.line,
        })
        .collect();

    let globals = ast
        .globals
        .iter()
        .map(|g| AstSummaryGlobal {
            name: g.name.clone(),
            mutable: g.mutable,
            type_str: format_type_node(&g.type_annotation),
            line: g.span.line,
        })
        .collect();

    AstSummary {
        module_name: ast.module_name.clone(),
        profile: ast.profile,
        functions,
        structs,
        enums,
        constants,
        globals,
    }
}

pub struct CheckOutcome {
    pub ok: bool,
    pub resolved_profile: SyntaxProfile,
    pub module_name: String,
    pub is_domain_extension: bool,
    pub domain_kind: Option<&'static str>,
    pub diagnostics: Vec<Diagnostic>,
    pub capability_audit: Option<CapabilityAuditReport>,
    pub mir: Option<MIRModule>,
    pub ir_text: Option<String>,
    pub optimization_stats: Option<OptimizationPassStats>,
    pub ast_summary: Option<AstSummary>,
}

impl CheckOutcome {
    pub fn to_json_value(&self) -> JsonValue {
        let entries = vec![
            ("ok".to_string(), JsonValue::Bool(self.ok)),
            (
                "engine".to_string(),
                JsonValue::String(ENGINE_NAME.to_string()),
            ),
            (
                "engineVersion".to_string(),
                JsonValue::String(ENGINE_VERSION.to_string()),
            ),
            (
                "engineAbiVersion".to_string(),
                JsonValue::Number(ENGINE_ABI_VERSION as f64),
            ),
            (
                "resolvedProfile".to_string(),
                JsonValue::String(self.resolved_profile.as_str().to_string()),
            ),
            (
                "moduleName".to_string(),
                JsonValue::String(self.module_name.clone()),
            ),
            (
                "isDomainExtension".to_string(),
                JsonValue::Bool(self.is_domain_extension),
            ),
            (
                "domainKind".to_string(),
                match self.domain_kind {
                    Some(k) => JsonValue::String(k.to_string()),
                    None => JsonValue::Null,
                },
            ),
            (
                "diagnostics".to_string(),
                JsonValue::Array(self.diagnostics.iter().map(|d| d.to_json()).collect()),
            ),
            (
                "capabilityAudit".to_string(),
                match &self.capability_audit {
                    Some(c) => c.to_json(),
                    None => JsonValue::Null,
                },
            ),
            (
                "mir".to_string(),
                match &self.mir {
                    Some(m) => m.to_json(),
                    None => JsonValue::Null,
                },
            ),
            (
                "irText".to_string(),
                match &self.ir_text {
                    Some(t) => JsonValue::String(t.clone()),
                    None => JsonValue::Null,
                },
            ),
            (
                "optimizationStats".to_string(),
                match &self.optimization_stats {
                    Some(s) => s.to_json(),
                    None => JsonValue::Null,
                },
            ),
            (
                "astSummary".to_string(),
                match &self.ast_summary {
                    Some(a) => a.to_json(),
                    None => JsonValue::Null,
                },
            ),
        ];
        JsonValue::Object(entries)
    }
}

pub struct CompileOutcome {
    pub check: CheckOutcome,
    pub mbc: Option<CompiledMbcResult>,
    pub disassembly: Option<String>,
}

impl CompileOutcome {
    pub fn to_json_value(&self) -> JsonValue {
        let mut base = match self.check.to_json_value() {
            JsonValue::Object(entries) => entries,
            _ => Vec::new(),
        };
        if let Some(mbc) = &self.mbc {
            base.push((
                "mbcBase64".to_string(),
                JsonValue::String(encode_base64(&mbc.bytes)),
            ));
            base.push((
                "mbcByteLength".to_string(),
                JsonValue::Number(mbc.bytes.len() as f64),
            ));
            base.push((
                "functionCount".to_string(),
                JsonValue::Number(mbc.function_count as f64),
            ));
            base.push((
                "constantCount".to_string(),
                JsonValue::Number(mbc.constant_count as f64),
            ));
            base.push((
                "importCount".to_string(),
                JsonValue::Number(mbc.import_count as f64),
            ));
        } else {
            base.push(("mbcBase64".to_string(), JsonValue::Null));
            base.push(("mbcByteLength".to_string(), JsonValue::Number(0.0)));
        }
        base.push((
            "disassembly".to_string(),
            match &self.disassembly {
                Some(d) => JsonValue::String(d.clone()),
                None => JsonValue::Null,
            },
        ));
        JsonValue::Object(base)
    }
}

pub fn check_source(req: &CompileRequest) -> CheckOutcome {
    let initial_profile = detect_syntax_profile(&req.source, req.profile.as_deref());
    let mut next_expr_id = 1u64;

    let graph = match resolve_module_graph(
        &req.source,
        &req.entry_file,
        req.profile.as_deref(),
        &req.files,
        &mut next_expr_id,
    ) {
        Ok(g) => g,
        Err(diag) => {
            return CheckOutcome {
                ok: false,
                resolved_profile: initial_profile,
                module_name: "main".to_string(),
                is_domain_extension: false,
                domain_kind: None,
                diagnostics: vec![diag],
                capability_audit: None,
                mir: None,
                ir_text: None,
                optimization_stats: None,
                ast_summary: None,
            };
        }
    };

    let mut diagnostics = graph.diagnostics;
    let ast = graph.merged_module;

    if ast.is_solana_contract {
        let summary = build_ast_summary(&ast, None);
        let ok = diagnostics.iter().all(|d| d.severity != Severity::Error);
        return CheckOutcome {
            ok,
            resolved_profile: ast.profile,
            module_name: ast.module_name,
            is_domain_extension: true,
            domain_kind: Some("solana-contract"),
            diagnostics,
            capability_audit: None,
            mir: None,
            ir_text: None,
            optimization_stats: None,
            ast_summary: Some(summary),
        };
    }

    let type_check = check_types(&ast);
    diagnostics.extend(type_check.diagnostics.clone());

    let capability_audit = analyze_capabilities_and_effects(&ast);
    diagnostics.extend(capability_audit.diagnostics.clone());

    let ast_summary = build_ast_summary(&ast, Some(&type_check));

    if diagnostics.iter().any(|d| d.severity == Severity::Error) {
        return CheckOutcome {
            ok: false,
            resolved_profile: ast.profile,
            module_name: ast.module_name,
            is_domain_extension: false,
            domain_kind: None,
            diagnostics,
            capability_audit: Some(capability_audit),
            mir: None,
            ir_text: None,
            optimization_stats: None,
            ast_summary: Some(ast_summary),
        };
    }

    let raw_mir = match build_typed_ir(&ast, &type_check, &capability_audit) {
        Ok(m) => m,
        Err(diag) => {
            diagnostics.push(diag);
            return CheckOutcome {
                ok: false,
                resolved_profile: ast.profile,
                module_name: ast.module_name,
                is_domain_extension: false,
                domain_kind: None,
                diagnostics,
                capability_audit: Some(capability_audit),
                mir: None,
                ir_text: None,
                optimization_stats: None,
                ast_summary: Some(ast_summary),
            };
        }
    };

    let (final_mir, opt_stats) = if req.optimize {
        let opt = optimize_mir(&raw_mir);
        diagnostics.extend(opt.warnings);
        (opt.module, Some(opt.stats))
    } else {
        (raw_mir, None)
    };

    let ir_text = format_mir_module(&final_mir);

    CheckOutcome {
        ok: true,
        resolved_profile: ast.profile,
        module_name: ast.module_name,
        is_domain_extension: false,
        domain_kind: None,
        diagnostics,
        capability_audit: Some(capability_audit),
        mir: Some(final_mir),
        ir_text: Some(ir_text),
        optimization_stats: opt_stats,
        ast_summary: Some(ast_summary),
    }
}

pub fn compile_source(req: &CompileRequest) -> CompileOutcome {
    let mut check = check_source(req);
    if check.is_domain_extension {
        check.ok = false;
        check.diagnostics.push(Diagnostic::error_with_hint(
            "E_SOLANA_TARGET_ONLY",
            "Solana smart contract declarations (PROGRAM) target Anchor Rust / SBF rather than Manifest Bytecode (.mbc).",
            &SourceSpan {
                file: Some(req.entry_file.clone()),
                ..SourceSpan::default()
            },
            "Compile or verify with `--target solana-sbf`.",
        ));
        return CompileOutcome {
            check,
            mbc: None,
            disassembly: None,
        };
    }
    if !check.ok {
        return CompileOutcome {
            check,
            mbc: None,
            disassembly: None,
        };
    }

    let Some(mir) = &check.mir else {
        check.ok = false;
        return CompileOutcome {
            check,
            mbc: None,
            disassembly: None,
        };
    };

    let mbc = match compile_mir_to_mbc(mir) {
        Ok(m) => m,
        Err(diag) => {
            check.ok = false;
            check.diagnostics.push(diag);
            return CompileOutcome {
                check,
                mbc: None,
                disassembly: None,
            };
        }
    };

    let span = SourceSpan {
        file: Some(req.entry_file.clone()),
        ..SourceSpan::default()
    };

    let mut decoded = match decode_mbc(&mbc.bytes) {
        Ok(m) => m,
        Err(e) => {
            check.ok = false;
            check.diagnostics.push(Diagnostic::error(
                "E_MBC_DECODE",
                format!("Internal compiler bytecode decode failure: {e}"),
                &span,
            ));
            return CompileOutcome {
                check,
                mbc: None,
                disassembly: None,
            };
        }
    };

    if let Err(e) = verify_module(&mut decoded) {
        check.ok = false;
        check.diagnostics.push(Diagnostic::error(
            "E_MBC_VERIFY",
            format!("Internal compiler bytecode verification failure: {e}"),
            &span,
        ));
        return CompileOutcome {
            check,
            mbc: None,
            disassembly: None,
        };
    }

    let disassembly = disassemble_module(&decoded);

    CompileOutcome {
        check,
        mbc: Some(mbc),
        disassembly: Some(disassembly),
    }
}

fn error_json(code: &str, msg: &str) -> String {
    let diag = Diagnostic::error(code, msg, &SourceSpan::default());
    JsonValue::Object(vec![
        ("ok".to_string(), JsonValue::Bool(false)),
        (
            "engine".to_string(),
            JsonValue::String(ENGINE_NAME.to_string()),
        ),
        (
            "engineVersion".to_string(),
            JsonValue::String(ENGINE_VERSION.to_string()),
        ),
        (
            "engineAbiVersion".to_string(),
            JsonValue::Number(ENGINE_ABI_VERSION as f64),
        ),
        ("diagnostics".to_string(), JsonValue::Array(vec![diag.to_json()])),
    ])
    .to_json_string()
}

pub fn check_source_json(request_json: &str) -> String {
    match CompileRequest::from_json(request_json) {
        Ok(req) => check_source(&req).to_json_value().to_json_string(),
        Err(err) => error_json("E_INVALID_REQUEST", &err),
    }
}

pub fn compile_source_json(request_json: &str) -> String {
    match CompileRequest::from_json(request_json) {
        Ok(req) => compile_source(&req).to_json_value().to_json_string(),
        Err(err) => error_json("E_INVALID_REQUEST", &err),
    }
}

pub fn inspect_ir_json(request_json: &str) -> String {
    check_source_json(request_json)
}

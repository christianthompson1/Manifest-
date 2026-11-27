use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::ast::*;
use crate::diagnostic::{Diagnostic, Severity, SourceSpan};
use crate::json::JsonValue;
use crate::types::lookup_std_intrinsic;

#[derive(Debug, Clone)]
pub struct FunctionEffectAudit {
    pub name: String,
    pub exported: bool,
    pub declared_effects: Vec<String>,
    pub has_explicit_effects: bool,
    pub direct_effects: Vec<String>,
    pub inferred_effects: Vec<String>,
    pub is_pure: bool,
    pub callees: Vec<String>,
}

impl FunctionEffectAudit {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::Object(vec![
            ("name".to_string(), JsonValue::String(self.name.clone())),
            ("exported".to_string(), JsonValue::Bool(self.exported)),
            (
                "declaredEffects".to_string(),
                JsonValue::Array(
                    self.declared_effects
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "hasExplicitEffects".to_string(),
                JsonValue::Bool(self.has_explicit_effects),
            ),
            (
                "directEffects".to_string(),
                JsonValue::Array(
                    self.direct_effects
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "inferredEffects".to_string(),
                JsonValue::Array(
                    self.inferred_effects
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            ("isPure".to_string(), JsonValue::Bool(self.is_pure)),
            (
                "callees".to_string(),
                JsonValue::Array(
                    self.callees
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
        ])
    }
}

#[derive(Debug, Clone)]
pub struct CapabilityAuditReport {
    pub module_name: String,
    pub declared_requires: Vec<String>,
    pub declared_provides: Vec<String>,
    pub declared_denies: Vec<String>,
    pub inferred_module_effects: Vec<String>,
    pub functions: Vec<FunctionEffectAudit>,
    pub valid: bool,
    pub diagnostics: Vec<Diagnostic>,
}

impl CapabilityAuditReport {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::Object(vec![
            (
                "moduleName".to_string(),
                JsonValue::String(self.module_name.clone()),
            ),
            (
                "declaredRequires".to_string(),
                JsonValue::Array(
                    self.declared_requires
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "declaredProvides".to_string(),
                JsonValue::Array(
                    self.declared_provides
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "declaredDenies".to_string(),
                JsonValue::Array(
                    self.declared_denies
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "inferredModuleEffects".to_string(),
                JsonValue::Array(
                    self.inferred_module_effects
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "functions".to_string(),
                JsonValue::Array(self.functions.iter().map(|f| f.to_json()).collect()),
            ),
            ("valid".to_string(), JsonValue::Bool(self.valid)),
            (
                "diagnostics".to_string(),
                JsonValue::Array(self.diagnostics.iter().map(|d| d.to_json()).collect()),
            ),
        ])
    }
}

pub fn capability_covers(declared_or_denied: &str, actual_effect: &str) -> bool {
    if declared_or_denied.is_empty() || actual_effect.is_empty() {
        return false;
    }
    if declared_or_denied == actual_effect {
        return true;
    }
    actual_effect.starts_with(&format!("{declared_or_denied}."))
}

#[derive(Clone)]
struct EffectOrigin {
    span: SourceSpan,
    via: Option<String>,
}

pub fn analyze_capabilities_and_effects(module: &SemanticModule) -> CapabilityAuditReport {
    let mut diagnostics = Vec::new();
    let requires: Vec<String> = module
        .capabilities
        .requires
        .iter()
        .map(|r| r.name.clone())
        .collect();
    let provides: Vec<String> = module
        .capabilities
        .provides
        .iter()
        .map(|p| p.name.clone())
        .collect();
    let denies: Vec<String> = module
        .capabilities
        .denies
        .iter()
        .map(|d| d.name.clone())
        .collect();

    // 1. Check `requires` vs `denies` contradictions
    for req in &module.capabilities.requires {
        for den in &module.capabilities.denies {
            if capability_covers(&den.name, &req.name) {
                diagnostics.push(Diagnostic::error(
                    "E_CAPABILITY_CONTRADICTION",
                    format!(
                        "Capability '{}' cannot be both required and denied ('{}')",
                        req.name, den.name
                    ),
                    &req.span,
                ));
            }
        }
    }

    // 2. Collect direct effects & callees
    let mut direct_effects: BTreeMap<String, BTreeMap<String, SourceSpan>> = BTreeMap::new();
    let mut call_graph: HashMap<String, Vec<(String, SourceSpan)>> = HashMap::new();

    for fn_d in &module.functions {
        let mut effs = BTreeMap::new();
        let mut calls = Vec::new();
        collect_stmts_effects(&fn_d.body, &mut effs, &mut calls);
        direct_effects.insert(fn_d.name.clone(), effs);
        call_graph.insert(fn_d.name.clone(), calls);
    }

    let mut top_direct = BTreeMap::new();
    let mut top_calls = Vec::new();
    collect_stmts_effects(&module.top_level_stmts, &mut top_direct, &mut top_calls);
    for c in &module.constants {
        collect_expr_effects(&c.init, &mut top_direct, &mut top_calls);
    }
    direct_effects.insert("__top__".to_string(), top_direct);
    call_graph.insert("__top__".to_string(), top_calls);

    // 3. Fixed-point transitive closure
    let mut transitive: BTreeMap<String, BTreeMap<String, EffectOrigin>> = BTreeMap::new();
    for (fn_name, dir) in &direct_effects {
        let mut m = BTreeMap::new();
        for (eff, sp) in dir {
            m.insert(
                eff.clone(),
                EffectOrigin {
                    span: sp.clone(),
                    via: None,
                },
            );
        }
        transitive.insert(fn_name.clone(), m);
    }

    let mut changed = true;
    while changed {
        changed = false;
        let snapshot = transitive.clone();
        for (caller, edges) in &call_graph {
            let Some(caller_effs) = transitive.get_mut(caller) else {
                continue;
            };
            for (callee, span) in edges {
                let Some(callee_effs) = snapshot.get(callee) else {
                    continue;
                };
                for eff in callee_effs.keys() {
                    if !caller_effs.contains_key(eff) {
                        caller_effs.insert(
                            eff.clone(),
                            EffectOrigin {
                                span: span.clone(),
                                via: Some(callee.clone()),
                            },
                        );
                        changed = true;
                    }
                }
            }
        }
    }

    // 4. Function-level effect signatures
    let mut fn_audits = Vec::new();
    for fn_d in &module.functions {
        let inf_map = transitive.get(&fn_d.name).cloned().unwrap_or_default();
        let inferred_list: Vec<String> = inf_map.keys().cloned().collect();
        let direct_list: Vec<String> = direct_effects
            .get(&fn_d.name)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        let mut seen_callees = BTreeSet::new();
        let mut callees = Vec::new();
        if let Some(edges) = call_graph.get(&fn_d.name) {
            for (c, _) in edges {
                if seen_callees.insert(c.clone()) {
                    callees.push(c.clone());
                }
            }
        }

        if fn_d.has_explicit_effects {
            for (eff, origin) in &inf_map {
                let allowed = fn_d
                    .effects
                    .iter()
                    .any(|decl| capability_covers(decl, eff));
                if !allowed {
                    let via_suffix = match &origin.via {
                        Some(v) => format!(" (propagated via call to '{v}')"),
                        None => String::new(),
                    };
                    diagnostics.push(Diagnostic::error_with_hint(
                        "E_UNDECLARED_EFFECT",
                        format!(
                            "Function '{}' performs effect '{eff}'{via_suffix}, which is not declared in its effects({}) signature",
                            fn_d.name,
                            fn_d.effects.join(", ")
                        ),
                        &origin.span,
                        format!(
                            "Add '{eff}' to effects(...) on '{}' or remove the effectful call.",
                            fn_d.name
                        ),
                    ));
                }
            }
        }

        fn_audits.push(FunctionEffectAudit {
            name: fn_d.name.clone(),
            exported: fn_d.exported,
            declared_effects: fn_d.effects.clone(),
            has_explicit_effects: fn_d.has_explicit_effects,
            direct_effects: direct_list,
            is_pure: inferred_list.is_empty(),
            inferred_effects: inferred_list,
            callees,
        });
    }

    // 5. Module-level denies & requires
    let mut module_effects: BTreeMap<String, (SourceSpan, String, Option<String>)> = BTreeMap::new();
    for (owner, inf_map) in &transitive {
        for (eff, info) in inf_map {
            module_effects
                .entry(eff.clone())
                .or_insert_with(|| (info.span.clone(), owner.clone(), info.via.clone()));
        }
    }

    for (eff, (span, owner, via)) in &module_effects {
        if let Some(matching_deny) = denies.iter().find(|d| capability_covers(d, eff)) {
            let ctx = if owner == "__top__" {
                "top-level module scope".to_string()
            } else {
                format!("function '{owner}'")
            };
            let via_str = match via {
                Some(v) => format!(" via '{v}'"),
                None => String::new(),
            };
            diagnostics.push(Diagnostic::error(
                "E_CAPABILITY_DENIED",
                format!(
                    "Forbidden capability '{eff}' used in {ctx}{via_str}: module explicitly denies '{matching_deny}'"
                ),
                span,
            ));
            continue;
        }

        let is_implicit_console_allowed = eff == "console" && requires.is_empty();
        if !is_implicit_console_allowed && !requires.iter().any(|r| capability_covers(r, eff)) {
            let mut next_reqs = requires.clone();
            next_reqs.push(eff.clone());
            let hint = match module.profile {
                crate::profile::SyntaxProfile::Professional => {
                    format!("Add 'requires [{}];' to the module header.", next_reqs.join(", "))
                }
                crate::profile::SyntaxProfile::Beginner => {
                    format!("Add 'REQUIRES {}' to the module header.", next_reqs.join(", "))
                }
            };
            diagnostics.push(Diagnostic::error_with_hint(
                "E_MISSING_CAPABILITY",
                format!(
                    "Module '{}' uses capability '{eff}' without declaring it in 'requires'",
                    module.module_name
                ),
                span,
                hint,
            ));
        }
    }

    let valid = !diagnostics.iter().any(|d| d.severity == Severity::Error);
    CapabilityAuditReport {
        module_name: module.module_name.clone(),
        declared_requires: requires,
        declared_provides: provides,
        declared_denies: denies,
        inferred_module_effects: module_effects.keys().cloned().collect(),
        functions: fn_audits,
        valid,
        diagnostics,
    }
}

fn collect_stmts_effects(
    stmts: &[SemanticStmt],
    direct: &mut BTreeMap<String, SourceSpan>,
    calls: &mut Vec<(String, SourceSpan)>,
) {
    for s in stmts {
        match s {
            SemanticStmt::VarStmt { decl, .. } => collect_expr_effects(&decl.init, direct, calls),
            SemanticStmt::ConstStmt { decl, .. } => collect_expr_effects(&decl.init, direct, calls),
            SemanticStmt::AssignStmt { target, value, .. } => {
                match target {
                    AssignTarget::FieldTarget { object, .. } => {
                        collect_expr_effects(object, direct, calls);
                    }
                    AssignTarget::IndexTarget { object, index, .. } => {
                        collect_expr_effects(object, direct, calls);
                        collect_expr_effects(index, direct, calls);
                    }
                    AssignTarget::VarTarget { .. } => {}
                }
                collect_expr_effects(value, direct, calls);
            }
            SemanticStmt::ExprStmt { expr, .. } => collect_expr_effects(expr, direct, calls),
            SemanticStmt::IfStmt {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                collect_expr_effects(condition, direct, calls);
                collect_stmts_effects(then_branch, direct, calls);
                collect_stmts_effects(else_branch, direct, calls);
            }
            SemanticStmt::WhileStmt {
                condition, body, ..
            } => {
                collect_expr_effects(condition, direct, calls);
                collect_stmts_effects(body, direct, calls);
            }
            SemanticStmt::ForInStmt { iterable, body, .. } => {
                collect_expr_effects(iterable, direct, calls);
                collect_stmts_effects(body, direct, calls);
            }
            SemanticStmt::RepeatStmt { count, body, .. } => {
                collect_expr_effects(count, direct, calls);
                collect_stmts_effects(body, direct, calls);
            }
            SemanticStmt::ReturnStmt { value: Some(v), .. } => {
                collect_expr_effects(v, direct, calls);
            }
            SemanticStmt::MatchStmt { subject, arms, .. } => {
                collect_expr_effects(subject, direct, calls);
                for arm in arms {
                    collect_stmts_effects(&arm.body, direct, calls);
                }
            }
            SemanticStmt::TryStmt {
                try_body,
                catch_body,
                ..
            } => {
                collect_stmts_effects(try_body, direct, calls);
                collect_stmts_effects(catch_body, direct, calls);
            }
            SemanticStmt::ReturnStmt { value: None, .. }
            | SemanticStmt::BreakStmt { .. }
            | SemanticStmt::ContinueStmt { .. } => {}
        }
    }
}

fn collect_expr_effects(
    expr: &SemanticExpr,
    direct: &mut BTreeMap<String, SourceSpan>,
    calls: &mut Vec<(String, SourceSpan)>,
) {
    match &expr.kind {
        SemanticExprKind::UnaryExpr { operand, .. }
        | SemanticExprKind::AwaitExpr { operand }
        | SemanticExprKind::TryPropagateExpr { operand } => {
            collect_expr_effects(operand, direct, calls);
        }
        SemanticExprKind::BinaryExpr { left, right, .. } => {
            collect_expr_effects(left, direct, calls);
            collect_expr_effects(right, direct, calls);
        }
        SemanticExprKind::CallExpr { callee, args, .. } => {
            for a in args {
                collect_expr_effects(a, direct, calls);
            }
            if let Some(std) = lookup_std_intrinsic(callee) {
                if std.capability != "pure" {
                    direct
                        .entry(std.capability.to_string())
                        .or_insert_with(|| expr.span.clone());
                }
            } else {
                calls.push((callee.clone(), expr.span.clone()));
            }
        }
        SemanticExprKind::FieldAccessExpr { object, .. } => {
            collect_expr_effects(object, direct, calls);
        }
        SemanticExprKind::IndexAccessExpr { object, index } => {
            collect_expr_effects(object, direct, calls);
            collect_expr_effects(index, direct, calls);
        }
        SemanticExprKind::ArrayLiteral { elements } => {
            for e in elements {
                collect_expr_effects(e, direct, calls);
            }
        }
        SemanticExprKind::MapLiteral { entries } => {
            for kv in entries {
                collect_expr_effects(&kv.key, direct, calls);
                collect_expr_effects(&kv.value, direct, calls);
            }
        }
        SemanticExprKind::StructLiteral { fields, .. } => {
            for f in fields {
                collect_expr_effects(&f.value, direct, calls);
            }
        }
        SemanticExprKind::EnumConstructExpr { args, .. } => {
            for a in args {
                collect_expr_effects(a, direct, calls);
            }
        }
        _ => {}
    }
}

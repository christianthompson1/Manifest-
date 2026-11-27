use std::collections::{HashMap, HashSet};

use crate::ast::*;
use crate::diagnostic::{Diagnostic, Severity, SourceSpan};
use crate::types::*;

#[derive(Debug, Clone)]
struct SymbolEntry {
    #[allow(dead_code)]
    name: String,
    sym_type: SemanticType,
    mutable: bool,
    is_const: bool,
}

pub struct TypeCheckResult {
    pub valid: bool,
    pub diagnostics: Vec<Diagnostic>,
    pub structs: HashMap<String, SemanticType>,
    pub enums: HashMap<String, SemanticType>,
    pub functions: HashMap<String, FunctionSignature>,
    pub expr_types: HashMap<ExprId, SemanticType>,
}

pub fn check_types(module: &SemanticModule) -> TypeCheckResult {
    let mut checker = TypeChecker {
        diagnostics: Vec::new(),
        structs: HashMap::new(),
        enums: HashMap::new(),
        functions: HashMap::new(),
        expr_types: HashMap::new(),
    };
    checker.run(module);
    let valid = !checker
        .diagnostics
        .iter()
        .any(|d| d.severity == Severity::Error);
    TypeCheckResult {
        valid,
        diagnostics: checker.diagnostics,
        structs: checker.structs,
        enums: checker.enums,
        functions: checker.functions,
        expr_types: checker.expr_types,
    }
}

struct TypeChecker {
    diagnostics: Vec<Diagnostic>,
    structs: HashMap<String, SemanticType>,
    enums: HashMap<String, SemanticType>,
    functions: HashMap<String, FunctionSignature>,
    expr_types: HashMap<ExprId, SemanticType>,
}

impl TypeChecker {
    fn error(&mut self, code: &str, message: impl Into<String>, span: &SourceSpan) {
        self.diagnostics.push(Diagnostic::error(code, message, span));
    }

    fn error_hint(
        &mut self,
        code: &str,
        message: impl Into<String>,
        span: &SourceSpan,
        hint: impl Into<String>,
    ) {
        self.diagnostics
            .push(Diagnostic::error_with_hint(code, message, span, hint));
    }

    fn run(&mut self, module: &SemanticModule) {
        self.enums.insert(
            "Result".to_string(),
            SemanticType::Enum {
                name: "Result".to_string(),
                type_args: vec![
                    SemanticType::TypeParam("T".to_string()),
                    SemanticType::TypeParam("E".to_string()),
                ],
                variants: vec![
                    EnumVariantType {
                        name: "Ok".to_string(),
                        tag: 0,
                        payload: vec![SemanticType::TypeParam("T".to_string())],
                    },
                    EnumVariantType {
                        name: "Err".to_string(),
                        tag: 1,
                        payload: vec![SemanticType::TypeParam("E".to_string())],
                    },
                ],
            },
        );

        // 1. Struct headers
        for st in &module.structs {
            if self.structs.contains_key(&st.name) {
                self.error(
                    "E_DUPLICATE_STRUCT",
                    format!("Duplicate struct declaration '{}'", st.name),
                    &st.span,
                );
            }
            self.structs.insert(
                st.name.clone(),
                SemanticType::Struct {
                    name: st.name.clone(),
                    type_args: st
                        .type_params
                        .iter()
                        .map(|tp| SemanticType::TypeParam(tp.clone()))
                        .collect(),
                    fields: Vec::new(),
                },
            );
        }

        // 1.5 Traits -> E_UNSUPPORTED_FEATURE
        for tr in &module.traits {
            self.error_hint(
                "E_UNSUPPORTED_FEATURE",
                format!(
                    "Unsupported feature: 'trait' / 'TRAIT' declaration ('{}') is not supported in Manifest v1.0 ({} profile).",
                    tr.name,
                    module.profile.as_str()
                ),
                &tr.span,
                "Define a struct with typed fields and standalone functions instead.",
            );
        }

        // 2. Enum headers
        for en in &module.enums {
            if self.enums.contains_key(&en.name) {
                self.error(
                    "E_DUPLICATE_ENUM",
                    format!("Duplicate enum declaration '{}'", en.name),
                    &en.span,
                );
            }
            self.enums.insert(
                en.name.clone(),
                SemanticType::Enum {
                    name: en.name.clone(),
                    type_args: en
                        .type_params
                        .iter()
                        .map(|tp| SemanticType::TypeParam(tp.clone()))
                        .collect(),
                    variants: Vec::new(),
                },
            );
        }

        // 3. Struct fields
        for st in &module.structs {
            let tp_set: HashSet<String> = st.type_params.iter().cloned().collect();
            let mut seen_fields = HashSet::new();
            let mut fields = Vec::new();
            for f in &st.fields {
                if !seen_fields.insert(f.name.clone()) {
                    self.error(
                        "E_DUPLICATE_FIELD",
                        format!("Duplicate field '{}' in struct '{}'", f.name, st.name),
                        &f.span,
                    );
                }
                let resolved = resolve_type_node(
                    &f.field_type,
                    &self.structs,
                    &self.enums,
                    &tp_set,
                    &mut self.diagnostics,
                );
                fields.push(StructFieldType {
                    name: f.name.clone(),
                    field_type: resolved,
                });
            }
            self.structs.insert(
                st.name.clone(),
                SemanticType::Struct {
                    name: st.name.clone(),
                    type_args: st
                        .type_params
                        .iter()
                        .map(|tp| SemanticType::TypeParam(tp.clone()))
                        .collect(),
                    fields,
                },
            );
        }

        // 4. Enum variants
        for en in &module.enums {
            let tp_set: HashSet<String> = en.type_params.iter().cloned().collect();
            let mut variants = Vec::new();
            for (idx, v) in en.variants.iter().enumerate() {
                let mut payload = Vec::new();
                for pt in &v.payload_types {
                    payload.push(resolve_type_node(
                        pt,
                        &self.structs,
                        &self.enums,
                        &tp_set,
                        &mut self.diagnostics,
                    ));
                }
                variants.push(EnumVariantType {
                    name: v.name.clone(),
                    tag: idx,
                    payload,
                });
            }
            self.enums.insert(
                en.name.clone(),
                SemanticType::Enum {
                    name: en.name.clone(),
                    type_args: en
                        .type_params
                        .iter()
                        .map(|tp| SemanticType::TypeParam(tp.clone()))
                        .collect(),
                    variants,
                },
            );
        }

        // 5. Function signatures
        for fn_d in &module.functions {
            if self.functions.contains_key(&fn_d.name) {
                self.error(
                    "E_DUPLICATE_FN",
                    format!("Duplicate function '{}'", fn_d.name),
                    &fn_d.span,
                );
            }
            let tp_set: HashSet<String> = fn_d.type_params.iter().cloned().collect();
            let mut params = Vec::new();
            for p in &fn_d.params {
                let pt = resolve_type_node(
                    &p.param_type,
                    &self.structs,
                    &self.enums,
                    &tp_set,
                    &mut self.diagnostics,
                );
                params.push((p.name.clone(), pt));
            }
            let return_type = resolve_type_node(
                &fn_d.return_type,
                &self.structs,
                &self.enums,
                &tp_set,
                &mut self.diagnostics,
            );
            self.functions.insert(
                fn_d.name.clone(),
                FunctionSignature {
                    name: fn_d.name.clone(),
                    module_name: module.module_name.clone(),
                    exported: fn_d.exported,
                    is_async: fn_d.is_async,
                    type_params: fn_d.type_params.clone(),
                    params,
                    return_type,
                    declared_effects: fn_d.effects.clone(),
                    has_explicit_effects: fn_d.has_explicit_effects,
                    span: fn_d.span.clone(),
                },
            );
        }

        // 6. Module constants & top-level statements
        let mut root_scope: HashMap<String, SymbolEntry> = HashMap::new();
        for c in &module.constants {
            let empty_tp = HashSet::new();
            let init_type = {
                let scopes = [root_scope.clone()];
                self.infer_expr(&c.init, &scopes, &empty_tp, false)
            };
            let annotated = match &c.type_annotation {
                TypeNode::InferredType { .. } => init_type.clone(),
                other => resolve_type_node(
                    other,
                    &self.structs,
                    &self.enums,
                    &empty_tp,
                    &mut self.diagnostics,
                ),
            };
            if !types_compatible(&annotated, &init_type) {
                self.error(
                    "E_CONST_TYPE_MISMATCH",
                    format!(
                        "Constant '{}' declared as '{}', got '{}'",
                        c.name,
                        annotated.format_type(),
                        init_type.format_type()
                    ),
                    &c.span,
                );
            }
            if root_scope.contains_key(&c.name) {
                self.error(
                    "E_REDECLARATION",
                    format!("Constant '{}' is already declared in this module", c.name),
                    &c.span,
                );
            }
            root_scope.insert(
                c.name.clone(),
                SymbolEntry {
                    name: c.name.clone(),
                    sym_type: annotated,
                    mutable: false,
                    is_const: true,
                },
            );
        }

        let empty_tp = HashSet::new();
        let mut scopes = vec![root_scope];
        for stmt in &module.top_level_stmts {
            self.check_stmt(stmt, &mut scopes, &SemanticType::Any, 0, false, &empty_tp);
        }

        for gv in &module.globals {
            if !scopes[0].contains_key(&gv.name) {
                let init_type = self.infer_expr(&gv.init, &scopes, &empty_tp, false);
                let target_type = match &gv.type_annotation {
                    TypeNode::InferredType { .. } => init_type.clone(),
                    other => resolve_type_node(
                        other,
                        &self.structs,
                        &self.enums,
                        &empty_tp,
                        &mut self.diagnostics,
                    ),
                };
                if !types_compatible(&target_type, &init_type) {
                    self.error(
                        "E_TYPE_MISMATCH",
                        format!(
                            "Cannot assign value of type '{}' to '{}' of type '{}'",
                            init_type.format_type(),
                            gv.name,
                            target_type.format_type()
                        ),
                        &gv.span,
                    );
                }
                scopes[0].insert(
                    gv.name.clone(),
                    SymbolEntry {
                        name: gv.name.clone(),
                        sym_type: target_type,
                        mutable: true,
                        is_const: false,
                    },
                );
            }
        }

        let module_root_scope = scopes.into_iter().next().unwrap_or_default();

        // 7. Functions
        for fn_d in &module.functions {
            self.check_function(fn_d, &module_root_scope);
        }
    }

    fn check_function(&mut self, fn_d: &FnDecl, module_scope: &HashMap<String, SymbolEntry>) {
        let Some(sig) = self.functions.get(&fn_d.name).cloned() else {
            return;
        };
        let mut fn_scope = HashMap::new();
        let tp_set: HashSet<String> = fn_d.type_params.iter().cloned().collect();

        for (i, p) in fn_d.params.iter().enumerate() {
            if fn_scope.contains_key(&p.name) {
                self.error(
                    "E_DUPLICATE_PARAM",
                    format!("Duplicate parameter '{}' in '{}'", p.name, fn_d.name),
                    &p.span,
                );
            }
            let p_type = sig
                .params
                .get(i)
                .map(|(_, t)| t.clone())
                .unwrap_or(SemanticType::Any);
            fn_scope.insert(
                p.name.clone(),
                SymbolEntry {
                    name: p.name.clone(),
                    sym_type: p_type,
                    mutable: false,
                    is_const: false,
                },
            );
        }

        let mut scopes = vec![module_scope.clone(), fn_scope];
        let definitely_returns = self.check_block(
            &fn_d.body,
            &mut scopes,
            &sig.return_type,
            0,
            fn_d.is_async,
            &tp_set,
        );

        if !matches!(sig.return_type, SemanticType::Void | SemanticType::Any)
            && !definitely_returns
        {
            self.error(
                "E_MISSING_RETURN",
                format!(
                    "Function '{}' must return a value of type '{}' on all control-flow paths",
                    fn_d.name,
                    sig.return_type.format_type()
                ),
                &fn_d.span,
            );
        }
    }

    fn check_block(
        &mut self,
        stmts: &[SemanticStmt],
        scopes: &mut Vec<HashMap<String, SymbolEntry>>,
        expected_return: &SemanticType,
        loop_depth: usize,
        in_async: bool,
        type_params: &HashSet<String>,
    ) -> bool {
        scopes.push(HashMap::new());
        let mut returned = false;
        for stmt in stmts {
            if self.check_stmt(stmt, scopes, expected_return, loop_depth, in_async, type_params) {
                returned = true;
            }
        }
        scopes.pop();
        returned
    }

    fn check_stmt(
        &mut self,
        stmt: &SemanticStmt,
        scopes: &mut Vec<HashMap<String, SymbolEntry>>,
        expected_return: &SemanticType,
        loop_depth: usize,
        in_async: bool,
        type_params: &HashSet<String>,
    ) -> bool {
        match stmt {
            SemanticStmt::VarStmt { decl, .. } => {
                let init_type = self.infer_expr(&decl.init, scopes, type_params, in_async);
                let target_type = match &decl.type_annotation {
                    TypeNode::InferredType { .. } => init_type.clone(),
                    other => resolve_type_node(
                        other,
                        &self.structs,
                        &self.enums,
                        type_params,
                        &mut self.diagnostics,
                    ),
                };
                if !types_compatible(&target_type, &init_type) {
                    self.error(
                        "E_TYPE_MISMATCH",
                        format!(
                            "Cannot assign value of type '{}' to '{}' of type '{}'",
                            init_type.format_type(),
                            decl.name,
                            target_type.format_type()
                        ),
                        &decl.span,
                    );
                }
                let is_module_root = scopes.len() == 1;
                if let Some(cur) = scopes.last_mut() {
                    if cur.contains_key(&decl.name) {
                        self.error(
                            "E_REDECLARATION",
                            format!("Variable '{}' is already declared in this scope", decl.name),
                            &decl.span,
                        );
                    }
                    cur.insert(
                        decl.name.clone(),
                        SymbolEntry {
                            name: decl.name.clone(),
                            sym_type: target_type,
                            mutable: if is_module_root { true } else { decl.mutable },
                            is_const: false,
                        },
                    );
                }
                false
            }
            SemanticStmt::ConstStmt { decl, .. } => {
                let init_type = self.infer_expr(&decl.init, scopes, type_params, in_async);
                let target_type = match &decl.type_annotation {
                    TypeNode::InferredType { .. } => init_type.clone(),
                    other => resolve_type_node(
                        other,
                        &self.structs,
                        &self.enums,
                        type_params,
                        &mut self.diagnostics,
                    ),
                };
                if !types_compatible(&target_type, &init_type) {
                    self.error(
                        "E_CONST_TYPE_MISMATCH",
                        format!(
                            "Constant '{}' expects '{}', got '{}'",
                            decl.name,
                            target_type.format_type(),
                            init_type.format_type()
                        ),
                        &decl.span,
                    );
                }
                if let Some(cur) = scopes.last_mut() {
                    cur.insert(
                        decl.name.clone(),
                        SymbolEntry {
                            name: decl.name.clone(),
                            sym_type: target_type,
                            mutable: false,
                            is_const: true,
                        },
                    );
                }
                false
            }
            SemanticStmt::AssignStmt { target, value, .. } => {
                let val_type = self.infer_expr(value, scopes, type_params, in_async);
                self.check_assign_target(target, &val_type, scopes, type_params, in_async);
                false
            }
            SemanticStmt::ExprStmt { expr, .. } => {
                self.infer_expr(expr, scopes, type_params, in_async);
                false
            }
            SemanticStmt::IfStmt {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                let cond_type = self.infer_expr(condition, scopes, type_params, in_async);
                if !types_compatible(&SemanticType::Bool, &cond_type) {
                    self.error(
                        "E_COND_NOT_BOOL",
                        format!(
                            "'if' condition must have type 'bool', found '{}'",
                            cond_type.format_type()
                        ),
                        &condition.span,
                    );
                }
                let then_ret = self.check_block(
                    then_branch,
                    scopes,
                    expected_return,
                    loop_depth,
                    in_async,
                    type_params,
                );
                let else_ret = !else_branch.is_empty()
                    && self.check_block(
                        else_branch,
                        scopes,
                        expected_return,
                        loop_depth,
                        in_async,
                        type_params,
                    );
                then_ret && else_ret
            }
            SemanticStmt::WhileStmt {
                condition, body, ..
            } => {
                let cond_type = self.infer_expr(condition, scopes, type_params, in_async);
                if !types_compatible(&SemanticType::Bool, &cond_type) {
                    self.error(
                        "E_COND_NOT_BOOL",
                        format!(
                            "'while' condition must have type 'bool', found '{}'",
                            cond_type.format_type()
                        ),
                        &condition.span,
                    );
                }
                self.check_block(
                    body,
                    scopes,
                    expected_return,
                    loop_depth + 1,
                    in_async,
                    type_params,
                );
                false
            }
            SemanticStmt::ForInStmt {
                item_name,
                iterable,
                body,
                span,
            } => {
                let iter_type = self.infer_expr(iterable, scopes, type_params, in_async);
                let elem_type = match &iter_type {
                    SemanticType::Array(el) => (**el).clone(),
                    SemanticType::Any => SemanticType::Any,
                    other => {
                        self.error(
                            "E_NOT_ITERABLE",
                            format!(
                                "Cannot iterate over value of type '{}' (expected Array<T>)",
                                other.format_type()
                            ),
                            &iterable.span,
                        );
                        SemanticType::Any
                    }
                };
                let mut loop_scope = HashMap::new();
                loop_scope.insert(
                    item_name.clone(),
                    SymbolEntry {
                        name: item_name.clone(),
                        sym_type: elem_type,
                        mutable: false,
                        is_const: false,
                    },
                );
                scopes.push(loop_scope);
                self.check_block(
                    body,
                    scopes,
                    expected_return,
                    loop_depth + 1,
                    in_async,
                    type_params,
                );
                scopes.pop();
                let _ = span;
                false
            }
            SemanticStmt::RepeatStmt { count, body, .. } => {
                let count_type = self.infer_expr(count, scopes, type_params, in_async);
                if !types_compatible(&SemanticType::I64, &count_type) {
                    self.error(
                        "E_REPEAT_COUNT_TYPE",
                        format!(
                            "Repeat count must be 'i64', found '{}'",
                            count_type.format_type()
                        ),
                        &count.span,
                    );
                }
                self.check_block(
                    body,
                    scopes,
                    expected_return,
                    loop_depth + 1,
                    in_async,
                    type_params,
                );
                false
            }
            SemanticStmt::BreakStmt { span } => {
                if loop_depth == 0 {
                    self.error(
                        "E_BREAK_OUTSIDE_LOOP",
                        "'break' cannot be used outside of a loop",
                        span,
                    );
                }
                false
            }
            SemanticStmt::ContinueStmt { span } => {
                if loop_depth == 0 {
                    self.error(
                        "E_CONTINUE_OUTSIDE_LOOP",
                        "'continue' cannot be used outside of a loop",
                        span,
                    );
                }
                false
            }
            SemanticStmt::ReturnStmt { value, span } => {
                let Some(val_expr) = value else {
                    if !types_compatible(expected_return, &SemanticType::Void) {
                        self.error(
                            "E_RETURN_TYPE_MISMATCH",
                            format!(
                                "Expected return value of type '{}', found empty return",
                                expected_return.format_type()
                            ),
                            span,
                        );
                    }
                    return true;
                };
                let val_type = self.infer_expr(val_expr, scopes, type_params, in_async);
                if !types_compatible(expected_return, &val_type) {
                    self.error(
                        "E_RETURN_TYPE_MISMATCH",
                        format!(
                            "Return type mismatch: expected '{}', got '{}'",
                            expected_return.format_type(),
                            val_type.format_type()
                        ),
                        span,
                    );
                }
                true
            }
            SemanticStmt::MatchStmt {
                subject,
                arms,
                span,
            } => {
                let subj_type = self.infer_expr(subject, scopes, type_params, in_async);
                let mut has_wildcard = false;
                let mut covered_variants = HashSet::new();
                let mut all_arms_return = !arms.is_empty();

                for arm in arms {
                    let mut arm_scope = HashMap::new();
                    self.bind_pattern(&arm.pattern, &subj_type, &mut arm_scope, &mut covered_variants);
                    if matches!(arm.pattern, MatchPattern::WildcardPattern { .. }) {
                        has_wildcard = true;
                    }
                    scopes.push(arm_scope);
                    let arm_ret = self.check_block(
                        &arm.body,
                        scopes,
                        expected_return,
                        loop_depth,
                        in_async,
                        type_params,
                    );
                    scopes.pop();
                    if !arm_ret {
                        all_arms_return = false;
                    }
                }

                match &subj_type {
                    SemanticType::Enum { name, variants, .. } if !has_wildcard => {
                        let missing: Vec<String> = variants
                            .iter()
                            .filter(|v| !covered_variants.contains(&v.name))
                            .map(|v| v.name.clone())
                            .collect();
                        if !missing.is_empty() {
                            let joined = missing.join(", ");
                            self.error_hint(
                                "E_NON_EXHAUSTIVE_MATCH",
                                format!("Non-exhaustive match on '{name}': missing variant(s) {joined}"),
                                span,
                                format!("Add match arms for {joined} or a wildcard '_' / 'ELSE' branch."),
                            );
                        }
                    }
                    SemanticType::Result { .. } if !has_wildcard => {
                        let missing: Vec<&str> = ["Ok", "Err"]
                            .into_iter()
                            .filter(|v| !covered_variants.contains(*v))
                            .collect();
                        if !missing.is_empty() {
                            let joined = missing.join(", ");
                            self.error_hint(
                                "E_NON_EXHAUSTIVE_MATCH",
                                format!(
                                    "Non-exhaustive match on '{}': missing variant(s) {joined}",
                                    subj_type.format_type()
                                ),
                                span,
                                format!("Add match arms for {joined} or a wildcard '_' / 'ELSE' branch."),
                            );
                        }
                    }
                    other
                        if !matches!(
                            other,
                            SemanticType::Enum { .. } | SemanticType::Result { .. } | SemanticType::Any
                        ) && !has_wildcard =>
                    {
                        self.error(
                            "E_NON_EXHAUSTIVE_MATCH",
                            format!(
                                "Match on '{}' requires a wildcard '_' / 'ELSE' fallback arm",
                                subj_type.format_type()
                            ),
                            span,
                        );
                    }
                    _ => {}
                }

                all_arms_return
                    && (has_wildcard
                        || matches!(
                            subj_type,
                            SemanticType::Enum { .. } | SemanticType::Result { .. }
                        ))
            }
            SemanticStmt::TryStmt {
                try_body,
                err_binding,
                catch_body,
                span,
            } => {
                self.error_hint(
                    "E_UNSUPPORTED_FEATURE",
                    "Unsupported feature: 'try / catch' / 'TRY / IF FAILED' statements are not supported in the Manifest v1.0 runtime pipeline.",
                    span,
                    "Replace 'try / catch' with a function returning 'Result<T, str>' and handle errors with 'match' or '?'.",
                );
                self.check_block(
                    try_body,
                    scopes,
                    expected_return,
                    loop_depth,
                    in_async,
                    type_params,
                );
                let mut catch_scope = HashMap::new();
                if let Some(eb) = err_binding {
                    catch_scope.insert(
                        eb.clone(),
                        SymbolEntry {
                            name: eb.clone(),
                            sym_type: SemanticType::Str,
                            mutable: false,
                            is_const: false,
                        },
                    );
                }
                scopes.push(catch_scope);
                self.check_block(
                    catch_body,
                    scopes,
                    expected_return,
                    loop_depth,
                    in_async,
                    type_params,
                );
                scopes.pop();
                false
            }
        }
    }

    fn bind_pattern(
        &mut self,
        pat: &MatchPattern,
        subj_type: &SemanticType,
        arm_scope: &mut HashMap<String, SymbolEntry>,
        covered_variants: &mut HashSet<String>,
    ) {
        match pat {
            MatchPattern::WildcardPattern { .. } => {}
            MatchPattern::LiteralPattern { value, span } => {
                let lit_type = match value {
                    LiteralPatValue::Int(_) => SemanticType::I64,
                    LiteralPatValue::Bool(_) => SemanticType::Bool,
                    LiteralPatValue::Str(_) => SemanticType::Str,
                };
                if !types_compatible(subj_type, &lit_type) {
                    self.error(
                        "E_PATTERN_TYPE_MISMATCH",
                        format!(
                            "Pattern literal of type '{}' cannot match '{}'",
                            lit_type.format_type(),
                            subj_type.format_type()
                        ),
                        span,
                    );
                }
            }
            MatchPattern::EnumVariantPattern {
                enum_name,
                variant_name,
                bindings,
                span,
            } => match subj_type {
                SemanticType::Enum { name, variants, .. } => {
                    if let Some(en) = enum_name {
                        if en != name {
                            self.error(
                                "E_PATTERN_ENUM_MISMATCH",
                                format!("Expected variant of enum '{name}', got '{en}'"),
                                span,
                            );
                            return;
                        }
                    }
                    let Some(variant) = variants.iter().find(|v| &v.name == variant_name) else {
                        self.error(
                            "E_UNKNOWN_VARIANT",
                            format!("Enum '{name}' has no variant '{variant_name}'"),
                            span,
                        );
                        return;
                    };
                    covered_variants.insert(variant.name.clone());
                    if bindings.len() != variant.payload.len() {
                        self.error(
                            "E_VARIANT_ARITY",
                            format!(
                                "Variant '{name}::{}' expects {} binding(s), got {}",
                                variant.name,
                                variant.payload.len(),
                                bindings.len()
                            ),
                            span,
                        );
                    }
                    for (i, b) in bindings.iter().enumerate() {
                        let p_ty = variant.payload.get(i).cloned().unwrap_or(SemanticType::Any);
                        arm_scope.insert(
                            b.clone(),
                            SymbolEntry {
                                name: b.clone(),
                                sym_type: p_ty,
                                mutable: false,
                                is_const: false,
                            },
                        );
                    }
                }
                SemanticType::Result { ok, err } => {
                    if variant_name != "Ok" && variant_name != "Err" {
                        self.error(
                            "E_UNKNOWN_VARIANT",
                            "Result pattern expects Ok(v) or Err(e)",
                            span,
                        );
                        return;
                    }
                    covered_variants.insert(variant_name.clone());
                    if let Some(b0) = bindings.first() {
                        arm_scope.insert(
                            b0.clone(),
                            SymbolEntry {
                                name: b0.clone(),
                                sym_type: if variant_name == "Ok" {
                                    (**ok).clone()
                                } else {
                                    (**err).clone()
                                },
                                mutable: false,
                                is_const: false,
                            },
                        );
                    }
                }
                _ => {
                    for b in bindings {
                        arm_scope.insert(
                            b.clone(),
                            SymbolEntry {
                                name: b.clone(),
                                sym_type: SemanticType::Any,
                                mutable: false,
                                is_const: false,
                            },
                        );
                    }
                }
            },
        }
    }

    fn check_assign_target(
        &mut self,
        target: &AssignTarget,
        val_type: &SemanticType,
        scopes: &mut [HashMap<String, SymbolEntry>],
        type_params: &HashSet<String>,
        in_async: bool,
    ) {
        match target {
            AssignTarget::VarTarget { name, span } => {
                let Some(sym) = self.lookup_symbol(name, scopes).cloned() else {
                    self.error_hint(
                        "E_UNDEFINED_VAR",
                        format!("Cannot assign to undeclared variable '{name}'"),
                        span,
                        format!("Declare it first with 'let mut {name} = ...' or 'MUTABLE {name} = ...'."),
                    );
                    return;
                };
                if sym.is_const {
                    self.error(
                        "E_ASSIGN_CONST",
                        format!("Cannot reassign constant '{name}'"),
                        span,
                    );
                    return;
                }
                if !sym.mutable {
                    self.error_hint(
                        "E_ASSIGN_IMMUTABLE",
                        format!("Cannot mutate immutable variable '{name}'"),
                        span,
                        format!("Declare '{name}' as mutable using 'let mut' (Professional) or 'MUTABLE' (Beginner)."),
                    );
                    return;
                }
                if !types_compatible(&sym.sym_type, val_type) {
                    self.error(
                        "E_TYPE_MISMATCH",
                        format!(
                            "Cannot assign '{}' to '{name}' of type '{}'",
                            val_type.format_type(),
                            sym.sym_type.format_type()
                        ),
                        span,
                    );
                }
            }
            AssignTarget::FieldTarget {
                object,
                field,
                span,
            } => {
                if let SemanticExprKind::Identifier { name } = &object.kind {
                    if let Some(root_sym) = self.lookup_symbol(name, scopes) {
                        if !root_sym.mutable {
                            self.error(
                                "E_ASSIGN_IMMUTABLE",
                                format!("Cannot mutate field '{field}' of immutable binding '{name}'"),
                                span,
                            );
                        }
                    }
                }
                let obj_type = self.infer_expr(object, scopes, type_params, in_async);
                if let SemanticType::Struct { name, fields, .. } = obj_type {
                    if let Some(f) = fields.iter().find(|x| &x.name == field) {
                        if !types_compatible(&f.field_type, val_type) {
                            self.error(
                                "E_TYPE_MISMATCH",
                                format!(
                                    "Field '{name}.{field}' expects '{}', got '{}'",
                                    f.field_type.format_type(),
                                    val_type.format_type()
                                ),
                                span,
                            );
                        }
                    } else {
                        self.error(
                            "E_UNKNOWN_FIELD",
                            format!("Struct '{name}' has no field '{field}'"),
                            span,
                        );
                    }
                }
            }
            AssignTarget::IndexTarget {
                object,
                index,
                span,
            } => {
                if let SemanticExprKind::Identifier { name } = &object.kind {
                    if let Some(root_sym) = self.lookup_symbol(name, scopes) {
                        if !root_sym.mutable {
                            self.error(
                                "E_ASSIGN_IMMUTABLE",
                                format!("Cannot mutate element of immutable collection '{name}'"),
                                span,
                            );
                        }
                    }
                }
                let obj_type = self.infer_expr(object, scopes, type_params, in_async);
                let idx_type = self.infer_expr(index, scopes, type_params, in_async);
                match obj_type {
                    SemanticType::Array(elem) => {
                        if !types_compatible(&SemanticType::I64, &idx_type) {
                            self.error(
                                "E_INDEX_TYPE",
                                format!("Array index must be 'i64', got '{}'", idx_type.format_type()),
                                &index.span,
                            );
                        }
                        if !types_compatible(&elem, val_type) {
                            self.error(
                                "E_TYPE_MISMATCH",
                                format!(
                                    "Array element expects '{}', got '{}'",
                                    elem.format_type(),
                                    val_type.format_type()
                                ),
                                span,
                            );
                        }
                    }
                    SemanticType::Map { key, value } => {
                        if !types_compatible(&key, &idx_type) {
                            self.error(
                                "E_KEY_TYPE",
                                format!(
                                    "Map key expects '{}', got '{}'",
                                    key.format_type(),
                                    idx_type.format_type()
                                ),
                                &index.span,
                            );
                        }
                        if !types_compatible(&value, val_type) {
                            self.error(
                                "E_TYPE_MISMATCH",
                                format!(
                                    "Map value expects '{}', got '{}'",
                                    value.format_type(),
                                    val_type.format_type()
                                ),
                                span,
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn infer_expr(
        &mut self,
        expr: &SemanticExpr,
        scopes: &[HashMap<String, SymbolEntry>],
        type_params: &HashSet<String>,
        in_async: bool,
    ) -> SemanticType {
        let t = self.infer_expr_inner(expr, scopes, type_params, in_async);
        self.expr_types.insert(expr.id, t.clone());
        t
    }

    fn infer_expr_inner(
        &mut self,
        expr: &SemanticExpr,
        scopes: &[HashMap<String, SymbolEntry>],
        type_params: &HashSet<String>,
        in_async: bool,
    ) -> SemanticType {
        match &expr.kind {
            SemanticExprKind::IntLiteral { value, raw } => {
                let overflows = match value {
                    Some(v) => *v < (i64::MIN as i128) || *v > (i64::MAX as i128),
                    None => true,
                };
                if overflows {
                    self.error(
                        "E_INT_LITERAL_OVERFLOW",
                        format!("Integer literal '{raw}' overflows signed 64-bit integer range (i64)"),
                        &expr.span,
                    );
                }
                SemanticType::I64
            }
            SemanticExprKind::FloatLiteral { .. } => SemanticType::F64,
            SemanticExprKind::BoolLiteral { .. } => SemanticType::Bool,
            SemanticExprKind::StringLiteral { .. } => SemanticType::Str,
            SemanticExprKind::Identifier { name } => match self.lookup_symbol(name, scopes) {
                Some(sym) => sym.sym_type.clone(),
                None => {
                    self.error(
                        "E_UNDEFINED_VAR",
                        format!("Undefined identifier '{name}'"),
                        &expr.span,
                    );
                    SemanticType::Any
                }
            },
            SemanticExprKind::UnaryExpr { op, operand } => {
                let op_type = self.infer_expr(operand, scopes, type_params, in_async);
                match op {
                    UnaryOp::Neg => {
                        if matches!(
                            op_type,
                            SemanticType::I64 | SemanticType::F64 | SemanticType::Any
                        ) {
                            op_type
                        } else {
                            self.error(
                                "E_UNARY_NEG_TYPE",
                                format!(
                                    "Unary '-' requires 'i64' or 'f64', found '{}'",
                                    op_type.format_type()
                                ),
                                &expr.span,
                            );
                            SemanticType::I64
                        }
                    }
                    UnaryOp::Not => {
                        if !types_compatible(&SemanticType::Bool, &op_type) {
                            self.error(
                                "E_UNARY_NOT_TYPE",
                                format!(
                                    "Logical '!' requires 'bool', found '{}'",
                                    op_type.format_type()
                                ),
                                &expr.span,
                            );
                        }
                        SemanticType::Bool
                    }
                }
            }
            SemanticExprKind::BinaryExpr { op, left, right } => {
                let lt = self.infer_expr(left, scopes, type_params, in_async);
                let rt = self.infer_expr(right, scopes, type_params, in_async);

                match op {
                    BinaryOp::And | BinaryOp::Or => {
                        if !types_compatible(&SemanticType::Bool, &lt)
                            || !types_compatible(&SemanticType::Bool, &rt)
                        {
                            self.error(
                                "E_LOGICAL_OP_TYPE",
                                format!(
                                    "Logical operator '{}' requires 'bool' operands, got '{}' and '{}'",
                                    op.as_str(),
                                    lt.format_type(),
                                    rt.format_type()
                                ),
                                &expr.span,
                            );
                        }
                        SemanticType::Bool
                    }
                    BinaryOp::Eq | BinaryOp::Neq => {
                        if !types_compatible(&lt, &rt) {
                            self.error(
                                "E_EQ_TYPE_MISMATCH",
                                format!(
                                    "Cannot compare '{}' and '{}' with '{}'",
                                    lt.format_type(),
                                    rt.format_type(),
                                    op.as_str()
                                ),
                                &expr.span,
                            );
                        }
                        SemanticType::Bool
                    }
                    BinaryOp::Lt | BinaryOp::Lte | BinaryOp::Gt | BinaryOp::Gte => {
                        if !types_compatible(&lt, &rt)
                            || !matches!(
                                lt,
                                SemanticType::I64
                                    | SemanticType::F64
                                    | SemanticType::Str
                                    | SemanticType::Any
                            )
                        {
                            self.error(
                                "E_CMP_TYPE_MISMATCH",
                                format!(
                                    "Ordered comparison '{}' requires matching 'i64', 'f64', or 'str' operands, got '{}' and '{}'",
                                    op.as_str(),
                                    lt.format_type(),
                                    rt.format_type()
                                ),
                                &expr.span,
                            );
                        }
                        SemanticType::Bool
                    }
                    BinaryOp::Add => {
                        if matches!(lt, SemanticType::Str) && matches!(rt, SemanticType::Str) {
                            return SemanticType::Str;
                        }
                        if matches!(lt, SemanticType::I64) && matches!(rt, SemanticType::I64) {
                            return SemanticType::I64;
                        }
                        if matches!(lt, SemanticType::F64) && matches!(rt, SemanticType::F64) {
                            return SemanticType::F64;
                        }
                        if matches!(lt, SemanticType::Any) || matches!(rt, SemanticType::Any) {
                            return if matches!(lt, SemanticType::Any) { rt } else { lt };
                        }
                        let hint = if matches!(lt, SemanticType::Str) || matches!(rt, SemanticType::Str)
                        {
                            "Use 'to_str(...)' to convert non-string values explicitly before '+' concatenation."
                        } else {
                            "Use 'to_f64(...)' or 'to_i64(...)' to convert between 'i64' and 'f64'."
                        };
                        self.error_hint(
                            "E_ARITH_TYPE_MISMATCH",
                            format!(
                                "Operator '+' is not defined for '{}' and '{}' (no implicit type coercion)",
                                lt.format_type(),
                                rt.format_type()
                            ),
                            &expr.span,
                            hint,
                        );
                        SemanticType::Any
                    }
                    BinaryOp::Sub | BinaryOp::Mul | BinaryOp::Div | BinaryOp::Mod => {
                        if matches!(lt, SemanticType::I64) && matches!(rt, SemanticType::I64) {
                            return SemanticType::I64;
                        }
                        if matches!(lt, SemanticType::F64) && matches!(rt, SemanticType::F64) {
                            return SemanticType::F64;
                        }
                        if matches!(lt, SemanticType::Any) || matches!(rt, SemanticType::Any) {
                            return if matches!(lt, SemanticType::Any) { rt } else { lt };
                        }
                        self.error(
                            "E_ARITH_TYPE_MISMATCH",
                            format!(
                                "Arithmetic operator '{}' requires matching 'i64' or 'f64' operands, got '{}' and '{}'",
                                op.as_str(),
                                lt.format_type(),
                                rt.format_type()
                            ),
                            &expr.span,
                        );
                        SemanticType::Any
                    }
                }
            }
            SemanticExprKind::ArrayLiteral { elements } => {
                if elements.is_empty() {
                    return SemanticType::Array(Box::new(SemanticType::Any));
                }
                let first_t = self.infer_expr(&elements[0], scopes, type_params, in_async);
                for (i, el) in elements.iter().enumerate().skip(1) {
                    let et = self.infer_expr(el, scopes, type_params, in_async);
                    if !types_compatible(&first_t, &et) {
                        self.error(
                            "E_ARRAY_HOMOGENEITY",
                            format!(
                                "Array elements must have uniform type: expected '{}', found '{}' at index {i}",
                                first_t.format_type(),
                                et.format_type()
                            ),
                            &el.span,
                        );
                    }
                }
                SemanticType::Array(Box::new(first_t))
            }
            SemanticExprKind::MapLiteral { entries } => {
                if entries.is_empty() {
                    return SemanticType::Map {
                        key: Box::new(SemanticType::Str),
                        value: Box::new(SemanticType::Any),
                    };
                }
                let kt = self.infer_expr(&entries[0].key, scopes, type_params, in_async);
                let vt = self.infer_expr(&entries[0].value, scopes, type_params, in_async);
                if !types_compatible(&SemanticType::Str, &kt) {
                    self.error(
                        "E_MAP_KEY_TYPE",
                        format!("Map literal keys must be 'str', found '{}'", kt.format_type()),
                        &entries[0].key.span,
                    );
                }
                for kv in entries.iter().skip(1) {
                    let ek = self.infer_expr(&kv.key, scopes, type_params, in_async);
                    let ev = self.infer_expr(&kv.value, scopes, type_params, in_async);
                    if !types_compatible(&kt, &ek) || !types_compatible(&vt, &ev) {
                        self.error(
                            "E_MAP_HOMOGENEITY",
                            "Map entries must have consistent key/value types",
                            &kv.key.span,
                        );
                    }
                }
                SemanticType::Map {
                    key: Box::new(SemanticType::Str),
                    value: Box::new(vt),
                }
            }
            SemanticExprKind::IndexAccessExpr { object, index } => {
                let obj_t = self.infer_expr(object, scopes, type_params, in_async);
                let idx_t = self.infer_expr(index, scopes, type_params, in_async);
                match obj_t {
                    SemanticType::Array(elem) => {
                        if !types_compatible(&SemanticType::I64, &idx_t) {
                            self.error(
                                "E_INDEX_TYPE",
                                format!("Array index must be 'i64', got '{}'", idx_t.format_type()),
                                &index.span,
                            );
                        }
                        *elem
                    }
                    SemanticType::Map { key, value } => {
                        if !types_compatible(&key, &idx_t) {
                            self.error(
                                "E_KEY_TYPE",
                                format!(
                                    "Map key expects '{}', got '{}'",
                                    key.format_type(),
                                    idx_t.format_type()
                                ),
                                &index.span,
                            );
                        }
                        *value
                    }
                    SemanticType::Any => SemanticType::Any,
                    other => {
                        self.error(
                            "E_NOT_INDEXABLE",
                            format!("Cannot index into type '{}'", other.format_type()),
                            &expr.span,
                        );
                        SemanticType::Any
                    }
                }
            }
            SemanticExprKind::FieldAccessExpr { object, field } => {
                let obj_t = self.infer_expr(object, scopes, type_params, in_async);
                match obj_t {
                    SemanticType::Struct { name, fields, .. } => {
                        if let Some(f) = fields.iter().find(|x| &x.name == field) {
                            f.field_type.clone()
                        } else {
                            self.error(
                                "E_UNKNOWN_FIELD",
                                format!("Struct '{name}' has no field '{field}'"),
                                &expr.span,
                            );
                            SemanticType::Any
                        }
                    }
                    SemanticType::Array(_) if field == "length" => SemanticType::I64,
                    SemanticType::Any => SemanticType::Any,
                    other => {
                        self.error(
                            "E_FIELD_ON_NON_STRUCT",
                            format!(
                                "Cannot access field '{field}' on value of type '{}'",
                                other.format_type()
                            ),
                            &expr.span,
                        );
                        SemanticType::Any
                    }
                }
            }
            SemanticExprKind::StructLiteral {
                struct_name,
                fields,
                ..
            } => {
                let Some(st_ty @ SemanticType::Struct { .. }) =
                    self.structs.get(struct_name).cloned()
                else {
                    self.error(
                        "E_UNKNOWN_STRUCT",
                        format!("Unknown struct '{struct_name}'"),
                        &expr.span,
                    );
                    return SemanticType::Any;
                };

                let mut provided: HashMap<String, SemanticType> = HashMap::new();
                for f in fields {
                    let vt = self.infer_expr(&f.value, scopes, type_params, in_async);
                    provided.insert(f.name.clone(), vt);
                }

                let mut bindings: HashMap<String, SemanticType> = HashMap::new();
                if let SemanticType::Struct {
                    name: st_name,
                    fields: st_fields,
                    ..
                } = &st_ty
                {
                    for sf in st_fields {
                        if let Some(actual) = provided.get(&sf.name) {
                            if let SemanticType::TypeParam(tp_name) = &sf.field_type {
                                bindings.insert(tp_name.clone(), actual.clone());
                            }
                        } else {
                            self.error(
                                "E_MISSING_STRUCT_FIELD",
                                format!("Missing field '{}' in initialization of '{st_name}'", sf.name),
                                &expr.span,
                            );
                        }
                    }
                }

                let instantiated = substitute_type_params(&st_ty, &bindings);
                if let SemanticType::Struct {
                    name: st_name,
                    fields: inst_fields,
                    ..
                } = &instantiated
                {
                    for f in fields {
                        if let Some(decl_field) = inst_fields.iter().find(|df| df.name == f.name) {
                            if let Some(actual) = provided.get(&f.name) {
                                if !types_compatible(&decl_field.field_type, actual) {
                                    self.error(
                                        "E_FIELD_TYPE_MISMATCH",
                                        format!(
                                            "Field '{st_name}.{}' expects '{}', got '{}'",
                                            f.name,
                                            decl_field.field_type.format_type(),
                                            actual.format_type()
                                        ),
                                        &f.span,
                                    );
                                }
                            }
                        } else {
                            self.error(
                                "E_EXTRA_STRUCT_FIELD",
                                format!("Struct '{st_name}' has no field '{}'", f.name),
                                &f.span,
                            );
                        }
                    }
                }
                instantiated
            }
            SemanticExprKind::EnumConstructExpr {
                enum_name,
                variant_name,
                args,
            } => {
                if enum_name == "Result" {
                    if variant_name != "Ok" && variant_name != "Err" {
                        self.error(
                            "E_UNKNOWN_VARIANT",
                            format!("Enum 'Result' has no variant '{variant_name}'"),
                            &expr.span,
                        );
                        return SemanticType::Result {
                            ok: Box::new(SemanticType::Any),
                            err: Box::new(SemanticType::Any),
                        };
                    }
                    if args.len() != 1 {
                        self.error(
                            "E_VARIANT_ARITY",
                            format!(
                                "Variant 'Result::{variant_name}' expects 1 argument, got {}",
                                args.len()
                            ),
                            &expr.span,
                        );
                        return SemanticType::Result {
                            ok: Box::new(SemanticType::Any),
                            err: Box::new(SemanticType::Any),
                        };
                    }
                    let arg_t = self.infer_expr(&args[0], scopes, type_params, in_async);
                    return if variant_name == "Ok" {
                        SemanticType::Result {
                            ok: Box::new(arg_t),
                            err: Box::new(SemanticType::Any),
                        }
                    } else {
                        SemanticType::Result {
                            ok: Box::new(SemanticType::Any),
                            err: Box::new(arg_t),
                        }
                    };
                }

                let Some(en_ty @ SemanticType::Enum { .. }) = self.enums.get(enum_name).cloned()
                else {
                    self.error(
                        "E_UNKNOWN_ENUM",
                        format!("Unknown enum '{enum_name}'"),
                        &expr.span,
                    );
                    return SemanticType::Any;
                };

                let SemanticType::Enum { variants, .. } = &en_ty else {
                    return SemanticType::Any;
                };
                let Some(variant) = variants.iter().find(|v| &v.name == variant_name) else {
                    self.error(
                        "E_UNKNOWN_VARIANT",
                        format!("Enum '{enum_name}' has no variant '{variant_name}'"),
                        &expr.span,
                    );
                    return en_ty;
                };
                if args.len() != variant.payload.len() {
                    self.error(
                        "E_VARIANT_ARITY",
                        format!(
                            "Variant '{enum_name}::{variant_name}' expects {} argument(s), got {}",
                            variant.payload.len(),
                            args.len()
                        ),
                        &expr.span,
                    );
                    return en_ty;
                }

                let mut bindings = HashMap::new();
                for (i, a) in args.iter().enumerate() {
                    let arg_t = self.infer_expr(a, scopes, type_params, in_async);
                    let pat_t = &variant.payload[i];
                    if let SemanticType::TypeParam(tp) = pat_t {
                        bindings.insert(tp.clone(), arg_t);
                    } else if !types_compatible(pat_t, &arg_t) {
                        self.error(
                            "E_VARIANT_ARG_TYPE",
                            format!(
                                "Variant '{enum_name}::{variant_name}' argument {} expects '{}', got '{}'",
                                i + 1,
                                pat_t.format_type(),
                                arg_t.format_type()
                            ),
                            &a.span,
                        );
                    }
                }
                substitute_type_params(&en_ty, &bindings)
            }
            SemanticExprKind::CallExpr { callee, args, .. } => {
                let mut arg_types = Vec::with_capacity(args.len());
                for a in args {
                    arg_types.push(self.infer_expr(a, scopes, type_params, in_async));
                }

                if callee == "push" || callee == "array.push" {
                    if arg_types.len() != 2
                        || !matches!(arg_types[0], SemanticType::Array(_) | SemanticType::Any)
                    {
                        self.error(
                            "E_CALL_ARITY",
                            "'push' expects (Array<T>, T)",
                            &expr.span,
                        );
                        return SemanticType::Void;
                    }
                    if let SemanticType::Array(elem) = &arg_types[0] {
                        if !types_compatible(elem, &arg_types[1]) {
                            self.error(
                                "E_ARRAY_PUSH_TYPE",
                                format!(
                                    "Cannot push '{}' onto '{}'",
                                    arg_types[1].format_type(),
                                    arg_types[0].format_type()
                                ),
                                &expr.span,
                            );
                        }
                    }
                    return SemanticType::Void;
                }

                if callee == "has" || callee == "map.has" {
                    return SemanticType::Bool;
                }

                if callee == "Ok" && arg_types.len() == 1 {
                    return SemanticType::Result {
                        ok: Box::new(arg_types[0].clone()),
                        err: Box::new(SemanticType::Any),
                    };
                }
                if callee == "Err" && arg_types.len() == 1 {
                    return SemanticType::Result {
                        ok: Box::new(SemanticType::Any),
                        err: Box::new(arg_types[0].clone()),
                    };
                }

                if let Some(std_spec) = lookup_std_intrinsic(callee) {
                    let expected_params = intrinsic_params(std_spec);
                    let ret_ty = intrinsic_return_type(std_spec);
                    if !std_spec.variadic_any && arg_types.len() != expected_params.len() {
                        self.error(
                            "E_CALL_ARITY",
                            format!(
                                "Function '{callee}' expects {} argument(s), got {}",
                                expected_params.len(),
                                arg_types.len()
                            ),
                            &expr.span,
                        );
                        return ret_ty;
                    }
                    if !std_spec.variadic_any {
                        for (i, exp_p) in expected_params.iter().enumerate() {
                            if !types_compatible(exp_p, &arg_types[i]) {
                                self.error(
                                    "E_ARG_TYPE_MISMATCH",
                                    format!(
                                        "Argument {} of '{callee}' expects '{}', got '{}'",
                                        i + 1,
                                        exp_p.format_type(),
                                        arg_types[i].format_type()
                                    ),
                                    &args[i].span,
                                );
                            }
                        }
                    }
                    return ret_ty;
                }

                let Some(fn_sig) = self.functions.get(callee).cloned() else {
                    self.error(
                        "E_UNDEFINED_FN",
                        format!("Call to undefined function '{callee}'"),
                        &expr.span,
                    );
                    return SemanticType::Any;
                };

                if arg_types.len() != fn_sig.params.len() {
                    self.error(
                        "E_CALL_ARITY",
                        format!(
                            "Function '{}' expects {} argument(s), got {}",
                            fn_sig.name,
                            fn_sig.params.len(),
                            arg_types.len()
                        ),
                        &expr.span,
                    );
                    return fn_sig.return_type;
                }

                let mut tp_bindings = HashMap::new();
                for (i, (p_name, expected_p)) in fn_sig.params.iter().enumerate() {
                    if let Some(conflict) =
                        self.unify_generic_param(expected_p, &arg_types[i], &mut tp_bindings)
                    {
                        self.error(
                            "E_GENERIC_CONFLICT",
                            format!(
                                "Conflicting types inferred for type parameter '{conflict}' in call to '{}'",
                                fn_sig.name
                            ),
                            &args[i].span,
                        );
                    } else {
                        let sub_expected = substitute_type_params(expected_p, &tp_bindings);
                        if !types_compatible(&sub_expected, &arg_types[i]) {
                            self.error(
                                "E_ARG_TYPE_MISMATCH",
                                format!(
                                    "Argument '{p_name}' of '{}' expects '{}', got '{}'",
                                    fn_sig.name,
                                    sub_expected.format_type(),
                                    arg_types[i].format_type()
                                ),
                                &args[i].span,
                            );
                        }
                    }
                }

                substitute_type_params(&fn_sig.return_type, &tp_bindings)
            }
            SemanticExprKind::AwaitExpr { operand } => {
                if !in_async {
                    self.error(
                        "E_AWAIT_OUTSIDE_ASYNC",
                        "'await' can only be used inside an 'async' function",
                        &expr.span,
                    );
                }
                self.infer_expr(operand, scopes, type_params, in_async)
            }
            SemanticExprKind::TryPropagateExpr { operand } => {
                let inner = self.infer_expr(operand, scopes, type_params, in_async);
                match inner {
                    SemanticType::Result { ok, .. } => *ok,
                    other => other,
                }
            }
        }
    }

    fn lookup_symbol<'a>(
        &self,
        name: &str,
        scopes: &'a [HashMap<String, SymbolEntry>],
    ) -> Option<&'a SymbolEntry> {
        for scope in scopes.iter().rev() {
            if let Some(found) = scope.get(name) {
                return Some(found);
            }
        }
        None
    }

    fn unify_generic_param(
        &self,
        pattern: &SemanticType,
        actual: &SemanticType,
        bindings: &mut HashMap<String, SemanticType>,
    ) -> Option<String> {
        if matches!(actual, SemanticType::Any) {
            return None;
        }
        match (pattern, actual) {
            (SemanticType::TypeParam(name), _) => {
                if let Some(prev) = bindings.get(name) {
                    if !types_compatible(prev, actual) {
                        return Some(name.clone());
                    }
                }
                bindings.insert(name.clone(), actual.clone());
                None
            }
            (SemanticType::Array(pe), SemanticType::Array(ae)) => {
                self.unify_generic_param(pe, ae, bindings)
            }
            (
                SemanticType::Map { key: pk, value: pv },
                SemanticType::Map { key: ak, value: av },
            ) => self
                .unify_generic_param(pk, ak, bindings)
                .or_else(|| self.unify_generic_param(pv, av, bindings)),
            (
                SemanticType::Result { ok: po, err: pe },
                SemanticType::Result { ok: ao, err: ae },
            ) => self
                .unify_generic_param(po, ao, bindings)
                .or_else(|| self.unify_generic_param(pe, ae, bindings)),
            (
                SemanticType::Struct {
                    name: pn,
                    type_args: pa,
                    ..
                },
                SemanticType::Struct {
                    name: an,
                    type_args: aa,
                    ..
                },
            )
            | (
                SemanticType::Enum {
                    name: pn,
                    type_args: pa,
                    ..
                },
                SemanticType::Enum {
                    name: an,
                    type_args: aa,
                    ..
                },
            ) if pn == an => {
                let len = pa.len().min(aa.len());
                for i in 0..len {
                    if let Some(c) = self.unify_generic_param(&pa[i], &aa[i], bindings) {
                        return Some(c);
                    }
                }
                None
            }
            _ => None,
        }
    }
}

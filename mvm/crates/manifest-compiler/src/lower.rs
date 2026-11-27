use std::collections::HashMap;

use crate::ast::*;
use crate::capabilities::CapabilityAuditReport;
use crate::checker::TypeCheckResult;
use crate::diagnostic::{Diagnostic, SourceSpan};
use crate::mir::*;
use crate::types::{intrinsic_return_type, lookup_std_intrinsic, SemanticType};

#[derive(Debug, Clone)]
struct LocalScopeBinding {
    name: String,
    slot: usize,
    local_type: SemanticType,
}

struct FunctionLoweringContext<'a> {
    fn_name: String,
    locals: Vec<MIRLocal>,
    scopes: Vec<HashMap<String, LocalScopeBinding>>,
    synth_counter: usize,
    globals_by_name: &'a HashMap<String, MIRGlobal>,
    structs_by_name: &'a HashMap<String, MIRStruct>,
    enums_by_name: &'a HashMap<String, MIREnum>,
    fn_return_types: &'a HashMap<String, SemanticType>,
    expr_types: &'a HashMap<ExprId, SemanticType>,
}

impl<'a> FunctionLoweringContext<'a> {
    fn new(
        fn_name: impl Into<String>,
        globals_by_name: &'a HashMap<String, MIRGlobal>,
        structs_by_name: &'a HashMap<String, MIRStruct>,
        enums_by_name: &'a HashMap<String, MIREnum>,
        fn_return_types: &'a HashMap<String, SemanticType>,
        expr_types: &'a HashMap<ExprId, SemanticType>,
    ) -> Self {
        Self {
            fn_name: fn_name.into(),
            locals: Vec::new(),
            scopes: vec![HashMap::new()],
            synth_counter: 0,
            globals_by_name,
            structs_by_name,
            enums_by_name,
            fn_return_types,
            expr_types,
        }
    }

    fn push_scope(&mut self) {
        self.scopes.push(HashMap::new());
    }

    fn pop_scope(&mut self) {
        if self.scopes.len() > 1 {
            self.scopes.pop();
        }
    }

    fn alloc_local(
        &mut self,
        name: String,
        local_type: SemanticType,
        mutable: bool,
        is_param: bool,
        span: SourceSpan,
        register_in_scope: bool,
    ) -> usize {
        let slot = self.locals.len();
        self.locals.push(MIRLocal {
            name: name.clone(),
            slot,
            is_param,
            mutable,
            local_type: local_type.clone(),
            span,
        });
        if register_in_scope {
            if let Some(scope) = self.scopes.last_mut() {
                scope.insert(
                    name.clone(),
                    LocalScopeBinding {
                        name,
                        slot,
                        local_type,
                    },
                );
            }
        }
        slot
    }

    fn alloc_temp(&mut self, prefix: &str, temp_type: SemanticType, span: SourceSpan) -> MIRLocal {
        let name = format!("__{}_{}", prefix, self.synth_counter);
        self.synth_counter += 1;
        let slot = self.alloc_local(name, temp_type, true, false, span, false);
        self.locals[slot].clone()
    }

    fn lookup_local(&self, name: &str) -> Option<&LocalScopeBinding> {
        for scope in self.scopes.iter().rev() {
            if let Some(found) = scope.get(name) {
                return Some(found);
            }
        }
        None
    }

    fn lookup_global(&self, name: &str) -> Option<&MIRGlobal> {
        self.globals_by_name.get(name)
    }

    fn expr_type(&self, expr: &SemanticExpr) -> SemanticType {
        self.expr_types
            .get(&expr.id)
            .cloned()
            .unwrap_or(SemanticType::Any)
    }

    fn lower_block(&mut self, stmts: &[SemanticStmt]) -> Result<Vec<MIRStmt>, Diagnostic> {
        let mut out = Vec::new();
        for s in stmts {
            self.lower_stmt_into(s, &mut out)?;
        }
        Ok(out)
    }

    fn lower_stmt_into(
        &mut self,
        stmt: &SemanticStmt,
        out: &mut Vec<MIRStmt>,
    ) -> Result<(), Diagnostic> {
        match stmt {
            SemanticStmt::VarStmt { decl, span } => {
                let val = self.lower_expr(&decl.init)?;
                if (self.fn_name == "__script__" || self.fn_name == "__init__")
                    && self.scopes.len() == 1
                {
                    if let Some(glob) = self.lookup_global(&decl.name) {
                        out.push(MIRStmt::StoreGlobal {
                            slot: glob.slot,
                            name: glob.name.clone(),
                            value: val,
                            span: span.clone(),
                        });
                        return Ok(());
                    }
                }
                let slot = self.alloc_local(
                    decl.name.clone(),
                    val.expr_type.clone(),
                    decl.mutable,
                    false,
                    span.clone(),
                    true,
                );
                out.push(MIRStmt::StoreLocal {
                    slot,
                    name: decl.name.clone(),
                    is_declaration: true,
                    value: val,
                    span: span.clone(),
                });
            }

            SemanticStmt::ConstStmt { decl, span } => {
                let val = self.lower_expr(&decl.init)?;
                let slot = self.alloc_local(
                    decl.name.clone(),
                    val.expr_type.clone(),
                    false,
                    false,
                    span.clone(),
                    true,
                );
                out.push(MIRStmt::StoreLocal {
                    slot,
                    name: decl.name.clone(),
                    is_declaration: true,
                    value: val,
                    span: span.clone(),
                });
            }

            SemanticStmt::AssignStmt {
                target,
                value,
                span,
            } => {
                let val = self.lower_expr(value)?;
                match target {
                    AssignTarget::VarTarget { name, .. } => {
                        if let Some(loc) = self.lookup_local(name).cloned() {
                            out.push(MIRStmt::StoreLocal {
                                slot: loc.slot,
                                name: loc.name,
                                is_declaration: false,
                                value: val,
                                span: span.clone(),
                            });
                        } else if let Some(glob) = self.lookup_global(name).cloned() {
                            out.push(MIRStmt::StoreGlobal {
                                slot: glob.slot,
                                name: glob.name,
                                value: val,
                                span: span.clone(),
                            });
                        } else {
                            let new_slot = self.alloc_local(
                                name.clone(),
                                val.expr_type.clone(),
                                true,
                                false,
                                span.clone(),
                                true,
                            );
                            out.push(MIRStmt::StoreLocal {
                                slot: new_slot,
                                name: name.clone(),
                                is_declaration: true,
                                value: val,
                                span: span.clone(),
                            });
                        }
                    }
                    AssignTarget::FieldTarget { object, field, .. } => {
                        let obj = self.lower_expr(object)?;
                        let st_name = match &obj.expr_type {
                            SemanticType::Struct { name, .. } => name.clone(),
                            _ => String::new(),
                        };
                        let field_idx = self
                            .structs_by_name
                            .get(&st_name)
                            .and_then(|st| st.fields.iter().position(|f| f.name == *field))
                            .unwrap_or(0);
                        out.push(MIRStmt::FieldSet {
                            object: obj,
                            struct_name: st_name,
                            field_name: field.clone(),
                            field_index: field_idx,
                            value: val,
                            span: span.clone(),
                        });
                    }
                    AssignTarget::IndexTarget { object, index, .. } => {
                        let obj = self.lower_expr(object)?;
                        let idx = self.lower_expr(index)?;
                        if matches!(obj.expr_type, SemanticType::Map { .. }) {
                            out.push(MIRStmt::MapSetStmt {
                                map: obj,
                                key: idx,
                                value: val,
                                span: span.clone(),
                            });
                        } else {
                            out.push(MIRStmt::ArraySet {
                                array: obj,
                                index: idx,
                                value: val,
                                span: span.clone(),
                            });
                        }
                    }
                }
            }

            SemanticStmt::ExprStmt { expr, span } => {
                out.push(MIRStmt::ExprStmt {
                    expr: self.lower_expr(expr)?,
                    span: span.clone(),
                });
            }

            SemanticStmt::IfStmt {
                condition,
                then_branch,
                else_branch,
                span,
            } => {
                let cond = self.lower_expr(condition)?;
                self.push_scope();
                let then_mir = self.lower_block(then_branch)?;
                self.pop_scope();

                self.push_scope();
                let else_mir = self.lower_block(else_branch)?;
                self.pop_scope();

                out.push(MIRStmt::If {
                    condition: cond,
                    then_branch: then_mir,
                    else_branch: else_mir,
                    span: span.clone(),
                });
            }

            SemanticStmt::WhileStmt {
                condition,
                body,
                span,
            } => {
                let cond = self.lower_expr(condition)?;
                self.push_scope();
                let body_mir = self.lower_block(body)?;
                self.pop_scope();
                out.push(MIRStmt::While {
                    condition: cond,
                    body: body_mir,
                    span: span.clone(),
                });
            }

            SemanticStmt::RepeatStmt { count, body, span } => {
                let limit_expr = self.lower_expr(count)?;
                let limit_temp = self.alloc_temp("repeat_limit", SemanticType::I64, span.clone());
                let idx_temp = self.alloc_temp("repeat_idx", SemanticType::I64, span.clone());

                out.push(MIRStmt::StoreLocal {
                    slot: limit_temp.slot,
                    name: limit_temp.name.clone(),
                    is_declaration: true,
                    value: limit_expr,
                    span: span.clone(),
                });
                out.push(MIRStmt::StoreLocal {
                    slot: idx_temp.slot,
                    name: idx_temp.name.clone(),
                    is_declaration: true,
                    value: MIRExpr {
                        kind: MIRExprKind::ConstInt { value: 0 },
                        expr_type: SemanticType::I64,
                        span: span.clone(),
                    },
                    span: span.clone(),
                });

                self.push_scope();
                let raw_body = self.lower_block(body)?;
                self.pop_scope();

                let inc_stmt = MIRStmt::StoreLocal {
                    slot: idx_temp.slot,
                    name: idx_temp.name.clone(),
                    is_declaration: false,
                    value: MIRExpr {
                        kind: MIRExprKind::Binary {
                            op: BinaryOp::Add,
                            left: Box::new(MIRExpr {
                                kind: MIRExprKind::LoadLocal {
                                    slot: idx_temp.slot,
                                    name: idx_temp.name.clone(),
                                },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                            right: Box::new(MIRExpr {
                                kind: MIRExprKind::ConstInt { value: 1 },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                        },
                        expr_type: SemanticType::I64,
                        span: span.clone(),
                    },
                    span: span.clone(),
                };

                let mut patched_body = inject_before_continue(&raw_body, &inc_stmt);
                patched_body.push(inc_stmt);

                out.push(MIRStmt::While {
                    condition: MIRExpr {
                        kind: MIRExprKind::Binary {
                            op: BinaryOp::Lt,
                            left: Box::new(MIRExpr {
                                kind: MIRExprKind::LoadLocal {
                                    slot: idx_temp.slot,
                                    name: idx_temp.name,
                                },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                            right: Box::new(MIRExpr {
                                kind: MIRExprKind::LoadLocal {
                                    slot: limit_temp.slot,
                                    name: limit_temp.name,
                                },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                        },
                        expr_type: SemanticType::Bool,
                        span: span.clone(),
                    },
                    body: patched_body,
                    span: span.clone(),
                });
            }

            SemanticStmt::ForInStmt {
                item_name,
                iterable,
                body,
                span,
            } => {
                let iter_expr = self.lower_expr(iterable)?;
                let elem_type = match &iter_expr.expr_type {
                    SemanticType::Array(elem) => (**elem).clone(),
                    _ => SemanticType::Any,
                };
                let arr_temp =
                    self.alloc_temp("for_arr", iter_expr.expr_type.clone(), span.clone());
                let idx_temp = self.alloc_temp("for_idx", SemanticType::I64, span.clone());

                out.push(MIRStmt::StoreLocal {
                    slot: arr_temp.slot,
                    name: arr_temp.name.clone(),
                    is_declaration: true,
                    value: iter_expr.clone(),
                    span: span.clone(),
                });
                out.push(MIRStmt::StoreLocal {
                    slot: idx_temp.slot,
                    name: idx_temp.name.clone(),
                    is_declaration: true,
                    value: MIRExpr {
                        kind: MIRExprKind::ConstInt { value: 0 },
                        expr_type: SemanticType::I64,
                        span: span.clone(),
                    },
                    span: span.clone(),
                });

                self.push_scope();
                let item_slot = self.alloc_local(
                    item_name.clone(),
                    elem_type.clone(),
                    false,
                    false,
                    span.clone(),
                    true,
                );
                let bind_item_stmt = MIRStmt::StoreLocal {
                    slot: item_slot,
                    name: item_name.clone(),
                    is_declaration: true,
                    value: MIRExpr {
                        kind: MIRExprKind::ArrayGet {
                            array: Box::new(MIRExpr {
                                kind: MIRExprKind::LoadLocal {
                                    slot: arr_temp.slot,
                                    name: arr_temp.name.clone(),
                                },
                                expr_type: iter_expr.expr_type.clone(),
                                span: span.clone(),
                            }),
                            index: Box::new(MIRExpr {
                                kind: MIRExprKind::LoadLocal {
                                    slot: idx_temp.slot,
                                    name: idx_temp.name.clone(),
                                },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                        },
                        expr_type: elem_type,
                        span: span.clone(),
                    },
                    span: span.clone(),
                };
                let raw_body = self.lower_block(body)?;
                self.pop_scope();

                let inc_stmt = MIRStmt::StoreLocal {
                    slot: idx_temp.slot,
                    name: idx_temp.name.clone(),
                    is_declaration: false,
                    value: MIRExpr {
                        kind: MIRExprKind::Binary {
                            op: BinaryOp::Add,
                            left: Box::new(MIRExpr {
                                kind: MIRExprKind::LoadLocal {
                                    slot: idx_temp.slot,
                                    name: idx_temp.name.clone(),
                                },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                            right: Box::new(MIRExpr {
                                kind: MIRExprKind::ConstInt { value: 1 },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                        },
                        expr_type: SemanticType::I64,
                        span: span.clone(),
                    },
                    span: span.clone(),
                };

                let mut patched_body = Vec::with_capacity(raw_body.len() + 2);
                patched_body.push(bind_item_stmt);
                patched_body.extend(inject_before_continue(&raw_body, &inc_stmt));
                patched_body.push(inc_stmt);

                out.push(MIRStmt::While {
                    condition: MIRExpr {
                        kind: MIRExprKind::Binary {
                            op: BinaryOp::Lt,
                            left: Box::new(MIRExpr {
                                kind: MIRExprKind::LoadLocal {
                                    slot: idx_temp.slot,
                                    name: idx_temp.name,
                                },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                            right: Box::new(MIRExpr {
                                kind: MIRExprKind::ArrayLen {
                                    target: Box::new(MIRExpr {
                                        kind: MIRExprKind::LoadLocal {
                                            slot: arr_temp.slot,
                                            name: arr_temp.name,
                                        },
                                        expr_type: iter_expr.expr_type,
                                        span: span.clone(),
                                    }),
                                },
                                expr_type: SemanticType::I64,
                                span: span.clone(),
                            }),
                        },
                        expr_type: SemanticType::Bool,
                        span: span.clone(),
                    },
                    body: patched_body,
                    span: span.clone(),
                });
            }

            SemanticStmt::BreakStmt { span } => {
                out.push(MIRStmt::Break { span: span.clone() });
            }

            SemanticStmt::ContinueStmt { span } => {
                out.push(MIRStmt::Continue { span: span.clone() });
            }

            SemanticStmt::ReturnStmt { value, span } => {
                let lowered = match value {
                    Some(v) => Some(self.lower_expr(v)?),
                    None => None,
                };
                out.push(MIRStmt::Return {
                    value: lowered,
                    span: span.clone(),
                });
            }

            SemanticStmt::MatchStmt {
                subject,
                arms,
                span,
            } => {
                let subj = self.lower_expr(subject)?;
                let subj_temp =
                    self.alloc_temp("match_subj", subj.expr_type.clone(), span.clone());
                let mut mir_arms = Vec::with_capacity(arms.len());

                for arm in arms {
                    self.push_scope();
                    let mir_pattern = match &arm.pattern {
                        MatchPattern::WildcardPattern { .. } => MIRMatchPattern::Wildcard,
                        MatchPattern::LiteralPattern { value, .. } => {
                            let pat_lit = match value {
                                LiteralPatValue::Int(n) => {
                                    MIRPatternLiteral::I64(i64::try_from(*n).unwrap_or(0))
                                }
                                LiteralPatValue::Bool(b) => MIRPatternLiteral::Bool(*b),
                                LiteralPatValue::Str(s) => MIRPatternLiteral::Str(s.clone()),
                            };
                            MIRMatchPattern::Literal(pat_lit)
                        }
                        MatchPattern::EnumVariantPattern {
                            enum_name,
                            variant_name,
                            bindings,
                            span: pat_span,
                        } => {
                            let resolved_enum_name = enum_name.clone().unwrap_or_else(|| {
                                match &subj.expr_type {
                                    SemanticType::Enum { name, .. } => name.clone(),
                                    _ => "Result".to_string(),
                                }
                            });
                            let variant_tag = self
                                .enums_by_name
                                .get(&resolved_enum_name)
                                .and_then(|en| {
                                    en.variants
                                        .iter()
                                        .find(|v| v.name == *variant_name)
                                        .map(|v| v.tag)
                                })
                                .unwrap_or(if variant_name == "Err" { 1 } else { 0 });

                            let mut binding_slots = Vec::with_capacity(bindings.len());
                            for (i, b_name) in bindings.iter().enumerate() {
                                let payload_type = match &subj.expr_type {
                                    SemanticType::Enum { variants, .. } => variants
                                        .iter()
                                        .find(|v| v.name == *variant_name)
                                        .and_then(|v| v.payload.get(i).cloned())
                                        .unwrap_or(SemanticType::Any),
                                    SemanticType::Result { ok, err } => {
                                        if variant_name == "Ok" {
                                            (**ok).clone()
                                        } else {
                                            (**err).clone()
                                        }
                                    }
                                    _ => SemanticType::Any,
                                };
                                let b_slot = self.alloc_local(
                                    b_name.clone(),
                                    payload_type,
                                    false,
                                    false,
                                    pat_span.clone(),
                                    true,
                                );
                                binding_slots.push(MIRBindingSlot {
                                    slot: b_slot,
                                    name: b_name.clone(),
                                });
                            }

                            MIRMatchPattern::EnumVariant {
                                enum_name: resolved_enum_name,
                                variant_name: variant_name.clone(),
                                variant_tag,
                                binding_slots,
                            }
                        }
                    };

                    let arm_body = self.lower_block(&arm.body)?;
                    self.pop_scope();
                    mir_arms.push(MIRMatchArm {
                        pattern: mir_pattern,
                        body: arm_body,
                        span: arm.span.clone(),
                    });
                }

                out.push(MIRStmt::Match {
                    subject: subj,
                    temp_slot: subj_temp.slot,
                    arms: mir_arms,
                    span: span.clone(),
                });
            }

            SemanticStmt::TryStmt { span, .. } => {
                return Err(Diagnostic::error_with_hint(
                    "E_UNSUPPORTED_FEATURE",
                    "Unsupported feature: 'try / catch' / 'TRY / IF FAILED' statements are not supported in the Manifest v1.0 IR and runtime pipeline.",
                    span,
                    "Replace 'try / catch' with a function returning 'Result<T, str>' and handle with 'match' or '?'.",
                ));
            }
        }
        Ok(())
    }

    fn lower_expr(&mut self, expr: &SemanticExpr) -> Result<MIRExpr, Diagnostic> {
        let inferred = self.expr_type(expr);
        let span = expr.span.clone();
        let mir_expr = match &expr.kind {
            SemanticExprKind::IntLiteral { value, .. } => {
                let v = value.and_then(|n| i64::try_from(n).ok()).unwrap_or(0);
                MIRExpr {
                    kind: MIRExprKind::ConstInt { value: v },
                    expr_type: SemanticType::I64,
                    span,
                }
            }
            SemanticExprKind::FloatLiteral { value, .. } => MIRExpr {
                kind: MIRExprKind::ConstFloat { value: *value },
                expr_type: SemanticType::F64,
                span,
            },
            SemanticExprKind::BoolLiteral { value } => MIRExpr {
                kind: MIRExprKind::ConstBool { value: *value },
                expr_type: SemanticType::Bool,
                span,
            },
            SemanticExprKind::StringLiteral { value } => MIRExpr {
                kind: MIRExprKind::ConstStr {
                    value: value.clone(),
                },
                expr_type: SemanticType::Str,
                span,
            },
            SemanticExprKind::Identifier { name } => {
                if let Some(loc) = self.lookup_local(name).cloned() {
                    MIRExpr {
                        kind: MIRExprKind::LoadLocal {
                            slot: loc.slot,
                            name: loc.name,
                        },
                        expr_type: loc.local_type,
                        span,
                    }
                } else if let Some(glob) = self.lookup_global(name).cloned() {
                    MIRExpr {
                        kind: MIRExprKind::LoadGlobal {
                            slot: glob.slot,
                            name: glob.name,
                        },
                        expr_type: glob.var_type,
                        span,
                    }
                } else {
                    MIRExpr {
                        kind: MIRExprKind::ConstVoid,
                        expr_type: SemanticType::Void,
                        span,
                    }
                }
            }
            SemanticExprKind::UnaryExpr { op, operand } => {
                let lowered_opd = self.lower_expr(operand)?;
                let out_type = if matches!(inferred, SemanticType::Any) {
                    lowered_opd.expr_type.clone()
                } else {
                    inferred
                };
                MIRExpr {
                    kind: MIRExprKind::Unary {
                        op: *op,
                        operand: Box::new(lowered_opd),
                    },
                    expr_type: out_type,
                    span,
                }
            }
            SemanticExprKind::BinaryExpr { op, left, right } => {
                let l = self.lower_expr(left)?;
                let r = self.lower_expr(right)?;
                MIRExpr {
                    kind: MIRExprKind::Binary {
                        op: *op,
                        left: Box::new(l),
                        right: Box::new(r),
                    },
                    expr_type: inferred,
                    span,
                }
            }
            SemanticExprKind::ArrayLiteral { elements } => {
                let mut lowered = Vec::with_capacity(elements.len());
                for e in elements {
                    lowered.push(self.lower_expr(e)?);
                }
                MIRExpr {
                    kind: MIRExprKind::ArrayNew { elements: lowered },
                    expr_type: inferred,
                    span,
                }
            }
            SemanticExprKind::MapLiteral { entries } => {
                let mut lowered = Vec::with_capacity(entries.len());
                for e in entries {
                    lowered.push(MIRMapEntry {
                        key: self.lower_expr(&e.key)?,
                        value: self.lower_expr(&e.value)?,
                    });
                }
                MIRExpr {
                    kind: MIRExprKind::MapNew { entries: lowered },
                    expr_type: inferred,
                    span,
                }
            }
            SemanticExprKind::IndexAccessExpr { object, index } => {
                let obj = self.lower_expr(object)?;
                let idx = self.lower_expr(index)?;
                if matches!(obj.expr_type, SemanticType::Map { .. }) {
                    MIRExpr {
                        kind: MIRExprKind::MapGet {
                            map: Box::new(obj),
                            key: Box::new(idx),
                        },
                        expr_type: inferred,
                        span,
                    }
                } else {
                    MIRExpr {
                        kind: MIRExprKind::ArrayGet {
                            array: Box::new(obj),
                            index: Box::new(idx),
                        },
                        expr_type: inferred,
                        span,
                    }
                }
            }
            SemanticExprKind::FieldAccessExpr { object, field } => {
                let obj = self.lower_expr(object)?;
                if matches!(obj.expr_type, SemanticType::Array(_)) && field == "length" {
                    return Ok(MIRExpr {
                        kind: MIRExprKind::ArrayLen {
                            target: Box::new(obj),
                        },
                        expr_type: SemanticType::I64,
                        span,
                    });
                }
                let st_name = match &obj.expr_type {
                    SemanticType::Struct { name, .. } => name.clone(),
                    _ => String::new(),
                };
                let field_idx = self
                    .structs_by_name
                    .get(&st_name)
                    .and_then(|st| st.fields.iter().position(|f| f.name == *field))
                    .unwrap_or(0);
                MIRExpr {
                    kind: MIRExprKind::FieldGet {
                        object: Box::new(obj),
                        struct_name: st_name,
                        field_name: field.clone(),
                        field_index: field_idx,
                    },
                    expr_type: inferred,
                    span,
                }
            }
            SemanticExprKind::StructLiteral {
                struct_name,
                fields,
                ..
            } => {
                let Some(st) = self.structs_by_name.get(struct_name) else {
                    return Ok(MIRExpr {
                        kind: MIRExprKind::ConstVoid,
                        expr_type: SemanticType::Void,
                        span,
                    });
                };
                let mut field_map = HashMap::new();
                for f in fields {
                    field_map.insert(f.name.clone(), self.lower_expr(&f.value)?);
                }
                let mut ordered_fields = Vec::with_capacity(st.fields.len());
                for decl_f in &st.fields {
                    ordered_fields.push(field_map.remove(&decl_f.name).unwrap_or_else(|| MIRExpr {
                        kind: MIRExprKind::ConstVoid,
                        expr_type: SemanticType::Void,
                        span: span.clone(),
                    }));
                }
                MIRExpr {
                    kind: MIRExprKind::StructNew {
                        struct_name: st.name.clone(),
                        struct_index: st.index,
                        fields: ordered_fields,
                    },
                    expr_type: inferred,
                    span,
                }
            }
            SemanticExprKind::EnumConstructExpr {
                enum_name,
                variant_name,
                args,
            } => {
                let en = self.enums_by_name.get(enum_name);
                let enum_index = en.map(|e| e.index).unwrap_or(0);
                let variant_tag = en
                    .and_then(|e| {
                        e.variants
                            .iter()
                            .find(|v| v.name == *variant_name)
                            .map(|v| v.tag)
                    })
                    .unwrap_or(0);
                let mut lowered_args = Vec::with_capacity(args.len());
                for a in args {
                    lowered_args.push(self.lower_expr(a)?);
                }
                MIRExpr {
                    kind: MIRExprKind::EnumNew {
                        enum_name: enum_name.clone(),
                        enum_index,
                        variant_name: variant_name.clone(),
                        variant_tag,
                        args: lowered_args,
                    },
                    expr_type: inferred,
                    span,
                }
            }
            SemanticExprKind::CallExpr { callee, args, .. } => {
                let mut lowered_args = Vec::with_capacity(args.len());
                for a in args {
                    lowered_args.push(self.lower_expr(a)?);
                }

                if (callee == "push" || callee == "array.push") && lowered_args.len() == 2 {
                    let value = lowered_args.pop();
                    let array = lowered_args.pop();
                    if let (Some(array), Some(value)) = (array, value) {
                        return Ok(MIRExpr {
                            kind: MIRExprKind::ArrayPush {
                                array: Box::new(array),
                                value: Box::new(value),
                            },
                            expr_type: SemanticType::Void,
                            span,
                        });
                    }
                } else if (callee == "has" || callee == "map.has") && lowered_args.len() == 2 {
                    let key = lowered_args.pop();
                    let map = lowered_args.pop();
                    if let (Some(map), Some(key)) = (map, key) {
                        return Ok(MIRExpr {
                            kind: MIRExprKind::MapHas {
                                map: Box::new(map),
                                key: Box::new(key),
                            },
                            expr_type: SemanticType::Bool,
                            span,
                        });
                    }
                } else if (callee == "len" || callee == "str.len" || callee == "std::str::len")
                    && lowered_args.len() == 1
                {
                    if let Some(target) = lowered_args.pop() {
                        return Ok(MIRExpr {
                            kind: MIRExprKind::ArrayLen {
                                target: Box::new(target),
                            },
                            expr_type: SemanticType::I64,
                            span,
                        });
                    }
                } else if (callee == "to_str" || callee == "std::conv::to_str")
                    && lowered_args.len() == 1
                {
                    if let Some(operand) = lowered_args.pop() {
                        return Ok(MIRExpr {
                            kind: MIRExprKind::Cast {
                                cast_kind: CastKind::ToStr,
                                operand: Box::new(operand),
                            },
                            expr_type: SemanticType::Str,
                            span,
                        });
                    }
                } else if (callee == "to_f64" || callee == "std::conv::to_f64")
                    && lowered_args.len() == 1
                {
                    if let Some(operand) = lowered_args.pop() {
                        return Ok(MIRExpr {
                            kind: MIRExprKind::Cast {
                                cast_kind: CastKind::I64ToF64,
                                operand: Box::new(operand),
                            },
                            expr_type: SemanticType::F64,
                            span,
                        });
                    }
                } else if (callee == "to_i64" || callee == "std::conv::to_i64")
                    && lowered_args.len() == 1
                {
                    if let Some(operand) = lowered_args.pop() {
                        return Ok(MIRExpr {
                            kind: MIRExprKind::Cast {
                                cast_kind: CastKind::F64ToI64,
                                operand: Box::new(operand),
                            },
                            expr_type: SemanticType::I64,
                            span,
                        });
                    }
                } else if callee == "Ok" && lowered_args.len() == 1 {
                    let res_idx = self.enums_by_name.get("Result").map(|e| e.index).unwrap_or(0);
                    return Ok(MIRExpr {
                        kind: MIRExprKind::EnumNew {
                            enum_name: "Result".to_string(),
                            enum_index: res_idx,
                            variant_name: "Ok".to_string(),
                            variant_tag: 0,
                            args: lowered_args,
                        },
                        expr_type: inferred,
                        span,
                    });
                } else if callee == "Err" && lowered_args.len() == 1 {
                    let res_idx = self.enums_by_name.get("Result").map(|e| e.index).unwrap_or(0);
                    return Ok(MIRExpr {
                        kind: MIRExprKind::EnumNew {
                            enum_name: "Result".to_string(),
                            enum_index: res_idx,
                            variant_name: "Err".to_string(),
                            variant_tag: 1,
                            args: lowered_args,
                        },
                        expr_type: inferred,
                        span,
                    });
                } else if let Some(std_spec) = lookup_std_intrinsic(callee) {
                    return Ok(MIRExpr {
                        kind: MIRExprKind::CallIntrinsic {
                            symbol: std_spec.symbol.to_string(),
                            capability: std_spec.capability.to_string(),
                            args: lowered_args,
                        },
                        expr_type: intrinsic_return_type(std_spec),
                        span,
                    });
                }

                let ret_type = self
                    .fn_return_types
                    .get(callee)
                    .cloned()
                    .unwrap_or(inferred);
                MIRExpr {
                    kind: MIRExprKind::CallFunction {
                        callee: callee.clone(),
                        args: lowered_args,
                    },
                    expr_type: ret_type,
                    span,
                }
            }
            SemanticExprKind::AwaitExpr { operand } => self.lower_expr(operand)?,
            SemanticExprKind::TryPropagateExpr { operand } => {
                let opd = self.lower_expr(operand)?;
                MIRExpr {
                    kind: MIRExprKind::TryPropagate {
                        operand: Box::new(opd),
                    },
                    expr_type: inferred,
                    span,
                }
            }
        };
        Ok(mir_expr)
    }
}

fn inject_before_continue(stmts: &[MIRStmt], inc_stmt: &MIRStmt) -> Vec<MIRStmt> {
    let mut out = Vec::new();
    for s in stmts {
        match s {
            MIRStmt::Continue { .. } => {
                out.push(inc_stmt.clone());
                out.push(s.clone());
            }
            MIRStmt::If {
                condition,
                then_branch,
                else_branch,
                span,
            } => {
                out.push(MIRStmt::If {
                    condition: condition.clone(),
                    then_branch: inject_before_continue(then_branch, inc_stmt),
                    else_branch: inject_before_continue(else_branch, inc_stmt),
                    span: span.clone(),
                });
            }
            MIRStmt::Match {
                subject,
                temp_slot,
                arms,
                span,
            } => {
                let new_arms = arms
                    .iter()
                    .map(|a| MIRMatchArm {
                        pattern: a.pattern.clone(),
                        body: inject_before_continue(&a.body, inc_stmt),
                        span: a.span.clone(),
                    })
                    .collect();
                out.push(MIRStmt::Match {
                    subject: subject.clone(),
                    temp_slot: *temp_slot,
                    arms: new_arms,
                    span: span.clone(),
                });
            }
            // Do NOT rewrite `continue` inside nested `While` loops!
            _ => out.push(s.clone()),
        }
    }
    out
}

fn stmts_contain_call_to_main(stmts: &[SemanticStmt]) -> bool {
    for s in stmts {
        match s {
            SemanticStmt::ExprStmt { expr, .. } => {
                if matches!(&expr.kind, SemanticExprKind::CallExpr { callee, .. } if callee == "main")
                {
                    return true;
                }
            }
            SemanticStmt::VarStmt { decl, .. } => {
                if matches!(&decl.init.kind, SemanticExprKind::CallExpr { callee, .. } if callee == "main")
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn ensure_trailing_return(body: &mut Vec<MIRStmt>, return_type: &SemanticType, span: &SourceSpan) {
    if matches!(body.last(), Some(MIRStmt::Return { .. })) {
        return;
    }
    if matches!(return_type, SemanticType::Void | SemanticType::Any) {
        body.push(MIRStmt::Return {
            value: None,
            span: span.clone(),
        });
    }
}

pub fn build_typed_ir(
    module: &SemanticModule,
    type_check: &TypeCheckResult,
    capability_audit: &CapabilityAuditReport,
) -> Result<MIRModule, Diagnostic> {
    if let Some(tr) = module.traits.first() {
        return Err(Diagnostic::error_with_hint(
            "E_UNSUPPORTED_FEATURE",
            format!(
                "Unsupported feature: 'trait' declaration '{}' cannot be lowered into Typed MIR (trait dispatch is not implemented in v1.0).",
                tr.name
            ),
            &tr.span,
            format!(
                "Replace 'trait {}' with concrete 'struct' types and typed functions.",
                tr.name
            ),
        ));
    }

    let mut structs = Vec::new();
    let mut structs_by_name = HashMap::new();
    for st in &module.structs {
        let sem = type_check.structs.get(&st.name);
        let fields = match sem {
            Some(SemanticType::Struct { fields, .. }) => fields
                .iter()
                .enumerate()
                .map(|(idx, f)| MIRStructField {
                    name: f.name.clone(),
                    index: idx,
                    field_type: f.field_type.clone(),
                })
                .collect(),
            _ => st
                .fields
                .iter()
                .enumerate()
                .map(|(idx, f)| MIRStructField {
                    name: f.name.clone(),
                    index: idx,
                    field_type: SemanticType::Any,
                })
                .collect(),
        };
        let mir_st = MIRStruct {
            name: st.name.clone(),
            index: structs.len(),
            exported: st.exported,
            fields,
        };
        structs_by_name.insert(st.name.clone(), mir_st.clone());
        structs.push(mir_st);
    }

    let mut enums = Vec::new();
    let mut enums_by_name = HashMap::new();

    // Always register built-in Result<T, E> enum at index 0
    let result_enum = MIREnum {
        name: "Result".to_string(),
        index: 0,
        exported: false,
        variants: vec![
            MIREnumVariant {
                name: "Ok".to_string(),
                tag: 0,
                payload_types: vec![SemanticType::Any],
            },
            MIREnumVariant {
                name: "Err".to_string(),
                tag: 1,
                payload_types: vec![SemanticType::Any],
            },
        ],
    };
    enums_by_name.insert("Result".to_string(), result_enum.clone());
    enums.push(result_enum);

    for en in &module.enums {
        if en.name == "Result" {
            continue;
        }
        let sem = type_check.enums.get(&en.name);
        let variants = match sem {
            Some(SemanticType::Enum { variants, .. }) => variants
                .iter()
                .map(|v| MIREnumVariant {
                    name: v.name.clone(),
                    tag: v.tag,
                    payload_types: v.payload.clone(),
                })
                .collect(),
            _ => en
                .variants
                .iter()
                .enumerate()
                .map(|(idx, v)| MIREnumVariant {
                    name: v.name.clone(),
                    tag: idx,
                    payload_types: vec![SemanticType::Any; v.payload_types.len()],
                })
                .collect(),
        };
        let mir_en = MIREnum {
            name: en.name.clone(),
            index: enums.len(),
            exported: en.exported,
            variants,
        };
        enums_by_name.insert(en.name.clone(), mir_en.clone());
        enums.push(mir_en);
    }

    let mut fn_return_types = HashMap::new();
    for (name, sig) in &type_check.functions {
        fn_return_types.insert(name.clone(), sig.return_type.clone());
    }

    let mut fn_effects_map = HashMap::new();
    for fa in &capability_audit.functions {
        fn_effects_map.insert(fa.name.clone(), fa.inferred_effects.clone());
    }

    // Lower module-level constants & globals sequentially
    let mut globals = Vec::new();
    let mut globals_by_name = HashMap::new();
    let mut init_body = Vec::new();

    let mut init_locals = Vec::new();
    let mut synth_init_counter = 0usize;

    for c in &module.constants {
        let mut init_ctx = FunctionLoweringContext::new(
            "__init__",
            &globals_by_name,
            &structs_by_name,
            &enums_by_name,
            &fn_return_types,
            &type_check.expr_types,
        );
        init_ctx.locals = init_locals;
        init_ctx.synth_counter = synth_init_counter;

        let init_expr = init_ctx.lower_expr(&c.init)?;
        init_locals = init_ctx.locals;
        synth_init_counter = init_ctx.synth_counter;

        let slot = globals.len();
        let g = MIRGlobal {
            name: c.name.clone(),
            slot,
            mutable: false,
            is_const: true,
            exported: c.exported,
            var_type: init_expr.expr_type.clone(),
            init: init_expr.clone(),
            span: c.span.clone(),
        };
        globals.push(g.clone());
        globals_by_name.insert(c.name.clone(), g);
        init_body.push(MIRStmt::StoreGlobal {
            slot,
            name: c.name.clone(),
            value: init_expr,
            span: c.span.clone(),
        });
    }

    for gv in &module.globals {
        let mut init_ctx = FunctionLoweringContext::new(
            "__init__",
            &globals_by_name,
            &structs_by_name,
            &enums_by_name,
            &fn_return_types,
            &type_check.expr_types,
        );
        init_ctx.locals = init_locals;
        init_ctx.synth_counter = synth_init_counter;

        let init_expr = init_ctx.lower_expr(&gv.init)?;
        init_locals = init_ctx.locals;
        synth_init_counter = init_ctx.synth_counter;

        let slot = globals.len();
        let g = MIRGlobal {
            name: gv.name.clone(),
            slot,
            mutable: true,
            is_const: false,
            exported: gv.exported,
            var_type: init_expr.expr_type.clone(),
            init: init_expr.clone(),
            span: gv.span.clone(),
        };
        globals.push(g.clone());
        globals_by_name.insert(gv.name.clone(), g);
        let in_top_level = module
            .top_level_stmts
            .iter()
            .any(|s| matches!(s, SemanticStmt::VarStmt { decl, .. } if decl.name == gv.name));
        if !in_top_level {
            init_body.push(MIRStmt::StoreGlobal {
                slot,
                name: gv.name.clone(),
                value: init_expr,
                span: gv.span.clone(),
            });
        }
    }

    let mut functions = Vec::new();
    let has_user_main = module.functions.iter().any(|f| f.name == "main");
    let has_top_level = !module.top_level_stmts.is_empty();
    let top_calls_main = has_top_level && stmts_contain_call_to_main(&module.top_level_stmts);
    let run_top_level_in_init = has_top_level && has_user_main && !top_calls_main;

    if run_top_level_in_init {
        let mut init_ctx = FunctionLoweringContext::new(
            "__init__",
            &globals_by_name,
            &structs_by_name,
            &enums_by_name,
            &fn_return_types,
            &type_check.expr_types,
        );
        init_ctx.locals = init_locals;
        init_ctx.synth_counter = synth_init_counter;

        let top_mir = init_ctx.lower_block(&module.top_level_stmts)?;
        init_body.extend(top_mir);
        init_locals = init_ctx.locals;
    }

    if !init_body.is_empty() {
        init_body.push(MIRStmt::Return {
            value: None,
            span: module.span.clone(),
        });
        functions.push(MIRFunction {
            name: "__init__".to_string(),
            exported: false,
            is_async: false,
            is_entry: false,
            is_synthetic: true,
            params: Vec::new(),
            locals: init_locals,
            return_type: SemanticType::Void,
            effects: capability_audit.inferred_module_effects.clone(),
            body: init_body.clone(),
            span: module.span.clone(),
        });
    }

    let mut entry_function: Option<String> = None;

    for fn_decl in &module.functions {
        let is_entry =
            fn_decl.name == "main" && (!has_top_level || run_top_level_in_init || !top_calls_main);
        if is_entry {
            entry_function = Some("main".to_string());
        }

        let sig = type_check.functions.get(&fn_decl.name);
        let ret_type = sig
            .map(|s| s.return_type.clone())
            .unwrap_or(SemanticType::Void);

        let mut ctx = FunctionLoweringContext::new(
            fn_decl.name.clone(),
            &globals_by_name,
            &structs_by_name,
            &enums_by_name,
            &fn_return_types,
            &type_check.expr_types,
        );

        let mut params = Vec::with_capacity(fn_decl.params.len());
        for (i, p) in fn_decl.params.iter().enumerate() {
            let p_type = sig
                .and_then(|s| s.params.get(i).map(|(_, t)| t.clone()))
                .unwrap_or(SemanticType::Any);
            let slot = ctx.alloc_local(p.name.clone(), p_type, false, true, p.span.clone(), true);
            params.push(ctx.locals[slot].clone());
        }

        let mut body = ctx.lower_block(&fn_decl.body)?;
        ensure_trailing_return(&mut body, &ret_type, &fn_decl.span);

        functions.push(MIRFunction {
            name: fn_decl.name.clone(),
            exported: fn_decl.exported || fn_decl.name == "main",
            is_async: fn_decl.is_async,
            is_entry,
            is_synthetic: false,
            params,
            locals: ctx.locals,
            return_type: ret_type,
            effects: fn_effects_map
                .get(&fn_decl.name)
                .cloned()
                .unwrap_or_default(),
            body,
            span: fn_decl.span.clone(),
        });
    }

    if has_top_level && !run_top_level_in_init {
        let mut script_ctx = FunctionLoweringContext::new(
            "__script__",
            &globals_by_name,
            &structs_by_name,
            &enums_by_name,
            &fn_return_types,
            &type_check.expr_types,
        );
        let mut script_body = script_ctx.lower_block(&module.top_level_stmts)?;

        if has_user_main && !top_calls_main {
            let main_ret = fn_return_types
                .get("main")
                .cloned()
                .unwrap_or(SemanticType::Void);
            if matches!(main_ret, SemanticType::Void) {
                script_body.push(MIRStmt::ExprStmt {
                    expr: MIRExpr {
                        kind: MIRExprKind::CallFunction {
                            callee: "main".to_string(),
                            args: Vec::new(),
                        },
                        expr_type: SemanticType::Void,
                        span: module.span.clone(),
                    },
                    span: module.span.clone(),
                });
                ensure_trailing_return(&mut script_body, &SemanticType::Void, &module.span);
            } else {
                script_body.push(MIRStmt::Return {
                    value: Some(MIRExpr {
                        kind: MIRExprKind::CallFunction {
                            callee: "main".to_string(),
                            args: Vec::new(),
                        },
                        expr_type: main_ret,
                        span: module.span.clone(),
                    }),
                    span: module.span.clone(),
                });
            }
            for f in &mut functions {
                if f.name == "main" {
                    f.is_entry = false;
                }
            }
        } else {
            ensure_trailing_return(&mut script_body, &SemanticType::Void, &module.span);
        }

        entry_function = Some("__script__".to_string());
        functions.push(MIRFunction {
            name: "__script__".to_string(),
            exported: false,
            is_async: false,
            is_entry: true,
            is_synthetic: true,
            params: Vec::new(),
            locals: script_ctx.locals,
            return_type: SemanticType::Any,
            effects: capability_audit.inferred_module_effects.clone(),
            body: script_body,
            span: module.span.clone(),
        });
    } else if entry_function.is_none() && !functions.is_empty() && !init_body.is_empty() {
        functions[0].is_entry = true;
        entry_function = Some(functions[0].name.clone());
    }

    let mut explicit_reqs = capability_audit.declared_requires.clone();
    for eff in &capability_audit.inferred_module_effects {
        let denied = capability_audit
            .declared_denies
            .iter()
            .any(|d| eff == d || eff.starts_with(&format!("{d}.")));
        if !denied && !explicit_reqs.contains(eff) {
            explicit_reqs.push(eff.clone());
        }
    }

    Ok(MIRModule {
        module_name: module.module_name.clone(),
        source_profile: module.profile,
        requires: explicit_reqs,
        provides: capability_audit.declared_provides.clone(),
        denies: capability_audit.declared_denies.clone(),
        structs,
        enums,
        globals,
        functions,
        entry_function,
    })
}

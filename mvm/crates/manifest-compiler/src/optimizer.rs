use std::collections::{HashMap, HashSet};

use crate::ast::{BinaryOp, UnaryOp};
use crate::diagnostic::Diagnostic;
use crate::json::JsonValue;
use crate::mir::*;
use crate::types::SemanticType;

#[derive(Debug, Clone, Default)]
pub struct OptimizationPassStats {
    pub constants_folded: usize,
    pub algebraic_simplifications: usize,
    pub unreachable_stmts_removed: usize,
    pub dead_locals_eliminated: usize,
    pub dead_functions_eliminated: usize,
}

impl OptimizationPassStats {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::Object(vec![
            (
                "constantsFolded".to_string(),
                JsonValue::Number(self.constants_folded as f64),
            ),
            (
                "algebraicSimplifications".to_string(),
                JsonValue::Number(self.algebraic_simplifications as f64),
            ),
            (
                "unreachableStmtsRemoved".to_string(),
                JsonValue::Number(self.unreachable_stmts_removed as f64),
            ),
            (
                "deadLocalsEliminated".to_string(),
                JsonValue::Number(self.dead_locals_eliminated as f64),
            ),
            (
                "deadFunctionsEliminated".to_string(),
                JsonValue::Number(self.dead_functions_eliminated as f64),
            ),
        ])
    }
}

pub struct OptimizationResult {
    pub module: MIRModule,
    pub stats: OptimizationPassStats,
    pub warnings: Vec<Diagnostic>,
}

pub fn optimize_mir(input: &MIRModule) -> OptimizationResult {
    let mut stats = OptimizationPassStats::default();
    let mut warnings = Vec::new();

    let opt_globals: Vec<MIRGlobal> = input
        .globals
        .iter()
        .map(|g| MIRGlobal {
            name: g.name.clone(),
            slot: g.slot,
            mutable: g.mutable,
            is_const: g.is_const,
            exported: g.exported,
            var_type: g.var_type.clone(),
            init: optimize_expr(&g.init, &mut stats),
            span: g.span.clone(),
        })
        .collect();

    let opt_functions: Vec<MIRFunction> = input
        .functions
        .iter()
        .map(|f| optimize_function(f, &mut stats, &mut warnings))
        .collect();

    let reachable_fns = compute_reachable_functions(&opt_functions, input.entry_function.as_deref());
    let mut kept_functions = Vec::with_capacity(opt_functions.len());
    for fn_d in opt_functions {
        if fn_d.exported
            || fn_d.is_entry
            || fn_d.name == "__init__"
            || fn_d.name == "__script__"
            || reachable_fns.contains(&fn_d.name)
        {
            kept_functions.push(fn_d);
        } else {
            stats.dead_functions_eliminated += 1;
        }
    }

    OptimizationResult {
        module: MIRModule {
            module_name: input.module_name.clone(),
            source_profile: input.source_profile,
            requires: input.requires.clone(),
            provides: input.provides.clone(),
            denies: input.denies.clone(),
            structs: input.structs.clone(),
            enums: input.enums.clone(),
            globals: opt_globals,
            functions: kept_functions,
            entry_function: input.entry_function.clone(),
        },
        stats,
        warnings,
    }
}

fn optimize_function(
    fn_d: &MIRFunction,
    stats: &mut OptimizationPassStats,
    warnings: &mut Vec<Diagnostic>,
) -> MIRFunction {
    let body = optimize_block(&fn_d.body, stats, warnings);

    let mut reads = HashMap::new();
    let mut writes = HashMap::new();
    count_slot_usage_in_block(&body, &mut reads, &mut writes);

    let cleaned_body = eliminate_dead_stores_in_block(&body, &reads, &writes, stats);

    MIRFunction {
        name: fn_d.name.clone(),
        exported: fn_d.exported,
        is_async: fn_d.is_async,
        is_entry: fn_d.is_entry,
        is_synthetic: fn_d.is_synthetic,
        params: fn_d.params.clone(),
        locals: fn_d.locals.clone(),
        return_type: fn_d.return_type.clone(),
        effects: fn_d.effects.clone(),
        body: cleaned_body,
        span: fn_d.span.clone(),
    }
}

fn is_terminator(stmt: &MIRStmt) -> bool {
    matches!(
        stmt,
        MIRStmt::Return { .. } | MIRStmt::Break { .. } | MIRStmt::Continue { .. }
    )
}

fn block_always_terminates(stmts: &[MIRStmt]) -> bool {
    let Some(last) = stmts.last() else {
        return false;
    };
    if is_terminator(last) {
        return true;
    }
    if let MIRStmt::If {
        then_branch,
        else_branch,
        ..
    } = last
    {
        return block_always_terminates(then_branch) && block_always_terminates(else_branch);
    }
    false
}

fn stmt_span(stmt: &MIRStmt) -> &crate::diagnostic::SourceSpan {
    match stmt {
        MIRStmt::StoreLocal { span, .. }
        | MIRStmt::StoreGlobal { span, .. }
        | MIRStmt::ArraySet { span, .. }
        | MIRStmt::MapSetStmt { span, .. }
        | MIRStmt::FieldSet { span, .. }
        | MIRStmt::ExprStmt { span, .. }
        | MIRStmt::If { span, .. }
        | MIRStmt::While { span, .. }
        | MIRStmt::Break { span }
        | MIRStmt::Continue { span }
        | MIRStmt::Return { span, .. }
        | MIRStmt::Match { span, .. } => span,
    }
}

fn optimize_block(
    stmts: &[MIRStmt],
    stats: &mut OptimizationPassStats,
    warnings: &mut Vec<Diagnostic>,
) -> Vec<MIRStmt> {
    let mut out = Vec::new();
    let mut terminated = false;
    let mut warned_unreachable = false;

    for stmt in stmts {
        if terminated {
            stats.unreachable_stmts_removed += 1;
            if !warned_unreachable {
                let is_synthetic_trailing_void_ret =
                    matches!(stmt, MIRStmt::Return { value: None, .. });
                if !is_synthetic_trailing_void_ret {
                    warned_unreachable = true;
                    warnings.push(Diagnostic::warning(
                        "W_UNREACHABLE_CODE",
                        "Unreachable statement after control-flow terminator",
                        stmt_span(stmt),
                    ));
                }
            }
            continue;
        }

        match stmt {
            MIRStmt::StoreLocal {
                slot,
                name,
                is_declaration,
                value,
                span,
            } => {
                out.push(MIRStmt::StoreLocal {
                    slot: *slot,
                    name: name.clone(),
                    is_declaration: *is_declaration,
                    value: optimize_expr(value, stats),
                    span: span.clone(),
                });
            }
            MIRStmt::StoreGlobal {
                slot,
                name,
                value,
                span,
            } => {
                out.push(MIRStmt::StoreGlobal {
                    slot: *slot,
                    name: name.clone(),
                    value: optimize_expr(value, stats),
                    span: span.clone(),
                });
            }
            MIRStmt::ArraySet {
                array,
                index,
                value,
                span,
            } => {
                out.push(MIRStmt::ArraySet {
                    array: optimize_expr(array, stats),
                    index: optimize_expr(index, stats),
                    value: optimize_expr(value, stats),
                    span: span.clone(),
                });
            }
            MIRStmt::MapSetStmt {
                map,
                key,
                value,
                span,
            } => {
                out.push(MIRStmt::MapSetStmt {
                    map: optimize_expr(map, stats),
                    key: optimize_expr(key, stats),
                    value: optimize_expr(value, stats),
                    span: span.clone(),
                });
            }
            MIRStmt::FieldSet {
                object,
                struct_name,
                field_name,
                field_index,
                value,
                span,
            } => {
                out.push(MIRStmt::FieldSet {
                    object: optimize_expr(object, stats),
                    struct_name: struct_name.clone(),
                    field_name: field_name.clone(),
                    field_index: *field_index,
                    value: optimize_expr(value, stats),
                    span: span.clone(),
                });
            }
            MIRStmt::ExprStmt { expr, span } => {
                let opt_e = optimize_expr(expr, stats);
                if is_pure_mir_expr(&opt_e) {
                    stats.dead_locals_eliminated += 1;
                } else {
                    out.push(MIRStmt::ExprStmt {
                        expr: opt_e,
                        span: span.clone(),
                    });
                }
            }
            MIRStmt::If {
                condition,
                then_branch,
                else_branch,
                span,
            } => {
                let cond = optimize_expr(condition, stats);
                let opt_then = optimize_block(then_branch, stats, warnings);
                let opt_else = optimize_block(else_branch, stats, warnings);

                if let MIRExprKind::ConstBool { value: cond_val } = cond.kind {
                    stats.constants_folded += 1;
                    let (chosen, discarded) = if cond_val {
                        (opt_then, opt_else)
                    } else {
                        (opt_else, opt_then)
                    };
                    stats.unreachable_stmts_removed += discarded.len();
                    for s in chosen {
                        let term = is_terminator(&s);
                        out.push(s);
                        if term {
                            terminated = true;
                            break;
                        }
                    }
                } else {
                    let both_term = !opt_then.is_empty()
                        && !opt_else.is_empty()
                        && block_always_terminates(&opt_then)
                        && block_always_terminates(&opt_else);
                    out.push(MIRStmt::If {
                        condition: cond,
                        then_branch: opt_then,
                        else_branch: opt_else,
                        span: span.clone(),
                    });
                    if both_term {
                        terminated = true;
                    }
                }
            }
            MIRStmt::While {
                condition,
                body,
                span,
            } => {
                let cond = optimize_expr(condition, stats);
                if matches!(cond.kind, MIRExprKind::ConstBool { value: false }) {
                    stats.constants_folded += 1;
                    stats.unreachable_stmts_removed += body.len();
                    continue;
                }
                let opt_body = optimize_block(body, stats, warnings);
                out.push(MIRStmt::While {
                    condition: cond,
                    body: opt_body,
                    span: span.clone(),
                });
            }
            MIRStmt::Match {
                subject,
                temp_slot,
                arms,
                span,
            } => {
                let subj = optimize_expr(subject, stats);
                let opt_arms = arms
                    .iter()
                    .map(|a| MIRMatchArm {
                        pattern: a.pattern.clone(),
                        body: optimize_block(&a.body, stats, warnings),
                        span: a.span.clone(),
                    })
                    .collect();
                out.push(MIRStmt::Match {
                    subject: subj,
                    temp_slot: *temp_slot,
                    arms: opt_arms,
                    span: span.clone(),
                });
            }
            MIRStmt::Return { value, span } => {
                out.push(MIRStmt::Return {
                    value: value.as_ref().map(|v| optimize_expr(v, stats)),
                    span: span.clone(),
                });
                terminated = true;
            }
            MIRStmt::Break { .. } | MIRStmt::Continue { .. } => {
                out.push(stmt.clone());
                terminated = true;
            }
        }
    }

    out
}

fn optimize_expr(expr: &MIRExpr, stats: &mut OptimizationPassStats) -> MIRExpr {
    let span = expr.span.clone();
    let expr_type = expr.expr_type.clone();

    match &expr.kind {
        MIRExprKind::ConstInt { .. }
        | MIRExprKind::ConstFloat { .. }
        | MIRExprKind::ConstBool { .. }
        | MIRExprKind::ConstStr { .. }
        | MIRExprKind::ConstVoid
        | MIRExprKind::LoadLocal { .. }
        | MIRExprKind::LoadGlobal { .. } => expr.clone(),

        MIRExprKind::Unary { op, operand } => {
            let opd = optimize_expr(operand, stats);
            if *op == UnaryOp::Neg {
                if let MIRExprKind::ConstInt { value } = opd.kind {
                    if let Some(neg) = value.checked_neg() {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstInt { value: neg },
                            expr_type: SemanticType::I64,
                            span,
                        };
                    }
                }
                if let MIRExprKind::ConstFloat { value } = opd.kind {
                    stats.constants_folded += 1;
                    return MIRExpr {
                        kind: MIRExprKind::ConstFloat { value: -value },
                        expr_type: SemanticType::F64,
                        span,
                    };
                }
            }
            if *op == UnaryOp::Not {
                if let MIRExprKind::ConstBool { value } = opd.kind {
                    stats.constants_folded += 1;
                    return MIRExpr {
                        kind: MIRExprKind::ConstBool { value: !value },
                        expr_type: SemanticType::Bool,
                        span,
                    };
                }
                if let MIRExprKind::Unary {
                    op: UnaryOp::Not,
                    operand: inner,
                } = &opd.kind
                {
                    stats.algebraic_simplifications += 1;
                    return (**inner).clone();
                }
            }
            MIRExpr {
                kind: MIRExprKind::Unary {
                    op: *op,
                    operand: Box::new(opd),
                },
                expr_type,
                span,
            }
        }

        MIRExprKind::Cast { cast_kind, operand } => {
            let opd = optimize_expr(operand, stats);
            match cast_kind {
                CastKind::I64ToF64 => {
                    if let MIRExprKind::ConstInt { value } = opd.kind {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstFloat {
                                value: value as f64,
                            },
                            expr_type: SemanticType::F64,
                            span,
                        };
                    }
                }
                CastKind::ToStr => match &opd.kind {
                    MIRExprKind::ConstInt { value } => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstStr {
                                value: value.to_string(),
                            },
                            expr_type: SemanticType::Str,
                            span,
                        };
                    }
                    MIRExprKind::ConstBool { value } => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstStr {
                                value: if *value { "true" } else { "false" }.to_string(),
                            },
                            expr_type: SemanticType::Str,
                            span,
                        };
                    }
                    MIRExprKind::ConstStr { .. } => {
                        stats.algebraic_simplifications += 1;
                        return opd;
                    }
                    _ => {}
                },
                CastKind::F64ToI64 => {
                    // Never fold F64ToI64 statically so invalid conversions trap identically on MVM.
                }
            }
            MIRExpr {
                kind: MIRExprKind::Cast {
                    cast_kind: *cast_kind,
                    operand: Box::new(opd),
                },
                expr_type,
                span,
            }
        }

        MIRExprKind::Binary { op, left, right } => {
            let l = optimize_expr(left, stats);
            let r = optimize_expr(right, stats);

            if let (MIRExprKind::ConstInt { value: a }, MIRExprKind::ConstInt { value: b }) =
                (&l.kind, &r.kind)
            {
                let a = *a;
                let b = *b;
                match op {
                    BinaryOp::Add => {
                        if let Some(res) = a.checked_add(b) {
                            stats.constants_folded += 1;
                            return MIRExpr {
                                kind: MIRExprKind::ConstInt { value: res },
                                expr_type: SemanticType::I64,
                                span,
                            };
                        }
                    }
                    BinaryOp::Sub => {
                        if let Some(res) = a.checked_sub(b) {
                            stats.constants_folded += 1;
                            return MIRExpr {
                                kind: MIRExprKind::ConstInt { value: res },
                                expr_type: SemanticType::I64,
                                span,
                            };
                        }
                    }
                    BinaryOp::Mul => {
                        if let Some(res) = a.checked_mul(b) {
                            stats.constants_folded += 1;
                            return MIRExpr {
                                kind: MIRExprKind::ConstInt { value: res },
                                expr_type: SemanticType::I64,
                                span,
                            };
                        }
                    }
                    BinaryOp::Div => {
                        if b != 0 && !(a == i64::MIN && b == -1) {
                            stats.constants_folded += 1;
                            return MIRExpr {
                                kind: MIRExprKind::ConstInt { value: a / b },
                                expr_type: SemanticType::I64,
                                span,
                            };
                        }
                    }
                    BinaryOp::Mod => {
                        if b != 0 && !(a == i64::MIN && b == -1) {
                            stats.constants_folded += 1;
                            return MIRExpr {
                                kind: MIRExprKind::ConstInt { value: a % b },
                                expr_type: SemanticType::I64,
                                span,
                            };
                        }
                    }
                    BinaryOp::Eq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a == b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Neq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a != b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Lt => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a < b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Lte => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a <= b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Gt => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a > b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Gte => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a >= b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    _ => {}
                }
            }

            if let (MIRExprKind::ConstFloat { value: a }, MIRExprKind::ConstFloat { value: b }) =
                (&l.kind, &r.kind)
            {
                let a = *a;
                let b = *b;
                match op {
                    BinaryOp::Add => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstFloat { value: a + b },
                            expr_type: SemanticType::F64,
                            span,
                        };
                    }
                    BinaryOp::Sub => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstFloat { value: a - b },
                            expr_type: SemanticType::F64,
                            span,
                        };
                    }
                    BinaryOp::Mul => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstFloat { value: a * b },
                            expr_type: SemanticType::F64,
                            span,
                        };
                    }
                    BinaryOp::Div => {
                        if b != 0.0 {
                            stats.constants_folded += 1;
                            return MIRExpr {
                                kind: MIRExprKind::ConstFloat { value: a / b },
                                expr_type: SemanticType::F64,
                                span,
                            };
                        }
                    }
                    BinaryOp::Eq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a == b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Neq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a != b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Lt => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a < b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Lte => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a <= b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Gt => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a > b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Gte => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a >= b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    _ => {}
                }
            }

            if let (MIRExprKind::ConstStr { value: a }, MIRExprKind::ConstStr { value: b }) =
                (&l.kind, &r.kind)
            {
                match op {
                    BinaryOp::Add => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstStr {
                                value: format!("{a}{b}"),
                            },
                            expr_type: SemanticType::Str,
                            span,
                        };
                    }
                    BinaryOp::Eq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a == b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Neq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a != b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    _ => {}
                }
            }

            if let (MIRExprKind::ConstBool { value: a }, MIRExprKind::ConstBool { value: b }) =
                (&l.kind, &r.kind)
            {
                match op {
                    BinaryOp::And => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: *a && *b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Or => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: *a || *b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Eq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a == b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    BinaryOp::Neq => {
                        stats.constants_folded += 1;
                        return MIRExpr {
                            kind: MIRExprKind::ConstBool { value: a != b },
                            expr_type: SemanticType::Bool,
                            span,
                        };
                    }
                    _ => {}
                }
            }

            // Algebraic simplifications
            if *op == BinaryOp::Add && matches!(r.kind, MIRExprKind::ConstInt { value: 0 }) {
                stats.algebraic_simplifications += 1;
                return l;
            }
            if *op == BinaryOp::Add && matches!(l.kind, MIRExprKind::ConstInt { value: 0 }) {
                stats.algebraic_simplifications += 1;
                return r;
            }
            if *op == BinaryOp::Sub && matches!(r.kind, MIRExprKind::ConstInt { value: 0 }) {
                stats.algebraic_simplifications += 1;
                return l;
            }
            if *op == BinaryOp::Mul && matches!(r.kind, MIRExprKind::ConstInt { value: 1 }) {
                stats.algebraic_simplifications += 1;
                return l;
            }
            if *op == BinaryOp::Mul && matches!(l.kind, MIRExprKind::ConstInt { value: 1 }) {
                stats.algebraic_simplifications += 1;
                return r;
            }
            if *op == BinaryOp::Div && matches!(r.kind, MIRExprKind::ConstInt { value: 1 }) {
                stats.algebraic_simplifications += 1;
                return l;
            }
            if *op == BinaryOp::Add && matches!(&r.kind, MIRExprKind::ConstStr { value } if value.is_empty())
            {
                stats.algebraic_simplifications += 1;
                return l;
            }
            if *op == BinaryOp::Add && matches!(&l.kind, MIRExprKind::ConstStr { value } if value.is_empty())
            {
                stats.algebraic_simplifications += 1;
                return r;
            }
            if *op == BinaryOp::And && matches!(l.kind, MIRExprKind::ConstBool { value: true }) {
                stats.algebraic_simplifications += 1;
                return r;
            }
            if *op == BinaryOp::And && matches!(l.kind, MIRExprKind::ConstBool { value: false }) {
                stats.algebraic_simplifications += 1;
                return MIRExpr {
                    kind: MIRExprKind::ConstBool { value: false },
                    expr_type: SemanticType::Bool,
                    span,
                };
            }
            if *op == BinaryOp::Or && matches!(l.kind, MIRExprKind::ConstBool { value: false }) {
                stats.algebraic_simplifications += 1;
                return r;
            }
            if *op == BinaryOp::Or && matches!(l.kind, MIRExprKind::ConstBool { value: true }) {
                stats.algebraic_simplifications += 1;
                return MIRExpr {
                    kind: MIRExprKind::ConstBool { value: true },
                    expr_type: SemanticType::Bool,
                    span,
                };
            }

            MIRExpr {
                kind: MIRExprKind::Binary {
                    op: *op,
                    left: Box::new(l),
                    right: Box::new(r),
                },
                expr_type,
                span,
            }
        }

        MIRExprKind::CallFunction { callee, args } => MIRExpr {
            kind: MIRExprKind::CallFunction {
                callee: callee.clone(),
                args: args.iter().map(|a| optimize_expr(a, stats)).collect(),
            },
            expr_type,
            span,
        },
        MIRExprKind::CallIntrinsic {
            symbol,
            capability,
            args,
        } => MIRExpr {
            kind: MIRExprKind::CallIntrinsic {
                symbol: symbol.clone(),
                capability: capability.clone(),
                args: args.iter().map(|a| optimize_expr(a, stats)).collect(),
            },
            expr_type,
            span,
        },
        MIRExprKind::ArrayNew { elements } => MIRExpr {
            kind: MIRExprKind::ArrayNew {
                elements: elements.iter().map(|e| optimize_expr(e, stats)).collect(),
            },
            expr_type,
            span,
        },
        MIRExprKind::ArrayGet { array, index } => MIRExpr {
            kind: MIRExprKind::ArrayGet {
                array: Box::new(optimize_expr(array, stats)),
                index: Box::new(optimize_expr(index, stats)),
            },
            expr_type,
            span,
        },
        MIRExprKind::ArrayLen { target } => MIRExpr {
            kind: MIRExprKind::ArrayLen {
                target: Box::new(optimize_expr(target, stats)),
            },
            expr_type,
            span,
        },
        MIRExprKind::ArrayPush { array, value } => MIRExpr {
            kind: MIRExprKind::ArrayPush {
                array: Box::new(optimize_expr(array, stats)),
                value: Box::new(optimize_expr(value, stats)),
            },
            expr_type,
            span,
        },
        MIRExprKind::MapNew { entries } => MIRExpr {
            kind: MIRExprKind::MapNew {
                entries: entries
                    .iter()
                    .map(|e| MIRMapEntry {
                        key: optimize_expr(&e.key, stats),
                        value: optimize_expr(&e.value, stats),
                    })
                    .collect(),
            },
            expr_type,
            span,
        },
        MIRExprKind::MapGet { map, key } => MIRExpr {
            kind: MIRExprKind::MapGet {
                map: Box::new(optimize_expr(map, stats)),
                key: Box::new(optimize_expr(key, stats)),
            },
            expr_type,
            span,
        },
        MIRExprKind::MapSet { map, key, value } => MIRExpr {
            kind: MIRExprKind::MapSet {
                map: Box::new(optimize_expr(map, stats)),
                key: Box::new(optimize_expr(key, stats)),
                value: Box::new(optimize_expr(value, stats)),
            },
            expr_type,
            span,
        },
        MIRExprKind::MapHas { map, key } => MIRExpr {
            kind: MIRExprKind::MapHas {
                map: Box::new(optimize_expr(map, stats)),
                key: Box::new(optimize_expr(key, stats)),
            },
            expr_type,
            span,
        },
        MIRExprKind::StructNew {
            struct_name,
            struct_index,
            fields,
        } => MIRExpr {
            kind: MIRExprKind::StructNew {
                struct_name: struct_name.clone(),
                struct_index: *struct_index,
                fields: fields.iter().map(|f| optimize_expr(f, stats)).collect(),
            },
            expr_type,
            span,
        },
        MIRExprKind::FieldGet {
            object,
            struct_name,
            field_name,
            field_index,
        } => MIRExpr {
            kind: MIRExprKind::FieldGet {
                object: Box::new(optimize_expr(object, stats)),
                struct_name: struct_name.clone(),
                field_name: field_name.clone(),
                field_index: *field_index,
            },
            expr_type,
            span,
        },
        MIRExprKind::EnumNew {
            enum_name,
            enum_index,
            variant_name,
            variant_tag,
            args,
        } => MIRExpr {
            kind: MIRExprKind::EnumNew {
                enum_name: enum_name.clone(),
                enum_index: *enum_index,
                variant_name: variant_name.clone(),
                variant_tag: *variant_tag,
                args: args.iter().map(|a| optimize_expr(a, stats)).collect(),
            },
            expr_type,
            span,
        },
        MIRExprKind::TryPropagate { operand } => MIRExpr {
            kind: MIRExprKind::TryPropagate {
                operand: Box::new(optimize_expr(operand, stats)),
            },
            expr_type,
            span,
        },
    }
}

fn count_slot_usage_in_block(
    stmts: &[MIRStmt],
    reads: &mut HashMap<usize, usize>,
    writes: &mut HashMap<usize, usize>,
) {
    for s in stmts {
        match s {
            MIRStmt::StoreLocal { slot, value, .. } => {
                *writes.entry(*slot).or_insert(0) += 1;
                count_slot_usage_in_expr(value, reads);
            }
            MIRStmt::StoreGlobal { value, .. } => count_slot_usage_in_expr(value, reads),
            MIRStmt::ArraySet {
                array,
                index,
                value,
                ..
            } => {
                count_slot_usage_in_expr(array, reads);
                count_slot_usage_in_expr(index, reads);
                count_slot_usage_in_expr(value, reads);
            }
            MIRStmt::MapSetStmt {
                map, key, value, ..
            } => {
                count_slot_usage_in_expr(map, reads);
                count_slot_usage_in_expr(key, reads);
                count_slot_usage_in_expr(value, reads);
            }
            MIRStmt::FieldSet { object, value, .. } => {
                count_slot_usage_in_expr(object, reads);
                count_slot_usage_in_expr(value, reads);
            }
            MIRStmt::ExprStmt { expr, .. } => count_slot_usage_in_expr(expr, reads),
            MIRStmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                count_slot_usage_in_expr(condition, reads);
                count_slot_usage_in_block(then_branch, reads, writes);
                count_slot_usage_in_block(else_branch, reads, writes);
            }
            MIRStmt::While {
                condition, body, ..
            } => {
                count_slot_usage_in_expr(condition, reads);
                count_slot_usage_in_block(body, reads, writes);
            }
            MIRStmt::Match {
                subject,
                temp_slot,
                arms,
                ..
            } => {
                *reads.entry(*temp_slot).or_insert(0) += 1;
                *writes.entry(*temp_slot).or_insert(0) += 1;
                count_slot_usage_in_expr(subject, reads);
                for a in arms {
                    if let MIRMatchPattern::EnumVariant { binding_slots, .. } = &a.pattern {
                        for b in binding_slots {
                            *writes.entry(b.slot).or_insert(0) += 1;
                        }
                    }
                    count_slot_usage_in_block(&a.body, reads, writes);
                }
            }
            MIRStmt::Return { value, .. } => {
                if let Some(v) = value {
                    count_slot_usage_in_expr(v, reads);
                }
            }
            MIRStmt::Break { .. } | MIRStmt::Continue { .. } => {}
        }
    }
}

fn count_slot_usage_in_expr(expr: &MIRExpr, reads: &mut HashMap<usize, usize>) {
    match &expr.kind {
        MIRExprKind::LoadLocal { slot, .. } => {
            *reads.entry(*slot).or_insert(0) += 1;
        }
        MIRExprKind::Unary { operand, .. }
        | MIRExprKind::Cast { operand, .. }
        | MIRExprKind::TryPropagate { operand } => count_slot_usage_in_expr(operand, reads),
        MIRExprKind::Binary { left, right, .. } => {
            count_slot_usage_in_expr(left, reads);
            count_slot_usage_in_expr(right, reads);
        }
        MIRExprKind::CallFunction { args, .. }
        | MIRExprKind::CallIntrinsic { args, .. }
        | MIRExprKind::EnumNew { args, .. } => {
            for a in args {
                count_slot_usage_in_expr(a, reads);
            }
        }
        MIRExprKind::ArrayNew { elements } => {
            for e in elements {
                count_slot_usage_in_expr(e, reads);
            }
        }
        MIRExprKind::ArrayGet { array, index } => {
            count_slot_usage_in_expr(array, reads);
            count_slot_usage_in_expr(index, reads);
        }
        MIRExprKind::ArrayLen { target } => count_slot_usage_in_expr(target, reads),
        MIRExprKind::ArrayPush { array, value } => {
            count_slot_usage_in_expr(array, reads);
            count_slot_usage_in_expr(value, reads);
        }
        MIRExprKind::MapNew { entries } => {
            for kv in entries {
                count_slot_usage_in_expr(&kv.key, reads);
                count_slot_usage_in_expr(&kv.value, reads);
            }
        }
        MIRExprKind::MapGet { map, key } | MIRExprKind::MapHas { map, key } => {
            count_slot_usage_in_expr(map, reads);
            count_slot_usage_in_expr(key, reads);
        }
        MIRExprKind::MapSet { map, key, value } => {
            count_slot_usage_in_expr(map, reads);
            count_slot_usage_in_expr(key, reads);
            count_slot_usage_in_expr(value, reads);
        }
        MIRExprKind::StructNew { fields, .. } => {
            for f in fields {
                count_slot_usage_in_expr(f, reads);
            }
        }
        MIRExprKind::FieldGet { object, .. } => count_slot_usage_in_expr(object, reads),
        MIRExprKind::ConstInt { .. }
        | MIRExprKind::ConstFloat { .. }
        | MIRExprKind::ConstBool { .. }
        | MIRExprKind::ConstStr { .. }
        | MIRExprKind::ConstVoid
        | MIRExprKind::LoadGlobal { .. } => {}
    }
}

fn eliminate_dead_stores_in_block(
    stmts: &[MIRStmt],
    reads: &HashMap<usize, usize>,
    writes: &HashMap<usize, usize>,
    stats: &mut OptimizationPassStats,
) -> Vec<MIRStmt> {
    let mut out = Vec::with_capacity(stmts.len());
    for s in stmts {
        if let MIRStmt::StoreLocal {
            slot, value, span, ..
        } = s
        {
            if reads.get(slot).copied().unwrap_or(0) == 0
                && writes.get(slot).copied().unwrap_or(0) == 1
            {
                stats.dead_locals_eliminated += 1;
                if is_pure_mir_expr(value) {
                    continue;
                } else {
                    out.push(MIRStmt::ExprStmt {
                        expr: value.clone(),
                        span: span.clone(),
                    });
                    continue;
                }
            }
        }

        match s {
            MIRStmt::If {
                condition,
                then_branch,
                else_branch,
                span,
            } => out.push(MIRStmt::If {
                condition: condition.clone(),
                then_branch: eliminate_dead_stores_in_block(then_branch, reads, writes, stats),
                else_branch: eliminate_dead_stores_in_block(else_branch, reads, writes, stats),
                span: span.clone(),
            }),
            MIRStmt::While {
                condition,
                body,
                span,
            } => out.push(MIRStmt::While {
                condition: condition.clone(),
                body: eliminate_dead_stores_in_block(body, reads, writes, stats),
                span: span.clone(),
            }),
            MIRStmt::Match {
                subject,
                temp_slot,
                arms,
                span,
            } => out.push(MIRStmt::Match {
                subject: subject.clone(),
                temp_slot: *temp_slot,
                arms: arms
                    .iter()
                    .map(|a| MIRMatchArm {
                        pattern: a.pattern.clone(),
                        body: eliminate_dead_stores_in_block(&a.body, reads, writes, stats),
                        span: a.span.clone(),
                    })
                    .collect(),
                span: span.clone(),
            }),
            other => out.push(other.clone()),
        }
    }
    out
}

fn compute_reachable_functions(functions: &[MIRFunction], entry: Option<&str>) -> HashSet<String> {
    let mut fn_map = HashMap::new();
    for f in functions {
        fn_map.insert(f.name.clone(), f);
    }

    let mut visited = HashSet::new();
    let mut queue = Vec::new();
    for f in functions {
        if (f.exported
            || f.is_entry
            || f.name == "__init__"
            || f.name == "__script__"
            || entry == Some(f.name.as_str()))
            && visited.insert(f.name.clone())
        {
            queue.push(f.name.clone());
        }
    }

    while let Some(cur) = queue.pop() {
        let Some(f) = fn_map.get(&cur) else {
            continue;
        };
        let mut callees = HashSet::new();
        collect_callees_in_block(&f.body, &mut callees);
        for c in callees {
            if visited.insert(c.clone()) {
                queue.push(c);
            }
        }
    }

    visited
}

fn collect_callees_in_block(stmts: &[MIRStmt], out: &mut HashSet<String>) {
    for s in stmts {
        match s {
            MIRStmt::StoreLocal { value, .. } | MIRStmt::StoreGlobal { value, .. } => {
                collect_callees_in_expr(value, out)
            }
            MIRStmt::ArraySet {
                array,
                index,
                value,
                ..
            } => {
                collect_callees_in_expr(array, out);
                collect_callees_in_expr(index, out);
                collect_callees_in_expr(value, out);
            }
            MIRStmt::MapSetStmt {
                map, key, value, ..
            } => {
                collect_callees_in_expr(map, out);
                collect_callees_in_expr(key, out);
                collect_callees_in_expr(value, out);
            }
            MIRStmt::FieldSet { object, value, .. } => {
                collect_callees_in_expr(object, out);
                collect_callees_in_expr(value, out);
            }
            MIRStmt::ExprStmt { expr, .. } => collect_callees_in_expr(expr, out),
            MIRStmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                collect_callees_in_expr(condition, out);
                collect_callees_in_block(then_branch, out);
                collect_callees_in_block(else_branch, out);
            }
            MIRStmt::While {
                condition, body, ..
            } => {
                collect_callees_in_expr(condition, out);
                collect_callees_in_block(body, out);
            }
            MIRStmt::Match { subject, arms, .. } => {
                collect_callees_in_expr(subject, out);
                for a in arms {
                    collect_callees_in_block(&a.body, out);
                }
            }
            MIRStmt::Return { value, .. } => {
                if let Some(v) = value {
                    collect_callees_in_expr(v, out);
                }
            }
            MIRStmt::Break { .. } | MIRStmt::Continue { .. } => {}
        }
    }
}

fn collect_callees_in_expr(expr: &MIRExpr, out: &mut HashSet<String>) {
    match &expr.kind {
        MIRExprKind::CallFunction { callee, args } => {
            out.insert(callee.clone());
            for a in args {
                collect_callees_in_expr(a, out);
            }
        }
        MIRExprKind::CallIntrinsic { args, .. } | MIRExprKind::EnumNew { args, .. } => {
            for a in args {
                collect_callees_in_expr(a, out);
            }
        }
        MIRExprKind::Unary { operand, .. }
        | MIRExprKind::Cast { operand, .. }
        | MIRExprKind::TryPropagate { operand } => collect_callees_in_expr(operand, out),
        MIRExprKind::Binary { left, right, .. } => {
            collect_callees_in_expr(left, out);
            collect_callees_in_expr(right, out);
        }
        MIRExprKind::ArrayNew { elements } => {
            for e in elements {
                collect_callees_in_expr(e, out);
            }
        }
        MIRExprKind::ArrayGet { array, index } => {
            collect_callees_in_expr(array, out);
            collect_callees_in_expr(index, out);
        }
        MIRExprKind::ArrayLen { target } => collect_callees_in_expr(target, out),
        MIRExprKind::ArrayPush { array, value } => {
            collect_callees_in_expr(array, out);
            collect_callees_in_expr(value, out);
        }
        MIRExprKind::MapNew { entries } => {
            for kv in entries {
                collect_callees_in_expr(&kv.key, out);
                collect_callees_in_expr(&kv.value, out);
            }
        }
        MIRExprKind::MapGet { map, key } | MIRExprKind::MapHas { map, key } => {
            collect_callees_in_expr(map, out);
            collect_callees_in_expr(key, out);
        }
        MIRExprKind::MapSet { map, key, value } => {
            collect_callees_in_expr(map, out);
            collect_callees_in_expr(key, out);
            collect_callees_in_expr(value, out);
        }
        MIRExprKind::StructNew { fields, .. } => {
            for f in fields {
                collect_callees_in_expr(f, out);
            }
        }
        MIRExprKind::FieldGet { object, .. } => collect_callees_in_expr(object, out),
        MIRExprKind::ConstInt { .. }
        | MIRExprKind::ConstFloat { .. }
        | MIRExprKind::ConstBool { .. }
        | MIRExprKind::ConstStr { .. }
        | MIRExprKind::ConstVoid
        | MIRExprKind::LoadLocal { .. }
        | MIRExprKind::LoadGlobal { .. } => {}
    }
}

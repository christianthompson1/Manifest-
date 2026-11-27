use crate::ast::{BinaryOp, UnaryOp};
use crate::diagnostic::SourceSpan;
use crate::json::{escape_json_string, JsonValue};
use crate::profile::SyntaxProfile;
use crate::types::SemanticType;

#[derive(Debug, Clone)]
pub struct MIRStructField {
    pub name: String,
    pub index: usize,
    pub field_type: SemanticType,
}

#[derive(Debug, Clone)]
pub struct MIRStruct {
    pub name: String,
    pub index: usize,
    pub exported: bool,
    pub fields: Vec<MIRStructField>,
}

#[derive(Debug, Clone)]
pub struct MIREnumVariant {
    pub name: String,
    pub tag: usize,
    pub payload_types: Vec<SemanticType>,
}

#[derive(Debug, Clone)]
pub struct MIREnum {
    pub name: String,
    pub index: usize,
    pub exported: bool,
    pub variants: Vec<MIREnumVariant>,
}

#[derive(Debug, Clone)]
pub struct MIRGlobal {
    pub name: String,
    pub slot: usize,
    pub mutable: bool,
    pub is_const: bool,
    pub exported: bool,
    pub var_type: SemanticType,
    pub init: MIRExpr,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct MIRLocal {
    pub name: String,
    pub slot: usize,
    pub is_param: bool,
    pub mutable: bool,
    pub local_type: SemanticType,
    pub span: SourceSpan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CastKind {
    I64ToF64,
    F64ToI64,
    ToStr,
}

impl CastKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            CastKind::I64ToF64 => "i64_to_f64",
            CastKind::F64ToI64 => "f64_to_i64",
            CastKind::ToStr => "to_str",
        }
    }
}

#[derive(Debug, Clone)]
pub struct MIRMapEntry {
    pub key: MIRExpr,
    pub value: MIRExpr,
}

#[derive(Debug, Clone)]
pub enum MIRExprKind {
    ConstInt {
        value: i64,
    },
    ConstFloat {
        value: f64,
    },
    ConstBool {
        value: bool,
    },
    ConstStr {
        value: String,
    },
    ConstVoid,
    LoadLocal {
        slot: usize,
        name: String,
    },
    LoadGlobal {
        slot: usize,
        name: String,
    },
    Binary {
        op: BinaryOp,
        left: Box<MIRExpr>,
        right: Box<MIRExpr>,
    },
    Unary {
        op: UnaryOp,
        operand: Box<MIRExpr>,
    },
    Cast {
        cast_kind: CastKind,
        operand: Box<MIRExpr>,
    },
    CallFunction {
        callee: String,
        args: Vec<MIRExpr>,
    },
    CallIntrinsic {
        symbol: String,
        capability: String,
        args: Vec<MIRExpr>,
    },
    ArrayNew {
        elements: Vec<MIRExpr>,
    },
    ArrayGet {
        array: Box<MIRExpr>,
        index: Box<MIRExpr>,
    },
    ArrayLen {
        target: Box<MIRExpr>,
    },
    ArrayPush {
        array: Box<MIRExpr>,
        value: Box<MIRExpr>,
    },
    MapNew {
        entries: Vec<MIRMapEntry>,
    },
    MapGet {
        map: Box<MIRExpr>,
        key: Box<MIRExpr>,
    },
    MapSet {
        map: Box<MIRExpr>,
        key: Box<MIRExpr>,
        value: Box<MIRExpr>,
    },
    MapHas {
        map: Box<MIRExpr>,
        key: Box<MIRExpr>,
    },
    StructNew {
        struct_name: String,
        struct_index: usize,
        fields: Vec<MIRExpr>,
    },
    FieldGet {
        object: Box<MIRExpr>,
        struct_name: String,
        field_name: String,
        field_index: usize,
    },
    EnumNew {
        enum_name: String,
        enum_index: usize,
        variant_name: String,
        variant_tag: usize,
        args: Vec<MIRExpr>,
    },
    TryPropagate {
        operand: Box<MIRExpr>,
    },
}

#[derive(Debug, Clone)]
pub struct MIRExpr {
    pub kind: MIRExprKind,
    pub expr_type: SemanticType,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct MIRBindingSlot {
    pub slot: usize,
    pub name: String,
}

#[derive(Debug, Clone)]
pub enum MIRPatternLiteral {
    I64(i64),
    F64(f64),
    Bool(bool),
    Str(String),
}

#[derive(Debug, Clone)]
pub enum MIRMatchPattern {
    Wildcard,
    Literal(MIRPatternLiteral),
    EnumVariant {
        enum_name: String,
        variant_name: String,
        variant_tag: usize,
        binding_slots: Vec<MIRBindingSlot>,
    },
}

#[derive(Debug, Clone)]
pub struct MIRMatchArm {
    pub pattern: MIRMatchPattern,
    pub body: Vec<MIRStmt>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub enum MIRStmt {
    StoreLocal {
        slot: usize,
        name: String,
        is_declaration: bool,
        value: MIRExpr,
        span: SourceSpan,
    },
    StoreGlobal {
        slot: usize,
        name: String,
        value: MIRExpr,
        span: SourceSpan,
    },
    ArraySet {
        array: MIRExpr,
        index: MIRExpr,
        value: MIRExpr,
        span: SourceSpan,
    },
    MapSetStmt {
        map: MIRExpr,
        key: MIRExpr,
        value: MIRExpr,
        span: SourceSpan,
    },
    FieldSet {
        object: MIRExpr,
        struct_name: String,
        field_name: String,
        field_index: usize,
        value: MIRExpr,
        span: SourceSpan,
    },
    ExprStmt {
        expr: MIRExpr,
        span: SourceSpan,
    },
    If {
        condition: MIRExpr,
        then_branch: Vec<MIRStmt>,
        else_branch: Vec<MIRStmt>,
        span: SourceSpan,
    },
    While {
        condition: MIRExpr,
        body: Vec<MIRStmt>,
        span: SourceSpan,
    },
    Break {
        span: SourceSpan,
    },
    Continue {
        span: SourceSpan,
    },
    Return {
        value: Option<MIRExpr>,
        span: SourceSpan,
    },
    Match {
        subject: MIRExpr,
        temp_slot: usize,
        arms: Vec<MIRMatchArm>,
        span: SourceSpan,
    },
}

#[derive(Debug, Clone)]
pub struct MIRFunction {
    pub name: String,
    pub exported: bool,
    pub is_async: bool,
    pub is_entry: bool,
    pub is_synthetic: bool,
    pub params: Vec<MIRLocal>,
    pub locals: Vec<MIRLocal>,
    pub return_type: SemanticType,
    pub effects: Vec<String>,
    pub body: Vec<MIRStmt>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct MIRModule {
    pub module_name: String,
    pub source_profile: SyntaxProfile,
    pub requires: Vec<String>,
    pub provides: Vec<String>,
    pub denies: Vec<String>,
    pub structs: Vec<MIRStruct>,
    pub enums: Vec<MIREnum>,
    pub globals: Vec<MIRGlobal>,
    pub functions: Vec<MIRFunction>,
    pub entry_function: Option<String>,
}

pub fn is_pure_mir_expr(expr: &MIRExpr) -> bool {
    match &expr.kind {
        MIRExprKind::ConstInt { .. }
        | MIRExprKind::ConstFloat { .. }
        | MIRExprKind::ConstBool { .. }
        | MIRExprKind::ConstStr { .. }
        | MIRExprKind::ConstVoid
        | MIRExprKind::LoadLocal { .. }
        | MIRExprKind::LoadGlobal { .. } => true,
        MIRExprKind::Unary { op, operand } => {
            if *op == UnaryOp::Neg && matches!(operand.expr_type, SemanticType::I64) {
                matches!(operand.kind, MIRExprKind::ConstInt { value } if value != i64::MIN)
            } else {
                is_pure_mir_expr(operand)
            }
        }
        MIRExprKind::Binary { op, left, right } => {
            if matches!(op, BinaryOp::Div | BinaryOp::Mod) {
                return false;
            }
            if matches!(op, BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul)
                && matches!(expr.expr_type, SemanticType::I64)
            {
                return false;
            }
            is_pure_mir_expr(left) && is_pure_mir_expr(right)
        }
        MIRExprKind::Cast { operand, .. } => is_pure_mir_expr(operand),
        MIRExprKind::ArrayNew { elements } => elements.iter().all(is_pure_mir_expr),
        MIRExprKind::StructNew { fields, .. } => fields.iter().all(is_pure_mir_expr),
        MIRExprKind::EnumNew { args, .. } => args.iter().all(is_pure_mir_expr),
        _ => false,
    }
}

pub fn format_mir_module(mir: &MIRModule) -> String {
    let mut lines = Vec::new();
    lines.push("; Manifest Typed Intermediate Representation (MIR v1.0)".to_string());
    lines.push(format!("module {} {{", mir.module_name));
    lines.push(format!("  requires [{}]", mir.requires.join(", ")));
    lines.push(format!("  provides [{}]", mir.provides.join(", ")));
    lines.push(format!("  denies   [{}]", mir.denies.join(", ")));
    if let Some(entry) = &mir.entry_function {
        lines.push(format!("  entry    @{entry}"));
    }
    lines.push(String::new());

    for st in &mir.structs {
        let f_str: Vec<String> = st
            .fields
            .iter()
            .map(|f| format!("{}: {}", f.name, f.field_type.format_type()))
            .collect();
        let exp = if st.exported { "pub " } else { "" };
        lines.push(format!("  {exp}struct {} {{ {} }}", st.name, f_str.join(", ")));
    }

    for en in &mir.enums {
        if en.name == "Result" {
            continue;
        }
        let v_str: Vec<String> = en
            .variants
            .iter()
            .map(|v| {
                if v.payload_types.is_empty() {
                    v.name.clone()
                } else {
                    let ps: Vec<String> = v
                        .payload_types
                        .iter()
                        .map(|t| t.format_type())
                        .collect();
                    format!("{}({})", v.name, ps.join(", "))
                }
            })
            .collect();
        let exp = if en.exported { "pub " } else { "" };
        lines.push(format!("  {exp}enum {} = {}", en.name, v_str.join(" | ")));
    }

    if !mir.globals.is_empty() {
        lines.push(String::new());
        for g in &mir.globals {
            let exp = if g.exported { "pub " } else { "" };
            let kw = if g.is_const {
                "const"
            } else if g.mutable {
                "global mut"
            } else {
                "global"
            };
            lines.push(format!(
                "  {exp}{kw} ${}#{}: {} = {}",
                g.name,
                g.slot,
                g.var_type.format_type(),
                format_mir_expr(&g.init)
            ));
        }
    }

    for fn_d in &mir.functions {
        lines.push(String::new());
        let p_str: Vec<String> = fn_d
            .params
            .iter()
            .map(|p| format!("%{}#{}: {}", p.name, p.slot, p.local_type.format_type()))
            .collect();
        let eff_str = if fn_d.effects.is_empty() {
            " pure".to_string()
        } else {
            format!(" effects({})", fn_d.effects.join(", "))
        };
        let entry_tag = if fn_d.is_entry { " [entry]" } else { "" };
        let exp = if fn_d.exported { "pub " } else { "" };
        lines.push(format!(
            "  {exp}fn @{}({}) -> {}{eff_str}{entry_tag} {{",
            fn_d.name,
            p_str.join(", "),
            fn_d.return_type.format_type()
        ));
        for s in &fn_d.body {
            format_mir_stmt(s, "    ", &mut lines);
        }
        lines.push("  }".to_string());
    }

    lines.push("}".to_string());
    lines.join("\n")
}

fn format_mir_stmt(stmt: &MIRStmt, indent: &str, out: &mut Vec<String>) {
    match stmt {
        MIRStmt::StoreLocal {
            slot,
            name,
            is_declaration,
            value,
            ..
        } => {
            let prefix = if *is_declaration { "let " } else { "" };
            out.push(format!(
                "{indent}{prefix}%{name}#{slot} = {}",
                format_mir_expr(value)
            ));
        }
        MIRStmt::StoreGlobal {
            slot, name, value, ..
        } => {
            out.push(format!("{indent}${name}#{slot} = {}", format_mir_expr(value)));
        }
        MIRStmt::ArraySet {
            array,
            index,
            value,
            ..
        } => {
            out.push(format!(
                "{indent}array.set({}, {}, {})",
                format_mir_expr(array),
                format_mir_expr(index),
                format_mir_expr(value)
            ));
        }
        MIRStmt::MapSetStmt {
            map, key, value, ..
        } => {
            out.push(format!(
                "{indent}map.set({}, {}, {})",
                format_mir_expr(map),
                format_mir_expr(key),
                format_mir_expr(value)
            ));
        }
        MIRStmt::FieldSet {
            object,
            field_name,
            field_index,
            value,
            ..
        } => {
            out.push(format!(
                "{indent}field.set({}.{field_name}#{field_index}, {})",
                format_mir_expr(object),
                format_mir_expr(value)
            ));
        }
        MIRStmt::ExprStmt { expr, .. } => {
            out.push(format!("{indent}{}", format_mir_expr(expr)));
        }
        MIRStmt::Return { value, .. } => match value {
            Some(v) => out.push(format!("{indent}ret {}", format_mir_expr(v))),
            None => out.push(format!("{indent}ret void")),
        },
        MIRStmt::Break { .. } => out.push(format!("{indent}break")),
        MIRStmt::Continue { .. } => out.push(format!("{indent}continue")),
        MIRStmt::If {
            condition,
            then_branch,
            else_branch,
            ..
        } => {
            out.push(format!("{indent}if ({}) {{", format_mir_expr(condition)));
            let sub = format!("{indent}  ");
            for s in then_branch {
                format_mir_stmt(s, &sub, out);
            }
            if !else_branch.is_empty() {
                out.push(format!("{indent}}} else {{"));
                for s in else_branch {
                    format_mir_stmt(s, &sub, out);
                }
            }
            out.push(format!("{indent}}}"));
        }
        MIRStmt::While {
            condition, body, ..
        } => {
            out.push(format!("{indent}while ({}) {{", format_mir_expr(condition)));
            let sub = format!("{indent}  ");
            for s in body {
                format_mir_stmt(s, &sub, out);
            }
            out.push(format!("{indent}}}"));
        }
        MIRStmt::Match {
            subject,
            temp_slot,
            arms,
            ..
        } => {
            out.push(format!(
                "{indent}match ({}) [tmp#{temp_slot}] {{",
                format_mir_expr(subject)
            ));
            let sub = format!("{indent}    ");
            for arm in arms {
                let pat_str = match &arm.pattern {
                    MIRMatchPattern::Wildcard => "_".to_string(),
                    MIRMatchPattern::Literal(lit) => match lit {
                        MIRPatternLiteral::I64(v) => escape_json_string(&v.to_string()),
                        MIRPatternLiteral::F64(v) => escape_json_string(&format!("{v}")),
                        MIRPatternLiteral::Bool(v) => escape_json_string(if *v { "true" } else { "false" }),
                        MIRPatternLiteral::Str(v) => escape_json_string(v),
                    },
                    MIRMatchPattern::EnumVariant {
                        enum_name,
                        variant_name,
                        variant_tag,
                        binding_slots,
                    } => {
                        let bs: Vec<String> = binding_slots
                            .iter()
                            .map(|b| format!("%{}#{}", b.name, b.slot))
                            .collect();
                        format!(
                            "{enum_name}::{variant_name}#{variant_tag}({})",
                            bs.join(", ")
                        )
                    }
                };
                out.push(format!("{indent}  {pat_str} => {{"));
                for s in &arm.body {
                    format_mir_stmt(s, &sub, out);
                }
                out.push(format!("{indent}  }}"));
            }
            out.push(format!("{indent}}}"));
        }
    }
}

fn format_mir_expr(expr: &MIRExpr) -> String {
    match &expr.kind {
        MIRExprKind::ConstInt { value } => format!("{value}i64"),
        MIRExprKind::ConstFloat { value } => {
            if value.fract() == 0.0 && value.is_finite() {
                format!("{value:.1}f64")
            } else {
                format!("{value}f64")
            }
        }
        MIRExprKind::ConstBool { value } => format!("{value}"),
        MIRExprKind::ConstStr { value } => escape_json_string(value),
        MIRExprKind::ConstVoid => "void".to_string(),
        MIRExprKind::LoadLocal { slot, name } => format!("%{name}#{slot}"),
        MIRExprKind::LoadGlobal { slot, name } => format!("${name}#{slot}"),
        MIRExprKind::Unary { op, operand } => format!("({}{})", op.as_str(), format_mir_expr(operand)),
        MIRExprKind::Binary { op, left, right } => format!(
            "({} {} {})",
            format_mir_expr(left),
            op.as_str(),
            format_mir_expr(right)
        ),
        MIRExprKind::Cast { cast_kind, operand } => {
            format!("{}({})", cast_kind.as_str(), format_mir_expr(operand))
        }
        MIRExprKind::CallFunction { callee, args } => {
            let as_str: Vec<String> = args.iter().map(format_mir_expr).collect();
            format!("call @{callee}({})", as_str.join(", "))
        }
        MIRExprKind::CallIntrinsic {
            symbol,
            capability,
            args,
        } => {
            let as_str: Vec<String> = args.iter().map(format_mir_expr).collect();
            format!("intrinsic[{capability}] {symbol}({})", as_str.join(", "))
        }
        MIRExprKind::ArrayNew { elements } => {
            let es: Vec<String> = elements.iter().map(format_mir_expr).collect();
            format!("[{}]", es.join(", "))
        }
        MIRExprKind::ArrayGet { array, index } => {
            format!("{}[{}]", format_mir_expr(array), format_mir_expr(index))
        }
        MIRExprKind::ArrayLen { target } => format!("len({})", format_mir_expr(target)),
        MIRExprKind::ArrayPush { array, value } => {
            format!("push({}, {})", format_mir_expr(array), format_mir_expr(value))
        }
        MIRExprKind::MapNew { entries } => {
            let es: Vec<String> = entries
                .iter()
                .map(|e| format!("{}: {}", format_mir_expr(&e.key), format_mir_expr(&e.value)))
                .collect();
            format!("{{{}}}", es.join(", "))
        }
        MIRExprKind::MapGet { map, key } => {
            format!("map.get({}, {})", format_mir_expr(map), format_mir_expr(key))
        }
        MIRExprKind::MapSet { map, key, value } => format!(
            "map.set({}, {}, {})",
            format_mir_expr(map),
            format_mir_expr(key),
            format_mir_expr(value)
        ),
        MIRExprKind::MapHas { map, key } => {
            format!("map.has({}, {})", format_mir_expr(map), format_mir_expr(key))
        }
        MIRExprKind::StructNew {
            struct_name,
            struct_index,
            fields,
        } => {
            let fs: Vec<String> = fields.iter().map(format_mir_expr).collect();
            format!("{struct_name}#{struct_index}{{{}}}", fs.join(", "))
        }
        MIRExprKind::FieldGet {
            object,
            field_name,
            field_index,
            ..
        } => format!("{}.{field_name}#{field_index}", format_mir_expr(object)),
        MIRExprKind::EnumNew {
            enum_name,
            variant_name,
            variant_tag,
            args,
            ..
        } => {
            let as_str: Vec<String> = args.iter().map(format_mir_expr).collect();
            format!("{enum_name}::{variant_name}#{variant_tag}({})", as_str.join(", "))
        }
        MIRExprKind::TryPropagate { operand } => format!("try?({})", format_mir_expr(operand)),
    }
}

impl MIRLocal {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::Object(vec![
            ("name".to_string(), JsonValue::String(self.name.clone())),
            ("slot".to_string(), JsonValue::Number(self.slot as f64)),
            ("isParam".to_string(), JsonValue::Bool(self.is_param)),
            ("mutable".to_string(), JsonValue::Bool(self.mutable)),
            ("type".to_string(), self.local_type.to_json()),
            ("span".to_string(), self.span.to_json()),
        ])
    }
}

impl MIRExpr {
    pub fn to_json(&self) -> JsonValue {
        let mut entries = match &self.kind {
            MIRExprKind::ConstInt { value } => vec![
                ("kind".to_string(), JsonValue::String("ConstInt".to_string())),
                // Encoded as string so 64-bit integers never lose precision through JSON Number!
                ("value".to_string(), JsonValue::String(value.to_string())),
            ],
            MIRExprKind::ConstFloat { value } => vec![
                ("kind".to_string(), JsonValue::String("ConstFloat".to_string())),
                ("value".to_string(), JsonValue::Number(*value)),
            ],
            MIRExprKind::ConstBool { value } => vec![
                ("kind".to_string(), JsonValue::String("ConstBool".to_string())),
                ("value".to_string(), JsonValue::Bool(*value)),
            ],
            MIRExprKind::ConstStr { value } => vec![
                ("kind".to_string(), JsonValue::String("ConstStr".to_string())),
                ("value".to_string(), JsonValue::String(value.clone())),
            ],
            MIRExprKind::ConstVoid => vec![("kind".to_string(), JsonValue::String("ConstVoid".to_string()))],
            MIRExprKind::LoadLocal { slot, name } => vec![
                ("kind".to_string(), JsonValue::String("LoadLocal".to_string())),
                ("slot".to_string(), JsonValue::Number(*slot as f64)),
                ("name".to_string(), JsonValue::String(name.clone())),
            ],
            MIRExprKind::LoadGlobal { slot, name } => vec![
                ("kind".to_string(), JsonValue::String("LoadGlobal".to_string())),
                ("slot".to_string(), JsonValue::Number(*slot as f64)),
                ("name".to_string(), JsonValue::String(name.clone())),
            ],
            MIRExprKind::Binary { op, left, right } => vec![
                ("kind".to_string(), JsonValue::String("Binary".to_string())),
                ("op".to_string(), JsonValue::String(op.as_str().to_string())),
                ("left".to_string(), left.to_json()),
                ("right".to_string(), right.to_json()),
            ],
            MIRExprKind::Unary { op, operand } => vec![
                ("kind".to_string(), JsonValue::String("Unary".to_string())),
                ("op".to_string(), JsonValue::String(op.as_str().to_string())),
                ("operand".to_string(), operand.to_json()),
            ],
            MIRExprKind::Cast { cast_kind, operand } => vec![
                ("kind".to_string(), JsonValue::String("Cast".to_string())),
                (
                    "castKind".to_string(),
                    JsonValue::String(cast_kind.as_str().to_string()),
                ),
                ("operand".to_string(), operand.to_json()),
            ],
            MIRExprKind::CallFunction { callee, args } => vec![
                ("kind".to_string(), JsonValue::String("CallFunction".to_string())),
                ("callee".to_string(), JsonValue::String(callee.clone())),
                (
                    "args".to_string(),
                    JsonValue::Array(args.iter().map(|a| a.to_json()).collect()),
                ),
            ],
            MIRExprKind::CallIntrinsic {
                symbol,
                capability,
                args,
            } => vec![
                ("kind".to_string(), JsonValue::String("CallIntrinsic".to_string())),
                ("symbol".to_string(), JsonValue::String(symbol.clone())),
                (
                    "capability".to_string(),
                    JsonValue::String(capability.clone()),
                ),
                (
                    "args".to_string(),
                    JsonValue::Array(args.iter().map(|a| a.to_json()).collect()),
                ),
            ],
            MIRExprKind::ArrayNew { elements } => vec![
                ("kind".to_string(), JsonValue::String("ArrayNew".to_string())),
                (
                    "elements".to_string(),
                    JsonValue::Array(elements.iter().map(|e| e.to_json()).collect()),
                ),
            ],
            MIRExprKind::ArrayGet { array, index } => vec![
                ("kind".to_string(), JsonValue::String("ArrayGet".to_string())),
                ("array".to_string(), array.to_json()),
                ("index".to_string(), index.to_json()),
            ],
            MIRExprKind::ArrayLen { target } => vec![
                ("kind".to_string(), JsonValue::String("ArrayLen".to_string())),
                ("target".to_string(), target.to_json()),
            ],
            MIRExprKind::ArrayPush { array, value } => vec![
                ("kind".to_string(), JsonValue::String("ArrayPush".to_string())),
                ("array".to_string(), array.to_json()),
                ("value".to_string(), value.to_json()),
            ],
            MIRExprKind::MapNew { entries } => vec![
                ("kind".to_string(), JsonValue::String("MapNew".to_string())),
                (
                    "entries".to_string(),
                    JsonValue::Array(
                        entries
                            .iter()
                            .map(|kv| {
                                JsonValue::Object(vec![
                                    ("key".to_string(), kv.key.to_json()),
                                    ("value".to_string(), kv.value.to_json()),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ],
            MIRExprKind::MapGet { map, key } => vec![
                ("kind".to_string(), JsonValue::String("MapGet".to_string())),
                ("map".to_string(), map.to_json()),
                ("key".to_string(), key.to_json()),
            ],
            MIRExprKind::MapSet { map, key, value } => vec![
                ("kind".to_string(), JsonValue::String("MapSet".to_string())),
                ("map".to_string(), map.to_json()),
                ("key".to_string(), key.to_json()),
                ("value".to_string(), value.to_json()),
            ],
            MIRExprKind::MapHas { map, key } => vec![
                ("kind".to_string(), JsonValue::String("MapHas".to_string())),
                ("map".to_string(), map.to_json()),
                ("key".to_string(), key.to_json()),
            ],
            MIRExprKind::StructNew {
                struct_name,
                struct_index,
                fields,
            } => vec![
                ("kind".to_string(), JsonValue::String("StructNew".to_string())),
                (
                    "structName".to_string(),
                    JsonValue::String(struct_name.clone()),
                ),
                (
                    "structIndex".to_string(),
                    JsonValue::Number(*struct_index as f64),
                ),
                (
                    "fields".to_string(),
                    JsonValue::Array(fields.iter().map(|f| f.to_json()).collect()),
                ),
            ],
            MIRExprKind::FieldGet {
                object,
                struct_name,
                field_name,
                field_index,
            } => vec![
                ("kind".to_string(), JsonValue::String("FieldGet".to_string())),
                ("object".to_string(), object.to_json()),
                (
                    "structName".to_string(),
                    JsonValue::String(struct_name.clone()),
                ),
                (
                    "fieldName".to_string(),
                    JsonValue::String(field_name.clone()),
                ),
                (
                    "fieldIndex".to_string(),
                    JsonValue::Number(*field_index as f64),
                ),
            ],
            MIRExprKind::EnumNew {
                enum_name,
                enum_index,
                variant_name,
                variant_tag,
                args,
            } => vec![
                ("kind".to_string(), JsonValue::String("EnumNew".to_string())),
                ("enumName".to_string(), JsonValue::String(enum_name.clone())),
                ("enumIndex".to_string(), JsonValue::Number(*enum_index as f64)),
                (
                    "variantName".to_string(),
                    JsonValue::String(variant_name.clone()),
                ),
                (
                    "variantTag".to_string(),
                    JsonValue::Number(*variant_tag as f64),
                ),
                (
                    "args".to_string(),
                    JsonValue::Array(args.iter().map(|a| a.to_json()).collect()),
                ),
            ],
            MIRExprKind::TryPropagate { operand } => vec![
                ("kind".to_string(), JsonValue::String("TryPropagate".to_string())),
                ("operand".to_string(), operand.to_json()),
            ],
        };
        entries.push(("type".to_string(), self.expr_type.to_json()));
        entries.push(("span".to_string(), self.span.to_json()));
        JsonValue::Object(entries)
    }
}

impl MIRStmt {
    pub fn to_json(&self) -> JsonValue {
        match self {
            MIRStmt::StoreLocal {
                slot,
                name,
                is_declaration,
                value,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("StoreLocal".to_string())),
                ("slot".to_string(), JsonValue::Number(*slot as f64)),
                ("name".to_string(), JsonValue::String(name.clone())),
                ("isDeclaration".to_string(), JsonValue::Bool(*is_declaration)),
                ("value".to_string(), value.to_json()),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::StoreGlobal {
                slot,
                name,
                value,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("StoreGlobal".to_string())),
                ("slot".to_string(), JsonValue::Number(*slot as f64)),
                ("name".to_string(), JsonValue::String(name.clone())),
                ("value".to_string(), value.to_json()),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::ArraySet {
                array,
                index,
                value,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("ArraySet".to_string())),
                ("array".to_string(), array.to_json()),
                ("index".to_string(), index.to_json()),
                ("value".to_string(), value.to_json()),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::MapSetStmt {
                map,
                key,
                value,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("MapSetStmt".to_string())),
                ("map".to_string(), map.to_json()),
                ("key".to_string(), key.to_json()),
                ("value".to_string(), value.to_json()),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::FieldSet {
                object,
                struct_name,
                field_name,
                field_index,
                value,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("FieldSet".to_string())),
                ("object".to_string(), object.to_json()),
                (
                    "structName".to_string(),
                    JsonValue::String(struct_name.clone()),
                ),
                ("fieldName".to_string(), JsonValue::String(field_name.clone())),
                (
                    "fieldIndex".to_string(),
                    JsonValue::Number(*field_index as f64),
                ),
                ("value".to_string(), value.to_json()),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::ExprStmt { expr, span } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("ExprStmt".to_string())),
                ("expr".to_string(), expr.to_json()),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::If {
                condition,
                then_branch,
                else_branch,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("If".to_string())),
                ("condition".to_string(), condition.to_json()),
                (
                    "thenBranch".to_string(),
                    JsonValue::Array(then_branch.iter().map(|s| s.to_json()).collect()),
                ),
                (
                    "elseBranch".to_string(),
                    JsonValue::Array(else_branch.iter().map(|s| s.to_json()).collect()),
                ),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::While {
                condition,
                body,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("While".to_string())),
                ("condition".to_string(), condition.to_json()),
                (
                    "body".to_string(),
                    JsonValue::Array(body.iter().map(|s| s.to_json()).collect()),
                ),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::Break { span } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("Break".to_string())),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::Continue { span } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("Continue".to_string())),
                ("span".to_string(), span.to_json()),
            ]),
            MIRStmt::Return { value, span } => {
                let mut entries = vec![("kind".to_string(), JsonValue::String("Return".to_string()))];
                if let Some(v) = value {
                    entries.push(("value".to_string(), v.to_json()));
                }
                entries.push(("span".to_string(), span.to_json()));
                JsonValue::Object(entries)
            }
            MIRStmt::Match {
                subject,
                temp_slot,
                arms,
                span,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("Match".to_string())),
                ("subject".to_string(), subject.to_json()),
                ("tempSlot".to_string(), JsonValue::Number(*temp_slot as f64)),
                (
                    "arms".to_string(),
                    JsonValue::Array(
                        arms.iter()
                            .map(|arm| {
                                let pat_json = match &arm.pattern {
                                    MIRMatchPattern::Wildcard => JsonValue::Object(vec![(
                                        "kind".to_string(),
                                        JsonValue::String("Wildcard".to_string()),
                                    )]),
                                    MIRMatchPattern::Literal(lit) => match lit {
                                        MIRPatternLiteral::I64(v) => JsonValue::Object(vec![
                                            (
                                                "kind".to_string(),
                                                JsonValue::String("Literal".to_string()),
                                            ),
                                            (
                                                "value".to_string(),
                                                JsonValue::String(v.to_string()),
                                            ),
                                            (
                                                "litKind".to_string(),
                                                JsonValue::String("i64".to_string()),
                                            ),
                                        ]),
                                        MIRPatternLiteral::F64(v) => JsonValue::Object(vec![
                                            (
                                                "kind".to_string(),
                                                JsonValue::String("Literal".to_string()),
                                            ),
                                            ("value".to_string(), JsonValue::Number(*v)),
                                            (
                                                "litKind".to_string(),
                                                JsonValue::String("f64".to_string()),
                                            ),
                                        ]),
                                        MIRPatternLiteral::Bool(v) => JsonValue::Object(vec![
                                            (
                                                "kind".to_string(),
                                                JsonValue::String("Literal".to_string()),
                                            ),
                                            ("value".to_string(), JsonValue::Bool(*v)),
                                            (
                                                "litKind".to_string(),
                                                JsonValue::String("bool".to_string()),
                                            ),
                                        ]),
                                        MIRPatternLiteral::Str(v) => JsonValue::Object(vec![
                                            (
                                                "kind".to_string(),
                                                JsonValue::String("Literal".to_string()),
                                            ),
                                            ("value".to_string(), JsonValue::String(v.clone())),
                                            (
                                                "litKind".to_string(),
                                                JsonValue::String("str".to_string()),
                                            ),
                                        ]),
                                    },
                                    MIRMatchPattern::EnumVariant {
                                        enum_name,
                                        variant_name,
                                        variant_tag,
                                        binding_slots,
                                    } => JsonValue::Object(vec![
                                        (
                                            "kind".to_string(),
                                            JsonValue::String("EnumVariant".to_string()),
                                        ),
                                        (
                                            "enumName".to_string(),
                                            JsonValue::String(enum_name.clone()),
                                        ),
                                        (
                                            "variantName".to_string(),
                                            JsonValue::String(variant_name.clone()),
                                        ),
                                        (
                                            "variantTag".to_string(),
                                            JsonValue::Number(*variant_tag as f64),
                                        ),
                                        (
                                            "bindingSlots".to_string(),
                                            JsonValue::Array(
                                                binding_slots
                                                    .iter()
                                                    .map(|b| {
                                                        JsonValue::Object(vec![
                                                            (
                                                                "slot".to_string(),
                                                                JsonValue::Number(b.slot as f64),
                                                            ),
                                                            (
                                                                "name".to_string(),
                                                                JsonValue::String(b.name.clone()),
                                                            ),
                                                        ])
                                                    })
                                                    .collect(),
                                            ),
                                        ),
                                    ]),
                                };
                                JsonValue::Object(vec![
                                    ("pattern".to_string(), pat_json),
                                    (
                                        "body".to_string(),
                                        JsonValue::Array(
                                            arm.body.iter().map(|s| s.to_json()).collect(),
                                        ),
                                    ),
                                    ("span".to_string(), arm.span.to_json()),
                                ])
                            })
                            .collect(),
                    ),
                ),
                ("span".to_string(), span.to_json()),
            ]),
        }
    }
}

impl MIRModule {
    pub fn to_json(&self) -> JsonValue {
        let mut entries = vec![
            ("kind".to_string(), JsonValue::String("MIRModule".to_string())),
            (
                "moduleName".to_string(),
                JsonValue::String(self.module_name.clone()),
            ),
            (
                "sourceProfile".to_string(),
                JsonValue::String(self.source_profile.as_str().to_string()),
            ),
            (
                "requires".to_string(),
                JsonValue::Array(
                    self.requires
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "provides".to_string(),
                JsonValue::Array(
                    self.provides
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "denies".to_string(),
                JsonValue::Array(
                    self.denies
                        .iter()
                        .map(|s| JsonValue::String(s.clone()))
                        .collect(),
                ),
            ),
            (
                "structs".to_string(),
                JsonValue::Array(
                    self.structs
                        .iter()
                        .map(|st| {
                            JsonValue::Object(vec![
                                ("name".to_string(), JsonValue::String(st.name.clone())),
                                ("index".to_string(), JsonValue::Number(st.index as f64)),
                                ("exported".to_string(), JsonValue::Bool(st.exported)),
                                (
                                    "fields".to_string(),
                                    JsonValue::Array(
                                        st.fields
                                            .iter()
                                            .map(|f| {
                                                JsonValue::Object(vec![
                                                    (
                                                        "name".to_string(),
                                                        JsonValue::String(f.name.clone()),
                                                    ),
                                                    (
                                                        "index".to_string(),
                                                        JsonValue::Number(f.index as f64),
                                                    ),
                                                    ("type".to_string(), f.field_type.to_json()),
                                                ])
                                            })
                                            .collect(),
                                    ),
                                ),
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
                        .map(|en| {
                            JsonValue::Object(vec![
                                ("name".to_string(), JsonValue::String(en.name.clone())),
                                ("index".to_string(), JsonValue::Number(en.index as f64)),
                                ("exported".to_string(), JsonValue::Bool(en.exported)),
                                (
                                    "variants".to_string(),
                                    JsonValue::Array(
                                        en.variants
                                            .iter()
                                            .map(|v| {
                                                JsonValue::Object(vec![
                                                    (
                                                        "name".to_string(),
                                                        JsonValue::String(v.name.clone()),
                                                    ),
                                                    (
                                                        "tag".to_string(),
                                                        JsonValue::Number(v.tag as f64),
                                                    ),
                                                    (
                                                        "payloadTypes".to_string(),
                                                        JsonValue::Array(
                                                            v.payload_types
                                                                .iter()
                                                                .map(|pt| pt.to_json())
                                                                .collect(),
                                                        ),
                                                    ),
                                                ])
                                            })
                                            .collect(),
                                    ),
                                ),
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
                                ("slot".to_string(), JsonValue::Number(g.slot as f64)),
                                ("mutable".to_string(), JsonValue::Bool(g.mutable)),
                                ("isConst".to_string(), JsonValue::Bool(g.is_const)),
                                ("exported".to_string(), JsonValue::Bool(g.exported)),
                                ("type".to_string(), g.var_type.to_json()),
                                ("init".to_string(), g.init.to_json()),
                                ("span".to_string(), g.span.to_json()),
                            ])
                        })
                        .collect(),
                ),
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
                                ("isAsync".to_string(), JsonValue::Bool(f.is_async)),
                                ("isEntry".to_string(), JsonValue::Bool(f.is_entry)),
                                ("isSynthetic".to_string(), JsonValue::Bool(f.is_synthetic)),
                                (
                                    "params".to_string(),
                                    JsonValue::Array(
                                        f.params.iter().map(|p| p.to_json()).collect(),
                                    ),
                                ),
                                (
                                    "locals".to_string(),
                                    JsonValue::Array(
                                        f.locals.iter().map(|l| l.to_json()).collect(),
                                    ),
                                ),
                                ("returnType".to_string(), f.return_type.to_json()),
                                (
                                    "effects".to_string(),
                                    JsonValue::Array(
                                        f.effects
                                            .iter()
                                            .map(|e| JsonValue::String(e.clone()))
                                            .collect(),
                                    ),
                                ),
                                (
                                    "body".to_string(),
                                    JsonValue::Array(
                                        f.body.iter().map(|s| s.to_json()).collect(),
                                    ),
                                ),
                                ("span".to_string(), f.span.to_json()),
                            ])
                        })
                        .collect(),
                ),
            ),
        ];
        if let Some(entry) = &self.entry_function {
            entries.push(("entryFunction".to_string(), JsonValue::String(entry.clone())));
        }
        JsonValue::Object(entries)
    }
}

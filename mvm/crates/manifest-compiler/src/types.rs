use std::collections::{HashMap, HashSet};

use crate::ast::TypeNode;
use crate::diagnostic::{Diagnostic, SourceSpan};
use crate::json::JsonValue;

#[derive(Debug, Clone, PartialEq)]
pub struct StructFieldType {
    pub name: String,
    pub field_type: SemanticType,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumVariantType {
    pub name: String,
    pub tag: usize,
    pub payload: Vec<SemanticType>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SemanticType {
    I64,
    F64,
    Bool,
    Str,
    Void,
    Any,
    TypeParam(String),
    Array(Box<SemanticType>),
    Map {
        key: Box<SemanticType>,
        value: Box<SemanticType>,
    },
    Result {
        ok: Box<SemanticType>,
        err: Box<SemanticType>,
    },
    Struct {
        name: String,
        type_args: Vec<SemanticType>,
        fields: Vec<StructFieldType>,
    },
    Enum {
        name: String,
        type_args: Vec<SemanticType>,
        variants: Vec<EnumVariantType>,
    },
}

impl SemanticType {
    pub fn kind_str(&self) -> &'static str {
        match self {
            SemanticType::I64 => "i64",
            SemanticType::F64 => "f64",
            SemanticType::Bool => "bool",
            SemanticType::Str => "str",
            SemanticType::Void => "void",
            SemanticType::Any => "any",
            SemanticType::TypeParam(_) => "type_param",
            SemanticType::Array(_) => "array",
            SemanticType::Map { .. } => "map",
            SemanticType::Result { .. } => "result",
            SemanticType::Struct { .. } => "struct",
            SemanticType::Enum { .. } => "enum",
        }
    }

    pub fn format_type(&self) -> String {
        match self {
            SemanticType::I64
            | SemanticType::F64
            | SemanticType::Bool
            | SemanticType::Str
            | SemanticType::Void
            | SemanticType::Any => self.kind_str().to_string(),
            SemanticType::TypeParam(n) => n.clone(),
            SemanticType::Array(elem) => format!("Array<{}>", elem.format_type()),
            SemanticType::Map { key, value } => {
                format!("Map<{}, {}>", key.format_type(), value.format_type())
            }
            SemanticType::Result { ok, err } => {
                format!("Result<{}, {}>", ok.format_type(), err.format_type())
            }
            SemanticType::Struct {
                name, type_args, ..
            }
            | SemanticType::Enum {
                name, type_args, ..
            } => {
                if type_args.is_empty() {
                    name.clone()
                } else {
                    let args: Vec<String> = type_args.iter().map(|t| t.format_type()).collect();
                    format!("{name}<{}>", args.join(", "))
                }
            }
        }
    }

    pub fn to_json(&self) -> JsonValue {
        match self {
            SemanticType::I64
            | SemanticType::F64
            | SemanticType::Bool
            | SemanticType::Str
            | SemanticType::Void
            | SemanticType::Any => {
                JsonValue::Object(vec![("kind".to_string(), JsonValue::String(self.kind_str().to_string()))])
            }
            SemanticType::TypeParam(name) => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("type_param".to_string())),
                ("name".to_string(), JsonValue::String(name.clone())),
            ]),
            SemanticType::Array(elem) => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("array".to_string())),
                ("element".to_string(), elem.to_json()),
            ]),
            SemanticType::Map { key, value } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("map".to_string())),
                ("key".to_string(), key.to_json()),
                ("value".to_string(), value.to_json()),
            ]),
            SemanticType::Result { ok, err } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("result".to_string())),
                ("ok".to_string(), ok.to_json()),
                ("err".to_string(), err.to_json()),
            ]),
            SemanticType::Struct {
                name,
                type_args,
                fields,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("struct".to_string())),
                ("name".to_string(), JsonValue::String(name.clone())),
                (
                    "typeArgs".to_string(),
                    JsonValue::Array(type_args.iter().map(|t| t.to_json()).collect()),
                ),
                (
                    "fields".to_string(),
                    JsonValue::Array(
                        fields
                            .iter()
                            .map(|f| {
                                JsonValue::Object(vec![
                                    ("name".to_string(), JsonValue::String(f.name.clone())),
                                    ("type".to_string(), f.field_type.to_json()),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ]),
            SemanticType::Enum {
                name,
                type_args,
                variants,
            } => JsonValue::Object(vec![
                ("kind".to_string(), JsonValue::String("enum".to_string())),
                ("name".to_string(), JsonValue::String(name.clone())),
                (
                    "typeArgs".to_string(),
                    JsonValue::Array(type_args.iter().map(|t| t.to_json()).collect()),
                ),
                (
                    "variants".to_string(),
                    JsonValue::Array(
                        variants
                            .iter()
                            .map(|v| {
                                JsonValue::Object(vec![
                                    ("name".to_string(), JsonValue::String(v.name.clone())),
                                    ("tag".to_string(), JsonValue::Number(v.tag as f64)),
                                    (
                                        "payload".to_string(),
                                        JsonValue::Array(
                                            v.payload.iter().map(|p| p.to_json()).collect(),
                                        ),
                                    ),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ]),
        }
    }
}

pub fn types_compatible(expected: &SemanticType, actual: &SemanticType) -> bool {
    if matches!(expected, SemanticType::Any) || matches!(actual, SemanticType::Any) {
        return true;
    }
    match (expected, actual) {
        (SemanticType::I64, SemanticType::I64)
        | (SemanticType::F64, SemanticType::F64)
        | (SemanticType::Bool, SemanticType::Bool)
        | (SemanticType::Str, SemanticType::Str)
        | (SemanticType::Void, SemanticType::Void) => true,
        (SemanticType::TypeParam(a), SemanticType::TypeParam(b)) => a == b,
        (SemanticType::Array(a), SemanticType::Array(b)) => types_compatible(a, b),
        (
            SemanticType::Map { key: ak, value: av },
            SemanticType::Map { key: bk, value: bv },
        ) => types_compatible(ak, bk) && types_compatible(av, bv),
        (
            SemanticType::Result { ok: ao, err: ae },
            SemanticType::Result { ok: bo, err: be },
        ) => types_compatible(ao, bo) && types_compatible(ae, be),
        (
            SemanticType::Struct {
                name: an,
                type_args: aa,
                ..
            },
            SemanticType::Struct {
                name: bn,
                type_args: ba,
                ..
            },
        ) => {
            an == bn
                && aa.len() == ba.len()
                && aa.iter().zip(ba.iter()).all(|(x, y)| types_compatible(x, y))
        }
        (
            SemanticType::Enum {
                name: an,
                type_args: aa,
                ..
            },
            SemanticType::Enum {
                name: bn,
                type_args: ba,
                ..
            },
        ) => {
            an == bn
                && aa.len() == ba.len()
                && aa.iter().zip(ba.iter()).all(|(x, y)| types_compatible(x, y))
        }
        _ => false,
    }
}

pub fn substitute_type_params(
    ty: &SemanticType,
    bindings: &HashMap<String, SemanticType>,
) -> SemanticType {
    match ty {
        SemanticType::TypeParam(name) => bindings.get(name).cloned().unwrap_or_else(|| ty.clone()),
        SemanticType::Array(elem) => {
            SemanticType::Array(Box::new(substitute_type_params(elem, bindings)))
        }
        SemanticType::Map { key, value } => SemanticType::Map {
            key: Box::new(substitute_type_params(key, bindings)),
            value: Box::new(substitute_type_params(value, bindings)),
        },
        SemanticType::Result { ok, err } => SemanticType::Result {
            ok: Box::new(substitute_type_params(ok, bindings)),
            err: Box::new(substitute_type_params(err, bindings)),
        },
        SemanticType::Struct {
            name,
            type_args,
            fields,
        } => SemanticType::Struct {
            name: name.clone(),
            type_args: type_args
                .iter()
                .map(|t| substitute_type_params(t, bindings))
                .collect(),
            fields: fields
                .iter()
                .map(|f| StructFieldType {
                    name: f.name.clone(),
                    field_type: substitute_type_params(&f.field_type, bindings),
                })
                .collect(),
        },
        SemanticType::Enum {
            name,
            type_args,
            variants,
        } => SemanticType::Enum {
            name: name.clone(),
            type_args: type_args
                .iter()
                .map(|t| substitute_type_params(t, bindings))
                .collect(),
            variants: variants
                .iter()
                .map(|v| EnumVariantType {
                    name: v.name.clone(),
                    tag: v.tag,
                    payload: v
                        .payload
                        .iter()
                        .map(|p| substitute_type_params(p, bindings))
                        .collect(),
                })
                .collect(),
        },
        other => other.clone(),
    }
}

#[derive(Debug, Clone)]
pub struct FunctionSignature {
    pub name: String,
    pub module_name: String,
    pub exported: bool,
    pub is_async: bool,
    pub type_params: Vec<String>,
    pub params: Vec<(String, SemanticType)>,
    pub return_type: SemanticType,
    pub declared_effects: Vec<String>,
    pub has_explicit_effects: bool,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct StdIntrinsicSpec {
    pub symbol: &'static str,
    pub aliases: &'static [&'static str],
    pub variadic_any: bool,
    pub capability: &'static str,
}

pub fn intrinsic_params(spec: &StdIntrinsicSpec) -> Vec<SemanticType> {
    match spec.symbol {
        "console.print" => vec![SemanticType::Any],
        "std::conv::to_str" | "std::str::len" => vec![SemanticType::Any],
        "std::conv::to_f64" | "std::math::abs" => vec![SemanticType::I64],
        "std::conv::to_i64" | "std::math::abs_f64" | "std::math::sqrt" => vec![SemanticType::F64],
        "std::math::min" | "std::math::max" => vec![SemanticType::I64, SemanticType::I64],
        "std::str::upper"
        | "std::str::lower"
        | "std::str::trim"
        | "fs.read_text"
        | "net.get"
        | "db.query"
        | "crypto.hash" => vec![SemanticType::Str],
        "std::str::contains" | "fs.write_text" => vec![SemanticType::Str, SemanticType::Str],
        "time.now" => Vec::new(),
        _ => Vec::new(),
    }
}

pub fn intrinsic_return_type(spec: &StdIntrinsicSpec) -> SemanticType {
    match spec.symbol {
        "console.print" => SemanticType::Void,
        "std::conv::to_str"
        | "std::str::upper"
        | "std::str::lower"
        | "std::str::trim"
        | "fs.read_text"
        | "net.get"
        | "db.query"
        | "crypto.hash" => SemanticType::Str,
        "std::conv::to_f64" | "std::math::abs_f64" | "std::math::sqrt" => SemanticType::F64,
        "std::conv::to_i64"
        | "std::math::abs"
        | "std::math::min"
        | "std::math::max"
        | "std::str::len"
        | "time.now" => SemanticType::I64,
        "std::str::contains" | "fs.write_text" => SemanticType::Bool,
        _ => SemanticType::Any,
    }
}

pub const STD_INTRINSICS: &[StdIntrinsicSpec] = &[
    StdIntrinsicSpec {
        symbol: "console.print",
        aliases: &[
            "print",
            "println",
            "std::io::print",
            "std::io::println",
            "console.print",
        ],
        variadic_any: true,
        capability: "console",
    },
    StdIntrinsicSpec {
        symbol: "std::conv::to_str",
        aliases: &["to_str", "std::conv::to_str"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::conv::to_f64",
        aliases: &["to_f64", "std::conv::to_f64"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::conv::to_i64",
        aliases: &["to_i64", "std::conv::to_i64"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::math::abs",
        aliases: &["abs", "math.abs", "std::math::abs"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::math::abs_f64",
        aliases: &["abs_f64", "std::math::abs_f64"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::math::min",
        aliases: &["min", "math.min", "std::math::min"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::math::max",
        aliases: &["max", "math.max", "std::math::max"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::math::sqrt",
        aliases: &["sqrt", "math.sqrt", "std::math::sqrt"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::str::len",
        aliases: &["len", "str.len", "std::str::len"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::str::upper",
        aliases: &["str.upper", "std::str::upper"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::str::lower",
        aliases: &["str.lower", "std::str::lower"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::str::trim",
        aliases: &["str.trim", "std::str::trim"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "std::str::contains",
        aliases: &["str.contains", "std::str::contains"],
        variadic_any: false,
        capability: "pure",
    },
    StdIntrinsicSpec {
        symbol: "time.now",
        aliases: &["time.now", "std::time::now"],
        variadic_any: false,
        capability: "time",
    },
    StdIntrinsicSpec {
        symbol: "fs.read_text",
        aliases: &["fs.read_text", "std::fs::read_text"],
        variadic_any: false,
        capability: "fs.read",
    },
    StdIntrinsicSpec {
        symbol: "fs.write_text",
        aliases: &["fs.write_text", "std::fs::write_text"],
        variadic_any: false,
        capability: "fs.write",
    },
    StdIntrinsicSpec {
        symbol: "net.get",
        aliases: &["net.get", "std::net::get", "fetch"],
        variadic_any: false,
        capability: "net",
    },
    StdIntrinsicSpec {
        symbol: "db.query",
        aliases: &["db.query", "std::db::query"],
        variadic_any: false,
        capability: "db",
    },
    StdIntrinsicSpec {
        symbol: "crypto.hash",
        aliases: &["crypto.hash", "std::crypto::sha256", "std::crypto::hash"],
        variadic_any: false,
        capability: "crypto",
    },
];

pub fn lookup_std_intrinsic(callee: &str) -> Option<&'static StdIntrinsicSpec> {
    STD_INTRINSICS.iter().find(|s| s.aliases.contains(&callee))
}

pub fn resolve_type_node(
    node: &TypeNode,
    structs: &HashMap<String, SemanticType>,
    enums: &HashMap<String, SemanticType>,
    type_params: &HashSet<String>,
    diagnostics: &mut Vec<Diagnostic>,
) -> SemanticType {
    match node {
        TypeNode::InferredType { .. } => SemanticType::Any,
        TypeNode::PrimitiveType { name, .. } => match name.as_str() {
            "i64" => SemanticType::I64,
            "f64" => SemanticType::F64,
            "bool" => SemanticType::Bool,
            "str" => SemanticType::Str,
            "void" => SemanticType::Void,
            _ => SemanticType::Any,
        },
        TypeNode::ArrayType { element_type, .. } => SemanticType::Array(Box::new(
            resolve_type_node(element_type, structs, enums, type_params, diagnostics),
        )),
        TypeNode::MapType {
            key_type,
            value_type,
            ..
        } => SemanticType::Map {
            key: Box::new(resolve_type_node(
                key_type,
                structs,
                enums,
                type_params,
                diagnostics,
            )),
            value: Box::new(resolve_type_node(
                value_type,
                structs,
                enums,
                type_params,
                diagnostics,
            )),
        },
        TypeNode::ResultType {
            ok_type, err_type, ..
        } => SemanticType::Result {
            ok: Box::new(resolve_type_node(
                ok_type,
                structs,
                enums,
                type_params,
                diagnostics,
            )),
            err: Box::new(resolve_type_node(
                err_type,
                structs,
                enums,
                type_params,
                diagnostics,
            )),
        },
        TypeNode::NamedType {
            name,
            type_args,
            span,
        } => {
            if type_params.contains(name) {
                return SemanticType::TypeParam(name.clone());
            }
            if let Some(SemanticType::Struct {
                name: s_name,
                fields,
                ..
            }) = structs.get(name)
            {
                let resolved_args = type_args
                    .iter()
                    .map(|a| resolve_type_node(a, structs, enums, type_params, diagnostics))
                    .collect();
                return SemanticType::Struct {
                    name: s_name.clone(),
                    type_args: resolved_args,
                    fields: fields.clone(),
                };
            }
            if let Some(SemanticType::Enum {
                name: e_name,
                variants,
                ..
            }) = enums.get(name)
            {
                let resolved_args = type_args
                    .iter()
                    .map(|a| resolve_type_node(a, structs, enums, type_params, diagnostics))
                    .collect();
                return SemanticType::Enum {
                    name: e_name.clone(),
                    type_args: resolved_args,
                    variants: variants.clone(),
                };
            }
            diagnostics.push(Diagnostic::error(
                "E_UNKNOWN_TYPE",
                format!("Unknown type '{name}'"),
                span,
            ));
            SemanticType::Any
        }
    }
}

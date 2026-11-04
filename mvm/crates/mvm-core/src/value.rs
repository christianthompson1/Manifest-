use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Void,
    I64(i64),
    F64(f64),
    Bool(bool),
    Str(String),
    ArrayRef(usize),
    MapRef(usize),
    StructRef(usize),
    EnumRef(usize),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Void => "void",
            Value::I64(_) => "i64",
            Value::F64(_) => "f64",
            Value::Bool(_) => "bool",
            Value::Str(_) => "str",
            Value::ArrayRef(_) => "Array",
            Value::MapRef(_) => "Map",
            Value::StructRef(_) => "Struct",
            Value::EnumRef(_) => "Enum",
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Void => write!(f, "void"),
            Value::I64(v) => write!(f, "{}", v),
            Value::F64(v) => {
                if v.fract() == 0.0 && v.is_finite() {
                    write!(f, "{}", *v)
                } else {
                    write!(f, "{}", v)
                }
            }
            Value::Bool(b) => write!(f, "{}", b),
            Value::Str(s) => write!(f, "{}", s),
            Value::ArrayRef(id) => write!(f, "<Array#{}>", id),
            Value::MapRef(id) => write!(f, "<Map#{}>", id),
            Value::StructRef(id) => write!(f, "<Struct#{}>", id),
            Value::EnumRef(id) => write!(f, "<Enum#{}>", id),
        }
    }
}

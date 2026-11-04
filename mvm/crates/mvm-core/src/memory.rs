use std::collections::BTreeMap;

use crate::errors::MvmError;
use crate::value::Value;

#[derive(Debug, Clone)]
pub enum HeapObject {
    Array(Vec<Value>),
    Map(BTreeMap<String, Value>),
    Struct {
        struct_idx: u32,
        fields: Vec<Value>,
    },
    Enum {
        enum_idx: u32,
        variant_idx: u16,
        payload: Vec<Value>,
    },
}

pub struct HeapArena {
    objects: Vec<HeapObject>,
    max_objects: usize,
}

impl HeapArena {
    pub fn new(max_objects: usize) -> Self {
        Self {
            objects: Vec::new(),
            max_objects,
        }
    }

    pub fn len(&self) -> usize {
        self.objects.len()
    }

    pub fn is_empty(&self) -> bool {
        self.objects.is_empty()
    }

    pub fn alloc(&mut self, obj: HeapObject) -> Result<usize, MvmError> {
        if self.objects.len() >= self.max_objects {
            return Err(MvmError::MemoryLimitExceeded {
                limit: self.max_objects,
            });
        }
        let id = self.objects.len();
        self.objects.push(obj);
        Ok(id)
    }

    pub fn get(&self, id: usize) -> Result<&HeapObject, MvmError> {
        self.objects.get(id).ok_or_else(|| MvmError::RuntimeTrap {
            message: format!("Invalid heap object reference #{}", id),
            line: None,
        })
    }

    pub fn get_mut(&mut self, id: usize) -> Result<&mut HeapObject, MvmError> {
        self.objects
            .get_mut(id)
            .ok_or_else(|| MvmError::RuntimeTrap {
                message: format!("Invalid heap object reference #{}", id),
                line: None,
            })
    }

    pub fn format_value(&self, val: &Value, depth: usize) -> String {
        if depth > 6 {
            return "...".to_string();
        }
        match val {
            Value::ArrayRef(id) => match self.objects.get(*id) {
                Some(HeapObject::Array(items)) => {
                    let parts: Vec<String> = items
                        .iter()
                        .map(|v| self.format_value(v, depth + 1))
                        .collect();
                    format!("[{}]", parts.join(", "))
                }
                _ => format!("<Array#{}>", id),
            },
            Value::MapRef(id) => match self.objects.get(*id) {
                Some(HeapObject::Map(entries)) => {
                    let parts: Vec<String> = entries
                        .iter()
                        .map(|(k, v)| format!("{}: {}", k, self.format_value(v, depth + 1)))
                        .collect();
                    format!("{{{}}}", parts.join(", "))
                }
                _ => format!("<Map#{}>", id),
            },
            Value::StructRef(id) => match self.objects.get(*id) {
                Some(HeapObject::Struct { fields, .. }) => {
                    let parts: Vec<String> = fields
                        .iter()
                        .map(|v| self.format_value(v, depth + 1))
                        .collect();
                    format!("Struct({})", parts.join(", "))
                }
                _ => format!("<Struct#{}>", id),
            },
            Value::EnumRef(id) => match self.objects.get(*id) {
                Some(HeapObject::Enum {
                    variant_idx,
                    payload,
                    ..
                }) => {
                    if payload.is_empty() {
                        format!("Variant#{}", variant_idx)
                    } else {
                        let parts: Vec<String> = payload
                            .iter()
                            .map(|v| self.format_value(v, depth + 1))
                            .collect();
                        format!("Variant#{}({})", variant_idx, parts.join(", "))
                    }
                }
                _ => format!("<Enum#{}>", id),
            },
            other => other.to_string(),
        }
    }
}

use std::collections::{BTreeMap, HashSet};

use crate::errors::MvmError;
use crate::frame::CallFrame;
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
    Bytes(Vec<u8>),
}

#[derive(Debug, Clone, Default)]
pub struct GcStats {
    pub collections: usize,
    pub objects_allocated: usize,
    pub objects_reclaimed: usize,
    pub live_objects: usize,
    pub peak_live: usize,
}

pub struct HeapArena {
    objects: Vec<Option<HeapObject>>,
    free_list: Vec<usize>,
    live_count: usize,
    max_objects: usize,
    pub stats: GcStats,
}

impl HeapArena {
    pub fn new(max_objects: usize) -> Self {
        Self {
            objects: Vec::new(),
            free_list: Vec::new(),
            live_count: 0,
            max_objects,
            stats: GcStats::default(),
        }
    }

    pub fn len(&self) -> usize {
        self.live_count
    }

    pub fn is_empty(&self) -> bool {
        self.live_count == 0
    }

    pub fn alloc(&mut self, obj: HeapObject) -> Result<usize, MvmError> {
        if self.live_count >= self.max_objects {
            return Err(MvmError::MemoryLimitExceeded {
                limit: self.max_objects,
            });
        }

        let id = if let Some(free_id) = self.free_list.pop() {
            self.objects[free_id] = Some(obj);
            free_id
        } else {
            let id = self.objects.len();
            self.objects.push(Some(obj));
            id
        };

        self.live_count += 1;
        self.stats.objects_allocated += 1;
        self.stats.live_objects = self.live_count;
        if self.live_count > self.stats.peak_live {
            self.stats.peak_live = self.live_count;
        }

        Ok(id)
    }

    pub fn get(&self, id: usize) -> Result<&HeapObject, MvmError> {
        self.objects
            .get(id)
            .and_then(|opt| opt.as_ref())
            .ok_or_else(|| MvmError::RuntimeTrap {
                message: format!("Invalid or collected heap object reference #{}", id),
                line: None,
            })
    }

    pub fn get_mut(&mut self, id: usize) -> Result<&mut HeapObject, MvmError> {
        self.objects
            .get_mut(id)
            .and_then(|opt| opt.as_mut())
            .ok_or_else(|| MvmError::RuntimeTrap {
                message: format!("Invalid or collected heap object reference #{}", id),
                line: None,
            })
    }

    /// Mark-and-sweep garbage collection:
    /// Scans stack roots, global roots, and active call frames, marks all reachable objects,
    /// and sweeps unreachable slots back into the free_list.
    pub fn collect_garbage(
        &mut self,
        stack_roots: &[Value],
        global_roots: &[Value],
        frame_roots: &[CallFrame],
    ) {
        self.stats.collections += 1;
        let mut marked = HashSet::new();

        // 1. Mark phase
        for root in stack_roots {
            self.mark_value(root, &mut marked);
        }
        for root in global_roots {
            self.mark_value(root, &mut marked);
        }
        for frame in frame_roots {
            for local in &frame.locals {
                self.mark_value(local, &mut marked);
            }
        }

        // 2. Sweep phase
        for i in 0..self.objects.len() {
            if self.objects[i].is_some() && !marked.contains(&i) {
                self.objects[i] = None;
                self.free_list.push(i);
                self.live_count = self.live_count.saturating_sub(1);
                self.stats.objects_reclaimed += 1;
            }
        }
        self.stats.live_objects = self.live_count;
    }

    fn mark_value(&self, val: &Value, marked: &mut HashSet<usize>) {
        let id = match val {
            Value::ArrayRef(id)
            | Value::MapRef(id)
            | Value::StructRef(id)
            | Value::EnumRef(id) => *id,
            _ => return,
        };

        if !marked.insert(id) {
            return;
        }

        if let Some(Some(obj)) = self.objects.get(id) {
            match obj {
                HeapObject::Array(items) => {
                    for item in items {
                        self.mark_value(item, marked);
                    }
                }
                HeapObject::Map(entries) => {
                    for item in entries.values() {
                        self.mark_value(item, marked);
                    }
                }
                HeapObject::Struct { fields, .. } => {
                    for field in fields {
                        self.mark_value(field, marked);
                    }
                }
                HeapObject::Enum { payload, .. } => {
                    for p in payload {
                        self.mark_value(p, marked);
                    }
                }
                HeapObject::Bytes(_) => {}
            }
        }
    }

    pub fn format_value(&self, val: &Value, depth: usize) -> String {
        if depth > 6 {
            return "...".to_string();
        }
        match val {
            Value::ArrayRef(id) => match self.objects.get(*id).and_then(|o| o.as_ref()) {
                Some(HeapObject::Array(items)) => {
                    let parts: Vec<String> = items
                        .iter()
                        .map(|v| self.format_value(v, depth + 1))
                        .collect();
                    format!("[{}]", parts.join(", "))
                }
                _ => format!("<Array#{}>", id),
            },
            Value::MapRef(id) => match self.objects.get(*id).and_then(|o| o.as_ref()) {
                Some(HeapObject::Map(entries)) => {
                    let parts: Vec<String> = entries
                        .iter()
                        .map(|(k, v)| format!("{}: {}", k, self.format_value(v, depth + 1)))
                        .collect();
                    format!("{{{}}}", parts.join(", "))
                }
                _ => format!("<Map#{}>", id),
            },
            Value::StructRef(id) => match self.objects.get(*id).and_then(|o| o.as_ref()) {
                Some(HeapObject::Struct { fields, .. }) => {
                    let parts: Vec<String> = fields
                        .iter()
                        .map(|v| self.format_value(v, depth + 1))
                        .collect();
                    format!("Struct({})", parts.join(", "))
                }
                _ => format!("<Struct#{}>", id),
            },
            Value::EnumRef(id) => match self.objects.get(*id).and_then(|o| o.as_ref()) {
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

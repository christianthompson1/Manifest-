use std::collections::{BTreeMap, HashSet};

use crate::errors::MvmError;
use crate::frame::CallFrame;
use crate::value::Value;

pub const DEFAULT_MAX_HEAP_BYTES: usize = 16 * 1024 * 1024;
const OBJECT_HEADER_BYTES: usize = 32;
const VALUE_SLOT_BYTES: usize = 16;
const MAP_ENTRY_OVERHEAD_BYTES: usize = 32;

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
    pub allocated_bytes: usize,
    pub peak_bytes: usize,
    pub bytes_reclaimed: usize,
    pub gc_threshold_objects: usize,
    pub gc_threshold_bytes: usize,
}

#[derive(Clone, Copy)]
pub struct GcRoots<'a> {
    pub stack: &'a [Value],
    pub globals: &'a [Value],
    pub frames: &'a [CallFrame],
    pub temps: &'a [Value],
}

pub fn estimate_value_bytes(val: &Value) -> Result<usize, MvmError> {
    match val {
        Value::Str(s) => {
            VALUE_SLOT_BYTES
                .checked_add(s.len())
                .ok_or(MvmError::HeapBytesLimitExceeded {
                    requested: usize::MAX,
                    used: 0,
                    limit: 0,
                })
        }
        _ => Ok(VALUE_SLOT_BYTES),
    }
}

pub fn estimate_object_bytes(obj: &HeapObject) -> Result<usize, MvmError> {
    let mut total = OBJECT_HEADER_BYTES;
    let add_checked = |acc: usize, delta: usize| -> Result<usize, MvmError> {
        acc.checked_add(delta)
            .ok_or(MvmError::HeapBytesLimitExceeded {
                requested: usize::MAX,
                used: 0,
                limit: 0,
            })
    };

    match obj {
        HeapObject::Array(items) => {
            for v in items {
                total = add_checked(total, estimate_value_bytes(v)?)?;
            }
        }
        HeapObject::Map(entries) => {
            for (k, v) in entries {
                let entry_bytes = MAP_ENTRY_OVERHEAD_BYTES
                    .checked_add(k.len())
                    .and_then(|n| n.checked_add(estimate_value_bytes(v).ok()?))
                    .ok_or(MvmError::HeapBytesLimitExceeded {
                        requested: usize::MAX,
                        used: 0,
                        limit: 0,
                    })?;
                total = add_checked(total, entry_bytes)?;
            }
        }
        HeapObject::Struct { fields, .. } => {
            for v in fields {
                total = add_checked(total, estimate_value_bytes(v)?)?;
            }
        }
        HeapObject::Enum { payload, .. } => {
            for v in payload {
                total = add_checked(total, estimate_value_bytes(v)?)?;
            }
        }
        HeapObject::Bytes(buf) => {
            total = add_checked(total, buf.len())?;
        }
    }
    Ok(total)
}

pub struct HeapArena {
    objects: Vec<Option<HeapObject>>,
    object_sizes: Vec<usize>,
    free_list: Vec<usize>,
    live_count: usize,
    max_objects: usize,
    allocated_bytes: usize,
    max_bytes: usize,
    gc_threshold_objects: usize,
    gc_threshold_bytes: usize,
    pub stats: GcStats,
}

impl HeapArena {
    pub fn new(max_objects: usize) -> Self {
        Self::with_limits(max_objects, DEFAULT_MAX_HEAP_BYTES)
    }

    pub fn with_limits(max_objects: usize, max_bytes: usize) -> Self {
        let gc_threshold_objects = if max_objects == 0 {
            0
        } else {
            (max_objects / 2).max(1).min(max_objects)
        };
        let gc_threshold_bytes = if max_bytes == 0 {
            0
        } else {
            (max_bytes / 2).max(OBJECT_HEADER_BYTES).min(max_bytes)
        };
        let stats = GcStats {
            gc_threshold_objects,
            gc_threshold_bytes,
            ..Default::default()
        };

        Self {
            objects: Vec::new(),
            object_sizes: Vec::new(),
            free_list: Vec::new(),
            live_count: 0,
            max_objects,
            allocated_bytes: 0,
            max_bytes,
            gc_threshold_objects,
            gc_threshold_bytes,
            stats,
        }
    }

    pub fn len(&self) -> usize {
        self.live_count
    }

    pub fn is_empty(&self) -> bool {
        self.live_count == 0
    }

    pub fn allocated_bytes(&self) -> usize {
        self.allocated_bytes
    }

    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    pub fn max_objects(&self) -> usize {
        self.max_objects
    }

    pub fn alloc(&mut self, obj: HeapObject) -> Result<usize, MvmError> {
        self.alloc_inner(obj, None)
    }

    pub fn alloc_with_roots(
        &mut self,
        obj: HeapObject,
        roots: GcRoots<'_>,
    ) -> Result<usize, MvmError> {
        self.alloc_inner(obj, Some(roots))
    }

    fn alloc_inner(
        &mut self,
        obj: HeapObject,
        roots: Option<GcRoots<'_>>,
    ) -> Result<usize, MvmError> {
        if self.max_objects == 0 {
            return Err(MvmError::MemoryLimitExceeded { limit: 0 });
        }

        let obj_bytes = estimate_object_bytes(&obj)?;
        if obj_bytes > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: obj_bytes,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }

        if let Some(r) = roots {
            let hits_hard_limit = self.live_count >= self.max_objects
                || self
                    .allocated_bytes
                    .checked_add(obj_bytes)
                    .is_none_or(|next| next > self.max_bytes);
            let hits_soft_limit = self.live_count >= self.gc_threshold_objects
                || self.allocated_bytes.saturating_add(obj_bytes) > self.gc_threshold_bytes;

            if hits_hard_limit || hits_soft_limit {
                self.collect_garbage_with_roots(r);
                self.update_gc_thresholds();
            }
        }

        if self.live_count >= self.max_objects {
            return Err(MvmError::MemoryLimitExceeded {
                limit: self.max_objects,
            });
        }

        let next_bytes = self.allocated_bytes.checked_add(obj_bytes).ok_or(
            MvmError::HeapBytesLimitExceeded {
                requested: obj_bytes,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            },
        )?;

        if next_bytes > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: obj_bytes,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }

        let id = if let Some(free_id) = self.free_list.pop() {
            self.objects[free_id] = Some(obj);
            self.object_sizes[free_id] = obj_bytes;
            free_id
        } else {
            let id = self.objects.len();
            self.objects.push(Some(obj));
            self.object_sizes.push(obj_bytes);
            id
        };

        self.live_count += 1;
        self.allocated_bytes = next_bytes;
        self.stats.objects_allocated += 1;
        self.stats.live_objects = self.live_count;
        self.stats.allocated_bytes = self.allocated_bytes;
        if self.live_count > self.stats.peak_live {
            self.stats.peak_live = self.live_count;
        }
        if self.allocated_bytes > self.stats.peak_bytes {
            self.stats.peak_bytes = self.allocated_bytes;
        }

        Ok(id)
    }

    pub fn array_push_with_roots(
        &mut self,
        id: usize,
        val: Value,
        line: Option<u32>,
        roots: GcRoots<'_>,
    ) -> Result<(), MvmError> {
        match self.get(id)? {
            HeapObject::Array(_) => {}
            _ => {
                return Err(MvmError::TypeMismatch {
                    expected: "Array",
                    actual: "non-array",
                    line,
                })
            }
        }

        let added = estimate_value_bytes(&val)?;
        if added > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: added,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }

        self.maybe_gc_before_growth(added, Some(roots));

        let new_total =
            self.allocated_bytes
                .checked_add(added)
                .ok_or(MvmError::HeapBytesLimitExceeded {
                    requested: added,
                    used: self.allocated_bytes,
                    limit: self.max_bytes,
                })?;
        if new_total > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: added,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }

        let new_obj_size =
            self.object_sizes[id]
                .checked_add(added)
                .ok_or(MvmError::HeapBytesLimitExceeded {
                    requested: added,
                    used: self.allocated_bytes,
                    limit: self.max_bytes,
                })?;

        match self.get_mut(id)? {
            HeapObject::Array(items) => {
                items.push(val);
            }
            _ => unreachable!(),
        }

        self.object_sizes[id] = new_obj_size;
        self.allocated_bytes = new_total;
        self.stats.allocated_bytes = new_total;
        if new_total > self.stats.peak_bytes {
            self.stats.peak_bytes = new_total;
        }
        Ok(())
    }

    pub fn array_set_with_roots(
        &mut self,
        id: usize,
        idx: i64,
        val: Value,
        line: Option<u32>,
        roots: GcRoots<'_>,
    ) -> Result<(), MvmError> {
        let old_elem_bytes = match self.get(id)? {
            HeapObject::Array(items) => {
                if idx < 0 || (idx as usize) >= items.len() {
                    return Err(MvmError::IndexOutOfBounds {
                        index: idx,
                        len: items.len(),
                        line,
                    });
                }
                estimate_value_bytes(&items[idx as usize])?
            }
            _ => {
                return Err(MvmError::TypeMismatch {
                    expected: "Array",
                    actual: "non-array heap object",
                    line,
                })
            }
        };

        let new_elem_bytes = estimate_value_bytes(&val)?;
        let net_increase = new_elem_bytes.saturating_sub(old_elem_bytes);
        if net_increase > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }
        if net_increase > 0 {
            self.maybe_gc_before_growth(net_increase, Some(roots));
        }

        let new_total = self
            .allocated_bytes
            .saturating_sub(old_elem_bytes)
            .checked_add(new_elem_bytes)
            .ok_or(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            })?;

        if new_total > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }

        let new_obj_size = self.object_sizes[id]
            .saturating_sub(old_elem_bytes)
            .checked_add(new_elem_bytes)
            .ok_or(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            })?;

        match self.get_mut(id)? {
            HeapObject::Array(items) => {
                items[idx as usize] = val;
            }
            _ => unreachable!(),
        }

        self.object_sizes[id] = new_obj_size;
        self.allocated_bytes = new_total;
        self.stats.allocated_bytes = new_total;
        if new_total > self.stats.peak_bytes {
            self.stats.peak_bytes = new_total;
        }
        Ok(())
    }

    pub fn map_set_with_roots(
        &mut self,
        id: usize,
        key: String,
        val: Value,
        line: Option<u32>,
        roots: GcRoots<'_>,
    ) -> Result<(), MvmError> {
        let (old_bytes, new_bytes) = match self.get(id)? {
            HeapObject::Map(entries) => match entries.get(&key) {
                Some(prev) => (estimate_value_bytes(prev)?, estimate_value_bytes(&val)?),
                None => {
                    let added = MAP_ENTRY_OVERHEAD_BYTES
                        .checked_add(key.len())
                        .and_then(|n| n.checked_add(estimate_value_bytes(&val).ok()?))
                        .ok_or(MvmError::HeapBytesLimitExceeded {
                            requested: usize::MAX,
                            used: self.allocated_bytes,
                            limit: self.max_bytes,
                        })?;
                    (0, added)
                }
            },
            _ => {
                return Err(MvmError::TypeMismatch {
                    expected: "Map",
                    actual: "non-map",
                    line,
                })
            }
        };

        let net_increase = new_bytes.saturating_sub(old_bytes);
        if net_increase > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }
        if net_increase > 0 {
            self.maybe_gc_before_growth(net_increase, Some(roots));
        }

        let new_total = self
            .allocated_bytes
            .saturating_sub(old_bytes)
            .checked_add(new_bytes)
            .ok_or(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            })?;

        if new_total > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }

        let new_obj_size = self.object_sizes[id]
            .saturating_sub(old_bytes)
            .checked_add(new_bytes)
            .ok_or(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            })?;

        match self.get_mut(id)? {
            HeapObject::Map(entries) => {
                entries.insert(key, val);
            }
            _ => unreachable!(),
        }

        self.object_sizes[id] = new_obj_size;
        self.allocated_bytes = new_total;
        self.stats.allocated_bytes = new_total;
        if new_total > self.stats.peak_bytes {
            self.stats.peak_bytes = new_total;
        }
        Ok(())
    }

    pub fn field_set_with_roots(
        &mut self,
        id: usize,
        field_idx: u16,
        val: Value,
        line: Option<u32>,
        roots: GcRoots<'_>,
    ) -> Result<(), MvmError> {
        let old_bytes = match self.get(id)? {
            HeapObject::Struct { fields, .. } => {
                if (field_idx as usize) >= fields.len() {
                    return Err(MvmError::RuntimeTrap {
                        message: format!("Struct field {} out of bounds", field_idx),
                        line,
                    });
                }
                estimate_value_bytes(&fields[field_idx as usize])?
            }
            _ => {
                return Err(MvmError::TypeMismatch {
                    expected: "Struct",
                    actual: "non-struct",
                    line,
                })
            }
        };

        let new_bytes = estimate_value_bytes(&val)?;
        let net_increase = new_bytes.saturating_sub(old_bytes);
        if net_increase > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }
        if net_increase > 0 {
            self.maybe_gc_before_growth(net_increase, Some(roots));
        }

        let new_total = self
            .allocated_bytes
            .saturating_sub(old_bytes)
            .checked_add(new_bytes)
            .ok_or(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            })?;

        if new_total > self.max_bytes {
            return Err(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            });
        }

        let new_obj_size = self.object_sizes[id]
            .saturating_sub(old_bytes)
            .checked_add(new_bytes)
            .ok_or(MvmError::HeapBytesLimitExceeded {
                requested: net_increase,
                used: self.allocated_bytes,
                limit: self.max_bytes,
            })?;

        match self.get_mut(id)? {
            HeapObject::Struct { fields, .. } => {
                fields[field_idx as usize] = val;
            }
            _ => unreachable!(),
        }

        self.object_sizes[id] = new_obj_size;
        self.allocated_bytes = new_total;
        self.stats.allocated_bytes = new_total;
        if new_total > self.stats.peak_bytes {
            self.stats.peak_bytes = new_total;
        }
        Ok(())
    }

    fn maybe_gc_before_growth(&mut self, growth_bytes: usize, roots: Option<GcRoots<'_>>) {
        if let Some(r) = roots {
            let hits_hard = self
                .allocated_bytes
                .checked_add(growth_bytes)
                .is_none_or(|n| n > self.max_bytes);
            let hits_soft =
                self.allocated_bytes.saturating_add(growth_bytes) > self.gc_threshold_bytes;
            if hits_hard || hits_soft {
                self.collect_garbage_with_roots(r);
                self.update_gc_thresholds();
            }
        }
    }

    fn update_gc_thresholds(&mut self) {
        if self.max_objects == 0 {
            self.gc_threshold_objects = 0;
        } else {
            let headroom = self
                .live_count
                .saturating_mul(2)
                .max(self.live_count.saturating_add(16));
            self.gc_threshold_objects = headroom.min(self.max_objects);
        }

        if self.max_bytes == 0 {
            self.gc_threshold_bytes = 0;
        } else {
            let byte_headroom = self
                .allocated_bytes
                .saturating_mul(2)
                .max(self.allocated_bytes.saturating_add(4096));
            self.gc_threshold_bytes = byte_headroom.min(self.max_bytes);
        }

        self.stats.gc_threshold_objects = self.gc_threshold_objects;
        self.stats.gc_threshold_bytes = self.gc_threshold_bytes;
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
    /// Scans stack roots, global roots, and active call frames, marks all reachable objects
    /// iteratively (cycle-safe), and sweeps unreachable slots back into the free_list.
    pub fn collect_garbage(
        &mut self,
        stack_roots: &[Value],
        global_roots: &[Value],
        frame_roots: &[CallFrame],
    ) {
        self.collect_garbage_with_roots(GcRoots {
            stack: stack_roots,
            globals: global_roots,
            frames: frame_roots,
            temps: &[],
        });
    }

    pub fn collect_garbage_with_roots(&mut self, roots: GcRoots<'_>) {
        self.stats.collections += 1;
        let mut marked = vec![false; self.objects.len()];
        let mut worklist: Vec<usize> = Vec::new();

        let enqueue = |val: &Value, marked: &mut [bool], worklist: &mut Vec<usize>| {
            let id = match val {
                Value::ArrayRef(id)
                | Value::MapRef(id)
                | Value::StructRef(id)
                | Value::EnumRef(id) => *id,
                _ => return,
            };
            if id < marked.len() && !marked[id] {
                marked[id] = true;
                worklist.push(id);
            }
        };

        // 1. Seed root set
        for root in roots.stack {
            enqueue(root, &mut marked, &mut worklist);
        }
        for root in roots.globals {
            enqueue(root, &mut marked, &mut worklist);
        }
        for frame in roots.frames {
            for local in &frame.locals {
                enqueue(local, &mut marked, &mut worklist);
            }
        }
        for temp in roots.temps {
            enqueue(temp, &mut marked, &mut worklist);
        }

        // 2. Iterative mark phase (handles arbitrary cycles and deep object graphs without stack overflow)
        while let Some(id) = worklist.pop() {
            if let Some(Some(obj)) = self.objects.get(id) {
                match obj {
                    HeapObject::Array(items) => {
                        for item in items {
                            enqueue(item, &mut marked, &mut worklist);
                        }
                    }
                    HeapObject::Map(entries) => {
                        for item in entries.values() {
                            enqueue(item, &mut marked, &mut worklist);
                        }
                    }
                    HeapObject::Struct { fields, .. } => {
                        for field in fields {
                            enqueue(field, &mut marked, &mut worklist);
                        }
                    }
                    HeapObject::Enum { payload, .. } => {
                        for p in payload {
                            enqueue(p, &mut marked, &mut worklist);
                        }
                    }
                    HeapObject::Bytes(_) => {}
                }
            }
        }

        // 3. Sweep phase
        for i in 0..self.objects.len() {
            if self.objects[i].is_some() && !marked[i] {
                self.objects[i] = None;
                let reclaimed_size = self.object_sizes[i];
                self.object_sizes[i] = 0;
                self.free_list.push(i);
                self.live_count = self.live_count.saturating_sub(1);
                self.allocated_bytes = self.allocated_bytes.saturating_sub(reclaimed_size);
                self.stats.objects_reclaimed += 1;
                self.stats.bytes_reclaimed =
                    self.stats.bytes_reclaimed.saturating_add(reclaimed_size);
            }
        }
        self.stats.live_objects = self.live_count;
        self.stats.allocated_bytes = self.allocated_bytes;
    }

    /// Iterative cycle-safe structural equality (coinductive bisimulation).
    /// Handles primitives (IEEE-754 `f64` where `NaN != NaN`), `Array`, `Map`,
    /// `Struct`, `Enum`, `Bytes`, shared references, cyclic graphs, and traps on invalid handles.
    pub fn values_equal(&self, a: &Value, b: &Value) -> Result<bool, MvmError> {
        let mut worklist: Vec<(Value, Value)> = vec![(a.clone(), b.clone())];
        let mut visited: HashSet<(usize, usize)> = HashSet::new();

        while let Some((lhs, rhs)) = worklist.pop() {
            match (lhs, rhs) {
                (Value::Void, Value::Void) => {}
                (Value::I64(x), Value::I64(y)) => {
                    if x != y {
                        return Ok(false);
                    }
                }
                (Value::F64(x), Value::F64(y)) => {
                    if x != y {
                        return Ok(false);
                    }
                }
                (Value::Bool(x), Value::Bool(y)) => {
                    if x != y {
                        return Ok(false);
                    }
                }
                (Value::Str(x), Value::Str(y)) => {
                    if x != y {
                        return Ok(false);
                    }
                }
                (Value::ArrayRef(id_a), Value::ArrayRef(id_b)) => {
                    let obj_a = self.get(id_a)?;
                    let obj_b = self.get(id_b)?;
                    if !visited.insert((id_a, id_b)) {
                        continue;
                    }
                    match (obj_a, obj_b) {
                        (HeapObject::Array(items_a), HeapObject::Array(items_b)) => {
                            if items_a.len() != items_b.len() {
                                return Ok(false);
                            }
                            for (va, vb) in items_a.iter().zip(items_b.iter()) {
                                worklist.push((va.clone(), vb.clone()));
                            }
                        }
                        (HeapObject::Bytes(bytes_a), HeapObject::Bytes(bytes_b)) => {
                            if bytes_a != bytes_b {
                                return Ok(false);
                            }
                        }
                        _ => return Ok(false),
                    }
                }
                (Value::MapRef(id_a), Value::MapRef(id_b)) => {
                    let obj_a = self.get(id_a)?;
                    let obj_b = self.get(id_b)?;
                    if !visited.insert((id_a, id_b)) {
                        continue;
                    }
                    match (obj_a, obj_b) {
                        (HeapObject::Map(map_a), HeapObject::Map(map_b)) => {
                            if map_a.len() != map_b.len() {
                                return Ok(false);
                            }
                            for (k, va) in map_a {
                                match map_b.get(k) {
                                    Some(vb) => worklist.push((va.clone(), vb.clone())),
                                    None => return Ok(false),
                                }
                            }
                        }
                        _ => return Ok(false),
                    }
                }
                (Value::StructRef(id_a), Value::StructRef(id_b)) => {
                    let obj_a = self.get(id_a)?;
                    let obj_b = self.get(id_b)?;
                    if !visited.insert((id_a, id_b)) {
                        continue;
                    }
                    match (obj_a, obj_b) {
                        (
                            HeapObject::Struct {
                                struct_idx: sa,
                                fields: fa,
                            },
                            HeapObject::Struct {
                                struct_idx: sb,
                                fields: fb,
                            },
                        ) => {
                            if sa != sb || fa.len() != fb.len() {
                                return Ok(false);
                            }
                            for (va, vb) in fa.iter().zip(fb.iter()) {
                                worklist.push((va.clone(), vb.clone()));
                            }
                        }
                        _ => return Ok(false),
                    }
                }
                (Value::EnumRef(id_a), Value::EnumRef(id_b)) => {
                    let obj_a = self.get(id_a)?;
                    let obj_b = self.get(id_b)?;
                    if !visited.insert((id_a, id_b)) {
                        continue;
                    }
                    match (obj_a, obj_b) {
                        (
                            HeapObject::Enum {
                                enum_idx: ea,
                                variant_idx: va,
                                payload: pa,
                            },
                            HeapObject::Enum {
                                enum_idx: eb,
                                variant_idx: vb,
                                payload: pb,
                            },
                        ) => {
                            if ea != eb || va != vb || pa.len() != pb.len() {
                                return Ok(false);
                            }
                            for (xa, xb) in pa.iter().zip(pb.iter()) {
                                worklist.push((xa.clone(), xb.clone()));
                            }
                        }
                        _ => return Ok(false),
                    }
                }
                _ => return Ok(false),
            }
        }
        Ok(true)
    }

    pub fn format_value(&self, val: &Value, depth: usize) -> String {
        let mut active = HashSet::new();
        self.format_value_inner(val, depth, &mut active)
    }

    fn format_value_inner(&self, val: &Value, depth: usize, active: &mut HashSet<usize>) -> String {
        if depth > 6 {
            return "...".to_string();
        }
        match val {
            Value::ArrayRef(id) => {
                if !active.insert(*id) {
                    return format!("<Cycle Array#{}>", id);
                }
                let out = match self.objects.get(*id).and_then(|o| o.as_ref()) {
                    Some(HeapObject::Array(items)) => {
                        let parts: Vec<String> = items
                            .iter()
                            .map(|v| self.format_value_inner(v, depth + 1, active))
                            .collect();
                        format!("[{}]", parts.join(", "))
                    }
                    _ => format!("<Array#{}>", id),
                };
                active.remove(id);
                out
            }
            Value::MapRef(id) => {
                if !active.insert(*id) {
                    return format!("<Cycle Map#{}>", id);
                }
                let out = match self.objects.get(*id).and_then(|o| o.as_ref()) {
                    Some(HeapObject::Map(entries)) => {
                        let parts: Vec<String> = entries
                            .iter()
                            .map(|(k, v)| {
                                format!("{}: {}", k, self.format_value_inner(v, depth + 1, active))
                            })
                            .collect();
                        format!("{{{}}}", parts.join(", "))
                    }
                    _ => format!("<Map#{}>", id),
                };
                active.remove(id);
                out
            }
            Value::StructRef(id) => {
                if !active.insert(*id) {
                    return format!("<Cycle Struct#{}>", id);
                }
                let out = match self.objects.get(*id).and_then(|o| o.as_ref()) {
                    Some(HeapObject::Struct { fields, .. }) => {
                        let parts: Vec<String> = fields
                            .iter()
                            .map(|v| self.format_value_inner(v, depth + 1, active))
                            .collect();
                        format!("Struct({})", parts.join(", "))
                    }
                    _ => format!("<Struct#{}>", id),
                };
                active.remove(id);
                out
            }
            Value::EnumRef(id) => {
                if !active.insert(*id) {
                    return format!("<Cycle Enum#{}>", id);
                }
                let out = match self.objects.get(*id).and_then(|o| o.as_ref()) {
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
                                .map(|v| self.format_value_inner(v, depth + 1, active))
                                .collect();
                            format!("Variant#{}({})", variant_idx, parts.join(", "))
                        }
                    }
                    _ => format!("<Enum#{}>", id),
                };
                active.remove(id);
                out
            }
            other => other.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_roots<'a>(
        stack: &'a [Value],
        globals: &'a [Value],
        frames: &'a [CallFrame],
        temps: &'a [Value],
    ) -> GcRoots<'a> {
        GcRoots {
            stack,
            globals,
            frames,
            temps,
        }
    }

    #[test]
    fn gc_preserves_all_root_classes_nested_graphs_and_reclaims_garbage() {
        let mut heap = HeapArena::with_limits(8, 8192);
        let leaf_stack = heap.alloc(HeapObject::Array(vec![Value::I64(1)])).unwrap();
        let outer_stack = heap
            .alloc(HeapObject::Array(vec![Value::ArrayRef(leaf_stack)]))
            .unwrap();
        let leaf_global = heap.alloc(HeapObject::Array(vec![Value::I64(2)])).unwrap();
        let outer_global = heap
            .alloc(HeapObject::Struct {
                struct_idx: 0,
                fields: vec![Value::ArrayRef(leaf_global)],
            })
            .unwrap();
        let leaf_frame = heap.alloc(HeapObject::Array(vec![Value::I64(3)])).unwrap();
        let outer_frame = heap
            .alloc(HeapObject::Enum {
                enum_idx: 0,
                variant_idx: 1,
                payload: vec![Value::ArrayRef(leaf_frame)],
            })
            .unwrap();
        let garbage = heap.alloc(HeapObject::Array(vec![Value::I64(99)])).unwrap();

        let stack = [Value::ArrayRef(outer_stack)];
        let globals = [Value::StructRef(outer_global)];
        let frame = CallFrame::new(0, 1, 0, vec![Value::EnumRef(outer_frame)]);
        let frames = [frame];

        heap.collect_garbage(&stack, &globals, &frames);
        assert_eq!(heap.len(), 6);
        assert_eq!(heap.stats.objects_reclaimed, 1);
        assert!(heap.get(leaf_stack).is_ok());
        assert!(heap.get(leaf_global).is_ok());
        assert!(heap.get(leaf_frame).is_ok());
        assert!(matches!(
            heap.get(garbage).unwrap_err(),
            MvmError::RuntimeTrap { .. }
        ));
    }

    #[test]
    fn gc_collects_unreachable_cycles_and_preserves_reachable_cycles() {
        let mut heap = HeapArena::with_limits(16, 16_384);
        // Reachable cycle: r0 <-> r1
        let r0 = heap.alloc(HeapObject::Array(vec![])).unwrap();
        let r1 = heap
            .alloc(HeapObject::Array(vec![Value::ArrayRef(r0)]))
            .unwrap();
        match heap.get_mut(r0).unwrap() {
            HeapObject::Array(items) => items.push(Value::ArrayRef(r1)),
            _ => unreachable!(),
        }

        // Unreachable cycle: g0 <-> g1
        let g0 = heap.alloc(HeapObject::Array(vec![])).unwrap();
        let g1 = heap
            .alloc(HeapObject::Array(vec![Value::ArrayRef(g0)]))
            .unwrap();
        match heap.get_mut(g0).unwrap() {
            HeapObject::Array(items) => items.push(Value::ArrayRef(g1)),
            _ => unreachable!(),
        }

        let stack = [Value::ArrayRef(r0)];
        heap.collect_garbage(&stack, &[], &[]);
        assert_eq!(heap.len(), 2);
        assert_eq!(heap.stats.objects_reclaimed, 2);
        assert!(heap.get(r0).is_ok());
        assert!(heap.get(r1).is_ok());
        assert!(heap.get(g0).is_err());
        assert!(heap.get(g1).is_err());
    }

    #[test]
    fn alloc_with_roots_triggers_gc_reclaims_and_errors_cleanly_when_full() {
        let mut heap = HeapArena::with_limits(2, 4096);
        let id0 = heap
            .alloc_with_roots(HeapObject::Array(vec![]), empty_roots(&[], &[], &[], &[]))
            .unwrap();
        let stack = [Value::ArrayRef(id0)];
        let _id1_garbage = heap
            .alloc_with_roots(
                HeapObject::Array(vec![]),
                empty_roots(&stack, &[], &[], &[]),
            )
            .unwrap();

        // Heap is at max_objects=2, id1 is unreachable so GC reclaims id1 and alloc succeeds
        let id2 = heap
            .alloc_with_roots(
                HeapObject::Array(vec![]),
                empty_roots(&stack, &[], &[], &[]),
            )
            .unwrap();
        assert!(heap.stats.collections >= 1);
        assert_eq!(heap.len(), 2);

        // Both id0 and id2 are rooted: allocating a 3rd MUST fail cleanly with MemoryLimitExceeded
        let stack_full = [Value::ArrayRef(id0), Value::ArrayRef(id2)];
        let bytes_before = heap.allocated_bytes();
        let err = heap
            .alloc_with_roots(
                HeapObject::Array(vec![]),
                empty_roots(&stack_full, &[], &[], &[]),
            )
            .unwrap_err();
        assert_eq!(err, MvmError::MemoryLimitExceeded { limit: 2 });
        assert_eq!(heap.len(), 2);
        assert_eq!(heap.allocated_bytes(), bytes_before);
    }

    #[test]
    fn byte_accounting_tracks_alloc_resize_and_reclaim_accurately() {
        let mut heap = HeapArena::with_limits(16, 256);
        let arr = heap
            .alloc_with_roots(HeapObject::Array(vec![]), empty_roots(&[], &[], &[], &[]))
            .unwrap();
        assert_eq!(heap.allocated_bytes(), OBJECT_HEADER_BYTES);

        let stack = [Value::ArrayRef(arr)];
        let big = "x".repeat(120);
        heap.array_push_with_roots(
            arr,
            Value::Str(big),
            None,
            empty_roots(&stack, &[], &[], &[]),
        )
        .unwrap();
        assert_eq!(
            heap.allocated_bytes(),
            OBJECT_HEADER_BYTES + VALUE_SLOT_BYTES + 120
        );

        // Pushing another 120-byte string exceeds 256 byte limit and traps without mutating array or bytes
        let bytes_before = heap.allocated_bytes();
        let err = heap
            .array_push_with_roots(
                arr,
                Value::Str("y".repeat(120)),
                None,
                empty_roots(&stack, &[], &[], &[]),
            )
            .unwrap_err();
        assert!(matches!(err, MvmError::HeapBytesLimitExceeded { .. }));
        assert_eq!(heap.allocated_bytes(), bytes_before);
        match heap.get(arr).unwrap() {
            HeapObject::Array(items) => assert_eq!(items.len(), 1),
            _ => unreachable!(),
        }

        // Reclaiming drops allocated_bytes back to 0 without underflow
        heap.collect_garbage(&[], &[], &[]);
        assert_eq!(heap.allocated_bytes(), 0);
        assert_eq!(heap.len(), 0);
    }

    #[test]
    fn structural_equality_handles_nested_cycles_and_nan() {
        let mut heap = HeapArena::new(64);
        let a1 = heap
            .alloc(HeapObject::Array(vec![Value::I64(1), Value::I64(2)]))
            .unwrap();
        let a2 = heap
            .alloc(HeapObject::Array(vec![Value::I64(1), Value::I64(2)]))
            .unwrap();
        let a3 = heap
            .alloc(HeapObject::Array(vec![Value::I64(1), Value::I64(3)]))
            .unwrap();
        assert!(heap
            .values_equal(&Value::ArrayRef(a1), &Value::ArrayRef(a2))
            .unwrap());
        assert!(!heap
            .values_equal(&Value::ArrayRef(a1), &Value::ArrayRef(a3))
            .unwrap());

        // Cyclic bisimulation: c1 = [c1], c2 = [c3], c3 = [c2]
        let c1 = heap.alloc(HeapObject::Array(vec![])).unwrap();
        match heap.get_mut(c1).unwrap() {
            HeapObject::Array(items) => items.push(Value::ArrayRef(c1)),
            _ => unreachable!(),
        }
        let c2 = heap.alloc(HeapObject::Array(vec![])).unwrap();
        let c3 = heap
            .alloc(HeapObject::Array(vec![Value::ArrayRef(c2)]))
            .unwrap();
        match heap.get_mut(c2).unwrap() {
            HeapObject::Array(items) => items.push(Value::ArrayRef(c3)),
            _ => unreachable!(),
        }
        assert!(heap
            .values_equal(&Value::ArrayRef(c1), &Value::ArrayRef(c2))
            .unwrap());

        // Cyclic non-equal: d1 = [1, d1], d2 = [2, d2]
        let d1 = heap.alloc(HeapObject::Array(vec![Value::I64(1)])).unwrap();
        match heap.get_mut(d1).unwrap() {
            HeapObject::Array(items) => items.push(Value::ArrayRef(d1)),
            _ => unreachable!(),
        }
        let d2 = heap.alloc(HeapObject::Array(vec![Value::I64(2)])).unwrap();
        match heap.get_mut(d2).unwrap() {
            HeapObject::Array(items) => items.push(Value::ArrayRef(d2)),
            _ => unreachable!(),
        }
        assert!(!heap
            .values_equal(&Value::ArrayRef(d1), &Value::ArrayRef(d2))
            .unwrap());

        // NaN inside container is never equal to itself
        let nan_arr = heap
            .alloc(HeapObject::Array(vec![Value::F64(f64::NAN)]))
            .unwrap();
        assert!(!heap
            .values_equal(&Value::ArrayRef(nan_arr), &Value::ArrayRef(nan_arr))
            .unwrap());
    }
}

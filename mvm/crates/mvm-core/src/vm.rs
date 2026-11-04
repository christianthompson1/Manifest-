use std::collections::{BTreeMap, HashMap};

use crate::bytecode::{ConstantEntry, ExportKind, MbcModule};
use crate::capabilities::CapabilityPolicy;
use crate::errors::MvmError;
use crate::frame::CallFrame;
use crate::host::HostEnvironment;
use crate::instruction::Instruction;
use crate::memory::{HeapArena, HeapObject};
use crate::stack::OperandStack;
use crate::value::Value;

#[derive(Debug, Clone)]
pub struct VmLimits {
    pub max_steps: u64,
    pub max_call_depth: usize,
    pub max_stack_slots: usize,
    pub max_heap_objects: usize,
}

impl Default for VmLimits {
    fn default() -> Self {
        Self {
            max_steps: 2_000_000,
            max_call_depth: 512,
            max_stack_slots: 16_384,
            max_heap_objects: 65_536,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExecutionSummary {
    pub return_value: Value,
    pub formatted_return: String,
    pub stdout: Vec<String>,
    pub steps_executed: u64,
    pub heap_objects_allocated: usize,
}

pub struct VirtualMachine {
    limits: VmLimits,
    policy: CapabilityPolicy,
}

impl VirtualMachine {
    pub fn new(limits: VmLimits, policy: CapabilityPolicy) -> Self {
        Self { limits, policy }
    }

    pub fn execute<H: HostEnvironment>(
        &self,
        module: &MbcModule,
        host: &mut H,
        entry_override: Option<&str>,
    ) -> Result<ExecutionSummary, MvmError> {
        if !module.verified {
            return Err(MvmError::UnverifiedModule);
        }

        let target_fn_idx = if let Some(name) = entry_override {
            self.find_function_idx(module, name)
                .ok_or_else(|| MvmError::MissingEntryFunction(name.to_string()))?
        } else if let Some(idx) = module.entry_fn_idx {
            idx
        } else if let Some(idx) = self.find_function_idx(module, "main") {
            idx
        } else {
            return Err(MvmError::MissingEntryFunction("main".to_string()));
        };

        // Precompute per-function byte-offset -> instruction-index tables
        let mut jump_tables: Vec<HashMap<usize, usize>> =
            Vec::with_capacity(module.functions.len());
        for f in &module.functions {
            let mut map = HashMap::with_capacity(f.decoded.len());
            for (idx, inst) in f.decoded.iter().enumerate() {
                map.insert(inst.offset, idx);
            }
            jump_tables.push(map);
        }

        let mut globals = vec![Value::Void; module.global_count as usize];
        let mut stack = OperandStack::new(self.limits.max_stack_slots);
        let mut heap = HeapArena::new(self.limits.max_heap_objects);
        let mut frames: Vec<CallFrame> = Vec::with_capacity(64);

        // If module has `__init__` and target is not `__init__`, run `__init__` first to populate globals/constants
        if let Some(init_idx) = self.find_function_idx(module, "__init__") {
            if init_idx != target_fn_idx {
                let mut steps = 0u64;
                self.run_call_loop(
                    module,
                    &jump_tables,
                    init_idx,
                    Vec::new(),
                    &mut globals,
                    &mut stack,
                    &mut heap,
                    &mut frames,
                    host,
                    &mut steps,
                )?;
            }
        }

        let mut steps_executed = 0u64;
        let ret_val = self.run_call_loop(
            module,
            &jump_tables,
            target_fn_idx,
            Vec::new(),
            &mut globals,
            &mut stack,
            &mut heap,
            &mut frames,
            host,
            &mut steps_executed,
        )?;

        let formatted_return = heap.format_value(&ret_val, 0);
        Ok(ExecutionSummary {
            return_value: ret_val,
            formatted_return,
            stdout: host.stdout().to_vec(),
            steps_executed,
            heap_objects_allocated: heap.len(),
        })
    }

    fn find_function_idx(&self, module: &MbcModule, name: &str) -> Option<u32> {
        for exp in &module.exports {
            if exp.kind == ExportKind::Function && exp.name == name {
                return Some(exp.target_idx);
            }
        }
        for (i, f) in module.functions.iter().enumerate() {
            if f.name == name {
                return Some(i as u32);
            }
        }
        None
    }

    #[allow(clippy::too_many_arguments)]
    fn run_call_loop<H: HostEnvironment>(
        &self,
        module: &MbcModule,
        jump_tables: &[HashMap<usize, usize>],
        root_fn_idx: u32,
        root_args: Vec<Value>,
        globals: &mut [Value],
        stack: &mut OperandStack,
        heap: &mut HeapArena,
        frames: &mut Vec<CallFrame>,
        host: &mut H,
        steps: &mut u64,
    ) -> Result<Value, MvmError> {
        let root_desc = module
            .functions
            .get(root_fn_idx as usize)
            .ok_or(MvmError::InvalidFunctionIndex(root_fn_idx))?;

        frames.clear();
        frames.push(CallFrame::new(
            root_fn_idx,
            root_desc.local_count as usize,
            stack.len(),
            root_args,
        ));

        loop {
            if *steps >= self.limits.max_steps {
                return Err(MvmError::ExecutionStepLimitExceeded {
                    limit: self.limits.max_steps,
                });
            }
            *steps += 1;

            let frame_idx = match frames.len().checked_sub(1) {
                Some(idx) => idx,
                None => return Ok(Value::Void),
            };

            let fn_idx = frames[frame_idx].fn_idx;
            let pc = frames[frame_idx].pc;
            let func = &module.functions[fn_idx as usize];
            let decoded = &func.decoded[pc];
            let byte_offset = decoded.offset;
            let line = module.lookup_line(fn_idx, byte_offset);

            frames[frame_idx].pc += 1;

            match decoded.op {
                Instruction::Nop => {}
                Instruction::Const(idx) => {
                    let val = match &module.constants[idx as usize] {
                        ConstantEntry::I64(n) => Value::I64(*n),
                        ConstantEntry::F64(n) => Value::F64(*n),
                        ConstantEntry::Bool(b) => Value::Bool(*b),
                        ConstantEntry::Str(s) => Value::Str(s.clone()),
                    };
                    stack.push(val, &func.name)?;
                }
                Instruction::PushVoid => {
                    stack.push(Value::Void, &func.name)?;
                }
                Instruction::Pop => {
                    let _ = stack.pop(&func.name, byte_offset)?;
                }
                Instruction::Dup => {
                    let top = stack.peek(&func.name, byte_offset)?.clone();
                    stack.push(top, &func.name)?;
                }

                Instruction::LoadLocal(slot) => {
                    let val = frames[frame_idx].locals[slot as usize].clone();
                    stack.push(val, &func.name)?;
                }
                Instruction::StoreLocal(slot) => {
                    let val = stack.pop(&func.name, byte_offset)?;
                    frames[frame_idx].locals[slot as usize] = val;
                }
                Instruction::LoadGlobal(slot) => {
                    let val = globals[slot as usize].clone();
                    stack.push(val, &func.name)?;
                }
                Instruction::StoreGlobal(slot) => {
                    let val = stack.pop(&func.name, byte_offset)?;
                    globals[slot as usize] = val;
                }

                Instruction::AddI64 => {
                    let b = pop_i64(stack, &func.name, byte_offset, line)?;
                    let a = pop_i64(stack, &func.name, byte_offset, line)?;
                    let res = a
                        .checked_add(b)
                        .ok_or(MvmError::IntegerOverflow { op: "add", line })?;
                    stack.push(Value::I64(res), &func.name)?;
                }
                Instruction::SubI64 => {
                    let b = pop_i64(stack, &func.name, byte_offset, line)?;
                    let a = pop_i64(stack, &func.name, byte_offset, line)?;
                    let res = a
                        .checked_sub(b)
                        .ok_or(MvmError::IntegerOverflow { op: "sub", line })?;
                    stack.push(Value::I64(res), &func.name)?;
                }
                Instruction::MulI64 => {
                    let b = pop_i64(stack, &func.name, byte_offset, line)?;
                    let a = pop_i64(stack, &func.name, byte_offset, line)?;
                    let res = a
                        .checked_mul(b)
                        .ok_or(MvmError::IntegerOverflow { op: "mul", line })?;
                    stack.push(Value::I64(res), &func.name)?;
                }
                Instruction::DivI64 => {
                    let b = pop_i64(stack, &func.name, byte_offset, line)?;
                    let a = pop_i64(stack, &func.name, byte_offset, line)?;
                    if b == 0 {
                        return Err(MvmError::DivisionByZero { line });
                    }
                    let res = a
                        .checked_div(b)
                        .ok_or(MvmError::IntegerOverflow { op: "div", line })?;
                    stack.push(Value::I64(res), &func.name)?;
                }
                Instruction::ModI64 => {
                    let b = pop_i64(stack, &func.name, byte_offset, line)?;
                    let a = pop_i64(stack, &func.name, byte_offset, line)?;
                    if b == 0 {
                        return Err(MvmError::DivisionByZero { line });
                    }
                    let res = a
                        .checked_rem(b)
                        .ok_or(MvmError::IntegerOverflow { op: "rem", line })?;
                    stack.push(Value::I64(res), &func.name)?;
                }
                Instruction::NegI64 => {
                    let a = pop_i64(stack, &func.name, byte_offset, line)?;
                    let res = a
                        .checked_neg()
                        .ok_or(MvmError::IntegerOverflow { op: "neg", line })?;
                    stack.push(Value::I64(res), &func.name)?;
                }

                Instruction::AddF64 => {
                    let b = pop_f64(stack, &func.name, byte_offset, line)?;
                    let a = pop_f64(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::F64(a + b), &func.name)?;
                }
                Instruction::SubF64 => {
                    let b = pop_f64(stack, &func.name, byte_offset, line)?;
                    let a = pop_f64(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::F64(a - b), &func.name)?;
                }
                Instruction::MulF64 => {
                    let b = pop_f64(stack, &func.name, byte_offset, line)?;
                    let a = pop_f64(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::F64(a * b), &func.name)?;
                }
                Instruction::DivF64 => {
                    let b = pop_f64(stack, &func.name, byte_offset, line)?;
                    let a = pop_f64(stack, &func.name, byte_offset, line)?;
                    if b == 0.0 {
                        return Err(MvmError::DivisionByZero { line });
                    }
                    stack.push(Value::F64(a / b), &func.name)?;
                }
                Instruction::NegF64 => {
                    let a = pop_f64(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::F64(-a), &func.name)?;
                }

                Instruction::ConcatStr => {
                    let b = stack.pop(&func.name, byte_offset)?;
                    let a = stack.pop(&func.name, byte_offset)?;
                    let sa = heap.format_value(&a, 0);
                    let sb = heap.format_value(&b, 0);
                    stack.push(Value::Str(format!("{}{}", sa, sb)), &func.name)?;
                }
                Instruction::I64ToF64 => {
                    let a = pop_i64(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::F64(a as f64), &func.name)?;
                }
                Instruction::F64ToI64 => {
                    let a = pop_f64(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::I64(a as i64), &func.name)?;
                }
                Instruction::ToStr => {
                    let v = stack.pop(&func.name, byte_offset)?;
                    let s = heap.format_value(&v, 0);
                    stack.push(Value::Str(s), &func.name)?;
                }

                Instruction::Eq => {
                    let b = stack.pop(&func.name, byte_offset)?;
                    let a = stack.pop(&func.name, byte_offset)?;
                    stack.push(Value::Bool(a == b), &func.name)?;
                }
                Instruction::Neq => {
                    let b = stack.pop(&func.name, byte_offset)?;
                    let a = stack.pop(&func.name, byte_offset)?;
                    stack.push(Value::Bool(a != b), &func.name)?;
                }
                Instruction::Lt => {
                    let res = compare_ord(stack, &func.name, byte_offset, line, |o| o.is_lt())?;
                    stack.push(Value::Bool(res), &func.name)?;
                }
                Instruction::Lte => {
                    let res = compare_ord(stack, &func.name, byte_offset, line, |o| o.is_le())?;
                    stack.push(Value::Bool(res), &func.name)?;
                }
                Instruction::Gt => {
                    let res = compare_ord(stack, &func.name, byte_offset, line, |o| o.is_gt())?;
                    stack.push(Value::Bool(res), &func.name)?;
                }
                Instruction::Gte => {
                    let res = compare_ord(stack, &func.name, byte_offset, line, |o| o.is_ge())?;
                    stack.push(Value::Bool(res), &func.name)?;
                }
                Instruction::Not => {
                    let b = pop_bool(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::Bool(!b), &func.name)?;
                }
                Instruction::BoolAnd => {
                    let b = pop_bool(stack, &func.name, byte_offset, line)?;
                    let a = pop_bool(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::Bool(a && b), &func.name)?;
                }
                Instruction::BoolOr => {
                    let b = pop_bool(stack, &func.name, byte_offset, line)?;
                    let a = pop_bool(stack, &func.name, byte_offset, line)?;
                    stack.push(Value::Bool(a || b), &func.name)?;
                }

                Instruction::Jmp(target_off) => {
                    frames[frame_idx].pc = jump_tables[fn_idx as usize][&(target_off as usize)];
                }
                Instruction::JmpIfFalse(target_off) => {
                    let cond = pop_bool(stack, &func.name, byte_offset, line)?;
                    if !cond {
                        frames[frame_idx].pc =
                            jump_tables[fn_idx as usize][&(target_off as usize)];
                    }
                }
                Instruction::JmpIfTrue(target_off) => {
                    let cond = pop_bool(stack, &func.name, byte_offset, line)?;
                    if cond {
                        frames[frame_idx].pc =
                            jump_tables[fn_idx as usize][&(target_off as usize)];
                    }
                }

                Instruction::Call(callee_idx) => {
                    if frames.len() >= self.limits.max_call_depth {
                        return Err(MvmError::CallDepthExceeded {
                            limit: self.limits.max_call_depth,
                        });
                    }
                    let callee = &module.functions[callee_idx as usize];
                    let arity = callee.param_count as usize;
                    let mut args = vec![Value::Void; arity];
                    for i in (0..arity).rev() {
                        args[i] = stack.pop(&func.name, byte_offset)?;
                    }
                    let stack_base = stack.len();
                    frames.push(CallFrame::new(
                        callee_idx,
                        callee.local_count as usize,
                        stack_base,
                        args,
                    ));
                }

                Instruction::Ret => {
                    let ret_val = stack.pop(&func.name, byte_offset)?;
                    let finished = frames.pop().expect("active frame");
                    stack.truncate(finished.stack_base);
                    if frames.is_empty() {
                        return Ok(ret_val);
                    }
                    let caller_fn = &module.functions[frames.last().unwrap().fn_idx as usize];
                    stack.push(ret_val, &caller_fn.name)?;
                }
                Instruction::RetVoid => {
                    let finished = frames.pop().expect("active frame");
                    stack.truncate(finished.stack_base);
                    if frames.is_empty() {
                        return Ok(Value::Void);
                    }
                    let caller_fn = &module.functions[frames.last().unwrap().fn_idx as usize];
                    stack.push(Value::Void, &caller_fn.name)?;
                }

                Instruction::HostCall(imp_idx) => {
                    let imp = &module.imports[imp_idx as usize];
                    self.policy
                        .check_invocation(module, &imp.capability, &imp.symbol)?;
                    let arity = imp.arity as usize;
                    let mut args = vec![Value::Void; arity];
                    for i in (0..arity).rev() {
                        args[i] = stack.pop(&func.name, byte_offset)?;
                    }
                    let res = host.invoke(&imp.symbol, &imp.capability, &args, heap)?;
                    stack.push(if imp.has_return { res } else { Value::Void }, &func.name)?;
                }

                Instruction::ArrayNew(count) => {
                    let n = count as usize;
                    let mut items = vec![Value::Void; n];
                    for i in (0..n).rev() {
                        items[i] = stack.pop(&func.name, byte_offset)?;
                    }
                    let id = heap.alloc(HeapObject::Array(items))?;
                    stack.push(Value::ArrayRef(id), &func.name)?;
                }
                Instruction::ArrayGet => {
                    let idx = pop_i64(stack, &func.name, byte_offset, line)?;
                    let arr_val = stack.pop(&func.name, byte_offset)?;
                    let id = match arr_val {
                        Value::ArrayRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Array",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get(id)? {
                        HeapObject::Array(items) => {
                            if idx < 0 || (idx as usize) >= items.len() {
                                return Err(MvmError::IndexOutOfBounds {
                                    index: idx,
                                    len: items.len(),
                                    line,
                                });
                            }
                            let elem = items[idx as usize].clone();
                            stack.push(elem, &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Array",
                                actual: "non-array heap object",
                                line,
                            })
                        }
                    }
                }
                Instruction::ArraySet => {
                    let val = stack.pop(&func.name, byte_offset)?;
                    let idx = pop_i64(stack, &func.name, byte_offset, line)?;
                    let arr_val = stack.pop(&func.name, byte_offset)?;
                    let id = match arr_val {
                        Value::ArrayRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Array",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get_mut(id)? {
                        HeapObject::Array(items) => {
                            if idx < 0 || (idx as usize) >= items.len() {
                                return Err(MvmError::IndexOutOfBounds {
                                    index: idx,
                                    len: items.len(),
                                    line,
                                });
                            }
                            items[idx as usize] = val;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Array",
                                actual: "non-array heap object",
                                line,
                            })
                        }
                    }
                }
                Instruction::ArrayLen => {
                    let arr_val = stack.pop(&func.name, byte_offset)?;
                    match arr_val {
                        Value::ArrayRef(id) => match heap.get(id)? {
                            HeapObject::Array(items) => {
                                stack.push(Value::I64(items.len() as i64), &func.name)?;
                            }
                            _ => {
                                return Err(MvmError::TypeMismatch {
                                    expected: "Array",
                                    actual: "non-array",
                                    line,
                                })
                            }
                        },
                        Value::Str(s) => {
                            stack.push(Value::I64(s.chars().count() as i64), &func.name)?;
                        }
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Array or str",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    }
                }
                Instruction::ArrayPush => {
                    let val = stack.pop(&func.name, byte_offset)?;
                    let arr_val = stack.pop(&func.name, byte_offset)?;
                    let id = match arr_val {
                        Value::ArrayRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Array",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get_mut(id)? {
                        HeapObject::Array(items) => {
                            items.push(val);
                            stack.push(Value::Void, &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Array",
                                actual: "non-array",
                                line,
                            })
                        }
                    }
                }

                Instruction::MapNew(pair_count) => {
                    let n = pair_count as usize;
                    let mut pairs = Vec::with_capacity(n);
                    for _ in 0..n {
                        let v = stack.pop(&func.name, byte_offset)?;
                        let k = match stack.pop(&func.name, byte_offset)? {
                            Value::Str(s) => s,
                            other => heap.format_value(&other, 0),
                        };
                        pairs.push((k, v));
                    }
                    let mut map = BTreeMap::new();
                    for (k, v) in pairs.into_iter().rev() {
                        map.insert(k, v);
                    }
                    let id = heap.alloc(HeapObject::Map(map))?;
                    stack.push(Value::MapRef(id), &func.name)?;
                }
                Instruction::MapGet => {
                    let key = match stack.pop(&func.name, byte_offset)? {
                        Value::Str(s) => s,
                        other => heap.format_value(&other, 0),
                    };
                    let map_val = stack.pop(&func.name, byte_offset)?;
                    let id = match map_val {
                        Value::MapRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Map",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get(id)? {
                        HeapObject::Map(entries) => {
                            let v = entries
                                .get(&key)
                                .cloned()
                                .ok_or(MvmError::KeyNotFound { key, line })?;
                            stack.push(v, &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Map",
                                actual: "non-map",
                                line,
                            })
                        }
                    }
                }
                Instruction::MapSet => {
                    let val = stack.pop(&func.name, byte_offset)?;
                    let key = match stack.pop(&func.name, byte_offset)? {
                        Value::Str(s) => s,
                        other => heap.format_value(&other, 0),
                    };
                    let map_val = stack.pop(&func.name, byte_offset)?;
                    let id = match map_val {
                        Value::MapRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Map",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get_mut(id)? {
                        HeapObject::Map(entries) => {
                            entries.insert(key, val);
                            stack.push(Value::Void, &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Map",
                                actual: "non-map",
                                line,
                            })
                        }
                    }
                }
                Instruction::MapHas => {
                    let key = match stack.pop(&func.name, byte_offset)? {
                        Value::Str(s) => s,
                        other => heap.format_value(&other, 0),
                    };
                    let map_val = stack.pop(&func.name, byte_offset)?;
                    let id = match map_val {
                        Value::MapRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Map",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get(id)? {
                        HeapObject::Map(entries) => {
                            stack.push(Value::Bool(entries.contains_key(&key)), &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Map",
                                actual: "non-map",
                                line,
                            })
                        }
                    }
                }

                Instruction::StructNew(struct_idx) => {
                    let field_count = module.structs[struct_idx as usize].fields.len();
                    let mut fields = vec![Value::Void; field_count];
                    for i in (0..field_count).rev() {
                        fields[i] = stack.pop(&func.name, byte_offset)?;
                    }
                    let id = heap.alloc(HeapObject::Struct { struct_idx, fields })?;
                    stack.push(Value::StructRef(id), &func.name)?;
                }
                Instruction::FieldGet(field_idx) => {
                    let sref = stack.pop(&func.name, byte_offset)?;
                    let id = match sref {
                        Value::StructRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Struct",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get(id)? {
                        HeapObject::Struct { fields, .. } => {
                            let val = fields
                                .get(field_idx as usize)
                                .cloned()
                                .ok_or_else(|| MvmError::RuntimeTrap {
                                    message: format!("Struct field {} out of bounds", field_idx),
                                    line,
                                })?;
                            stack.push(val, &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Struct",
                                actual: "non-struct",
                                line,
                            })
                        }
                    }
                }
                Instruction::FieldSet(field_idx) => {
                    let val = stack.pop(&func.name, byte_offset)?;
                    let sref = stack.pop(&func.name, byte_offset)?;
                    let id = match sref {
                        Value::StructRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Struct",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get_mut(id)? {
                        HeapObject::Struct { fields, .. } => {
                            if (field_idx as usize) >= fields.len() {
                                return Err(MvmError::RuntimeTrap {
                                    message: format!("Struct field {} out of bounds", field_idx),
                                    line,
                                });
                            }
                            fields[field_idx as usize] = val;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Struct",
                                actual: "non-struct",
                                line,
                            })
                        }
                    }
                }

                Instruction::EnumNew {
                    enum_idx,
                    variant_idx,
                } => {
                    let arity =
                        module.enums[enum_idx as usize].variants[variant_idx as usize].arity
                            as usize;
                    let mut payload = vec![Value::Void; arity];
                    for i in (0..arity).rev() {
                        payload[i] = stack.pop(&func.name, byte_offset)?;
                    }
                    let id = heap.alloc(HeapObject::Enum {
                        enum_idx,
                        variant_idx,
                        payload,
                    })?;
                    stack.push(Value::EnumRef(id), &func.name)?;
                }
                Instruction::EnumTag => {
                    let eref = stack.pop(&func.name, byte_offset)?;
                    let id = match eref {
                        Value::EnumRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Enum",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get(id)? {
                        HeapObject::Enum { variant_idx, .. } => {
                            stack.push(Value::I64(*variant_idx as i64), &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Enum",
                                actual: "non-enum",
                                line,
                            })
                        }
                    }
                }
                Instruction::EnumPayload(payload_idx) => {
                    let eref = stack.pop(&func.name, byte_offset)?;
                    let id = match eref {
                        Value::EnumRef(id) => id,
                        other => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Enum",
                                actual: other.type_name(),
                                line,
                            })
                        }
                    };
                    match heap.get(id)? {
                        HeapObject::Enum { payload, .. } => {
                            let val = payload
                                .get(payload_idx as usize)
                                .cloned()
                                .ok_or_else(|| MvmError::RuntimeTrap {
                                    message: format!(
                                        "Enum payload index {} out of bounds",
                                        payload_idx
                                    ),
                                    line,
                                })?;
                            stack.push(val, &func.name)?;
                        }
                        _ => {
                            return Err(MvmError::TypeMismatch {
                                expected: "Enum",
                                actual: "non-enum",
                                line,
                            })
                        }
                    }
                }

                Instruction::Trap(msg_idx) => {
                    let msg = module.get_const_str(msg_idx)?.to_string();
                    return Err(MvmError::RuntimeTrap { message: msg, line });
                }
                Instruction::Halt => {
                    let ret = if stack.is_empty() {
                        Value::Void
                    } else {
                        stack.pop(&func.name, byte_offset)?
                    };
                    return Ok(ret);
                }
            }
        }
    }
}

fn pop_i64(
    stack: &mut OperandStack,
    fn_name: &str,
    offset: usize,
    line: Option<u32>,
) -> Result<i64, MvmError> {
    match stack.pop(fn_name, offset)? {
        Value::I64(n) => Ok(n),
        other => Err(MvmError::TypeMismatch {
            expected: "i64",
            actual: other.type_name(),
            line,
        }),
    }
}

fn pop_f64(
    stack: &mut OperandStack,
    fn_name: &str,
    offset: usize,
    line: Option<u32>,
) -> Result<f64, MvmError> {
    match stack.pop(fn_name, offset)? {
        Value::F64(n) => Ok(n),
        other => Err(MvmError::TypeMismatch {
            expected: "f64",
            actual: other.type_name(),
            line,
        }),
    }
}

fn pop_bool(
    stack: &mut OperandStack,
    fn_name: &str,
    offset: usize,
    line: Option<u32>,
) -> Result<bool, MvmError> {
    match stack.pop(fn_name, offset)? {
        Value::Bool(b) => Ok(b),
        other => Err(MvmError::TypeMismatch {
            expected: "bool",
            actual: other.type_name(),
            line,
        }),
    }
}

fn compare_ord<F>(
    stack: &mut OperandStack,
    fn_name: &str,
    offset: usize,
    line: Option<u32>,
    pred: F,
) -> Result<bool, MvmError>
where
    F: FnOnce(std::cmp::Ordering) -> bool,
{
    let b = stack.pop(fn_name, offset)?;
    let a = stack.pop(fn_name, offset)?;
    match (&a, &b) {
        (Value::I64(x), Value::I64(y)) => Ok(pred(x.cmp(y))),
        (Value::F64(x), Value::F64(y)) => match x.partial_cmp(y) {
            Some(ord) => Ok(pred(ord)),
            None => Ok(false),
        },
        (Value::Str(x), Value::Str(y)) => Ok(pred(x.cmp(y))),
        _ => Err(MvmError::TypeMismatch {
            expected: "matching ordered values (i64, f64, or str)",
            actual: b.type_name(),
            line,
        }),
    }
}

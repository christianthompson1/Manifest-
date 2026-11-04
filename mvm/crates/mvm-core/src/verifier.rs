use std::collections::{HashMap, VecDeque};

use crate::bytecode::{ExportKind, FunctionDescriptor, MbcModule};
use crate::errors::MvmError;
use crate::instruction::Instruction;

pub fn verify_module(module: &mut MbcModule) -> Result<(), MvmError> {
    // 1. Verify capability denies vs requires consistency
    for denied in &module.denies {
        if module.requires.iter().any(|r| r == denied) {
            return Err(MvmError::VerificationFailed {
                function: "<module>".to_string(),
                offset: 0,
                message: format!(
                    "Capability '{}' is simultaneously listed in requires and denies",
                    denied
                ),
            });
        }
    }

    // 2. Verify host import capability legality against module denies
    for imp in &module.imports {
        if module
            .denies
            .iter()
            .any(|d| imp.capability == *d || imp.capability.starts_with(&format!("{}.", d)))
        {
            return Err(MvmError::VerificationFailed {
                function: "<imports>".to_string(),
                offset: 0,
                message: format!(
                    "Host import '{}' requires denied capability '{}'",
                    imp.symbol, imp.capability
                ),
            });
        }
    }

    // 3. Verify entry function index if present
    if let Some(entry_idx) = module.entry_fn_idx {
        if (entry_idx as usize) >= module.functions.len() {
            return Err(MvmError::VerificationFailed {
                function: "<module>".to_string(),
                offset: 0,
                message: format!(
                    "Entry function index {} out of bounds (fn count {})",
                    entry_idx,
                    module.functions.len()
                ),
            });
        }
    }

    // 4. Verify export table indices
    for exp in &module.exports {
        match exp.kind {
            ExportKind::Function => {
                if (exp.target_idx as usize) >= module.functions.len() {
                    return Err(MvmError::VerificationFailed {
                        function: "<exports>".to_string(),
                        offset: 0,
                        message: format!(
                            "Export '{}' references invalid function index {}",
                            exp.name, exp.target_idx
                        ),
                    });
                }
            }
            ExportKind::Global => {
                if exp.target_idx >= module.global_count {
                    return Err(MvmError::VerificationFailed {
                        function: "<exports>".to_string(),
                        offset: 0,
                        message: format!(
                            "Export '{}' references invalid global index {}",
                            exp.name, exp.target_idx
                        ),
                    });
                }
            }
        }
    }

    // 5. Verify each function's local invariants, operand indices, jump targets, and abstract stack height
    for func in &module.functions {
        verify_function(module, func)?;
    }

    module.verified = true;
    Ok(())
}

fn verify_function(module: &MbcModule, func: &FunctionDescriptor) -> Result<(), MvmError> {
    if func.local_count < func.param_count {
        return Err(MvmError::VerificationFailed {
            function: func.name.clone(),
            offset: 0,
            message: format!(
                "local_count ({}) cannot be less than param_count ({})",
                func.local_count, func.param_count
            ),
        });
    }

    if func.decoded.is_empty() {
        return Err(MvmError::VerificationFailed {
            function: func.name.clone(),
            offset: 0,
            message: "Function instruction stream cannot be empty".to_string(),
        });
    }

    let mut offset_to_idx: HashMap<usize, usize> = HashMap::with_capacity(func.decoded.len());
    for (idx, inst) in func.decoded.iter().enumerate() {
        offset_to_idx.insert(inst.offset, idx);
    }

    let mut stack_heights: Vec<Option<usize>> = vec![None; func.decoded.len()];
    let mut worklist: VecDeque<(usize, usize)> = VecDeque::new();
    worklist.push_back((0, 0));

    while let Some((pc, height)) = worklist.pop_front() {
        if let Some(existing) = stack_heights[pc] {
            if existing != height {
                return Err(MvmError::VerificationFailed {
                    function: func.name.clone(),
                    offset: func.decoded[pc].offset,
                    message: format!(
                        "Inconsistent operand stack height at control-flow merge ({} vs {})",
                        existing, height
                    ),
                });
            }
            continue;
        }
        stack_heights[pc] = Some(height);

        let decoded = &func.decoded[pc];
        let offset = decoded.offset;
        let (pops, pushes, terminators) =
            instruction_effect(module, func, &decoded.op, offset)?;

        if height < pops {
            return Err(MvmError::VerificationFailed {
                function: func.name.clone(),
                offset,
                message: format!(
                    "Stack underflow: {:?} requires {} operand(s), stack height is {}",
                    decoded.op, pops, height
                ),
            });
        }

        let next_height = height - pops + pushes;
        if next_height > (func.max_stack as usize) {
            return Err(MvmError::VerificationFailed {
                function: func.name.clone(),
                offset,
                message: format!(
                    "Stack overflow: height {} exceeds declared max_stack {}",
                    next_height, func.max_stack
                ),
            });
        }

        match terminators {
            FlowKind::Next => {
                if pc + 1 >= func.decoded.len() {
                    return Err(MvmError::VerificationFailed {
                        function: func.name.clone(),
                        offset,
                        message: "Execution falls off end of function without RET/RET_VOID/HALT"
                            .to_string(),
                    });
                }
                worklist.push_back((pc + 1, next_height));
            }
            FlowKind::Jump(target_off) => {
                let target_pc = *offset_to_idx.get(&(target_off as usize)).ok_or_else(|| {
                    MvmError::VerificationFailed {
                        function: func.name.clone(),
                        offset,
                        message: format!(
                            "Invalid jump target byte offset 0x{:04X} (not an instruction boundary)",
                            target_off
                        ),
                    }
                })?;
                worklist.push_back((target_pc, next_height));
            }
            FlowKind::Branch(target_off) => {
                let target_pc = *offset_to_idx.get(&(target_off as usize)).ok_or_else(|| {
                    MvmError::VerificationFailed {
                        function: func.name.clone(),
                        offset,
                        message: format!(
                            "Invalid branch target byte offset 0x{:04X} (not an instruction boundary)",
                            target_off
                        ),
                    }
                })?;
                if pc + 1 >= func.decoded.len() {
                    return Err(MvmError::VerificationFailed {
                        function: func.name.clone(),
                        offset,
                        message: "Conditional branch fallthrough falls off end of function"
                            .to_string(),
                    });
                }
                worklist.push_back((target_pc, next_height));
                worklist.push_back((pc + 1, next_height));
            }
            FlowKind::Return => {}
        }
    }

    Ok(())
}

enum FlowKind {
    Next,
    Jump(u32),
    Branch(u32),
    Return,
}

fn instruction_effect(
    module: &MbcModule,
    func: &FunctionDescriptor,
    op: &Instruction,
    offset: usize,
) -> Result<(usize, usize, FlowKind), MvmError> {
    let err = |msg: String| MvmError::VerificationFailed {
        function: func.name.clone(),
        offset,
        message: msg,
    };

    match *op {
        Instruction::Nop => Ok((0, 0, FlowKind::Next)),
        Instruction::Const(idx) => {
            if (idx as usize) >= module.constants.len() {
                return Err(err(format!(
                    "Constant index {} out of bounds (pool size {})",
                    idx,
                    module.constants.len()
                )));
            }
            Ok((0, 1, FlowKind::Next))
        }
        Instruction::PushVoid => Ok((0, 1, FlowKind::Next)),
        Instruction::Pop => Ok((1, 0, FlowKind::Next)),
        Instruction::Dup => Ok((1, 2, FlowKind::Next)),

        Instruction::LoadLocal(slot) => {
            if slot >= func.local_count {
                return Err(err(format!(
                    "LOAD_LOCAL slot {} out of bounds (local_count {})",
                    slot, func.local_count
                )));
            }
            Ok((0, 1, FlowKind::Next))
        }
        Instruction::StoreLocal(slot) => {
            if slot >= func.local_count {
                return Err(err(format!(
                    "STORE_LOCAL slot {} out of bounds (local_count {})",
                    slot, func.local_count
                )));
            }
            Ok((1, 0, FlowKind::Next))
        }
        Instruction::LoadGlobal(slot) => {
            if slot >= module.global_count {
                return Err(err(format!(
                    "LOAD_GLOBAL slot {} out of bounds (global_count {})",
                    slot, module.global_count
                )));
            }
            Ok((0, 1, FlowKind::Next))
        }
        Instruction::StoreGlobal(slot) => {
            if slot >= module.global_count {
                return Err(err(format!(
                    "STORE_GLOBAL slot {} out of bounds (global_count {})",
                    slot, module.global_count
                )));
            }
            Ok((1, 0, FlowKind::Next))
        }

        Instruction::AddI64
        | Instruction::SubI64
        | Instruction::MulI64
        | Instruction::DivI64
        | Instruction::ModI64
        | Instruction::AddF64
        | Instruction::SubF64
        | Instruction::MulF64
        | Instruction::DivF64
        | Instruction::ConcatStr
        | Instruction::Eq
        | Instruction::Neq
        | Instruction::Lt
        | Instruction::Lte
        | Instruction::Gt
        | Instruction::Gte
        | Instruction::BoolAnd
        | Instruction::BoolOr => Ok((2, 1, FlowKind::Next)),

        Instruction::NegI64
        | Instruction::NegF64
        | Instruction::I64ToF64
        | Instruction::F64ToI64
        | Instruction::ToStr
        | Instruction::Not => Ok((1, 1, FlowKind::Next)),

        Instruction::Jmp(target) => Ok((0, 0, FlowKind::Jump(target))),
        Instruction::JmpIfFalse(target) | Instruction::JmpIfTrue(target) => {
            Ok((1, 0, FlowKind::Branch(target)))
        }

        Instruction::Call(fn_idx) => {
            let callee = module.functions.get(fn_idx as usize).ok_or_else(|| {
                err(format!(
                    "CALL function index {} out of bounds (fn count {})",
                    fn_idx,
                    module.functions.len()
                ))
            })?;
            // CALL always pushes 1 value onto caller stack (either the return value or Void)
            Ok((callee.param_count as usize, 1, FlowKind::Next))
        }

        Instruction::Ret => Ok((1, 0, FlowKind::Return)),
        Instruction::RetVoid => Ok((0, 0, FlowKind::Return)),

        Instruction::HostCall(imp_idx) => {
            let imp = module.imports.get(imp_idx as usize).ok_or_else(|| {
                err(format!(
                    "HOST_CALL import index {} out of bounds (import count {})",
                    imp_idx,
                    module.imports.len()
                ))
            })?;
            Ok((imp.arity as usize, 1, FlowKind::Next))
        }

        Instruction::ArrayNew(count) => Ok((count as usize, 1, FlowKind::Next)),
        Instruction::ArrayGet => Ok((2, 1, FlowKind::Next)),
        Instruction::ArraySet => Ok((3, 0, FlowKind::Next)),
        Instruction::ArrayLen => Ok((1, 1, FlowKind::Next)),
        Instruction::ArrayPush => Ok((2, 1, FlowKind::Next)),

        Instruction::MapNew(pair_count) => Ok(((pair_count as usize) * 2, 1, FlowKind::Next)),
        Instruction::MapGet => Ok((2, 1, FlowKind::Next)),
        Instruction::MapSet => Ok((3, 1, FlowKind::Next)),
        Instruction::MapHas => Ok((2, 1, FlowKind::Next)),

        Instruction::StructNew(struct_idx) => {
            let st = module.structs.get(struct_idx as usize).ok_or_else(|| {
                err(format!(
                    "STRUCT_NEW index {} out of bounds (struct count {})",
                    struct_idx,
                    module.structs.len()
                ))
            })?;
            Ok((st.fields.len(), 1, FlowKind::Next))
        }
        Instruction::FieldGet(_) => Ok((1, 1, FlowKind::Next)),
        Instruction::FieldSet(_) => Ok((2, 0, FlowKind::Next)),

        Instruction::EnumNew {
            enum_idx,
            variant_idx,
        } => {
            let en = module.enums.get(enum_idx as usize).ok_or_else(|| {
                err(format!(
                    "ENUM_NEW enum index {} out of bounds (enum count {})",
                    enum_idx,
                    module.enums.len()
                ))
            })?;
            let var = en.variants.get(variant_idx as usize).ok_or_else(|| {
                err(format!(
                    "ENUM_NEW variant index {} out of bounds for enum '{}'",
                    variant_idx, en.name
                ))
            })?;
            Ok((var.arity as usize, 1, FlowKind::Next))
        }
        Instruction::EnumTag => Ok((1, 1, FlowKind::Next)),
        Instruction::EnumPayload(_) => Ok((1, 1, FlowKind::Next)),

        Instruction::Trap(msg_idx) => {
            module
                .get_const_str(msg_idx)
                .map_err(|e| err(e.to_string()))?;
            Ok((0, 0, FlowKind::Return))
        }
        Instruction::Halt => Ok((0, 0, FlowKind::Return)),
    }
}

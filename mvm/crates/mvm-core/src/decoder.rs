use crate::bytecode::{
    section_tags, ConstantEntry, DebugLineEntry, EnumDescriptor, EnumVariantDescriptor,
    ExportDescriptor, ExportKind, FunctionDescriptor, HostImportDescriptor, MbcModule,
    StructDescriptor, MBC_MAGIC, MBC_VERSION_MAJOR, MBC_VERSION_MINOR,
};
use crate::errors::MvmError;
use crate::instruction::{opcodes, DecodedInstruction, Instruction};

struct ByteCursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> ByteCursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }

    fn read_u8(&mut self, ctx: &str) -> Result<u8, MvmError> {
        if self.remaining() < 1 {
            return Err(MvmError::TruncatedContainer(ctx.to_string()));
        }
        let v = self.bytes[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn read_u16(&mut self, ctx: &str) -> Result<u16, MvmError> {
        if self.remaining() < 2 {
            return Err(MvmError::TruncatedContainer(ctx.to_string()));
        }
        let mut arr = [0u8; 2];
        arr.copy_from_slice(&self.bytes[self.pos..self.pos + 2]);
        self.pos += 2;
        Ok(u16::from_le_bytes(arr))
    }

    fn read_u32(&mut self, ctx: &str) -> Result<u32, MvmError> {
        if self.remaining() < 4 {
            return Err(MvmError::TruncatedContainer(ctx.to_string()));
        }
        let mut arr = [0u8; 4];
        arr.copy_from_slice(&self.bytes[self.pos..self.pos + 4]);
        self.pos += 4;
        Ok(u32::from_le_bytes(arr))
    }

    fn read_i64(&mut self, ctx: &str) -> Result<i64, MvmError> {
        if self.remaining() < 8 {
            return Err(MvmError::TruncatedContainer(ctx.to_string()));
        }
        let mut arr = [0u8; 8];
        arr.copy_from_slice(&self.bytes[self.pos..self.pos + 8]);
        self.pos += 8;
        Ok(i64::from_le_bytes(arr))
    }

    fn read_f64(&mut self, ctx: &str) -> Result<f64, MvmError> {
        if self.remaining() < 8 {
            return Err(MvmError::TruncatedContainer(ctx.to_string()));
        }
        let mut arr = [0u8; 8];
        arr.copy_from_slice(&self.bytes[self.pos..self.pos + 8]);
        self.pos += 8;
        Ok(f64::from_le_bytes(arr))
    }

    fn read_str(&mut self, ctx: &str) -> Result<String, MvmError> {
        let len = self.read_u32(ctx)? as usize;
        if self.remaining() < len {
            return Err(MvmError::TruncatedContainer(format!(
                "{} (string len {})",
                ctx, len
            )));
        }
        let slice = &self.bytes[self.pos..self.pos + len];
        self.pos += len;
        std::str::from_utf8(slice)
            .map(|s| s.to_string())
            .map_err(|_| MvmError::MalformedSection(format!("{}: invalid UTF-8 string", ctx)))
    }
}

pub fn decode_instructions(
    code: &[u8],
    fn_name: &str,
) -> Result<Vec<DecodedInstruction>, MvmError> {
    let mut cur = ByteCursor::new(code);
    let mut out = Vec::new();

    while cur.remaining() > 0 {
        let offset = cur.pos;
        let op_byte = cur.read_u8("opcode")?;
        let op = match op_byte {
            opcodes::NOP => Instruction::Nop,
            opcodes::CONST => Instruction::Const(cur.read_u32("CONST idx")?),
            opcodes::PUSH_VOID => Instruction::PushVoid,
            opcodes::POP => Instruction::Pop,
            opcodes::DUP => Instruction::Dup,

            opcodes::LOAD_LOCAL => Instruction::LoadLocal(cur.read_u16("LOAD_LOCAL slot")?),
            opcodes::STORE_LOCAL => Instruction::StoreLocal(cur.read_u16("STORE_LOCAL slot")?),
            opcodes::LOAD_GLOBAL => Instruction::LoadGlobal(cur.read_u32("LOAD_GLOBAL slot")?),
            opcodes::STORE_GLOBAL => Instruction::StoreGlobal(cur.read_u32("STORE_GLOBAL slot")?),

            opcodes::ADD_I64 => Instruction::AddI64,
            opcodes::SUB_I64 => Instruction::SubI64,
            opcodes::MUL_I64 => Instruction::MulI64,
            opcodes::DIV_I64 => Instruction::DivI64,
            opcodes::MOD_I64 => Instruction::ModI64,
            opcodes::NEG_I64 => Instruction::NegI64,

            opcodes::ADD_F64 => Instruction::AddF64,
            opcodes::SUB_F64 => Instruction::SubF64,
            opcodes::MUL_F64 => Instruction::MulF64,
            opcodes::DIV_F64 => Instruction::DivF64,
            opcodes::NEG_F64 => Instruction::NegF64,

            opcodes::CONCAT_STR => Instruction::ConcatStr,
            opcodes::I64_TO_F64 => Instruction::I64ToF64,
            opcodes::F64_TO_I64 => Instruction::F64ToI64,
            opcodes::TO_STR => Instruction::ToStr,

            opcodes::EQ => Instruction::Eq,
            opcodes::NEQ => Instruction::Neq,
            opcodes::LT => Instruction::Lt,
            opcodes::LTE => Instruction::Lte,
            opcodes::GT => Instruction::Gt,
            opcodes::GTE => Instruction::Gte,
            opcodes::NOT => Instruction::Not,
            opcodes::BOOL_AND => Instruction::BoolAnd,
            opcodes::BOOL_OR => Instruction::BoolOr,

            opcodes::JMP => Instruction::Jmp(cur.read_u32("JMP target")?),
            opcodes::JMP_IF_FALSE => Instruction::JmpIfFalse(cur.read_u32("JMP_IF_FALSE target")?),
            opcodes::JMP_IF_TRUE => Instruction::JmpIfTrue(cur.read_u32("JMP_IF_TRUE target")?),
            opcodes::CALL => Instruction::Call(cur.read_u32("CALL fn_idx")?),
            opcodes::RET => Instruction::Ret,
            opcodes::RET_VOID => Instruction::RetVoid,
            opcodes::HOST_CALL => Instruction::HostCall(cur.read_u32("HOST_CALL import_idx")?),

            opcodes::ARRAY_NEW => Instruction::ArrayNew(cur.read_u32("ARRAY_NEW count")?),
            opcodes::ARRAY_GET => Instruction::ArrayGet,
            opcodes::ARRAY_SET => Instruction::ArraySet,
            opcodes::ARRAY_LEN => Instruction::ArrayLen,
            opcodes::ARRAY_PUSH => Instruction::ArrayPush,

            opcodes::MAP_NEW => Instruction::MapNew(cur.read_u32("MAP_NEW count")?),
            opcodes::MAP_GET => Instruction::MapGet,
            opcodes::MAP_SET => Instruction::MapSet,
            opcodes::MAP_HAS => Instruction::MapHas,

            opcodes::STRUCT_NEW => Instruction::StructNew(cur.read_u32("STRUCT_NEW idx")?),
            opcodes::FIELD_GET => Instruction::FieldGet(cur.read_u16("FIELD_GET idx")?),
            opcodes::FIELD_SET => Instruction::FieldSet(cur.read_u16("FIELD_SET idx")?),

            opcodes::ENUM_NEW => {
                let enum_idx = cur.read_u32("ENUM_NEW enum_idx")?;
                let variant_idx = cur.read_u16("ENUM_NEW variant_idx")?;
                Instruction::EnumNew {
                    enum_idx,
                    variant_idx,
                }
            }
            opcodes::ENUM_TAG => Instruction::EnumTag,
            opcodes::ENUM_PAYLOAD => Instruction::EnumPayload(cur.read_u16("ENUM_PAYLOAD idx")?),

            opcodes::TRAP => Instruction::Trap(cur.read_u32("TRAP msg_idx")?),
            opcodes::HALT => Instruction::Halt,

            unknown => {
                return Err(MvmError::VerificationFailed {
                    function: fn_name.to_string(),
                    offset,
                    message: format!("Unknown opcode 0x{:02X}", unknown),
                });
            }
        };
        let length = cur.pos - offset;
        out.push(DecodedInstruction { offset, length, op });
    }

    Ok(out)
}

pub fn decode_mbc(bytes: &[u8]) -> Result<MbcModule, MvmError> {
    if bytes.len() < 16 {
        return Err(MvmError::TruncatedContainer(
            "file smaller than 16-byte MBC header".to_string(),
        ));
    }
    if bytes[0..4] != MBC_MAGIC {
        return Err(MvmError::InvalidMagic);
    }

    let mut cur = ByteCursor::new(&bytes[4..]);
    let major_version = cur.read_u16("major_version")?;
    let minor_version = cur.read_u16("minor_version")?;
    if major_version != MBC_VERSION_MAJOR || minor_version > MBC_VERSION_MINOR {
        return Err(MvmError::UnsupportedVersion {
            major: major_version,
            minor: minor_version,
        });
    }
    let flags = cur.read_u32("flags")?;
    let section_count = cur.read_u32("section_count")? as usize;
    if section_count > 64 {
        return Err(MvmError::MalformedSection(format!(
            "Excessive section count {}",
            section_count
        )));
    }

    let mut directory = Vec::with_capacity(section_count);
    for _ in 0..section_count {
        let tag = cur.read_u32("section_tag")?;
        let offset = cur.read_u32("section_offset")? as usize;
        let length = cur.read_u32("section_length")? as usize;
        let end = offset.checked_add(length).ok_or_else(|| {
            MvmError::MalformedSection("Section offset+length overflow".to_string())
        })?;
        if end > bytes.len() {
            return Err(MvmError::TruncatedContainer(format!(
                "Section 0x{:02X} range {}..{} exceeds file length {}",
                tag,
                offset,
                end,
                bytes.len()
            )));
        }
        directory.push((tag, &bytes[offset..end]));
    }

    let mut module_name = String::from("main");
    let mut requires = Vec::new();
    let mut provides = Vec::new();
    let mut denies = Vec::new();
    let mut constants = Vec::new();
    let mut structs_raw: Vec<(u32, Vec<(u32, u8)>)> = Vec::new();
    let mut enums_raw: Vec<(u32, Vec<(u32, u16)>)> = Vec::new();
    let mut imports_raw: Vec<(u32, u32, u16, bool)> = Vec::new();
    let mut exports_raw: Vec<(u32, u8, u32)> = Vec::new();
    let mut global_count = 0u32;
    let mut entry_fn_idx: Option<u32> = None;
    let mut funcs_raw: Vec<(u32, u16, u16, u16, bool, Vec<u32>, u32, u32)> = Vec::new();
    let mut code_bytes = Vec::new();
    let mut debug_map = Vec::new();

    for (tag, slice) in directory {
        let mut sc = ByteCursor::new(slice);
        match tag {
            section_tags::MODULE_META => {
                module_name = sc.read_str("module_name")?;
                let req_count = sc.read_u16("requires_count")? as usize;
                for _ in 0..req_count {
                    requires.push(sc.read_str("requires_item")?);
                }
                let prov_count = sc.read_u16("provides_count")? as usize;
                for _ in 0..prov_count {
                    provides.push(sc.read_str("provides_item")?);
                }
                let deny_count = sc.read_u16("denies_count")? as usize;
                for _ in 0..deny_count {
                    denies.push(sc.read_str("denies_item")?);
                }
            }
            section_tags::CONST_POOL => {
                let count = sc.read_u32("const_count")? as usize;
                for _ in 0..count {
                    let kind = sc.read_u8("const_kind")?;
                    let entry = match kind {
                        0x01 => ConstantEntry::I64(sc.read_i64("const_i64")?),
                        0x02 => ConstantEntry::F64(sc.read_f64("const_f64")?),
                        0x03 => ConstantEntry::Bool(sc.read_u8("const_bool")? != 0),
                        0x04 => ConstantEntry::Str(sc.read_str("const_str")?),
                        other => {
                            return Err(MvmError::MalformedSection(format!(
                                "Unknown constant pool tag 0x{:02X}",
                                other
                            )))
                        }
                    };
                    constants.push(entry);
                }
            }
            section_tags::TYPE_TABLE => {
                let struct_count = sc.read_u32("struct_count")? as usize;
                for _ in 0..struct_count {
                    let name_idx = sc.read_u32("struct_name_idx")?;
                    let field_count = sc.read_u16("field_count")? as usize;
                    let mut fields = Vec::with_capacity(field_count);
                    for _ in 0..field_count {
                        let f_name_idx = sc.read_u32("field_name_idx")?;
                        let f_type = sc.read_u8("field_type")?;
                        fields.push((f_name_idx, f_type));
                    }
                    structs_raw.push((name_idx, fields));
                }
                let enum_count = sc.read_u32("enum_count")? as usize;
                for _ in 0..enum_count {
                    let name_idx = sc.read_u32("enum_name_idx")?;
                    let var_count = sc.read_u16("variant_count")? as usize;
                    let mut vars = Vec::with_capacity(var_count);
                    for _ in 0..var_count {
                        let v_name_idx = sc.read_u32("variant_name_idx")?;
                        let arity = sc.read_u16("variant_arity")?;
                        vars.push((v_name_idx, arity));
                    }
                    enums_raw.push((name_idx, vars));
                }
            }
            section_tags::IMPORT_TABLE => {
                let count = sc.read_u32("import_count")? as usize;
                for _ in 0..count {
                    let sym_idx = sc.read_u32("import_sym_idx")?;
                    let cap_idx = sc.read_u32("import_cap_idx")?;
                    let arity = sc.read_u16("import_arity")?;
                    let has_ret = sc.read_u8("import_has_ret")? != 0;
                    imports_raw.push((sym_idx, cap_idx, arity, has_ret));
                }
            }
            section_tags::EXPORT_TABLE => {
                let count = sc.read_u32("export_count")? as usize;
                for _ in 0..count {
                    let name_idx = sc.read_u32("export_name_idx")?;
                    let kind = sc.read_u8("export_kind")?;
                    let target_idx = sc.read_u32("export_target_idx")?;
                    exports_raw.push((name_idx, kind, target_idx));
                }
            }
            section_tags::FUNC_TABLE => {
                global_count = sc.read_u32("global_count")?;
                let raw_entry = sc.read_u32("entry_fn_idx")?;
                entry_fn_idx = if raw_entry == 0xFFFF_FFFF {
                    None
                } else {
                    Some(raw_entry)
                };
                let fn_count = sc.read_u32("fn_count")? as usize;
                for _ in 0..fn_count {
                    let name_idx = sc.read_u32("fn_name_idx")?;
                    let param_count = sc.read_u16("param_count")?;
                    let local_count = sc.read_u16("local_count")?;
                    let max_stack = sc.read_u16("max_stack")?;
                    let has_ret = sc.read_u8("return_tag")? != 0;
                    let eff_count = sc.read_u16("effect_count")? as usize;
                    let mut eff_indices = Vec::with_capacity(eff_count);
                    for _ in 0..eff_count {
                        eff_indices.push(sc.read_u32("effect_idx")?);
                    }
                    let code_offset = sc.read_u32("code_offset")?;
                    let code_length = sc.read_u32("code_length")?;
                    funcs_raw.push((
                        name_idx,
                        param_count,
                        local_count,
                        max_stack,
                        has_ret,
                        eff_indices,
                        code_offset,
                        code_length,
                    ));
                }
            }
            section_tags::CODE => {
                code_bytes = slice.to_vec();
            }
            section_tags::DEBUG_MAP => {
                let count = sc.read_u32("debug_count")? as usize;
                for _ in 0..count {
                    debug_map.push(DebugLineEntry {
                        fn_idx: sc.read_u32("dbg_fn_idx")?,
                        code_offset: sc.read_u32("dbg_code_offset")?,
                        line: sc.read_u32("dbg_line")?,
                        column: sc.read_u32("dbg_column")?,
                    });
                }
            }
            _ => {
                // Unknown optional forward-compatible section ignored if within bounds
            }
        }
    }

    let get_str = |idx: u32| -> Result<String, MvmError> {
        match constants.get(idx as usize) {
            Some(ConstantEntry::Str(s)) => Ok(s.clone()),
            Some(_) => Err(MvmError::MalformedSection(format!(
                "Constant index {} is not a string",
                idx
            ))),
            None => Err(MvmError::MalformedSection(format!(
                "Constant index {} out of bounds (pool size {})",
                idx,
                constants.len()
            ))),
        }
    };

    let mut structs = Vec::with_capacity(structs_raw.len());
    for (name_idx, fields_raw) in structs_raw {
        let name = get_str(name_idx)?;
        let mut fields = Vec::with_capacity(fields_raw.len());
        for (f_idx, f_ty) in fields_raw {
            fields.push((get_str(f_idx)?, f_ty));
        }
        structs.push(StructDescriptor { name, fields });
    }

    let mut enums = Vec::with_capacity(enums_raw.len());
    for (name_idx, vars_raw) in enums_raw {
        let name = get_str(name_idx)?;
        let mut variants = Vec::with_capacity(vars_raw.len());
        for (v_idx, arity) in vars_raw {
            variants.push(EnumVariantDescriptor {
                name: get_str(v_idx)?,
                arity,
            });
        }
        enums.push(EnumDescriptor { name, variants });
    }

    let mut imports = Vec::with_capacity(imports_raw.len());
    for (sym_idx, cap_idx, arity, has_return) in imports_raw {
        imports.push(HostImportDescriptor {
            symbol: get_str(sym_idx)?,
            capability: get_str(cap_idx)?,
            arity,
            has_return,
        });
    }

    let mut exports = Vec::with_capacity(exports_raw.len());
    for (name_idx, kind_byte, target_idx) in exports_raw {
        let kind = match kind_byte {
            0 => ExportKind::Function,
            1 => ExportKind::Global,
            other => {
                return Err(MvmError::MalformedSection(format!(
                    "Invalid export kind {}",
                    other
                )))
            }
        };
        exports.push(ExportDescriptor {
            name: get_str(name_idx)?,
            kind,
            target_idx,
        });
    }

    let mut functions = Vec::with_capacity(funcs_raw.len());
    for (
        name_idx,
        param_count,
        local_count,
        max_stack,
        has_return,
        eff_indices,
        code_offset,
        code_length,
    ) in funcs_raw
    {
        let name = get_str(name_idx)?;
        let mut effects = Vec::with_capacity(eff_indices.len());
        for e_idx in eff_indices {
            effects.push(get_str(e_idx)?);
        }
        let start = code_offset as usize;
        let end = start.checked_add(code_length as usize).ok_or_else(|| {
            MvmError::MalformedSection(format!("Function '{}' code range overflow", name))
        })?;
        if end > code_bytes.len() {
            return Err(MvmError::MalformedSection(format!(
                "Function '{}' code slice {}..{} exceeds code section length {}",
                name,
                start,
                end,
                code_bytes.len()
            )));
        }
        let decoded = decode_instructions(&code_bytes[start..end], &name)?;
        functions.push(FunctionDescriptor {
            name,
            param_count,
            local_count,
            max_stack,
            has_return,
            effects,
            code_offset,
            code_length,
            decoded,
        });
    }

    Ok(MbcModule {
        major_version,
        minor_version,
        flags,
        module_name,
        requires,
        provides,
        denies,
        constants,
        structs,
        enums,
        imports,
        exports,
        global_count,
        entry_fn_idx,
        functions,
        code_bytes,
        debug_map,
        verified: false,
    })
}

pub fn disassemble_module(module: &MbcModule) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "; Manifest Bytecode (.mbc) v{}.{}\n",
        module.major_version, module.minor_version
    ));
    out.push_str(&format!("; Module: {}\n", module.module_name));
    out.push_str(&format!("; Requires: [{}]\n", module.requires.join(", ")));
    out.push_str(&format!("; Provides: [{}]\n", module.provides.join(", ")));
    out.push_str(&format!("; Denies:   [{}]\n", module.denies.join(", ")));
    out.push_str(&format!("; Globals:  {}\n\n", module.global_count));

    if !module.constants.is_empty() {
        out.push_str(".constants\n");
        for (i, c) in module.constants.iter().enumerate() {
            match c {
                ConstantEntry::I64(n) => out.push_str(&format!("  #{} = i64 {}\n", i, n)),
                ConstantEntry::F64(n) => out.push_str(&format!("  #{} = f64 {}\n", i, n)),
                ConstantEntry::Bool(b) => out.push_str(&format!("  #{} = bool {}\n", i, b)),
                ConstantEntry::Str(s) => out.push_str(&format!("  #{} = str {:?}\n", i, s)),
            }
        }
        out.push('\n');
    }

    if !module.imports.is_empty() {
        out.push_str(".imports\n");
        for (i, imp) in module.imports.iter().enumerate() {
            out.push_str(&format!(
                "  @{} = {} (cap: {}, arity: {})\n",
                i, imp.symbol, imp.capability, imp.arity
            ));
        }
        out.push('\n');
    }

    for (fn_idx, func) in module.functions.iter().enumerate() {
        let is_entry = module.entry_fn_idx == Some(fn_idx as u32);
        out.push_str(&format!(
            ".fn {} (idx={}, params={}, locals={}, max_stack={}, effects=[{}]){}\n",
            func.name,
            fn_idx,
            func.param_count,
            func.local_count,
            func.max_stack,
            func.effects.join(", "),
            if is_entry { " [entry]" } else { "" }
        ));
        for inst in &func.decoded {
            out.push_str(&format!("  {:04X}: {:?}\n", inst.offset, inst.op));
        }
        out.push('\n');
    }

    out
}

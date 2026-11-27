use std::collections::{HashMap, HashSet};

use mvm_core::bytecode::{section_tags, MBC_MAGIC, MBC_VERSION_MAJOR, MBC_VERSION_MINOR};
use mvm_core::instruction::opcodes;

use crate::ast::{BinaryOp, UnaryOp};
use crate::diagnostic::{Diagnostic, SourceSpan};
use crate::mir::*;
use crate::types::SemanticType;

struct ByteWriter {
    buf: Vec<u8>,
}

impl ByteWriter {
    fn new() -> Self {
        Self { buf: Vec::new() }
    }

    fn len(&self) -> usize {
        self.buf.len()
    }

    fn write_u8(&mut self, v: u8) {
        self.buf.push(v);
    }

    fn write_u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn write_u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn patch_u32(&mut self, offset: usize, v: u32) {
        let bytes = v.to_le_bytes();
        if offset + 4 <= self.buf.len() {
            self.buf[offset..offset + 4].copy_from_slice(&bytes);
        }
    }

    fn write_i64(&mut self, v: i64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn write_f64(&mut self, v: f64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn write_str(&mut self, s: &str) {
        let bytes = s.as_bytes();
        self.write_u32(bytes.len() as u32);
        self.buf.extend_from_slice(bytes);
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }
}

#[derive(Debug, Clone)]
enum ConstEntry {
    I64(i64),
    F64(f64),
    Bool(bool),
    Str(String),
}

struct ConstantPoolBuilder {
    entries: Vec<ConstEntry>,
    str_index: HashMap<String, u32>,
    i64_index: HashMap<i64, u32>,
    f64_index: HashMap<u64, u32>,
    bool_index: HashMap<bool, u32>,
}

impl ConstantPoolBuilder {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
            str_index: HashMap::new(),
            i64_index: HashMap::new(),
            f64_index: HashMap::new(),
            bool_index: HashMap::new(),
        }
    }

    fn intern_str(&mut self, s: &str) -> u32 {
        if let Some(&idx) = self.str_index.get(s) {
            return idx;
        }
        let idx = self.entries.len() as u32;
        self.entries.push(ConstEntry::Str(s.to_string()));
        self.str_index.insert(s.to_string(), idx);
        idx
    }

    fn intern_i64(&mut self, v: i64) -> u32 {
        if let Some(&idx) = self.i64_index.get(&v) {
            return idx;
        }
        let idx = self.entries.len() as u32;
        self.entries.push(ConstEntry::I64(v));
        self.i64_index.insert(v, idx);
        idx
    }

    fn intern_f64(&mut self, v: f64) -> u32 {
        // Use IEEE-754 bit pattern so -0.0 and NaN stay distinct from +0.0.
        let bits = v.to_bits();
        if let Some(&idx) = self.f64_index.get(&bits) {
            return idx;
        }
        let idx = self.entries.len() as u32;
        self.entries.push(ConstEntry::F64(v));
        self.f64_index.insert(bits, idx);
        idx
    }

    fn intern_bool(&mut self, v: bool) -> u32 {
        if let Some(&idx) = self.bool_index.get(&v) {
            return idx;
        }
        let idx = self.entries.len() as u32;
        self.entries.push(ConstEntry::Bool(v));
        self.bool_index.insert(v, idx);
        idx
    }
}

struct MbcImportDesc {
    symbol: String,
    capability: String,
    arity: u16,
    has_return: bool,
}

struct MbcDebugEntry {
    fn_index: u32,
    code_offset: u32,
    line: u32,
    column: u32,
}

struct LoopPatchContext {
    continue_target_offset: u32,
    break_patch_locations: Vec<usize>,
}

struct CompiledFuncRecord<'a> {
    func: &'a MIRFunction,
    local_count: u16,
    max_stack: u16,
    code_offset: u32,
    code_length: u32,
}

pub struct CompiledMbcResult {
    pub bytes: Vec<u8>,
    pub module_name: String,
    pub function_count: usize,
    pub constant_count: usize,
    pub import_count: usize,
}

fn encode_type_tag(t: &SemanticType) -> u8 {
    match t {
        SemanticType::Void => 0,
        SemanticType::I64 => 1,
        SemanticType::F64 => 2,
        SemanticType::Bool => 3,
        SemanticType::Str => 4,
        SemanticType::Array(_) => 5,
        SemanticType::Map { .. } => 6,
        SemanticType::Struct { .. } => 7,
        SemanticType::Enum { .. } | SemanticType::Result { .. } => 8,
        _ => 9,
    }
}

pub fn compile_mir_to_mbc(mir: &MIRModule) -> Result<CompiledMbcResult, Diagnostic> {
    let mut consts = ConstantPoolBuilder::new();
    let mut imports: Vec<MbcImportDesc> = Vec::new();
    let mut import_key_map: HashMap<String, u32> = HashMap::new();

    for st in &mir.structs {
        consts.intern_str(&st.name);
        for f in &st.fields {
            consts.intern_str(&f.name);
        }
    }
    for en in &mir.enums {
        consts.intern_str(&en.name);
        for v in &en.variants {
            consts.intern_str(&v.name);
        }
    }

    let mut fn_index_map: HashMap<String, u32> = HashMap::new();
    for (idx, fn_d) in mir.functions.iter().enumerate() {
        fn_index_map.insert(fn_d.name.clone(), idx as u32);
        consts.intern_str(&fn_d.name);
        for eff in &fn_d.effects {
            consts.intern_str(eff);
        }
    }

    for g in &mir.globals {
        if g.exported {
            consts.intern_str(&g.name);
        }
    }

    let mut code_section = ByteWriter::new();
    let mut debug_map: Vec<MbcDebugEntry> = Vec::new();
    let mut compiled_funcs: Vec<CompiledFuncRecord<'_>> = Vec::with_capacity(mir.functions.len());

    for (fn_idx, fn_d) in mir.functions.iter().enumerate() {
        let mut emitter = FnCodeEmitter {
            fn_idx: fn_idx as u32,
            fn_code: ByteWriter::new(),
            consts: &mut consts,
            imports: &mut imports,
            import_key_map: &mut import_key_map,
            fn_index_map: &fn_index_map,
            debug_map: &mut debug_map,
            local_count: fn_d.locals.len().max(fn_d.params.len()) as u16,
            current_stack: 0,
            max_stack: 8,
            patched_jump_targets: HashSet::new(),
            loop_stack: Vec::new(),
            last_debug_line: 0,
        };

        let body_terminated = emitter.emit_block(&fn_d.body)?;
        let cur_len = emitter.fn_code.len() as u32;
        if !body_terminated || cur_len == 0 || emitter.patched_jump_targets.contains(&cur_len) {
            match fn_d.return_type {
                SemanticType::I64 => {
                    let z = emitter.consts.intern_i64(0);
                    emitter.fn_code.write_u8(opcodes::CONST);
                    emitter.fn_code.write_u32(z);
                    emitter.fn_code.write_u8(opcodes::RET);
                }
                SemanticType::F64 => {
                    let z = emitter.consts.intern_f64(0.0);
                    emitter.fn_code.write_u8(opcodes::CONST);
                    emitter.fn_code.write_u32(z);
                    emitter.fn_code.write_u8(opcodes::RET);
                }
                SemanticType::Bool => {
                    let z = emitter.consts.intern_bool(false);
                    emitter.fn_code.write_u8(opcodes::CONST);
                    emitter.fn_code.write_u32(z);
                    emitter.fn_code.write_u8(opcodes::RET);
                }
                SemanticType::Str => {
                    let z = emitter.consts.intern_str("");
                    emitter.fn_code.write_u8(opcodes::CONST);
                    emitter.fn_code.write_u32(z);
                    emitter.fn_code.write_u8(opcodes::RET);
                }
                _ => {
                    emitter.fn_code.write_u8(opcodes::RET_VOID);
                }
            }
            if emitter.max_stack < 2 {
                emitter.max_stack = 2;
            }
        }

        let local_count = emitter.local_count;
        let max_stack = (emitter.max_stack + 4).max(8) as u16;
        let fn_bytes = emitter.fn_code.buf;
        let code_offset = code_section.len() as u32;
        let code_length = fn_bytes.len() as u32;
        code_section.write_bytes(&fn_bytes);

        compiled_funcs.push(CompiledFuncRecord {
            func: fn_d,
            local_count,
            max_stack,
            code_offset,
            code_length,
        });
    }

    // Build sections matching mvm-core/src/decoder.rs byte-for-byte
    let mut sec_meta = ByteWriter::new();
    let mod_name = if mir.module_name.is_empty() {
        "main"
    } else {
        mir.module_name.as_str()
    };
    sec_meta.write_str(mod_name);
    sec_meta.write_u16(mir.requires.len() as u16);
    for r in &mir.requires {
        sec_meta.write_str(r);
    }
    sec_meta.write_u16(mir.provides.len() as u16);
    for p in &mir.provides {
        sec_meta.write_str(p);
    }
    sec_meta.write_u16(mir.denies.len() as u16);
    for d in &mir.denies {
        sec_meta.write_str(d);
    }

    let mut sec_types = ByteWriter::new();
    sec_types.write_u32(mir.structs.len() as u32);
    for st in &mir.structs {
        sec_types.write_u32(consts.intern_str(&st.name));
        sec_types.write_u16(st.fields.len() as u16);
        for f in &st.fields {
            sec_types.write_u32(consts.intern_str(&f.name));
            sec_types.write_u8(encode_type_tag(&f.field_type));
        }
    }
    sec_types.write_u32(mir.enums.len() as u32);
    for en in &mir.enums {
        sec_types.write_u32(consts.intern_str(&en.name));
        sec_types.write_u16(en.variants.len() as u16);
        for v in &en.variants {
            sec_types.write_u32(consts.intern_str(&v.name));
            sec_types.write_u16(v.payload_types.len() as u16);
        }
    }

    let mut sec_imports = ByteWriter::new();
    sec_imports.write_u32(imports.len() as u32);
    for imp in &imports {
        sec_imports.write_u32(consts.intern_str(&imp.symbol));
        sec_imports.write_u32(consts.intern_str(&imp.capability));
        sec_imports.write_u16(imp.arity);
        sec_imports.write_u8(if imp.has_return { 1 } else { 0 });
    }

    let mut sec_exports = ByteWriter::new();
    let mut export_items: Vec<(String, u8, u32)> = Vec::new();
    for (idx, cf) in compiled_funcs.iter().enumerate() {
        if cf.func.exported {
            export_items.push((cf.func.name.clone(), 0u8, idx as u32));
        }
    }
    for g in &mir.globals {
        if g.exported {
            export_items.push((g.name.clone(), 1u8, g.slot as u32));
        }
    }
    sec_exports.write_u32(export_items.len() as u32);
    for (name, kind, target_idx) in export_items {
        sec_exports.write_u32(consts.intern_str(&name));
        sec_exports.write_u8(kind);
        sec_exports.write_u32(target_idx);
    }

    let mut sec_funcs = ByteWriter::new();
    sec_funcs.write_u32(mir.globals.len() as u32);
    let entry_idx = mir
        .entry_function
        .as_ref()
        .and_then(|e| fn_index_map.get(e).copied())
        .unwrap_or(0xffff_ffff);
    sec_funcs.write_u32(entry_idx);
    sec_funcs.write_u32(compiled_funcs.len() as u32);
    for cf in &compiled_funcs {
        sec_funcs.write_u32(consts.intern_str(&cf.func.name));
        sec_funcs.write_u16(cf.func.params.len() as u16);
        sec_funcs.write_u16(cf.local_count);
        sec_funcs.write_u16(cf.max_stack);
        sec_funcs.write_u8(if matches!(cf.func.return_type, SemanticType::Void) {
            0
        } else {
            1
        });
        sec_funcs.write_u16(cf.func.effects.len() as u16);
        for eff in &cf.func.effects {
            sec_funcs.write_u32(consts.intern_str(eff));
        }
        sec_funcs.write_u32(cf.code_offset);
        sec_funcs.write_u32(cf.code_length);
    }

    let mut sec_debug = ByteWriter::new();
    sec_debug.write_u32(debug_map.len() as u32);
    for dm in &debug_map {
        sec_debug.write_u32(dm.fn_index);
        sec_debug.write_u32(dm.code_offset);
        sec_debug.write_u32(dm.line);
        sec_debug.write_u32(dm.column);
    }

    // Serialize CONST_POOL after all intern_str calls so CONST_POOL is 100% complete.
    let mut final_sec_consts = ByteWriter::new();
    final_sec_consts.write_u32(consts.entries.len() as u32);
    for c in &consts.entries {
        match c {
            ConstEntry::I64(v) => {
                final_sec_consts.write_u8(0x01);
                final_sec_consts.write_i64(*v);
            }
            ConstEntry::F64(v) => {
                final_sec_consts.write_u8(0x02);
                final_sec_consts.write_f64(*v);
            }
            ConstEntry::Bool(b) => {
                final_sec_consts.write_u8(0x03);
                final_sec_consts.write_u8(if *b { 1 } else { 0 });
            }
            ConstEntry::Str(s) => {
                final_sec_consts.write_u8(0x04);
                final_sec_consts.write_str(s);
            }
        }
    }

    let sections: [(u32, Vec<u8>); 8] = [
        (section_tags::MODULE_META, sec_meta.buf),
        (section_tags::CONST_POOL, final_sec_consts.buf),
        (section_tags::TYPE_TABLE, sec_types.buf),
        (section_tags::IMPORT_TABLE, sec_imports.buf),
        (section_tags::EXPORT_TABLE, sec_exports.buf),
        (section_tags::FUNC_TABLE, sec_funcs.buf),
        (section_tags::CODE, code_section.buf),
        (section_tags::DEBUG_MAP, sec_debug.buf),
    ];

    let mut container = ByteWriter::new();
    container.write_bytes(&MBC_MAGIC);
    container.write_u16(MBC_VERSION_MAJOR);
    container.write_u16(MBC_VERSION_MINOR);
    container.write_u32(0); // flags
    container.write_u32(sections.len() as u32);

    let mut current_offset = (16 + sections.len() * 12) as u32;
    for (tag, payload) in &sections {
        container.write_u32(*tag);
        container.write_u32(current_offset);
        container.write_u32(payload.len() as u32);
        current_offset += payload.len() as u32;
    }
    for (_, payload) in &sections {
        container.write_bytes(payload);
    }

    Ok(CompiledMbcResult {
        bytes: container.buf,
        module_name: mod_name.to_string(),
        function_count: compiled_funcs.len(),
        constant_count: consts.entries.len(),
        import_count: imports.len(),
    })
}

struct FnCodeEmitter<'a> {
    fn_idx: u32,
    fn_code: ByteWriter,
    consts: &'a mut ConstantPoolBuilder,
    imports: &'a mut Vec<MbcImportDesc>,
    import_key_map: &'a mut HashMap<String, u32>,
    fn_index_map: &'a HashMap<String, u32>,
    debug_map: &'a mut Vec<MbcDebugEntry>,
    local_count: u16,
    current_stack: i32,
    max_stack: i32,
    patched_jump_targets: HashSet<u32>,
    loop_stack: Vec<LoopPatchContext>,
    last_debug_line: u32,
}

impl<'a> FnCodeEmitter<'a> {
    fn adjust_stack(&mut self, delta: i32) {
        self.current_stack += delta;
        if self.current_stack < 0 {
            self.current_stack = 0;
        }
        if self.current_stack > self.max_stack {
            self.max_stack = self.current_stack;
        }
    }

    fn record_debug(&mut self, line: u32, column: u32) {
        if line > 0 && line != self.last_debug_line {
            self.last_debug_line = line;
            self.debug_map.push(MbcDebugEntry {
                fn_index: self.fn_idx,
                code_offset: self.fn_code.len() as u32,
                line,
                column: column.max(1),
            });
        }
    }

    fn emit_jump_placeholder(&mut self, op: u8) -> usize {
        self.fn_code.write_u8(op);
        if op == opcodes::JMP_IF_FALSE || op == opcodes::JMP_IF_TRUE {
            self.adjust_stack(-1);
        }
        let patch_at = self.fn_code.len();
        self.fn_code.write_u32(0);
        patch_at
    }

    fn patch_jump_to(&mut self, patch_at: usize, target_offset: u32) {
        self.fn_code.patch_u32(patch_at, target_offset);
        self.patched_jump_targets.insert(target_offset);
    }

    fn alloc_synthetic_slot(&mut self, span: &SourceSpan) -> Result<u16, Diagnostic> {
        let slot = self.local_count;
        self.local_count = self.local_count.checked_add(1).ok_or_else(|| {
            Diagnostic::error(
                "E_MBC_LIMIT",
                "Function exceeded maximum u16 local slot limit",
                span,
            )
        })?;
        Ok(slot)
    }

    fn intern_import(
        &mut self,
        symbol: &str,
        capability: &str,
        arity: u16,
        has_return: bool,
    ) -> u32 {
        let key = format!(
            "{symbol}|{capability}|{arity}|{}",
            if has_return { 1 } else { 0 }
        );
        if let Some(&idx) = self.import_key_map.get(&key) {
            return idx;
        }
        let idx = self.imports.len() as u32;
        self.imports.push(MbcImportDesc {
            symbol: symbol.to_string(),
            capability: capability.to_string(),
            arity,
            has_return,
        });
        self.import_key_map.insert(key, idx);
        self.consts.intern_str(symbol);
        self.consts.intern_str(capability);
        idx
    }

    fn emit_block(&mut self, stmts: &[MIRStmt]) -> Result<bool, Diagnostic> {
        let mut terminated = false;
        for stmt in stmts {
            if terminated {
                break;
            }
            terminated = self.emit_stmt(stmt)?;
        }
        Ok(terminated)
    }

    fn emit_stmt(&mut self, stmt: &MIRStmt) -> Result<bool, Diagnostic> {
        match stmt {
            MIRStmt::StoreLocal {
                slot, value, span, ..
            } => {
                self.record_debug(span.line, span.column);
                self.emit_expr(value)?;
                self.fn_code.write_u8(opcodes::STORE_LOCAL);
                self.fn_code.write_u16(*slot as u16);
                self.adjust_stack(-1);
                Ok(false)
            }
            MIRStmt::StoreGlobal {
                slot, value, span, ..
            } => {
                self.record_debug(span.line, span.column);
                self.emit_expr(value)?;
                self.fn_code.write_u8(opcodes::STORE_GLOBAL);
                self.fn_code.write_u32(*slot as u32);
                self.adjust_stack(-1);
                Ok(false)
            }
            MIRStmt::ArraySet {
                array,
                index,
                value,
                span,
            } => {
                self.record_debug(span.line, span.column);
                self.emit_expr(array)?;
                self.emit_expr(index)?;
                self.emit_expr(value)?;
                self.fn_code.write_u8(opcodes::ARRAY_SET);
                self.adjust_stack(-3);
                Ok(false)
            }
            MIRStmt::MapSetStmt {
                map,
                key,
                value,
                span,
            } => {
                self.record_debug(span.line, span.column);
                self.emit_expr(map)?;
                self.emit_expr(key)?;
                self.emit_expr(value)?;
                self.fn_code.write_u8(opcodes::MAP_SET);
                self.adjust_stack(-2);
                self.fn_code.write_u8(opcodes::POP);
                self.adjust_stack(-1);
                Ok(false)
            }
            MIRStmt::FieldSet {
                object,
                field_index,
                value,
                span,
                ..
            } => {
                self.record_debug(span.line, span.column);
                self.emit_expr(object)?;
                self.emit_expr(value)?;
                self.fn_code.write_u8(opcodes::FIELD_SET);
                self.fn_code.write_u16(*field_index as u16);
                self.adjust_stack(-2);
                Ok(false)
            }
            MIRStmt::ExprStmt { expr, span } => {
                self.record_debug(span.line, span.column);
                self.emit_expr(expr)?;
                self.fn_code.write_u8(opcodes::POP);
                self.adjust_stack(-1);
                Ok(false)
            }
            MIRStmt::If {
                condition,
                then_branch,
                else_branch,
                span,
            } => {
                self.record_debug(span.line, span.column);
                self.emit_expr(condition)?;
                let jump_else = self.emit_jump_placeholder(opcodes::JMP_IF_FALSE);
                let saved_stack = self.current_stack;
                let then_term = self.emit_block(then_branch)?;

                if !else_branch.is_empty() {
                    let jump_end = if !then_term {
                        Some(self.emit_jump_placeholder(opcodes::JMP))
                    } else {
                        None
                    };
                    let else_offset = self.fn_code.len() as u32;
                    self.patch_jump_to(jump_else, else_offset);
                    self.current_stack = saved_stack;
                    let else_term = self.emit_block(else_branch)?;
                    let end_offset = self.fn_code.len() as u32;
                    if let Some(je) = jump_end {
                        self.patch_jump_to(je, end_offset);
                    }
                    self.current_stack = saved_stack;
                    Ok(then_term && else_term)
                } else {
                    let end_offset = self.fn_code.len() as u32;
                    self.patch_jump_to(jump_else, end_offset);
                    self.current_stack = saved_stack;
                    Ok(false)
                }
            }
            MIRStmt::While {
                condition,
                body,
                span,
            } => {
                self.record_debug(span.line, span.column);
                let loop_start = self.fn_code.len() as u32;
                self.patched_jump_targets.insert(loop_start);
                let saved_stack = self.current_stack;

                self.emit_expr(condition)?;
                let jump_exit = self.emit_jump_placeholder(opcodes::JMP_IF_FALSE);

                self.loop_stack.push(LoopPatchContext {
                    continue_target_offset: loop_start,
                    break_patch_locations: Vec::new(),
                });
                let body_term = self.emit_block(body)?;
                let loop_ctx = self.loop_stack.pop();

                if !body_term {
                    let jmp_back = self.emit_jump_placeholder(opcodes::JMP);
                    self.patch_jump_to(jmp_back, loop_start);
                }

                let exit_offset = self.fn_code.len() as u32;
                self.patch_jump_to(jump_exit, exit_offset);
                if let Some(ctx) = loop_ctx {
                    for b_patch in ctx.break_patch_locations {
                        self.patch_jump_to(b_patch, exit_offset);
                    }
                }
                self.current_stack = saved_stack;
                Ok(false)
            }
            MIRStmt::Break { span } => {
                self.record_debug(span.line, span.column);
                if !self.loop_stack.is_empty() {
                    let p = self.emit_jump_placeholder(opcodes::JMP);
                    if let Some(ctx) = self.loop_stack.last_mut() {
                        ctx.break_patch_locations.push(p);
                    }
                }
                Ok(true)
            }
            MIRStmt::Continue { span } => {
                self.record_debug(span.line, span.column);
                if let Some(target) = self.loop_stack.last().map(|c| c.continue_target_offset) {
                    let p = self.emit_jump_placeholder(opcodes::JMP);
                    self.patch_jump_to(p, target);
                }
                Ok(true)
            }
            MIRStmt::Return { value, span } => {
                self.record_debug(span.line, span.column);
                if let Some(v) = value {
                    self.emit_expr(v)?;
                    self.fn_code.write_u8(opcodes::RET);
                    self.adjust_stack(-1);
                } else {
                    self.fn_code.write_u8(opcodes::RET_VOID);
                }
                Ok(true)
            }
            MIRStmt::Match {
                subject,
                temp_slot,
                arms,
                span,
            } => {
                self.record_debug(span.line, span.column);
                let saved_stack = self.current_stack;
                self.emit_expr(subject)?;
                self.fn_code.write_u8(opcodes::STORE_LOCAL);
                self.fn_code.write_u16(*temp_slot as u16);
                self.adjust_stack(-1);

                let mut end_jumps = Vec::new();
                let mut all_arms_terminated = !arms.is_empty();
                let mut has_wildcard = false;

                for arm in arms {
                    self.current_stack = saved_stack;
                    let mut jump_next_arm: Option<usize> = None;

                    match &arm.pattern {
                        MIRMatchPattern::Wildcard => {
                            has_wildcard = true;
                        }
                        MIRMatchPattern::Literal(lit) => {
                            self.fn_code.write_u8(opcodes::LOAD_LOCAL);
                            self.fn_code.write_u16(*temp_slot as u16);
                            self.adjust_stack(1);
                            let c_idx = match lit {
                                MIRPatternLiteral::I64(n) => self.consts.intern_i64(*n),
                                MIRPatternLiteral::F64(n) => self.consts.intern_f64(*n),
                                MIRPatternLiteral::Bool(b) => self.consts.intern_bool(*b),
                                MIRPatternLiteral::Str(s) => self.consts.intern_str(s),
                            };
                            self.fn_code.write_u8(opcodes::CONST);
                            self.fn_code.write_u32(c_idx);
                            self.adjust_stack(1);
                            self.fn_code.write_u8(opcodes::EQ);
                            self.adjust_stack(-1);
                            jump_next_arm = Some(self.emit_jump_placeholder(opcodes::JMP_IF_FALSE));
                        }
                        MIRMatchPattern::EnumVariant {
                            variant_tag,
                            binding_slots,
                            ..
                        } => {
                            self.fn_code.write_u8(opcodes::LOAD_LOCAL);
                            self.fn_code.write_u16(*temp_slot as u16);
                            self.adjust_stack(1);
                            self.fn_code.write_u8(opcodes::ENUM_TAG);
                            let tag_idx = self.consts.intern_i64(*variant_tag as i64);
                            self.fn_code.write_u8(opcodes::CONST);
                            self.fn_code.write_u32(tag_idx);
                            self.adjust_stack(1);
                            self.fn_code.write_u8(opcodes::EQ);
                            self.adjust_stack(-1);
                            jump_next_arm = Some(self.emit_jump_placeholder(opcodes::JMP_IF_FALSE));

                            for (i, bs) in binding_slots.iter().enumerate() {
                                self.fn_code.write_u8(opcodes::LOAD_LOCAL);
                                self.fn_code.write_u16(*temp_slot as u16);
                                self.adjust_stack(1);
                                self.fn_code.write_u8(opcodes::ENUM_PAYLOAD);
                                self.fn_code.write_u16(i as u16);
                                self.fn_code.write_u8(opcodes::STORE_LOCAL);
                                self.fn_code.write_u16(bs.slot as u16);
                                self.adjust_stack(-1);
                            }
                        }
                    }

                    let arm_term = self.emit_block(&arm.body)?;
                    if !arm_term {
                        all_arms_terminated = false;
                        end_jumps.push(self.emit_jump_placeholder(opcodes::JMP));
                    }

                    if let Some(jna) = jump_next_arm {
                        let next_arm_off = self.fn_code.len() as u32;
                        self.patch_jump_to(jna, next_arm_off);
                    }

                    if matches!(arm.pattern, MIRMatchPattern::Wildcard) {
                        break;
                    }
                }

                let match_end_off = self.fn_code.len() as u32;
                for ej in end_jumps {
                    self.patch_jump_to(ej, match_end_off);
                }
                self.current_stack = saved_stack;
                Ok(has_wildcard && all_arms_terminated)
            }
        }
    }

    fn emit_expr(&mut self, expr: &MIRExpr) -> Result<(), Diagnostic> {
        self.record_debug(expr.span.line, expr.span.column);
        match &expr.kind {
            MIRExprKind::ConstInt { value } => {
                let idx = self.consts.intern_i64(*value);
                self.fn_code.write_u8(opcodes::CONST);
                self.fn_code.write_u32(idx);
                self.adjust_stack(1);
            }
            MIRExprKind::ConstFloat { value } => {
                let idx = self.consts.intern_f64(*value);
                self.fn_code.write_u8(opcodes::CONST);
                self.fn_code.write_u32(idx);
                self.adjust_stack(1);
            }
            MIRExprKind::ConstBool { value } => {
                let idx = self.consts.intern_bool(*value);
                self.fn_code.write_u8(opcodes::CONST);
                self.fn_code.write_u32(idx);
                self.adjust_stack(1);
            }
            MIRExprKind::ConstStr { value } => {
                let idx = self.consts.intern_str(value);
                self.fn_code.write_u8(opcodes::CONST);
                self.fn_code.write_u32(idx);
                self.adjust_stack(1);
            }
            MIRExprKind::ConstVoid => {
                self.fn_code.write_u8(opcodes::PUSH_VOID);
                self.adjust_stack(1);
            }
            MIRExprKind::LoadLocal { slot, .. } => {
                self.fn_code.write_u8(opcodes::LOAD_LOCAL);
                self.fn_code.write_u16(*slot as u16);
                self.adjust_stack(1);
            }
            MIRExprKind::LoadGlobal { slot, .. } => {
                self.fn_code.write_u8(opcodes::LOAD_GLOBAL);
                self.fn_code.write_u32(*slot as u32);
                self.adjust_stack(1);
            }
            MIRExprKind::Unary { op, operand } => {
                self.emit_expr(operand)?;
                match op {
                    UnaryOp::Neg => {
                        let opc = if matches!(operand.expr_type, SemanticType::F64) {
                            opcodes::NEG_F64
                        } else {
                            opcodes::NEG_I64
                        };
                        self.fn_code.write_u8(opc);
                    }
                    UnaryOp::Not => {
                        self.fn_code.write_u8(opcodes::NOT);
                    }
                }
            }
            MIRExprKind::Cast { cast_kind, operand } => {
                self.emit_expr(operand)?;
                let opc = match cast_kind {
                    CastKind::I64ToF64 => opcodes::I64_TO_F64,
                    CastKind::F64ToI64 => opcodes::F64_TO_I64,
                    CastKind::ToStr => opcodes::TO_STR,
                };
                self.fn_code.write_u8(opc);
            }
            MIRExprKind::Binary { op, left, right } => {
                if *op == BinaryOp::And {
                    let base_h = self.current_stack;
                    self.emit_expr(left)?;
                    let jump_false = self.emit_jump_placeholder(opcodes::JMP_IF_FALSE);
                    self.current_stack = base_h;
                    self.emit_expr(right)?;
                    let jump_end = self.emit_jump_placeholder(opcodes::JMP);
                    let false_offset = self.fn_code.len() as u32;
                    self.patch_jump_to(jump_false, false_offset);
                    self.current_stack = base_h;
                    let false_const = self.consts.intern_bool(false);
                    self.fn_code.write_u8(opcodes::CONST);
                    self.fn_code.write_u32(false_const);
                    self.adjust_stack(1);
                    let end_offset = self.fn_code.len() as u32;
                    self.patch_jump_to(jump_end, end_offset);
                    self.current_stack = base_h + 1;
                    return Ok(());
                }

                if *op == BinaryOp::Or {
                    let base_h = self.current_stack;
                    self.emit_expr(left)?;
                    let jump_true = self.emit_jump_placeholder(opcodes::JMP_IF_TRUE);
                    self.current_stack = base_h;
                    self.emit_expr(right)?;
                    let jump_end = self.emit_jump_placeholder(opcodes::JMP);
                    let true_offset = self.fn_code.len() as u32;
                    self.patch_jump_to(jump_true, true_offset);
                    self.current_stack = base_h;
                    let true_const = self.consts.intern_bool(true);
                    self.fn_code.write_u8(opcodes::CONST);
                    self.fn_code.write_u32(true_const);
                    self.adjust_stack(1);
                    let end_offset = self.fn_code.len() as u32;
                    self.patch_jump_to(jump_end, end_offset);
                    self.current_stack = base_h + 1;
                    return Ok(());
                }

                self.emit_expr(left)?;
                self.emit_expr(right)?;
                let is_float = matches!(left.expr_type, SemanticType::F64)
                    || matches!(right.expr_type, SemanticType::F64);
                let is_str_concat = *op == BinaryOp::Add
                    && (matches!(expr.expr_type, SemanticType::Str)
                        || matches!(left.expr_type, SemanticType::Str)
                        || matches!(right.expr_type, SemanticType::Str));

                if is_str_concat {
                    self.fn_code.write_u8(opcodes::CONCAT_STR);
                } else {
                    let opc = match op {
                        BinaryOp::Add => {
                            if is_float {
                                opcodes::ADD_F64
                            } else {
                                opcodes::ADD_I64
                            }
                        }
                        BinaryOp::Sub => {
                            if is_float {
                                opcodes::SUB_F64
                            } else {
                                opcodes::SUB_I64
                            }
                        }
                        BinaryOp::Mul => {
                            if is_float {
                                opcodes::MUL_F64
                            } else {
                                opcodes::MUL_I64
                            }
                        }
                        BinaryOp::Div => {
                            if is_float {
                                opcodes::DIV_F64
                            } else {
                                opcodes::DIV_I64
                            }
                        }
                        BinaryOp::Mod => opcodes::MOD_I64,
                        BinaryOp::Eq => opcodes::EQ,
                        BinaryOp::Neq => opcodes::NEQ,
                        BinaryOp::Lt => opcodes::LT,
                        BinaryOp::Lte => opcodes::LTE,
                        BinaryOp::Gt => opcodes::GT,
                        BinaryOp::Gte => opcodes::GTE,
                        BinaryOp::And => opcodes::BOOL_AND,
                        BinaryOp::Or => opcodes::BOOL_OR,
                    };
                    self.fn_code.write_u8(opc);
                }
                self.adjust_stack(-1);
            }
            MIRExprKind::CallFunction { callee, args } => {
                for a in args {
                    self.emit_expr(a)?;
                }
                let target_idx = self.fn_index_map.get(callee).copied().unwrap_or(0);
                self.fn_code.write_u8(opcodes::CALL);
                self.fn_code.write_u32(target_idx);
                self.adjust_stack(-(args.len() as i32) + 1);
            }
            MIRExprKind::CallIntrinsic {
                symbol,
                capability,
                args,
            } => {
                for a in args {
                    self.emit_expr(a)?;
                }
                let has_return = !matches!(expr.expr_type, SemanticType::Void);
                let imp_idx = self.intern_import(symbol, capability, args.len() as u16, has_return);
                self.fn_code.write_u8(opcodes::HOST_CALL);
                self.fn_code.write_u32(imp_idx);
                self.adjust_stack(-(args.len() as i32) + 1);
            }
            MIRExprKind::ArrayNew { elements } => {
                for e in elements {
                    self.emit_expr(e)?;
                }
                self.fn_code.write_u8(opcodes::ARRAY_NEW);
                self.fn_code.write_u32(elements.len() as u32);
                self.adjust_stack(-(elements.len() as i32) + 1);
            }
            MIRExprKind::ArrayGet { array, index } => {
                self.emit_expr(array)?;
                self.emit_expr(index)?;
                self.fn_code.write_u8(opcodes::ARRAY_GET);
                self.adjust_stack(-1);
            }
            MIRExprKind::ArrayLen { target } => {
                self.emit_expr(target)?;
                self.fn_code.write_u8(opcodes::ARRAY_LEN);
            }
            MIRExprKind::ArrayPush { array, value } => {
                self.emit_expr(array)?;
                self.emit_expr(value)?;
                self.fn_code.write_u8(opcodes::ARRAY_PUSH);
                self.adjust_stack(-1);
            }
            MIRExprKind::MapNew { entries } => {
                for kv in entries {
                    self.emit_expr(&kv.key)?;
                    self.emit_expr(&kv.value)?;
                }
                self.fn_code.write_u8(opcodes::MAP_NEW);
                self.fn_code.write_u32(entries.len() as u32);
                self.adjust_stack(-((entries.len() * 2) as i32) + 1);
            }
            MIRExprKind::MapGet { map, key } => {
                self.emit_expr(map)?;
                self.emit_expr(key)?;
                self.fn_code.write_u8(opcodes::MAP_GET);
                self.adjust_stack(-1);
            }
            MIRExprKind::MapSet { map, key, value } => {
                self.emit_expr(map)?;
                self.emit_expr(key)?;
                self.emit_expr(value)?;
                self.fn_code.write_u8(opcodes::MAP_SET);
                self.adjust_stack(-2);
            }
            MIRExprKind::MapHas { map, key } => {
                self.emit_expr(map)?;
                self.emit_expr(key)?;
                self.fn_code.write_u8(opcodes::MAP_HAS);
                self.adjust_stack(-1);
            }
            MIRExprKind::StructNew {
                struct_index,
                fields,
                ..
            } => {
                for f in fields {
                    self.emit_expr(f)?;
                }
                self.fn_code.write_u8(opcodes::STRUCT_NEW);
                self.fn_code.write_u32(*struct_index as u32);
                self.adjust_stack(-(fields.len() as i32) + 1);
            }
            MIRExprKind::FieldGet {
                object,
                field_index,
                ..
            } => {
                self.emit_expr(object)?;
                self.fn_code.write_u8(opcodes::FIELD_GET);
                self.fn_code.write_u16(*field_index as u16);
            }
            MIRExprKind::EnumNew {
                enum_index,
                variant_tag,
                args,
                ..
            } => {
                for a in args {
                    self.emit_expr(a)?;
                }
                self.fn_code.write_u8(opcodes::ENUM_NEW);
                self.fn_code.write_u32(*enum_index as u32);
                self.fn_code.write_u16(*variant_tag as u16);
                self.adjust_stack(-(args.len() as i32) + 1);
            }
            MIRExprKind::TryPropagate { operand } => {
                let base_h = self.current_stack;
                let tmp_slot = self.alloc_synthetic_slot(&expr.span)?;
                self.emit_expr(operand)?;
                self.fn_code.write_u8(opcodes::STORE_LOCAL);
                self.fn_code.write_u16(tmp_slot);
                self.adjust_stack(-1);

                self.fn_code.write_u8(opcodes::LOAD_LOCAL);
                self.fn_code.write_u16(tmp_slot);
                self.adjust_stack(1);
                self.fn_code.write_u8(opcodes::ENUM_TAG);
                let err_tag_idx = self.consts.intern_i64(1);
                self.fn_code.write_u8(opcodes::CONST);
                self.fn_code.write_u32(err_tag_idx);
                self.adjust_stack(1);
                self.fn_code.write_u8(opcodes::EQ);
                self.adjust_stack(-1);

                let jump_ok = self.emit_jump_placeholder(opcodes::JMP_IF_FALSE);
                self.fn_code.write_u8(opcodes::LOAD_LOCAL);
                self.fn_code.write_u16(tmp_slot);
                self.adjust_stack(1);
                self.fn_code.write_u8(opcodes::RET);
                self.adjust_stack(-1);

                let ok_offset = self.fn_code.len() as u32;
                self.patch_jump_to(jump_ok, ok_offset);
                self.current_stack = base_h;
                self.fn_code.write_u8(opcodes::LOAD_LOCAL);
                self.fn_code.write_u16(tmp_slot);
                self.adjust_stack(1);
                self.fn_code.write_u8(opcodes::ENUM_PAYLOAD);
                self.fn_code.write_u16(0);
                self.current_stack = base_h + 1;
            }
        }
        Ok(())
    }
}

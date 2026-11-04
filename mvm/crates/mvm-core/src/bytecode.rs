use crate::errors::MvmError;
use crate::instruction::DecodedInstruction;

pub const MBC_MAGIC: [u8; 4] = [0x4D, 0x42, 0x43, 0x00]; // "MBC\0"
pub const MBC_VERSION_MAJOR: u16 = 1;
pub const MBC_VERSION_MINOR: u16 = 0;

pub mod section_tags {
    pub const MODULE_META: u32 = 0x01;
    pub const CONST_POOL: u32 = 0x02;
    pub const TYPE_TABLE: u32 = 0x03;
    pub const IMPORT_TABLE: u32 = 0x04;
    pub const EXPORT_TABLE: u32 = 0x05;
    pub const FUNC_TABLE: u32 = 0x06;
    pub const CODE: u32 = 0x07;
    pub const DEBUG_MAP: u32 = 0x08;
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConstantEntry {
    I64(i64),
    F64(f64),
    Bool(bool),
    Str(String),
}

#[derive(Debug, Clone)]
pub struct StructDescriptor {
    pub name: String,
    pub fields: Vec<(String, u8)>,
}

#[derive(Debug, Clone)]
pub struct EnumVariantDescriptor {
    pub name: String,
    pub arity: u16,
}

#[derive(Debug, Clone)]
pub struct EnumDescriptor {
    pub name: String,
    pub variants: Vec<EnumVariantDescriptor>,
}

#[derive(Debug, Clone)]
pub struct HostImportDescriptor {
    pub symbol: String,
    pub capability: String,
    pub arity: u16,
    pub has_return: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportKind {
    Function = 0,
    Global = 1,
}

#[derive(Debug, Clone)]
pub struct ExportDescriptor {
    pub name: String,
    pub kind: ExportKind,
    pub target_idx: u32,
}

#[derive(Debug, Clone)]
pub struct FunctionDescriptor {
    pub name: String,
    pub param_count: u16,
    pub local_count: u16,
    pub max_stack: u16,
    pub has_return: bool,
    pub effects: Vec<String>,
    pub code_offset: u32,
    pub code_length: u32,
    pub decoded: Vec<DecodedInstruction>,
}

#[derive(Debug, Clone, Copy)]
pub struct DebugLineEntry {
    pub fn_idx: u32,
    pub code_offset: u32,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone)]
pub struct MbcModule {
    pub major_version: u16,
    pub minor_version: u16,
    pub flags: u32,
    pub module_name: String,
    pub requires: Vec<String>,
    pub provides: Vec<String>,
    pub denies: Vec<String>,
    pub constants: Vec<ConstantEntry>,
    pub structs: Vec<StructDescriptor>,
    pub enums: Vec<EnumDescriptor>,
    pub imports: Vec<HostImportDescriptor>,
    pub exports: Vec<ExportDescriptor>,
    pub global_count: u32,
    pub entry_fn_idx: Option<u32>,
    pub functions: Vec<FunctionDescriptor>,
    pub code_bytes: Vec<u8>,
    pub debug_map: Vec<DebugLineEntry>,
    pub verified: bool,
}

impl MbcModule {
    pub fn lookup_line(&self, fn_idx: u32, byte_offset: usize) -> Option<u32> {
        let mut best: Option<u32> = None;
        for entry in &self.debug_map {
            if entry.fn_idx == fn_idx && (entry.code_offset as usize) <= byte_offset {
                best = Some(entry.line);
            }
        }
        best
    }

    pub fn get_const_str(&self, idx: u32) -> Result<&str, MvmError> {
        match self.constants.get(idx as usize) {
            Some(ConstantEntry::Str(s)) => Ok(s.as_str()),
            Some(_) => Err(MvmError::MalformedSection(format!(
                "Constant pool index {} is not a UTF-8 string",
                idx
            ))),
            None => Err(MvmError::MalformedSection(format!(
                "Constant pool index {} out of bounds (len {})",
                idx,
                self.constants.len()
            ))),
        }
    }
}

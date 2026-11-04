#[derive(Debug, Clone, PartialEq)]
pub enum Instruction {
    Nop,
    Const(u32),
    PushVoid,
    Pop,
    Dup,

    LoadLocal(u16),
    StoreLocal(u16),
    LoadGlobal(u32),
    StoreGlobal(u32),

    AddI64,
    SubI64,
    MulI64,
    DivI64,
    ModI64,
    NegI64,

    AddF64,
    SubF64,
    MulF64,
    DivF64,
    NegF64,

    ConcatStr,
    I64ToF64,
    F64ToI64,
    ToStr,

    Eq,
    Neq,
    Lt,
    Lte,
    Gt,
    Gte,
    Not,
    BoolAnd,
    BoolOr,

    Jmp(u32),
    JmpIfFalse(u32),
    JmpIfTrue(u32),
    Call(u32),
    Ret,
    RetVoid,
    HostCall(u32),

    ArrayNew(u32),
    ArrayGet,
    ArraySet,
    ArrayLen,
    ArrayPush,

    MapNew(u32),
    MapGet,
    MapSet,
    MapHas,

    StructNew(u32),
    FieldGet(u16),
    FieldSet(u16),

    EnumNew { enum_idx: u32, variant_idx: u16 },
    EnumTag,
    EnumPayload(u16),

    Trap(u32),
    Halt,
}

#[derive(Debug, Clone)]
pub struct DecodedInstruction {
    pub offset: usize,
    pub length: usize,
    pub op: Instruction,
}

pub mod opcodes {
    pub const NOP: u8 = 0x01;
    pub const CONST: u8 = 0x02;
    pub const PUSH_VOID: u8 = 0x03;
    pub const POP: u8 = 0x04;
    pub const DUP: u8 = 0x05;

    pub const LOAD_LOCAL: u8 = 0x10;
    pub const STORE_LOCAL: u8 = 0x11;
    pub const LOAD_GLOBAL: u8 = 0x12;
    pub const STORE_GLOBAL: u8 = 0x13;

    pub const ADD_I64: u8 = 0x20;
    pub const SUB_I64: u8 = 0x21;
    pub const MUL_I64: u8 = 0x22;
    pub const DIV_I64: u8 = 0x23;
    pub const MOD_I64: u8 = 0x24;
    pub const NEG_I64: u8 = 0x25;

    pub const ADD_F64: u8 = 0x26;
    pub const SUB_F64: u8 = 0x27;
    pub const MUL_F64: u8 = 0x28;
    pub const DIV_F64: u8 = 0x29;
    pub const NEG_F64: u8 = 0x2A;

    pub const CONCAT_STR: u8 = 0x2B;
    pub const I64_TO_F64: u8 = 0x2C;
    pub const F64_TO_I64: u8 = 0x2D;
    pub const TO_STR: u8 = 0x2E;

    pub const EQ: u8 = 0x30;
    pub const NEQ: u8 = 0x31;
    pub const LT: u8 = 0x32;
    pub const LTE: u8 = 0x33;
    pub const GT: u8 = 0x34;
    pub const GTE: u8 = 0x35;
    pub const NOT: u8 = 0x36;
    pub const BOOL_AND: u8 = 0x37;
    pub const BOOL_OR: u8 = 0x38;

    pub const JMP: u8 = 0x40;
    pub const JMP_IF_FALSE: u8 = 0x41;
    pub const JMP_IF_TRUE: u8 = 0x42;
    pub const CALL: u8 = 0x43;
    pub const RET: u8 = 0x44;
    pub const RET_VOID: u8 = 0x45;
    pub const HOST_CALL: u8 = 0x46;

    pub const ARRAY_NEW: u8 = 0x50;
    pub const ARRAY_GET: u8 = 0x51;
    pub const ARRAY_SET: u8 = 0x52;
    pub const ARRAY_LEN: u8 = 0x53;
    pub const ARRAY_PUSH: u8 = 0x54;

    pub const MAP_NEW: u8 = 0x55;
    pub const MAP_GET: u8 = 0x56;
    pub const MAP_SET: u8 = 0x57;
    pub const MAP_HAS: u8 = 0x58;

    pub const STRUCT_NEW: u8 = 0x60;
    pub const FIELD_GET: u8 = 0x61;
    pub const FIELD_SET: u8 = 0x62;

    pub const ENUM_NEW: u8 = 0x63;
    pub const ENUM_TAG: u8 = 0x64;
    pub const ENUM_PAYLOAD: u8 = 0x65;

    pub const TRAP: u8 = 0x70;
    pub const HALT: u8 = 0x7F;
}

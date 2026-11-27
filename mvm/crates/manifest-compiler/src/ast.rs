use crate::diagnostic::SourceSpan;
use crate::profile::SyntaxProfile;

pub type ExprId = u64;

#[derive(Debug, Clone)]
pub enum TypeNode {
    PrimitiveType {
        name: String,
        span: SourceSpan,
    },
    NamedType {
        name: String,
        type_args: Vec<TypeNode>,
        span: SourceSpan,
    },
    ArrayType {
        element_type: Box<TypeNode>,
        span: SourceSpan,
    },
    MapType {
        key_type: Box<TypeNode>,
        value_type: Box<TypeNode>,
        span: SourceSpan,
    },
    ResultType {
        ok_type: Box<TypeNode>,
        err_type: Box<TypeNode>,
        span: SourceSpan,
    },
    InferredType {
        span: SourceSpan,
    },
}

#[derive(Debug, Clone)]
pub struct CapabilityItem {
    pub name: String,
    pub span: SourceSpan,
}

#[derive(Debug, Clone, Default)]
pub struct CapabilitySummaryDecl {
    pub requires: Vec<CapabilityItem>,
    pub provides: Vec<CapabilityItem>,
    pub denies: Vec<CapabilityItem>,
}

#[derive(Debug, Clone)]
pub struct ImportSymbol {
    pub name: String,
    pub alias: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ImportDecl {
    pub from: String,
    pub symbols: Vec<ImportSymbol>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct StructFieldDecl {
    pub name: String,
    pub field_type: TypeNode,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct StructDecl {
    pub name: String,
    pub exported: bool,
    pub type_params: Vec<String>,
    pub fields: Vec<StructFieldDecl>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct EnumVariantDecl {
    pub name: String,
    pub payload_types: Vec<TypeNode>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct EnumDecl {
    pub name: String,
    pub exported: bool,
    pub type_params: Vec<String>,
    pub variants: Vec<EnumVariantDecl>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct FnParamDecl {
    pub name: String,
    pub param_type: TypeNode,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct TraitMethodSig {
    pub name: String,
    pub params: Vec<FnParamDecl>,
    pub return_type: TypeNode,
    pub effects: Vec<String>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct TraitDecl {
    pub name: String,
    pub exported: bool,
    pub type_params: Vec<String>,
    pub methods: Vec<TraitMethodSig>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct ConstDecl {
    pub name: String,
    pub exported: bool,
    pub type_annotation: TypeNode,
    pub init: SemanticExpr,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct VarDecl {
    pub name: String,
    pub mutable: bool,
    pub exported: bool,
    pub type_annotation: TypeNode,
    pub init: SemanticExpr,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct FnDecl {
    pub name: String,
    pub exported: bool,
    pub is_async: bool,
    pub type_params: Vec<String>,
    pub params: Vec<FnParamDecl>,
    pub return_type: TypeNode,
    pub effects: Vec<String>,
    pub has_explicit_effects: bool,
    pub body: Vec<SemanticStmt>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub enum LiteralPatValue {
    Int(i128),
    Bool(bool),
    Str(String),
}

#[derive(Debug, Clone)]
pub enum MatchPattern {
    WildcardPattern {
        span: SourceSpan,
    },
    LiteralPattern {
        value: LiteralPatValue,
        span: SourceSpan,
    },
    EnumVariantPattern {
        enum_name: Option<String>,
        variant_name: String,
        bindings: Vec<String>,
        span: SourceSpan,
    },
}

#[derive(Debug, Clone)]
pub struct MatchArm {
    pub pattern: MatchPattern,
    pub body: Vec<SemanticStmt>,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub enum AssignTarget {
    VarTarget {
        name: String,
        span: SourceSpan,
    },
    FieldTarget {
        object: SemanticExpr,
        field: String,
        span: SourceSpan,
    },
    IndexTarget {
        object: SemanticExpr,
        index: SemanticExpr,
        span: SourceSpan,
    },
}

#[derive(Debug, Clone)]
pub enum SemanticStmt {
    VarStmt {
        decl: VarDecl,
        span: SourceSpan,
    },
    ConstStmt {
        decl: ConstDecl,
        span: SourceSpan,
    },
    AssignStmt {
        target: AssignTarget,
        value: SemanticExpr,
        span: SourceSpan,
    },
    ExprStmt {
        expr: SemanticExpr,
        span: SourceSpan,
    },
    IfStmt {
        condition: SemanticExpr,
        then_branch: Vec<SemanticStmt>,
        else_branch: Vec<SemanticStmt>,
        span: SourceSpan,
    },
    WhileStmt {
        condition: SemanticExpr,
        body: Vec<SemanticStmt>,
        span: SourceSpan,
    },
    ForInStmt {
        item_name: String,
        iterable: SemanticExpr,
        body: Vec<SemanticStmt>,
        span: SourceSpan,
    },
    RepeatStmt {
        count: SemanticExpr,
        body: Vec<SemanticStmt>,
        span: SourceSpan,
    },
    BreakStmt {
        span: SourceSpan,
    },
    ContinueStmt {
        span: SourceSpan,
    },
    ReturnStmt {
        value: Option<SemanticExpr>,
        span: SourceSpan,
    },
    MatchStmt {
        subject: SemanticExpr,
        arms: Vec<MatchArm>,
        span: SourceSpan,
    },
    TryStmt {
        try_body: Vec<SemanticStmt>,
        err_binding: Option<String>,
        catch_body: Vec<SemanticStmt>,
        span: SourceSpan,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Neq,
    Lt,
    Lte,
    Gt,
    Gte,
    And,
    Or,
}

impl BinaryOp {
    pub fn as_str(&self) -> &'static str {
        match self {
            BinaryOp::Add => "+",
            BinaryOp::Sub => "-",
            BinaryOp::Mul => "*",
            BinaryOp::Div => "/",
            BinaryOp::Mod => "%",
            BinaryOp::Eq => "==",
            BinaryOp::Neq => "!=",
            BinaryOp::Lt => "<",
            BinaryOp::Lte => "<=",
            BinaryOp::Gt => ">",
            BinaryOp::Gte => ">=",
            BinaryOp::And => "&&",
            BinaryOp::Or => "||",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Neg,
    Not,
}

impl UnaryOp {
    pub fn as_str(&self) -> &'static str {
        match self {
            UnaryOp::Neg => "-",
            UnaryOp::Not => "!",
        }
    }
}

#[derive(Debug, Clone)]
pub struct StructFieldInit {
    pub name: String,
    pub value: SemanticExpr,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct MapEntryInit {
    pub key: SemanticExpr,
    pub value: SemanticExpr,
}

#[derive(Debug, Clone)]
pub enum SemanticExprKind {
    IntLiteral {
        value: Option<i128>,
        raw: String,
    },
    FloatLiteral {
        value: f64,
        raw: String,
    },
    BoolLiteral {
        value: bool,
    },
    StringLiteral {
        value: String,
    },
    Identifier {
        name: String,
    },
    BinaryExpr {
        op: BinaryOp,
        left: Box<SemanticExpr>,
        right: Box<SemanticExpr>,
    },
    UnaryExpr {
        op: UnaryOp,
        operand: Box<SemanticExpr>,
    },
    CallExpr {
        callee: String,
        type_args: Vec<TypeNode>,
        args: Vec<SemanticExpr>,
    },
    FieldAccessExpr {
        object: Box<SemanticExpr>,
        field: String,
    },
    IndexAccessExpr {
        object: Box<SemanticExpr>,
        index: Box<SemanticExpr>,
    },
    ArrayLiteral {
        elements: Vec<SemanticExpr>,
    },
    MapLiteral {
        entries: Vec<MapEntryInit>,
    },
    StructLiteral {
        struct_name: String,
        type_args: Vec<TypeNode>,
        fields: Vec<StructFieldInit>,
    },
    EnumConstructExpr {
        enum_name: String,
        variant_name: String,
        args: Vec<SemanticExpr>,
    },
    AwaitExpr {
        operand: Box<SemanticExpr>,
    },
    TryPropagateExpr {
        operand: Box<SemanticExpr>,
    },
}

#[derive(Debug, Clone)]
pub struct SemanticExpr {
    pub id: ExprId,
    pub kind: SemanticExprKind,
    pub span: SourceSpan,
}

#[derive(Debug, Clone)]
pub struct SemanticModule {
    pub profile: SyntaxProfile,
    pub module_name: String,
    pub header_span: Option<SourceSpan>,
    pub is_solana_contract: bool,
    pub imports: Vec<ImportDecl>,
    pub capabilities: CapabilitySummaryDecl,
    pub structs: Vec<StructDecl>,
    pub enums: Vec<EnumDecl>,
    pub traits: Vec<TraitDecl>,
    pub constants: Vec<ConstDecl>,
    pub globals: Vec<VarDecl>,
    pub functions: Vec<FnDecl>,
    pub top_level_stmts: Vec<SemanticStmt>,
    pub span: SourceSpan,
}

#![forbid(unsafe_code)]

pub mod ast;
pub mod capabilities;
pub mod checker;
pub mod diagnostic;
pub mod engine;
pub mod json;
pub mod lexer;
pub mod lower;
pub mod mbc_emit;
pub mod mir;
pub mod optimizer;
pub mod parser_beg;
pub mod parser_pro;
pub mod profile;
pub mod resolver;
pub mod stdlib;
pub mod types;

pub use capabilities::{analyze_capabilities_and_effects, CapabilityAuditReport};
pub use checker::{check_types, TypeCheckResult};
pub use diagnostic::{Diagnostic, Severity, SourceSpan};
pub use engine::{
    check_source, check_source_json, compile_source, compile_source_json, inspect_ir_json,
    AstSummary, CheckOutcome, CompileOutcome, CompileRequest, ENGINE_ABI_VERSION, ENGINE_NAME,
    ENGINE_VERSION,
};
pub use lower::build_typed_ir;
pub use mbc_emit::{compile_mir_to_mbc, CompiledMbcResult};
pub use mir::{format_mir_module, MIRModule};
pub use optimizer::{optimize_mir, OptimizationPassStats, OptimizationResult};
pub use profile::{detect_syntax_profile, is_solana_program_source, SyntaxProfile};
pub use resolver::{parse_module_for_profile, resolve_module_graph, ResolvedGraph, WorkspaceFiles};

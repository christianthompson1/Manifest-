use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum MvmError {
    InvalidMagic,
    UnsupportedVersion {
        major: u16,
        minor: u16,
    },
    TruncatedContainer(String),
    MalformedSection(String),
    VerificationFailed {
        function: String,
        offset: usize,
        message: String,
    },
    UnverifiedModule,
    CapabilityDenied {
        capability: String,
        operation: String,
        reason: String,
    },
    IntegerOverflow {
        op: &'static str,
        line: Option<u32>,
    },
    DivisionByZero {
        line: Option<u32>,
    },
    StackUnderflow {
        function: String,
        offset: usize,
    },
    StackOverflow {
        function: String,
        limit: usize,
    },
    CallDepthExceeded {
        limit: usize,
    },
    ExecutionStepLimitExceeded {
        limit: u64,
    },
    MemoryLimitExceeded {
        limit: usize,
    },
    HeapBytesLimitExceeded {
        requested: usize,
        used: usize,
        limit: usize,
    },
    NumericConversionTrap {
        from: &'static str,
        to: &'static str,
        value: String,
        line: Option<u32>,
    },
    IndexOutOfBounds {
        index: i64,
        len: usize,
        line: Option<u32>,
    },
    KeyNotFound {
        key: String,
        line: Option<u32>,
    },
    TypeMismatch {
        expected: &'static str,
        actual: &'static str,
        line: Option<u32>,
    },
    InvalidFunctionIndex(u32),
    MissingEntryFunction(String),
    HostError {
        operation: String,
        message: String,
    },
    RuntimeTrap {
        message: String,
        line: Option<u32>,
    },
}

impl MvmError {
    pub fn code(&self) -> &'static str {
        match self {
            MvmError::InvalidMagic => "E_MVM_INVALID_MAGIC",
            MvmError::UnsupportedVersion { .. } => "E_MVM_UNSUPPORTED_VERSION",
            MvmError::TruncatedContainer(_) => "E_MVM_TRUNCATED",
            MvmError::MalformedSection(_) => "E_MVM_MALFORMED",
            MvmError::VerificationFailed { .. } => "E_MVM_VERIFY_FAILED",
            MvmError::UnverifiedModule => "E_MVM_UNVERIFIED",
            MvmError::CapabilityDenied { .. } => "E_MVM_CAPABILITY_DENIED",
            MvmError::IntegerOverflow { .. } => "E_MVM_OVERFLOW",
            MvmError::DivisionByZero { .. } => "E_MVM_DIV_ZERO",
            MvmError::StackUnderflow { .. } => "E_MVM_STACK_UNDERFLOW",
            MvmError::StackOverflow { .. } => "E_MVM_STACK_OVERFLOW",
            MvmError::CallDepthExceeded { .. } => "E_MVM_CALL_DEPTH_EXCEEDED",
            MvmError::ExecutionStepLimitExceeded { .. } => "E_MVM_FUEL_EXHAUSTED",
            MvmError::MemoryLimitExceeded { .. } => "E_MVM_MEMORY_LIMIT",
            MvmError::HeapBytesLimitExceeded { .. } => "E_MVM_HEAP_BYTES_LIMIT",
            MvmError::NumericConversionTrap { .. } => "E_MVM_NUMERIC_CONVERSION",
            MvmError::IndexOutOfBounds { .. } => "E_MVM_OUT_OF_BOUNDS",
            MvmError::KeyNotFound { .. } => "E_MVM_KEY_NOT_FOUND",
            MvmError::TypeMismatch { .. } => "E_MVM_TYPE_ERROR",
            MvmError::InvalidFunctionIndex(_) => "E_MVM_INVALID_CALL",
            MvmError::MissingEntryFunction(_) => "E_MVM_MISSING_ENTRY",
            MvmError::HostError { .. } => "E_MVM_HOST_ERROR",
            MvmError::RuntimeTrap { .. } => "E_MVM_RUNTIME_TRAP",
        }
    }
}

impl fmt::Display for MvmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MvmError::InvalidMagic => write!(f, "Invalid .mbc magic header (expected MBC\\0)"),
            MvmError::UnsupportedVersion { major, minor } => {
                write!(
                    f,
                    "Unsupported .mbc version {}.{} (expected 1.0)",
                    major, minor
                )
            }
            MvmError::TruncatedContainer(ctx) => write!(f, "Truncated .mbc container: {}", ctx),
            MvmError::MalformedSection(msg) => write!(f, "Malformed .mbc section: {}", msg),
            MvmError::VerificationFailed {
                function,
                offset,
                message,
            } => write!(
                f,
                "Bytecode verification failed in '{}' at byte offset {}: {}",
                function, offset, message
            ),
            MvmError::UnverifiedModule => {
                write!(f, "Refusing to execute unverified .mbc module")
            }
            MvmError::CapabilityDenied {
                capability,
                operation,
                reason,
            } => write!(
                f,
                "Capability '{}' denied for operation '{}': {}",
                capability, operation, reason
            ),
            MvmError::IntegerOverflow { op, line } => match line {
                Some(ln) => write!(f, "Integer overflow during '{}' at line {}", op, ln),
                None => write!(f, "Integer overflow during '{}'", op),
            },
            MvmError::DivisionByZero { line } => match line {
                Some(ln) => write!(f, "Division by zero at line {}", ln),
                None => write!(f, "Division by zero"),
            },
            MvmError::StackUnderflow { function, offset } => write!(
                f,
                "Operand stack underflow in '{}' at offset {}",
                function, offset
            ),
            MvmError::StackOverflow { function, limit } => write!(
                f,
                "Operand stack overflow in '{}' (limit {})",
                function, limit
            ),
            MvmError::CallDepthExceeded { limit } => {
                write!(f, "Maximum call recursion depth ({}) exceeded", limit)
            }
            MvmError::ExecutionStepLimitExceeded { limit } => {
                write!(f, "Execution step fuel limit ({}) exceeded", limit)
            }
            MvmError::MemoryLimitExceeded { limit } => {
                write!(f, "VM heap allocation limit ({} objects) exceeded", limit)
            }
            MvmError::HeapBytesLimitExceeded {
                requested,
                used,
                limit,
            } => write!(
                f,
                "VM heap byte limit exceeded (requested {} bytes, used {} / {} bytes)",
                requested, used, limit
            ),
            MvmError::NumericConversionTrap {
                from,
                to,
                value,
                line,
            } => match line {
                Some(ln) => write!(
                    f,
                    "Numeric conversion trap converting {} '{}' to {} at line {}",
                    from, value, to, ln
                ),
                None => write!(
                    f,
                    "Numeric conversion trap converting {} '{}' to {}",
                    from, value, to
                ),
            },
            MvmError::IndexOutOfBounds { index, len, line } => match line {
                Some(ln) => write!(
                    f,
                    "Array index {} out of bounds for length {} at line {}",
                    index, len, ln
                ),
                None => write!(f, "Array index {} out of bounds for length {}", index, len),
            },
            MvmError::KeyNotFound { key, line } => match line {
                Some(ln) => write!(f, "Map key '{}' not found at line {}", key, ln),
                None => write!(f, "Map key '{}' not found", key),
            },
            MvmError::TypeMismatch {
                expected,
                actual,
                line,
            } => match line {
                Some(ln) => write!(
                    f,
                    "Type mismatch at line {}: expected {}, got {}",
                    ln, expected, actual
                ),
                None => write!(f, "Type mismatch: expected {}, got {}", expected, actual),
            },
            MvmError::InvalidFunctionIndex(idx) => {
                write!(f, "Invalid function index {}", idx)
            }
            MvmError::MissingEntryFunction(name) => {
                write!(f, "Entry function '{}' not found in .mbc module", name)
            }
            MvmError::HostError { operation, message } => {
                write!(f, "Host operation '{}' failed: {}", operation, message)
            }
            MvmError::RuntimeTrap { message, line } => match line {
                Some(ln) => write!(f, "Runtime trap at line {}: {}", ln, message),
                None => write!(f, "Runtime trap: {}", message),
            },
        }
    }
}

impl std::error::Error for MvmError {}

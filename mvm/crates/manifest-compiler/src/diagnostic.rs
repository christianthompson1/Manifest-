use crate::json::JsonValue;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceSpan {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub file: Option<String>,
}

impl Default for SourceSpan {
    fn default() -> Self {
        Self {
            line: 1,
            column: 1,
            end_line: 1,
            end_column: 1,
            file: None,
        }
    }
}

impl SourceSpan {
    pub fn to_json(&self) -> JsonValue {
        let mut entries = vec![
            ("line".to_string(), JsonValue::Number(self.line as f64)),
            ("column".to_string(), JsonValue::Number(self.column as f64)),
            ("endLine".to_string(), JsonValue::Number(self.end_line as f64)),
            (
                "endColumn".to_string(),
                JsonValue::Number(self.end_column as f64),
            ),
        ];
        if let Some(f) = &self.file {
            entries.push(("file".to_string(), JsonValue::String(f.clone())));
        }
        JsonValue::Object(entries)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

impl Severity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Info => "info",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub severity: Severity,
    pub message: String,
    pub line: u32,
    pub column: u32,
    pub file: Option<String>,
    pub hint: Option<String>,
}

impl Diagnostic {
    pub fn error(code: impl Into<String>, message: impl Into<String>, span: &SourceSpan) -> Self {
        Self {
            code: code.into(),
            severity: Severity::Error,
            message: message.into(),
            line: span.line,
            column: span.column,
            file: span.file.clone(),
            hint: None,
        }
    }

    pub fn error_with_hint(
        code: impl Into<String>,
        message: impl Into<String>,
        span: &SourceSpan,
        hint: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            severity: Severity::Error,
            message: message.into(),
            line: span.line,
            column: span.column,
            file: span.file.clone(),
            hint: Some(hint.into()),
        }
    }

    pub fn warning(code: impl Into<String>, message: impl Into<String>, span: &SourceSpan) -> Self {
        Self {
            code: code.into(),
            severity: Severity::Warning,
            message: message.into(),
            line: span.line,
            column: span.column,
            file: span.file.clone(),
            hint: None,
        }
    }

    pub fn to_json(&self) -> JsonValue {
        let mut entries = vec![
            ("code".to_string(), JsonValue::String(self.code.clone())),
            (
                "severity".to_string(),
                JsonValue::String(self.severity.as_str().to_string()),
            ),
            ("message".to_string(), JsonValue::String(self.message.clone())),
            ("line".to_string(), JsonValue::Number(self.line as f64)),
            ("column".to_string(), JsonValue::Number(self.column as f64)),
        ];
        if let Some(f) = &self.file {
            entries.push(("file".to_string(), JsonValue::String(f.clone())));
        }
        if let Some(h) = &self.hint {
            entries.push(("hint".to_string(), JsonValue::String(h.clone())));
        }
        JsonValue::Object(entries)
    }
}

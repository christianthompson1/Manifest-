use crate::diagnostic::{Diagnostic, SourceSpan};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Ident,
    Int,
    Float,
    String,
    Punct,
    Op,
    Newline,
    Eof,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokenKind,
    pub value: String,
    pub upper: String,
    pub line: u32,
    pub col: u32,
}

fn is_two_char_op(a: char, b: char) -> bool {
    matches!(
        (a, b),
        ('=', '=')
            | ('!', '=')
            | ('<', '=')
            | ('>', '=')
            | ('&', '&')
            | ('|', '|')
            | ('-', '>')
            | ('=', '>')
            | (':', ':')
    )
}

fn is_single_op(ch: char) -> bool {
    matches!(
        ch,
        '+' | '-' | '*' | '/' | '%' | '<' | '>' | '!' | '=' | '?'
    )
}

fn is_punct(ch: char) -> bool {
    matches!(
        ch,
        '{' | '}' | '(' | ')' | '[' | ']' | ';' | ',' | ':' | '.'
    )
}

fn decode_hex(chars: &[char]) -> Option<u32> {
    let mut val: u32 = 0;
    for &c in chars {
        val = val * 16 + c.to_digit(16)?;
    }
    Some(val)
}

fn decode_escape(chars: &[char], idx: &mut usize, line: &mut u32, col: &mut u32) -> char {
    let advance = |n: usize, i: &mut usize, chars: &[char], line: &mut u32, col: &mut u32| {
        for _ in 0..n {
            if *i < chars.len() {
                if chars[*i] == '\n' {
                    *line += 1;
                    *col = 1;
                } else {
                    *col += 1;
                }
                *i += 1;
            }
        }
    };

    let Some(&esc) = chars.get(*idx) else {
        return '\\';
    };
    match esc {
        'n' => {
            advance(1, idx, chars, line, col);
            '\n'
        }
        't' => {
            advance(1, idx, chars, line, col);
            '\t'
        }
        'r' => {
            advance(1, idx, chars, line, col);
            '\r'
        }
        '0' => {
            advance(1, idx, chars, line, col);
            '\0'
        }
        '\\' => {
            advance(1, idx, chars, line, col);
            '\\'
        }
        '"' => {
            advance(1, idx, chars, line, col);
            '"'
        }
        '\'' => {
            advance(1, idx, chars, line, col);
            '\''
        }
        'x' => {
            if let Some(slice) = chars.get(*idx + 1..*idx + 3) {
                if let Some(code) = decode_hex(slice) {
                    advance(3, idx, chars, line, col);
                    return char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER);
                }
            }
            advance(1, idx, chars, line, col);
            'x'
        }
        'u' => {
            if let Some(slice) = chars.get(*idx + 1..*idx + 5) {
                if let Some(code) = decode_hex(slice) {
                    advance(5, idx, chars, line, col);
                    return char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER);
                }
            }
            advance(1, idx, chars, line, col);
            'u'
        }
        other => {
            advance(1, idx, chars, line, col);
            other
        }
    }
}

pub fn tokenize(
    source: &str,
    beginner_mode: bool,
    file: Option<&str>,
) -> Result<Vec<Token>, Diagnostic> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut i: usize = 0;
    let mut line: u32 = 1;
    let mut col: u32 = 1;

    let advance = |n: usize, i: &mut usize, line: &mut u32, col: &mut u32| {
        for _ in 0..n {
            if *i < chars.len() {
                if chars[*i] == '\n' {
                    *line += 1;
                    *col = 1;
                } else {
                    *col += 1;
                }
                *i += 1;
            }
        }
    };

    while i < chars.len() {
        let ch = chars[i];

        if ch == ' ' || ch == '\t' || ch == '\r' {
            advance(1, &mut i, &mut line, &mut col);
            continue;
        }

        if ch == '\n' {
            if beginner_mode {
                tokens.push(Token {
                    kind: TokenKind::Newline,
                    value: "\n".to_string(),
                    upper: "\n".to_string(),
                    line,
                    col,
                });
            }
            advance(1, &mut i, &mut line, &mut col);
            continue;
        }

        // Line comments: // , /// , -- , and in beginner mode: # and NOTE:
        if (ch == '/' && chars.get(i + 1) == Some(&'/'))
            || (ch == '-' && chars.get(i + 1) == Some(&'-'))
            || (beginner_mode && ch == '#')
        {
            while i < chars.len() && chars[i] != '\n' {
                advance(1, &mut i, &mut line, &mut col);
            }
            continue;
        }

        if beginner_mode && i + 5 <= chars.len() {
            let candidate: String = chars[i..i + 5].iter().collect();
            if candidate.eq_ignore_ascii_case("NOTE:") {
                while i < chars.len() && chars[i] != '\n' {
                    advance(1, &mut i, &mut line, &mut col);
                }
                continue;
            }
        }

        // Block comments /* ... */
        if ch == '/' && chars.get(i + 1) == Some(&'*') {
            let start_line = line;
            let start_col = col;
            advance(2, &mut i, &mut line, &mut col);
            while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                advance(1, &mut i, &mut line, &mut col);
            }
            if i >= chars.len() {
                return Err(Diagnostic::error(
                    "E_SYNTAX",
                    "Unterminated block comment",
                    &SourceSpan {
                        line: start_line,
                        column: start_col,
                        end_line: start_line,
                        end_column: start_col + 2,
                        file: file.map(str::to_string),
                    },
                ));
            }
            advance(2, &mut i, &mut line, &mut col);
            continue;
        }

        // Strings
        if ch == '"' || ch == '\'' {
            let quote = ch;
            let start_line = line;
            let start_col = col;
            advance(1, &mut i, &mut line, &mut col);
            let mut s = String::new();
            while i < chars.len() && chars[i] != quote {
                if chars[i] == '\\' {
                    advance(1, &mut i, &mut line, &mut col);
                    if i >= chars.len() {
                        break;
                    }
                    let decoded = decode_escape(&chars, &mut i, &mut line, &mut col);
                    s.push(decoded);
                } else {
                    s.push(chars[i]);
                    advance(1, &mut i, &mut line, &mut col);
                }
            }
            if i >= chars.len() {
                return Err(Diagnostic::error(
                    "E_SYNTAX",
                    "Unterminated string literal",
                    &SourceSpan {
                        line: start_line,
                        column: start_col,
                        end_line: start_line,
                        end_column: start_col + 1,
                        file: file.map(str::to_string),
                    },
                ));
            }
            advance(1, &mut i, &mut line, &mut col);
            tokens.push(Token {
                kind: TokenKind::String,
                upper: if beginner_mode {
                    s.clone()
                } else {
                    String::new()
                },
                value: s,
                line: start_line,
                col: start_col,
            });
            continue;
        }

        // Numbers
        if ch.is_ascii_digit() {
            let start_line = line;
            let start_col = col;
            let mut num = String::new();
            let mut is_float = false;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '_') {
                if chars[i] != '_' {
                    num.push(chars[i]);
                }
                advance(1, &mut i, &mut line, &mut col);
            }
            if chars.get(i) == Some(&'.')
                && chars.get(i + 1).is_some_and(|c| c.is_ascii_digit())
            {
                is_float = true;
                num.push('.');
                advance(1, &mut i, &mut line, &mut col);
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '_') {
                    if chars[i] != '_' {
                        num.push(chars[i]);
                    }
                    advance(1, &mut i, &mut line, &mut col);
                }
            }
            tokens.push(Token {
                kind: if is_float {
                    TokenKind::Float
                } else {
                    TokenKind::Int
                },
                upper: num.clone(),
                value: num,
                line: start_line,
                col: start_col,
            });
            continue;
        }

        // Two-character operators
        if let Some(&next_ch) = chars.get(i + 1) {
            if is_two_char_op(ch, next_ch) {
                let mut v = String::with_capacity(2);
                v.push(ch);
                v.push(next_ch);
                tokens.push(Token {
                    kind: TokenKind::Op,
                    upper: v.clone(),
                    value: v,
                    line,
                    col,
                });
                advance(2, &mut i, &mut line, &mut col);
                continue;
            }
        }

        // Single-character operators
        if is_single_op(ch) {
            let v = ch.to_string();
            tokens.push(Token {
                kind: TokenKind::Op,
                upper: v.clone(),
                value: v,
                line,
                col,
            });
            advance(1, &mut i, &mut line, &mut col);
            continue;
        }

        // Punctuation
        if is_punct(ch) {
            let v = ch.to_string();
            tokens.push(Token {
                kind: TokenKind::Punct,
                upper: v.clone(),
                value: v,
                line,
                col,
            });
            advance(1, &mut i, &mut line, &mut col);
            continue;
        }

        // Identifiers & keywords
        if ch.is_ascii_alphabetic() || ch == '_' {
            let start_line = line;
            let start_col = col;
            let mut id = String::new();
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                id.push(chars[i]);
                advance(1, &mut i, &mut line, &mut col);
            }
            let upper = if beginner_mode {
                id.to_ascii_uppercase()
            } else {
                String::new()
            };
            tokens.push(Token {
                kind: TokenKind::Ident,
                value: id,
                upper,
                line: start_line,
                col: start_col,
            });
            continue;
        }

        return Err(Diagnostic::error(
            "E_SYNTAX",
            format!("Unexpected character '{ch}'"),
            &SourceSpan {
                line,
                column: col,
                end_line: line,
                end_column: col + 1,
                file: file.map(str::to_string),
            },
        ));
    }

    tokens.push(Token {
        kind: TokenKind::Eof,
        value: String::new(),
        upper: String::new(),
        line,
        col,
    });

    Ok(tokens)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyntaxProfile {
    Beginner,
    Professional,
}

impl SyntaxProfile {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyntaxProfile::Beginner => "beginner",
            SyntaxProfile::Professional => "professional",
        }
    }

    pub fn from_opt_str(s: Option<&str>) -> Option<Self> {
        match s {
            Some("beginner") => Some(SyntaxProfile::Beginner),
            Some("professional") => Some(SyntaxProfile::Professional),
            _ => None,
        }
    }
}

pub fn normalize_primitive_type_name(raw: &str) -> &str {
    match raw {
        "i64" | "Int" | "Integer" | "INT" => "i64",
        "f64" | "Float" | "Number" | "NUMBER" => "f64",
        "bool" | "Bool" | "Boolean" | "BOOLEAN" => "bool",
        "str" | "Text" | "String" | "TEXT" | "STRING" => "str",
        "void" | "Void" | "Unit" | "VOID" => "void",
        "List" | "LIST" | "Array" => "Array",
        "Map" | "MAP" | "Dict" => "Map",
        other => other,
    }
}

fn strip_comments_and_strings(source: &str, strip_block_comments: bool) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if strip_block_comments && ch == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i < chars.len() {
                if chars[i] == '*' && i + 1 < chars.len() && chars[i + 1] == '/' {
                    i += 2;
                    break;
                }
                if chars[i] == '\n' {
                    out.push('\n');
                }
                i += 1;
            }
            continue;
        }
        if (ch == '/' && i + 1 < chars.len() && chars[i + 1] == '/')
            || (ch == '-' && i + 1 < chars.len() && chars[i + 1] == '-')
        {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            let quote = ch;
            out.push(quote);
            i += 1;
            while i < chars.len() && chars[i] != quote {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    i += 2;
                } else {
                    i += 1;
                }
            }
            if i < chars.len() {
                i += 1;
            }
            out.push(quote);
            continue;
        }
        out.push(ch);
        i += 1;
    }
    out
}

fn read_word(chars: &[char], idx: usize) -> Option<(String, usize)> {
    let ch = *chars.get(idx)?;
    if !(ch.is_ascii_alphabetic() || ch == '_') {
        return None;
    }
    let mut end = idx + 1;
    while end < chars.len() && (chars[end].is_ascii_alphanumeric() || chars[end] == '_') {
        end += 1;
    }
    let word: String = chars[idx..end].iter().collect();
    Some((word, end))
}

fn skip_spaces_tabs(chars: &[char], mut idx: usize) -> usize {
    while idx < chars.len() && (chars[idx] == ' ' || chars[idx] == '\t') {
        idx += 1;
    }
    idx
}

fn read_dotted_ident(chars: &[char], idx: usize) -> Option<(String, usize)> {
    let ch = *chars.get(idx)?;
    if !(ch.is_ascii_alphanumeric() || ch == '_') {
        return None;
    }
    let mut end = idx + 1;
    while end < chars.len()
        && (chars[end].is_ascii_alphanumeric() || chars[end] == '_' || chars[end] == '.')
    {
        end += 1;
    }
    let s: String = chars[idx..end].iter().collect();
    Some((s, end))
}

pub fn detect_syntax_profile(source: &str, explicit: Option<&str>) -> SyntaxProfile {
    if let Some(p) = SyntaxProfile::from_opt_str(explicit) {
        return p;
    }

    for line in source.lines().take(10) {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("//")
            || trimmed.starts_with("--")
            || trimmed.starts_with('#')
        {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        let no_semi = lower.trim_end_matches(';').trim();
        if let Some(rest) = no_semi.strip_prefix("profile") {
            let arg = rest.trim();
            if arg == "beginner" {
                return SyntaxProfile::Beginner;
            }
            if arg == "professional" {
                return SyntaxProfile::Professional;
            }
        }
        break;
    }

    let stripped = strip_comments_and_strings(source, false);

    // Check line-by-line for unambiguous PROGRAM (Solana extension, beginner-oriented block)
    for line in stripped.lines() {
        let trimmed = line.trim_start();
        let chars: Vec<char> = trimmed.chars().collect();
        if let Some((w1, _)) = read_word(&chars, 0) {
            if w1 == "PROGRAM" {
                return SyntaxProfile::Beginner;
            }
        }
    }

    for line in stripped.lines() {
        let trimmed = line.trim_start();
        let chars: Vec<char> = trimmed.chars().collect();
        let Some((w1, mut pos)) = read_word(&chars, 0) else {
            continue;
        };
        let mut word = w1;
        if word == "pub" {
            pos = skip_spaces_tabs(&chars, pos);
            if let Some((next_w, np)) = read_word(&chars, pos) {
                if next_w == "mod" {
                    let p_name = skip_spaces_tabs(&chars, np);
                    if let Some((_, p_after)) = read_dotted_ident(&chars, p_name) {
                        let p_semi = skip_spaces_tabs(&chars, p_after);
                        if chars.get(p_semi) == Some(&';') {
                            return SyntaxProfile::Professional;
                        }
                    }
                }
                word = next_w;
                pos = np;
            }
        }
        if word == "export" {
            pos = skip_spaces_tabs(&chars, pos);
            if let Some((next_w, np)) = read_word(&chars, pos) {
                word = next_w;
                pos = np;
            }
        }
        if word == "async" {
            pos = skip_spaces_tabs(&chars, pos);
            if let Some((next_w, np)) = read_word(&chars, pos) {
                word = next_w;
                pos = np;
            }
        }
        if word == "fn" {
            let p_name = skip_spaces_tabs(&chars, pos);
            if let Some((fn_name, _)) = read_word(&chars, p_name) {
                if fn_name
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                {
                    return SyntaxProfile::Professional;
                }
            }
        }

        // Re-check original trimmed start for mod/let/const/module/requires/provides/denies/struct/enum
        let Some((orig_w, mut opos)) = read_word(&chars, 0) else {
            continue;
        };
        if orig_w == "mod" || orig_w == "module" {
            let p_name = skip_spaces_tabs(&chars, opos);
            if let Some((_, p_after)) = read_dotted_ident(&chars, p_name) {
                let p_semi = skip_spaces_tabs(&chars, p_after);
                if chars.get(p_semi) == Some(&';') {
                    return SyntaxProfile::Professional;
                }
            }
        }
        if orig_w == "let" {
            opos = skip_spaces_tabs(&chars, opos);
            if let Some((w2, np)) = read_word(&chars, opos) {
                if w2 == "mut" {
                    let p3 = skip_spaces_tabs(&chars, np);
                    if read_word(&chars, p3).is_some() {
                        return SyntaxProfile::Professional;
                    }
                } else {
                    return SyntaxProfile::Professional;
                }
            }
        }
        if orig_w == "const" {
            opos = skip_spaces_tabs(&chars, opos);
            if read_word(&chars, opos).is_some() {
                return SyntaxProfile::Professional;
            }
        }
        if matches!(orig_w.as_str(), "requires" | "provides" | "denies") {
            let p_b = skip_spaces_tabs(&chars, opos);
            if chars.get(p_b) == Some(&'[') {
                return SyntaxProfile::Professional;
            }
        }
        // `(pub )?(export )?(struct|enum) Ident (<...>)? {`
        let mut s_word = orig_w;
        let mut s_pos = opos;
        if s_word == "pub" {
            s_pos = skip_spaces_tabs(&chars, s_pos);
            if let Some((nw, np)) = read_word(&chars, s_pos) {
                s_word = nw;
                s_pos = np;
            }
        }
        if s_word == "export" {
            s_pos = skip_spaces_tabs(&chars, s_pos);
            if let Some((nw, np)) = read_word(&chars, s_pos) {
                s_word = nw;
                s_pos = np;
            }
        }
        if s_word == "struct" || s_word == "enum" {
            s_pos = skip_spaces_tabs(&chars, s_pos);
            if let Some((_, after_name)) = read_word(&chars, s_pos) {
                let mut cur = skip_spaces_tabs(&chars, after_name);
                if chars.get(cur) == Some(&'<') {
                    while cur < chars.len() && chars[cur] != '>' {
                        cur += 1;
                    }
                    if chars.get(cur) == Some(&'>') {
                        cur += 1;
                    }
                    cur = skip_spaces_tabs(&chars, cur);
                }
                if chars.get(cur) == Some(&'{') {
                    return SyntaxProfile::Professional;
                }
            }
        }
    }

    SyntaxProfile::Beginner
}

pub fn is_solana_program_source(source: &str) -> bool {
    let stripped = strip_comments_and_strings(source, true);
    let mut has_program = false;

    for line in stripped.lines() {
        let trimmed = line.trim_start();
        let chars: Vec<char> = trimmed.chars().collect();
        if let Some((w1, p1)) = read_word(&chars, 0) {
            if w1 == "module" {
                let pn = skip_spaces_tabs(&chars, p1);
                if let Some((_, pa)) = read_dotted_ident(&chars, pn) {
                    if chars.get(skip_spaces_tabs(&chars, pa)) == Some(&';') {
                        return false;
                    }
                }
            }
            if w1 == "MODULE" {
                let pn = skip_spaces_tabs(&chars, p1);
                if read_dotted_ident(&chars, pn).is_some() {
                    return false;
                }
            }
            let up = w1.to_ascii_uppercase();
            if matches!(
                up.as_str(),
                "APP" | "PAGE" | "COMPONENT" | "SERVER" | "ENDPOINT" | "ROUTE" | "STYLE" | "STATE" | "ACTION"
            ) {
                return false;
            }
            if up == "PROGRAM" {
                let pn = skip_spaces_tabs(&chars, p1);
                if read_word(&chars, pn).is_some() {
                    has_program = true;
                }
            }
        }
    }

    has_program
}

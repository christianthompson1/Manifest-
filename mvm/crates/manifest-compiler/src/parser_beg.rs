use crate::ast::*;
use crate::diagnostic::{Diagnostic, SourceSpan};
use crate::lexer::{tokenize, Token, TokenKind};
use crate::profile::{normalize_primitive_type_name, SyntaxProfile};

pub fn parse_beginner_module(
    source: &str,
    file: Option<&str>,
    next_expr_id: &mut u64,
) -> Result<SemanticModule, Diagnostic> {
    let tokens = tokenize(source, true, file)?;
    let mut parser = BeginnerParser {
        tokens,
        pos: 0,
        file: file.map(str::to_string),
        has_solana_contract: false,
        next_expr_id,
    };
    parser.parse_module()
}

struct BeginnerParser<'a> {
    tokens: Vec<Token>,
    pos: usize,
    file: Option<String>,
    has_solana_contract: bool,
    next_expr_id: &'a mut u64,
}

impl<'a> BeginnerParser<'a> {
    fn alloc_id(&mut self) -> ExprId {
        let id = *self.next_expr_id;
        *self.next_expr_id = self.next_expr_id.wrapping_add(1);
        id
    }

    fn peek(&self) -> &Token {
        self.tokens
            .get(self.pos)
            .unwrap_or_else(|| &self.tokens[self.tokens.len() - 1])
    }

    fn peek_at(&self, offset: usize) -> &Token {
        let idx = (self.pos + offset).min(self.tokens.len().saturating_sub(1));
        &self.tokens[idx]
    }

    fn prev(&self) -> &Token {
        let mut k = self.pos as isize - 1;
        while k >= 0 {
            let uk = k as usize;
            if self.tokens[uk].kind != TokenKind::Newline {
                return &self.tokens[uk];
            }
            k -= 1;
        }
        &self.tokens[self.pos.saturating_sub(1)]
    }

    fn next(&mut self) -> Token {
        let t = self.peek().clone();
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        t
    }

    fn is_eof(&self) -> bool {
        self.peek().kind == TokenKind::Eof
    }

    fn is_newline(&self) -> bool {
        self.peek().kind == TokenKind::Newline
    }

    fn skip_newlines(&mut self) {
        while self.is_newline() {
            self.next();
        }
    }

    fn make_span(&self, start: &Token, end: &Token) -> SourceSpan {
        let len = if end.value.is_empty() {
            1
        } else {
            end.value.chars().count() as u32
        };
        SourceSpan {
            line: start.line,
            column: start.col,
            end_line: end.line,
            end_column: end.col + len,
            file: self.file.clone(),
        }
    }

    fn merge_span(&self, a: &SourceSpan, b: &SourceSpan) -> SourceSpan {
        SourceSpan {
            line: a.line,
            column: a.column,
            end_line: b.end_line,
            end_column: b.end_column,
            file: a.file.clone().or_else(|| b.file.clone()),
        }
    }

    fn syntax_err(&self, tok: &Token, msg: impl Into<String>) -> Diagnostic {
        Diagnostic::error(
            "E_SYNTAX",
            msg,
            &SourceSpan {
                line: tok.line,
                column: tok.col,
                end_line: tok.line,
                end_column: tok.col + 1,
                file: self.file.clone(),
            },
        )
    }

    fn legacy_v0_err(&self, tok: &Token, construct: &str) -> Diagnostic {
        Diagnostic::error_with_hint(
            "E_LEGACY_V0_REMOVED",
            format!("Legacy Manifest v0.x construct '{construct}' was removed in Stage 7."),
            &SourceSpan {
                line: tok.line,
                column: tok.col,
                end_line: tok.line,
                end_column: tok.col + tok.value.chars().count().max(1) as u32,
                file: self.file.clone(),
            },
            "Use canonical Manifest v1.0 ('module name; fn main()' or 'MODULE Name / FUNCTION main() ... END'), standalone Solana 'PROGRAM Name ... END', or convert v0.x code via `manifest migrate <file>`.",
        )
    }

    fn check_kw(&self, upper: &str) -> bool {
        let t = self.peek();
        t.kind == TokenKind::Ident && t.upper == upper
    }

    fn eat_kw(&mut self, upper: &str) -> bool {
        if self.check_kw(upper) {
            self.next();
            true
        } else {
            false
        }
    }

    fn expect_kw(&mut self, upper: &str) -> Result<Token, Diagnostic> {
        let t = self.peek().clone();
        if t.kind != TokenKind::Ident || t.upper != upper {
            let got = if t.value.is_empty() {
                "eof".to_string()
            } else {
                t.value.clone()
            };
            return Err(self.syntax_err(&t, format!("Expected '{upper}', found '{got}'")));
        }
        Ok(self.next())
    }

    fn check_ident(&self, val: &str) -> bool {
        let t = self.peek();
        t.kind == TokenKind::Ident && t.value == val
    }

    fn expect_ident(&mut self) -> Result<Token, Diagnostic> {
        let t = self.peek().clone();
        if t.kind != TokenKind::Ident {
            let got = if t.value.is_empty() {
                "eof".to_string()
            } else {
                t.value.clone()
            };
            return Err(self.syntax_err(&t, format!("Expected identifier, found '{got}'")));
        }
        Ok(self.next())
    }

    fn expect_string(&mut self, desc: &str) -> Result<Token, Diagnostic> {
        let t = self.peek().clone();
        if t.kind != TokenKind::String {
            let got = if t.value.is_empty() {
                "eof".to_string()
            } else {
                t.value.clone()
            };
            return Err(self.syntax_err(&t, format!("Expected {desc}, found '{got}'")));
        }
        Ok(self.next())
    }

    fn check_punct(&self, val: &str) -> bool {
        let t = self.peek();
        t.kind == TokenKind::Punct && t.value == val
    }

    fn eat_punct(&mut self, val: &str) -> Option<Token> {
        if self.check_punct(val) {
            Some(self.next())
        } else {
            None
        }
    }

    fn expect_punct(&mut self, val: &str) -> Result<Token, Diagnostic> {
        let t = self.peek().clone();
        if !self.check_punct(val) {
            let got = if t.value.is_empty() {
                "eof".to_string()
            } else {
                t.value.clone()
            };
            return Err(self.syntax_err(&t, format!("Expected '{val}', found '{got}'")));
        }
        Ok(self.next())
    }

    fn check_op(&self, val: &str) -> bool {
        let t = self.peek();
        t.kind == TokenKind::Op && t.value == val
    }

    fn eat_op(&mut self, val: &str) -> Option<Token> {
        if self.check_op(val) {
            Some(self.next())
        } else {
            None
        }
    }

    fn expect_op(&mut self, val: &str) -> Result<Token, Diagnostic> {
        let t = self.peek().clone();
        if !self.check_op(val) {
            let got = if t.value.is_empty() {
                "eof".to_string()
            } else {
                t.value.clone()
            };
            return Err(self.syntax_err(&t, format!("Expected '{val}', found '{got}'")));
        }
        Ok(self.next())
    }

    fn parse_dotted_ident(&mut self) -> Result<String, Diagnostic> {
        let mut name = self.expect_ident()?.value;
        while self.eat_punct(".").is_some() {
            name.push('.');
            name.push_str(&self.expect_ident()?.value);
        }
        Ok(name)
    }

    fn parse_module(&mut self) -> Result<SemanticModule, Diagnostic> {
        self.skip_newlines();
        let first = self.peek().clone();
        let mut module_name = "main".to_string();
        let mut header_span: Option<SourceSpan> = None;
        let mut imports = Vec::new();
        let mut capabilities = CapabilitySummaryDecl::default();
        let mut structs = Vec::new();
        let mut enums = Vec::new();
        let mut traits = Vec::new();
        let mut constants = Vec::new();
        let mut globals = Vec::new();
        let mut functions = Vec::new();
        let mut top_level_stmts = Vec::new();

        if self.check_kw("PROFILE") {
            self.next();
            self.expect_ident()?;
            self.skip_newlines();
        }

        if self.check_kw("MODULE") {
            let mod_start = self.next();
            module_name = self.parse_dotted_ident()?;
            let prev = self.prev().clone();
            header_span = Some(self.make_span(&mod_start, &prev));
            self.skip_newlines();
        } else if self.check_kw("APP") {
            let tok = self.peek().clone();
            return Err(self.legacy_v0_err(&tok, "APP"));
        }

        while !self.is_eof() {
            self.skip_newlines();
            if self.is_eof() {
                break;
            }

            if self.check_kw("IMPORT") {
                imports.push(self.parse_import()?);
                continue;
            }
            if self.check_kw("REQUIRES") || self.check_kw("PROVIDES") || self.check_kw("DENIES") {
                self.parse_capability_decl(&mut capabilities)?;
                continue;
            }

            if self.check_kw("APP")
                || self.check_kw("PAGE")
                || self.check_kw("COMPONENT")
                || self.check_kw("STYLE")
                || self.check_kw("CSS")
                || self.check_kw("JS")
                || self.check_kw("ROUTE")
                || self.check_kw("SERVER")
                || self.check_kw("ENDPOINT")
                || self.check_kw("WHEN")
                || self.check_kw("USE")
                || self.check_kw("STATE")
                || self.check_kw("ACTION")
                || self.check_kw("DEFINE")
            {
                let tok = self.peek().clone();
                let construct = tok.upper.clone();
                return Err(self.legacy_v0_err(&tok, &construct));
            }

            if self.check_kw("PROGRAM") {
                if module_name == "main" {
                    let next_tok = self.peek_at(1).clone();
                    if next_tok.kind == TokenKind::Ident && !next_tok.value.is_empty() {
                        module_name = next_tok.value;
                    }
                }
                self.has_solana_contract = true;
                self.skip_balanced_end_block();
                continue;
            }

            let is_export = self.eat_kw("EXPORT");

            if self.check_kw("STRUCT") {
                structs.push(self.parse_struct(is_export)?);
                continue;
            }
            if self.check_kw("ENUM") {
                enums.push(self.parse_enum(is_export)?);
                continue;
            }
            if self.check_kw("TRAIT") {
                traits.push(self.parse_trait(is_export)?);
                continue;
            }
            if self.check_kw("CONSTANT") || self.check_kw("CONST") {
                constants.push(self.parse_const_decl(is_export)?);
                continue;
            }
            if self.check_kw("ASYNC") || self.check_kw("FUNCTION") {
                functions.push(self.parse_fn_decl(is_export)?);
                continue;
            }
            if self.check_kw("LET") || self.check_kw("MUTABLE") {
                let v = self.parse_var_decl(is_export)?;
                let span = v.span.clone();
                globals.push(v.clone());
                top_level_stmts.push(SemanticStmt::VarStmt { decl: v, span });
                continue;
            }

            let stmt = self.parse_stmt()?;
            top_level_stmts.push(stmt);
        }

        let last = self.prev().clone();
        Ok(SemanticModule {
            profile: SyntaxProfile::Beginner,
            module_name,
            header_span,
            is_solana_contract: self.has_solana_contract,
            imports,
            capabilities,
            structs,
            enums,
            traits,
            constants,
            globals,
            functions,
            top_level_stmts,
            span: self.make_span(&first, &last),
        })
    }

    fn parse_import(&mut self) -> Result<ImportDecl, Diagnostic> {
        let start = self.expect_kw("IMPORT")?;
        let mut symbols = Vec::new();
        let has_brace = self.eat_punct("{").is_some();
        while !self.is_eof() && !self.check_kw("FROM") && !self.check_punct("}") {
            let name = self.expect_ident()?.value;
            let alias = if self.eat_kw("AS") {
                Some(self.expect_ident()?.value)
            } else {
                None
            };
            symbols.push(ImportSymbol { name, alias });
            if self.eat_punct(",").is_none() {
                break;
            }
        }
        if has_brace {
            self.expect_punct("}")?;
        }
        self.expect_kw("FROM")?;
        let from_tok = self.expect_string("module path string")?;
        self.eat_punct(";");
        self.skip_newlines();
        Ok(ImportDecl {
            from: from_tok.value.clone(),
            symbols,
            span: self.make_span(&start, &from_tok),
        })
    }

    fn parse_capability_decl(&mut self, target: &mut CapabilitySummaryDecl) -> Result<(), Diagnostic> {
        let kw = self.next();
        let has_bracket = self.eat_punct("[").is_some();
        let mut items = Vec::new();
        while !self.is_eof() && !self.is_newline() {
            if has_bracket && self.check_punct("]") {
                break;
            }
            let first = self.expect_ident()?;
            let mut name = first.value.clone();
            let mut end = first.clone();
            while self.eat_punct(".").is_some() {
                let seg = self.expect_ident()?;
                name.push('.');
                name.push_str(&seg.value);
                end = seg;
            }
            items.push(CapabilityItem {
                name,
                span: self.make_span(&first, &end),
            });
            if self.eat_punct(",").is_none() {
                break;
            }
        }
        if has_bracket {
            self.expect_punct("]")?;
        }
        self.eat_punct(";");
        self.skip_newlines();
        match kw.upper.as_str() {
            "REQUIRES" => target.requires.extend(items),
            "PROVIDES" => target.provides.extend(items),
            _ => target.denies.extend(items),
        }
        Ok(())
    }

    fn parse_type_params(&mut self) -> Result<Vec<String>, Diagnostic> {
        let mut params = Vec::new();
        if self.eat_op("<").is_some() {
            while !self.check_op(">") && !self.is_eof() {
                params.push(self.expect_ident()?.value);
                if self.eat_punct(",").is_none() {
                    break;
                }
            }
            self.expect_op(">")?;
        }
        Ok(params)
    }

    fn parse_type_node(&mut self) -> Result<TypeNode, Diagnostic> {
        let start = self.expect_ident()?;
        let norm = normalize_primitive_type_name(&start.value).to_string();

        if norm == "Array" && self.eat_op("<").is_some() {
            let elem = self.parse_type_node()?;
            let end = self.expect_op(">")?;
            return Ok(TypeNode::ArrayType {
                element_type: Box::new(elem),
                span: self.make_span(&start, &end),
            });
        }
        if norm == "Map" && self.eat_op("<").is_some() {
            let k = self.parse_type_node()?;
            self.expect_punct(",")?;
            let v = self.parse_type_node()?;
            let end = self.expect_op(">")?;
            return Ok(TypeNode::MapType {
                key_type: Box::new(k),
                value_type: Box::new(v),
                span: self.make_span(&start, &end),
            });
        }
        if norm == "Result" && self.eat_op("<").is_some() {
            let ok = self.parse_type_node()?;
            self.expect_punct(",")?;
            let err = self.parse_type_node()?;
            let end = self.expect_op(">")?;
            return Ok(TypeNode::ResultType {
                ok_type: Box::new(ok),
                err_type: Box::new(err),
                span: self.make_span(&start, &end),
            });
        }

        if matches!(norm.as_str(), "i64" | "f64" | "bool" | "str" | "void" | "any") {
            return Ok(TypeNode::PrimitiveType {
                name: norm,
                span: self.make_span(&start, &start),
            });
        }

        let mut type_args = Vec::new();
        let mut end_tok = start.clone();
        if self.eat_op("<").is_some() {
            while !self.check_op(">") && !self.is_eof() {
                type_args.push(self.parse_type_node()?);
                if self.eat_punct(",").is_none() {
                    break;
                }
            }
            end_tok = self.expect_op(">")?;
        }
        Ok(TypeNode::NamedType {
            name: norm,
            type_args,
            span: self.make_span(&start, &end_tok),
        })
    }

    fn parse_struct(&mut self, exported: bool) -> Result<StructDecl, Diagnostic> {
        let start = self.expect_kw("STRUCT")?;
        let name = self.expect_ident()?.value;
        let type_params = self.parse_type_params()?;
        self.skip_newlines();
        let mut fields = Vec::new();
        while !self.check_kw("END") && !self.is_eof() {
            self.skip_newlines();
            if self.check_kw("END") {
                break;
            }
            let f_tok = self.expect_ident()?;
            self.expect_punct(":")?;
            let f_type = self.parse_type_node()?;
            let end = self.prev().clone();
            fields.push(StructFieldDecl {
                name: f_tok.value.clone(),
                field_type: f_type,
                span: self.make_span(&f_tok, &end),
            });
            self.eat_punct(",");
            self.skip_newlines();
        }
        let end = self.expect_kw("END")?;
        self.skip_newlines();
        Ok(StructDecl {
            name,
            exported,
            type_params,
            fields,
            span: self.make_span(&start, &end),
        })
    }

    fn parse_enum(&mut self, exported: bool) -> Result<EnumDecl, Diagnostic> {
        let start = self.expect_kw("ENUM")?;
        let name = self.expect_ident()?.value;
        let type_params = self.parse_type_params()?;
        self.skip_newlines();
        let mut variants = Vec::new();
        while !self.check_kw("END") && !self.is_eof() {
            self.skip_newlines();
            if self.check_kw("END") {
                break;
            }
            let v_tok = self.expect_ident()?;
            let mut payload_types = Vec::new();
            if self.eat_punct("(").is_some() {
                while !self.check_punct(")") && !self.is_eof() {
                    payload_types.push(self.parse_type_node()?);
                    if self.eat_punct(",").is_none() {
                        break;
                    }
                }
                self.expect_punct(")")?;
            }
            let end = self.prev().clone();
            variants.push(EnumVariantDecl {
                name: v_tok.value.clone(),
                payload_types,
                span: self.make_span(&v_tok, &end),
            });
            self.eat_punct(",");
            self.skip_newlines();
        }
        let end = self.expect_kw("END")?;
        self.skip_newlines();
        Ok(EnumDecl {
            name,
            exported,
            type_params,
            variants,
            span: self.make_span(&start, &end),
        })
    }

    fn parse_trait(&mut self, exported: bool) -> Result<TraitDecl, Diagnostic> {
        let start = self.expect_kw("TRAIT")?;
        let name = self.expect_ident()?.value;
        let type_params = self.parse_type_params()?;
        self.skip_newlines();
        let mut methods = Vec::new();
        while !self.check_kw("END") && !self.is_eof() {
            self.skip_newlines();
            if self.check_kw("END") {
                break;
            }
            let fn_start = self.expect_kw("FUNCTION")?;
            let m_name = self.expect_ident()?.value;
            self.expect_punct("(")?;
            let params = self.parse_paren_params()?;
            self.expect_punct(")")?;
            let return_type = if self.eat_op("->").is_some() || self.eat_kw("RETURNS") {
                self.parse_type_node()?
            } else {
                let prev = self.prev().clone();
                TypeNode::PrimitiveType {
                    name: "void".to_string(),
                    span: self.make_span(&fn_start, &prev),
                }
            };
            let (effects, _) = self.parse_effects_clause()?;
            let end = self.prev().clone();
            methods.push(TraitMethodSig {
                name: m_name,
                params,
                return_type,
                effects,
                span: self.make_span(&fn_start, &end),
            });
            self.skip_newlines();
        }
        let end = self.expect_kw("END")?;
        self.skip_newlines();
        Ok(TraitDecl {
            name,
            exported,
            type_params,
            methods,
            span: self.make_span(&start, &end),
        })
    }

    fn parse_const_decl(&mut self, exported: bool) -> Result<ConstDecl, Diagnostic> {
        let start = self.next();
        let name = self.expect_ident()?.value;
        let type_annotation = if self.eat_punct(":").is_some() {
            self.parse_type_node()?
        } else {
            TypeNode::InferredType {
                span: self.make_span(&start, &start),
            }
        };
        if self.eat_op("=").is_none() {
            self.expect_kw("TO")?;
        }
        let init = self.parse_expr()?;
        self.eat_punct(";");
        self.skip_newlines();
        let end = self.prev().clone();
        Ok(ConstDecl {
            name,
            exported,
            type_annotation,
            init,
            span: self.make_span(&start, &end),
        })
    }

    fn parse_var_decl(&mut self, exported: bool) -> Result<VarDecl, Diagnostic> {
        let start = self.next();
        let mutable = start.upper == "MUTABLE"
            || self.eat_kw("MUTABLE")
            || self.eat_kw("MUT");
        let name = self.expect_ident()?.value;
        let type_annotation = if self.eat_punct(":").is_some() {
            self.parse_type_node()?
        } else {
            TypeNode::InferredType {
                span: self.make_span(&start, &start),
            }
        };
        if self.eat_op("=").is_none() {
            self.expect_kw("TO")?;
        }
        let init = self.parse_expr()?;
        self.eat_punct(";");
        self.skip_newlines();
        let end = self.prev().clone();
        Ok(VarDecl {
            name,
            mutable,
            exported,
            type_annotation,
            init,
            span: self.make_span(&start, &end),
        })
    }

    fn parse_fn_decl(&mut self, exported: bool) -> Result<FnDecl, Diagnostic> {
        let start = self.peek().clone();
        let is_async = self.eat_kw("ASYNC");
        self.expect_kw("FUNCTION")?;
        let name = self.expect_ident()?.value;
        let type_params = self.parse_type_params()?;

        self.expect_punct("(")?;
        let params = self.parse_paren_params()?;
        self.expect_punct(")")?;

        let return_type = if self.eat_op("->").is_some() || self.eat_kw("RETURNS") {
            self.parse_type_node()?
        } else {
            let prev = self.prev().clone();
            TypeNode::PrimitiveType {
                name: "void".to_string(),
                span: self.make_span(&start, &prev),
            }
        };

        let (effects, has_explicit_effects) = self.parse_effects_clause()?;
        self.skip_newlines();
        let body = self.parse_block_until_end(&[])?;
        let end = self.expect_kw("END")?;
        self.skip_newlines();

        Ok(FnDecl {
            name,
            exported,
            is_async,
            type_params,
            params,
            return_type,
            effects,
            has_explicit_effects,
            body,
            span: self.make_span(&start, &end),
        })
    }

    fn parse_paren_params(&mut self) -> Result<Vec<FnParamDecl>, Diagnostic> {
        let mut params = Vec::new();
        while !self.check_punct(")") && !self.is_eof() {
            let p_tok = self.expect_ident()?;
            let p_type = if self.eat_punct(":").is_some() {
                self.parse_type_node()?
            } else {
                TypeNode::PrimitiveType {
                    name: "any".to_string(),
                    span: self.make_span(&p_tok, &p_tok),
                }
            };
            let end = self.prev().clone();
            params.push(FnParamDecl {
                name: p_tok.value.clone(),
                param_type: p_type,
                span: self.make_span(&p_tok, &end),
            });
            if self.eat_punct(",").is_none() {
                break;
            }
        }
        Ok(params)
    }

    fn parse_effects_clause(&mut self) -> Result<(Vec<String>, bool), Diagnostic> {
        if self.eat_kw("PURE") {
            return Ok((Vec::new(), true));
        }
        if !self.eat_kw("EFFECTS") {
            return Ok((Vec::new(), false));
        }
        let mut effects = Vec::new();
        let has_paren = self.eat_punct("(").is_some();
        let has_bracket = !has_paren && self.eat_punct("[").is_some();
        while !self.is_eof() && !self.is_newline() {
            if (has_paren && self.check_punct(")")) || (has_bracket && self.check_punct("]")) {
                break;
            }
            let first = self.expect_ident()?;
            let mut eff = first.value;
            while self.eat_punct(".").is_some() {
                eff.push('.');
                eff.push_str(&self.expect_ident()?.value);
            }
            let lower = eff.to_ascii_lowercase();
            if lower != "pure" && lower != "none" {
                effects.push(eff);
            }
            if self.eat_punct(",").is_none() {
                break;
            }
        }
        if has_paren {
            self.expect_punct(")")?;
        }
        if has_bracket {
            self.expect_punct("]")?;
        }
        Ok((effects, true))
    }

    fn parse_block_until_end(&mut self, extra_stops: &[&str]) -> Result<Vec<SemanticStmt>, Diagnostic> {
        let mut stmts = Vec::new();
        while !self.is_eof() {
            self.skip_newlines();
            if self.is_eof() {
                break;
            }
            let p = self.peek();
            if p.kind == TokenKind::Ident
                && (p.upper == "END" || extra_stops.iter().any(|s| *s == p.upper))
            {
                break;
            }
            stmts.push(self.parse_stmt()?);
        }
        Ok(stmts)
    }

    fn parse_stmt(&mut self) -> Result<SemanticStmt, Diagnostic> {
        self.skip_newlines();
        let start = self.peek().clone();

        if start.kind == TokenKind::Ident
            && matches!(
                start.upper.as_str(),
                "APP"
                    | "PAGE"
                    | "COMPONENT"
                    | "CONTAINER"
                    | "CARD"
                    | "NAV"
                    | "NAVBAR"
                    | "HEADER"
                    | "FOOTER"
                    | "MODAL"
                    | "HEADING"
                    | "TEXT"
                    | "BUTTON"
                    | "INPUT"
                    | "STYLE"
                    | "CSS"
                    | "JS"
                    | "SERVER"
                    | "ENDPOINT"
                    | "STATE"
                    | "ACTION"
                    | "DEFINE"
                    | "WHEN"
                    | "USE"
                    | "ROUTE"
            )
        {
            return Err(self.legacy_v0_err(&start, &start.upper));
        }

        if self.check_kw("LET") || self.check_kw("MUTABLE") {
            let decl = self.parse_var_decl(false)?;
            let span = decl.span.clone();
            return Ok(SemanticStmt::VarStmt { decl, span });
        }
        if self.check_kw("CONSTANT") || self.check_kw("CONST") {
            let decl = self.parse_const_decl(false)?;
            let span = decl.span.clone();
            return Ok(SemanticStmt::ConstStmt { decl, span });
        }

        if self.eat_kw("SET") {
            let target_expr = self.parse_postfix()?;
            if !self.eat_kw("TO") {
                self.expect_op("=")?;
            }
            let value = self.parse_expr()?;
            self.eat_punct(";");
            self.skip_newlines();
            let end = self.prev().clone();

            let target = self.expr_to_assign_target(target_expr)?;
            return Ok(SemanticStmt::AssignStmt {
                target,
                value,
                span: self.make_span(&start, &end),
            });
        }

        if self.eat_kw("SHOW") {
            let arg = self.parse_expr()?;
            self.eat_punct(";");
            self.skip_newlines();
            let end = self.prev().clone();
            let span = self.make_span(&start, &end);
            let id = self.alloc_id();
            return Ok(SemanticStmt::ExprStmt {
                expr: SemanticExpr {
                    id,
                    kind: SemanticExprKind::CallExpr {
                        callee: "print".to_string(),
                        type_args: Vec::new(),
                        args: vec![arg],
                    },
                    span: span.clone(),
                },
                span,
            });
        }

        if self.eat_kw("CALL") {
            let callee = self.parse_dotted_ident()?;
            let mut args = Vec::new();
            if self.eat_punct("(").is_some() {
                while !self.check_punct(")") && !self.is_eof() {
                    args.push(self.parse_expr()?);
                    if self.eat_punct(",").is_none() {
                        break;
                    }
                }
                self.expect_punct(")")?;
            } else {
                while !self.is_newline() && !self.is_eof() && !self.check_kw("END") {
                    args.push(self.parse_expr()?);
                    self.eat_punct(",");
                }
            }
            self.skip_newlines();
            let end = self.prev().clone();
            let span = self.make_span(&start, &end);
            let id = self.alloc_id();
            return Ok(SemanticStmt::ExprStmt {
                expr: SemanticExpr {
                    id,
                    kind: SemanticExprKind::CallExpr {
                        callee,
                        type_args: Vec::new(),
                        args,
                    },
                    span: span.clone(),
                },
                span,
            });
        }

        if self.eat_kw("IF") {
            let condition = self.parse_expr()?;
            self.eat_kw("THEN");
            self.skip_newlines();
            let then_branch = self.parse_block_until_end(&["ELSE"])?;
            let mut else_branch = Vec::new();
            if self.eat_kw("ELSE") {
                if self.check_kw("IF") {
                    let nested = self.parse_stmt()?;
                    else_branch = vec![nested];
                    let end = self.prev().clone();
                    return Ok(SemanticStmt::IfStmt {
                        condition,
                        then_branch,
                        else_branch,
                        span: self.make_span(&start, &end),
                    });
                }
                self.skip_newlines();
                else_branch = self.parse_block_until_end(&[])?;
            }
            let end = self.expect_kw("END")?;
            self.skip_newlines();
            return Ok(SemanticStmt::IfStmt {
                condition,
                then_branch,
                else_branch,
                span: self.make_span(&start, &end),
            });
        }

        if self.eat_kw("WHILE") {
            let condition = self.parse_expr()?;
            self.skip_newlines();
            let body = self.parse_block_until_end(&[])?;
            let end = self.expect_kw("END")?;
            self.skip_newlines();
            return Ok(SemanticStmt::WhileStmt {
                condition,
                body,
                span: self.make_span(&start, &end),
            });
        }

        if self.eat_kw("FOR") {
            self.eat_kw("EACH");
            let item_name = self.expect_ident()?.value;
            self.expect_kw("IN")?;
            let iterable = self.parse_expr()?;
            self.skip_newlines();
            let body = self.parse_block_until_end(&[])?;
            let end = self.expect_kw("END")?;
            self.skip_newlines();
            return Ok(SemanticStmt::ForInStmt {
                item_name,
                iterable,
                body,
                span: self.make_span(&start, &end),
            });
        }

        if self.eat_kw("REPEAT") {
            let count = self.parse_expr()?;
            self.eat_kw("TIMES");
            self.skip_newlines();
            let body = self.parse_block_until_end(&[])?;
            let end = self.expect_kw("END")?;
            self.skip_newlines();
            return Ok(SemanticStmt::RepeatStmt {
                count,
                body,
                span: self.make_span(&start, &end),
            });
        }

        if self.eat_kw("BREAK") {
            self.eat_punct(";");
            self.skip_newlines();
            return Ok(SemanticStmt::BreakStmt {
                span: self.make_span(&start, &start),
            });
        }

        if self.eat_kw("CONTINUE") {
            self.eat_punct(";");
            self.skip_newlines();
            return Ok(SemanticStmt::ContinueStmt {
                span: self.make_span(&start, &start),
            });
        }

        if self.eat_kw("RETURN") {
            if self.is_newline() || self.check_kw("END") || self.is_eof() {
                self.skip_newlines();
                return Ok(SemanticStmt::ReturnStmt {
                    value: None,
                    span: self.make_span(&start, &start),
                });
            }
            let value = self.parse_expr()?;
            self.eat_punct(";");
            self.skip_newlines();
            let end = self.prev().clone();
            return Ok(SemanticStmt::ReturnStmt {
                value: Some(value),
                span: self.make_span(&start, &end),
            });
        }

        if self.eat_kw("MATCH") {
            let subject = self.parse_expr()?;
            self.skip_newlines();
            let mut arms = Vec::new();
            while !self.check_kw("END") && !self.is_eof() {
                self.skip_newlines();
                if self.check_kw("END") {
                    break;
                }
                let arm_start = self.peek().clone();
                if self.eat_kw("ELSE") {
                    self.skip_newlines();
                    let body = self.parse_block_until_end(&["WHEN", "ELSE"])?;
                    let arm_end = self.prev().clone();
                    arms.push(MatchArm {
                        pattern: MatchPattern::WildcardPattern {
                            span: self.make_span(&arm_start, &arm_start),
                        },
                        body,
                        span: self.make_span(&arm_start, &arm_end),
                    });
                    continue;
                }
                self.expect_kw("WHEN")?;
                let pattern = self.parse_match_pattern()?;
                self.eat_op("=>");
                self.skip_newlines();
                let body = self.parse_block_until_end(&["WHEN", "ELSE"])?;
                let arm_end = self.prev().clone();
                arms.push(MatchArm {
                    pattern,
                    body,
                    span: self.make_span(&arm_start, &arm_end),
                });
            }
            let end = self.expect_kw("END")?;
            self.skip_newlines();
            return Ok(SemanticStmt::MatchStmt {
                subject,
                arms,
                span: self.make_span(&start, &end),
            });
        }

        if self.eat_kw("TRY") {
            self.skip_newlines();
            let mut try_body = Vec::new();
            while !self.is_eof() {
                self.skip_newlines();
                if self.check_kw("END") || self.check_kw("CATCH") {
                    break;
                }
                if self.check_kw("IF") && self.peek_at(1).upper == "FAILED" {
                    break;
                }
                try_body.push(self.parse_stmt()?);
            }
            let mut err_binding = None;
            let mut catch_body = Vec::new();
            if self.check_kw("IF") && self.peek_at(1).upper == "FAILED" {
                self.next();
                self.next();
                self.skip_newlines();
                catch_body = self.parse_block_until_end(&[])?;
            } else if self.eat_kw("CATCH") {
                if self.peek().kind == TokenKind::Ident && !self.is_newline() {
                    err_binding = Some(self.expect_ident()?.value);
                }
                self.skip_newlines();
                catch_body = self.parse_block_until_end(&[])?;
            }
            let end = self.expect_kw("END")?;
            self.skip_newlines();
            return Ok(SemanticStmt::TryStmt {
                try_body,
                err_binding,
                catch_body,
                span: self.make_span(&start, &end),
            });
        }

        let expr = self.parse_expr()?;
        if self.eat_op("=").is_some() {
            let target = self.expr_to_assign_target(expr)?;
            let value = self.parse_expr()?;
            self.eat_punct(";");
            self.skip_newlines();
            let end = self.prev().clone();
            return Ok(SemanticStmt::AssignStmt {
                target,
                value,
                span: self.make_span(&start, &end),
            });
        }
        self.eat_punct(";");
        self.skip_newlines();
        let end = self.prev().clone();
        Ok(SemanticStmt::ExprStmt {
            expr,
            span: self.make_span(&start, &end),
        })
    }

    fn parse_match_pattern(&mut self) -> Result<MatchPattern, Diagnostic> {
        let start = self.peek().clone();
        if self.check_ident("_") {
            self.next();
            return Ok(MatchPattern::WildcardPattern {
                span: self.make_span(&start, &start),
            });
        }
        if start.kind == TokenKind::Int {
            self.next();
            let val = start.value.parse::<i128>().unwrap_or(0);
            return Ok(MatchPattern::LiteralPattern {
                value: LiteralPatValue::Int(val),
                span: self.make_span(&start, &start),
            });
        }
        if start.kind == TokenKind::String {
            self.next();
            return Ok(MatchPattern::LiteralPattern {
                value: LiteralPatValue::Str(start.value.clone()),
                span: self.make_span(&start, &start),
            });
        }
        if self.eat_kw("TRUE") {
            return Ok(MatchPattern::LiteralPattern {
                value: LiteralPatValue::Bool(true),
                span: self.make_span(&start, &start),
            });
        }
        if self.eat_kw("FALSE") {
            return Ok(MatchPattern::LiteralPattern {
                value: LiteralPatValue::Bool(false),
                span: self.make_span(&start, &start),
            });
        }

        let first = self.expect_ident()?;
        let mut enum_name = None;
        let mut variant_name = first.value;
        if self.eat_op("::").is_some() || self.eat_punct(".").is_some() {
            enum_name = Some(variant_name);
            variant_name = self.expect_ident()?.value;
        }
        let mut bindings = Vec::new();
        if self.eat_punct("(").is_some() {
            while !self.check_punct(")") && !self.is_eof() {
                bindings.push(self.expect_ident()?.value);
                if self.eat_punct(",").is_none() {
                    break;
                }
            }
            self.expect_punct(")")?;
        }
        let end = self.prev().clone();
        Ok(MatchPattern::EnumVariantPattern {
            enum_name,
            variant_name,
            bindings,
            span: self.make_span(&start, &end),
        })
    }

    fn expr_to_assign_target(&self, expr: SemanticExpr) -> Result<AssignTarget, Diagnostic> {
        let span = expr.span.clone();
        match expr.kind {
            SemanticExprKind::Identifier { name } => Ok(AssignTarget::VarTarget { name, span }),
            SemanticExprKind::FieldAccessExpr { object, field } => Ok(AssignTarget::FieldTarget {
                object: *object,
                field,
                span,
            }),
            SemanticExprKind::IndexAccessExpr { object, index } => Ok(AssignTarget::IndexTarget {
                object: *object,
                index: *index,
                span,
            }),
            _ => Err(Diagnostic::error(
                "E_SYNTAX",
                "Invalid SET/assignment target (expected variable, struct field, or index)",
                &span,
            )),
        }
    }

    fn parse_expr(&mut self) -> Result<SemanticExpr, Diagnostic> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let mut left = self.parse_and()?;
        while self.eat_op("||").is_some() || self.eat_kw("OR") {
            let right = self.parse_and()?;
            let span = self.merge_span(&left.span, &right.span);
            let id = self.alloc_id();
            left = SemanticExpr {
                id,
                kind: SemanticExprKind::BinaryExpr {
                    op: BinaryOp::Or,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                span,
            };
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let mut left = self.parse_equality()?;
        while self.eat_op("&&").is_some() || self.eat_kw("AND") {
            let right = self.parse_equality()?;
            let span = self.merge_span(&left.span, &right.span);
            let id = self.alloc_id();
            left = SemanticExpr {
                id,
                kind: SemanticExprKind::BinaryExpr {
                    op: BinaryOp::And,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                span,
            };
        }
        Ok(left)
    }

    fn parse_equality(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let mut left = self.parse_comparison()?;
        while self.check_op("==") || self.check_op("!=") {
            let op = if self.next().value == "==" {
                BinaryOp::Eq
            } else {
                BinaryOp::Neq
            };
            let right = self.parse_comparison()?;
            let span = self.merge_span(&left.span, &right.span);
            let id = self.alloc_id();
            left = SemanticExpr {
                id,
                kind: SemanticExprKind::BinaryExpr {
                    op,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                span,
            };
        }
        Ok(left)
    }

    fn parse_comparison(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let mut left = self.parse_additive()?;
        while self.check_op("<")
            || self.check_op("<=")
            || self.check_op(">")
            || self.check_op(">=")
        {
            let op_str = self.next().value;
            let op = match op_str.as_str() {
                "<" => BinaryOp::Lt,
                "<=" => BinaryOp::Lte,
                ">" => BinaryOp::Gt,
                _ => BinaryOp::Gte,
            };
            let right = self.parse_additive()?;
            let span = self.merge_span(&left.span, &right.span);
            let id = self.alloc_id();
            left = SemanticExpr {
                id,
                kind: SemanticExprKind::BinaryExpr {
                    op,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                span,
            };
        }
        Ok(left)
    }

    fn parse_additive(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let mut left = self.parse_multiplicative()?;
        while self.check_op("+") || self.check_op("-") {
            let op = if self.next().value == "+" {
                BinaryOp::Add
            } else {
                BinaryOp::Sub
            };
            let right = self.parse_multiplicative()?;
            let span = self.merge_span(&left.span, &right.span);
            let id = self.alloc_id();
            left = SemanticExpr {
                id,
                kind: SemanticExprKind::BinaryExpr {
                    op,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                span,
            };
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let mut left = self.parse_unary()?;
        while self.check_op("*") || self.check_op("/") || self.check_op("%") {
            let op_str = self.next().value;
            let op = match op_str.as_str() {
                "*" => BinaryOp::Mul,
                "/" => BinaryOp::Div,
                _ => BinaryOp::Mod,
            };
            let right = self.parse_unary()?;
            let span = self.merge_span(&left.span, &right.span);
            let id = self.alloc_id();
            left = SemanticExpr {
                id,
                kind: SemanticExprKind::BinaryExpr {
                    op,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                span,
            };
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let start = self.peek().clone();
        if self.eat_kw("AWAIT") {
            let operand = self.parse_unary()?;
            let end = self.prev().clone();
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::AwaitExpr {
                    operand: Box::new(operand),
                },
                span: self.make_span(&start, &end),
            });
        }
        if self.eat_op("-").is_some() || self.eat_op("!").is_some() || self.eat_kw("NOT") {
            let op = if start.value == "-" {
                UnaryOp::Neg
            } else {
                UnaryOp::Not
            };
            let operand = self.parse_unary()?;
            let end = self.prev().clone();
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::UnaryExpr {
                    op,
                    operand: Box::new(operand),
                },
                span: self.make_span(&start, &end),
            });
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let mut expr = self.parse_primary()?;
        loop {
            if self.eat_punct("[").is_some() {
                let index = self.parse_expr()?;
                let end = self.expect_punct("]")?;
                let end_span = self.make_span(&end, &end);
                let span = self.merge_span(&expr.span, &end_span);
                let id = self.alloc_id();
                expr = SemanticExpr {
                    id,
                    kind: SemanticExprKind::IndexAccessExpr {
                        object: Box::new(expr),
                        index: Box::new(index),
                    },
                    span,
                };
            } else if self.eat_punct(".").is_some() {
                let field_tok = self.expect_ident()?;
                if self.eat_punct("(").is_some() {
                    let args = self.parse_arg_list()?;
                    let end = self.expect_punct(")")?;
                    let end_span = self.make_span(&end, &end);
                    let span = self.merge_span(&expr.span, &end_span);
                    let id = self.alloc_id();
                    if let SemanticExprKind::Identifier { name } = expr.kind {
                        expr = SemanticExpr {
                            id,
                            kind: SemanticExprKind::CallExpr {
                                callee: format!("{name}.{}", field_tok.value),
                                type_args: Vec::new(),
                                args,
                            },
                            span,
                        };
                    } else {
                        let mut all_args = Vec::with_capacity(args.len() + 1);
                        all_args.push(expr);
                        all_args.extend(args);
                        expr = SemanticExpr {
                            id,
                            kind: SemanticExprKind::CallExpr {
                                callee: field_tok.value,
                                type_args: Vec::new(),
                                args: all_args,
                            },
                            span,
                        };
                    }
                } else {
                    let end_span = self.make_span(&field_tok, &field_tok);
                    let span = self.merge_span(&expr.span, &end_span);
                    let id = self.alloc_id();
                    expr = SemanticExpr {
                        id,
                        kind: SemanticExprKind::FieldAccessExpr {
                            object: Box::new(expr),
                            field: field_tok.value,
                        },
                        span,
                    };
                }
            } else if self.eat_op("?").is_some() {
                let prev = self.prev().clone();
                let end_span = self.make_span(&prev, &prev);
                let span = self.merge_span(&expr.span, &end_span);
                let id = self.alloc_id();
                expr = SemanticExpr {
                    id,
                    kind: SemanticExprKind::TryPropagateExpr {
                        operand: Box::new(expr),
                    },
                    span,
                };
            } else {
                break;
            }
        }
        Ok(expr)
    }

    fn parse_primary(&mut self) -> Result<SemanticExpr, Diagnostic> {
        let tok = self.peek().clone();

        if tok.kind == TokenKind::Int {
            self.next();
            let id = self.alloc_id();
            let parsed = tok.value.parse::<i128>().ok();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::IntLiteral {
                    value: parsed,
                    raw: tok.value.clone(),
                },
                span: self.make_span(&tok, &tok),
            });
        }
        if tok.kind == TokenKind::Float {
            self.next();
            let id = self.alloc_id();
            let value = tok.value.parse::<f64>().unwrap_or(0.0);
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::FloatLiteral {
                    value,
                    raw: tok.value.clone(),
                },
                span: self.make_span(&tok, &tok),
            });
        }
        if tok.kind == TokenKind::String {
            self.next();
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::StringLiteral {
                    value: tok.value.clone(),
                },
                span: self.make_span(&tok, &tok),
            });
        }
        if self.eat_kw("TRUE") {
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::BoolLiteral { value: true },
                span: self.make_span(&tok, &tok),
            });
        }
        if self.eat_kw("FALSE") {
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::BoolLiteral { value: false },
                span: self.make_span(&tok, &tok),
            });
        }

        if self.eat_punct("(").is_some() {
            let inner = self.parse_expr()?;
            self.expect_punct(")")?;
            return Ok(inner);
        }

        if self.eat_punct("[").is_some() {
            self.skip_newlines();
            let mut elements = Vec::new();
            while !self.check_punct("]") && !self.is_eof() {
                elements.push(self.parse_expr()?);
                self.skip_newlines();
                if self.eat_punct(",").is_none() {
                    break;
                }
                self.skip_newlines();
            }
            let end = self.expect_punct("]")?;
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::ArrayLiteral { elements },
                span: self.make_span(&tok, &end),
            });
        }

        if self.eat_punct("{").is_some() {
            self.skip_newlines();
            let mut entries = Vec::new();
            while !self.check_punct("}") && !self.is_eof() {
                let key = self.parse_expr()?;
                self.expect_punct(":")?;
                let value = self.parse_expr()?;
                entries.push(MapEntryInit { key, value });
                self.skip_newlines();
                if self.eat_punct(",").is_none() {
                    break;
                }
                self.skip_newlines();
            }
            let end = self.expect_punct("}")?;
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::MapLiteral { entries },
                span: self.make_span(&tok, &end),
            });
        }

        if self.eat_kw("NEW") {
            let struct_tok = self.expect_ident()?;
            let open_paren = self.eat_punct("(").is_some();
            if !open_paren {
                self.expect_punct("{")?;
            }
            let close_sym = if open_paren { ")" } else { "}" };
            let mut fields = Vec::new();
            while !self.check_punct(close_sym) && !self.is_eof() {
                self.skip_newlines();
                if self.check_punct(close_sym) {
                    break;
                }
                let f_tok = self.expect_ident()?;
                if self.eat_punct(":").is_none() {
                    self.expect_op("=")?;
                }
                let val = self.parse_expr()?;
                let f_end = self.prev().clone();
                fields.push(StructFieldInit {
                    name: f_tok.value.clone(),
                    value: val,
                    span: self.make_span(&f_tok, &f_end),
                });
                if self.eat_punct(",").is_none() {
                    break;
                }
            }
            let end = self.expect_punct(close_sym)?;
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::StructLiteral {
                    struct_name: struct_tok.value,
                    type_args: Vec::new(),
                    fields,
                },
                span: self.make_span(&tok, &end),
            });
        }

        if self.eat_kw("CALL") {
            let callee = self.parse_dotted_ident()?;
            let mut args = Vec::new();
            if self.eat_punct("(").is_some() {
                args.extend(self.parse_arg_list()?);
                self.expect_punct(")")?;
            } else {
                while !self.is_newline()
                    && !self.is_eof()
                    && !self.check_punct(")")
                    && !self.check_punct(",")
                {
                    args.push(self.parse_primary()?);
                }
            }
            let end = self.prev().clone();
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::CallExpr {
                    callee,
                    type_args: Vec::new(),
                    args,
                },
                span: self.make_span(&tok, &end),
            });
        }

        if tok.kind == TokenKind::Ident {
            self.next();
            let mut path = tok.value.clone();
            while self.eat_op("::").is_some() {
                path.push_str("::");
                path.push_str(&self.expect_ident()?.value);
            }

            if path.contains("::") {
                let parts: Vec<&str> = path.split("::").collect();
                if parts.len() == 2
                    && parts[0]
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_uppercase())
                    && parts[0] != "Std"
                {
                    let mut args = Vec::new();
                    if self.eat_punct("(").is_some() {
                        args.extend(self.parse_arg_list()?);
                        self.expect_punct(")")?;
                    }
                    let end = self.prev().clone();
                    let id = self.alloc_id();
                    return Ok(SemanticExpr {
                        id,
                        kind: SemanticExprKind::EnumConstructExpr {
                            enum_name: parts[0].to_string(),
                            variant_name: parts[1].to_string(),
                            args,
                        },
                        span: self.make_span(&tok, &end),
                    });
                }
            }

            if self.eat_punct("(").is_some() {
                let args = self.parse_arg_list()?;
                let end = self.expect_punct(")")?;
                let id = self.alloc_id();
                return Ok(SemanticExpr {
                    id,
                    kind: SemanticExprKind::CallExpr {
                        callee: path,
                        type_args: Vec::new(),
                        args,
                    },
                    span: self.make_span(&tok, &end),
                });
            }

            if !path.contains("::")
                && path
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_uppercase())
                && self.check_punct("{")
            {
                self.expect_punct("{")?;
                let mut fields = Vec::new();
                while !self.check_punct("}") && !self.is_eof() {
                    self.skip_newlines();
                    if self.check_punct("}") {
                        break;
                    }
                    let f_tok = self.expect_ident()?;
                    self.expect_punct(":")?;
                    let val = self.parse_expr()?;
                    let f_end = self.prev().clone();
                    fields.push(StructFieldInit {
                        name: f_tok.value.clone(),
                        value: val,
                        span: self.make_span(&f_tok, &f_end),
                    });
                    if self.eat_punct(",").is_none() {
                        break;
                    }
                }
                let end = self.expect_punct("}")?;
                let id = self.alloc_id();
                return Ok(SemanticExpr {
                    id,
                    kind: SemanticExprKind::StructLiteral {
                        struct_name: path,
                        type_args: Vec::new(),
                        fields,
                    },
                    span: self.make_span(&tok, &end),
                });
            }

            let end = self.prev().clone();
            let id = self.alloc_id();
            return Ok(SemanticExpr {
                id,
                kind: SemanticExprKind::Identifier { name: path },
                span: self.make_span(&tok, &end),
            });
        }

        let got = if tok.value.is_empty() {
            "eof".to_string()
        } else {
            tok.value.clone()
        };
        Err(self.syntax_err(&tok, format!("Unexpected token '{got}' in expression")))
    }

    fn parse_arg_list(&mut self) -> Result<Vec<SemanticExpr>, Diagnostic> {
        let mut args = Vec::new();
        while !self.check_punct(")") && !self.is_eof() {
            args.push(self.parse_expr()?);
            if self.eat_punct(",").is_none() {
                break;
            }
        }
        Ok(args)
    }

    fn skip_balanced_end_block(&mut self) {
        fn is_block_opener(upper: &str) -> bool {
            matches!(
                upper,
                "PROGRAM"
                    | "ACCOUNT"
                    | "INSTRUCTION"
                    | "RUST"
                    | "IF"
                    | "WHILE"
                    | "FOR"
                    | "REPEAT"
                    | "TRY"
                    | "FUNCTION"
                    | "MATCH"
            )
        }

        let mut depth: usize = 1;
        self.next();
        while !self.is_eof() && depth > 0 {
            let prev_was_line_start =
                self.pos == 0 || self.tokens.get(self.pos.saturating_sub(1)).is_some_and(|t| t.kind == TokenKind::Newline);
            let tok = self.next();
            if tok.kind == TokenKind::Ident {
                if tok.upper == "END" {
                    depth = depth.saturating_sub(1);
                } else if prev_was_line_start && is_block_opener(&tok.upper) {
                    if tok.upper == "BUTTON" {
                        while !self.is_newline() && !self.is_eof() {
                            self.next();
                        }
                        self.skip_newlines();
                        if self.check_kw("WHEN") || self.check_kw("STYLE") {
                            depth += 1;
                        }
                    } else if tok.upper == "IF" && self.peek().upper == "FAILED" {
                        // IF FAILED inside TRY does not open another END
                    } else {
                        depth += 1;
                    }
                }
            }
        }
        self.skip_newlines();
    }
}

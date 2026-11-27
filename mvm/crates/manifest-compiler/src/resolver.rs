use std::collections::{BTreeMap, HashMap, HashSet};

use crate::ast::*;
use crate::diagnostic::Diagnostic;
use crate::parser_beg::parse_beginner_module;
use crate::parser_pro::parse_professional_module;
use crate::profile::{detect_syntax_profile, SyntaxProfile};
use crate::stdlib::lookup_std_module;

pub type WorkspaceFiles = BTreeMap<String, String>;

pub fn parse_module_for_profile(
    source: &str,
    explicit_profile: Option<&str>,
    file: Option<&str>,
    next_expr_id: &mut u64,
) -> Result<(SyntaxProfile, SemanticModule), Diagnostic> {
    let profile = detect_syntax_profile(source, explicit_profile);
    let ast = match profile {
        SyntaxProfile::Professional => parse_professional_module(source, file, next_expr_id)?,
        SyntaxProfile::Beginner => parse_beginner_module(source, file, next_expr_id)?,
    };
    Ok((profile, ast))
}

fn normalize_segments(p: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for part in p.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            out.pop();
        } else {
            out.push(part);
        }
    }
    out.join("/")
}

fn normalize_import_path(from_file: &str, import_spec: &str) -> Vec<String> {
    let trimmed = import_spec.trim();
    let clean_spec = trimmed.strip_prefix("./").unwrap_or(trimmed);
    let dir = match from_file.rfind('/') {
        Some(idx) => &from_file[..idx],
        None => "",
    };
    let base = if dir.is_empty() {
        clean_spec.to_string()
    } else {
        format!("{dir}/{clean_spec}")
    };
    let normalized = normalize_segments(&base);

    let mut candidates = Vec::new();
    let mut push_unique = |s: String| {
        if !candidates.contains(&s) {
            candidates.push(s);
        }
    };
    push_unique(normalized.clone());
    if !normalized.ends_with(".manifest") {
        push_unique(format!("{normalized}.manifest"));
    }
    if !clean_spec.ends_with(".manifest") {
        push_unique(format!("{clean_spec}.manifest"));
    }
    push_unique(clean_spec.to_string());
    candidates
}

fn sanitize_mod_prefix(s: &str) -> String {
    let res: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if res.is_empty() {
        "mod".to_string()
    } else {
        res
    }
}

pub struct ResolvedGraph {
    pub resolved_profile: SyntaxProfile,
    pub merged_module: SemanticModule,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn resolve_module_graph(
    entry_source: &str,
    entry_file: &str,
    explicit_profile: Option<&str>,
    files: &WorkspaceFiles,
    next_expr_id: &mut u64,
) -> Result<ResolvedGraph, Diagnostic> {
    let mut diagnostics = Vec::new();
    let (resolved_profile, entry_mod) =
        parse_module_for_profile(entry_source, explicit_profile, Some(entry_file), next_expr_id)?;

    let mut parsed_modules: Vec<SemanticModule> = Vec::new();
    let mut path_to_idx: HashMap<String, usize> = HashMap::new();
    let mut edges_by_path: HashMap<String, Vec<(usize, Vec<ImportSymbol>)>> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut ordered_indices: Vec<usize> = Vec::new();

    #[allow(clippy::too_many_arguments)]
    fn visit(
        path_key: String,
        mod_ast: SemanticModule,
        parsed_modules: &mut Vec<SemanticModule>,
        path_to_idx: &mut HashMap<String, usize>,
        edges_by_path: &mut HashMap<String, Vec<(usize, Vec<ImportSymbol>)>>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
        ordered_indices: &mut Vec<usize>,
        files: &WorkspaceFiles,
        diagnostics: &mut Vec<Diagnostic>,
        next_expr_id: &mut u64,
    ) -> Result<usize, Diagnostic> {
        if let Some(&idx) = path_to_idx.get(&path_key) {
            if visited.contains(&path_key) {
                return Ok(idx);
            }
        }
        let my_idx = if let Some(&idx) = path_to_idx.get(&path_key) {
            idx
        } else {
            let idx = parsed_modules.len();
            parsed_modules.push(mod_ast.clone());
            path_to_idx.insert(path_key.clone(), idx);
            idx
        };

        visiting.insert(path_key.clone());
        let mut my_edges = Vec::new();

        for imp in &mod_ast.imports {
            let std_name = if let Some(rest) = imp.from.strip_prefix("std.") {
                format!("std::{rest}")
            } else {
                imp.from.clone()
            };

            let (found_path, source_to_load) = if let Some(std_def) = lookup_std_module(&std_name) {
                let p = format!("stdlib/{}.manifest", std_name.replace("::", "/"));
                (p, std_def.source.to_string())
            } else {
                let candidates = normalize_import_path(&path_key, &imp.from);
                if let Some(found) = candidates.iter().find(|c| files.contains_key(c.as_str())) {
                    (found.clone(), files[found].clone())
                } else {
                    diagnostics.push(Diagnostic::error_with_hint(
                        "E_MODULE_NOT_FOUND",
                        format!("Cannot resolve imported module '{}'", imp.from),
                        &imp.span,
                        format!("Ensure '{}' exists in the workspace.", candidates[0]),
                    ));
                    continue;
                }
            };

            if visiting.contains(&found_path) {
                diagnostics.push(Diagnostic::error(
                    "E_CIRCULAR_IMPORT",
                    format!(
                        "Circular module import detected: '{}' -> '{}'",
                        path_key, found_path
                    ),
                    &imp.span,
                ));
                continue;
            }

            let dep_ast = if let Some(&existing_idx) = path_to_idx.get(&found_path) {
                parsed_modules[existing_idx].clone()
            } else {
                let (_, ast) =
                    parse_module_for_profile(&source_to_load, None, Some(&found_path), next_expr_id)?;
                ast
            };

            let dep_idx = visit(
                found_path.clone(),
                dep_ast.clone(),
                parsed_modules,
                path_to_idx,
                edges_by_path,
                visiting,
                visited,
                ordered_indices,
                files,
                diagnostics,
                next_expr_id,
            )?;

            my_edges.push((dep_idx, imp.symbols.clone()));

            let target_mod = &parsed_modules[dep_idx];
            for sym in &imp.symbols {
                let exported_flag = target_mod
                    .functions
                    .iter()
                    .find(|f| f.name == sym.name)
                    .map(|f| f.exported)
                    .or_else(|| {
                        target_mod
                            .constants
                            .iter()
                            .find(|c| c.name == sym.name)
                            .map(|c| c.exported)
                    })
                    .or_else(|| {
                        target_mod
                            .globals
                            .iter()
                            .find(|g| g.name == sym.name)
                            .map(|g| g.exported)
                    })
                    .or_else(|| {
                        target_mod
                            .structs
                            .iter()
                            .find(|s| s.name == sym.name)
                            .map(|s| s.exported)
                    })
                    .or_else(|| {
                        target_mod
                            .enums
                            .iter()
                            .find(|e| e.name == sym.name)
                            .map(|e| e.exported)
                    });

                match exported_flag {
                    None => diagnostics.push(Diagnostic::error(
                        "E_IMPORT_SYMBOL_MISSING",
                        format!(
                            "Module '{}' has no declaration named '{}'",
                            imp.from, sym.name
                        ),
                        &imp.span,
                    )),
                    Some(false) => diagnostics.push(Diagnostic::error(
                        "E_IMPORT_PRIVATE_SYMBOL",
                        format!(
                            "Symbol '{}' in module '{}' is private (missing 'export' / 'EXPORT')",
                            sym.name, imp.from
                        ),
                        &imp.span,
                    )),
                    Some(true) => {}
                }
            }
        }

        edges_by_path.insert(path_key.clone(), my_edges);
        visiting.remove(&path_key);
        visited.insert(path_key);
        ordered_indices.push(my_idx);
        Ok(my_idx)
    }

    let entry_idx = visit(
        entry_file.to_string(),
        entry_mod.clone(),
        &mut parsed_modules,
        &mut path_to_idx,
        &mut edges_by_path,
        &mut visiting,
        &mut visited,
        &mut ordered_indices,
        files,
        &mut diagnostics,
        next_expr_id,
    )?;

    if ordered_indices.len() <= 1 {
        return Ok(ResolvedGraph {
            resolved_profile,
            merged_module: entry_mod,
            diagnostics,
        });
    }

    // Build path lookup by module index
    let mut path_by_idx: HashMap<usize, String> = HashMap::new();
    for (p, &idx) in &path_to_idx {
        path_by_idx.insert(idx, p.clone());
    }

    let mut dep_canonical_map: HashMap<usize, HashMap<String, String>> = HashMap::new();
    for (order_pos, &mod_idx) in ordered_indices.iter().enumerate() {
        if mod_idx == entry_idx {
            continue;
        }
        let m = &parsed_modules[mod_idx];
        let prefix = format!("__m{order_pos}_{}__", sanitize_mod_prefix(&m.module_name));
        let mut own = HashMap::new();
        for st in &m.structs {
            own.insert(st.name.clone(), format!("{prefix}{}", st.name));
        }
        for en in &m.enums {
            own.insert(en.name.clone(), format!("{prefix}{}", en.name));
        }
        for c in &m.constants {
            own.insert(c.name.clone(), format!("{prefix}{}", c.name));
        }
        for g in &m.globals {
            own.insert(g.name.clone(), format!("{prefix}{}", g.name));
        }
        for fn_d in &m.functions {
            own.insert(fn_d.name.clone(), format!("{prefix}{}", fn_d.name));
        }
        dep_canonical_map.insert(mod_idx, own);
    }

    let build_module_rename_map = |mod_idx: usize| -> HashMap<String, String> {
        let mut rename_map = HashMap::new();
        if let Some(path_k) = path_by_idx.get(&mod_idx) {
            if let Some(edges) = edges_by_path.get(path_k) {
                for (target_idx, syms) in edges {
                    if let Some(target_own) = dep_canonical_map.get(target_idx) {
                        for sym in syms {
                            if let Some(canonical) = target_own.get(&sym.name) {
                                let local_name = sym.alias.as_ref().unwrap_or(&sym.name);
                                rename_map.insert(local_name.clone(), canonical.clone());
                            }
                        }
                    }
                }
            }
        }
        if let Some(own) = dep_canonical_map.get(&mod_idx) {
            for (k, v) in own {
                rename_map.insert(k.clone(), v.clone());
            }
        }
        rename_map
    };

    let mut merged_structs = Vec::new();
    let mut merged_enums = Vec::new();
    let mut merged_constants = Vec::new();
    let mut merged_globals = Vec::new();
    let mut merged_functions = Vec::new();
    let mut merged_top_level_stmts = Vec::new();

    for &dep_idx in &ordered_indices {
        if dep_idx == entry_idx {
            continue;
        }
        let dep = &parsed_modules[dep_idx];
        let rename_map = build_module_rename_map(dep_idx);
        let own_map = dep_canonical_map.get(&dep_idx).cloned().unwrap_or_default();
        let mut renamer = ScopedAstRenamer::new(rename_map);

        for st in &dep.structs {
            let cname = own_map.get(&st.name).cloned().unwrap_or_else(|| st.name.clone());
            merged_structs.push(StructDecl {
                name: cname,
                exported: false,
                type_params: st.type_params.clone(),
                fields: st
                    .fields
                    .iter()
                    .map(|f| StructFieldDecl {
                        name: f.name.clone(),
                        field_type: renamer.rewrite_type(&f.field_type),
                        span: f.span.clone(),
                    })
                    .collect(),
                span: st.span.clone(),
            });
        }

        for en in &dep.enums {
            let cname = own_map.get(&en.name).cloned().unwrap_or_else(|| en.name.clone());
            merged_enums.push(EnumDecl {
                name: cname,
                exported: false,
                type_params: en.type_params.clone(),
                variants: en
                    .variants
                    .iter()
                    .map(|v| EnumVariantDecl {
                        name: v.name.clone(),
                        payload_types: v
                            .payload_types
                            .iter()
                            .map(|pt| renamer.rewrite_type(pt))
                            .collect(),
                        span: v.span.clone(),
                    })
                    .collect(),
                span: en.span.clone(),
            });
        }

        for c in &dep.constants {
            let cname = own_map.get(&c.name).cloned().unwrap_or_else(|| c.name.clone());
            merged_constants.push(ConstDecl {
                name: cname,
                exported: false,
                type_annotation: renamer.rewrite_type(&c.type_annotation),
                init: renamer.rewrite_expr(&c.init),
                span: c.span.clone(),
            });
        }

        for g in &dep.globals {
            let cname = own_map.get(&g.name).cloned().unwrap_or_else(|| g.name.clone());
            merged_globals.push(VarDecl {
                name: cname,
                mutable: true,
                exported: false,
                type_annotation: renamer.rewrite_type(&g.type_annotation),
                init: renamer.rewrite_expr(&g.init),
                span: g.span.clone(),
            });
        }

        for fn_d in &dep.functions {
            let cname = own_map
                .get(&fn_d.name)
                .cloned()
                .unwrap_or_else(|| fn_d.name.clone());
            merged_functions.push(renamer.rewrite_function(fn_d, cname, false));
        }

        let rewritten_top = renamer.rewrite_block_stmts(&dep.top_level_stmts, true);
        merged_top_level_stmts.extend(rewritten_top);
    }

    let mut entry_imports_only = build_module_rename_map(entry_idx);
    let mut entry_own_names = HashSet::new();
    for s in &entry_mod.structs {
        entry_own_names.insert(s.name.as_str());
    }
    for e in &entry_mod.enums {
        entry_own_names.insert(e.name.as_str());
    }
    for c in &entry_mod.constants {
        entry_own_names.insert(c.name.as_str());
    }
    for g in &entry_mod.globals {
        entry_own_names.insert(g.name.as_str());
    }
    for f in &entry_mod.functions {
        entry_own_names.insert(f.name.as_str());
    }
    for own in entry_own_names {
        entry_imports_only.remove(own);
    }

    let mut entry_renamer = ScopedAstRenamer::new(entry_imports_only);

    for st in &entry_mod.structs {
        merged_structs.push(StructDecl {
            name: st.name.clone(),
            exported: st.exported,
            type_params: st.type_params.clone(),
            fields: st
                .fields
                .iter()
                .map(|f| StructFieldDecl {
                    name: f.name.clone(),
                    field_type: entry_renamer.rewrite_type(&f.field_type),
                    span: f.span.clone(),
                })
                .collect(),
            span: st.span.clone(),
        });
    }
    for en in &entry_mod.enums {
        merged_enums.push(EnumDecl {
            name: en.name.clone(),
            exported: en.exported,
            type_params: en.type_params.clone(),
            variants: en
                .variants
                .iter()
                .map(|v| EnumVariantDecl {
                    name: v.name.clone(),
                    payload_types: v
                        .payload_types
                        .iter()
                        .map(|pt| entry_renamer.rewrite_type(pt))
                        .collect(),
                    span: v.span.clone(),
                })
                .collect(),
            span: en.span.clone(),
        });
    }
    for c in &entry_mod.constants {
        merged_constants.push(ConstDecl {
            name: c.name.clone(),
            exported: c.exported,
            type_annotation: entry_renamer.rewrite_type(&c.type_annotation),
            init: entry_renamer.rewrite_expr(&c.init),
            span: c.span.clone(),
        });
    }
    for g in &entry_mod.globals {
        merged_globals.push(VarDecl {
            name: g.name.clone(),
            mutable: g.mutable,
            exported: g.exported,
            type_annotation: entry_renamer.rewrite_type(&g.type_annotation),
            init: entry_renamer.rewrite_expr(&g.init),
            span: g.span.clone(),
        });
    }
    for fn_d in &entry_mod.functions {
        merged_functions.push(entry_renamer.rewrite_function(
            fn_d,
            fn_d.name.clone(),
            fn_d.exported,
        ));
    }
    merged_top_level_stmts.extend(entry_renamer.rewrite_block_stmts(&entry_mod.top_level_stmts, true));

    let merged_module = SemanticModule {
        structs: merged_structs,
        enums: merged_enums,
        constants: merged_constants,
        globals: merged_globals,
        functions: merged_functions,
        top_level_stmts: merged_top_level_stmts,
        ..entry_mod
    };

    Ok(ResolvedGraph {
        resolved_profile,
        merged_module,
        diagnostics,
    })
}

struct ScopedAstRenamer {
    rename_map: HashMap<String, String>,
    scopes: Vec<HashSet<String>>,
}

impl ScopedAstRenamer {
    fn new(rename_map: HashMap<String, String>) -> Self {
        Self {
            rename_map,
            scopes: Vec::new(),
        }
    }

    fn push_scope(&mut self, names: Vec<String>) {
        self.scopes.push(names.into_iter().collect());
    }

    fn pop_scope(&mut self) {
        self.scopes.pop();
    }

    fn declare_local(&mut self, name: &str) {
        if let Some(top) = self.scopes.last_mut() {
            top.insert(name.to_string());
        }
    }

    fn is_shadowed(&self, name: &str) -> bool {
        self.scopes.iter().rev().any(|s| s.contains(name))
    }

    fn resolve_name(&self, name: &str) -> String {
        if self.is_shadowed(name) {
            return name.to_string();
        }
        self.rename_map
            .get(name)
            .cloned()
            .unwrap_or_else(|| name.to_string())
    }

    fn rewrite_type(&self, t: &TypeNode) -> TypeNode {
        match t {
            TypeNode::NamedType {
                name,
                type_args,
                span,
            } => TypeNode::NamedType {
                name: self
                    .rename_map
                    .get(name)
                    .cloned()
                    .unwrap_or_else(|| name.clone()),
                type_args: type_args.iter().map(|a| self.rewrite_type(a)).collect(),
                span: span.clone(),
            },
            TypeNode::ArrayType { element_type, span } => TypeNode::ArrayType {
                element_type: Box::new(self.rewrite_type(element_type)),
                span: span.clone(),
            },
            TypeNode::MapType {
                key_type,
                value_type,
                span,
            } => TypeNode::MapType {
                key_type: Box::new(self.rewrite_type(key_type)),
                value_type: Box::new(self.rewrite_type(value_type)),
                span: span.clone(),
            },
            TypeNode::ResultType {
                ok_type,
                err_type,
                span,
            } => TypeNode::ResultType {
                ok_type: Box::new(self.rewrite_type(ok_type)),
                err_type: Box::new(self.rewrite_type(err_type)),
                span: span.clone(),
            },
            other => other.clone(),
        }
    }

    fn rewrite_expr(&self, expr: &SemanticExpr) -> SemanticExpr {
        let kind = match &expr.kind {
            SemanticExprKind::Identifier { name } => SemanticExprKind::Identifier {
                name: self.resolve_name(name),
            },
            SemanticExprKind::CallExpr {
                callee,
                type_args,
                args,
            } => SemanticExprKind::CallExpr {
                callee: self.resolve_name(callee),
                type_args: type_args.iter().map(|t| self.rewrite_type(t)).collect(),
                args: args.iter().map(|a| self.rewrite_expr(a)).collect(),
            },
            SemanticExprKind::StructLiteral {
                struct_name,
                type_args,
                fields,
            } => SemanticExprKind::StructLiteral {
                struct_name: self
                    .rename_map
                    .get(struct_name)
                    .cloned()
                    .unwrap_or_else(|| struct_name.clone()),
                type_args: type_args.iter().map(|t| self.rewrite_type(t)).collect(),
                fields: fields
                    .iter()
                    .map(|f| StructFieldInit {
                        name: f.name.clone(),
                        value: self.rewrite_expr(&f.value),
                        span: f.span.clone(),
                    })
                    .collect(),
            },
            SemanticExprKind::EnumConstructExpr {
                enum_name,
                variant_name,
                args,
            } => SemanticExprKind::EnumConstructExpr {
                enum_name: self
                    .rename_map
                    .get(enum_name)
                    .cloned()
                    .unwrap_or_else(|| enum_name.clone()),
                variant_name: variant_name.clone(),
                args: args.iter().map(|a| self.rewrite_expr(a)).collect(),
            },
            SemanticExprKind::BinaryExpr { op, left, right } => SemanticExprKind::BinaryExpr {
                op: *op,
                left: Box::new(self.rewrite_expr(left)),
                right: Box::new(self.rewrite_expr(right)),
            },
            SemanticExprKind::UnaryExpr { op, operand } => SemanticExprKind::UnaryExpr {
                op: *op,
                operand: Box::new(self.rewrite_expr(operand)),
            },
            SemanticExprKind::FieldAccessExpr { object, field } => {
                SemanticExprKind::FieldAccessExpr {
                    object: Box::new(self.rewrite_expr(object)),
                    field: field.clone(),
                }
            }
            SemanticExprKind::IndexAccessExpr { object, index } => {
                SemanticExprKind::IndexAccessExpr {
                    object: Box::new(self.rewrite_expr(object)),
                    index: Box::new(self.rewrite_expr(index)),
                }
            }
            SemanticExprKind::ArrayLiteral { elements } => SemanticExprKind::ArrayLiteral {
                elements: elements.iter().map(|e| self.rewrite_expr(e)).collect(),
            },
            SemanticExprKind::MapLiteral { entries } => SemanticExprKind::MapLiteral {
                entries: entries
                    .iter()
                    .map(|kv| MapEntryInit {
                        key: self.rewrite_expr(&kv.key),
                        value: self.rewrite_expr(&kv.value),
                    })
                    .collect(),
            },
            SemanticExprKind::AwaitExpr { operand } => SemanticExprKind::AwaitExpr {
                operand: Box::new(self.rewrite_expr(operand)),
            },
            SemanticExprKind::TryPropagateExpr { operand } => SemanticExprKind::TryPropagateExpr {
                operand: Box::new(self.rewrite_expr(operand)),
            },
            other => other.clone(),
        };
        SemanticExpr {
            id: expr.id,
            kind,
            span: expr.span.clone(),
        }
    }

    fn rewrite_assign_target(&self, target: &AssignTarget) -> AssignTarget {
        match target {
            AssignTarget::VarTarget { name, span } => AssignTarget::VarTarget {
                name: self.resolve_name(name),
                span: span.clone(),
            },
            AssignTarget::FieldTarget {
                object,
                field,
                span,
            } => AssignTarget::FieldTarget {
                object: self.rewrite_expr(object),
                field: field.clone(),
                span: span.clone(),
            },
            AssignTarget::IndexTarget {
                object,
                index,
                span,
            } => AssignTarget::IndexTarget {
                object: self.rewrite_expr(object),
                index: self.rewrite_expr(index),
                span: span.clone(),
            },
        }
    }

    fn rewrite_pattern(&self, pat: &MatchPattern) -> MatchPattern {
        match pat {
            MatchPattern::EnumVariantPattern {
                enum_name: Some(en),
                variant_name,
                bindings,
                span,
            } => MatchPattern::EnumVariantPattern {
                enum_name: Some(self.rename_map.get(en).cloned().unwrap_or_else(|| en.clone())),
                variant_name: variant_name.clone(),
                bindings: bindings.clone(),
                span: span.clone(),
            },
            other => other.clone(),
        }
    }

    fn rewrite_block_stmts(
        &mut self,
        stmts: &[SemanticStmt],
        is_module_top_level: bool,
    ) -> Vec<SemanticStmt> {
        stmts
            .iter()
            .map(|s| self.rewrite_stmt(s, is_module_top_level))
            .collect()
    }

    fn rewrite_stmt(&mut self, stmt: &SemanticStmt, is_module_top_level: bool) -> SemanticStmt {
        match stmt {
            SemanticStmt::VarStmt { decl, span } => {
                let next_init = self.rewrite_expr(&decl.init);
                let next_type = self.rewrite_type(&decl.type_annotation);
                let next_name = if is_module_top_level {
                    self.rename_map
                        .get(&decl.name)
                        .cloned()
                        .unwrap_or_else(|| decl.name.clone())
                } else {
                    self.declare_local(&decl.name);
                    decl.name.clone()
                };
                SemanticStmt::VarStmt {
                    decl: VarDecl {
                        name: next_name,
                        mutable: decl.mutable,
                        exported: false,
                        type_annotation: next_type,
                        init: next_init,
                        span: decl.span.clone(),
                    },
                    span: span.clone(),
                }
            }
            SemanticStmt::ConstStmt { decl, span } => {
                let next_init = self.rewrite_expr(&decl.init);
                let next_type = self.rewrite_type(&decl.type_annotation);
                let next_name = if is_module_top_level {
                    self.rename_map
                        .get(&decl.name)
                        .cloned()
                        .unwrap_or_else(|| decl.name.clone())
                } else {
                    self.declare_local(&decl.name);
                    decl.name.clone()
                };
                SemanticStmt::ConstStmt {
                    decl: ConstDecl {
                        name: next_name,
                        exported: false,
                        type_annotation: next_type,
                        init: next_init,
                        span: decl.span.clone(),
                    },
                    span: span.clone(),
                }
            }
            SemanticStmt::AssignStmt {
                target,
                value,
                span,
            } => SemanticStmt::AssignStmt {
                target: self.rewrite_assign_target(target),
                value: self.rewrite_expr(value),
                span: span.clone(),
            },
            SemanticStmt::ExprStmt { expr, span } => SemanticStmt::ExprStmt {
                expr: self.rewrite_expr(expr),
                span: span.clone(),
            },
            SemanticStmt::IfStmt {
                condition,
                then_branch,
                else_branch,
                span,
            } => {
                let cond = self.rewrite_expr(condition);
                self.push_scope(Vec::new());
                let then_b = self.rewrite_block_stmts(then_branch, false);
                self.pop_scope();
                self.push_scope(Vec::new());
                let else_b = self.rewrite_block_stmts(else_branch, false);
                self.pop_scope();
                SemanticStmt::IfStmt {
                    condition: cond,
                    then_branch: then_b,
                    else_branch: else_b,
                    span: span.clone(),
                }
            }
            SemanticStmt::WhileStmt {
                condition,
                body,
                span,
            } => {
                let cond = self.rewrite_expr(condition);
                self.push_scope(Vec::new());
                let next_body = self.rewrite_block_stmts(body, false);
                self.pop_scope();
                SemanticStmt::WhileStmt {
                    condition: cond,
                    body: next_body,
                    span: span.clone(),
                }
            }
            SemanticStmt::ForInStmt {
                item_name,
                iterable,
                body,
                span,
            } => {
                let iter = self.rewrite_expr(iterable);
                self.push_scope(vec![item_name.clone()]);
                let next_body = self.rewrite_block_stmts(body, false);
                self.pop_scope();
                SemanticStmt::ForInStmt {
                    item_name: item_name.clone(),
                    iterable: iter,
                    body: next_body,
                    span: span.clone(),
                }
            }
            SemanticStmt::RepeatStmt { count, body, span } => {
                let cnt = self.rewrite_expr(count);
                self.push_scope(Vec::new());
                let next_body = self.rewrite_block_stmts(body, false);
                self.pop_scope();
                SemanticStmt::RepeatStmt {
                    count: cnt,
                    body: next_body,
                    span: span.clone(),
                }
            }
            SemanticStmt::ReturnStmt { value, span } => SemanticStmt::ReturnStmt {
                value: value.as_ref().map(|v| self.rewrite_expr(v)),
                span: span.clone(),
            },
            SemanticStmt::MatchStmt {
                subject,
                arms,
                span,
            } => {
                let subj = self.rewrite_expr(subject);
                let next_arms = arms
                    .iter()
                    .map(|arm| {
                        let pat = self.rewrite_pattern(&arm.pattern);
                        let bindings = match &pat {
                            MatchPattern::EnumVariantPattern { bindings, .. } => bindings.clone(),
                            _ => Vec::new(),
                        };
                        self.push_scope(bindings);
                        let b = self.rewrite_block_stmts(&arm.body, false);
                        self.pop_scope();
                        MatchArm {
                            pattern: pat,
                            body: b,
                            span: arm.span.clone(),
                        }
                    })
                    .collect();
                SemanticStmt::MatchStmt {
                    subject: subj,
                    arms: next_arms,
                    span: span.clone(),
                }
            }
            SemanticStmt::TryStmt {
                try_body,
                err_binding,
                catch_body,
                span,
            } => {
                self.push_scope(Vec::new());
                let tb = self.rewrite_block_stmts(try_body, false);
                self.pop_scope();
                self.push_scope(err_binding.clone().into_iter().collect());
                let cb = self.rewrite_block_stmts(catch_body, false);
                self.pop_scope();
                SemanticStmt::TryStmt {
                    try_body: tb,
                    err_binding: err_binding.clone(),
                    catch_body: cb,
                    span: span.clone(),
                }
            }
            other => other.clone(),
        }
    }

    fn rewrite_function(&mut self, fn_d: &FnDecl, new_name: String, keep_exported: bool) -> FnDecl {
        self.push_scope(fn_d.params.iter().map(|p| p.name.clone()).collect());
        let params = fn_d
            .params
            .iter()
            .map(|p| FnParamDecl {
                name: p.name.clone(),
                param_type: self.rewrite_type(&p.param_type),
                span: p.span.clone(),
            })
            .collect();
        let return_type = self.rewrite_type(&fn_d.return_type);
        let body = self.rewrite_block_stmts(&fn_d.body, false);
        self.pop_scope();
        FnDecl {
            name: new_name,
            exported: keep_exported,
            is_async: fn_d.is_async,
            type_params: fn_d.type_params.clone(),
            params,
            return_type,
            effects: fn_d.effects.clone(),
            has_explicit_effects: fn_d.has_explicit_effects,
            body,
            span: fn_d.span.clone(),
        }
    }
}

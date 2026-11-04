import { ManifestError } from '../errors/manifest-error.ts';
import {
  AssignTarget,
  BinaryOp,
  CapabilitySummaryDecl,
  ConstDecl,
  EnumDecl,
  EnumVariantDecl,
  FnDecl,
  FnParamDecl,
  ImportDecl,
  MatchArm,
  MatchPattern,
  SemanticExpr,
  SemanticModule,
  SemanticStmt,
  SourceSpan,
  StructDecl,
  TraitDecl,
  TraitMethodSig,
  TypeNode,
  VarDecl,
} from './ast-v2.ts';
import { normalizePrimitiveTypeName } from './profile.ts';

interface PToken {
  kind:
    | 'ident'
    | 'int'
    | 'float'
    | 'string'
    | 'punct'
    | 'op'
    | 'eof';
  value: string;
  line: number;
  col: number;
}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||', '->', '=>', '::']);
const SINGLE_OPS = new Set(['+', '-', '*', '/', '%', '<', '>', '!', '=', '?']);
const PUNCTS = new Set(['{', '}', '(', ')', '[', ']', ';', ',', ':', '.']);

function tokenizeProfessional(source: string): PToken[] {
  const tokens: PToken[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < source.length) {
    const ch = source[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance(1);
      continue;
    }

    // Line comments // or --
    if ((ch === '/' && source[i + 1] === '/') || (ch === '-' && source[i + 1] === '-')) {
      while (i < source.length && source[i] !== '\n') advance(1);
      continue;
    }

    // Block comments /* ... */
    if (ch === '/' && source[i + 1] === '*') {
      const startLine = line;
      const startCol = col;
      advance(2);
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        advance(1);
      }
      if (i >= source.length) {
        throw new ManifestError('Unterminated block comment', startLine, startCol, 'lexer');
      }
      advance(2);
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startLine = line;
      const startCol = col;
      advance(1);
      let str = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          advance(1);
          if (i >= source.length) break;
          const esc = source[i];
          if (esc === 'n') str += '\n';
          else if (esc === 't') str += '\t';
          else if (esc === 'r') str += '\r';
          else if (esc === '\\') str += '\\';
          else if (esc === '"') str += '"';
          else if (esc === "'") str += "'";
          else str += esc;
          advance(1);
        } else {
          str += source[i];
          advance(1);
        }
      }
      if (i >= source.length) {
        throw new ManifestError('Unterminated string literal', startLine, startCol, 'lexer');
      }
      advance(1);
      tokens.push({ kind: 'string', value: str, line: startLine, col: startCol });
      continue;
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      const startLine = line;
      const startCol = col;
      let num = '';
      let isFloat = false;
      while (i < source.length && ((source[i] >= '0' && source[i] <= '9') || source[i] === '_')) {
        if (source[i] !== '_') num += source[i];
        advance(1);
      }
      if (source[i] === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
        isFloat = true;
        num += '.';
        advance(1);
        while (i < source.length && ((source[i] >= '0' && source[i] <= '9') || source[i] === '_')) {
          if (source[i] !== '_') num += source[i];
          advance(1);
        }
      }
      tokens.push({
        kind: isFloat ? 'float' : 'int',
        value: num,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    // Two-character operators
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: 'op', value: two, line, col });
      advance(2);
      continue;
    }

    // Single-character operators
    if (SINGLE_OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch, line, col });
      advance(1);
      continue;
    }

    // Punctuation
    if (PUNCTS.has(ch)) {
      tokens.push({ kind: 'punct', value: ch, line, col });
      advance(1);
      continue;
    }

    // Identifiers & keywords
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      const startLine = line;
      const startCol = col;
      let id = '';
      while (
        i < source.length &&
        ((source[i] >= 'a' && source[i] <= 'z') ||
          (source[i] >= 'A' && source[i] <= 'Z') ||
          (source[i] >= '0' && source[i] <= '9') ||
          source[i] === '_')
      ) {
        id += source[i];
        advance(1);
      }
      tokens.push({ kind: 'ident', value: id, line: startLine, col: startCol });
      continue;
    }

    throw new ManifestError(`Unexpected character '${ch}'`, line, col, 'lexer');
  }

  tokens.push({ kind: 'eof', value: '', line, col });
  return tokens;
}

export class ProfessionalParser {
  private tokens: PToken[];
  private pos = 0;
  private file?: string;

  constructor(source: string, file?: string) {
    this.tokens = tokenizeProfessional(source);
    this.file = file;
  }

  public parseModule(): SemanticModule {
    const first = this.peek();
    let moduleName = 'main';
    const imports: ImportDecl[] = [];
    const capabilities: CapabilitySummaryDecl = { requires: [], provides: [], denies: [] };
    const structs: StructDecl[] = [];
    const enums: EnumDecl[] = [];
    const traits: TraitDecl[] = [];
    const constants: ConstDecl[] = [];
    const globals: VarDecl[] = [];
    const functions: FnDecl[] = [];
    const topLevelStmts: SemanticStmt[] = [];

    // Optional `profile professional;` pragma
    if (this.checkIdent('profile')) {
      this.next();
      this.expectIdent();
      this.eatPunct(';');
    }

    // Optional `module foo.bar;`
    if (this.checkIdent('module')) {
      this.next();
      moduleName = this.parseDottedIdent();
      this.eatPunct(';');
    }

    while (!this.isEof()) {
      if (this.checkIdent('import')) {
        imports.push(this.parseImport());
        continue;
      }

      if (this.checkIdent('requires') || this.checkIdent('provides') || this.checkIdent('denies')) {
        this.parseCapabilityDecl(capabilities);
        continue;
      }

      const isExport = this.eatIdent('export');

      if (this.checkIdent('struct')) {
        structs.push(this.parseStruct(isExport));
        continue;
      }
      if (this.checkIdent('enum')) {
        enums.push(this.parseEnum(isExport));
        continue;
      }
      if (this.checkIdent('trait')) {
        traits.push(this.parseTrait(isExport));
        continue;
      }
      if (this.checkIdent('const')) {
        constants.push(this.parseConstDecl(isExport));
        continue;
      }
      if (this.checkIdent('async') || this.checkIdent('fn')) {
        functions.push(this.parseFnDecl(isExport));
        continue;
      }
      if (this.checkIdent('let')) {
        const v = this.parseVarDecl(isExport);
        globals.push(v);
        topLevelStmts.push({ kind: 'VarStmt', decl: v, span: v.span });
        continue;
      }

      if (isExport) {
        const tok = this.peek();
        throw new ManifestError(
          `Expected 'fn', 'struct', 'enum', 'trait', 'const', or 'let' after 'export', found '${tok.value}'`,
          tok.line,
          tok.col,
          'parser'
        );
      }

      topLevelStmts.push(this.parseStmt());
    }

    const last = this.peek();
    return {
      kind: 'SemanticModule',
      profile: 'professional',
      moduleName,
      isLegacyApp: false,
      hasDomainExtensions: { webUI: false, solanaContract: false },
      imports,
      capabilities,
      structs,
      enums,
      traits,
      constants,
      globals,
      functions,
      topLevelStmts,
      span: this.makeSpan(first, last),
    };
  }

  private parseImport(): ImportDecl {
    const start = this.expectIdentVal('import');
    const symbols: Array<{ name: string; alias?: string }> = [];
    if (this.eatPunct('{')) {
      while (!this.checkPunct('}') && !this.isEof()) {
        const name = this.expectIdent().value;
        let alias: string | undefined;
        if (this.eatIdent('as')) {
          alias = this.expectIdent().value;
        }
        symbols.push({ name, alias });
        if (!this.eatPunct(',')) break;
      }
      this.expectPunct('}');
    } else {
      const name = this.expectIdent().value;
      symbols.push({ name });
    }
    this.expectIdentVal('from');
    const fromTok = this.expectKind('string', 'module path string');
    this.eatPunct(';');
    return {
      from: fromTok.value,
      symbols,
      span: this.makeSpan(start, fromTok),
    };
  }

  private parseCapabilityDecl(target: CapabilitySummaryDecl): void {
    const kw = this.next();
    const bucket =
      kw.value === 'requires'
        ? target.requires
        : kw.value === 'provides'
          ? target.provides
          : target.denies;

    const hasBracket = this.eatPunct('[');
    while (!this.isEof()) {
      if (hasBracket && this.checkPunct(']')) break;
      const firstTok = this.expectIdent();
      let capName = firstTok.value;
      let endTok = firstTok;
      while (this.eatPunct('.')) {
        const seg = this.expectIdent();
        capName += `.${seg.value}`;
        endTok = seg;
      }
      bucket.push({ name: capName, span: this.makeSpan(firstTok, endTok) });
      if (!this.eatPunct(',')) break;
    }
    if (hasBracket) {
      this.expectPunct(']');
    }
    this.eatPunct(';');
  }

  private parseTypeParams(): string[] {
    const params: string[] = [];
    if (this.eatOp('<')) {
      while (!this.checkOp('>') && !this.isEof()) {
        params.push(this.expectIdent().value);
        if (!this.eatPunct(',')) break;
      }
      this.expectOp('>');
    }
    return params;
  }

  private parseTypeNode(): TypeNode {
    const start = this.expectIdent();
    const norm = normalizePrimitiveTypeName(start.value);

    if (norm === 'Array' && this.eatOp('<')) {
      const elem = this.parseTypeNode();
      const end = this.expectOp('>');
      return { kind: 'ArrayType', elementType: elem, span: this.makeSpan(start, end) };
    }
    if (norm === 'Map' && this.eatOp('<')) {
      const k = this.parseTypeNode();
      this.expectPunct(',');
      const v = this.parseTypeNode();
      const end = this.expectOp('>');
      return { kind: 'MapType', keyType: k, valueType: v, span: this.makeSpan(start, end) };
    }
    if (norm === 'Result' && this.eatOp('<')) {
      const ok = this.parseTypeNode();
      this.expectPunct(',');
      const err = this.parseTypeNode();
      const end = this.expectOp('>');
      return { kind: 'ResultType', okType: ok, errType: err, span: this.makeSpan(start, end) };
    }

    if (
      norm === 'i64' ||
      norm === 'f64' ||
      norm === 'bool' ||
      norm === 'str' ||
      norm === 'void' ||
      norm === 'any'
    ) {
      return { kind: 'PrimitiveType', name: norm, span: this.makeSpan(start, start) };
    }

    const typeArgs: TypeNode[] = [];
    let endTok = start;
    if (this.eatOp('<')) {
      while (!this.checkOp('>') && !this.isEof()) {
        typeArgs.push(this.parseTypeNode());
        if (!this.eatPunct(',')) break;
      }
      endTok = this.expectOp('>');
    }

    return {
      kind: 'NamedType',
      name: norm,
      typeArgs,
      span: this.makeSpan(start, endTok),
    };
  }

  private parseStruct(exported: boolean): StructDecl {
    const start = this.expectIdentVal('struct');
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();
    this.expectPunct('{');
    const fields = [];
    while (!this.checkPunct('}') && !this.isEof()) {
      const fTok = this.expectIdent();
      this.expectPunct(':');
      const fType = this.parseTypeNode();
      fields.push({ name: fTok.value, type: fType, span: this.makeSpan(fTok, this.prev()) });
      if (!this.eatPunct(',')) {
        this.eatPunct(';');
      }
    }
    const end = this.expectPunct('}');
    return { name, exported, typeParams, fields, span: this.makeSpan(start, end) };
  }

  private parseEnum(exported: boolean): EnumDecl {
    const start = this.expectIdentVal('enum');
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();
    this.expectPunct('{');
    const variants: EnumVariantDecl[] = [];
    while (!this.checkPunct('}') && !this.isEof()) {
      const vTok = this.expectIdent();
      const payloadTypes: TypeNode[] = [];
      if (this.eatPunct('(')) {
        while (!this.checkPunct(')') && !this.isEof()) {
          payloadTypes.push(this.parseTypeNode());
          if (!this.eatPunct(',')) break;
        }
        this.expectPunct(')');
      }
      variants.push({
        name: vTok.value,
        payloadTypes,
        span: this.makeSpan(vTok, this.prev()),
      });
      if (!this.eatPunct(',')) {
        this.eatPunct(';');
      }
    }
    const end = this.expectPunct('}');
    return { name, exported, typeParams, variants, span: this.makeSpan(start, end) };
  }

  private parseTrait(exported: boolean): TraitDecl {
    const start = this.expectIdentVal('trait');
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();
    this.expectPunct('{');
    const methods: TraitMethodSig[] = [];
    while (!this.checkPunct('}') && !this.isEof()) {
      const fnStart = this.expectIdentVal('fn');
      const mName = this.expectIdent().value;
      this.expectPunct('(');
      const params = this.parseParamList();
      this.expectPunct(')');
      let returnType: TypeNode = {
        kind: 'PrimitiveType',
        name: 'void',
        span: this.makeSpan(fnStart, this.prev()),
      };
      if (this.eatOp('->')) {
        returnType = this.parseTypeNode();
      }
      const effects = this.parseEffectsClause().effects;
      const mEnd = this.expectPunct(';');
      methods.push({
        name: mName,
        params,
        returnType,
        effects,
        span: this.makeSpan(fnStart, mEnd),
      });
    }
    const end = this.expectPunct('}');
    return { name, exported, typeParams, methods, span: this.makeSpan(start, end) };
  }

  private parseConstDecl(exported: boolean): ConstDecl {
    const start = this.expectIdentVal('const');
    const name = this.expectIdent().value;
    let typeAnnotation: TypeNode = { kind: 'InferredType', span: this.makeSpan(start, start) };
    if (this.eatPunct(':')) {
      typeAnnotation = this.parseTypeNode();
    }
    this.expectOp('=');
    const init = this.parseExpr();
    const end = this.eatPunct(';') || this.prev();
    return { name, exported, typeAnnotation, init, span: this.makeSpan(start, end) };
  }

  private parseVarDecl(exported: boolean): VarDecl {
    const start = this.expectIdentVal('let');
    const mutable = this.eatIdent('mut');
    const name = this.expectIdent().value;
    let typeAnnotation: TypeNode = { kind: 'InferredType', span: this.makeSpan(start, start) };
    if (this.eatPunct(':')) {
      typeAnnotation = this.parseTypeNode();
    }
    this.expectOp('=');
    const init = this.parseExpr();
    const end = this.eatPunct(';') || this.prev();
    return { name, mutable, exported, typeAnnotation, init, span: this.makeSpan(start, end) };
  }

  private parseFnDecl(exported: boolean): FnDecl {
    const start = this.peek();
    const isAsync = this.eatIdent('async');
    this.expectIdentVal('fn');
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();
    this.expectPunct('(');
    const params = this.parseParamList();
    this.expectPunct(')');

    let returnType: TypeNode = {
      kind: 'PrimitiveType',
      name: 'void',
      span: this.makeSpan(start, this.prev()),
    };
    if (this.eatOp('->')) {
      returnType = this.parseTypeNode();
    }

    const { effects, hasExplicit } = this.parseEffectsClause();
    const body = this.parseBlock();
    return {
      name,
      exported,
      isAsync,
      typeParams,
      params,
      returnType,
      effects,
      hasExplicitEffects: hasExplicit,
      body,
      span: this.makeSpan(start, this.prev()),
    };
  }

  private parseParamList(): FnParamDecl[] {
    const params: FnParamDecl[] = [];
    while (!this.checkPunct(')') && !this.isEof()) {
      const pTok = this.expectIdent();
      this.expectPunct(':');
      const pType = this.parseTypeNode();
      params.push({
        name: pTok.value,
        type: pType,
        span: this.makeSpan(pTok, this.prev()),
      });
      if (!this.eatPunct(',')) break;
    }
    return params;
  }

  private parseEffectsClause(): { effects: string[]; hasExplicit: boolean } {
    if (this.eatIdent('pure')) {
      return { effects: [], hasExplicit: true };
    }
    if (!this.eatIdent('effects')) {
      return { effects: [], hasExplicit: false };
    }
    const effects: string[] = [];
    const openParen = this.eatPunct('(');
    const openBracket = !openParen && this.eatPunct('[');
    while (!this.isEof()) {
      if ((openParen && this.checkPunct(')')) || (openBracket && this.checkPunct(']'))) break;
      const first = this.expectIdent();
      let eff = first.value;
      while (this.eatPunct('.')) {
        eff += `.${this.expectIdent().value}`;
      }
      if (eff !== 'pure' && eff !== 'none') {
        effects.push(eff);
      }
      if (!this.eatPunct(',')) break;
    }
    if (openParen) this.expectPunct(')');
    if (openBracket) this.expectPunct(']');
    return { effects, hasExplicit: true };
  }

  private parseBlock(): SemanticStmt[] {
    this.expectPunct('{');
    const stmts: SemanticStmt[] = [];
    while (!this.checkPunct('}') && !this.isEof()) {
      stmts.push(this.parseStmt());
    }
    this.expectPunct('}');
    return stmts;
  }

  private parseStmt(): SemanticStmt {
    const start = this.peek();

    if (this.checkIdent('let')) {
      const decl = this.parseVarDecl(false);
      return { kind: 'VarStmt', decl, span: decl.span };
    }
    if (this.checkIdent('const')) {
      const decl = this.parseConstDecl(false);
      return { kind: 'ConstStmt', decl, span: decl.span };
    }
    if (this.eatIdent('if')) {
      const condition = this.parseExprNoStructLit();
      const thenBranch = this.parseBlock();
      let elseBranch: SemanticStmt[] = [];
      if (this.eatIdent('else')) {
        if (this.checkIdent('if')) {
          elseBranch = [this.parseStmt()];
        } else {
          elseBranch = this.parseBlock();
        }
      }
      return {
        kind: 'IfStmt',
        condition,
        thenBranch,
        elseBranch,
        span: this.makeSpan(start, this.prev()),
      };
    }
    if (this.eatIdent('while')) {
      const condition = this.parseExprNoStructLit();
      const body = this.parseBlock();
      return { kind: 'WhileStmt', condition, body, span: this.makeSpan(start, this.prev()) };
    }
    if (this.eatIdent('for')) {
      const hasParen = this.eatPunct('(');
      const itemName = this.expectIdent().value;
      this.expectIdentVal('in');
      const iterable = this.parseExprNoStructLit();
      if (hasParen) this.expectPunct(')');
      const body = this.parseBlock();
      return {
        kind: 'ForInStmt',
        itemName,
        iterable,
        body,
        span: this.makeSpan(start, this.prev()),
      };
    }
    if (this.eatIdent('repeat')) {
      const hasParen = this.eatPunct('(');
      const count = this.parseExprNoStructLit();
      if (hasParen) this.expectPunct(')');
      const body = this.parseBlock();
      return { kind: 'RepeatStmt', count, body, span: this.makeSpan(start, this.prev()) };
    }
    if (this.eatIdent('break')) {
      const end = this.eatPunct(';') || start;
      return { kind: 'BreakStmt', span: this.makeSpan(start, end) };
    }
    if (this.eatIdent('continue')) {
      const end = this.eatPunct(';') || start;
      return { kind: 'ContinueStmt', span: this.makeSpan(start, end) };
    }
    if (this.eatIdent('return')) {
      if (this.checkPunct(';') || this.checkPunct('}')) {
        const end = this.eatPunct(';') || start;
        return { kind: 'ReturnStmt', span: this.makeSpan(start, end) };
      }
      const value = this.parseExpr();
      const end = this.eatPunct(';') || this.prev();
      return { kind: 'ReturnStmt', value, span: this.makeSpan(start, end) };
    }
    if (this.eatIdent('match')) {
      const subject = this.parseExprNoStructLit();
      this.expectPunct('{');
      const arms: MatchArm[] = [];
      while (!this.checkPunct('}') && !this.isEof()) {
        const armStart = this.peek();
        const pattern = this.parseMatchPattern();
        this.expectOp('=>');
        let body: SemanticStmt[];
        if (this.checkPunct('{')) {
          body = this.parseBlock();
          this.eatPunct(',');
        } else {
          const single = this.parseStmt();
          body = [single];
          this.eatPunct(',');
        }
        arms.push({ pattern, body, span: this.makeSpan(armStart, this.prev()) });
      }
      const end = this.expectPunct('}');
      return { kind: 'MatchStmt', subject, arms, span: this.makeSpan(start, end) };
    }
    if (this.eatIdent('try')) {
      const tryBody = this.parseBlock();
      let errBinding: string | undefined;
      let catchBody: SemanticStmt[] = [];
      if (this.eatIdent('catch')) {
        if (this.eatPunct('(')) {
          errBinding = this.expectIdent().value;
          this.expectPunct(')');
        }
        catchBody = this.parseBlock();
      }
      return {
        kind: 'TryStmt',
        tryBody,
        errBinding,
        catchBody,
        span: this.makeSpan(start, this.prev()),
      };
    }

    const expr = this.parseExpr();
    if (this.eatOp('=')) {
      const target = this.exprToAssignTarget(expr);
      const value = this.parseExpr();
      const end = this.eatPunct(';') || this.prev();
      return { kind: 'AssignStmt', target, value, span: this.makeSpan(start, end) };
    }
    const end = this.eatPunct(';') || this.prev();
    return { kind: 'ExprStmt', expr, span: this.makeSpan(start, end) };
  }

  private parseMatchPattern(): MatchPattern {
    const start = this.peek();
    if (this.checkIdent('_')) {
      this.next();
      return { kind: 'WildcardPattern', span: this.makeSpan(start, start) };
    }
    if (start.kind === 'int') {
      this.next();
      return { kind: 'LiteralPattern', value: Number(start.value), span: this.makeSpan(start, start) };
    }
    if (start.kind === 'string') {
      this.next();
      return { kind: 'LiteralPattern', value: start.value, span: this.makeSpan(start, start) };
    }
    if (this.eatIdent('true')) {
      return { kind: 'LiteralPattern', value: true, span: this.makeSpan(start, start) };
    }
    if (this.eatIdent('false')) {
      return { kind: 'LiteralPattern', value: false, span: this.makeSpan(start, start) };
    }

    const first = this.expectIdent();
    let enumName: string | undefined;
    let variantName = first.value;
    if (this.eatOp('::') || this.eatPunct('.')) {
      enumName = first.value;
      variantName = this.expectIdent().value;
    }
    const bindings: string[] = [];
    if (this.eatPunct('(')) {
      while (!this.checkPunct(')') && !this.isEof()) {
        bindings.push(this.expectIdent().value);
        if (!this.eatPunct(',')) break;
      }
      this.expectPunct(')');
    }
    return {
      kind: 'EnumVariantPattern',
      enumName,
      variantName,
      bindings,
      span: this.makeSpan(start, this.prev()),
    };
  }

  private exprToAssignTarget(expr: SemanticExpr): AssignTarget {
    if (expr.kind === 'Identifier') {
      return { kind: 'VarTarget', name: expr.name, span: expr.span };
    }
    if (expr.kind === 'FieldAccessExpr') {
      return { kind: 'FieldTarget', object: expr.object, field: expr.field, span: expr.span };
    }
    if (expr.kind === 'IndexAccessExpr') {
      return { kind: 'IndexTarget', object: expr.object, index: expr.index, span: expr.span };
    }
    throw new ManifestError(
      'Invalid assignment target (expected variable, struct field, or array/map index)',
      expr.span.line,
      expr.span.column,
      'parser'
    );
  }

  private allowStructLit = true;

  private parseExprNoStructLit(): SemanticExpr {
    const prev = this.allowStructLit;
    this.allowStructLit = false;
    try {
      return this.parseExpr();
    } finally {
      this.allowStructLit = prev;
    }
  }

  private parseExpr(): SemanticExpr {
    return this.parseOr();
  }

  private parseOr(): SemanticExpr {
    let left = this.parseAnd();
    while (this.eatOp('||')) {
      const right = this.parseAnd();
      left = {
        kind: 'BinaryExpr',
        op: '||',
        left,
        right,
        span: this.mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  private parseAnd(): SemanticExpr {
    let left = this.parseEquality();
    while (this.eatOp('&&')) {
      const right = this.parseEquality();
      left = {
        kind: 'BinaryExpr',
        op: '&&',
        left,
        right,
        span: this.mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  private parseEquality(): SemanticExpr {
    let left = this.parseComparison();
    while (this.checkOp('==') || this.checkOp('!=')) {
      const op = this.next().value as BinaryOp;
      const right = this.parseComparison();
      left = {
        kind: 'BinaryExpr',
        op,
        left,
        right,
        span: this.mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  private parseComparison(): SemanticExpr {
    let left = this.parseAdditive();
    while (this.checkOp('<') || this.checkOp('<=') || this.checkOp('>') || this.checkOp('>=')) {
      const op = this.next().value as BinaryOp;
      const right = this.parseAdditive();
      left = {
        kind: 'BinaryExpr',
        op,
        left,
        right,
        span: this.mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  private parseAdditive(): SemanticExpr {
    let left = this.parseMultiplicative();
    while (this.checkOp('+') || this.checkOp('-')) {
      const op = this.next().value as BinaryOp;
      const right = this.parseMultiplicative();
      left = {
        kind: 'BinaryExpr',
        op,
        left,
        right,
        span: this.mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  private parseMultiplicative(): SemanticExpr {
    let left = this.parseUnary();
    while (this.checkOp('*') || this.checkOp('/') || this.checkOp('%')) {
      const op = this.next().value as BinaryOp;
      const right = this.parseUnary();
      left = {
        kind: 'BinaryExpr',
        op,
        left,
        right,
        span: this.mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  private parseUnary(): SemanticExpr {
    const start = this.peek();
    if (this.eatIdent('await')) {
      const operand = this.parseUnary();
      return { kind: 'AwaitExpr', operand, span: this.makeSpan(start, this.prev()) };
    }
    if (this.checkOp('-') || this.checkOp('!')) {
      const op = this.next().value as '-' | '!';
      const operand = this.parseUnary();
      return { kind: 'UnaryExpr', op, operand, span: this.makeSpan(start, this.prev()) };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): SemanticExpr {
    let expr = this.parsePrimary();
    while (true) {
      if (this.eatPunct('[')) {
        const index = this.parseExpr();
        const end = this.expectPunct(']');
        expr = {
          kind: 'IndexAccessExpr',
          object: expr,
          index,
          span: this.mergeSpan(expr.span, this.makeSpan(end, end)),
        };
      } else if (this.eatPunct('.')) {
        const fieldTok = this.expectIdent();
        if (this.eatPunct('(')) {
          const args = this.parseArgList();
          const end = this.expectPunct(')');
          if (expr.kind === 'Identifier') {
            expr = {
              kind: 'CallExpr',
              callee: `${expr.name}.${fieldTok.value}`,
              typeArgs: [],
              args,
              span: this.mergeSpan(expr.span, this.makeSpan(end, end)),
            };
          } else {
            expr = {
              kind: 'CallExpr',
              callee: fieldTok.value,
              typeArgs: [],
              args: [expr, ...args],
              span: this.mergeSpan(expr.span, this.makeSpan(end, end)),
            };
          }
        } else {
          expr = {
            kind: 'FieldAccessExpr',
            object: expr,
            field: fieldTok.value,
            span: this.mergeSpan(expr.span, this.makeSpan(fieldTok, fieldTok)),
          };
        }
      } else if (this.eatOp('?')) {
        expr = {
          kind: 'TryPropagateExpr',
          operand: expr,
          span: this.mergeSpan(expr.span, this.makeSpan(this.prev(), this.prev())),
        };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): SemanticExpr {
    const tok = this.peek();

    if (tok.kind === 'int') {
      this.next();
      return {
        kind: 'IntLiteral',
        value: BigInt(tok.value),
        raw: tok.value,
        span: this.makeSpan(tok, tok),
      };
    }

    if (tok.kind === 'float') {
      this.next();
      return {
        kind: 'FloatLiteral',
        value: Number(tok.value),
        raw: tok.value,
        span: this.makeSpan(tok, tok),
      };
    }

    if (tok.kind === 'string') {
      this.next();
      return {
        kind: 'StringLiteral',
        value: tok.value,
        span: this.makeSpan(tok, tok),
      };
    }

    if (this.eatIdent('true')) {
      return { kind: 'BoolLiteral', value: true, span: this.makeSpan(tok, tok) };
    }
    if (this.eatIdent('false')) {
      return { kind: 'BoolLiteral', value: false, span: this.makeSpan(tok, tok) };
    }

    // Parenthesized expression
    if (this.eatPunct('(')) {
      const inner = this.parseExpr();
      this.expectPunct(')');
      return inner;
    }

    // Array literal [a, b, c]
    if (this.eatPunct('[')) {
      const prevAllow = this.allowStructLit;
      this.allowStructLit = true;
      const elements: SemanticExpr[] = [];
      while (!this.checkPunct(']') && !this.isEof()) {
        elements.push(this.parseExpr());
        if (!this.eatPunct(',')) break;
      }
      this.allowStructLit = prevAllow;
      const end = this.expectPunct(']');
      return { kind: 'ArrayLiteral', elements, span: this.makeSpan(tok, end) };
    }

    // Map literal {"k": v}
    if (this.eatPunct('{')) {
      const entries: Array<{ key: SemanticExpr; value: SemanticExpr }> = [];
      while (!this.checkPunct('}') && !this.isEof()) {
        const key = this.parseExpr();
        this.expectPunct(':');
        const value = this.parseExpr();
        entries.push({ key, value });
        if (!this.eatPunct(',')) break;
      }
      const end = this.expectPunct('}');
      return { kind: 'MapLiteral', entries, span: this.makeSpan(tok, end) };
    }

    if (tok.kind === 'ident') {
      this.next();
      let path = tok.value;

      // Namespace or Enum `Foo::Bar` / `std::math::abs`
      while (this.eatOp('::')) {
        const seg = this.expectIdent();
        path += `::${seg.value}`;
      }

      // Check EnumConstructExpr: `EnumName::Variant(...)` or `EnumName::Variant`
      if (path.includes('::')) {
        const parts = path.split('::');
        if (
          parts.length === 2 &&
          parts[0][0] >= 'A' &&
          parts[0][0] <= 'Z' &&
          parts[0] !== 'Std'
        ) {
          const args: SemanticExpr[] = [];
          if (this.eatPunct('(')) {
            const prevAllow = this.allowStructLit;
            this.allowStructLit = true;
            args.push(...this.parseArgList());
            this.allowStructLit = prevAllow;
            this.expectPunct(')');
          }
          return {
            kind: 'EnumConstructExpr',
            enumName: parts[0],
            variantName: parts[1],
            args,
            span: this.makeSpan(tok, this.prev()),
          };
        }
      }

      // Function call `foo(a, b)` or `foo::<i64>(a, b)`
      if (this.eatPunct('(')) {
        const prevAllow = this.allowStructLit;
        this.allowStructLit = true;
        const args = this.parseArgList();
        this.allowStructLit = prevAllow;
        const end = this.expectPunct(')');
        return {
          kind: 'CallExpr',
          callee: path,
          typeArgs: [],
          args,
          span: this.makeSpan(tok, end),
        };
      }

      // Struct literal `Point { x: 1, y: 2 }` when identifier starts with uppercase
      if (
        this.allowStructLit &&
        !path.includes('::') &&
        path[0] >= 'A' &&
        path[0] <= 'Z' &&
        this.checkPunct('{')
      ) {
        this.expectPunct('{');
        const fields: Array<{ name: string; value: SemanticExpr; span: SourceSpan }> = [];
        while (!this.checkPunct('}') && !this.isEof()) {
          const fTok = this.expectIdent();
          this.expectPunct(':');
          const val = this.parseExpr();
          fields.push({
            name: fTok.value,
            value: val,
            span: this.makeSpan(fTok, this.prev()),
          });
          if (!this.eatPunct(',')) break;
        }
        const end = this.expectPunct('}');
        return {
          kind: 'StructLiteral',
          structName: path,
          typeArgs: [],
          fields,
          span: this.makeSpan(tok, end),
        };
      }

      return { kind: 'Identifier', name: path, span: this.makeSpan(tok, this.prev()) };
    }

    throw new ManifestError(
      `Unexpected token '${tok.value || tok.kind}' in expression`,
      tok.line,
      tok.col,
      'parser'
    );
  }

  private parseArgList(): SemanticExpr[] {
    const args: SemanticExpr[] = [];
    while (!this.checkPunct(')') && !this.isEof()) {
      args.push(this.parseExpr());
      if (!this.eatPunct(',')) break;
    }
    return args;
  }

  private parseDottedIdent(): string {
    let name = this.expectIdent().value;
    while (this.eatPunct('.')) {
      name += `.${this.expectIdent().value}`;
    }
    return name;
  }

  private peek(): PToken {
    return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
  }

  private prev(): PToken {
    return this.tokens[Math.max(0, this.pos - 1)];
  }

  private next(): PToken {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private isEof(): boolean {
    return this.peek().kind === 'eof';
  }

  private checkIdent(val: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.value === val;
  }

  private eatIdent(val: string): boolean {
    if (this.checkIdent(val)) {
      this.next();
      return true;
    }
    return false;
  }

  private expectIdent(): PToken {
    const t = this.peek();
    if (t.kind !== 'ident') {
      throw new ManifestError(
        `Expected identifier, found '${t.value || t.kind}'`,
        t.line,
        t.col,
        'parser'
      );
    }
    return this.next();
  }

  private expectIdentVal(val: string): PToken {
    const t = this.peek();
    if (t.kind !== 'ident' || t.value !== val) {
      throw new ManifestError(
        `Expected '${val}', found '${t.value || t.kind}'`,
        t.line,
        t.col,
        'parser'
      );
    }
    return this.next();
  }

  private expectKind(kind: PToken['kind'], desc: string): PToken {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ManifestError(
        `Expected ${desc}, found '${t.value || t.kind}'`,
        t.line,
        t.col,
        'parser'
      );
    }
    return this.next();
  }

  private checkPunct(val: string): boolean {
    const t = this.peek();
    return t.kind === 'punct' && t.value === val;
  }

  private eatPunct(val: string): PToken | null {
    if (this.checkPunct(val)) return this.next();
    return null;
  }

  private expectPunct(val: string): PToken {
    const t = this.peek();
    if (!this.checkPunct(val)) {
      throw new ManifestError(
        `Expected '${val}', found '${t.value || t.kind}'`,
        t.line,
        t.col,
        'parser'
      );
    }
    return this.next();
  }

  private checkOp(val: string): boolean {
    const t = this.peek();
    return t.kind === 'op' && t.value === val;
  }

  private eatOp(val: string): PToken | null {
    if (this.checkOp(val)) return this.next();
    return null;
  }

  private expectOp(val: string): PToken {
    const t = this.peek();
    if (!this.checkOp(val)) {
      throw new ManifestError(
        `Expected '${val}', found '${t.value || t.kind}'`,
        t.line,
        t.col,
        'parser'
      );
    }
    return this.next();
  }

  private makeSpan(start: PToken, end: PToken): SourceSpan {
    return {
      line: start.line,
      column: start.col,
      endLine: end.line,
      endColumn: end.col + (end.value?.length || 1),
      file: this.file,
    };
  }

  private mergeSpan(a: SourceSpan, b: SourceSpan): SourceSpan {
    return {
      line: a.line,
      column: a.column,
      endLine: b.endLine,
      endColumn: b.endColumn,
      file: a.file || b.file,
    };
  }
}

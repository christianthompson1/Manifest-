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

interface BToken {
  kind: 'ident' | 'int' | 'float' | 'string' | 'punct' | 'op' | 'newline' | 'eof';
  value: string;
  upper: string;
  line: number;
  col: number;
}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||', '->', '=>', '::']);
const SINGLE_OPS = new Set(['+', '-', '*', '/', '%', '<', '>', '!', '=', '?']);
const PUNCTS = new Set(['{', '}', '(', ')', '[', ']', ';', ',', ':', '.']);

function tokenizeBeginner(source: string): BToken[] {
  const tokens: BToken[] = [];
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

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance(1);
      continue;
    }

    if (ch === '\n') {
      tokens.push({ kind: 'newline', value: '\n', upper: '\n', line, col });
      advance(1);
      continue;
    }

    // Comments: -- , // , # (when not hex color), NOTE:
    if (
      (ch === '-' && source[i + 1] === '-') ||
      (ch === '/' && source[i + 1] === '/') ||
      ch === '#' ||
      /^NOTE:/i.test(source.slice(i, i + 5))
    ) {
      while (i < source.length && source[i] !== '\n') advance(1);
      continue;
    }

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
      tokens.push({ kind: 'string', value: str, upper: str, line: startLine, col: startCol });
      continue;
    }

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
        upper: num,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: 'op', value: two, upper: two, line, col });
      advance(2);
      continue;
    }

    if (SINGLE_OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch, upper: ch, line, col });
      advance(1);
      continue;
    }

    if (PUNCTS.has(ch)) {
      tokens.push({ kind: 'punct', value: ch, upper: ch, line, col });
      advance(1);
      continue;
    }

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
      tokens.push({
        kind: 'ident',
        value: id,
        upper: id.toUpperCase(),
        line: startLine,
        col: startCol,
      });
      continue;
    }

    throw new ManifestError(`Unexpected character '${ch}'`, line, col, 'lexer');
  }

  tokens.push({ kind: 'eof', value: '', upper: '', line, col });
  return tokens;
}

export class BeginnerParser {
  private tokens: BToken[];
  private pos = 0;
  private file?: string;
  private isLegacyApp = false;
  private hasWebUI = false;
  private hasSolanaContract = false;

  constructor(source: string, file?: string) {
    this.tokens = tokenizeBeginner(source);
    this.file = file;
  }

  public parseModule(): SemanticModule {
    this.skipNewlines();
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

    if (this.checkKw('PROFILE')) {
      this.next();
      this.expectIdent();
      this.skipNewlines();
    }

    if (this.checkKw('MODULE')) {
      this.next();
      moduleName = this.parseDottedIdent();
      this.skipNewlines();
    } else if (this.checkKw('APP')) {
      this.next();
      this.isLegacyApp = true;
      const nameTok = this.expectKind('string', 'application name string');
      moduleName = nameTok.value.replace(/[^a-zA-Z0-9_]/g, '_') || 'app';
      this.skipNewlines();
    }

    while (!this.isEof()) {
      this.skipNewlines();
      if (this.isEof()) break;

      if (this.checkKw('IMPORT')) {
        imports.push(this.parseImport());
        continue;
      }

      if (this.checkKw('USE')) {
        this.parseLegacyUse(capabilities);
        continue;
      }

      if (this.checkKw('REQUIRES') || this.checkKw('PROVIDES') || this.checkKw('DENIES')) {
        this.parseCapabilityDecl(capabilities);
        continue;
      }

      // Legacy / domain-specific blocks (`PAGE`, `COMPONENT`, `STYLE`, `ROUTE`, `SERVER`, `PROGRAM`, `CSS`, `JS`, `RUST`)
      if (
        this.checkKw('PAGE') ||
        this.checkKw('COMPONENT') ||
        this.checkKw('STYLE') ||
        this.checkKw('CSS') ||
        this.checkKw('JS')
      ) {
        this.hasWebUI = true;
        this.isLegacyApp = true;
        this.skipBalancedEndBlock();
        continue;
      }
      if (this.checkKw('ROUTE')) {
        this.hasWebUI = true;
        this.isLegacyApp = true;
        this.skipLine();
        continue;
      }
      if (this.checkKw('PROGRAM') || this.checkKw('RUST')) {
        this.hasSolanaContract = true;
        this.isLegacyApp = true;
        this.skipBalancedEndBlock();
        continue;
      }
      if (this.checkKw('SERVER')) {
        this.isLegacyApp = true;
        this.skipBalancedEndBlock();
        continue;
      }

      if (this.checkKw('WHEN')) {
        this.next();
        const ev = this.parseDottedIdent();
        this.skipNewlines();
        const body = this.parseBlockUntilEnd();
        this.expectKw('END');
        if (ev === 'app.starts') {
          topLevelStmts.push(...body);
        } else {
          this.hasWebUI = true;
        }
        continue;
      }

      const isExport = this.eatKw('EXPORT');

      if (this.checkKw('STRUCT')) {
        structs.push(this.parseStruct(isExport));
        continue;
      }
      if (this.checkKw('ENUM')) {
        enums.push(this.parseEnum(isExport));
        continue;
      }
      if (this.checkKw('TRAIT')) {
        traits.push(this.parseTrait(isExport));
        continue;
      }
      if (this.checkKw('CONSTANT') || this.checkKw('CONST')) {
        constants.push(this.parseConstDecl(isExport));
        continue;
      }
      if (
        this.checkKw('ASYNC') ||
        this.checkKw('FUNCTION') ||
        this.checkKw('ACTION') ||
        this.checkKw('DEFINE')
      ) {
        functions.push(this.parseFnDecl(isExport));
        continue;
      }
      if (this.checkKw('LET') || this.checkKw('MUTABLE') || this.checkKw('STATE')) {
        const v = this.parseVarDecl(isExport);
        globals.push(v);
        topLevelStmts.push({ kind: 'VarStmt', decl: v, span: v.span });
        continue;
      }

      topLevelStmts.push(this.parseStmt(globals));
    }

    const last = this.peek();
    return {
      kind: 'SemanticModule',
      profile: 'beginner',
      moduleName,
      isLegacyApp: this.isLegacyApp,
      hasDomainExtensions: {
        webUI: this.hasWebUI,
        solanaContract: this.hasSolanaContract,
      },
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

  private parseLegacyUse(capabilities: CapabilitySummaryDecl): void {
    const start = this.expectKw('USE');
    if (this.eatKw('LIBRARY')) {
      const libTok = this.expectKind('string', 'library name');
      capabilities.requires.push({ name: `lib.${libTok.value}`, span: this.makeSpan(start, libTok) });
      this.skipNewlines();
      return;
    }
    const targetTok = this.expectIdent();
    const upper = targetTok.upper;
    if (upper === 'WEB') {
      this.hasWebUI = true;
      capabilities.requires.push({ name: 'ui', span: this.makeSpan(start, targetTok) });
    } else if (upper === 'SOLANA') {
      this.hasSolanaContract = true;
      capabilities.requires.push({ name: 'chain', span: this.makeSpan(start, targetTok) });
    } else {
      capabilities.requires.push({
        name: targetTok.value.toLowerCase(),
        span: this.makeSpan(start, targetTok),
      });
    }
    this.skipNewlines();
  }

  private parseImport(): ImportDecl {
    const start = this.expectKw('IMPORT');
    const symbols: Array<{ name: string; alias?: string }> = [];
    const hasBrace = this.eatPunct('{');
    while (!this.isEof() && !this.checkKw('FROM') && !this.checkPunct('}')) {
      const name = this.expectIdent().value;
      let alias: string | undefined;
      if (this.eatKw('AS')) {
        alias = this.expectIdent().value;
      }
      symbols.push({ name, alias });
      if (!this.eatPunct(',')) break;
    }
    if (hasBrace) this.expectPunct('}');
    this.expectKw('FROM');
    const fromTok = this.expectKind('string', 'module path string');
    this.eatPunct(';');
    this.skipNewlines();
    return { from: fromTok.value, symbols, span: this.makeSpan(start, fromTok) };
  }

  private parseCapabilityDecl(target: CapabilitySummaryDecl): void {
    const kw = this.next();
    const bucket =
      kw.upper === 'REQUIRES'
        ? target.requires
        : kw.upper === 'PROVIDES'
          ? target.provides
          : target.denies;

    const hasBracket = this.eatPunct('[');
    while (!this.isEof() && !this.isNewline()) {
      if (hasBracket && this.checkPunct(']')) break;
      const first = this.expectIdent();
      let name = first.value;
      let end = first;
      while (this.eatPunct('.')) {
        const seg = this.expectIdent();
        name += `.${seg.value}`;
        end = seg;
      }
      bucket.push({ name, span: this.makeSpan(first, end) });
      if (!this.eatPunct(',')) break;
    }
    if (hasBracket) this.expectPunct(']');
    this.eatPunct(';');
    this.skipNewlines();
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
    return { kind: 'NamedType', name: norm, typeArgs, span: this.makeSpan(start, endTok) };
  }

  private parseStruct(exported: boolean): StructDecl {
    const start = this.expectKw('STRUCT');
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();
    this.skipNewlines();
    const fields = [];
    while (!this.checkKw('END') && !this.isEof()) {
      this.skipNewlines();
      if (this.checkKw('END')) break;
      const fTok = this.expectIdent();
      this.expectPunct(':');
      const fType = this.parseTypeNode();
      fields.push({ name: fTok.value, type: fType, span: this.makeSpan(fTok, this.prev()) });
      this.eatPunct(',');
      this.skipNewlines();
    }
    const end = this.expectKw('END');
    this.skipNewlines();
    return { name, exported, typeParams, fields, span: this.makeSpan(start, end) };
  }

  private parseEnum(exported: boolean): EnumDecl {
    const start = this.expectKw('ENUM');
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();
    this.skipNewlines();
    const variants: EnumVariantDecl[] = [];
    while (!this.checkKw('END') && !this.isEof()) {
      this.skipNewlines();
      if (this.checkKw('END')) break;
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
      this.eatPunct(',');
      this.skipNewlines();
    }
    const end = this.expectKw('END');
    this.skipNewlines();
    return { name, exported, typeParams, variants, span: this.makeSpan(start, end) };
  }

  private parseTrait(exported: boolean): TraitDecl {
    const start = this.expectKw('TRAIT');
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();
    this.skipNewlines();
    const methods: TraitMethodSig[] = [];
    while (!this.checkKw('END') && !this.isEof()) {
      this.skipNewlines();
      if (this.checkKw('END')) break;
      const fnStart = this.expectKw('FUNCTION');
      const mName = this.expectIdent().value;
      this.expectPunct('(');
      const params = this.parseParenParams();
      this.expectPunct(')');
      let returnType: TypeNode = {
        kind: 'PrimitiveType',
        name: 'void',
        span: this.makeSpan(fnStart, this.prev()),
      };
      if (this.eatOp('->') || this.eatKw('RETURNS')) {
        returnType = this.parseTypeNode();
      }
      const { effects } = this.parseEffectsClause();
      methods.push({
        name: mName,
        params,
        returnType,
        effects,
        span: this.makeSpan(fnStart, this.prev()),
      });
      this.skipNewlines();
    }
    const end = this.expectKw('END');
    this.skipNewlines();
    return { name, exported, typeParams, methods, span: this.makeSpan(start, end) };
  }

  private parseConstDecl(exported: boolean): ConstDecl {
    const start = this.next(); // CONSTANT / CONST
    const name = this.expectIdent().value;
    let typeAnnotation: TypeNode = { kind: 'InferredType', span: this.makeSpan(start, start) };
    if (this.eatPunct(':')) {
      typeAnnotation = this.parseTypeNode();
    }
    if (!this.eatOp('=')) {
      this.expectKw('TO');
    }
    const init = this.parseExpr();
    this.eatPunct(';');
    this.skipNewlines();
    return { name, exported, typeAnnotation, init, span: this.makeSpan(start, this.prev()) };
  }

  private parseVarDecl(exported: boolean): VarDecl {
    const start = this.next(); // LET | MUTABLE | STATE
    const mutable =
      start.upper === 'MUTABLE' ||
      start.upper === 'STATE' ||
      this.eatKw('MUTABLE') ||
      this.eatKw('MUT');
    const name = this.expectIdent().value;
    let typeAnnotation: TypeNode = { kind: 'InferredType', span: this.makeSpan(start, start) };
    if (this.eatPunct(':')) {
      typeAnnotation = this.parseTypeNode();
    }
    if (!this.eatOp('=')) {
      this.expectKw('TO');
    }
    const init = this.parseExpr();
    this.eatPunct(';');
    this.skipNewlines();
    return { name, mutable, exported, typeAnnotation, init, span: this.makeSpan(start, this.prev()) };
  }

  private parseFnDecl(exported: boolean): FnDecl {
    const start = this.peek();
    const isAsync = this.eatKw('ASYNC');
    const kw = this.next(); // FUNCTION | ACTION | DEFINE
    if (kw.upper === 'DEFINE') {
      this.eatKw('FUNCTION');
    }
    const isAction = kw.upper === 'ACTION';
    const name = this.expectIdent().value;
    const typeParams = this.parseTypeParams();

    let params: FnParamDecl[] = [];
    if (this.eatPunct('(')) {
      params = this.parseParenParams();
      this.expectPunct(')');
    } else if (isAction) {
      // Legacy ACTION space-separated parameters: `ACTION add a b`
      while (
        !this.isNewline() &&
        !this.isEof() &&
        !this.checkOp('->') &&
        !this.checkKw('RETURNS') &&
        !this.checkKw('EFFECTS')
      ) {
        const pTok = this.expectIdent();
        let pType: TypeNode = { kind: 'PrimitiveType', name: 'any', span: this.makeSpan(pTok, pTok) };
        if (this.eatPunct(':')) {
          pType = this.parseTypeNode();
        }
        params.push({ name: pTok.value, type: pType, span: this.makeSpan(pTok, this.prev()) });
      }
    }

    let returnType: TypeNode = {
      kind: 'PrimitiveType',
      name: isAction && this.isLegacyApp ? 'any' : 'void',
      span: this.makeSpan(start, this.prev()),
    };
    if (this.eatOp('->') || this.eatKw('RETURNS')) {
      returnType = this.parseTypeNode();
    }

    const { effects, hasExplicit } = this.parseEffectsClause();
    this.skipNewlines();
    const body = this.parseBlockUntilEnd();
    const end = this.expectKw('END');
    this.skipNewlines();

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
      span: this.makeSpan(start, end),
    };
  }

  private parseParenParams(): FnParamDecl[] {
    const params: FnParamDecl[] = [];
    while (!this.checkPunct(')') && !this.isEof()) {
      const pTok = this.expectIdent();
      let pType: TypeNode = { kind: 'PrimitiveType', name: 'any', span: this.makeSpan(pTok, pTok) };
      if (this.eatPunct(':')) {
        pType = this.parseTypeNode();
      }
      params.push({ name: pTok.value, type: pType, span: this.makeSpan(pTok, this.prev()) });
      if (!this.eatPunct(',')) break;
    }
    return params;
  }

  private parseEffectsClause(): { effects: string[]; hasExplicit: boolean } {
    if (this.eatKw('PURE')) {
      return { effects: [], hasExplicit: true };
    }
    if (!this.eatKw('EFFECTS')) {
      return { effects: [], hasExplicit: false };
    }
    const effects: string[] = [];
    const hasParen = this.eatPunct('(');
    const hasBracket = !hasParen && this.eatPunct('[');
    while (!this.isEof() && !this.isNewline()) {
      if ((hasParen && this.checkPunct(')')) || (hasBracket && this.checkPunct(']'))) break;
      const first = this.expectIdent();
      let eff = first.value;
      while (this.eatPunct('.')) {
        eff += `.${this.expectIdent().value}`;
      }
      if (eff.toLowerCase() !== 'pure' && eff.toLowerCase() !== 'none') {
        effects.push(eff);
      }
      if (!this.eatPunct(',')) break;
    }
    if (hasParen) this.expectPunct(')');
    if (hasBracket) this.expectPunct(']');
    return { effects, hasExplicit: true };
  }

  private parseBlockUntilEnd(extraTerminators: string[] = []): SemanticStmt[] {
    const stmts: SemanticStmt[] = [];
    const stops = new Set(['END', ...extraTerminators]);
    while (!this.isEof()) {
      this.skipNewlines();
      if (this.isEof()) break;
      if (this.peek().kind === 'ident' && stops.has(this.peek().upper)) {
        break;
      }
      stmts.push(this.parseStmt());
    }
    return stmts;
  }

  private parseStmt(topLevelGlobals?: VarDecl[]): SemanticStmt {
    this.skipNewlines();
    const start = this.peek();

    if (this.checkKw('LET') || this.checkKw('MUTABLE')) {
      const decl = this.parseVarDecl(false);
      return { kind: 'VarStmt', decl, span: decl.span };
    }
    if (this.checkKw('CONSTANT') || this.checkKw('CONST')) {
      const decl = this.parseConstDecl(false);
      return { kind: 'ConstStmt', decl, span: decl.span };
    }

    // `SET target TO value` or `SET target = value`
    if (this.eatKw('SET')) {
      const targetExpr = this.parsePostfix();
      if (!this.eatKw('TO')) {
        this.expectOp('=');
      }
      const value = this.parseExpr();
      this.eatPunct(';');
      this.skipNewlines();

      // In legacy APP top-level scripts, `SET x TO 1` initializes `x` if not yet declared
      if (
        this.isLegacyApp &&
        topLevelGlobals &&
        targetExpr.kind === 'Identifier' &&
        !topLevelGlobals.some((g) => g.name === targetExpr.name)
      ) {
        const decl: VarDecl = {
          name: targetExpr.name,
          mutable: true,
          exported: false,
          typeAnnotation: { kind: 'InferredType', span: targetExpr.span },
          init: value,
          span: this.makeSpan(start, this.prev()),
        };
        topLevelGlobals.push(decl);
        return { kind: 'VarStmt', decl, span: decl.span };
      }

      const target = this.exprToAssignTarget(targetExpr);
      return {
        kind: 'AssignStmt',
        target,
        value,
        span: this.makeSpan(start, this.prev()),
      };
    }

    // `SHOW expr` -> normalized to canonical `print(expr)` CallExpr!
    if (this.eatKw('SHOW')) {
      const arg = this.parseExpr();
      this.eatPunct(';');
      this.skipNewlines();
      const span = this.makeSpan(start, this.prev());
      return {
        kind: 'ExprStmt',
        expr: {
          kind: 'CallExpr',
          callee: 'print',
          typeArgs: [],
          args: [arg],
          span,
        },
        span,
      };
    }

    // `CALL fnName arg1 arg2` or `CALL fnName(arg1, arg2)`
    if (this.eatKw('CALL')) {
      const callee = this.parseDottedIdent();
      const args: SemanticExpr[] = [];
      if (this.eatPunct('(')) {
        while (!this.checkPunct(')') && !this.isEof()) {
          args.push(this.parseExpr());
          if (!this.eatPunct(',')) break;
        }
        this.expectPunct(')');
      } else {
        while (!this.isNewline() && !this.isEof() && !this.checkKw('END')) {
          args.push(this.parseExpr());
          this.eatPunct(',');
        }
      }
      this.skipNewlines();
      const span = this.makeSpan(start, this.prev());
      return {
        kind: 'ExprStmt',
        expr: { kind: 'CallExpr', callee, typeArgs: [], args, span },
        span,
      };
    }

    if (this.eatKw('IF')) {
      const condition = this.parseExpr();
      this.eatKw('THEN');
      this.skipNewlines();
      const thenBranch = this.parseBlockUntilEnd(['ELSE']);
      let elseBranch: SemanticStmt[] = [];
      if (this.eatKw('ELSE')) {
        if (this.checkKw('IF')) {
          elseBranch = [this.parseStmt()];
          return {
            kind: 'IfStmt',
            condition,
            thenBranch,
            elseBranch,
            span: this.makeSpan(start, this.prev()),
          };
        }
        this.skipNewlines();
        elseBranch = this.parseBlockUntilEnd();
      }
      const end = this.expectKw('END');
      this.skipNewlines();
      return {
        kind: 'IfStmt',
        condition,
        thenBranch,
        elseBranch,
        span: this.makeSpan(start, end),
      };
    }

    if (this.eatKw('WHILE')) {
      const condition = this.parseExpr();
      this.skipNewlines();
      const body = this.parseBlockUntilEnd();
      const end = this.expectKw('END');
      this.skipNewlines();
      return { kind: 'WhileStmt', condition, body, span: this.makeSpan(start, end) };
    }

    if (this.eatKw('FOR')) {
      this.eatKw('EACH');
      const itemName = this.expectIdent().value;
      this.expectKw('IN');
      const iterable = this.parseExpr();
      this.skipNewlines();
      const body = this.parseBlockUntilEnd();
      const end = this.expectKw('END');
      this.skipNewlines();
      return {
        kind: 'ForInStmt',
        itemName,
        iterable,
        body,
        span: this.makeSpan(start, end),
      };
    }

    if (this.eatKw('REPEAT')) {
      const count = this.parseExpr();
      this.eatKw('TIMES');
      this.skipNewlines();
      const body = this.parseBlockUntilEnd();
      const end = this.expectKw('END');
      this.skipNewlines();
      return { kind: 'RepeatStmt', count, body, span: this.makeSpan(start, end) };
    }

    if (this.eatKw('BREAK')) {
      this.eatPunct(';');
      this.skipNewlines();
      return { kind: 'BreakStmt', span: this.makeSpan(start, start) };
    }

    if (this.eatKw('CONTINUE')) {
      this.eatPunct(';');
      this.skipNewlines();
      return { kind: 'ContinueStmt', span: this.makeSpan(start, start) };
    }

    if (this.eatKw('RETURN')) {
      if (this.isNewline() || this.checkKw('END') || this.isEof()) {
        this.skipNewlines();
        return { kind: 'ReturnStmt', span: this.makeSpan(start, start) };
      }
      const value = this.parseExpr();
      this.eatPunct(';');
      this.skipNewlines();
      return { kind: 'ReturnStmt', value, span: this.makeSpan(start, this.prev()) };
    }

    if (this.eatKw('MATCH')) {
      const subject = this.parseExpr();
      this.skipNewlines();
      const arms: MatchArm[] = [];
      while (!this.checkKw('END') && !this.isEof()) {
        this.skipNewlines();
        if (this.checkKw('END')) break;
        const armStart = this.peek();
        if (this.eatKw('ELSE')) {
          this.skipNewlines();
          const body = this.parseBlockUntilEnd(['WHEN', 'ELSE']);
          arms.push({
            pattern: { kind: 'WildcardPattern', span: this.makeSpan(armStart, armStart) },
            body,
            span: this.makeSpan(armStart, this.prev()),
          });
          continue;
        }
        this.expectKw('WHEN');
        const pattern = this.parseMatchPattern();
        this.eatOp('=>');
        this.skipNewlines();
        const body = this.parseBlockUntilEnd(['WHEN', 'ELSE']);
        arms.push({ pattern, body, span: this.makeSpan(armStart, this.prev()) });
      }
      const end = this.expectKw('END');
      this.skipNewlines();
      return { kind: 'MatchStmt', subject, arms, span: this.makeSpan(start, end) };
    }

    if (this.eatKw('TRY')) {
      this.skipNewlines();
      const tryBody: SemanticStmt[] = [];
      while (!this.isEof()) {
        this.skipNewlines();
        if (this.checkKw('END') || this.checkKw('CATCH')) break;
        if (this.checkKw('IF') && this.peekAt(1).upper === 'FAILED') break;
        tryBody.push(this.parseStmt());
      }
      let errBinding: string | undefined;
      let catchBody: SemanticStmt[] = [];
      if (this.checkKw('IF') && this.peekAt(1).upper === 'FAILED') {
        this.next();
        this.next();
        this.skipNewlines();
        catchBody = this.parseBlockUntilEnd();
      } else if (this.eatKw('CATCH')) {
        if (this.peek().kind === 'ident' && !this.isNewline()) {
          errBinding = this.expectIdent().value;
        }
        this.skipNewlines();
        catchBody = this.parseBlockUntilEnd();
      }
      const end = this.expectKw('END');
      this.skipNewlines();
      return {
        kind: 'TryStmt',
        tryBody,
        errBinding,
        catchBody,
        span: this.makeSpan(start, end),
      };
    }

    const expr = this.parseExpr();
    if (this.eatOp('=')) {
      const target = this.exprToAssignTarget(expr);
      const value = this.parseExpr();
      this.eatPunct(';');
      this.skipNewlines();
      return { kind: 'AssignStmt', target, value, span: this.makeSpan(start, this.prev()) };
    }
    this.eatPunct(';');
    this.skipNewlines();
    return { kind: 'ExprStmt', expr, span: this.makeSpan(start, this.prev()) };
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
    if (this.eatKw('TRUE')) {
      return { kind: 'LiteralPattern', value: true, span: this.makeSpan(start, start) };
    }
    if (this.eatKw('FALSE')) {
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
      'Invalid SET/assignment target (expected variable, struct field, or index)',
      expr.span.line,
      expr.span.column,
      'parser'
    );
  }

  private parseExpr(): SemanticExpr {
    return this.parseOr();
  }

  private parseOr(): SemanticExpr {
    let left = this.parseAnd();
    while (this.eatOp('||') || this.eatKw('OR')) {
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
    while (this.eatOp('&&') || this.eatKw('AND')) {
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
    if (this.eatKw('AWAIT')) {
      const operand = this.parseUnary();
      return { kind: 'AwaitExpr', operand, span: this.makeSpan(start, this.prev()) };
    }
    if (this.eatOp('-') || this.eatOp('!') || this.eatKw('NOT')) {
      const op = start.value === '-' ? '-' : '!';
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
      return { kind: 'IntLiteral', value: BigInt(tok.value), raw: tok.value, span: this.makeSpan(tok, tok) };
    }
    if (tok.kind === 'float') {
      this.next();
      return { kind: 'FloatLiteral', value: Number(tok.value), raw: tok.value, span: this.makeSpan(tok, tok) };
    }
    if (tok.kind === 'string') {
      this.next();
      return { kind: 'StringLiteral', value: tok.value, span: this.makeSpan(tok, tok) };
    }
    if (this.eatKw('TRUE')) {
      return { kind: 'BoolLiteral', value: true, span: this.makeSpan(tok, tok) };
    }
    if (this.eatKw('FALSE')) {
      return { kind: 'BoolLiteral', value: false, span: this.makeSpan(tok, tok) };
    }

    if (this.eatPunct('(')) {
      const inner = this.parseExpr();
      this.expectPunct(')');
      return inner;
    }

    if (this.eatPunct('[')) {
      this.skipNewlines();
      const elements: SemanticExpr[] = [];
      while (!this.checkPunct(']') && !this.isEof()) {
        elements.push(this.parseExpr());
        this.skipNewlines();
        if (!this.eatPunct(',')) break;
        this.skipNewlines();
      }
      const end = this.expectPunct(']');
      return { kind: 'ArrayLiteral', elements, span: this.makeSpan(tok, end) };
    }

    if (this.eatPunct('{')) {
      this.skipNewlines();
      const entries: Array<{ key: SemanticExpr; value: SemanticExpr }> = [];
      while (!this.checkPunct('}') && !this.isEof()) {
        const key = this.parseExpr();
        this.expectPunct(':');
        const value = this.parseExpr();
        entries.push({ key, value });
        this.skipNewlines();
        if (!this.eatPunct(',')) break;
        this.skipNewlines();
      }
      const end = this.expectPunct('}');
      return { kind: 'MapLiteral', entries, span: this.makeSpan(tok, end) };
    }

    // `NEW Point(x: 1, y: 2)` or `NEW Point { x: 1, y: 2 }`
    if (this.eatKw('NEW')) {
      const structTok = this.expectIdent();
      const openParen = this.eatPunct('(');
      if (!openParen) this.expectPunct('{');
      const closeSym = openParen ? ')' : '}';
      const fields: Array<{ name: string; value: SemanticExpr; span: SourceSpan }> = [];
      while (!this.checkPunct(closeSym) && !this.isEof()) {
        this.skipNewlines();
        if (this.checkPunct(closeSym)) break;
        const fTok = this.expectIdent();
        if (!this.eatPunct(':')) this.expectOp('=');
        const val = this.parseExpr();
        fields.push({ name: fTok.value, value: val, span: this.makeSpan(fTok, this.prev()) });
        if (!this.eatPunct(',')) break;
      }
      const end = this.expectPunct(closeSym);
      return {
        kind: 'StructLiteral',
        structName: structTok.value,
        typeArgs: [],
        fields,
        span: this.makeSpan(tok, end),
      };
    }

    // `CALL fn arg1 arg2` inside expressions
    if (this.eatKw('CALL')) {
      const callee = this.parseDottedIdent();
      const args: SemanticExpr[] = [];
      if (this.eatPunct('(')) {
        args.push(...this.parseArgList());
        this.expectPunct(')');
      } else {
        while (!this.isNewline() && !this.isEof() && !this.checkPunct(')') && !this.checkPunct(',')) {
          args.push(this.parsePrimary());
        }
      }
      return {
        kind: 'CallExpr',
        callee,
        typeArgs: [],
        args,
        span: this.makeSpan(tok, this.prev()),
      };
    }

    if (tok.kind === 'ident') {
      this.next();
      let path = tok.value;
      while (this.eatOp('::')) {
        path += `::${this.expectIdent().value}`;
      }

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
            args.push(...this.parseArgList());
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

      if (this.eatPunct('(')) {
        const args = this.parseArgList();
        const end = this.expectPunct(')');
        return { kind: 'CallExpr', callee: path, typeArgs: [], args, span: this.makeSpan(tok, end) };
      }

      if (!path.includes('::') && path[0] >= 'A' && path[0] <= 'Z' && this.checkPunct('{')) {
        this.expectPunct('{');
        const fields: Array<{ name: string; value: SemanticExpr; span: SourceSpan }> = [];
        while (!this.checkPunct('}') && !this.isEof()) {
          this.skipNewlines();
          if (this.checkPunct('}')) break;
          const fTok = this.expectIdent();
          this.expectPunct(':');
          const val = this.parseExpr();
          fields.push({ name: fTok.value, value: val, span: this.makeSpan(fTok, this.prev()) });
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

  private skipBalancedEndBlock(): void {
    const blockOpeners = new Set([
      'PAGE',
      'COMPONENT',
      'CONTAINER',
      'CARD',
      'NAV',
      'HEADER',
      'FOOTER',
      'MODAL',
      'STYLE',
      'BUTTON',
      'FORM',
      'LIST',
      'TABLE',
      'DIALOG',
      'TABS',
      'MENU',
      'SIDEBAR',
      'ANIMATE',
      'PROGRAM',
      'ACCOUNT',
      'INSTRUCTION',
      'SERVER',
      'ENDPOINT',
      'IF',
      'WHILE',
      'FOR',
      'REPEAT',
      'TRY',
      'WHEN',
      'ACTION',
      'FUNCTION',
      'CSS',
      'JS',
      'RUST',
    ]);
    let depth = 1;
    this.next(); // consume outer opener
    while (!this.isEof() && depth > 0) {
      // Only treat block openers at start of logical statement or nested block
      const prevWasLineStart =
        this.pos === 0 || this.tokens[this.pos - 1]?.kind === 'newline';
      const tok = this.next();
      if (tok.kind === 'ident') {
        if (tok.upper === 'END') {
          depth--;
        } else if (prevWasLineStart && blockOpeners.has(tok.upper)) {
          // Check one-line BUTTON "Label" without WHEN/STYLE children? Wait: in Manifest v0.2,
          // BUTTON only opens an END block if followed by newline + WHEN/STYLE, so handle conservatively:
          if (tok.upper === 'BUTTON') {
            // Scan to end of line; only increment depth if next non-empty line starts with WHEN or STYLE
            while (!this.isNewline() && !this.isEof()) this.next();
            this.skipNewlines();
            if (this.checkKw('WHEN') || this.checkKw('STYLE')) {
              depth++;
            }
          } else if (tok.upper === 'IF' && this.peek().upper === 'FAILED') {
            // `IF FAILED` inside `TRY` does not add another END
          } else {
            depth++;
          }
        }
      }
    }
    this.skipNewlines();
  }

  private skipLine(): void {
    while (!this.isNewline() && !this.isEof()) {
      this.next();
    }
    this.skipNewlines();
  }

  private skipNewlines(): void {
    while (this.peek().kind === 'newline') {
      this.next();
    }
  }

  private isNewline(): boolean {
    return this.peek().kind === 'newline';
  }

  private peek(): BToken {
    return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
  }

  private peekAt(offset: number): BToken {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private prev(): BToken {
    return this.tokens[Math.max(0, this.pos - 1)];
  }

  private next(): BToken {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private isEof(): boolean {
    return this.peek().kind === 'eof';
  }

  private checkKw(upper: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.upper === upper;
  }

  private eatKw(upper: string): boolean {
    if (this.checkKw(upper)) {
      this.next();
      return true;
    }
    return false;
  }

  private expectKw(upper: string): BToken {
    const t = this.peek();
    if (t.kind !== 'ident' || t.upper !== upper) {
      throw new ManifestError(
        `Expected '${upper}', found '${t.value || t.kind}'`,
        t.line,
        t.col,
        'parser'
      );
    }
    return this.next();
  }

  private checkIdent(val: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.value === val;
  }

  private expectIdent(): BToken {
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

  private expectKind(kind: BToken['kind'], desc: string): BToken {
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

  private eatPunct(val: string): BToken | null {
    if (this.checkPunct(val)) return this.next();
    return null;
  }

  private expectPunct(val: string): BToken {
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

  private eatOp(val: string): BToken | null {
    if (this.checkOp(val)) return this.next();
    return null;
  }

  private expectOp(val: string): BToken {
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

  private makeSpan(start: BToken, end: BToken): SourceSpan {
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

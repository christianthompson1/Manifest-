import {
  CommentNode,
  MatchPattern,
  SemanticExpr,
  SemanticModule,
  SemanticStmt,
  SourceSpan,
  TypeNode,
} from './ast-v2.ts';
import { parseSemanticModule } from './parse-unified.ts';
import {
  needsParensForBinaryLeft,
  needsParensForBinaryRight,
  needsParensForPostfix,
  needsParensForUnary,
} from './precedence.ts';
import { ManifestError } from '../errors/manifest-error.ts';
import { SemanticDiagnostic } from '../semantics/types.ts';
import { detectSyntaxProfile, SyntaxProfile } from './profile.ts';

/**
 * Formats Manifest source code according to the Beginner or Professional syntax profile.
 * If the source uses legacy UI/Solana blocks that cannot be round-tripped purely via SemanticModule,
 * performs deterministic indentation normalization instead of losing domain blocks.
 */
export function formatSourceWithFallback(
  source: string,
  explicitProfile?: SyntaxProfile | 'auto'
): string {
  const profile = detectSyntaxProfile(source, explicitProfile);
  try {
    const mod = parseSemanticModule(source, { profile });
    if (mod.isSolanaContract) {
      return formatIndentationOnly(source, profile);
    }
    return printSemanticModule(mod, profile);
  } catch {
    return formatIndentationOnly(source, profile);
  }
}

class CommentTracker {
  private comments: CommentNode[];
  private used = new Set<number>();

  constructor(comments: CommentNode[] | undefined) {
    this.comments = [...(comments || [])].sort(
      (a, b) => a.line - b.line || a.column - b.column
    );
  }

  public consumeWindow(afterLine: number, beforeLine: number, indent: string, out: string[], pro: boolean): void {
    for (let idx = 0; idx < this.comments.length; idx++) {
      if (this.used.has(idx)) continue;
      const c = this.comments[idx];
      if (!c.trailing && c.line > afterLine && c.line < beforeLine) {
        this.used.add(idx);
        emitFormattedComment(c, indent, out, pro);
      }
    }
  }

  public consumeTrailing(onLine: number, pro: boolean): string {
    const parts: string[] = [];
    for (let idx = 0; idx < this.comments.length; idx++) {
      if (this.used.has(idx)) continue;
      const c = this.comments[idx];
      if (c.trailing && c.line === onLine) {
        this.used.add(idx);
        parts.push(formatInlineComment(c, pro));
      }
    }
    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  }

  public flushRemaining(indent: string, out: string[], pro: boolean): void {
    for (let idx = 0; idx < this.comments.length; idx++) {
      if (this.used.has(idx)) continue;
      const c = this.comments[idx];
      this.used.add(idx);
      emitFormattedComment(c, indent, out, pro);
    }
  }
}

function formatInlineComment(c: CommentNode, pro: boolean): string {
  if (c.kind === 'block') {
    return `/*${c.body}*/`;
  }
  if (pro) {
    if (c.style === '///') return `///${c.body}`;
    if (c.style === '--') return `--${c.body}`;
    return `//${c.body}`;
  }
  return `${c.style}${c.body}`;
}

function emitFormattedComment(c: CommentNode, indent: string, out: string[], pro: boolean): void {
  if (c.kind === 'block') {
    const raw = `/*${c.body}*/`;
    const blockLines = raw.split('\n');
    for (let i = 0; i < blockLines.length; i++) {
      out.push(i === 0 ? `${indent}${blockLines[i].trimEnd()}` : blockLines[i].trimEnd());
    }
    return;
  }
  out.push(`${indent}${formatInlineComment(c, pro)}`);
}

function computeTopLevelWindows(mod: SemanticModule): WeakMap<object, number> {
  const anchors: Array<{ obj: object; start: number; end: number }> = [];
  if (mod.headerSpan) {
    anchors.push({ obj: mod.headerSpan, start: mod.headerSpan.line, end: mod.headerSpan.endLine });
  }
  const { requires, provides, denies } = mod.capabilities;
  if (requires.length > 0) {
    anchors.push({ obj: requires, start: requires[0].span.line, end: requires[requires.length - 1].span.endLine });
  }
  if (provides.length > 0) {
    anchors.push({ obj: provides, start: provides[0].span.line, end: provides[provides.length - 1].span.endLine });
  }
  if (denies.length > 0) {
    anchors.push({ obj: denies, start: denies[0].span.line, end: denies[denies.length - 1].span.endLine });
  }
  for (const imp of mod.imports) anchors.push({ obj: imp, start: imp.span.line, end: imp.span.endLine });
  for (const st of mod.structs) anchors.push({ obj: st, start: st.span.line, end: st.span.endLine });
  for (const en of mod.enums) anchors.push({ obj: en, start: en.span.line, end: en.span.endLine });
  for (const tr of mod.traits || []) anchors.push({ obj: tr, start: tr.span.line, end: tr.span.endLine });
  for (const c of mod.constants) anchors.push({ obj: c, start: c.span.line, end: c.span.endLine });
  for (const fn of mod.functions) anchors.push({ obj: fn, start: fn.span.line, end: fn.span.endLine });
  for (const s of mod.topLevelStmts) anchors.push({ obj: s, start: s.span.line, end: s.span.endLine });

  anchors.sort((a, b) => a.start - b.start || a.end - b.end);
  const prevEndByNode = new WeakMap<object, number>();
  let prevEnd = 0;
  for (const a of anchors) {
    prevEndByNode.set(a.obj, prevEnd);
    prevEnd = Math.max(prevEnd, a.end);
  }
  return prevEndByNode;
}

export function printSemanticModule(mod: SemanticModule, targetProfile: SyntaxProfile): string {
  const lines: string[] = [];
  const pro = targetProfile === 'professional';
  const ct = new CommentTracker(mod.comments);
  const prevEndByNode = computeTopLevelWindows(mod);

  if (mod.headerSpan || (mod.moduleName && mod.moduleName !== 'main')) {
    const startLine = mod.headerSpan?.line ?? mod.span.line;
    const prevEnd = mod.headerSpan ? (prevEndByNode.get(mod.headerSpan) ?? 0) : 0;
    ct.consumeWindow(prevEnd, startLine, '', lines, pro);
    const trail = mod.headerSpan ? ct.consumeTrailing(mod.headerSpan.endLine, pro) : '';
    lines.push((pro ? `module ${mod.moduleName};` : `MODULE ${mod.moduleName}`) + trail);
    lines.push('');
  }

  const { requires, provides, denies } = mod.capabilities;
  if (requires.length > 0) {
    ct.consumeWindow(prevEndByNode.get(requires) ?? 0, requires[0].span.line, '', lines, pro);
    const list = requires.map((r) => r.name).join(', ');
    const trail = ct.consumeTrailing(requires[requires.length - 1].span.endLine, pro);
    lines.push((pro ? `requires [${list}];` : `REQUIRES ${list}`) + trail);
  }
  if (provides.length > 0) {
    ct.consumeWindow(prevEndByNode.get(provides) ?? 0, provides[0].span.line, '', lines, pro);
    const list = provides.map((p) => p.name).join(', ');
    const trail = ct.consumeTrailing(provides[provides.length - 1].span.endLine, pro);
    lines.push((pro ? `provides [${list}];` : `PROVIDES ${list}`) + trail);
  }
  if (denies.length > 0) {
    ct.consumeWindow(prevEndByNode.get(denies) ?? 0, denies[0].span.line, '', lines, pro);
    const list = denies.map((d) => d.name).join(', ');
    const trail = ct.consumeTrailing(denies[denies.length - 1].span.endLine, pro);
    lines.push((pro ? `denies [${list}];` : `DENIES ${list}`) + trail);
  }
  if (requires.length || provides.length || denies.length) {
    lines.push('');
  }

  for (const imp of mod.imports) {
    ct.consumeWindow(prevEndByNode.get(imp) ?? 0, imp.span.line, '', lines, pro);
    const syms = imp.symbols.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name)).join(', ');
    const trail = ct.consumeTrailing(imp.span.endLine, pro);
    lines.push((pro ? `import { ${syms} } from "${imp.from}";` : `IMPORT ${syms} FROM "${imp.from}"`) + trail);
  }
  if (mod.imports.length > 0) lines.push('');

  for (const st of mod.structs) {
    ct.consumeWindow(prevEndByNode.get(st) ?? 0, st.span.line, '', lines, pro);
    const exp = st.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const tp = st.typeParams.length > 0 ? `<${st.typeParams.join(', ')}>` : '';
    const openTrail = ct.consumeTrailing(st.span.line, pro);
    if (pro) {
      lines.push(`${exp}struct ${st.name}${tp} {${openTrail}`);
      let innerPrev = st.span.line;
      for (const f of st.fields) {
        ct.consumeWindow(innerPrev, f.span.line, '    ', lines, pro);
        const fTrail = ct.consumeTrailing(f.span.endLine, pro);
        lines.push(`    ${f.name}: ${printType(f.type, pro)},${fTrail}`);
        innerPrev = f.span.endLine;
      }
      ct.consumeWindow(innerPrev, st.span.endLine, '    ', lines, pro);
      const closeTrail = ct.consumeTrailing(st.span.endLine, pro);
      lines.push(`}${closeTrail}`);
    } else {
      lines.push(`${exp}STRUCT ${st.name}${tp}${openTrail}`);
      let innerPrev = st.span.line;
      for (const f of st.fields) {
        ct.consumeWindow(innerPrev, f.span.line, '    ', lines, pro);
        const fTrail = ct.consumeTrailing(f.span.endLine, pro);
        lines.push(`    ${f.name}: ${printType(f.type, pro)}${fTrail}`);
        innerPrev = f.span.endLine;
      }
      ct.consumeWindow(innerPrev, st.span.endLine, '    ', lines, pro);
      const closeTrail = ct.consumeTrailing(st.span.endLine, pro);
      lines.push(`END${closeTrail}`);
    }
    lines.push('');
  }

  for (const en of mod.enums) {
    ct.consumeWindow(prevEndByNode.get(en) ?? 0, en.span.line, '', lines, pro);
    const exp = en.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const tp = en.typeParams.length > 0 ? `<${en.typeParams.join(', ')}>` : '';
    const openTrail = ct.consumeTrailing(en.span.line, pro);
    if (pro) {
      lines.push(`${exp}enum ${en.name}${tp} {${openTrail}`);
      let innerPrev = en.span.line;
      for (const v of en.variants) {
        ct.consumeWindow(innerPrev, v.span.line, '    ', lines, pro);
        const pay =
          v.payloadTypes.length > 0
            ? `(${v.payloadTypes.map((t) => printType(t, pro)).join(', ')})`
            : '';
        const vTrail = ct.consumeTrailing(v.span.endLine, pro);
        lines.push(`    ${v.name}${pay},${vTrail}`);
        innerPrev = v.span.endLine;
      }
      ct.consumeWindow(innerPrev, en.span.endLine, '    ', lines, pro);
      const closeTrail = ct.consumeTrailing(en.span.endLine, pro);
      lines.push(`}${closeTrail}`);
    } else {
      lines.push(`${exp}ENUM ${en.name}${tp}${openTrail}`);
      let innerPrev = en.span.line;
      for (const v of en.variants) {
        ct.consumeWindow(innerPrev, v.span.line, '    ', lines, pro);
        const pay =
          v.payloadTypes.length > 0
            ? `(${v.payloadTypes.map((t) => printType(t, pro)).join(', ')})`
            : '';
        const vTrail = ct.consumeTrailing(v.span.endLine, pro);
        lines.push(`    ${v.name}${pay}${vTrail}`);
        innerPrev = v.span.endLine;
      }
      ct.consumeWindow(innerPrev, en.span.endLine, '    ', lines, pro);
      const closeTrail = ct.consumeTrailing(en.span.endLine, pro);
      lines.push(`END${closeTrail}`);
    }
    lines.push('');
  }

  for (const tr of mod.traits || []) {
    ct.consumeWindow(prevEndByNode.get(tr) ?? 0, tr.span.line, '', lines, pro);
    const exp = tr.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const tp = tr.typeParams.length > 0 ? `<${tr.typeParams.join(', ')}>` : '';
    const openTrail = ct.consumeTrailing(tr.span.line, pro);
    if (pro) {
      lines.push(`${exp}trait ${tr.name}${tp} {${openTrail}`);
      let innerPrev = tr.span.line;
      for (const m of tr.methods) {
        ct.consumeWindow(innerPrev, m.span.line, '    ', lines, pro);
        const params = m.params.map((p) => `${p.name}: ${printType(p.type, pro)}`).join(', ');
        const ret =
          m.returnType.kind === 'PrimitiveType' && m.returnType.name === 'void'
            ? ''
            : ` -> ${printType(m.returnType, pro)}`;
        const eff = m.effects.length > 0 ? ` effects(${m.effects.join(', ')})` : '';
        const mTrail = ct.consumeTrailing(m.span.endLine, pro);
        lines.push(`    fn ${m.name}(${params})${ret}${eff};${mTrail}`);
        innerPrev = m.span.endLine;
      }
      ct.consumeWindow(innerPrev, tr.span.endLine, '    ', lines, pro);
      const closeTrail = ct.consumeTrailing(tr.span.endLine, pro);
      lines.push(`}${closeTrail}`);
    } else {
      lines.push(`${exp}TRAIT ${tr.name}${tp}${openTrail}`);
      let innerPrev = tr.span.line;
      for (const m of tr.methods) {
        ct.consumeWindow(innerPrev, m.span.line, '    ', lines, pro);
        const params = m.params.map((p) => `${p.name}: ${printType(p.type, pro)}`).join(', ');
        const ret =
          m.returnType.kind === 'PrimitiveType' && m.returnType.name === 'void'
            ? ''
            : ` -> ${printType(m.returnType, pro)}`;
        const eff = m.effects.length > 0 ? ` EFFECTS ${m.effects.join(', ')}` : '';
        const mTrail = ct.consumeTrailing(m.span.endLine, pro);
        lines.push(`    FUNCTION ${m.name}(${params})${ret}${eff}${mTrail}`);
        innerPrev = m.span.endLine;
      }
      ct.consumeWindow(innerPrev, tr.span.endLine, '    ', lines, pro);
      const closeTrail = ct.consumeTrailing(tr.span.endLine, pro);
      lines.push(`END${closeTrail}`);
    }
    lines.push('');
  }

  for (const c of mod.constants) {
    ct.consumeWindow(prevEndByNode.get(c) ?? 0, c.span.line, '', lines, pro);
    const exp = c.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const ty = c.typeAnnotation.kind !== 'InferredType' ? `: ${printType(c.typeAnnotation, pro)}` : '';
    const trail = ct.consumeTrailing(c.span.endLine, pro);
    lines.push(
      (pro
        ? `${exp}const ${c.name}${ty} = ${printExpr(c.init, pro, false)};`
        : `${exp}CONSTANT ${c.name}${ty} = ${printExpr(c.init, pro, false)}`) + trail
    );
  }
  if (mod.constants.length > 0) lines.push('');

  for (const fn of mod.functions) {
    ct.consumeWindow(prevEndByNode.get(fn) ?? 0, fn.span.line, '', lines, pro);
    const exp = fn.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const asy = fn.isAsync ? (pro ? 'async ' : 'ASYNC ') : '';
    const tp = fn.typeParams.length > 0 ? `<${fn.typeParams.join(', ')}>` : '';
    const params = fn.params.map((p) => `${p.name}: ${printType(p.type, pro)}`).join(', ');
    const ret =
      fn.returnType.kind === 'PrimitiveType' && fn.returnType.name === 'void'
        ? ''
        : ` -> ${printType(fn.returnType, pro)}`;
    const eff =
      fn.effects.length > 0
        ? pro
          ? ` effects(${fn.effects.join(', ')})`
          : ` EFFECTS ${fn.effects.join(', ')}`
        : fn.hasExplicitEffects && fn.effects.length === 0
          ? pro
            ? ' pure'
            : ' PURE'
          : '';

    const openTrail = ct.consumeTrailing(fn.span.line, pro);
    if (pro) {
      lines.push(`${exp}${asy}fn ${fn.name}${tp}(${params})${ret}${eff} {${openTrail}`);
      printBlockStmts(fn.body, fn.span.line, fn.span.endLine, pro, 1, lines, ct);
      const closeTrail = ct.consumeTrailing(fn.span.endLine, pro);
      lines.push(`}${closeTrail}`);
    } else {
      lines.push(`${exp}${asy}FUNCTION ${fn.name}${tp}(${params})${ret}${eff}${openTrail}`);
      printBlockStmts(fn.body, fn.span.line, fn.span.endLine, pro, 1, lines, ct);
      const closeTrail = ct.consumeTrailing(fn.span.endLine, pro);
      lines.push(`END${closeTrail}`);
    }
    lines.push('');
  }

  for (const stmt of mod.topLevelStmts) {
    ct.consumeWindow(prevEndByNode.get(stmt) ?? 0, stmt.span.line, '', lines, pro);
    printStmt(stmt, pro, 0, lines, ct);
  }

  ct.flushRemaining('', lines, pro);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function formatTypeNode(t: TypeNode, pro = true): string {
  return printType(t, pro);
}

function printType(t: TypeNode, pro: boolean): string {
  switch (t.kind) {
    case 'PrimitiveType':
      if (pro) return t.name;
      switch (t.name) {
        case 'i64':
          return 'Int';
        case 'f64':
          return 'Float';
        case 'bool':
          return 'Bool';
        case 'str':
          return 'Text';
        case 'void':
          return 'Void';
        default:
          return t.name;
      }
    case 'ArrayType':
      return `${pro ? 'Array' : 'List'}<${printType(t.elementType, pro)}>`;
    case 'MapType':
      return `Map<${printType(t.keyType, pro)}, ${printType(t.valueType, pro)}>`;
    case 'ResultType':
      return `Result<${printType(t.okType, pro)}, ${printType(t.errType, pro)}>`;
    case 'NamedType':
      return t.typeArgs.length > 0
        ? `${t.name}<${t.typeArgs.map((a) => printType(a, pro)).join(', ')}>`
        : t.name;
    case 'InferredType':
      return pro ? 'auto' : 'Any';
  }
}

function printBlockStmts(
  stmts: SemanticStmt[],
  openLine: number,
  closeLine: number,
  pro: boolean,
  indent: number,
  out: string[],
  ct: CommentTracker
): void {
  const pad = '    '.repeat(indent);
  let prevLine = openLine;
  for (const s of stmts) {
    ct.consumeWindow(prevLine, s.span.line, pad, out, pro);
    printStmt(s, pro, indent, out, ct);
    prevLine = s.span.endLine;
  }
  ct.consumeWindow(prevLine, closeLine, pad, out, pro);
}

function printStmt(
  stmt: SemanticStmt,
  pro: boolean,
  indent: number,
  out: string[],
  ct?: CommentTracker
): void {
  const pad = '    '.repeat(indent);
  const trailAt = (line: number) => (ct ? ct.consumeTrailing(line, pro) : '');
  switch (stmt.kind) {
    case 'VarStmt': {
      const d = stmt.decl;
      const exp = indent === 0 && d.exported ? (pro ? 'export ' : 'EXPORT ') : '';
      const ty = d.typeAnnotation.kind !== 'InferredType' ? `: ${printType(d.typeAnnotation, pro)}` : '';
      const trail = trailAt(stmt.span.endLine);
      if (pro) {
        out.push(`${pad}${exp}let ${d.mutable ? 'mut ' : ''}${d.name}${ty} = ${printExpr(d.init, pro, false)};${trail}`);
      } else {
        out.push(`${pad}${exp}${d.mutable ? 'MUTABLE' : 'LET'} ${d.name}${ty} = ${printExpr(d.init, pro, false)}${trail}`);
      }
      break;
    }
    case 'ConstStmt': {
      const d = stmt.decl;
      const exp = indent === 0 && d.exported ? (pro ? 'export ' : 'EXPORT ') : '';
      const ty = d.typeAnnotation.kind !== 'InferredType' ? `: ${printType(d.typeAnnotation, pro)}` : '';
      const trail = trailAt(stmt.span.endLine);
      out.push(
        (pro
          ? `${pad}${exp}const ${d.name}${ty} = ${printExpr(d.init, pro, false)};`
          : `${pad}${exp}CONSTANT ${d.name}${ty} = ${printExpr(d.init, pro, false)}`) + trail
      );
      break;
    }
    case 'AssignStmt': {
      let lhs: string;
      if (stmt.target.kind === 'VarTarget') {
        lhs = stmt.target.name;
      } else if (stmt.target.kind === 'FieldTarget') {
        const obj = printExprWithParens(stmt.target.object, needsParensForPostfix(stmt.target.object), pro, false);
        lhs = `${obj}.${stmt.target.field}`;
      } else {
        const obj = printExprWithParens(stmt.target.object, needsParensForPostfix(stmt.target.object), pro, false);
        lhs = `${obj}[${printExpr(stmt.target.index, pro, false)}]`;
      }
      const trail = trailAt(stmt.span.endLine);
      out.push(
        (pro
          ? `${pad}${lhs} = ${printExpr(stmt.value, pro, false)};`
          : `${pad}SET ${lhs} TO ${printExpr(stmt.value, pro, false)}`) + trail
      );
      break;
    }
    case 'ExprStmt': {
      const trail = trailAt(stmt.span.endLine);
      if (!pro && stmt.expr.kind === 'CallExpr' && stmt.expr.callee === 'print' && stmt.expr.args.length === 1) {
        out.push(`${pad}SHOW ${printExpr(stmt.expr.args[0], pro, false)}${trail}`);
      } else {
        out.push(`${pad}${printExpr(stmt.expr, pro, false)}${pro ? ';' : ''}${trail}`);
      }
      break;
    }
    case 'IfStmt': {
      const cond = printExpr(stmt.condition, pro, true);
      const openTrail = trailAt(stmt.span.line);
      const thenUpper =
        stmt.elseBranch.length > 0
          ? Math.max(stmt.span.line, stmt.elseBranch[0].span.line - 1)
          : stmt.span.endLine;
      const elseOpen =
        stmt.thenBranch.length > 0
          ? stmt.thenBranch[stmt.thenBranch.length - 1].span.endLine
          : stmt.span.line;
      if (pro) {
        out.push(`${pad}if ${cond} {${openTrail}`);
        if (ct) {
          printBlockStmts(stmt.thenBranch, stmt.span.line, thenUpper, pro, indent + 1, out, ct);
        } else {
          for (const s of stmt.thenBranch) printStmt(s, pro, indent + 1, out);
        }
        if (stmt.elseBranch.length > 0) {
          out.push(`${pad}} else {`);
          if (ct) {
            printBlockStmts(stmt.elseBranch, elseOpen, stmt.span.endLine, pro, indent + 1, out, ct);
          } else {
            for (const s of stmt.elseBranch) printStmt(s, pro, indent + 1, out);
          }
        }
        out.push(`${pad}}${trailAt(stmt.span.endLine)}`);
      } else {
        out.push(`${pad}IF ${cond}${openTrail}`);
        if (ct) {
          printBlockStmts(stmt.thenBranch, stmt.span.line, thenUpper, pro, indent + 1, out, ct);
        } else {
          for (const s of stmt.thenBranch) printStmt(s, pro, indent + 1, out);
        }
        if (stmt.elseBranch.length > 0) {
          out.push(`${pad}ELSE`);
          if (ct) {
            printBlockStmts(stmt.elseBranch, elseOpen, stmt.span.endLine, pro, indent + 1, out, ct);
          } else {
            for (const s of stmt.elseBranch) printStmt(s, pro, indent + 1, out);
          }
        }
        out.push(`${pad}END${trailAt(stmt.span.endLine)}`);
      }
      break;
    }
    case 'WhileStmt': {
      const cond = printExpr(stmt.condition, pro, true);
      const openTrail = trailAt(stmt.span.line);
      if (pro) {
        out.push(`${pad}while ${cond} {${openTrail}`);
        if (ct) printBlockStmts(stmt.body, stmt.span.line, stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}${trailAt(stmt.span.endLine)}`);
      } else {
        out.push(`${pad}WHILE ${cond}${openTrail}`);
        if (ct) printBlockStmts(stmt.body, stmt.span.line, stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END${trailAt(stmt.span.endLine)}`);
      }
      break;
    }
    case 'ForInStmt': {
      const iter = printExpr(stmt.iterable, pro, true);
      const openTrail = trailAt(stmt.span.line);
      if (pro) {
        out.push(`${pad}for ${stmt.itemName} in ${iter} {${openTrail}`);
        if (ct) printBlockStmts(stmt.body, stmt.span.line, stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}${trailAt(stmt.span.endLine)}`);
      } else {
        out.push(`${pad}FOR EACH ${stmt.itemName} IN ${iter}${openTrail}`);
        if (ct) printBlockStmts(stmt.body, stmt.span.line, stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END${trailAt(stmt.span.endLine)}`);
      }
      break;
    }
    case 'RepeatStmt': {
      const cnt = printExpr(stmt.count, pro, true);
      const openTrail = trailAt(stmt.span.line);
      if (pro) {
        out.push(`${pad}repeat (${cnt}) {${openTrail}`);
        if (ct) printBlockStmts(stmt.body, stmt.span.line, stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}${trailAt(stmt.span.endLine)}`);
      } else {
        out.push(`${pad}REPEAT ${cnt} TIMES${openTrail}`);
        if (ct) printBlockStmts(stmt.body, stmt.span.line, stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END${trailAt(stmt.span.endLine)}`);
      }
      break;
    }
    case 'BreakStmt':
      out.push((pro ? `${pad}break;` : `${pad}BREAK`) + trailAt(stmt.span.endLine));
      break;
    case 'ContinueStmt':
      out.push((pro ? `${pad}continue;` : `${pad}CONTINUE`) + trailAt(stmt.span.endLine));
      break;
    case 'ReturnStmt':
      if (stmt.value) {
        out.push(
          (pro
            ? `${pad}return ${printExpr(stmt.value, pro, false)};`
            : `${pad}RETURN ${printExpr(stmt.value, pro, false)}`) + trailAt(stmt.span.endLine)
        );
      } else {
        out.push((pro ? `${pad}return;` : `${pad}RETURN`) + trailAt(stmt.span.endLine));
      }
      break;
    case 'MatchStmt': {
      const subj = printExpr(stmt.subject, pro, true);
      const openTrail = trailAt(stmt.span.line);
      let prevArmEnd = stmt.span.line;
      if (pro) {
        out.push(`${pad}match ${subj} {${openTrail}`);
        for (const arm of stmt.arms) {
          if (ct) ct.consumeWindow(prevArmEnd, arm.span.line, `${pad}    `, out, pro);
          out.push(`${pad}    ${printPattern(arm.pattern, pro)} => {${trailAt(arm.span.line)}`);
          if (ct) printBlockStmts(arm.body, arm.span.line, arm.span.endLine, pro, indent + 2, out, ct);
          else for (const s of arm.body) printStmt(s, pro, indent + 2, out);
          out.push(`${pad}    },${trailAt(arm.span.endLine)}`);
          prevArmEnd = arm.span.endLine;
        }
        if (ct) ct.consumeWindow(prevArmEnd, stmt.span.endLine, `${pad}    `, out, pro);
        out.push(`${pad}}${trailAt(stmt.span.endLine)}`);
      } else {
        out.push(`${pad}MATCH ${subj}${openTrail}`);
        for (const arm of stmt.arms) {
          if (ct) ct.consumeWindow(prevArmEnd, arm.span.line, `${pad}    `, out, pro);
          if (arm.pattern.kind === 'WildcardPattern') {
            out.push(`${pad}    ELSE${trailAt(arm.span.line)}`);
          } else {
            out.push(`${pad}    WHEN ${printPattern(arm.pattern, pro)}${trailAt(arm.span.line)}`);
          }
          if (ct) printBlockStmts(arm.body, arm.span.line, arm.span.endLine, pro, indent + 2, out, ct);
          else for (const s of arm.body) printStmt(s, pro, indent + 2, out);
          prevArmEnd = arm.span.endLine;
        }
        if (ct) ct.consumeWindow(prevArmEnd, stmt.span.endLine, `${pad}    `, out, pro);
        out.push(`${pad}END${trailAt(stmt.span.endLine)}`);
      }
      break;
    }
    case 'TryStmt': {
      const openTrail = trailAt(stmt.span.line);
      if (pro) {
        out.push(`${pad}try {${openTrail}`);
        if (ct) printBlockStmts(stmt.tryBody, stmt.span.line, stmt.catchBody[0]?.span.line ?? stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.tryBody) printStmt(s, pro, indent + 1, out);
        const bind = stmt.errBinding ? ` (${stmt.errBinding})` : '';
        out.push(`${pad}} catch${bind} {`);
        if (ct) printBlockStmts(stmt.catchBody, (stmt.tryBody[stmt.tryBody.length - 1]?.span.endLine ?? stmt.span.line), stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.catchBody) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}${trailAt(stmt.span.endLine)}`);
      } else {
        out.push(`${pad}TRY${openTrail}`);
        if (ct) printBlockStmts(stmt.tryBody, stmt.span.line, stmt.catchBody[0]?.span.line ?? stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.tryBody) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}IF FAILED`);
        if (ct) printBlockStmts(stmt.catchBody, (stmt.tryBody[stmt.tryBody.length - 1]?.span.endLine ?? stmt.span.line), stmt.span.endLine, pro, indent + 1, out, ct);
        else for (const s of stmt.catchBody) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END${trailAt(stmt.span.endLine)}`);
      }
      break;
    }
  }
}

function printPattern(p: MatchPattern, pro: boolean): string {
  switch (p.kind) {
    case 'WildcardPattern':
      return '_';
    case 'LiteralPattern':
      return typeof p.value === 'string'
        ? JSON.stringify(p.value)
        : typeof p.value === 'boolean'
          ? pro
            ? String(p.value)
            : String(p.value).toUpperCase()
          : String(p.value);
    case 'EnumVariantPattern': {
      const head = p.enumName ? `${p.enumName}::${p.variantName}` : p.variantName;
      return p.bindings.length > 0 ? `${head}(${p.bindings.join(', ')})` : head;
    }
  }
}

function printExprWithParens(
  e: SemanticExpr,
  wrap: boolean,
  pro: boolean,
  inHeader: boolean
): string {
  if (wrap) {
    return `(${printExpr(e, pro, false)})`;
  }
  return printExpr(e, pro, inHeader);
}

export function printExpr(e: SemanticExpr, pro: boolean, inHeader = false): string {
  switch (e.kind) {
    case 'IntLiteral':
      return e.raw;
    case 'FloatLiteral':
      return e.raw;
    case 'BoolLiteral':
      return pro ? String(e.value) : e.value ? 'TRUE' : 'FALSE';
    case 'StringLiteral':
      return JSON.stringify(e.value);
    case 'Identifier':
      return e.name;
    case 'UnaryExpr': {
      const wrap = needsParensForUnary(e.op, e.operand);
      const inner = printExprWithParens(e.operand, wrap, pro, inHeader);
      if (!pro && e.op === '!') return `NOT ${inner}`;
      return `${e.op}${inner}`;
    }
    case 'BinaryExpr': {
      const op =
        !pro && e.op === '&&'
          ? 'AND'
          : !pro && e.op === '||'
            ? 'OR'
            : e.op;
      const leftStr = printExprWithParens(
        e.left,
        needsParensForBinaryLeft(e.op, e.left),
        pro,
        inHeader
      );
      const rightStr = printExprWithParens(
        e.right,
        needsParensForBinaryRight(e.op, e.right),
        pro,
        inHeader
      );
      return `${leftStr} ${op} ${rightStr}`;
    }
    case 'CallExpr':
      return `${e.callee}(${e.args.map((a) => printExpr(a, pro, false)).join(', ')})`;
    case 'FieldAccessExpr': {
      const obj = printExprWithParens(e.object, needsParensForPostfix(e.object), pro, inHeader);
      return `${obj}.${e.field}`;
    }
    case 'IndexAccessExpr': {
      const obj = printExprWithParens(e.object, needsParensForPostfix(e.object), pro, inHeader);
      return `${obj}[${printExpr(e.index, pro, false)}]`;
    }
    case 'ArrayLiteral':
      return `[${e.elements.map((x) => printExpr(x, pro, false)).join(', ')}]`;
    case 'MapLiteral':
      return `{${e.entries.map((kv) => `${printExpr(kv.key, pro, false)}: ${printExpr(kv.value, pro, false)}`).join(', ')}}`;
    case 'StructLiteral': {
      const fields = e.fields.map((f) => `${f.name}: ${printExpr(f.value, pro, false)}`).join(', ');
      const lit = pro ? `${e.structName} { ${fields} }` : `NEW ${e.structName}(${fields})`;
      return pro && inHeader ? `(${lit})` : lit;
    }
    case 'EnumConstructExpr':
      return e.args.length > 0
        ? `${e.enumName}::${e.variantName}(${e.args.map((a) => printExpr(a, pro, false)).join(', ')})`
        : `${e.enumName}::${e.variantName}`;
    case 'AwaitExpr': {
      const wrap = needsParensForUnary('await', e.operand);
      const inner = printExprWithParens(e.operand, wrap, pro, inHeader);
      return pro ? `await ${inner}` : `AWAIT ${inner}`;
    }
    case 'TryPropagateExpr': {
      const inner = printExprWithParens(e.operand, needsParensForPostfix(e.operand), pro, inHeader);
      return `${inner}?`;
    }
  }
}

function formatIndentationOnly(source: string, profile: SyntaxProfile): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let depth = 0;
  const out: string[] = [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    if (profile === 'professional') {
      if (trimmed.startsWith('}')) depth = Math.max(0, depth - 1);
      out.push(`${'    '.repeat(depth)}${trimmed}`);
      if (trimmed.endsWith('{')) depth++;
    } else {
      const upper = trimmed.toUpperCase();
      if (
        upper === 'END' ||
        upper === 'ELSE' ||
        upper.startsWith('ELSE ') ||
        upper === 'IF FAILED' ||
        (upper.startsWith('WHEN ') && depth > 1)
      ) {
        depth = Math.max(0, depth - 1);
      }
      out.push(`${'    '.repeat(depth)}${trimmed}`);
      if (
        /^(PAGE|COMPONENT|CONTAINER|CARD|NAV|HEADER|FOOTER|MODAL|STYLE|FORM|TABLE|DIALOG|TABS|MENU|SIDEBAR|ANIMATE|PROGRAM|ACCOUNT|INSTRUCTION|SERVER|ENDPOINT|IF|ELSE|WHILE|FOR|REPEAT|TRY|IF FAILED|FUNCTION|ACTION|STRUCT|ENUM|TRAIT|MATCH|WHEN\s+[a-z0-9_.]+)\b/i.test(
          trimmed
        ) &&
        !upper.endsWith(' END')
      ) {
        depth++;
      }
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function formatManifestSource(
  source: string,
  targetProfile?: SyntaxProfile
): { ok: boolean; formatted?: string; error?: string; diagnostics: SemanticDiagnostic[] } {
  const resolvedProfile = detectSyntaxProfile(source, 'auto');
  try {
    const ast = parseSemanticModule(source, { profile: resolvedProfile });
    if (ast.isSolanaContract) {
      return {
        ok: true,
        formatted: formatIndentationOnly(source, resolvedProfile),
        diagnostics: [],
      };
    }
    return {
      ok: true,
      formatted: printSemanticModule(ast, targetProfile ?? ast.profile),
      diagnostics: [],
    };
  } catch (err: any) {
    const diag: SemanticDiagnostic =
      err instanceof ManifestError
        ? {
            code: 'E_SYNTAX',
            severity: 'error',
            message: err.message,
            line: err.line || 1,
            column: err.column || 1,
            hint: err.hint,
          }
        : {
            code: 'E_SYNTAX',
            severity: 'error',
            message: err?.message || 'Unable to parse source for formatting',
            line: 1,
            column: 1,
          };
    return {
      ok: false,
      error: diag.message,
      diagnostics: [diag],
    };
  }
}

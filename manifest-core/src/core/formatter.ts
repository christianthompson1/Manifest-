import {
  MatchPattern,
  SemanticExpr,
  SemanticModule,
  SemanticStmt,
  TypeNode,
} from './ast-v2.ts';
import { parseSemanticModule } from './parse-unified.ts';
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
    if (mod.hasDomainExtensions.webUI || mod.hasDomainExtensions.solanaContract || mod.isLegacyApp) {
      return formatIndentationOnly(source, profile);
    }
    return printSemanticModule(mod, profile);
  } catch {
    return formatIndentationOnly(source, profile);
  }
}

export function printSemanticModule(mod: SemanticModule, targetProfile: SyntaxProfile): string {
  const lines: string[] = [];
  const pro = targetProfile === 'professional';

  if (mod.moduleName && mod.moduleName !== 'main') {
    lines.push(pro ? `module ${mod.moduleName};` : `MODULE ${mod.moduleName}`);
    lines.push('');
  }

  const { requires, provides, denies } = mod.capabilities;
  if (requires.length > 0) {
    const list = requires.map((r) => r.name).join(', ');
    lines.push(pro ? `requires [${list}];` : `REQUIRES ${list}`);
  }
  if (provides.length > 0) {
    const list = provides.map((p) => p.name).join(', ');
    lines.push(pro ? `provides [${list}];` : `PROVIDES ${list}`);
  }
  if (denies.length > 0) {
    const list = denies.map((d) => d.name).join(', ');
    lines.push(pro ? `denies [${list}];` : `DENIES ${list}`);
  }
  if (requires.length || provides.length || denies.length) {
    lines.push('');
  }

  for (const imp of mod.imports) {
    const syms = imp.symbols.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name)).join(', ');
    lines.push(pro ? `import { ${syms} } from "${imp.from}";` : `IMPORT ${syms} FROM "${imp.from}"`);
  }
  if (mod.imports.length > 0) lines.push('');

  for (const st of mod.structs) {
    const exp = st.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const tp = st.typeParams.length > 0 ? `<${st.typeParams.join(', ')}>` : '';
    if (pro) {
      lines.push(`${exp}struct ${st.name}${tp} {`);
      for (const f of st.fields) {
        lines.push(`    ${f.name}: ${printType(f.type, pro)},`);
      }
      lines.push('}');
    } else {
      lines.push(`${exp}STRUCT ${st.name}${tp}`);
      for (const f of st.fields) {
        lines.push(`    ${f.name}: ${printType(f.type, pro)}`);
      }
      lines.push('END');
    }
    lines.push('');
  }

  for (const en of mod.enums) {
    const exp = en.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const tp = en.typeParams.length > 0 ? `<${en.typeParams.join(', ')}>` : '';
    if (pro) {
      lines.push(`${exp}enum ${en.name}${tp} {`);
      for (const v of en.variants) {
        const pay =
          v.payloadTypes.length > 0
            ? `(${v.payloadTypes.map((t) => printType(t, pro)).join(', ')})`
            : '';
        lines.push(`    ${v.name}${pay},`);
      }
      lines.push('}');
    } else {
      lines.push(`${exp}ENUM ${en.name}${tp}`);
      for (const v of en.variants) {
        const pay =
          v.payloadTypes.length > 0
            ? `(${v.payloadTypes.map((t) => printType(t, pro)).join(', ')})`
            : '';
        lines.push(`    ${v.name}${pay}`);
      }
      lines.push('END');
    }
    lines.push('');
  }

  for (const c of mod.constants) {
    const exp = c.exported ? (pro ? 'export ' : 'EXPORT ') : '';
    const ty = c.typeAnnotation.kind !== 'InferredType' ? `: ${printType(c.typeAnnotation, pro)}` : '';
    lines.push(
      pro
        ? `${exp}const ${c.name}${ty} = ${printExpr(c.init, pro)};`
        : `${exp}CONSTANT ${c.name}${ty} = ${printExpr(c.init, pro)}`
    );
  }
  if (mod.constants.length > 0) lines.push('');

  for (const fn of mod.functions) {
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
        : '';

    if (pro) {
      lines.push(`${exp}${asy}fn ${fn.name}${tp}(${params})${ret}${eff} {`);
      for (const s of fn.body) {
        printStmt(s, pro, 1, lines);
      }
      lines.push('}');
    } else {
      lines.push(`${exp}${asy}FUNCTION ${fn.name}${tp}(${params})${ret}${eff}`);
      for (const s of fn.body) {
        printStmt(s, pro, 1, lines);
      }
      lines.push('END');
    }
    lines.push('');
  }

  for (const stmt of mod.topLevelStmts) {
    printStmt(stmt, pro, 0, lines);
  }

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

function printStmt(stmt: SemanticStmt, pro: boolean, indent: number, out: string[]): void {
  const pad = '    '.repeat(indent);
  switch (stmt.kind) {
    case 'VarStmt': {
      const d = stmt.decl;
      const ty = d.typeAnnotation.kind !== 'InferredType' ? `: ${printType(d.typeAnnotation, pro)}` : '';
      if (pro) {
        out.push(`${pad}let ${d.mutable ? 'mut ' : ''}${d.name}${ty} = ${printExpr(d.init, pro)};`);
      } else {
        out.push(`${pad}${d.mutable ? 'MUTABLE' : 'LET'} ${d.name}${ty} = ${printExpr(d.init, pro)}`);
      }
      break;
    }
    case 'ConstStmt': {
      const d = stmt.decl;
      const ty = d.typeAnnotation.kind !== 'InferredType' ? `: ${printType(d.typeAnnotation, pro)}` : '';
      out.push(
        pro
          ? `${pad}const ${d.name}${ty} = ${printExpr(d.init, pro)};`
          : `${pad}CONSTANT ${d.name}${ty} = ${printExpr(d.init, pro)}`
      );
      break;
    }
    case 'AssignStmt': {
      const lhs =
        stmt.target.kind === 'VarTarget'
          ? stmt.target.name
          : stmt.target.kind === 'FieldTarget'
            ? `${printExpr(stmt.target.object, pro)}.${stmt.target.field}`
            : `${printExpr(stmt.target.object, pro)}[${printExpr(stmt.target.index, pro)}]`;
      out.push(
        pro
          ? `${pad}${lhs} = ${printExpr(stmt.value, pro)};`
          : `${pad}SET ${lhs} TO ${printExpr(stmt.value, pro)}`
      );
      break;
    }
    case 'ExprStmt': {
      if (!pro && stmt.expr.kind === 'CallExpr' && stmt.expr.callee === 'print' && stmt.expr.args.length === 1) {
        out.push(`${pad}SHOW ${printExpr(stmt.expr.args[0], pro)}`);
      } else {
        out.push(`${pad}${printExpr(stmt.expr, pro)}${pro ? ';' : ''}`);
      }
      break;
    }
    case 'IfStmt': {
      if (pro) {
        out.push(`${pad}if ${printExpr(stmt.condition, pro)} {`);
        for (const s of stmt.thenBranch) printStmt(s, pro, indent + 1, out);
        if (stmt.elseBranch.length > 0) {
          out.push(`${pad}} else {`);
          for (const s of stmt.elseBranch) printStmt(s, pro, indent + 1, out);
        }
        out.push(`${pad}}`);
      } else {
        out.push(`${pad}IF ${printExpr(stmt.condition, pro)}`);
        for (const s of stmt.thenBranch) printStmt(s, pro, indent + 1, out);
        if (stmt.elseBranch.length > 0) {
          out.push(`${pad}ELSE`);
          for (const s of stmt.elseBranch) printStmt(s, pro, indent + 1, out);
        }
        out.push(`${pad}END`);
      }
      break;
    }
    case 'WhileStmt': {
      if (pro) {
        out.push(`${pad}while ${printExpr(stmt.condition, pro)} {`);
        for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}`);
      } else {
        out.push(`${pad}WHILE ${printExpr(stmt.condition, pro)}`);
        for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END`);
      }
      break;
    }
    case 'ForInStmt': {
      if (pro) {
        out.push(`${pad}for ${stmt.itemName} in ${printExpr(stmt.iterable, pro)} {`);
        for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}`);
      } else {
        out.push(`${pad}FOR EACH ${stmt.itemName} IN ${printExpr(stmt.iterable, pro)}`);
        for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END`);
      }
      break;
    }
    case 'RepeatStmt': {
      if (pro) {
        out.push(`${pad}repeat (${printExpr(stmt.count, pro)}) {`);
        for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}`);
      } else {
        out.push(`${pad}REPEAT ${printExpr(stmt.count, pro)} TIMES`);
        for (const s of stmt.body) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END`);
      }
      break;
    }
    case 'BreakStmt':
      out.push(pro ? `${pad}break;` : `${pad}BREAK`);
      break;
    case 'ContinueStmt':
      out.push(pro ? `${pad}continue;` : `${pad}CONTINUE`);
      break;
    case 'ReturnStmt':
      if (stmt.value) {
        out.push(
          pro
            ? `${pad}return ${printExpr(stmt.value, pro)};`
            : `${pad}RETURN ${printExpr(stmt.value, pro)}`
        );
      } else {
        out.push(pro ? `${pad}return;` : `${pad}RETURN`);
      }
      break;
    case 'MatchStmt': {
      if (pro) {
        out.push(`${pad}match ${printExpr(stmt.subject, pro)} {`);
        for (const arm of stmt.arms) {
          out.push(`${pad}    ${printPattern(arm.pattern, pro)} => {`);
          for (const s of arm.body) printStmt(s, pro, indent + 2, out);
          out.push(`${pad}    },`);
        }
        out.push(`${pad}}`);
      } else {
        out.push(`${pad}MATCH ${printExpr(stmt.subject, pro)}`);
        for (const arm of stmt.arms) {
          if (arm.pattern.kind === 'WildcardPattern') {
            out.push(`${pad}    ELSE`);
          } else {
            out.push(`${pad}    WHEN ${printPattern(arm.pattern, pro)}`);
          }
          for (const s of arm.body) printStmt(s, pro, indent + 2, out);
        }
        out.push(`${pad}END`);
      }
      break;
    }
    case 'TryStmt': {
      if (pro) {
        out.push(`${pad}try {`);
        for (const s of stmt.tryBody) printStmt(s, pro, indent + 1, out);
        const bind = stmt.errBinding ? ` (${stmt.errBinding})` : '';
        out.push(`${pad}} catch${bind} {`);
        for (const s of stmt.catchBody) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}}`);
      } else {
        out.push(`${pad}TRY`);
        for (const s of stmt.tryBody) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}IF FAILED`);
        for (const s of stmt.catchBody) printStmt(s, pro, indent + 1, out);
        out.push(`${pad}END`);
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

function printExpr(e: SemanticExpr, pro: boolean): string {
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
    case 'UnaryExpr':
      if (!pro && e.op === '!') return `NOT ${printExpr(e.operand, pro)}`;
      return `${e.op}${printExpr(e.operand, pro)}`;
    case 'BinaryExpr': {
      const op =
        !pro && e.op === '&&'
          ? 'AND'
          : !pro && e.op === '||'
            ? 'OR'
            : e.op;
      return `${printExpr(e.left, pro)} ${op} ${printExpr(e.right, pro)}`;
    }
    case 'CallExpr':
      return `${e.callee}(${e.args.map((a) => printExpr(a, pro)).join(', ')})`;
    case 'FieldAccessExpr':
      return `${printExpr(e.object, pro)}.${e.field}`;
    case 'IndexAccessExpr':
      return `${printExpr(e.object, pro)}[${printExpr(e.index, pro)}]`;
    case 'ArrayLiteral':
      return `[${e.elements.map((x) => printExpr(x, pro)).join(', ')}]`;
    case 'MapLiteral':
      return `{${e.entries.map((kv) => `${printExpr(kv.key, pro)}: ${printExpr(kv.value, pro)}`).join(', ')}}`;
    case 'StructLiteral': {
      const fields = e.fields.map((f) => `${f.name}: ${printExpr(f.value, pro)}`).join(', ');
      return pro ? `${e.structName} { ${fields} }` : `NEW ${e.structName}(${fields})`;
    }
    case 'EnumConstructExpr':
      return e.args.length > 0
        ? `${e.enumName}::${e.variantName}(${e.args.map((a) => printExpr(a, pro)).join(', ')})`
        : `${e.enumName}::${e.variantName}`;
    case 'AwaitExpr':
      return pro ? `await ${printExpr(e.operand, pro)}` : `AWAIT ${printExpr(e.operand, pro)}`;
    case 'TryPropagateExpr':
      return `${printExpr(e.operand, pro)}?`;
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
        upper.startsWith('WHEN ') && depth > 1
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

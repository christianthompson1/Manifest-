import { BinaryOp, SourceSpan, UnaryOp } from '../core/ast-v2.ts';
import { SyntaxProfile } from '../core/profile.ts';
import { formatSemanticType, SemanticType } from '../semantics/types.ts';

export interface MIRStructField {
  name: string;
  index: number;
  type: SemanticType;
}

export interface MIRStruct {
  name: string;
  index: number;
  exported: boolean;
  fields: MIRStructField[];
}

export interface MIREnumVariant {
  name: string;
  tag: number;
  payloadTypes: SemanticType[];
}

export interface MIREnum {
  name: string;
  index: number;
  exported: boolean;
  variants: MIREnumVariant[];
}

export interface MIRGlobal {
  name: string;
  slot: number;
  mutable: boolean;
  isConst: boolean;
  exported: boolean;
  type: SemanticType;
  init: MIRExpr;
  span: SourceSpan;
}

export interface MIRLocal {
  name: string;
  slot: number;
  isParam: boolean;
  mutable: boolean;
  type: SemanticType;
  span: SourceSpan;
}

export type MIRExpr =
  | { kind: 'ConstInt'; value: bigint; type: SemanticType; span: SourceSpan }
  | { kind: 'ConstFloat'; value: number; type: SemanticType; span: SourceSpan }
  | { kind: 'ConstBool'; value: boolean; type: SemanticType; span: SourceSpan }
  | { kind: 'ConstStr'; value: string; type: SemanticType; span: SourceSpan }
  | { kind: 'ConstVoid'; type: SemanticType; span: SourceSpan }
  | { kind: 'LoadLocal'; slot: number; name: string; type: SemanticType; span: SourceSpan }
  | { kind: 'LoadGlobal'; slot: number; name: string; type: SemanticType; span: SourceSpan }
  | {
      kind: 'Binary';
      op: BinaryOp;
      left: MIRExpr;
      right: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'Unary';
      op: UnaryOp;
      operand: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'Cast';
      castKind: 'i64_to_f64' | 'f64_to_i64' | 'to_str';
      operand: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'CallFunction';
      callee: string;
      args: MIRExpr[];
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'CallIntrinsic';
      symbol: string;
      capability: string;
      args: MIRExpr[];
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'ArrayNew';
      elements: MIRExpr[];
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'ArrayGet';
      array: MIRExpr;
      index: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'ArrayLen';
      target: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'ArrayPush';
      array: MIRExpr;
      value: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'MapNew';
      entries: Array<{ key: MIRExpr; value: MIRExpr }>;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'MapGet';
      map: MIRExpr;
      key: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'MapSet';
      map: MIRExpr;
      key: MIRExpr;
      value: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'MapHas';
      map: MIRExpr;
      key: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'StructNew';
      structName: string;
      structIndex: number;
      fields: MIRExpr[]; // Ordered by struct field declaration index
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'FieldGet';
      object: MIRExpr;
      structName: string;
      fieldName: string;
      fieldIndex: number;
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'EnumNew';
      enumName: string;
      enumIndex: number;
      variantName: string;
      variantTag: number;
      args: MIRExpr[];
      type: SemanticType;
      span: SourceSpan;
    }
  | {
      kind: 'TryPropagate';
      operand: MIRExpr;
      type: SemanticType;
      span: SourceSpan;
    };

export type MIRMatchArm = {
  pattern:
    | { kind: 'Wildcard' }
    | { kind: 'Literal'; value: bigint | number | boolean | string; litKind: 'i64' | 'f64' | 'bool' | 'str' }
    | {
        kind: 'EnumVariant';
        enumName: string;
        variantName: string;
        variantTag: number;
        bindingSlots: Array<{ slot: number; name: string }>;
      };
  body: MIRStmt[];
  span: SourceSpan;
};

export type MIRStmt =
  | {
      kind: 'StoreLocal';
      slot: number;
      name: string;
      isDeclaration: boolean;
      value: MIRExpr;
      span: SourceSpan;
    }
  | {
      kind: 'StoreGlobal';
      slot: number;
      name: string;
      value: MIRExpr;
      span: SourceSpan;
    }
  | {
      kind: 'ArraySet';
      array: MIRExpr;
      index: MIRExpr;
      value: MIRExpr;
      span: SourceSpan;
    }
  | {
      kind: 'MapSetStmt';
      map: MIRExpr;
      key: MIRExpr;
      value: MIRExpr;
      span: SourceSpan;
    }
  | {
      kind: 'FieldSet';
      object: MIRExpr;
      structName: string;
      fieldName: string;
      fieldIndex: number;
      value: MIRExpr;
      span: SourceSpan;
    }
  | { kind: 'ExprStmt'; expr: MIRExpr; span: SourceSpan }
  | {
      kind: 'If';
      condition: MIRExpr;
      thenBranch: MIRStmt[];
      elseBranch: MIRStmt[];
      span: SourceSpan;
    }
  | {
      kind: 'While';
      condition: MIRExpr;
      body: MIRStmt[];
      span: SourceSpan;
    }
  | { kind: 'Break'; span: SourceSpan }
  | { kind: 'Continue'; span: SourceSpan }
  | { kind: 'Return'; value?: MIRExpr; span: SourceSpan }
  | {
      kind: 'Match';
      subject: MIRExpr;
      tempSlot: number;
      arms: MIRMatchArm[];
      span: SourceSpan;
    };

export interface MIRFunction {
  name: string;
  exported: boolean;
  isAsync: boolean;
  isEntry: boolean;
  isSynthetic: boolean;
  params: MIRLocal[];
  locals: MIRLocal[]; // Includes params at slots 0..params.length-1
  returnType: SemanticType;
  effects: string[];
  body: MIRStmt[];
  span: SourceSpan;
}

export interface MIRModule {
  kind: 'MIRModule';
  moduleName: string;
  sourceProfile: SyntaxProfile;
  requires: string[];
  provides: string[];
  denies: string[];
  structs: MIRStruct[];
  enums: MIREnum[];
  globals: MIRGlobal[];
  functions: MIRFunction[];
  entryFunction?: string;
}

export function isPureMIRExpr(expr: MIRExpr): boolean {
  switch (expr.kind) {
    case 'ConstInt':
    case 'ConstFloat':
    case 'ConstBool':
    case 'ConstStr':
    case 'ConstVoid':
    case 'LoadLocal':
    case 'LoadGlobal':
      return true;
    case 'Unary':
      if (expr.op === '-' && expr.operand.type.kind === 'i64') {
        // -i64::MIN traps, so only treat constant non-MIN or f64 as pure
        return expr.operand.kind === 'ConstInt' && expr.operand.value !== -9223372036854775808n;
      }
      return isPureMIRExpr(expr.operand);
    case 'Binary':
      if (expr.op === '/' || expr.op === '%') return false;
      if (
        (expr.op === '+' || expr.op === '-' || expr.op === '*') &&
        expr.type.kind === 'i64'
      ) {
        // Checked i64 arithmetic may trap on overflow unless already constant-folded
        return false;
      }
      return isPureMIRExpr(expr.left) && isPureMIRExpr(expr.right);
    case 'Cast':
      return isPureMIRExpr(expr.operand);
    case 'ArrayNew':
      return expr.elements.every(isPureMIRExpr);
    case 'StructNew':
      return expr.fields.every(isPureMIRExpr);
    case 'EnumNew':
      return expr.args.every(isPureMIRExpr);
    default:
      return false;
  }
}

export function formatMIRModule(mir: MIRModule): string {
  const lines: string[] = [];
  lines.push(`; Manifest Typed Intermediate Representation (MIR v1.0)`);
  lines.push(`module ${mir.moduleName} {`);
  lines.push(`  requires [${mir.requires.join(', ')}]`);
  lines.push(`  provides [${mir.provides.join(', ')}]`);
  lines.push(`  denies   [${mir.denies.join(', ')}]`);
  if (mir.entryFunction) {
    lines.push(`  entry    @${mir.entryFunction}`);
  }
  lines.push('');

  for (const st of mir.structs) {
    const fStr = st.fields.map((f) => `${f.name}: ${formatSemanticType(f.type)}`).join(', ');
    lines.push(`  ${st.exported ? 'pub ' : ''}struct ${st.name} { ${fStr} }`);
  }

  for (const en of mir.enums) {
    if (en.name === 'Result') continue;
    const vStr = en.variants
      .map((v) =>
        v.payloadTypes.length > 0
          ? `${v.name}(${v.payloadTypes.map(formatSemanticType).join(', ')})`
          : v.name
      )
      .join(' | ');
    lines.push(`  ${en.exported ? 'pub ' : ''}enum ${en.name} = ${vStr}`);
  }

  if (mir.globals.length > 0) {
    lines.push('');
    for (const g of mir.globals) {
      const kw = g.isConst ? 'const' : g.mutable ? 'global mut' : 'global';
      lines.push(
        `  ${g.exported ? 'pub ' : ''}${kw} $${g.name}#${g.slot}: ${formatSemanticType(g.type)} = ${formatExpr(g.init)}`
      );
    }
  }

  for (const fn of mir.functions) {
    lines.push('');
    const pStr = fn.params
      .map((p) => `%${p.name}#${p.slot}: ${formatSemanticType(p.type)}`)
      .join(', ');
    const effStr = fn.effects.length > 0 ? ` effects(${fn.effects.join(', ')})` : ' pure';
    const entryTag = fn.isEntry ? ' [entry]' : '';
    lines.push(
      `  ${fn.exported ? 'pub ' : ''}fn @${fn.name}(${pStr}) -> ${formatSemanticType(fn.returnType)}${effStr}${entryTag} {`
    );
    for (const s of fn.body) {
      formatStmt(s, '    ', lines);
    }
    lines.push(`  }`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

function formatStmt(stmt: MIRStmt, indent: string, out: string[]): void {
  switch (stmt.kind) {
    case 'StoreLocal':
      out.push(
        `${indent}${stmt.isDeclaration ? 'let ' : ''}%${stmt.name}#${stmt.slot} = ${formatExpr(stmt.value)}`
      );
      break;
    case 'StoreGlobal':
      out.push(`${indent}$${stmt.name}#${stmt.slot} = ${formatExpr(stmt.value)}`);
      break;
    case 'ArraySet':
      out.push(`${indent}array.set(${formatExpr(stmt.array)}, ${formatExpr(stmt.index)}, ${formatExpr(stmt.value)})`);
      break;
    case 'MapSetStmt':
      out.push(`${indent}map.set(${formatExpr(stmt.map)}, ${formatExpr(stmt.key)}, ${formatExpr(stmt.value)})`);
      break;
    case 'FieldSet':
      out.push(`${indent}field.set(${formatExpr(stmt.object)}.${stmt.fieldName}#${stmt.fieldIndex}, ${formatExpr(stmt.value)})`);
      break;
    case 'ExprStmt':
      out.push(`${indent}${formatExpr(stmt.expr)}`);
      break;
    case 'Return':
      out.push(`${indent}ret${stmt.value ? ` ${formatExpr(stmt.value)}` : ' void'}`);
      break;
    case 'Break':
      out.push(`${indent}break`);
      break;
    case 'Continue':
      out.push(`${indent}continue`);
      break;
    case 'If':
      out.push(`${indent}if (${formatExpr(stmt.condition)}) {`);
      for (const s of stmt.thenBranch) formatStmt(s, indent + '  ', out);
      if (stmt.elseBranch.length > 0) {
        out.push(`${indent}} else {`);
        for (const s of stmt.elseBranch) formatStmt(s, indent + '  ', out);
      }
      out.push(`${indent}}`);
      break;
    case 'While':
      out.push(`${indent}while (${formatExpr(stmt.condition)}) {`);
      for (const s of stmt.body) formatStmt(s, indent + '  ', out);
      out.push(`${indent}}`);
      break;
    case 'Match':
      out.push(`${indent}match (${formatExpr(stmt.subject)}) [tmp#${stmt.tempSlot}] {`);
      for (const arm of stmt.arms) {
        const patStr =
          arm.pattern.kind === 'Wildcard'
            ? '_'
            : arm.pattern.kind === 'Literal'
              ? JSON.stringify(arm.pattern.value.toString())
              : `${arm.pattern.enumName}::${arm.pattern.variantName}#${arm.pattern.variantTag}(${arm.pattern.bindingSlots.map((b) => `%${b.name}#${b.slot}`).join(', ')})`;
        out.push(`${indent}  ${patStr} => {`);
        for (const s of arm.body) formatStmt(s, indent + '    ', out);
        out.push(`${indent}  }`);
      }
      out.push(`${indent}}`);
      break;
  }
}

function formatExpr(expr: MIRExpr): string {
  switch (expr.kind) {
    case 'ConstInt':
      return `${expr.value}i64`;
    case 'ConstFloat':
      return `${Number.isInteger(expr.value) ? `${expr.value}.0` : expr.value}f64`;
    case 'ConstBool':
      return `${expr.value}`;
    case 'ConstStr':
      return JSON.stringify(expr.value);
    case 'ConstVoid':
      return 'void';
    case 'LoadLocal':
      return `%${expr.name}#${expr.slot}`;
    case 'LoadGlobal':
      return `$${expr.name}#${expr.slot}`;
    case 'Unary':
      return `(${expr.op}${formatExpr(expr.operand)})`;
    case 'Binary':
      return `(${formatExpr(expr.left)} ${expr.op} ${formatExpr(expr.right)})`;
    case 'Cast':
      return `${expr.castKind}(${formatExpr(expr.operand)})`;
    case 'CallFunction':
      return `call @${expr.callee}(${expr.args.map(formatExpr).join(', ')})`;
    case 'CallIntrinsic':
      return `intrinsic[${expr.capability}] ${expr.symbol}(${expr.args.map(formatExpr).join(', ')})`;
    case 'ArrayNew':
      return `[${expr.elements.map(formatExpr).join(', ')}]`;
    case 'ArrayGet':
      return `${formatExpr(expr.array)}[${formatExpr(expr.index)}]`;
    case 'ArrayLen':
      return `len(${formatExpr(expr.target)})`;
    case 'ArrayPush':
      return `push(${formatExpr(expr.array)}, ${formatExpr(expr.value)})`;
    case 'MapNew':
      return `{${expr.entries.map((e) => `${formatExpr(e.key)}: ${formatExpr(e.value)}`).join(', ')}}`;
    case 'MapGet':
      return `map.get(${formatExpr(expr.map)}, ${formatExpr(expr.key)})`;
    case 'MapSet':
      return `map.set(${formatExpr(expr.map)}, ${formatExpr(expr.key)}, ${formatExpr(expr.value)})`;
    case 'MapHas':
      return `map.has(${formatExpr(expr.map)}, ${formatExpr(expr.key)})`;
    case 'StructNew':
      return `${expr.structName}#${expr.structIndex}{${expr.fields.map(formatExpr).join(', ')}}`;
    case 'FieldGet':
      return `${formatExpr(expr.object)}.${expr.fieldName}#${expr.fieldIndex}`;
    case 'EnumNew':
      return `${expr.enumName}::${expr.variantName}#${expr.variantTag}(${expr.args.map(formatExpr).join(', ')})`;
    case 'TryPropagate':
      return `try?(${formatExpr(expr.operand)})`;
  }
}

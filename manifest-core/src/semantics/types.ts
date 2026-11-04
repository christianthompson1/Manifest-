import { SourceSpan, TypeNode } from '../core/ast-v2.ts';

export type SemanticType =
  | { kind: 'i64' }
  | { kind: 'f64' }
  | { kind: 'bool' }
  | { kind: 'str' }
  | { kind: 'void' }
  | { kind: 'any' }
  | { kind: 'type_param'; name: string }
  | { kind: 'array'; element: SemanticType }
  | { kind: 'map'; key: SemanticType; value: SemanticType }
  | { kind: 'result'; ok: SemanticType; err: SemanticType }
  | {
      kind: 'struct';
      name: string;
      typeArgs: SemanticType[];
      fields: Array<{ name: string; type: SemanticType }>;
    }
  | {
      kind: 'enum';
      name: string;
      typeArgs: SemanticType[];
      variants: Array<{ name: string; tag: number; payload: SemanticType[] }>;
    };

export const T_I64: SemanticType = { kind: 'i64' };
export const T_F64: SemanticType = { kind: 'f64' };
export const T_BOOL: SemanticType = { kind: 'bool' };
export const T_STR: SemanticType = { kind: 'str' };
export const T_VOID: SemanticType = { kind: 'void' };
export const T_ANY: SemanticType = { kind: 'any' };

export interface SemanticDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line: number;
  column: number;
  file?: string;
  hint?: string;
}

export interface FunctionSignature {
  name: string;
  moduleName: string;
  exported: boolean;
  isAsync: boolean;
  typeParams: string[];
  params: Array<{ name: string; type: SemanticType }>;
  returnType: SemanticType;
  declaredEffects: string[];
  hasExplicitEffects: boolean;
  intrinsicCapability?: string;
  span?: SourceSpan;
}

export function formatSemanticType(t: SemanticType): string {
  switch (t.kind) {
    case 'i64':
    case 'f64':
    case 'bool':
    case 'str':
    case 'void':
    case 'any':
      return t.kind;
    case 'type_param':
      return t.name;
    case 'array':
      return `Array<${formatSemanticType(t.element)}>`;
    case 'map':
      return `Map<${formatSemanticType(t.key)}, ${formatSemanticType(t.value)}>`;
    case 'result':
      return `Result<${formatSemanticType(t.ok)}, ${formatSemanticType(t.err)}>`;
    case 'struct':
      return t.typeArgs.length > 0
        ? `${t.name}<${t.typeArgs.map(formatSemanticType).join(', ')}>`
        : t.name;
    case 'enum':
      return t.typeArgs.length > 0
        ? `${t.name}<${t.typeArgs.map(formatSemanticType).join(', ')}>`
        : t.name;
  }
}

export function typesCompatible(expected: SemanticType, actual: SemanticType): boolean {
  if (expected.kind === 'any' || actual.kind === 'any') return true;
  if (expected.kind !== actual.kind) return false;
  switch (expected.kind) {
    case 'i64':
    case 'f64':
    case 'bool':
    case 'str':
    case 'void':
      return true;
    case 'type_param':
      return expected.name === (actual as typeof expected).name;
    case 'array':
      return typesCompatible(expected.element, (actual as typeof expected).element);
    case 'map': {
      const am = actual as typeof expected;
      return typesCompatible(expected.key, am.key) && typesCompatible(expected.value, am.value);
    }
    case 'result': {
      const ar = actual as typeof expected;
      return typesCompatible(expected.ok, ar.ok) && typesCompatible(expected.err, ar.err);
    }
    case 'struct': {
      const as = actual as typeof expected;
      if (expected.name !== as.name || expected.typeArgs.length !== as.typeArgs.length) return false;
      return expected.typeArgs.every((ta, idx) => typesCompatible(ta, as.typeArgs[idx]));
    }
    case 'enum': {
      const ae = actual as typeof expected;
      if (expected.name !== ae.name || expected.typeArgs.length !== ae.typeArgs.length) return false;
      return expected.typeArgs.every((ta, idx) => typesCompatible(ta, ae.typeArgs[idx]));
    }
  }
}

export function substituteTypeParams(
  type: SemanticType,
  bindings: Map<string, SemanticType>
): SemanticType {
  switch (type.kind) {
    case 'type_param':
      return bindings.get(type.name) || type;
    case 'array':
      return { kind: 'array', element: substituteTypeParams(type.element, bindings) };
    case 'map':
      return {
        kind: 'map',
        key: substituteTypeParams(type.key, bindings),
        value: substituteTypeParams(type.value, bindings),
      };
    case 'result':
      return {
        kind: 'result',
        ok: substituteTypeParams(type.ok, bindings),
        err: substituteTypeParams(type.err, bindings),
      };
    case 'struct':
      return {
        ...type,
        typeArgs: type.typeArgs.map((t) => substituteTypeParams(t, bindings)),
        fields: type.fields.map((f) => ({
          name: f.name,
          type: substituteTypeParams(f.type, bindings),
        })),
      };
    case 'enum':
      return {
        ...type,
        typeArgs: type.typeArgs.map((t) => substituteTypeParams(t, bindings)),
        variants: type.variants.map((v) => ({
          ...v,
          payload: v.payload.map((p) => substituteTypeParams(p, bindings)),
        })),
      };
    default:
      return type;
  }
}

export interface StdIntrinsicSpec {
  symbol: string;
  aliases: string[];
  params: SemanticType[];
  variadicAny?: boolean;
  returnType: SemanticType;
  capability: string; // 'pure' | 'console' | 'time' | 'fs.read' | 'fs.write' | 'net' | 'db' | 'crypto'
}

export const STD_INTRINSICS: StdIntrinsicSpec[] = [
  {
    symbol: 'console.print',
    aliases: ['print', 'println', 'std::io::print', 'std::io::println', 'console.print'],
    params: [T_ANY],
    variadicAny: true,
    returnType: T_VOID,
    capability: 'console',
  },
  {
    symbol: 'std::conv::to_str',
    aliases: ['to_str', 'std::conv::to_str'],
    params: [T_ANY],
    returnType: T_STR,
    capability: 'pure',
  },
  {
    symbol: 'std::conv::to_f64',
    aliases: ['to_f64', 'std::conv::to_f64'],
    params: [T_I64],
    returnType: T_F64,
    capability: 'pure',
  },
  {
    symbol: 'std::conv::to_i64',
    aliases: ['to_i64', 'std::conv::to_i64'],
    params: [T_F64],
    returnType: T_I64,
    capability: 'pure',
  },
  {
    symbol: 'std::math::abs',
    aliases: ['abs', 'math.abs', 'std::math::abs'],
    params: [T_I64],
    returnType: T_I64,
    capability: 'pure',
  },
  {
    symbol: 'std::math::abs_f64',
    aliases: ['abs_f64', 'std::math::abs_f64'],
    params: [T_F64],
    returnType: T_F64,
    capability: 'pure',
  },
  {
    symbol: 'std::math::min',
    aliases: ['min', 'math.min', 'std::math::min'],
    params: [T_I64, T_I64],
    returnType: T_I64,
    capability: 'pure',
  },
  {
    symbol: 'std::math::max',
    aliases: ['max', 'math.max', 'std::math::max'],
    params: [T_I64, T_I64],
    returnType: T_I64,
    capability: 'pure',
  },
  {
    symbol: 'std::math::sqrt',
    aliases: ['sqrt', 'math.sqrt', 'std::math::sqrt'],
    params: [T_F64],
    returnType: T_F64,
    capability: 'pure',
  },
  {
    symbol: 'std::str::len',
    aliases: ['len', 'str.len', 'std::str::len'],
    params: [T_ANY],
    returnType: T_I64,
    capability: 'pure',
  },
  {
    symbol: 'std::str::upper',
    aliases: ['str.upper', 'std::str::upper'],
    params: [T_STR],
    returnType: T_STR,
    capability: 'pure',
  },
  {
    symbol: 'std::str::lower',
    aliases: ['str.lower', 'std::str::lower'],
    params: [T_STR],
    returnType: T_STR,
    capability: 'pure',
  },
  {
    symbol: 'std::str::trim',
    aliases: ['str.trim', 'std::str::trim'],
    params: [T_STR],
    returnType: T_STR,
    capability: 'pure',
  },
  {
    symbol: 'std::str::contains',
    aliases: ['str.contains', 'std::str::contains'],
    params: [T_STR, T_STR],
    returnType: T_BOOL,
    capability: 'pure',
  },
  {
    symbol: 'time.now',
    aliases: ['time.now', 'std::time::now'],
    params: [],
    returnType: T_I64,
    capability: 'time',
  },
  {
    symbol: 'fs.read_text',
    aliases: ['fs.read_text', 'std::fs::read_text'],
    params: [T_STR],
    returnType: T_STR,
    capability: 'fs.read',
  },
  {
    symbol: 'fs.write_text',
    aliases: ['fs.write_text', 'std::fs::write_text'],
    params: [T_STR, T_STR],
    returnType: T_BOOL,
    capability: 'fs.write',
  },
  {
    symbol: 'net.get',
    aliases: ['net.get', 'std::net::get', 'fetch'],
    params: [T_STR],
    returnType: T_STR,
    capability: 'net',
  },
  {
    symbol: 'db.query',
    aliases: ['db.query', 'std::db::query'],
    params: [T_STR],
    returnType: T_STR,
    capability: 'db',
  },
  {
    symbol: 'crypto.hash',
    aliases: ['crypto.hash', 'std::crypto::sha256', 'std::crypto::hash'],
    params: [T_STR],
    returnType: T_STR,
    capability: 'crypto',
  },
];

export function lookupStdIntrinsic(callee: string): StdIntrinsicSpec | undefined {
  for (const spec of STD_INTRINSICS) {
    if (spec.aliases.includes(callee)) return spec;
  }
  return undefined;
}

export function resolveTypeNode(
  node: TypeNode,
  structs: Map<string, SemanticType>,
  enums: Map<string, SemanticType>,
  typeParams: Set<string>,
  diagnostics: SemanticDiagnostic[]
): SemanticType {
  switch (node.kind) {
    case 'InferredType':
      return T_ANY;
    case 'PrimitiveType':
      switch (node.name) {
        case 'i64':
          return T_I64;
        case 'f64':
          return T_F64;
        case 'bool':
          return T_BOOL;
        case 'str':
          return T_STR;
        case 'void':
          return T_VOID;
        case 'any':
          return T_ANY;
      }
      return T_ANY;
    case 'ArrayType':
      return {
        kind: 'array',
        element: resolveTypeNode(node.elementType, structs, enums, typeParams, diagnostics),
      };
    case 'MapType':
      return {
        kind: 'map',
        key: resolveTypeNode(node.keyType, structs, enums, typeParams, diagnostics),
        value: resolveTypeNode(node.valueType, structs, enums, typeParams, diagnostics),
      };
    case 'ResultType':
      return {
        kind: 'result',
        ok: resolveTypeNode(node.okType, structs, enums, typeParams, diagnostics),
        err: resolveTypeNode(node.errType, structs, enums, typeParams, diagnostics),
      };
    case 'NamedType': {
      if (typeParams.has(node.name)) {
        return { kind: 'type_param', name: node.name };
      }
      const st = structs.get(node.name);
      if (st && st.kind === 'struct') {
        const resolvedArgs = node.typeArgs.map((a) =>
          resolveTypeNode(a, structs, enums, typeParams, diagnostics)
        );
        return { ...st, typeArgs: resolvedArgs };
      }
      const en = enums.get(node.name);
      if (en && en.kind === 'enum') {
        const resolvedArgs = node.typeArgs.map((a) =>
          resolveTypeNode(a, structs, enums, typeParams, diagnostics)
        );
        return { ...en, typeArgs: resolvedArgs };
      }
      diagnostics.push({
        code: 'E_UNKNOWN_TYPE',
        severity: 'error',
        message: `Unknown type '${node.name}'`,
        line: node.span.line,
        column: node.span.column,
        file: node.span.file,
      });
      return T_ANY;
    }
  }
}

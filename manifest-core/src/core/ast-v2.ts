import { SyntaxProfile } from './profile.ts';

export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  file?: string;
}

export type TypeNode =
  | { kind: 'PrimitiveType'; name: 'i64' | 'f64' | 'bool' | 'str' | 'void' | 'any'; span: SourceSpan }
  | { kind: 'NamedType'; name: string; typeArgs: TypeNode[]; span: SourceSpan }
  | { kind: 'ArrayType'; elementType: TypeNode; span: SourceSpan }
  | { kind: 'MapType'; keyType: TypeNode; valueType: TypeNode; span: SourceSpan }
  | { kind: 'ResultType'; okType: TypeNode; errType: TypeNode; span: SourceSpan }
  | { kind: 'InferredType'; span: SourceSpan };

export interface CapabilitySummaryDecl {
  requires: Array<{ name: string; span: SourceSpan }>;
  provides: Array<{ name: string; span: SourceSpan }>;
  denies: Array<{ name: string; span: SourceSpan }>;
}

export interface ImportDecl {
  from: string;
  symbols: Array<{ name: string; alias?: string }>;
  span: SourceSpan;
}

export interface StructFieldDecl {
  name: string;
  type: TypeNode;
  span: SourceSpan;
}

export interface StructDecl {
  name: string;
  exported: boolean;
  typeParams: string[];
  fields: StructFieldDecl[];
  span: SourceSpan;
}

export interface EnumVariantDecl {
  name: string;
  payloadTypes: TypeNode[];
  span: SourceSpan;
}

export interface EnumDecl {
  name: string;
  exported: boolean;
  typeParams: string[];
  variants: EnumVariantDecl[];
  span: SourceSpan;
}

export interface FnParamDecl {
  name: string;
  type: TypeNode;
  span: SourceSpan;
}

export interface TraitMethodSig {
  name: string;
  params: FnParamDecl[];
  returnType: TypeNode;
  effects: string[];
  span: SourceSpan;
}

export interface TraitDecl {
  name: string;
  exported: boolean;
  typeParams: string[];
  methods: TraitMethodSig[];
  span: SourceSpan;
}

export interface ConstDecl {
  name: string;
  exported: boolean;
  typeAnnotation: TypeNode;
  init: SemanticExpr;
  span: SourceSpan;
}

export interface VarDecl {
  name: string;
  mutable: boolean;
  exported: boolean;
  typeAnnotation: TypeNode;
  init: SemanticExpr;
  span: SourceSpan;
}

export interface FnDecl {
  name: string;
  exported: boolean;
  isAsync: boolean;
  typeParams: string[];
  params: FnParamDecl[];
  returnType: TypeNode;
  effects: string[];
  hasExplicitEffects: boolean;
  body: SemanticStmt[];
  span: SourceSpan;
}

export interface MatchArm {
  pattern: MatchPattern;
  body: SemanticStmt[];
  span: SourceSpan;
}

export type MatchPattern =
  | { kind: 'WildcardPattern'; span: SourceSpan }
  | { kind: 'LiteralPattern'; value: number | boolean | string; isFloat?: boolean; span: SourceSpan }
  | {
      kind: 'EnumVariantPattern';
      enumName?: string;
      variantName: string;
      bindings: string[];
      span: SourceSpan;
    };

export type SemanticStmt =
  | { kind: 'VarStmt'; decl: VarDecl; span: SourceSpan }
  | { kind: 'ConstStmt'; decl: ConstDecl; span: SourceSpan }
  | { kind: 'AssignStmt'; target: AssignTarget; value: SemanticExpr; span: SourceSpan }
  | { kind: 'ExprStmt'; expr: SemanticExpr; span: SourceSpan }
  | {
      kind: 'IfStmt';
      condition: SemanticExpr;
      thenBranch: SemanticStmt[];
      elseBranch: SemanticStmt[];
      span: SourceSpan;
    }
  | { kind: 'WhileStmt'; condition: SemanticExpr; body: SemanticStmt[]; span: SourceSpan }
  | {
      kind: 'ForInStmt';
      itemName: string;
      iterable: SemanticExpr;
      body: SemanticStmt[];
      span: SourceSpan;
    }
  | { kind: 'RepeatStmt'; count: SemanticExpr; body: SemanticStmt[]; span: SourceSpan }
  | { kind: 'BreakStmt'; span: SourceSpan }
  | { kind: 'ContinueStmt'; span: SourceSpan }
  | { kind: 'ReturnStmt'; value?: SemanticExpr; span: SourceSpan }
  | { kind: 'MatchStmt'; subject: SemanticExpr; arms: MatchArm[]; span: SourceSpan }
  | {
      kind: 'TryStmt';
      tryBody: SemanticStmt[];
      errBinding?: string;
      catchBody: SemanticStmt[];
      span: SourceSpan;
    };

export type AssignTarget =
  | { kind: 'VarTarget'; name: string; span: SourceSpan }
  | { kind: 'FieldTarget'; object: SemanticExpr; field: string; span: SourceSpan }
  | { kind: 'IndexTarget'; object: SemanticExpr; index: SemanticExpr; span: SourceSpan };

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

export type UnaryOp = '-' | '!';

export type SemanticExpr =
  | { kind: 'IntLiteral'; value: bigint; raw: string; span: SourceSpan }
  | { kind: 'FloatLiteral'; value: number; raw: string; span: SourceSpan }
  | { kind: 'BoolLiteral'; value: boolean; span: SourceSpan }
  | { kind: 'StringLiteral'; value: string; span: SourceSpan }
  | { kind: 'Identifier'; name: string; span: SourceSpan }
  | { kind: 'BinaryExpr'; op: BinaryOp; left: SemanticExpr; right: SemanticExpr; span: SourceSpan }
  | { kind: 'UnaryExpr'; op: UnaryOp; operand: SemanticExpr; span: SourceSpan }
  | {
      kind: 'CallExpr';
      callee: string;
      typeArgs: TypeNode[];
      args: SemanticExpr[];
      span: SourceSpan;
    }
  | { kind: 'FieldAccessExpr'; object: SemanticExpr; field: string; span: SourceSpan }
  | { kind: 'IndexAccessExpr'; object: SemanticExpr; index: SemanticExpr; span: SourceSpan }
  | { kind: 'ArrayLiteral'; elements: SemanticExpr[]; span: SourceSpan }
  | {
      kind: 'MapLiteral';
      entries: Array<{ key: SemanticExpr; value: SemanticExpr }>;
      span: SourceSpan;
    }
  | {
      kind: 'StructLiteral';
      structName: string;
      typeArgs: TypeNode[];
      fields: Array<{ name: string; value: SemanticExpr; span: SourceSpan }>;
      span: SourceSpan;
    }
  | {
      kind: 'EnumConstructExpr';
      enumName: string;
      variantName: string;
      args: SemanticExpr[];
      span: SourceSpan;
    }
  | { kind: 'AwaitExpr'; operand: SemanticExpr; span: SourceSpan }
  | { kind: 'TryPropagateExpr'; operand: SemanticExpr; span: SourceSpan };

export interface SemanticModule {
  kind: 'SemanticModule';
  profile: SyntaxProfile;
  moduleName: string;
  isLegacyApp: boolean;
  hasDomainExtensions: {
    webUI: boolean;
    solanaContract: boolean;
  };
  imports: ImportDecl[];
  capabilities: CapabilitySummaryDecl;
  structs: StructDecl[];
  enums: EnumDecl[];
  traits: TraitDecl[];
  constants: ConstDecl[];
  globals: VarDecl[];
  functions: FnDecl[];
  topLevelStmts: SemanticStmt[];
  span: SourceSpan;
}

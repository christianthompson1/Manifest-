import { BinaryOp, SemanticExpr, UnaryOp } from './ast-v2.ts';

/**
 * Canonical operator precedence table shared by parsers and formatter.
 * Higher integer values bind tighter.
 */
export const PRECEDENCE_LEVELS = {
  OR: 1,
  AND: 2,
  EQUALITY: 3,
  COMPARISON: 4,
  ADDITIVE: 5,
  MULTIPLICATIVE: 6,
  UNARY: 7,
  POSTFIX: 8,
  PRIMARY: 9,
} as const;

export const BINARY_OP_PRECEDENCE: Record<BinaryOp, number> = {
  '||': PRECEDENCE_LEVELS.OR,
  '&&': PRECEDENCE_LEVELS.AND,
  '==': PRECEDENCE_LEVELS.EQUALITY,
  '!=': PRECEDENCE_LEVELS.EQUALITY,
  '<': PRECEDENCE_LEVELS.COMPARISON,
  '<=': PRECEDENCE_LEVELS.COMPARISON,
  '>': PRECEDENCE_LEVELS.COMPARISON,
  '>=': PRECEDENCE_LEVELS.COMPARISON,
  '+': PRECEDENCE_LEVELS.ADDITIVE,
  '-': PRECEDENCE_LEVELS.ADDITIVE,
  '*': PRECEDENCE_LEVELS.MULTIPLICATIVE,
  '/': PRECEDENCE_LEVELS.MULTIPLICATIVE,
  '%': PRECEDENCE_LEVELS.MULTIPLICATIVE,
};

export function getBinaryOpPrecedence(op: BinaryOp): number {
  return BINARY_OP_PRECEDENCE[op];
}

export function getExprPrecedence(expr: SemanticExpr): number {
  switch (expr.kind) {
    case 'BinaryExpr':
      return getBinaryOpPrecedence(expr.op);
    case 'UnaryExpr':
    case 'AwaitExpr':
      return PRECEDENCE_LEVELS.UNARY;
    case 'FieldAccessExpr':
    case 'IndexAccessExpr':
    case 'TryPropagateExpr':
      return PRECEDENCE_LEVELS.POSTFIX;
    case 'IntLiteral':
    case 'FloatLiteral':
    case 'BoolLiteral':
    case 'StringLiteral':
    case 'Identifier':
    case 'CallExpr':
    case 'ArrayLiteral':
    case 'MapLiteral':
    case 'StructLiteral':
    case 'EnumConstructExpr':
      return PRECEDENCE_LEVELS.PRIMARY;
  }
}

export function needsParensForBinaryLeft(parentOp: BinaryOp, left: SemanticExpr): boolean {
  return getExprPrecedence(left) < getBinaryOpPrecedence(parentOp);
}

/**
 * Right-hand children of left-associative binary operators must be parenthesized
 * whenever their precedence is less than or equal to the parent's precedence.
 * Using `<=` preserves non-associative operations (`a - (b - c)`, `a / (b / c)`),
 * checked i64 overflow behavior (`MAX + (1 - 1)`), string concatenation order,
 * and exact normalized AST equivalence.
 */
export function needsParensForBinaryRight(parentOp: BinaryOp, right: SemanticExpr): boolean {
  return getExprPrecedence(right) <= getBinaryOpPrecedence(parentOp);
}

export function needsParensForUnary(parentOp: UnaryOp | 'await', operand: SemanticExpr): boolean {
  if (getExprPrecedence(operand) < PRECEDENCE_LEVELS.UNARY) {
    return true;
  }
  // Prevent `-` followed by `-` from forming a `--` line comment token.
  if (parentOp === '-' && operand.kind === 'UnaryExpr' && operand.op === '-') {
    return true;
  }
  if (parentOp === '-' && operand.kind === 'IntLiteral' && operand.raw.startsWith('-')) {
    return true;
  }
  return false;
}

export function needsParensForPostfix(base: SemanticExpr): boolean {
  return getExprPrecedence(base) < PRECEDENCE_LEVELS.POSTFIX;
}

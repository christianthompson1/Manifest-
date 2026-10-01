/**
 * Manifest Core v0.1 - Runtime Values & Operations
 * Pure, safe data representation without eval() or JS escapes.
 */

import { ManifestError } from '../errors/manifest-error.ts';
import { StatementNode } from '../ast/ast.ts';
import { Scope } from './scope.ts';

export type ManifestValue =
  | string
  | number
  | boolean
  | null
  | ManifestValue[]
  | ManifestActionValue;

export interface ManifestActionValue {
  type: 'action';
  name: string;
  params: string[];
  body: StatementNode[];
  closure: Scope;
}

/**
 * Converts a ManifestValue into a clean human-readable string for SHOW.
 */
export function stringifyManifestValue(val: ManifestValue): string {
  if (val === null) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return '[' + val.map((item) => (typeof item === 'string' ? `"${item}"` : stringifyManifestValue(item))).join(', ') + ']';
  }
  if (typeof val === 'object' && val.type === 'action') {
    return `<Action: ${val.name}>`;
  }
  return String(val);
}

/**
 * Checks equality between two Manifest values.
 */
export function areValuesEqual(a: ManifestValue, b: ManifestValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areValuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Determines truthiness for conditional checks.
 * false, null, 0, and "" are falsy; all other values are truthy.
 */
export function isTruthy(val: ManifestValue): boolean {
  if (val === null) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0 && !isNaN(val);
  if (typeof val === 'string') return val.length > 0;
  if (Array.isArray(val)) return true;
  return true;
}

/**
 * Performs binary arithmetic and comparisons cleanly and safely.
 */
export function evaluateBinaryOp(
  op: string,
  left: ManifestValue,
  right: ManifestValue,
  line: number
): ManifestValue {
  switch (op) {
    case '+': {
      if (typeof left === 'number' && typeof right === 'number') {
        return left + right;
      }
      // String concatenation if either side is a string
      return stringifyManifestValue(left) + stringifyManifestValue(right);
    }

    case '-': {
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new ManifestError({
          message: `Cannot subtract '${stringifyManifestValue(right)}' from '${stringifyManifestValue(left)}'. Both must be numbers.`,
          line,
          phase: 'runtime',
          hint: 'Make sure both values in a subtraction are numbers.',
          example: 'SET balance TO balance - 10',
        });
      }
      return left - right;
    }

    case '*': {
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new ManifestError({
          message: `Cannot multiply non-numeric values.`,
          line,
          phase: 'runtime',
          hint: 'Multiplication requires numbers on both sides.',
          example: 'SET total TO price * quantity',
        });
      }
      return left * right;
    }

    case '/': {
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new ManifestError({
          message: `Cannot divide non-numeric values.`,
          line,
          phase: 'runtime',
          example: 'SET avg TO total / count',
        });
      }
      if (right === 0) {
        throw new ManifestError({
          message: 'Division by zero is not allowed.',
          line,
          phase: 'runtime',
          hint: 'Check that the divisor is greater than zero before dividing.',
          example: 'IF count > 0\n    SET avg TO total / count\nEND',
        });
      }
      return left / right;
    }

    case '%': {
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new ManifestError({
          message: `Cannot perform modulo (%) on non-numeric values.`,
          line,
          phase: 'runtime',
        });
      }
      if (right === 0) {
        throw new ManifestError({
          message: 'Modulo by zero is not allowed.',
          line,
          phase: 'runtime',
        });
      }
      return left % right;
    }

    case '==':
      return areValuesEqual(left, right);

    case '!=':
    case '<>':
    case '«»':
      return !areValuesEqual(left, right);

    case '<':
      if (typeof left === 'number' && typeof right === 'number') return left < right;
      if (typeof left === 'string' && typeof right === 'string') return left < right;
      throw new ManifestError({
        message: `Cannot compare '<' between different or non-orderable types.`,
        line,
        phase: 'runtime',
      });

    case '>':
      if (typeof left === 'number' && typeof right === 'number') return left > right;
      if (typeof left === 'string' && typeof right === 'string') return left > right;
      throw new ManifestError({
        message: `Cannot compare '>' between different or non-orderable types.`,
        line,
        phase: 'runtime',
      });

    case '<=':
    case '«=»':
      if (typeof left === 'number' && typeof right === 'number') return left <= right;
      if (typeof left === 'string' && typeof right === 'string') return left <= right;
      throw new ManifestError({
        message: `Cannot compare '<=' between different or non-orderable types.`,
        line,
        phase: 'runtime',
      });

    case '>=':
    case '«>=»':
      if (typeof left === 'number' && typeof right === 'number') return left >= right;
      if (typeof left === 'string' && typeof right === 'string') return left >= right;
      throw new ManifestError({
        message: `Cannot compare '>=' between different or non-orderable types.`,
        line,
        phase: 'runtime',
      });

    case 'AND':
      return isTruthy(left) && isTruthy(right);

    case 'OR':
      return isTruthy(left) || isTruthy(right);

    default:
      throw new ManifestError({
        message: `Unknown operator: '${op}'`,
        line,
        phase: 'runtime',
      });
  }
}

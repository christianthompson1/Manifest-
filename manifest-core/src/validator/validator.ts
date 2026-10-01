/**
 * Manifest Core v0.1 - Semantic Validator
 * Performs static safety checks before runtime execution.
 */

import {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  ActionDeclarationNode,
  WhenStatementNode,
  SetStatementNode,
  ForEachStatementNode,
} from '../ast/ast.ts';
import { ManifestError } from '../errors/manifest-error.ts';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  line: number;
  column?: number;
  hint?: string;
  example?: string;
}

export class Validator {
  private readonly program: ProgramNode;
  private readonly sourceLines: string[];
  private readonly actions: Map<string, ActionDeclarationNode> = new Map();
  private readonly knownEvents: Set<string> = new Set([
    'app.starts',
    'app.stops',
    'click',
    'submit',
    'change',
    'button.clicks',
  ]);
  public issues: ValidationIssue[] = [];

  constructor(program: ProgramNode, source: string = '') {
    this.program = program;
    this.sourceLines = source.split('\n');
  }

  public validate(): { isValid: boolean; issues: ValidationIssue[] } {
    this.issues = [];
    this.actions.clear();

    // Pass 1: Index all ACTION declarations
    for (const stmt of this.program.statements) {
      if (stmt.type === 'ActionDeclaration') {
        if (this.actions.has(stmt.name)) {
          this.issues.push({
            severity: 'error',
            message: `The action '${stmt.name}' has been defined more than once.`,
            line: stmt.line,
            hint: 'Use a unique name for each ACTION.',
            example: `ACTION ${stmt.name}_v2\n    ...\nEND`,
          });
        }
        this.actions.set(stmt.name, stmt);
      }
    }

    // Pass 2: Validate statements with scope tracking
    const globalVars = new Set<string>();

    for (const stmt of this.program.statements) {
      this.validateStatement(stmt, globalVars, false);
    }

    const hasErrors = this.issues.some((issue) => issue.severity === 'error');
    return {
      isValid: !hasErrors,
      issues: this.issues,
    };
  }

  /**
   * Runs validation and throws the first fatal ManifestError if any error is encountered.
   */
  public ensureValid(): void {
    const result = this.validate();
    const firstError = result.issues.find((issue) => issue.severity === 'error');
    if (firstError) {
      throw new ManifestError({
        message: firstError.message,
        line: firstError.line,
        column: firstError.column ?? 1,
        sourceLine: this.sourceLines[firstError.line - 1] ?? '',
        hint: firstError.hint,
        example: firstError.example,
        phase: 'validator',
      });
    }
  }

  private validateStatement(
    stmt: StatementNode,
    scopeVars: Set<string>,
    insideAction: boolean
  ): void {
    switch (stmt.type) {
      case 'SetStatement': {
        this.validateExpression(stmt.value, scopeVars);
        scopeVars.add(stmt.variable);
        break;
      }

      case 'ShowStatement': {
        this.validateExpression(stmt.expression, scopeVars);
        break;
      }

      case 'IfStatement': {
        this.validateExpression(stmt.condition, scopeVars);
        const ifScope = new Set(scopeVars);
        for (const s of stmt.consequent) {
          this.validateStatement(s, ifScope, insideAction);
        }
        if (stmt.elseIfBranches) {
          for (const branch of stmt.elseIfBranches) {
            this.validateExpression(branch.condition, scopeVars);
            const branchScope = new Set(scopeVars);
            for (const s of branch.body) {
              this.validateStatement(s, branchScope, insideAction);
            }
          }
        }
        if (stmt.alternate) {
          const elseScope = new Set(scopeVars);
          for (const s of stmt.alternate) {
            this.validateStatement(s, elseScope, insideAction);
          }
        }
        break;
      }

      case 'WhenStatement': {
        this.validateWhenStatement(stmt, scopeVars);
        break;
      }

      case 'RepeatStatement': {
        this.validateExpression(stmt.count, scopeVars);
        const loopScope = new Set(scopeVars);
        for (const s of stmt.body) {
          this.validateStatement(s, loopScope, insideAction);
        }
        break;
      }

      case 'ForEachStatement': {
        this.validateExpression(stmt.collection, scopeVars);
        const loopScope = new Set(scopeVars);
        loopScope.add(stmt.itemVar);
        for (const s of stmt.body) {
          this.validateStatement(s, loopScope, insideAction);
        }
        break;
      }

      case 'ActionDeclaration': {
        const actionScope = new Set(scopeVars);
        for (const param of stmt.params) {
          actionScope.add(param);
        }
        for (const s of stmt.body) {
          this.validateStatement(s, actionScope, true);
        }
        break;
      }

      case 'CallStatement': {
        if (!this.actions.has(stmt.actionName)) {
          this.issues.push({
            severity: 'error',
            message: `You called '${stmt.actionName}', but no ACTION with that name exists.`,
            line: stmt.line,
            hint: `Make sure you have defined 'ACTION ${stmt.actionName}' before calling it.`,
            example: `ACTION ${stmt.actionName}\n    SHOW "Hello"\nEND\n\nCALL ${stmt.actionName}`,
          });
        } else {
          const actionDecl = this.actions.get(stmt.actionName)!;
          if (stmt.args.length !== actionDecl.params.length) {
            this.issues.push({
              severity: 'error',
              message: `Action '${stmt.actionName}' expects ${actionDecl.params.length} argument(s), but you gave ${stmt.args.length}.`,
              line: stmt.line,
              hint: `Parameters expected: ${actionDecl.params.join(', ') || 'none'}`,
              example: `CALL ${stmt.actionName} ${actionDecl.params.join(' ')}`,
            });
          }
        }
        for (const arg of stmt.args) {
          this.validateExpression(arg, scopeVars);
        }
        break;
      }

      case 'ReturnStatement': {
        if (!insideAction) {
          this.issues.push({
            severity: 'error',
            message: 'RETURN can only be used inside an ACTION block.',
            line: stmt.line,
            hint: 'Remove RETURN, or wrap this code inside an ACTION block.',
            example: 'ACTION compute\n    RETURN 42\nEND',
          });
        }
        if (stmt.value) {
          this.validateExpression(stmt.value, scopeVars);
        }
        break;
      }

      case 'TryStatement': {
        const tryScope = new Set(scopeVars);
        for (const s of stmt.tryBlock) {
          this.validateStatement(s, tryScope, insideAction);
        }
        const catchScope = new Set(scopeVars);
        for (const s of stmt.catchBlock) {
          this.validateStatement(s, catchScope, insideAction);
        }
        break;
      }

      // Manifest v0.2 Application Primitives
      case 'StateDeclaration': {
        this.validateExpression(stmt.value, scopeVars);
        scopeVars.add(stmt.variable);
        break;
      }

      case 'PageDeclaration': {
        if (!this.program.appName) {
          this.issues.push({
            severity: 'error',
            message: 'PAGE used outside APP. Declare APP at the beginning of the program.',
            line: stmt.line,
            hint: 'Add an APP "Name" declaration at the top.',
            example: 'APP "My App"\n\nPAGE Home\n    TEXT "Hello"\nEND',
          });
        }
        const pageScope = new Set(scopeVars);
        for (const s of stmt.body) {
          this.validateStatement(s, pageScope, insideAction);
        }
        break;
      }

      case 'Text': {
        this.validateExpression(stmt.expression, scopeVars);
        break;
      }

      case 'Button': {
        if (!stmt.label) {
          this.issues.push({
            severity: 'error',
            message: 'BUTTON is missing required label content.',
            line: stmt.line,
            hint: 'Specify a button label expression, like BUTTON "Click Me".',
            example: 'BUTTON "Click Me"\n    WHEN CLICK\n        ...\n    END\nEND',
          });
        } else {
          this.validateExpression(stmt.label, scopeVars);
        }
        for (const handler of stmt.eventHandlers) {
          this.validateWhenStatement(handler, scopeVars);
        }
        break;
      }

      case 'Input': {
        if (stmt.placeholder) {
          this.validateExpression(stmt.placeholder, scopeVars);
        }
        if (stmt.targetVariable) {
          scopeVars.add(stmt.targetVariable);
        }
        break;
      }

      case 'Image': {
        this.validateExpression(stmt.src, scopeVars);
        if (stmt.alt) {
          this.validateExpression(stmt.alt, scopeVars);
        }
        break;
      }

      case 'Form': {
        const formScope = new Set(scopeVars);
        for (const s of stmt.body) {
          this.validateStatement(s, formScope, insideAction);
        }
        for (const handler of stmt.eventHandlers) {
          this.validateWhenStatement(handler, formScope);
        }
        break;
      }

      case 'Container': {
        const containerScope = new Set(scopeVars);
        for (const child of stmt.children) {
          this.validateStatement(child, containerScope, insideAction);
        }
        break;
      }

      case 'Card':
      case 'Header':
      case 'Footer':
      case 'Nav':
      case 'Modal': {
        const subScope = new Set(scopeVars);
        for (const child of stmt.children) {
          this.validateStatement(child, subScope, insideAction);
        }
        break;
      }

      case 'List': {
        const listScope = new Set(scopeVars);
        if (stmt.collection) {
          this.validateExpression(stmt.collection, scopeVars);
        }
        if (stmt.itemVar) {
          listScope.add(stmt.itemVar);
        }
        for (const child of stmt.children) {
          this.validateStatement(child, listScope, insideAction);
        }
        break;
      }

      case 'Link': {
        this.validateExpression(stmt.label, scopeVars);
        this.validateExpression(stmt.target, scopeVars);
        break;
      }

      case 'Select': {
        if (stmt.bindVariable) {
          scopeVars.add(stmt.bindVariable);
        }
        break;
      }

      case 'Checkbox': {
        if (stmt.label) {
          this.validateExpression(stmt.label, scopeVars);
        }
        if (stmt.bindVariable) {
          scopeVars.add(stmt.bindVariable);
        }
        break;
      }

      case 'Textarea': {
        if (stmt.placeholder) {
          this.validateExpression(stmt.placeholder, scopeVars);
        }
        if (stmt.bindVariable) {
          scopeVars.add(stmt.bindVariable);
        }
        break;
      }

      case 'ComponentDeclaration': {
        const compScope = new Set(scopeVars);
        for (const p of stmt.params) {
          compScope.add(p);
        }
        for (const s of stmt.body) {
          this.validateStatement(s, compScope, insideAction);
        }
        break;
      }

      case 'ComponentCall': {
        for (const propExpr of Object.values(stmt.props)) {
          this.validateExpression(propExpr, scopeVars);
        }
        break;
      }

      case 'RouteDeclaration': {
        if (!stmt.path || !stmt.path.startsWith('/')) {
          this.issues.push({
            severity: 'warning',
            message: `Route path '${stmt.path}' should ideally begin with '/'.`,
            line: stmt.line,
            hint: 'Use a path like "/" or "/about".',
            example: 'ROUTE "/" TO Home',
          });
        }
        break;
      }

      case 'AppDeclaration':
      case 'UseDeclaration':
        break;
    }
  }

  private validateWhenStatement(stmt: WhenStatementNode, parentScope: Set<string>): void {
    if (!this.knownEvents.has(stmt.eventName)) {
      // Not a fatal error since Manifest events are extensible, but record a warning
      this.issues.push({
        severity: 'warning',
        message: `'${stmt.eventName}' is not a built-in event. Custom events will only trigger when fired by an external capability.`,
        line: stmt.line,
        hint: "Standard event for program startup is 'app.starts'.",
        example: 'WHEN app.starts\n    SHOW "Hello World"\nEND',
      });
    }

    const eventScope = new Set(parentScope);
    for (const s of stmt.body) {
      this.validateStatement(s, eventScope, false);
    }
  }

  private validateExpression(expr: ExpressionNode, scopeVars: Set<string>): void {
    switch (expr.type) {
      case 'VariableReference': {
        if (!scopeVars.has(expr.name)) {
          // Warning / check for uninitialized variable
          this.issues.push({
            severity: 'warning',
            message: `Variable '${expr.name}' might be used before being SET.`,
            line: expr.line,
            hint: `Define it first using 'SET ${expr.name} TO <value>'.`,
            example: `SET ${expr.name} TO 0`,
          });
        }
        break;
      }

      case 'BinaryExpression': {
        this.validateExpression(expr.left, scopeVars);
        this.validateExpression(expr.right, scopeVars);
        break;
      }

      case 'UnaryExpression': {
        this.validateExpression(expr.argument, scopeVars);
        break;
      }

      case 'ArrayLiteral': {
        for (const el of expr.elements) {
          this.validateExpression(el, scopeVars);
        }
        break;
      }

      case 'IndexAccess': {
        this.validateExpression(expr.target, scopeVars);
        this.validateExpression(expr.index, scopeVars);
        break;
      }

      case 'CallExpression': {
        if (!this.actions.has(expr.actionName)) {
          this.issues.push({
            severity: 'error',
            message: `You called '${expr.actionName}', but no ACTION with that name exists.`,
            line: expr.line,
            hint: `Make sure to declare 'ACTION ${expr.actionName}' before calling it.`,
            example: `ACTION ${expr.actionName}\n    RETURN 10\nEND`,
          });
        } else {
          const actionDecl = this.actions.get(expr.actionName)!;
          if (expr.args.length !== actionDecl.params.length) {
            this.issues.push({
              severity: 'error',
              message: `Action '${expr.actionName}' expects ${actionDecl.params.length} argument(s), but you gave ${expr.args.length}.`,
              line: expr.line,
              hint: `Parameters: ${actionDecl.params.join(', ') || 'none'}`,
              example: `CALL ${expr.actionName} ${actionDecl.params.join(' ')}`,
            });
          }
        }
        for (const arg of expr.args) {
          this.validateExpression(arg, scopeVars);
        }
        break;
      }

      case 'Literal':
        break;
    }
  }
}

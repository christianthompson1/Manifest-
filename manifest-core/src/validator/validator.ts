import { AppDeclarationNode, StatementNode, ExpressionNode, ActionDefinitionNode } from '../ast/ast.ts';
import { DiagnosticIssue } from '../errors/manifest-error.ts';

export interface ValidationResult {
  isValid: boolean;
  issues: DiagnosticIssue[];
}

interface ValidationContext {
  inAction: boolean;
  inTry: boolean;
}

export class Validator {
  private ast?: AppDeclarationNode;
  private source?: string;

  constructor(ast?: AppDeclarationNode, source?: string) {
    this.ast = ast;
    this.source = source;
  }

  public validate(astNode?: AppDeclarationNode): ValidationResult {
    const ast = astNode || this.ast;
    const issues: DiagnosticIssue[] = [];

    if (!ast) {
      return { isValid: true, issues: [] };
    }

    if (!ast.name || ast.name.trim() === '') {
      issues.push({
        line: ast.line || 1,
        column: ast.column || 1,
        message: 'Application name cannot be empty',
        severity: 'error',
        hint: 'Use APP "YourAppName"',
      });
    }

    const declaredVariables = new Set<string>();
    const declaredActions = new Map<string, ActionDefinitionNode>();
    const declaredPages = new Set<string>();

    const statements: StatementNode[] = ast.body || ast.statements || [];

    // Pass 1: Collect top-level declarations (supports forward references to ACTIONs and PAGEs)
    for (const stmt of statements) {
      if (!stmt) continue;
      if (stmt.type === 'ActionDefinition' || stmt.type === 'ActionDeclaration') {
        if (declaredActions.has(stmt.name)) {
          issues.push({
            line: stmt.line || 1,
            column: stmt.column || 1,
            message: `Duplicate ACTION declaration: "${stmt.name}" is already defined`,
            severity: 'error',
            hint: `Rename one of the "${stmt.name}" actions so each ACTION has a unique name.`,
          });
        } else {
          declaredActions.set(stmt.name, stmt);
        }
      } else if (stmt.type === 'PageDeclaration') {
        if (declaredPages.has(stmt.name)) {
          issues.push({
            line: stmt.line || 1,
            column: stmt.column || 1,
            message: `Duplicate PAGE declaration: "${stmt.name}" is already defined`,
            severity: 'error',
            hint: `Use unique page names for each PAGE block.`,
          });
        } else {
          declaredPages.add(stmt.name);
        }
      } else if (stmt.type === 'SetStatement') {
        declaredVariables.add(stmt.variable);
      } else if (stmt.type === 'StateDeclaration') {
        declaredVariables.add(stmt.name);
      }
    }

    // Pass 2: Semantic validation across statements and expressions
    this.validateStatements(
      statements,
      declaredVariables,
      declaredActions,
      declaredPages,
      issues,
      { inAction: false, inTry: false }
    );

    return {
      isValid: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
    };
  }

  public ensureValid(astNode?: AppDeclarationNode): ValidationResult {
    const result = this.validate(astNode);
    if (!result.isValid) {
      const firstErr = result.issues.find((i) => i.severity === 'error') || result.issues[0];
      throw new Error(firstErr ? firstErr.message : 'Validation failed');
    }
    return result;
  }

  private validateStatements(
    statements: StatementNode[],
    variables: Set<string>,
    actions: Map<string, ActionDefinitionNode>,
    pages: Set<string>,
    issues: DiagnosticIssue[],
    ctx: ValidationContext
  ): void {
    for (const stmt of statements) {
      if (!stmt) continue;

      switch (stmt.type) {
        case 'SetStatement': {
          this.validateExpression(stmt.value, variables, actions, issues, ctx);
          variables.add(stmt.variable);
          break;
        }
        case 'StateDeclaration': {
          if (stmt.initialValue) {
            this.validateExpression(stmt.initialValue, variables, actions, issues, ctx);
          }
          variables.add(stmt.name);
          break;
        }
        case 'ShowStatement': {
          this.validateExpression(stmt.expression, variables, actions, issues, ctx);
          break;
        }
        case 'ReturnStatement': {
          if (!ctx.inAction) {
            issues.push({
              line: stmt.line || 1,
              column: stmt.column || 1,
              message: 'RETURN statement used outside of an ACTION block',
              severity: 'error',
              hint: 'Place RETURN inside an ACTION ... END definition.',
            });
          }
          const expr = stmt.expression || (stmt as any).value;
          if (expr) {
            this.validateExpression(expr, variables, actions, issues, ctx);
          }
          break;
        }
        case 'CallStatement': {
          const targetAction = actions.get(stmt.actionName);
          if (!targetAction && !ctx.inTry) {
            issues.push({
              line: stmt.line || 1,
              column: stmt.column || 1,
              message: `Undefined action "${stmt.actionName}"`,
              severity: 'error',
              hint: `Define ACTION ${stmt.actionName} ... END before calling it.`,
            });
          } else if (targetAction && Array.isArray(targetAction.params) && Array.isArray(stmt.args)) {
            if (stmt.args.length !== targetAction.params.length) {
              issues.push({
                line: stmt.line || 1,
                column: stmt.column || 1,
                message: `Action "${stmt.actionName}" expects ${targetAction.params.length} argument(s), but received ${stmt.args.length}`,
                severity: 'warning',
                hint: `Usage: CALL ${stmt.actionName} ${targetAction.params.join(' ')}`,
              });
            }
          }
          for (const arg of stmt.args || []) {
            this.validateExpression(arg, variables, actions, issues, ctx);
          }
          break;
        }
        case 'ActionDefinition':
        case 'ActionDeclaration': {
          const actionVars = new Set<string>(variables);
          for (const p of stmt.params || []) {
            actionVars.add(p);
          }
          this.validateStatements(stmt.body || [], actionVars, actions, pages, issues, {
            ...ctx,
            inAction: true,
          });
          break;
        }
        case 'RouteDeclaration': {
          const targetPage = (stmt as any).targetPage || stmt.pageName;
          if (pages.size > 0 && targetPage && !pages.has(targetPage)) {
            issues.push({
              line: stmt.line || 1,
              column: stmt.column || 1,
              message: `ROUTE "${stmt.path}" references undefined PAGE "${targetPage}"`,
              severity: 'error',
              hint: `Declare PAGE ${targetPage} ... END or update the ROUTE target.`,
            });
          }
          break;
        }
        case 'WhenBlock':
        case 'WhenStatement': {
          const blockVars = new Set<string>(variables);
          blockVars.add('eventData');
          this.validateStatements(stmt.body || [], blockVars, actions, pages, issues, ctx);
          break;
        }
        case 'PageDeclaration': {
          const pageVars = new Set<string>(variables);
          this.validateStatements(stmt.body || [], pageVars, actions, pages, issues, ctx);
          break;
        }
        case 'IfStatement': {
          this.validateExpression(stmt.condition, variables, actions, issues, ctx);
          this.validateStatements(stmt.thenBranch || [], new Set(variables), actions, pages, issues, ctx);
          if (stmt.elseBranch) {
            this.validateStatements(stmt.elseBranch, new Set(variables), actions, pages, issues, ctx);
          }
          break;
        }
        case 'RepeatLoop':
        case 'RepeatStatement': {
          this.validateExpression(stmt.count, variables, actions, issues, ctx);
          this.validateStatements(stmt.body || [], new Set(variables), actions, pages, issues, ctx);
          break;
        }
        case 'ForEachLoop':
        case 'ForEachStatement': {
          this.validateExpression(stmt.iterable, variables, actions, issues, ctx);
          const loopVars = new Set<string>(variables);
          if (stmt.iterator) loopVars.add(stmt.iterator);
          this.validateStatements(stmt.body || [], loopVars, actions, pages, issues, ctx);
          break;
        }
        case 'TryBlock':
        case 'TryStatement': {
          this.validateStatements(stmt.body || [], new Set(variables), actions, pages, issues, {
            ...ctx,
            inTry: true,
          });
          if (stmt.catchBranch) {
            const catchVars = new Set<string>(variables);
            catchVars.add('error');
            this.validateStatements(stmt.catchBranch, catchVars, actions, pages, issues, ctx);
          }
          break;
        }
        case 'Button': {
          this.validateExpression(stmt.label, variables, actions, issues, ctx);
          if (stmt.onClick) {
            this.validateStatements(stmt.onClick, new Set(variables), actions, pages, issues, ctx);
          }
          break;
        }
        case 'Form': {
          this.validateStatements(stmt.children || [], variables, actions, pages, issues, ctx);
          if (stmt.onSubmit) {
            this.validateStatements(stmt.onSubmit, new Set(variables), actions, pages, issues, ctx);
          }
          break;
        }
        case 'Text': {
          this.validateExpression(stmt.content || (stmt as any).expression, variables, actions, issues, ctx);
          break;
        }
        case 'Container':
        case 'Card':
        case 'List':
        case 'Header':
        case 'Nav':
        case 'Footer':
        case 'Modal':
        case 'ComponentDeclaration': {
          this.validateStatements((stmt as any).children || (stmt as any).body || [], variables, actions, pages, issues, ctx);
          break;
        }
        default:
          break;
      }
    }
  }

  private validateExpression(
    expr: ExpressionNode | undefined,
    variables: Set<string>,
    actions: Map<string, ActionDefinitionNode>,
    issues: DiagnosticIssue[],
    ctx: ValidationContext
  ): void {
    if (!expr || typeof expr !== 'object') return;

    switch (expr.type) {
      case 'BinaryExpression': {
        this.validateExpression(expr.left, variables, actions, issues, ctx);
        this.validateExpression(expr.right, variables, actions, issues, ctx);
        if (
          (expr.operator === '/' || expr.operator === '%') &&
          expr.right?.type === 'Literal' &&
          expr.right.value === 0 &&
          !ctx.inTry
        ) {
          issues.push({
            line: expr.line || 1,
            column: expr.column || 1,
            message: `Division or modulo by literal zero (${expr.operator} 0) will fail at runtime`,
            severity: 'warning',
            hint: 'Ensure the divisor is non-zero or wrap in a TRY ... IF FAILED block.',
          });
        }
        break;
      }
      case 'UnaryExpression': {
        this.validateExpression(expr.argument, variables, actions, issues, ctx);
        break;
      }
      case 'ArrayLiteral': {
        for (const el of expr.elements || []) {
          this.validateExpression(el, variables, actions, issues, ctx);
        }
        break;
      }
      case 'CallExpression': {
        const targetAction = actions.get(expr.actionName);
        if (!targetAction && !ctx.inTry) {
          issues.push({
            line: expr.line || 1,
            column: expr.column || 1,
            message: `Undefined action "${expr.actionName}" in CALL expression`,
            severity: 'error',
            hint: `Define ACTION ${expr.actionName} ... END before calling it.`,
          });
        } else if (targetAction && Array.isArray(targetAction.params) && Array.isArray(expr.args)) {
          if (expr.args.length !== targetAction.params.length) {
            issues.push({
              line: expr.line || 1,
              column: expr.column || 1,
              message: `Action "${expr.actionName}" expects ${targetAction.params.length} argument(s), but received ${expr.args.length}`,
              severity: 'warning',
              hint: `Usage: CALL ${expr.actionName} ${targetAction.params.join(' ')}`,
            });
          }
        }
        for (const arg of expr.args || []) {
          this.validateExpression(arg, variables, actions, issues, ctx);
        }
        break;
      }
      default: {
        if ((expr as any).type === 'IndexAccess') {
          this.validateExpression((expr as any).target, variables, actions, issues, ctx);
          this.validateExpression((expr as any).index, variables, actions, issues, ctx);
        }
        break;
      }
    }
  }
}

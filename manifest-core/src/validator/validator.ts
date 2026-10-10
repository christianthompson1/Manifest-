import { AppDeclarationNode, StatementNode } from '../ast/ast.ts';
import { DiagnosticIssue } from '../errors/manifest-error.ts';

export interface ValidationResult {
  isValid: boolean;
  issues: DiagnosticIssue[];
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
        line: ast.line,
        column: ast.column,
        message: 'Application name cannot be empty',
        severity: 'error',
        hint: 'Use APP "YourAppName"',
      });
    }

    const declaredVariables = new Set<string>();
    const declaredActions = new Set<string>();

    if (ast.body) {
      this.validateStatements(ast.body, declaredVariables, declaredActions, issues);
    }

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
    actions: Set<string>,
    issues: DiagnosticIssue[]
  ) {
    for (const stmt of statements) {
      if (stmt.type === 'SetStatement') {
        variables.add(stmt.variable);
      } else if (stmt.type === 'StateDeclaration') {
        variables.add(stmt.name);
      } else if (stmt.type === 'ActionDefinition') {
        actions.add(stmt.name);
        const actionVars = new Set<string>(variables);
        stmt.params.forEach((p) => actionVars.add(p));
        this.validateStatements(stmt.body, actionVars, actions, issues);
      } else if (stmt.type === 'WhenBlock') {
        this.validateStatements(stmt.body, variables, actions, issues);
      } else if (stmt.type === 'PageDeclaration') {
        this.validateStatements(stmt.body, variables, actions, issues);
      } else if (stmt.type === 'Container' || stmt.type === 'Card' || stmt.type === 'Form') {
        this.validateStatements((stmt as any).children || [], variables, actions, issues);
      } else if (stmt.type === 'IfStatement') {
        this.validateStatements(stmt.thenBranch, variables, actions, issues);
        if (stmt.elseBranch) {
          this.validateStatements(stmt.elseBranch, variables, actions, issues);
        }
      }
    }
  }
}

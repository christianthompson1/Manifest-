import {
  AppDeclarationNode,
  StatementNode,
  ExpressionNode,
  ActionDefinitionNode,
} from '../ast/ast.ts';
import { Scope } from './scope.ts';
import { EventBus } from '../events/event-bus.ts';
import { CapabilityRegistry } from '../modules/capabilities.ts';
import { ManifestError } from '../errors/manifest-error.ts';

const MAX_RECURSION_DEPTH = 200;
const MAX_LOOP_ITERATIONS = 100000;

export class Runtime {
  public globalScope: Scope = new Scope();
  public eventBus: EventBus = new EventBus();
  public capabilities = CapabilityRegistry;
  private actions: Map<string, ActionDefinitionNode> = new Map();
  private outputLogs: string[] = [];
  private callDepth = 0;

  constructor() {
    this.outputLogs = [];
  }

  public getLogs(): string[] {
    return [...this.outputLogs];
  }

  public getGlobalScope(): Scope {
    return this.globalScope;
  }

  public async execute(ast: AppDeclarationNode): Promise<void> {
    const statements: StatementNode[] = ast.body || ast.statements || [];

    // 1. Register all actions first so forward calls work deterministically
    for (const stmt of statements) {
      if (stmt && (stmt.type === 'ActionDefinition' || stmt.type === 'ActionDeclaration')) {
        this.actions.set(stmt.name, stmt);
      }
    }

    // 2. Initialize capabilities, event handlers, and top-level/page state
    for (const stmt of statements) {
      if (!stmt || stmt.type === 'ActionDefinition' || stmt.type === 'ActionDeclaration') {
        continue;
      }
      if (stmt.type === 'UseStatement') {
        const mod = CapabilityRegistry.get(stmt.capability);
        if (mod && mod.init) {
          await mod.init();
        }
      } else if (stmt.type === 'WhenBlock' || stmt.type === 'WhenStatement') {
        const eventName = stmt.event || (stmt as any).eventName;
        this.eventBus.on(eventName, async (data) => {
          const blockScope = new Scope(this.globalScope);
          if (data !== undefined) blockScope.set('eventData', data);
          this.executeStatementsSync(stmt.body || [], blockScope);
        });
      } else {
        this.executeStatementSync(stmt, this.globalScope);
      }
    }

    // 3. Trigger app.starts event if present
    await this.eventBus.emit('app.starts');
  }

  public async executeStatements(statements: StatementNode[], scope: Scope): Promise<any> {
    return this.executeStatementsSync(statements, scope);
  }

  public async executeStatement(stmt: StatementNode, scope: Scope): Promise<any> {
    return this.executeStatementSync(stmt, scope);
  }

  private executeStatementsSync(statements: StatementNode[], scope: Scope): any {
    for (const stmt of statements) {
      const result = this.executeStatementSync(stmt, scope);
      if (result && typeof result === 'object' && result.__isReturn) {
        return result;
      }
    }
    return undefined;
  }

  private executeStatementSync(stmt: StatementNode, scope: Scope): any {
    if (!stmt) return undefined;

    switch (stmt.type) {
      case 'SetStatement': {
        const val = this.evaluateExpression(stmt.value, scope);
        scope.set(stmt.variable, val);
        return undefined;
      }
      case 'StateDeclaration': {
        const val = stmt.initialValue !== undefined ? this.evaluateExpression(stmt.initialValue, scope) : 0;
        scope.set(stmt.name, val);
        return undefined;
      }
      case 'PageDeclaration': {
        for (const child of stmt.body || []) {
          if (child && (child.type === 'StateDeclaration' || child.type === 'SetStatement')) {
            this.executeStatementSync(child, scope);
          }
        }
        return undefined;
      }
      case 'ShowStatement': {
        const val = this.evaluateExpression(stmt.expression, scope);
        this.outputLogs.push(String(val));
        return undefined;
      }
      case 'ReturnStatement': {
        const expr = stmt.expression || (stmt as any).value;
        const val = expr !== undefined ? this.evaluateExpression(expr, scope) : undefined;
        return { __isReturn: true, value: val };
      }
      case 'CallStatement': {
        return this.invokeAction(stmt.actionName, stmt.args || [], scope, stmt.line, stmt.column);
      }
      case 'IfStatement': {
        const cond = this.evaluateExpression(stmt.condition, scope);
        if (Boolean(cond)) {
          return this.executeStatementsSync(stmt.thenBranch || [], new Scope(scope));
        } else if (stmt.elseBranch) {
          return this.executeStatementsSync(stmt.elseBranch, new Scope(scope));
        }
        return undefined;
      }
      case 'RepeatLoop':
      case 'RepeatStatement': {
        const count = Number(this.evaluateExpression(stmt.count, scope)) || 0;
        if (count > MAX_LOOP_ITERATIONS) {
          throw new ManifestError(
            `Maximum loop iteration limit (${MAX_LOOP_ITERATIONS}) exceeded in REPEAT loop`,
            stmt.line,
            stmt.column
          );
        }
        for (let i = 0; i < count; i++) {
          const res = this.executeStatementsSync(stmt.body || [], new Scope(scope));
          if (res && typeof res === 'object' && res.__isReturn) {
            return res;
          }
        }
        return undefined;
      }
      case 'ForEachLoop':
      case 'ForEachStatement': {
        const list = this.evaluateExpression(stmt.iterable, scope);
        if (Array.isArray(list)) {
          if (list.length > MAX_LOOP_ITERATIONS) {
            throw new ManifestError(
              `Maximum loop iteration limit (${MAX_LOOP_ITERATIONS}) exceeded in FOR EACH loop`,
              stmt.line,
              stmt.column
            );
          }
          for (const item of list) {
            const loopScope = new Scope(scope);
            loopScope.set(stmt.iterator, item);
            const res = this.executeStatementsSync(stmt.body || [], loopScope);
            if (res && typeof res === 'object' && res.__isReturn) {
              return res;
            }
          }
        }
        return undefined;
      }
      case 'TryBlock':
      case 'TryStatement': {
        try {
          return this.executeStatementsSync(stmt.body || [], new Scope(scope));
        } catch (err: any) {
          if (stmt.catchBranch) {
            const catchScope = new Scope(scope);
            catchScope.set('error', err.message || String(err));
            return this.executeStatementsSync(stmt.catchBranch, catchScope);
          }
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  private invokeAction(
    actionName: string,
    args: ExpressionNode[],
    callerScope: Scope,
    line = 1,
    column = 1
  ): any {
    const action = this.actions.get(actionName);
    if (!action) {
      throw new ManifestError(`Undefined action: ${actionName}`, line, column);
    }
    if (this.callDepth >= MAX_RECURSION_DEPTH) {
      throw new ManifestError(
        `Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded calling "${actionName}"`,
        line,
        column
      );
    }

    const actionScope = new Scope(this.globalScope);
    const evaluatedArgs = (args || []).map((arg) =>
      arg !== undefined ? this.evaluateExpression(arg, callerScope) : undefined
    );
    (action.params || []).forEach((param, idx) => {
      actionScope.setLocal(param, evaluatedArgs[idx]);
    });

    this.callDepth++;
    try {
      const res = this.executeStatementsSync(action.body || [], actionScope);
      return res && typeof res === 'object' && res.__isReturn ? res.value : undefined;
    } finally {
      this.callDepth--;
    }
  }

  public evaluateExpression(expr: ExpressionNode, scope: Scope): any {
    if (!expr) return undefined;

    switch (expr.type) {
      case 'Literal':
        return expr.value;
      case 'Identifier': {
        const val = scope.get(expr.name);
        return val !== undefined ? val : expr.name;
      }
      case 'ArrayLiteral':
        return (expr.elements || []).map((e) => this.evaluateExpression(e, scope));
      case 'UnaryExpression': {
        const argVal = this.evaluateExpression(expr.argument, scope);
        if (expr.operator === 'NOT' || expr.operator === '!') {
          return !Boolean(argVal);
        }
        if (expr.operator === '-') {
          return -Number(argVal);
        }
        if (expr.operator === '+') {
          return +Number(argVal);
        }
        return undefined;
      }
      case 'CallExpression': {
        return this.invokeAction(expr.actionName, expr.args || [], scope, expr.line, expr.column);
      }
      case 'BinaryExpression': {
        const left = this.evaluateExpression(expr.left, scope);
        const right = this.evaluateExpression(expr.right, scope);
        switch (expr.operator) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            if (right === 0) {
              throw new ManifestError('Division by zero: cannot divide by zero', expr.line, expr.column);
            }
            return left / right;
          case '%':
            if (right === 0) {
              throw new ManifestError('Division by zero: modulo by zero', expr.line, expr.column);
            }
            return left % right;
          case '==':
          case '=':
            return left === right;
          case '!=':
          case '«»':
            return left !== right;
          case '<':
          case '«':
            return left < right;
          case '<=':
          case '«=':
          case '«=»':
            return left <= right;
          case '>':
          case '»':
            return left > right;
          case '>=':
          case '»=':
          case '»=»':
            return left >= right;
          case 'AND':
          case '&&':
            return Boolean(left && right);
          case 'OR':
          case '||':
            return Boolean(left || right);
          default:
            return undefined;
        }
      }
      default: {
        if ((expr as any).type === 'IndexAccess') {
          const target = this.evaluateExpression((expr as any).target, scope);
          const idx = this.evaluateExpression((expr as any).index, scope);
          if (Array.isArray(target) || typeof target === 'string') {
            return target[Number(idx)];
          }
          if (target && typeof target === 'object') {
            return target[idx];
          }
          return undefined;
        }
        return undefined;
      }
    }
  }
}

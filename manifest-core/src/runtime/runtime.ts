import {
  AppDeclarationNode,
  StatementNode,
  ExpressionNode,
  WhenBlockNode,
  SetStatementNode,
  ShowStatementNode,
  CallStatementNode,
  ActionDefinitionNode,
  IfStatementNode,
  RepeatLoopNode,
  ForEachLoopNode,
  TryBlockNode,
} from '../ast/ast.ts';
import { Scope } from './scope.ts';
import { EventBus } from '../events/event-bus.ts';
import { CapabilityRegistry } from '../modules/capabilities.ts';
import { ManifestError } from '../errors/manifest-error.ts';

export class Runtime {
  public globalScope: Scope = new Scope();
  public eventBus: EventBus = new EventBus();
  public capabilities = CapabilityRegistry;
  private actions: Map<string, ActionDefinitionNode> = new Map();
  private outputLogs: string[] = [];

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
    // 1. First pass: register actions and top-level statements
    for (const stmt of ast.body) {
      if (stmt.type === 'ActionDefinition') {
        this.actions.set(stmt.name, stmt);
      } else if (stmt.type === 'UseStatement') {
        const mod = CapabilityRegistry.get(stmt.capability);
        if (mod && mod.init) {
          await mod.init();
        }
      } else if (stmt.type === 'WhenBlock') {
        this.eventBus.on(stmt.event, async (data) => {
          const blockScope = new Scope(this.globalScope);
          if (data) blockScope.set('eventData', data);
          await this.executeStatements(stmt.body, blockScope);
        });
      } else {
        await this.executeStatement(stmt, this.globalScope);
      }
    }

    // 2. Trigger app.starts event if present
    await this.eventBus.emit('app.starts');
  }

  public async executeStatements(statements: StatementNode[], scope: Scope): Promise<any> {
    for (const stmt of statements) {
      const result = await this.executeStatement(stmt, scope);
      if (result && typeof result === 'object' && result.__isReturn) {
        return result;
      }
    }
  }

  public async executeStatement(stmt: StatementNode, scope: Scope): Promise<any> {
    switch (stmt.type) {
      case 'SetStatement': {
        const val = this.evaluateExpression(stmt.value, scope);
        scope.set(stmt.variable, val);
        return;
      }
      case 'StateDeclaration': {
        const val = this.evaluateExpression(stmt.initialValue, scope);
        scope.set(stmt.name, val);
        return;
      }
      case 'ShowStatement': {
        const val = this.evaluateExpression(stmt.expression, scope);
        this.outputLogs.push(String(val));
        return;
      }
      case 'ReturnStatement': {
        const val = this.evaluateExpression(stmt.expression || (stmt as any).value, scope);
        return { __isReturn: true, value: val };
      }
      case 'CallStatement': {
        const action = this.actions.get(stmt.actionName);
        if (!action) {
          throw new ManifestError(`Undefined action: ${stmt.actionName}`, stmt.line, stmt.column);
        }
        const actionScope = new Scope(this.globalScope);
        action.params.forEach((param, idx) => {
          const arg = stmt.args[idx];
          const argVal = arg !== undefined ? this.evaluateExpression(arg, scope) : undefined;
          actionScope.set(param, argVal);
        });
        const res = await this.executeStatements(action.body, actionScope);
        return res?.__isReturn ? res.value : res;
      }
      case 'IfStatement': {
        const cond = this.evaluateExpression(stmt.condition, scope);
        if (Boolean(cond)) {
          return await this.executeStatements(stmt.thenBranch, new Scope(scope));
        } else if (stmt.elseBranch) {
          return await this.executeStatements(stmt.elseBranch, new Scope(scope));
        }
        return;
      }
      case 'RepeatLoop': {
        const count = Number(this.evaluateExpression(stmt.count, scope)) || 0;
        for (let i = 0; i < count; i++) {
          await this.executeStatements(stmt.body, new Scope(scope));
        }
        return;
      }
      case 'ForEachLoop': {
        const list = this.evaluateExpression(stmt.iterable, scope);
        if (Array.isArray(list)) {
          for (const item of list) {
            const loopScope = new Scope(scope);
            loopScope.set(stmt.iterator, item);
            await this.executeStatements(stmt.body, loopScope);
          }
        }
        return;
      }
      case 'TryBlock': {
        try {
          await this.executeStatements(stmt.body, new Scope(scope));
        } catch (err: any) {
          if (stmt.catchBranch) {
            const catchScope = new Scope(scope);
            catchScope.set('error', err.message || String(err));
            await this.executeStatements(stmt.catchBranch, catchScope);
          }
        }
        return;
      }
      default:
        // Other primitives are handled by compilers / preview runtimes
        return;
    }
  }

  public evaluateExpression(expr: ExpressionNode, scope: Scope): any {
    switch (expr.type) {
      case 'Literal':
        return expr.value;
      case 'Identifier': {
        const val = scope.get(expr.name);
        return val !== undefined ? val : expr.name;
      }
      case 'ArrayLiteral':
        return expr.elements.map((e) => this.evaluateExpression(e, scope));
      case 'CallExpression': {
        const action = this.actions.get(expr.actionName);
        if (!action) {
          throw new ManifestError(`Undefined action: ${expr.actionName}`, expr.line, expr.column);
        }
        const actionScope = new Scope(this.globalScope);
        const args = expr.args || [];
        action.params.forEach((param, idx) => {
          const arg = args[idx];
          const argVal = arg !== undefined ? this.evaluateExpression(arg, scope) : undefined;
          actionScope.set(param, argVal);
        });

        let retVal: any = undefined;
        for (const s of action.body) {
          if (s.type === 'SetStatement') {
            const v = this.evaluateExpression(s.value, actionScope);
            actionScope.set(s.variable, v);
          } else if (s.type === 'ShowStatement') {
            const v = this.evaluateExpression(s.expression, actionScope);
            this.outputLogs.push(String(v));
          } else if (s.type === 'ReturnStatement') {
            retVal = this.evaluateExpression((s as any).expression || (s as any).value, actionScope);
            break;
          }
        }
        return retVal;
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
      default:
        return undefined;
    }
  }
}

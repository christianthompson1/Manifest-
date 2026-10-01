/**
 * Manifest Core v0.1 - Runtime / Interpreter Engine
 * Executes AST nodes safely, without eval(), managing scopes, events, and I/O.
 */

import {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  ActionDeclarationNode,
  WhenStatementNode,
  IfStatementNode,
  RepeatStatementNode,
  ForEachStatementNode,
  SetStatementNode,
  ShowStatementNode,
  CallStatementNode,
  ReturnStatementNode,
  TryStatementNode,
  LiteralNode,
  ArrayLiteralNode,
  VariableReferenceNode,
  BinaryExpressionNode,
  UnaryExpressionNode,
  CallExpressionNode,
  IndexAccessNode,
} from '../ast/ast.ts';
import {
  ManifestValue,
  ManifestActionValue,
  stringifyManifestValue,
  evaluateBinaryOp,
  isTruthy,
} from './values.ts';
import { Scope } from './scope.ts';
import { EventBus } from '../events/event-bus.ts';
import { CapabilityRegistry } from '../modules/capabilities.ts';
import { ManifestError } from '../errors/manifest-error.ts';

/**
 * Internal control signal used for cleanly unwinding call stacks on RETURN.
 */
class ReturnSignal {
  constructor(public readonly value: ManifestValue) {}
}

export type OutputHandler = (output: string) => void;

export class Runtime {
  public readonly globalScope: Scope;
  public readonly eventBus: EventBus;
  public readonly capabilities: CapabilityRegistry;
  private readonly actions: Map<string, ManifestActionValue> = new Map();
  private outputHandler: OutputHandler;
  public appName?: string;

  constructor(outputHandler?: OutputHandler) {
    this.globalScope = new Scope();
    this.eventBus = new EventBus();
    this.capabilities = new CapabilityRegistry();
    this.outputHandler = outputHandler ?? ((msg) => console.log(msg));
  }

  /**
   * Sets a custom output handler for SHOW statements (e.g. for IDE console or test assertions).
   */
  public setOutputHandler(handler: OutputHandler): void {
    this.outputHandler = handler;
  }

  /**
   * Runs a complete Manifest program AST.
   */
  public async execute(program: ProgramNode): Promise<void> {
    this.appName = program.appName;
    this.actions.clear();
    this.eventBus.clear();
    this.capabilities.reset();

    // 1. First pass: Register all ACTIONs and USE declarations
    for (const stmt of program.statements) {
      if (stmt.type === 'UseDeclaration') {
        this.capabilities.use(stmt.capability);
      } else if (stmt.type === 'ActionDeclaration') {
        this.registerAction(stmt, this.globalScope);
      }
    }

    // 2. Second pass: Execute top-level statements (e.g. global SETs and WHEN registrations)
    for (const stmt of program.statements) {
      if (stmt.type !== 'ActionDeclaration' && stmt.type !== 'UseDeclaration') {
        await this.executeStatement(stmt, this.globalScope);
      }
    }

    // 3. Trigger automatic program startup event: app.starts
    await this.eventBus.emit('app.starts');
  }

  /**
   * Executes a single statement within the given scope.
   */
  private async executeStatement(stmt: StatementNode, scope: Scope): Promise<void> {
    switch (stmt.type) {
      case 'AppDeclaration': {
        this.appName = stmt.name;
        break;
      }

      case 'UseDeclaration': {
        this.capabilities.use(stmt.capability);
        break;
      }

      case 'SetStatement': {
        const val = this.evaluateExpression(stmt.value, scope);
        scope.set(stmt.variable, val);
        break;
      }

      case 'ShowStatement': {
        const val = this.evaluateExpression(stmt.expression, scope);
        const text = stringifyManifestValue(val);
        this.outputHandler(text);
        break;
      }

      case 'IfStatement': {
        await this.executeIfStatement(stmt, scope);
        break;
      }

      case 'WhenStatement': {
        this.registerWhenStatement(stmt, scope);
        break;
      }

      case 'RepeatStatement': {
        await this.executeRepeatStatement(stmt, scope);
        break;
      }

      case 'ForEachStatement': {
        await this.executeForEachStatement(stmt, scope);
        break;
      }

      case 'ActionDeclaration': {
        this.registerAction(stmt, scope);
        break;
      }

      case 'CallStatement': {
        this.invokeAction(stmt.actionName, stmt.args, scope, stmt.line);
        break;
      }

      case 'ReturnStatement': {
        const val = stmt.value ? this.evaluateExpression(stmt.value, scope) : null;
        throw new ReturnSignal(val);
      }

      case 'TryStatement': {
        await this.executeTryStatement(stmt, scope);
        break;
      }

      default:
        break;
    }
  }

  private async executeIfStatement(stmt: IfStatementNode, scope: Scope): Promise<void> {
    const conditionVal = this.evaluateExpression(stmt.condition, scope);

    if (isTruthy(conditionVal)) {
      const blockScope = new Scope(scope);
      for (const s of stmt.consequent) {
        await this.executeStatement(s, blockScope);
      }
      return;
    }

    // Check ELSE IF branches
    if (stmt.elseIfBranches) {
      for (const branch of stmt.elseIfBranches) {
        const branchVal = this.evaluateExpression(branch.condition, scope);
        if (isTruthy(branchVal)) {
          const branchScope = new Scope(scope);
          for (const s of branch.body) {
            await this.executeStatement(s, branchScope);
          }
          return;
        }
      }
    }

    // Check ELSE
    if (stmt.alternate) {
      const elseScope = new Scope(scope);
      for (const s of stmt.alternate) {
        await this.executeStatement(s, elseScope);
      }
    }
  }

  private registerWhenStatement(stmt: WhenStatementNode, scope: Scope): void {
    this.eventBus.on(stmt.eventName, async () => {
      const eventScope = new Scope(scope);
      for (const s of stmt.body) {
        await this.executeStatement(s, eventScope);
      }
    });
  }

  private async executeRepeatStatement(stmt: RepeatStatementNode, scope: Scope): Promise<void> {
    const countVal = this.evaluateExpression(stmt.count, scope);
    if (typeof countVal !== 'number' || isNaN(countVal)) {
      throw new ManifestError({
        message: 'REPEAT count must be a number.',
        line: stmt.line,
        phase: 'runtime',
        example: 'REPEAT 5 TIMES\n    SHOW "Hello"\nEND',
      });
    }

    const times = Math.max(0, Math.floor(countVal));
    for (let i = 0; i < times; i++) {
      const loopScope = new Scope(scope);
      for (const s of stmt.body) {
        await this.executeStatement(s, loopScope);
      }
    }
  }

  private async executeForEachStatement(stmt: ForEachStatementNode, scope: Scope): Promise<void> {
    const collectionVal = this.evaluateExpression(stmt.collection, scope);

    if (!Array.isArray(collectionVal)) {
      throw new ManifestError({
        message: `FOR EACH expects a list to loop over, but got ${typeof collectionVal}.`,
        line: stmt.line,
        phase: 'runtime',
        hint: 'Use a list of items like ["Alice", "Bob"] or a variable holding a list.',
        example: 'SET names TO ["Alice", "Bob"]\nFOR EACH name IN names\n    SHOW name\nEND',
      });
    }

    for (const item of collectionVal) {
      const loopScope = new Scope(scope);
      loopScope.define(stmt.itemVar, item);
      for (const s of stmt.body) {
        await this.executeStatement(s, loopScope);
      }
    }
  }

  private registerAction(stmt: ActionDeclarationNode, closureScope: Scope): void {
    const actionVal: ManifestActionValue = {
      type: 'action',
      name: stmt.name,
      params: stmt.params,
      body: stmt.body,
      closure: closureScope,
    };
    this.actions.set(stmt.name, actionVal);
  }

  private invokeAction(
    actionName: string,
    argNodes: ExpressionNode[],
    callerScope: Scope,
    line: number
  ): ManifestValue {
    const action = this.actions.get(actionName);
    if (!action) {
      throw new ManifestError({
        message: `Cannot call '${actionName}' because no ACTION with that name exists.`,
        line,
        phase: 'runtime',
        hint: `Define it using 'ACTION ${actionName} ... END'.`,
        example: `ACTION ${actionName}\n    SHOW "Hello"\nEND`,
      });
    }

    if (argNodes.length !== action.params.length) {
      throw new ManifestError({
        message: `Action '${actionName}' requires ${action.params.length} argument(s), but got ${argNodes.length}.`,
        line,
        phase: 'runtime',
      });
    }

    // Evaluate arguments in caller's scope
    const evaluatedArgs = argNodes.map((arg) => this.evaluateExpression(arg, callerScope));

    // Create action execution scope chained to closure scope
    const actionScope = new Scope(action.closure);
    for (let i = 0; i < action.params.length; i++) {
      actionScope.define(action.params[i], evaluatedArgs[i]);
    }

    try {
      for (const stmt of action.body) {
        // executeStatement is synchronous for basic statements in actions; handle synchronously
        this.executeStatementSync(stmt, actionScope);
      }
      return null;
    } catch (err) {
      if (err instanceof ReturnSignal) {
        return err.value;
      }
      throw err;
    }
  }

  private executeStatementSync(stmt: StatementNode, scope: Scope): void {
    switch (stmt.type) {
      case 'SetStatement': {
        const val = this.evaluateExpression(stmt.value, scope);
        scope.set(stmt.variable, val);
        break;
      }
      case 'ShowStatement': {
        const val = this.evaluateExpression(stmt.expression, scope);
        this.outputHandler(stringifyManifestValue(val));
        break;
      }
      case 'ReturnStatement': {
        const val = stmt.value ? this.evaluateExpression(stmt.value, scope) : null;
        throw new ReturnSignal(val);
      }
      case 'IfStatement': {
        const cond = this.evaluateExpression(stmt.condition, scope);
        if (isTruthy(cond)) {
          const blockScope = new Scope(scope);
          for (const s of stmt.consequent) {
            this.executeStatementSync(s, blockScope);
          }
        } else if (stmt.alternate) {
          const elseScope = new Scope(scope);
          for (const s of stmt.alternate) {
            this.executeStatementSync(s, elseScope);
          }
        }
        break;
      }
      case 'RepeatStatement': {
        const count = Number(this.evaluateExpression(stmt.count, scope));
        for (let i = 0; i < count; i++) {
          const loopScope = new Scope(scope);
          for (const s of stmt.body) {
            this.executeStatementSync(s, loopScope);
          }
        }
        break;
      }
      case 'ForEachStatement': {
        const list = this.evaluateExpression(stmt.collection, scope);
        if (Array.isArray(list)) {
          for (const item of list) {
            const loopScope = new Scope(scope);
            loopScope.define(stmt.itemVar, item);
            for (const s of stmt.body) {
              this.executeStatementSync(s, loopScope);
            }
          }
        }
        break;
      }
      case 'CallStatement': {
        this.invokeAction(stmt.actionName, stmt.args, scope, stmt.line);
        break;
      }
      default:
        break;
    }
  }

  private async executeTryStatement(stmt: TryStatementNode, scope: Scope): Promise<void> {
    try {
      const tryScope = new Scope(scope);
      for (const s of stmt.tryBlock) {
        await this.executeStatement(s, tryScope);
      }
    } catch (err) {
      if (err instanceof ReturnSignal) {
        throw err;
      }
      // Handled in catch block (IF FAILED)
      const catchScope = new Scope(scope);
      for (const s of stmt.catchBlock) {
        await this.executeStatement(s, catchScope);
      }
    }
  }

  // ----------------------------------------------------
  // Expression Evaluation
  // ----------------------------------------------------

  public evaluateExpression(expr: ExpressionNode, scope: Scope): ManifestValue {
    switch (expr.type) {
      case 'Literal':
        return expr.value;

      case 'VariableReference':
        return scope.get(expr.name, expr.line);

      case 'BinaryExpression': {
        const left = this.evaluateExpression(expr.left, scope);
        const right = this.evaluateExpression(expr.right, scope);
        return evaluateBinaryOp(expr.operator, left, right, expr.line);
      }

      case 'UnaryExpression': {
        const arg = this.evaluateExpression(expr.argument, scope);
        if (expr.operator === 'NOT') {
          return !isTruthy(arg);
        }
        if (expr.operator === '-') {
          if (typeof arg !== 'number') {
            throw new ManifestError({
              message: 'Unary minus requires a number.',
              line: expr.line,
              phase: 'runtime',
            });
          }
          return -arg;
        }
        throw new ManifestError({
          message: `Unknown unary operator: ${expr.operator}`,
          line: expr.line,
          phase: 'runtime',
        });
      }

      case 'ArrayLiteral':
        return expr.elements.map((el) => this.evaluateExpression(el, scope));

      case 'IndexAccess': {
        const target = this.evaluateExpression(expr.target, scope);
        const index = this.evaluateExpression(expr.index, scope);

        if (!Array.isArray(target)) {
          throw new ManifestError({
            message: 'Index access [index] can only be used on a list.',
            line: expr.line,
            phase: 'runtime',
          });
        }
        if (typeof index !== 'number') {
          throw new ManifestError({
            message: 'List index must be a number.',
            line: expr.line,
            phase: 'runtime',
          });
        }
        const val = target[index];
        return val !== undefined ? val : null;
      }

      case 'CallExpression': {
        return this.invokeAction(expr.actionName, expr.args, scope, expr.line);
      }

      default:
        return null;
    }
  }
}

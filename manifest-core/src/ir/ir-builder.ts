/**
 * Manifest IR Builder
 * Transforms a validated Manifest AST into a clean, target-agnostic Manifest IR.
 */

import {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  LiteralNode,
  ArrayLiteralNode,
  VariableReferenceNode,
  BinaryExpressionNode,
  UnaryExpressionNode,
  CallExpressionNode,
  IndexAccessNode,
  SetStatementNode,
  ShowStatementNode,
  IfStatementNode,
  WhenStatementNode,
  RepeatStatementNode,
  ForEachStatementNode,
  ActionDeclarationNode,
  CallStatementNode,
  ReturnStatementNode,
  TryStatementNode,
  StateDeclarationNode,
  PageDeclarationNode,
  TextNode,
  ButtonNode,
  InputNode,
  ImageNode,
  FormNode,
  RouteDeclarationNode,
  ContainerNode,
  CardNode,
  ListNode,
  LinkNode,
  SelectNode,
  CheckboxNode,
  TextareaNode,
  HeaderNode,
  FooterNode,
  NavNode,
  ModalNode,
  ComponentDeclarationNode,
  ComponentCallNode,
} from '../ast/ast.ts';

import {
  IRProgramNode,
  IRInstructionNode,
  IRExpressionNode,
  IRVariableDeclNode,
  IRAssignmentNode,
  IRShowNode,
  IRIfNode,
  IRLoopNode,
  IRForEachNode,
  IRActionDeclNode,
  IRActionCallNode,
  IRReturnNode,
  IREventHandlerNode,
  IRTryCatchNode,
  IRLiteralNode,
  IRArrayNode,
  IRVariableRefNode,
  IRBinaryOpNode,
  IRUnaryOpNode,
  IRIndexAccessNode,
  IROperator,
  IRStateNode,
  IRPageNode,
  IRTextNode,
  IRButtonNode,
  IRInputNode,
  IRImageNode,
  IRFormNode,
  IRRouteNode,
  IRContainerNode,
  IRCardNode,
  IRListNode,
  IRLinkNode,
  IRSelectNode,
  IRCheckboxNode,
  IRTextareaNode,
  IRHeaderNode,
  IRFooterNode,
  IRNavNode,
  IRModalNode,
  IRComponentDeclNode,
  IRComponentCallNode,
  IRUINode,
} from './ir.ts';

export class IRBuilder {
  private declaredVariables: Set<string> = new Set();

  /**
   * Transforms an AST Program into a target-agnostic IRProgramNode.
   */
  public build(ast: ProgramNode): IRProgramNode {
    this.declaredVariables.clear();

    const variables: IRVariableDeclNode[] = [];
    const actions: IRActionDeclNode[] = [];
    const eventHandlers: IREventHandlerNode[] = [];
    const topLevelInstructions: IRInstructionNode[] = [];
    const state: IRStateNode[] = [];
    const pages: IRPageNode[] = [];
    const routes: IRRouteNode[] = [];
    const uiNodes: IRUINode[] = [];

    for (const stmt of ast.statements) {
      if (stmt.type === 'AppDeclaration' || stmt.type === 'UseDeclaration') {
        continue;
      }

      if (stmt.type === 'ActionDeclaration') {
        const actionIR = this.transformActionDeclaration(stmt);
        actions.push(actionIR);
      } else if (stmt.type === 'WhenStatement') {
        const eventIR = this.transformWhenStatement(stmt);
        eventHandlers.push(eventIR);
      } else if (stmt.type === 'SetStatement') {
        // Distinguish initial declaration vs assignment
        if (!this.declaredVariables.has(stmt.variable)) {
          this.declaredVariables.add(stmt.variable);
          const decl: IRVariableDeclNode = {
            kind: 'IRVariableDecl',
            name: stmt.variable,
            initialValue: this.transformExpression(stmt.value),
            sourceLine: stmt.line,
            sourceColumn: stmt.column,
          };
          variables.push(decl);
          topLevelInstructions.push(decl);
        } else {
          const assign: IRAssignmentNode = {
            kind: 'IRAssignment',
            target: stmt.variable,
            value: this.transformExpression(stmt.value),
            sourceLine: stmt.line,
            sourceColumn: stmt.column,
          };
          topLevelInstructions.push(assign);
        }
      } else if (stmt.type === 'StateDeclaration') {
        const sIR = this.transformStatement(stmt) as IRStateNode;
        if (sIR) {
          state.push(sIR);
          topLevelInstructions.push(sIR);
        }
      } else if (stmt.type === 'PageDeclaration') {
        const pIR = this.transformStatement(stmt) as IRPageNode;
        if (pIR) {
          pages.push(pIR);
          topLevelInstructions.push(pIR);
          if (pIR.state) {
            for (const st of pIR.state) {
              if (!state.some((s) => s.name === st.name)) {
                state.push(st);
                topLevelInstructions.push(st);
              }
            }
          }
        }
      } else if (stmt.type === 'RouteDeclaration') {
        const rIR = this.transformStatement(stmt) as IRRouteNode;
        if (rIR) {
          routes.push(rIR);
          topLevelInstructions.push(rIR);
        }
      } else if (
        stmt.type === 'Text' ||
        stmt.type === 'Button' ||
        stmt.type === 'Input' ||
        stmt.type === 'Image' ||
        stmt.type === 'Form' ||
        stmt.type === 'Container' ||
        stmt.type === 'Card' ||
        stmt.type === 'List' ||
        stmt.type === 'Link' ||
        stmt.type === 'Select' ||
        stmt.type === 'Checkbox' ||
        stmt.type === 'Textarea' ||
        stmt.type === 'Header' ||
        stmt.type === 'Footer' ||
        stmt.type === 'Nav' ||
        stmt.type === 'Modal' ||
        stmt.type === 'ComponentCall'
      ) {
        const uIR = this.transformStatement(stmt) as IRUINode;
        if (uIR) {
          uiNodes.push(uIR);
          topLevelInstructions.push(uIR);
        }
      } else {
        const instr = this.transformStatement(stmt);
        if (instr) {
          topLevelInstructions.push(instr);
        }
      }
    }

    return {
      kind: 'IRProgram',
      appName: ast.appName || 'ManifestApp',
      capabilities: [...ast.capabilities],
      variables,
      actions,
      eventHandlers,
      instructions: topLevelInstructions,
      state,
      pages,
      routes,
      uiNodes,
      version: '0.2.0',
      sourceLine: ast.line,
      sourceColumn: ast.column,
    };
  }

  private transformStatement(stmt: StatementNode): IRInstructionNode | null {
    switch (stmt.type) {
      case 'SetStatement': {
        const s = stmt as SetStatementNode;
        if (!this.declaredVariables.has(s.variable)) {
          this.declaredVariables.add(s.variable);
          return {
            kind: 'IRVariableDecl',
            name: s.variable,
            initialValue: this.transformExpression(s.value),
            sourceLine: s.line,
            sourceColumn: s.column,
          };
        }
        return {
          kind: 'IRAssignment',
          target: s.variable,
          value: this.transformExpression(s.value),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ShowStatement': {
        const s = stmt as ShowStatementNode;
        return {
          kind: 'IRShow',
          expression: this.transformExpression(s.expression),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'IfStatement': {
        const s = stmt as IfStatementNode;
        return {
          kind: 'IRIf',
          condition: this.transformExpression(s.condition),
          thenBody: this.transformBlock(s.consequent),
          elseIfBranches: (s.elseIfBranches || []).map((b) => ({
            condition: this.transformExpression(b.condition),
            body: this.transformBlock(b.body),
            sourceLine: b.line,
          })),
          elseBody: s.alternate ? this.transformBlock(s.alternate) : undefined,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'WhenStatement': {
        return this.transformWhenStatement(stmt as WhenStatementNode);
      }

      case 'RepeatStatement': {
        const s = stmt as RepeatStatementNode;
        return {
          kind: 'IRLoop',
          loopType: 'repeat',
          count: this.transformExpression(s.count),
          body: this.transformBlock(s.body),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ForEachStatement': {
        const s = stmt as ForEachStatementNode;
        return {
          kind: 'IRForEach',
          iteratorVar: s.itemVar,
          collection: this.transformExpression(s.collection),
          body: this.transformBlock(s.body),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ActionDeclaration': {
        return this.transformActionDeclaration(stmt as ActionDeclarationNode);
      }

      case 'CallStatement': {
        const s = stmt as CallStatementNode;
        return {
          kind: 'IRActionCall',
          actionName: s.actionName,
          arguments: s.args.map((a) => this.transformExpression(a)),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ReturnStatement': {
        const s = stmt as ReturnStatementNode;
        return {
          kind: 'IRReturn',
          value: s.value ? this.transformExpression(s.value) : undefined,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'TryStatement': {
        const s = stmt as TryStatementNode;
        return {
          kind: 'IRTryCatch',
          tryBody: this.transformBlock(s.tryBlock),
          catchBody: this.transformBlock(s.catchBlock),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      // Manifest v0.2 UI Primitives
      case 'StateDeclaration': {
        const s = stmt as StateDeclarationNode;
        this.declaredVariables.add(s.variable);
        return {
          kind: 'IRState',
          name: s.variable,
          initialValue: this.transformExpression(s.value),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'PageDeclaration': {
        const s = stmt as PageDeclarationNode;
        const pageState: IRStateNode[] = [];
        const pageChildren: IRUINode[] = [];
        const pageInstructions: IRInstructionNode[] = [];

        for (const child of s.body) {
          if (child.type === 'StateDeclaration') {
            const stateIR = this.transformStatement(child) as IRStateNode;
            if (stateIR) {
              pageState.push(stateIR);
              pageInstructions.push(stateIR);
            }
          } else if (
            child.type === 'Text' ||
            child.type === 'Button' ||
            child.type === 'Input' ||
            child.type === 'Image' ||
            child.type === 'Form' ||
            child.type === 'Container' ||
            child.type === 'Card' ||
            child.type === 'List' ||
            child.type === 'Link' ||
            child.type === 'Select' ||
            child.type === 'Checkbox' ||
            child.type === 'Textarea' ||
            child.type === 'Header' ||
            child.type === 'Footer' ||
            child.type === 'Nav' ||
            child.type === 'Modal' ||
            child.type === 'ComponentCall'
          ) {
            const uiIR = this.transformStatement(child) as IRUINode;
            if (uiIR) {
              pageChildren.push(uiIR);
              pageInstructions.push(uiIR);
            }
          } else {
            const instr = this.transformStatement(child);
            if (instr) pageInstructions.push(instr);
          }
        }

        return {
          kind: 'IRPage',
          name: s.name,
          route: s.route,
          state: pageState,
          children: pageChildren,
          instructions: pageInstructions,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Text': {
        const s = stmt as TextNode;
        return {
          kind: 'IRText',
          expression: this.transformExpression(s.expression),
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Button': {
        const s = stmt as ButtonNode;
        return {
          kind: 'IRButton',
          label: this.transformExpression(s.label),
          eventHandlers: s.eventHandlers.map((h) => this.transformWhenStatement(h)),
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Input': {
        const s = stmt as InputNode;
        return {
          kind: 'IRInput',
          placeholder: s.placeholder ? this.transformExpression(s.placeholder) : undefined,
          bindVariable: s.targetVariable,
          inputType: s.inputType,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Image': {
        const s = stmt as ImageNode;
        return {
          kind: 'IRImage',
          src: this.transformExpression(s.src),
          alt: s.alt ? this.transformExpression(s.alt) : undefined,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Form': {
        const s = stmt as FormNode;
        const formChildren: IRUINode[] = [];
        for (const child of s.body) {
          const childIR = this.transformStatement(child) as IRUINode;
          if (childIR) formChildren.push(childIR);
        }
        return {
          kind: 'IRForm',
          name: s.name,
          children: formChildren,
          eventHandlers: s.eventHandlers.map((h) => this.transformWhenStatement(h)),
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Container': {
        const s = stmt as ContainerNode;
        const children: IRUINode[] = [];
        for (const child of s.children) {
          const childIR = this.transformStatement(child) as IRUINode;
          if (childIR) children.push(childIR);
        }
        return {
          kind: 'IRContainer',
          layout: s.layout,
          direction: s.direction,
          styles: s.styles,
          children,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Card': {
        const s = stmt as CardNode;
        const children: IRUINode[] = [];
        for (const child of s.children) {
          const childIR = this.transformStatement(child) as IRUINode;
          if (childIR) children.push(childIR);
        }
        return {
          kind: 'IRCard',
          styles: s.styles,
          children,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'List': {
        const s = stmt as ListNode;
        const children: IRUINode[] = [];
        for (const child of s.children) {
          const childIR = this.transformStatement(child) as IRUINode;
          if (childIR) children.push(childIR);
        }
        return {
          kind: 'IRList',
          collection: s.collection ? this.transformExpression(s.collection) : undefined,
          itemVar: s.itemVar,
          styles: s.styles,
          children,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Link': {
        const s = stmt as LinkNode;
        return {
          kind: 'IRLink',
          label: this.transformExpression(s.label),
          target: this.transformExpression(s.target),
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Select': {
        const s = stmt as SelectNode;
        return {
          kind: 'IRSelect',
          bindVariable: s.bindVariable,
          options: s.options,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Checkbox': {
        const s = stmt as CheckboxNode;
        return {
          kind: 'IRCheckbox',
          label: s.label ? this.transformExpression(s.label) : undefined,
          bindVariable: s.bindVariable,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Textarea': {
        const s = stmt as TextareaNode;
        return {
          kind: 'IRTextarea',
          placeholder: s.placeholder ? this.transformExpression(s.placeholder) : undefined,
          bindVariable: s.bindVariable,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Header':
      case 'Footer':
      case 'Nav':
      case 'Modal': {
        const s = stmt as HeaderNode | FooterNode | NavNode | ModalNode;
        const children: IRUINode[] = [];
        for (const child of s.children) {
          const childIR = this.transformStatement(child) as IRUINode;
          if (childIR) children.push(childIR);
        }
        return {
          kind: `IR${stmt.type}` as any,
          styles: s.styles,
          children,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ComponentDeclaration': {
        const s = stmt as ComponentDeclarationNode;
        const body: IRInstructionNode[] = [];
        for (const child of s.body) {
          const childIR = this.transformStatement(child);
          if (childIR) body.push(childIR);
        }
        return {
          kind: 'IRComponentDecl',
          name: s.name,
          parameters: [...s.params],
          body,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ComponentCall': {
        const s = stmt as ComponentCallNode;
        const props: Record<string, IRExpressionNode> = {};
        for (const [k, v] of Object.entries(s.props)) {
          props[k] = this.transformExpression(v);
        }
        return {
          kind: 'IRComponentCall',
          componentName: s.name,
          props,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'RouteDeclaration': {
        const s = stmt as RouteDeclarationNode;
        return {
          kind: 'IRRoute',
          path: s.path,
          targetPage: s.targetPage,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      default:
        return null;
    }
  }

  private transformBlock(statements: StatementNode[]): IRInstructionNode[] {
    const block: IRInstructionNode[] = [];
    for (const stmt of statements) {
      const instr = this.transformStatement(stmt);
      if (instr) {
        block.push(instr);
      }
    }
    return block;
  }

  private transformActionDeclaration(stmt: ActionDeclarationNode): IRActionDeclNode {
    return {
      kind: 'IRActionDecl',
      name: stmt.name,
      parameters: [...stmt.params],
      body: this.transformBlock(stmt.body),
      sourceLine: stmt.line,
      sourceColumn: stmt.column,
    };
  }

  private transformWhenStatement(stmt: WhenStatementNode): IREventHandlerNode {
    return {
      kind: 'IREventHandler',
      eventName: stmt.eventName,
      body: this.transformBlock(stmt.body),
      sourceLine: stmt.line,
      sourceColumn: stmt.column,
    };
  }

  public transformExpression(expr: ExpressionNode): IRExpressionNode {
    switch (expr.type) {
      case 'Literal': {
        const lit = expr as LiteralNode;
        let dataType: 'string' | 'number' | 'boolean' | 'null' = 'string';
        if (typeof lit.value === 'number') dataType = 'number';
        else if (typeof lit.value === 'boolean') dataType = 'boolean';
        else if (lit.value === null) dataType = 'null';

        return {
          kind: 'IRLiteral',
          value: lit.value,
          dataType,
          sourceLine: lit.line,
          sourceColumn: lit.column,
        };
      }

      case 'ArrayLiteral': {
        const arr = expr as ArrayLiteralNode;
        return {
          kind: 'IRArray',
          elements: arr.elements.map((e) => this.transformExpression(e)),
          sourceLine: arr.line,
          sourceColumn: arr.column,
        };
      }

      case 'VariableReference': {
        const ref = expr as VariableReferenceNode;
        return {
          kind: 'IRVariableRef',
          name: ref.name,
          sourceLine: ref.line,
          sourceColumn: ref.column,
        };
      }

      case 'BinaryExpression': {
        const bin = expr as BinaryExpressionNode;
        return {
          kind: 'IRBinaryOp',
          operator: bin.operator as IROperator,
          left: this.transformExpression(bin.left),
          right: this.transformExpression(bin.right),
          sourceLine: bin.line,
          sourceColumn: bin.column,
        };
      }

      case 'UnaryExpression': {
        const un = expr as UnaryExpressionNode;
        return {
          kind: 'IRUnaryOp',
          operator: un.operator as 'NOT' | '-' | '+',
          argument: this.transformExpression(un.argument),
          sourceLine: un.line,
          sourceColumn: un.column,
        };
      }

      case 'CallExpression': {
        const call = expr as CallExpressionNode;
        return {
          kind: 'IRActionCall',
          actionName: call.actionName,
          arguments: call.args.map((a) => this.transformExpression(a)),
          sourceLine: call.line,
          sourceColumn: call.column,
        };
      }

      case 'IndexAccess': {
        const idx = expr as IndexAccessNode;
        return {
          kind: 'IRIndexAccess',
          target: this.transformExpression(idx.target),
          index: this.transformExpression(idx.index),
          sourceLine: idx.line,
          sourceColumn: idx.column,
        };
      }

      default:
        throw new Error(`Unknown expression type: ${(expr as any).type}`);
    }
  }
}

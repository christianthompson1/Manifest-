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
import {
  SolanaProgramIR,
  normalizeSolanaType,
  calculateAccountSpace,
} from '../solana/solana-ir.ts';

export class IRBuilder {
  private declaredVariables: Set<string> = new Set();

  /**
   * Transforms an AST Program into a target-agnostic IRProgramNode.
   */
  public build(ast: any): IRProgramNode {
    this.declaredVariables.clear();

    const appName = ast.appName || ast.name || 'ManifestApp';
    const rawStatements: StatementNode[] = ast.statements || ast.body || [];
    const astCaps: string[] = ast.capabilities ? [...ast.capabilities] : [];
    for (const stmt of rawStatements) {
      if (stmt.type === 'UseStatement' || stmt.type === 'UseDeclaration') {
        const cap = (stmt as any).capability || (stmt as any).name;
        if (cap && !astCaps.includes(cap)) {
          astCaps.push(cap);
        }
      }
    }

    const variables: IRVariableDeclNode[] = [];
    const actions: IRActionDeclNode[] = [];
    const eventHandlers: IREventHandlerNode[] = [];
    const topLevelInstructions: IRInstructionNode[] = [];
    const state: IRStateNode[] = [];
    const pages: IRPageNode[] = [];
    const routes: IRRouteNode[] = [];
    const uiNodes: IRUINode[] = [];
    const components: IRComponentDeclNode[] = [];
    let solanaProgram: SolanaProgramIR | undefined;

    for (const stmt of rawStatements) {
      if (stmt.type === 'AppDeclaration' || stmt.type === 'UseDeclaration' || stmt.type === 'UseStatement') {
        continue;
      }

      if (stmt.type === 'ProgramDeclaration') {
        solanaProgram = this.transformSolanaProgram(stmt as any, appName || 'CounterProgram');
        continue;
      }

      if (stmt.type === 'ActionDeclaration' || stmt.type === 'ActionDefinition') {
        const actionIR = this.transformActionDeclaration(stmt);
        actions.push(actionIR);
      } else if (stmt.type === 'WhenStatement' || stmt.type === 'WhenBlock') {
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
        stmt.type === 'Progress' ||
        stmt.type === 'Badge' ||
        stmt.type === 'Icon' ||
        stmt.type === 'CssEscape' ||
        stmt.type === 'JsEscape' ||
        stmt.type === 'ComponentCall'
      ) {
        const uIR = this.transformStatement(stmt) as IRUINode;
        if (uIR) {
          uiNodes.push(uIR);
          topLevelInstructions.push(uIR);
        }
      } else if (stmt.type === 'ComponentDeclaration') {
        const cIR = this.transformStatement(stmt) as IRComponentDeclNode;
        if (cIR) {
          components.push(cIR);
          topLevelInstructions.push(cIR);
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
      appName,
      capabilities: astCaps,
      variables,
      actions,
      eventHandlers,
      instructions: topLevelInstructions,
      state,
      pages,
      routes,
      uiNodes,
      components,
      solanaProgram: solanaProgram || (astCaps.includes('solana') || astCaps.includes('SOLANA') ? this.synthesizeSolanaProgram(ast, state, actions) : undefined),
      version: '0.2.0',
      sourceLine: ast.line || 1,
      sourceColumn: ast.column || 1,
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
        const s = stmt as any;
        const thenStmts = s.thenBranch || s.consequent || [];
        const elseStmts = s.elseBranch || s.alternate;
        return {
          kind: 'IRIf',
          condition: this.transformExpression(s.condition),
          thenBody: this.transformBlock(thenStmts),
          elseIfBranches: ((s.elseIfBranches as any[]) || []).map((b) => ({
            condition: this.transformExpression(b.condition),
            body: this.transformBlock(b.body),
            sourceLine: b.line,
          })),
          elseBody: elseStmts ? this.transformBlock(elseStmts) : undefined,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'WhenStatement':
      case 'WhenBlock': {
        return this.transformWhenStatement(stmt as any);
      }

      case 'RepeatStatement':
      case 'RepeatLoop': {
        const s = stmt as any;
        return {
          kind: 'IRLoop',
          loopType: 'repeat',
          count: this.transformExpression(s.count),
          body: this.transformBlock(s.body),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ForEachStatement':
      case 'ForEachLoop': {
        const s = stmt as any;
        return {
          kind: 'IRForEach',
          iteratorVar: s.iterator || s.itemVar || 'item',
          collection: this.transformExpression(s.iterable || s.collection),
          body: this.transformBlock(s.body || []),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ActionDeclaration':
      case 'ActionDefinition': {
        return this.transformActionDeclaration(stmt as any);
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
        const s = stmt as any;
        const retVal = s.expression || s.value;
        return {
          kind: 'IRReturn',
          value: retVal ? this.transformExpression(retVal) : undefined,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'TryStatement':
      case 'TryBlock': {
        const s = stmt as any;
        return {
          kind: 'IRTryCatch',
          tryBody: this.transformBlock(s.tryBlock || s.body || []),
          catchBody: this.transformBlock(s.catchBlock || s.catchBranch || []),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      // Manifest v0.2 UI Primitives
      case 'StateDeclaration': {
        const s = stmt as any;
        const varName = s.name || s.variable;
        const val = s.initialValue || s.value;
        this.declaredVariables.add(varName);
        return {
          kind: 'IRState',
          name: varName,
          initialValue: val ? this.transformExpression(val) : { kind: 'IRLiteral', value: 0, dataType: 'number' },
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
            child.type === 'Progress' ||
            child.type === 'Badge' ||
            child.type === 'Icon' ||
            child.type === 'CssEscape' ||
            child.type === 'JsEscape' ||
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
          styles: s.styles,
          state: pageState,
          children: pageChildren,
          instructions: pageInstructions,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Text': {
        const s = stmt as any;
        return {
          kind: 'IRText',
          expression: this.transformExpression(s.expression || s.content),
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Button': {
        const s = stmt as any;
        const handlers: IREventHandlerNode[] = s.eventHandlers
          ? s.eventHandlers.map((h: any) => this.transformWhenStatement(h))
          : s.onClick
          ? [
              this.transformWhenStatement({
                type: 'WhenBlock',
                event: 'click',
                body: s.onClick,
                line: s.line,
                column: s.column,
              } as any),
            ]
          : [];

        return {
          kind: 'IRButton',
          label: this.transformExpression(s.label),
          eventHandlers: handlers,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Input': {
        const s = stmt as any;
        return {
          kind: 'IRInput',
          placeholder: s.placeholder ? this.transformExpression(s.placeholder) : undefined,
          bindVariable: s.targetVariable || s.variable || s.bindVariable || '',
          inputType: s.inputType,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Image': {
        const s = stmt as any;
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
        const s = stmt as any;
        const formChildren: IRUINode[] = [];
        const formBody = s.body || s.children || [];
        for (const child of formBody) {
          const childIR = this.transformStatement(child) as IRUINode;
          if (childIR) formChildren.push(childIR);
        }
        return {
          kind: 'IRForm',
          name: s.name || 'Form',
          children: formChildren,
          eventHandlers: s.eventHandlers
            ? s.eventHandlers.map((h: any) => this.transformWhenStatement(h))
            : s.onSubmit
            ? [{ kind: 'IREventHandler', eventName: 'submit', body: this.transformBlock(s.onSubmit) }]
            : [],
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Container': {
        const s = stmt as any;
        const children: IRUINode[] = [];
        for (const child of (s.children || [])) {
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
        const s = stmt as any;
        const children: IRUINode[] = [];
        for (const child of (s.children || [])) {
          const childIR = this.transformStatement(child) as IRUINode;
          if (childIR) children.push(childIR);
        }
        const collectionExpr = s.collection ? this.transformExpression(s.collection) : (s.iterable ? this.transformExpression(s.iterable) : undefined);
        return {
          kind: 'IRList',
          collection: collectionExpr,
          itemVar: s.itemVar || s.iterator,
          styles: s.styles,
          children,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Link': {
        const s = stmt as any;
        const targetRaw = s.target || s.href || '#';
        return {
          kind: 'IRLink',
          label: this.transformExpression(s.label),
          target: this.transformExpression(targetRaw),
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
        const s = stmt as any;
        const body: IRInstructionNode[] = [];
        for (const child of (s.body || s.children || [])) {
          const childIR = this.transformStatement(child);
          if (childIR) body.push(childIR);
        }
        return {
          kind: 'IRComponentDecl',
          name: s.name,
          parameters: [...(s.params || s.parameters || [])],
          body,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'ComponentCall': {
        const s = stmt as any;
        const props: Record<string, IRExpressionNode> = {};
        for (const [k, v] of Object.entries(s.props || {})) {
          props[k] = this.transformExpression(v);
        }
        return {
          kind: 'IRComponentCall',
          componentName: s.componentName || s.name,
          props,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'RouteDeclaration': {
        const s = stmt as any;
        return {
          kind: 'IRRoute',
          path: s.path,
          targetPage: s.targetPage || s.pageName,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'NavigateStatement': {
        const s = stmt as any;
        return {
          kind: 'IRNavigate',
          target: this.transformExpression(s.target),
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Icon': {
        const s = stmt as any;
        return {
          kind: 'IRIcon',
          name: this.transformExpression(s.name),
          size: s.size,
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Badge': {
        const s = stmt as any;
        return {
          kind: 'IRBadge',
          text: this.transformExpression(s.label || s.text),
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'Progress': {
        const s = stmt as any;
        return {
          kind: 'IRProgress',
          value: this.transformExpression(s.value),
          styles: s.styles,
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'CssEscape': {
        const s = stmt as any;
        return {
          kind: 'IRCssEscape',
          cssContent: s.css || s.cssContent || '',
          sourceLine: s.line,
          sourceColumn: s.column,
        };
      }

      case 'JsEscape': {
        const s = stmt as any;
        return {
          kind: 'IRJsEscape',
          jsContent: s.code || s.jsContent || '',
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

  private transformActionDeclaration(stmt: any): IRActionDeclNode {
    return {
      kind: 'IRActionDecl',
      name: stmt.name,
      parameters: [...(stmt.params || stmt.parameters || [])],
      body: this.transformBlock(stmt.body || []),
      sourceLine: stmt.line,
      sourceColumn: stmt.column,
    };
  }

  private transformWhenStatement(stmt: any): IREventHandlerNode {
    return {
      kind: 'IREventHandler',
      eventName: stmt.eventName || stmt.event || '',
      body: this.transformBlock(stmt.body || []),
      sourceLine: stmt.line,
      sourceColumn: stmt.column,
    };
  }

  public transformExpression(expr: any): IRExpressionNode {
    if (!expr) {
      return { kind: 'IRLiteral', value: '', dataType: 'string', sourceLine: 1, sourceColumn: 1 };
    }
    if (typeof expr === 'string' || typeof expr === 'number' || typeof expr === 'boolean') {
      return { kind: 'IRLiteral', value: expr, dataType: typeof expr as any, sourceLine: 1, sourceColumn: 1 };
    }

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

      case 'Identifier':
      case 'VariableReference': {
        const ref = expr as any;
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

  private transformSolanaProgram(stmt: any, appName: string): SolanaProgramIR {
    const progName = stmt.name || appName || 'CounterProgram';
    const accounts: any[] = [];
    const instructions: any[] = [];
    let rawRustEscape: string | undefined;

    for (const item of stmt.body || []) {
      if (item.type === 'AccountDeclaration') {
        const fields = (item.fields || []).map((f: any) => ({
          name: f.name,
          fieldType: normalizeSolanaType(f.fieldType || 'u64'),
          isSigner: Boolean(f.isSigner),
        }));
        accounts.push({
          name: item.name,
          fields,
          spaceEstimate: calculateAccountSpace(fields),
        });
      } else if (item.type === 'InstructionDeclaration') {
        const requires: string[] = [];
        const mutations: any[] = [];
        const cpis: any[] = [];
        let rawRust: string | undefined;

        for (const sub of item.body || []) {
          if (sub.type === 'Require') {
            const condStr = this.expressionToString(sub.condition);
            requires.push(condStr);
          } else if (sub.type === 'SetStatement') {
            const valStr = this.expressionToString(sub.value);
            mutations.push({
              target: sub.variable,
              expression: valStr,
            });
          } else if (sub.type === 'CpiCall') {
            cpis.push({
              targetProgram: sub.programName,
              instructionName: sub.methodName,
              params: {},
            });
          } else if (sub.type === 'RustEscape') {
            rawRust = sub.rustContent;
          }
        }

        const ctxAccounts: any[] = [];
        for (const acc of accounts) {
          ctxAccounts.push({
            name: acc.name.toLowerCase().replace(/state$/i, '') || 'state',
            isMut: true,
            isSigner: false,
            accountType: acc.name,
          });
        }
        ctxAccounts.push({
          name: 'authority',
          isMut: true,
          isSigner: true,
        });

        instructions.push({
          name: item.name,
          accounts: ctxAccounts,
          requires,
          mutations,
          cpis,
          rawRust,
        });
      } else if (item.type === 'RustEscape') {
        rawRustEscape = item.rustContent;
      }
    }

    return {
      programName: progName,
      programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      accounts,
      instructions,
      rawRustEscape,
    };
  }

  private synthesizeSolanaProgram(ast: any, state: IRStateNode[], actions: IRActionDeclNode[]): SolanaProgramIR {
    const progName = ast.appName || ast.name || 'CounterProgram';
    const fields = state.map((s) => ({
      name: s.name,
      fieldType: normalizeSolanaType('u64'),
    }));
    if (fields.length === 0) {
      fields.push({ name: 'counter', fieldType: normalizeSolanaType('u64') });
    }

    const instructions = actions.map((act) => ({
      name: act.name,
      accounts: [
        { name: 'state', isMut: true, isSigner: false, accountType: `${progName}State` },
        { name: 'authority', isMut: true, isSigner: true },
      ],
      requires: ['signer = authority'],
      mutations: [{ target: 'state.counter', expression: 'state.counter + 1' }],
      cpis: [],
    }));

    if (instructions.length === 0) {
      instructions.push({
        name: 'increment',
        accounts: [
          { name: 'state', isMut: true, isSigner: false, accountType: `${progName}State` },
          { name: 'authority', isMut: true, isSigner: true },
        ],
        requires: ['signer = authority'],
        mutations: [{ target: 'state.counter', expression: 'state.counter + 1' }],
        cpis: [],
      });
    }

    return {
      programName: progName,
      programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      accounts: [
        {
          name: `${progName}State`,
          fields,
          spaceEstimate: calculateAccountSpace(fields),
        },
      ],
      instructions,
    };
  }

  private expressionToString(expr: any): string {
    if (!expr) return '';
    switch (expr.type) {
      case 'Literal':
        return String(expr.value);
      case 'VariableReference':
        return expr.name;
      case 'BinaryExpression':
        return `${this.expressionToString(expr.left)} ${expr.operator} ${this.expressionToString(expr.right)}`;
      case 'UnaryExpression':
        return `${expr.operator} ${this.expressionToString(expr.argument)}`;
      default:
        return String(expr.value || expr.name || '');
    }
  }
}

import { Token, TokenType } from '../lexer/tokens.ts';
import { ManifestError } from '../errors/manifest-error.ts';
import {
  AppDeclarationNode,
  StatementNode,
  WhenBlockNode,
  SetStatementNode,
  ShowStatementNode,
  CallStatementNode,
  CallExpressionNode,
  ActionDefinitionNode,
  ReturnStatementNode,
  IfStatementNode,
  RepeatLoopNode,
  ForEachLoopNode,
  TryBlockNode,
  UseStatementNode,
  PageDeclarationNode,
  TextNode,
  ButtonNode,
  StateDeclarationNode,
  InputNode,
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
  NavNode,
  FooterNode,
  ComponentDeclarationNode,
  SolanaProgramNode,
  CssEscapeNode,
  JsEscapeNode,
  ExpressionNode,
  LiteralNode,
  IdentifierNode,
  BinaryExpressionNode,
  ArrayLiteralNode,
} from '../ast/ast.ts';

export class Parser {
  private tokens: Token[];
  private current = 0;
  private source?: string;
  private declaredComponents: Set<string> = new Set();

  constructor(tokens: Token[], source?: string) {
    this.tokens = tokens;
    this.source = source;
  }

  public parse(): AppDeclarationNode {
    this.skipNewlines();

    if (!this.match(TokenType.APP)) {
      throw new ManifestError(
        'Expected APP declaration at start of file',
        this.peek().line,
        this.peek().column,
        'Begin your program with APP "YourAppName"'
      );
    }

    const appToken = this.previous();
    const nameToken = this.consume(
      TokenType.STRING,
      'Expected string name after APP keyword',
      'Example: APP "MyApplication"'
    );
    const appName = nameToken.value;

    const body: StatementNode[] = [];
    this.skipNewlines();

    while (!this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
      } else if (this.match(TokenType.END)) {
        // Trailing or unexpected END consumed
      }
      this.skipNewlines();
    }

    const capabilities: string[] = [];
    for (const stmt of body) {
      if (stmt.type === 'UseStatement') {
        capabilities.push((stmt as any).capability);
      }
    }

    return {
      type: 'AppDeclaration',
      name: appName,
      appName,
      body,
      statements: body,
      capabilities,
      line: appToken.line,
      column: appToken.column,
    };
  }

  private parseStatement(): StatementNode | null {
    this.skipNewlines();
    if (this.isAtEnd()) return null;

    if (this.match(TokenType.WHEN)) {
      return this.parseWhenBlock();
    }
    if (this.match(TokenType.SET)) {
      return this.parseSetStatement();
    }
    if (this.match(TokenType.SHOW)) {
      return this.parseShowStatement();
    }
    if (this.match(TokenType.CALL)) {
      return this.parseCallStatement();
    }
    if (this.match(TokenType.RETURN)) {
      return this.parseReturnStatement();
    }
    if (this.match(TokenType.ACTION)) {
      return this.parseActionDefinition();
    }
    if (this.match(TokenType.IF)) {
      return this.parseIfStatement();
    }
    if (this.match(TokenType.REPEAT)) {
      return this.parseRepeatLoop();
    }
    if (this.match(TokenType.FOR)) {
      return this.parseForEachLoop();
    }
    if (this.match(TokenType.TRY)) {
      return this.parseTryBlock();
    }
    if (this.match(TokenType.USE)) {
      return this.parseUseStatement();
    }
    if (this.match(TokenType.PAGE)) {
      return this.parsePageDeclaration();
    }
    if (this.match(TokenType.TEXT)) {
      return this.parseTextNode();
    }
    if (this.match(TokenType.BUTTON)) {
      return this.parseButtonNode();
    }
    if (this.match(TokenType.STATE)) {
      return this.parseStateDeclaration();
    }
    if (this.match(TokenType.INPUT)) {
      return this.parseInputNode();
    }
    if (this.match(TokenType.FORM)) {
      return this.parseFormNode();
    }
    if (this.match(TokenType.ROUTE)) {
      return this.parseRouteDeclaration();
    }
    if (this.match(TokenType.CONTAINER)) {
      return this.parseContainerNode();
    }
    if (this.match(TokenType.CARD)) {
      return this.parseCardNode();
    }
    if (this.match(TokenType.LIST)) {
      return this.parseListNode();
    }
    if (this.match(TokenType.LINK)) {
      return this.parseLinkNode();
    }
    if (this.match(TokenType.SELECT)) {
      return this.parseSelectNode();
    }
    if (this.match(TokenType.CHECKBOX)) {
      return this.parseCheckboxNode();
    }
    if (this.match(TokenType.TEXTAREA)) {
      return this.parseTextareaNode();
    }
    if (this.match(TokenType.HEADER)) {
      return this.parseHeaderNode();
    }
    if (this.match(TokenType.NAV)) {
      return this.parseNavNode();
    }
    if (this.match(TokenType.FOOTER)) {
      return this.parseFooterNode();
    }
    if (this.match(TokenType.COMPONENT)) {
      return this.parseComponentDeclaration();
    }
    if (this.match(TokenType.PROGRAM)) {
      return this.parseSolanaProgram();
    }
    if (this.match(TokenType.CSS_ESCAPE)) {
      return {
        type: 'CssEscape',
        css: this.previous().value,
        line: this.previous().line,
        column: this.previous().column,
      };
    }
    if (this.match(TokenType.JS_ESCAPE)) {
      return {
        type: 'JsEscape',
        code: this.previous().value,
        line: this.previous().line,
        column: this.previous().column,
      };
    }

    if (this.match(TokenType.STYLE)) {
      this.parseStyleBlock();
      return null;
    }

    const valUpper = this.peek().value?.toUpperCase();
    if (['LAYOUT', 'DIRECTION', 'GAP', 'ALIGN', 'PADDING', 'JUSTIFY', 'BORDER', 'RADIUS'].includes(valUpper)) {
      this.advance();
      while (!this.check(TokenType.NEWLINE) && !this.check(TokenType.END) && !this.isAtEnd()) {
        this.advance();
      }
      return null;
    }

    if (valUpper === 'BADGE') {
      const tok = this.advance();
      const content = this.parseExpression();
      return {
        type: 'Badge',
        text: content,
        content,
        styles: { badge: 'true' },
        line: tok.line,
        column: tok.column,
      } as any;
    }

    if (valUpper === 'PROGRESS') {
      const tok = this.advance();
      const value = this.parseExpression();
      return {
        type: 'Progress',
        value,
        line: tok.line,
        column: tok.column,
      };
    }

    if (valUpper === 'HEADING') {
      const tok = this.advance();
      const content = this.parseExpression();
      let styles: Record<string, string> = { fontSize: '24px', fontWeight: '700' };
      this.skipNewlines();
      if (this.match(TokenType.STYLE)) {
        styles = { ...styles, ...this.parseStyleBlock() };
      }
      return {
        type: 'Text',
        content,
        styles,
        line: tok.line,
        column: tok.column,
      };
    }

    if (valUpper === 'ICON') {
      const tok = this.advance();
      const name = this.parseExpression();
      return {
        type: 'Icon',
        name,
        line: tok.line,
        column: tok.column,
      } as any;
    }

    if (valUpper === 'CSS' && this.tokens[this.current + 1]?.type === TokenType.STRING) {
      const tok = this.advance();
      const cssStr = this.advance().value;
      return {
        type: 'CssEscape',
        css: cssStr,
        line: tok.line,
        column: tok.column,
      };
    }

    if (valUpper === 'JS' && this.tokens[this.current + 1]?.type === TokenType.STRING) {
      const tok = this.advance();
      const jsStr = this.advance().value;
      return {
        type: 'JsEscape',
        code: jsStr,
        line: tok.line,
        column: tok.column,
      };
    }

    if (valUpper === 'ANIMATE') {
      this.advance();
      this.skipNewlines();
      while (!this.check(TokenType.END) && !this.isAtEnd()) {
        this.advance();
        this.skipNewlines();
      }
      this.consume(TokenType.END, 'Expected END to close ANIMATE block');
      return null;
    }

    if (this.peek().type === TokenType.IDENTIFIER) {
      const name = this.peek().value;
      if (this.declaredComponents.has(name) || /^[A-Z]/.test(name)) {
        const tok = this.advance();
        return {
          type: 'ComponentCall',
          componentName: tok.value,
          name: tok.value,
          props: {},
          line: tok.line,
          column: tok.column,
        };
      }
    }

    // Unrecognized token or end
    if (this.peek().type === TokenType.END) {
      return null;
    }

    const t = this.advance();
    throw new ManifestError(
      `Unexpected keyword or token: '${t.value}'`,
      t.line,
      t.column,
      'Check syntax or keywords.'
    );
  }

  private parseWhenBlock(): WhenBlockNode {
    const whenTok = this.previous();
    let eventName = '';

    while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
      eventName += this.advance().value;
    }

    this.skipNewlines();
    const body: StatementNode[] = [];

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close WHEN block', 'Add END after event block');

    return {
      type: 'WhenBlock',
      event: eventName.trim(),
      body,
      line: whenTok.line,
      column: whenTok.column,
    };
  }

  private parseSetStatement(): SetStatementNode {
    const setTok = this.previous();
    const varName = this.consume(
      TokenType.IDENTIFIER,
      'Expected variable name after SET',
      'Example: SET count TO 0'
    ).value;

    if (!this.match(TokenType.TO) && !this.match(TokenType.EQUALS)) {
      throw new ManifestError(
        'Expected TO or = after variable name in SET statement',
        this.peek().line,
        this.peek().column,
        'Example: SET count = count + 1 or SET count TO 0'
      );
    }

    if (this.check(TokenType.NEWLINE) || this.isAtEnd()) {
      throw new ManifestError(
        'Missing value after SET TO: expected a value after TO',
        this.peek().line,
        this.peek().column,
        'Example: SET balance TO 100'
      );
    }

    const value = this.parseExpression();

    return {
      type: 'SetStatement',
      variable: varName,
      value,
      line: setTok.line,
      column: setTok.column,
    };
  }

  private parseShowStatement(): ShowStatementNode {
    const tok = this.previous();
    const expr = this.parseExpression();
    return {
      type: 'ShowStatement',
      expression: expr,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseCallStatement(): CallStatementNode {
    const tok = this.previous();
    const actionName = this.consume(
      TokenType.IDENTIFIER,
      'Expected action name after CALL',
      'Example: CALL logMessage WITH "hello"'
    ).value;

    const args: ExpressionNode[] = [];
    if (this.match(TokenType.WITH)) {
      do {
        args.push(this.parseExpression());
      } while (this.match(TokenType.COMMA));
    } else {
      while (
        !this.check(TokenType.NEWLINE) &&
        !this.check(TokenType.END) &&
        !this.check(TokenType.ELSE) &&
        !this.isAtEnd()
      ) {
        args.push(this.parseFactor());
        this.match(TokenType.COMMA);
      }
    }

    return {
      type: 'CallStatement',
      actionName,
      args,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseActionDefinition(): ActionDefinitionNode {
    const tok = this.previous();
    const name = this.consume(
      TokenType.IDENTIFIER,
      'Expected action name after ACTION',
      'Example: ACTION addNumbers a, b'
    ).value;

    const params: string[] = [];
    if (this.match(TokenType.WITH)) {
      do {
        params.push(this.consume(TokenType.IDENTIFIER, 'Expected parameter name').value);
      } while (this.match(TokenType.COMMA));
    } else {
      while (
        !this.check(TokenType.NEWLINE) &&
        !this.check(TokenType.RETURNS) &&
        !this.check(TokenType.END) &&
        !this.isAtEnd()
      ) {
        if (this.check(TokenType.IDENTIFIER)) {
          params.push(this.advance().value);
          this.match(TokenType.COMMA);
        } else {
          break;
        }
      }
    }

    let returnType: string | undefined;
    if (this.match(TokenType.RETURNS)) {
      returnType = this.advance().value;
    }

    this.skipNewlines();
    const body: StatementNode[] = [];

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close ACTION definition', 'Add END after action block');

    return {
      type: 'ActionDefinition',
      name,
      params,
      returnType,
      body,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseReturnStatement(): ReturnStatementNode {
    const tok = this.previous();
    const expression = this.parseExpression();
    return {
      type: 'ReturnStatement',
      expression,
      value: expression,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseIfStatement(): IfStatementNode {
    const tok = this.previous();
    const condition = this.parseExpression();

    this.skipNewlines();
    const thenBranch: StatementNode[] = [];
    let elseBranch: StatementNode[] | undefined;

    while (!this.check(TokenType.ELSE) && !this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) thenBranch.push(stmt);
      this.skipNewlines();
    }

    if (this.match(TokenType.ELSE)) {
      this.skipNewlines();
      elseBranch = [];
      while (!this.check(TokenType.END) && !this.isAtEnd()) {
        if (this.match(TokenType.NEWLINE)) continue;
        const stmt = this.parseStatement();
        if (stmt) elseBranch.push(stmt);
        this.skipNewlines();
      }
    }

    this.consume(TokenType.END, 'Expected END to close IF block: block was never closed with END', 'Add END after IF block');

    return {
      type: 'IfStatement',
      condition,
      thenBranch,
      elseBranch,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseRepeatLoop(): RepeatLoopNode {
    const tok = this.previous();
    const count = this.parseExpression();
    this.consume(TokenType.TIMES, 'Expected TIMES after REPEAT count', 'Example: REPEAT 5 TIMES');

    this.skipNewlines();
    const body: StatementNode[] = [];

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close REPEAT block');

    return {
      type: 'RepeatLoop',
      count,
      body,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseForEachLoop(): ForEachLoopNode {
    const tok = this.previous();
    this.consume(TokenType.EACH, 'Expected EACH after FOR', 'Example: FOR EACH item IN items');
    const iterator = this.consume(TokenType.IDENTIFIER, 'Expected iterator variable name').value;
    this.consume(TokenType.IN, 'Expected IN after iterator variable');
    const iterable = this.parseExpression();

    this.skipNewlines();
    const body: StatementNode[] = [];

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close FOR EACH loop');

    return {
      type: 'ForEachLoop',
      iterator,
      iterable,
      body,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseTryBlock(): TryBlockNode {
    const tok = this.previous();
    this.skipNewlines();
    const body: StatementNode[] = [];
    let catchBranch: StatementNode[] | undefined;

    while (!this.check(TokenType.IF) && !this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.match(TokenType.IF)) {
      this.consume(TokenType.FAILED, 'Expected FAILED after IF in TRY block', 'Example: IF FAILED');
      this.skipNewlines();
      catchBranch = [];
      while (!this.check(TokenType.END) && !this.isAtEnd()) {
        if (this.match(TokenType.NEWLINE)) continue;
        const stmt = this.parseStatement();
        if (stmt) catchBranch.push(stmt);
        this.skipNewlines();
      }
    }

    this.consume(TokenType.END, 'Expected END to close TRY block');

    return {
      type: 'TryBlock',
      body,
      catchBranch,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseUseStatement(): UseStatementNode {
    const tok = this.previous();
    let capability = '';
    while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
      capability += (capability ? ' ' : '') + this.advance().value;
    }
    return {
      type: 'UseStatement',
      capability: capability.trim(),
      line: tok.line,
      column: tok.column,
    };
  }

  private parsePageDeclaration(): PageDeclarationNode {
    const tok = this.previous();
    if (this.check(TokenType.NEWLINE) || this.isAtEnd()) {
      throw new ManifestError(
        'Expected page name after PAGE',
        tok.line,
        tok.column,
        'Example: PAGE Home'
      );
    }

    const name = this.advance().value.replace(/['"]/g, '');
    let route: string | undefined;
    if (this.match(TokenType.ROUTE)) {
      route = this.advance().value.replace(/['"]/g, '');
    }
    this.skipNewlines();
    const body: StatementNode[] = [];
    let styles: Record<string, string> | undefined;

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      if (this.match(TokenType.STYLE)) {
        styles = this.parseStyleBlock();
        this.skipNewlines();
        continue;
      }
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close PAGE block: page was never closed with END', 'Add END at the end of the page block');

    return {
      type: 'PageDeclaration',
      name,
      route,
      styles,
      body,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseTextNode(): TextNode {
    const tok = this.previous();
    const content = this.parseExpression();
    let styles: Record<string, string> | undefined;

    this.skipNewlines();
    if (this.match(TokenType.STYLE)) {
      styles = this.parseStyleBlock();
      this.skipNewlines();
    }

    return {
      type: 'Text',
      content,
      styles,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseButtonNode(): ButtonNode {
    const tok = this.previous();
    const label = this.parseExpression();
    let styles: Record<string, string> | undefined;
    let onClick: StatementNode[] | undefined;
    let hasBlock = false;

    this.skipNewlines();

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;

      if (this.match(TokenType.STYLE)) {
        hasBlock = true;
        styles = this.parseStyleBlock();
        this.skipNewlines();
        continue;
      }

      if (this.peek().value?.toUpperCase() === 'ANIMATE') {
        hasBlock = true;
        this.advance();
        this.skipNewlines();
        while (!this.check(TokenType.END) && !this.isAtEnd()) {
          this.advance();
          this.skipNewlines();
        }
        this.consume(TokenType.END, 'Expected END to close ANIMATE block');
        this.skipNewlines();
        continue;
      }

      if (this.check(TokenType.WHEN) && this.tokens[this.current + 1]?.type === TokenType.CLICK) {
        hasBlock = true;
        this.advance(); // consume WHEN
        this.advance(); // consume CLICK
        this.skipNewlines();
        onClick = [];
        while (!this.check(TokenType.END) && !this.isAtEnd()) {
          if (this.match(TokenType.NEWLINE)) continue;
          const stmt = this.parseStatement();
          if (stmt) onClick.push(stmt);
          this.skipNewlines();
        }
        this.consume(TokenType.END, 'Expected END to close WHEN CLICK block');
        this.skipNewlines();
        continue;
      }

      break;
    }

    if (hasBlock) {
      this.skipNewlines();
      if (this.match(TokenType.END)) {
        // button closed
      }
    }

    return {
      type: 'Button',
      label,
      styles,
      onClick,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseStateDeclaration(): StateDeclarationNode {
    const tok = this.previous();
    if (
      this.check(TokenType.NEWLINE) ||
      this.isAtEnd() ||
      this.check(TokenType.TO) ||
      this.check(TokenType.EQUALS) ||
      this.check(TokenType.COLON)
    ) {
      throw new ManifestError(
        'Expected state variable name after STATE',
        tok.line,
        tok.column,
        'Example: STATE count = 0'
      );
    }

    const name = this.advance().value;
    let dataType: string | undefined;

    if (this.check(TokenType.COLON)) {
      this.advance();
      dataType = this.advance().value;
    }

    // Support both = and SET TO
    if (this.match(TokenType.EQUALS) || this.match(TokenType.TO)) {
      // ok
    } else if (this.match(TokenType.SET)) {
      this.consume(TokenType.TO, 'Expected TO after SET');
    }

    const initialValue = this.parseExpression();

    return {
      type: 'StateDeclaration',
      name,
      dataType,
      initialValue,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseInputNode(): InputNode {
    const tok = this.previous();
    let placeholder: string | undefined;
    let bindVariable: string | undefined;
    let styles: Record<string, string> | undefined;

    // Check if directly followed by string placeholder: INPUT "Enter username" INTO username
    if (this.check(TokenType.STRING)) {
      placeholder = this.advance().value.replace(/['"]/g, '');
      if (this.matchIdentifier('INTO') || this.matchIdentifier('BIND') || this.match(TokenType.TO)) {
        bindVariable = this.consume(TokenType.IDENTIFIER, 'Expected variable name after INTO').value;
      }
    }

    while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
      const word = this.peek().value.toUpperCase();
      if (word === 'PLACEHOLDER') {
        this.advance();
        placeholder = this.advance().value.replace(/['"]/g, '');
      } else if (word === 'BIND' || word === 'INTO') {
        this.advance();
        bindVariable = this.advance().value;
      } else if (this.match(TokenType.STYLE)) {
        styles = this.parseStyleBlock();
      } else {
        this.advance();
      }
    }

    return {
      type: 'Input',
      placeholder,
      bindVariable,
      styles,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseFormNode(): FormNode {
    const tok = this.previous();
    let name = 'Form';
    if (this.check(TokenType.IDENTIFIER)) {
      name = this.advance().value;
    }
    this.skipNewlines();
    const children: StatementNode[] = [];
    let onSubmit: StatementNode[] | undefined;

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      if (this.check(TokenType.WHEN) && this.tokens[this.current + 1]?.type === TokenType.SUBMIT) {
        this.advance(); // consume WHEN
        this.advance(); // consume SUBMIT
        this.skipNewlines();
        onSubmit = [];
        while (!this.check(TokenType.END) && !this.isAtEnd()) {
          if (this.match(TokenType.NEWLINE)) continue;
          const stmt = this.parseStatement();
          if (stmt) onSubmit.push(stmt);
          this.skipNewlines();
        }
        this.consume(TokenType.END, 'Expected END to close WHEN SUBMIT block');
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close FORM block');

    return {
      type: 'Form',
      name,
      children,
      onSubmit,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseRouteDeclaration(): RouteDeclarationNode {
    const tok = this.previous();
    const path = this.advance().value.replace(/['"]/g, '');
    if (this.match(TokenType.TO)) {
      // ROUTE "/path" TO PageName
    } else if (this.peek().value === '->') {
      this.advance();
    } else if (this.check(TokenType.MINUS) && this.tokens[this.current + 1]?.type === TokenType.GREATER) {
      this.advance();
      this.advance();
    } else {
      this.consume(TokenType.TO, 'Expected TO or -> after route path');
    }
    const pageName = this.advance().value.replace(/['"]/g, '');

    return {
      type: 'RouteDeclaration',
      path,
      pageName,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseContainerNode(): ContainerNode {
    const tok = this.previous();
    const styles: Record<string, string> = {};
    this.skipNewlines();

    if (this.match(TokenType.STYLE)) {
      Object.assign(styles, this.parseStyleBlock());
      this.skipNewlines();
    }

    const children: StatementNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const peekVal = this.peek().value?.toUpperCase();
      if (['LAYOUT', 'DIRECTION', 'GAP', 'ALIGN', 'PADDING', 'JUSTIFY', 'WIDTH', 'HEIGHT', 'BACKGROUND', 'COLOR'].includes(peekVal)) {
        const prop = this.advance().value;
        this.match(TokenType.COLON);
        let val = '';
        while (!this.check(TokenType.NEWLINE) && !this.check(TokenType.END) && !this.isAtEnd()) {
          val += (val ? ' ' : '') + this.advance().value.replace(/['"]/g, '');
        }
        const norm = this.normalizeStyle(prop, val);
        styles[norm.key] = norm.value;
        this.skipNewlines();
        continue;
      }
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close CONTAINER block');

    return {
      type: 'Container',
      children,
      styles: Object.keys(styles).length > 0 ? styles : undefined,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseCardNode(): CardNode {
    const tok = this.previous();
    let styles: Record<string, string> | undefined;
    this.skipNewlines();

    if (this.match(TokenType.STYLE)) {
      styles = this.parseStyleBlock();
      this.skipNewlines();
    }

    const children: StatementNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close CARD block');

    return {
      type: 'Card',
      children,
      styles,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseListNode(): ListNode {
    const tok = this.previous();
    let styles: Record<string, string> | undefined;
    this.skipNewlines();

    if (this.match(TokenType.STYLE)) {
      styles = this.parseStyleBlock();
      this.skipNewlines();
    }

    const children: StatementNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close LIST block');

    return {
      type: 'List',
      children,
      styles,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseLinkNode(): LinkNode {
    const tok = this.previous();
    const label = this.advance().value.replace(/['"]/g, '');
    this.consume(TokenType.TO, 'Expected TO after link label');
    const href = this.advance().value.replace(/['"]/g, '');

    return {
      type: 'Link',
      label,
      href,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseSelectNode(): SelectNode {
    const tok = this.previous();
    let bindVariable: string | undefined;
    const options: Array<{ value: string; label: string }> = [];

    while (!this.check(TokenType.NEWLINE) && !this.check(TokenType.END) && !this.isAtEnd()) {
      const valUp = this.peek().value?.toUpperCase();
      if (valUp === 'INTO' || valUp === 'BIND') {
        this.advance();
        bindVariable = this.advance().value;
      } else {
        this.advance();
      }
    }

    this.skipNewlines();

    // Check if multi-line block with options follows
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      if (this.match(TokenType.OPTION)) {
        const val = this.advance().value.replace(/['"]/g, '');
        const lbl = this.peek().type === TokenType.STRING ? this.advance().value.replace(/['"]/g, '') : val;
        options.push({ value: val, label: lbl });
        this.skipNewlines();
        continue;
      }
      break;
    }

    if (this.match(TokenType.END)) {
      // closed multi-line SELECT
    }

    return {
      type: 'Select',
      bindVariable,
      options,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseCheckboxNode(): CheckboxNode {
    const tok = this.previous();
    let label = '';
    let bindVariable: string | undefined;

    while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
      const valUp = this.peek().value?.toUpperCase();
      if (valUp === 'BIND' || valUp === 'INTO') {
        this.advance();
        bindVariable = this.advance().value;
      } else {
        label += (label ? ' ' : '') + this.advance().value.replace(/['"]/g, '');
      }
    }

    return {
      type: 'Checkbox',
      label: label.trim(),
      bindVariable,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseTextareaNode(): TextareaNode {
    const tok = this.previous();
    let bindVariable: string | undefined;
    let placeholder: string | undefined;

    while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
      const valUp = this.peek().value?.toUpperCase();
      if (valUp === 'BIND' || valUp === 'INTO') {
        this.advance();
        bindVariable = this.advance().value;
      } else if (valUp === 'PLACEHOLDER') {
        this.advance();
        placeholder = this.advance().value.replace(/['"]/g, '');
      } else {
        placeholder = (placeholder ? placeholder + ' ' : '') + this.advance().value.replace(/['"]/g, '');
      }
    }

    return {
      type: 'Textarea',
      placeholder: placeholder ? placeholder.trim() : undefined,
      bindVariable,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseHeaderNode(): HeaderNode {
    const tok = this.previous();
    this.skipNewlines();
    const children: StatementNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }
    this.consume(TokenType.END, 'Expected END to close HEADER');
    return { type: 'Header', children, line: tok.line, column: tok.column };
  }

  private parseNavNode(): NavNode {
    const tok = this.previous();
    this.skipNewlines();
    const children: StatementNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }
    this.consume(TokenType.END, 'Expected END to close NAV');
    return { type: 'Nav', children, line: tok.line, column: tok.column };
  }

  private parseFooterNode(): FooterNode {
    const tok = this.previous();
    this.skipNewlines();
    const children: StatementNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }
    this.consume(TokenType.END, 'Expected END to close FOOTER');
    return { type: 'Footer', children, line: tok.line, column: tok.column };
  }

  private parseComponentDeclaration(): ComponentDeclarationNode {
    const tok = this.previous();
    const name = this.advance().value;
    this.skipNewlines();
    const children: StatementNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }
    this.consume(TokenType.END, 'Expected END to close COMPONENT');
    return { type: 'ComponentDeclaration', name, children, line: tok.line, column: tok.column };
  }

  private parseSolanaProgram(): SolanaProgramNode {
    const tok = this.previous();
    const name = this.advance().value;
    this.skipNewlines();

    const accounts: Array<{ name: string; fields: Array<{ name: string; fieldType: string }> }> = [];
    const instructions: Array<{
      name: string;
      accounts: Array<{ name: string; isMut: boolean; isSigner: boolean; accountType?: string }>;
      requires: string[];
      mutations: Array<{ target: string; expression: string }>;
      cpis: any[];
      rawRust?: string;
    }> = [];

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;

      if (this.match(TokenType.ACCOUNT)) {
        const accName = this.advance().value;
        this.skipNewlines();
        const fields: Array<{ name: string; fieldType: string }> = [];

        while (!this.check(TokenType.END) && !this.isAtEnd()) {
          if (this.match(TokenType.NEWLINE)) continue;
          const fieldName = this.advance().value;
          this.match(TokenType.COLON);
          const fieldType = this.advance().value;
          fields.push({ name: fieldName, fieldType });
          this.skipNewlines();
        }
        this.consume(TokenType.END, 'Expected END to close ACCOUNT');
        accounts.push({ name: accName, fields });
        continue;
      }

      if (this.match(TokenType.INSTRUCTION)) {
        const instName = this.advance().value;
        this.skipNewlines();
        const instAccounts: Array<{ name: string; isMut: boolean; isSigner: boolean; accountType?: string }> = [];
        const requires: string[] = [];
        const mutations: Array<{ target: string; expression: string }> = [];

        while (!this.check(TokenType.END) && !this.isAtEnd()) {
          if (this.match(TokenType.NEWLINE)) continue;

          if (this.match(TokenType.ACCOUNTS)) {
            this.skipNewlines();
            while (!this.check(TokenType.END) && !this.isAtEnd()) {
              if (this.match(TokenType.NEWLINE)) continue;
              let isSigner = false;
              let isMut = false;
              if (this.match(TokenType.SIGNER)) isSigner = true;
              if (this.match(TokenType.MUT)) isMut = true;
              const aName = this.advance().value;
              let aType: string | undefined;
              if (this.match(TokenType.COLON)) {
                aType = this.advance().value;
              }
              instAccounts.push({ name: aName, isSigner, isMut, accountType: aType });
              this.skipNewlines();
            }
            this.consume(TokenType.END, 'Expected END to close ACCOUNTS');
            continue;
          }

          if (this.match(TokenType.REQUIRE)) {
            let req = '';
            while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
              req += (req ? ' ' : '') + this.advance().value;
            }
            requires.push(req);
            continue;
          }

          // Mutations: target = expr
          if (this.peek().type === TokenType.IDENTIFIER && this.tokens[this.current + 1]?.value === '=') {
            const target = this.advance().value;
            this.advance(); // =
            let expr = '';
            while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
              expr += (expr ? ' ' : '') + this.advance().value;
            }
            mutations.push({ target, expression: expr });
            continue;
          }

          this.advance();
        }

        this.consume(TokenType.END, 'Expected END to close INSTRUCTION');
        instructions.push({
          name: instName,
          accounts: instAccounts,
          requires,
          mutations,
          cpis: [],
        });
        continue;
      }

      this.advance();
    }

    this.consume(TokenType.END, 'Expected END to close PROGRAM');

    return {
      type: 'SolanaProgram',
      name,
      accounts,
      instructions,
      line: tok.line,
      column: tok.column,
    };
  }

  private parseStyleBlock(): Record<string, string> {
    const styles: Record<string, string> = {};
    this.skipNewlines();

    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      if (this.match(TokenType.NEWLINE)) continue;
      const key = this.advance().value;
      this.match(TokenType.COLON);
      let val = '';
      while (!this.check(TokenType.NEWLINE) && !this.check(TokenType.END) && !this.isAtEnd()) {
        if (this.tokens[this.current + 1]?.type === TokenType.COLON) {
          break;
        }
        val += (val ? ' ' : '') + this.advance().value.replace(/['"]/g, '');
      }
      const norm = this.normalizeStyle(key, val);
      styles[norm.key] = norm.value;
      this.skipNewlines();
    }

    this.consume(TokenType.END, 'Expected END to close STYLE block');
    return styles;
  }

  private normalizeStyle(key: string, val: string): { key: string; value: string } {
    const cleanKey = key.replace(/[-_]/g, '').toUpperCase();
    let prop = key.toLowerCase();
    let v = val.trim();

    if (cleanKey === 'LAYOUT' || cleanKey === 'DISPLAY') {
      prop = 'display';
      v = v.toLowerCase();
    } else if (cleanKey === 'DIRECTION' || cleanKey === 'FLEXDIRECTION') {
      prop = 'flexDirection';
      v = v.toLowerCase();
    } else if (cleanKey === 'ALIGN' || cleanKey === 'ALIGNITEMS') {
      prop = 'alignItems';
      v = v.toLowerCase();
    } else if (cleanKey === 'JUSTIFY' || cleanKey === 'JUSTIFYCONTENT') {
      prop = 'justifyContent';
      v = v.toLowerCase();
    } else if (cleanKey === 'RADIUS' || cleanKey === 'BORDERRADIUS') {
      prop = 'borderRadius';
    } else if (cleanKey === 'FONTSIZE') {
      prop = 'fontSize';
    } else if (cleanKey === 'FONTWEIGHT') {
      prop = 'fontWeight';
    } else if (cleanKey === 'BACKGROUNDCOLOR') {
      prop = 'backgroundColor';
    } else if (cleanKey === 'TEXTALIGN') {
      prop = 'textAlign';
    } else if (cleanKey === 'WIDTH') {
      prop = 'width';
    } else if (cleanKey === 'HEIGHT') {
      prop = 'height';
    } else if (cleanKey === 'MINHEIGHT') {
      prop = 'minHeight';
    } else if (cleanKey === 'MAXWIDTH') {
      prop = 'maxWidth';
    } else if (cleanKey === 'COLOR') {
      prop = 'color';
    } else if (cleanKey === 'BACKGROUND') {
      prop = 'background';
    } else if (cleanKey === 'GAP') {
      prop = 'gap';
    } else if (cleanKey === 'PADDING') {
      prop = 'padding';
    } else if (cleanKey === 'MARGIN') {
      prop = 'margin';
    } else if (cleanKey === 'BORDER') {
      prop = 'border';
    } else if (cleanKey === 'SHADOW' || cleanKey === 'BOXSHADOW') {
      prop = 'boxShadow';
    } else if (cleanKey === 'CURSOR') {
      prop = 'cursor';
    }

    if (
      prop !== 'fontWeight' &&
      prop !== 'display' &&
      prop !== 'flexDirection' &&
      prop !== 'alignItems' &&
      prop !== 'justifyContent' &&
      prop !== 'cursor' &&
      !v.startsWith('#') &&
      !v.startsWith('rgb') &&
      !v.startsWith('hsl') &&
      !v.endsWith('px') &&
      !v.endsWith('%') &&
      !v.endsWith('rem') &&
      !v.endsWith('em') &&
      !v.endsWith('vh') &&
      !v.endsWith('vw')
    ) {
      const parts = v.split(/\s+/);
      if (parts.length > 0 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
        v = parts.map((p) => `${p}px`).join(' ');
      }
    }

    return { key: prop, value: v };
  }

  // --- Expression Parsing with Precedence ---
  public parseExpression(): ExpressionNode {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): ExpressionNode {
    let expr = this.parseLogicalAnd();
    while (this.matchIdentifier('OR') || this.matchIdentifier('||')) {
      const op = this.previous().value;
      const right = this.parseLogicalAnd();
      expr = { type: 'BinaryExpression', operator: op, left: expr, right, line: expr.line, column: expr.column };
    }
    return expr;
  }

  private parseLogicalAnd(): ExpressionNode {
    let expr = this.parseEquality();
    while (this.matchIdentifier('AND') || this.matchIdentifier('&&')) {
      const op = this.previous().value;
      const right = this.parseEquality();
      expr = { type: 'BinaryExpression', operator: op, left: expr, right, line: expr.line, column: expr.column };
    }
    return expr;
  }

  private parseEquality(): ExpressionNode {
    let expr = this.parseComparison();
    while (
      this.match(TokenType.EQ_EQ) ||
      this.match(TokenType.NOT_EQUALS) ||
      this.match(TokenType.EQUALS)
    ) {
      const op = this.previous().value;
      const right = this.parseComparison();
      expr = { type: 'BinaryExpression', operator: op, left: expr, right, line: expr.line, column: expr.column };
    }
    return expr;
  }

  private parseComparison(): ExpressionNode {
    let expr = this.parseTerm();
    while (
      this.match(TokenType.GREATER) ||
      this.match(TokenType.GREATER_EQ) ||
      this.match(TokenType.LESS) ||
      this.match(TokenType.LESS_EQ)
    ) {
      const op = this.previous().value;
      const right = this.parseTerm();
      expr = { type: 'BinaryExpression', operator: op, left: expr, right, line: expr.line, column: expr.column };
    }
    return expr;
  }

  private parseTerm(): ExpressionNode {
    let expr = this.parseFactor();
    while (this.match(TokenType.PLUS) || this.match(TokenType.MINUS)) {
      const op = this.previous().value;
      const right = this.parseFactor();
      expr = { type: 'BinaryExpression', operator: op, left: expr, right, line: expr.line, column: expr.column };
    }
    return expr;
  }

  private parseFactor(): ExpressionNode {
    let expr = this.parseUnary();
    while (this.match(TokenType.STAR) || this.match(TokenType.SLASH) || this.match(TokenType.PERCENT)) {
      const op = this.previous().value;
      const right = this.parseUnary();
      expr = { type: 'BinaryExpression', operator: op, left: expr, right, line: expr.line, column: expr.column };
    }
    return expr;
  }

  private parseUnary(): ExpressionNode {
    if (this.matchIdentifier('NOT') || this.matchIdentifier('!')) {
      const tok = this.previous();
      const argument = this.parseUnary();
      return { type: 'UnaryExpression', operator: 'NOT', argument, line: tok.line, column: tok.column };
    }
    if (this.match(TokenType.MINUS)) {
      const tok = this.previous();
      const argument = this.parseUnary();
      return { type: 'UnaryExpression', operator: '-', argument, line: tok.line, column: tok.column };
    }
    if (this.match(TokenType.PLUS)) {
      const tok = this.previous();
      const argument = this.parseUnary();
      return { type: 'UnaryExpression', operator: '+', argument, line: tok.line, column: tok.column };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExpressionNode {
    let expr = this.parsePrimary();
    while (this.check(TokenType.LBRACKET) && this.peek().line === expr.line) {
      const tok = this.advance();
      const index = this.parseExpression();
      this.consume(TokenType.RBRACKET, 'Expected ] after index expression');
      expr = {
        type: 'IndexAccess',
        target: expr,
        index,
        line: tok.line,
        column: tok.column,
      } as any;
    }
    return expr;
  }

  private parsePrimary(): ExpressionNode {
    if (this.match(TokenType.NUMBER)) {
      const t = this.previous();
      return { type: 'Literal', value: Number(t.value), raw: t.value, line: t.line, column: t.column };
    }
    if (this.match(TokenType.STRING)) {
      const t = this.previous();
      return { type: 'Literal', value: t.value, raw: `"${t.value}"`, line: t.line, column: t.column };
    }
    if (this.match(TokenType.BOOLEAN)) {
      const t = this.previous();
      return { type: 'Literal', value: t.value.toUpperCase() === 'TRUE', raw: t.value, line: t.line, column: t.column };
    }
    if (this.match(TokenType.LBRACKET)) {
      const tok = this.previous();
      const elements: ExpressionNode[] = [];
      if (!this.check(TokenType.RBRACKET)) {
        do {
          elements.push(this.parseExpression());
        } while (this.match(TokenType.COMMA));
      }
      this.consume(TokenType.RBRACKET, 'Expected ] to close array literal');
      return { type: 'ArrayLiteral', elements, line: tok.line, column: tok.column };
    }
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RPAREN, 'Expected ) after expression');
      return expr;
    }
    if (this.match(TokenType.IDENTIFIER)) {
      const t = this.previous();
      let name = t.value;
      while (this.match(TokenType.DOT)) {
        name += '.' + this.consume(TokenType.IDENTIFIER, 'Expected property name after .').value;
      }
      return { type: 'Identifier', name, line: t.line, column: t.column };
    }
    if (this.match(TokenType.CALL)) {
      const tok = this.previous();
      const actionName = this.consume(
        TokenType.IDENTIFIER,
        'Expected action name after CALL',
        'Example: CALL add 5 10'
      ).value;
      const args: ExpressionNode[] = [];
      if (this.match(TokenType.WITH)) {
        do {
          args.push(this.parseExpression());
        } while (this.match(TokenType.COMMA));
      } else {
        while (
          !this.check(TokenType.NEWLINE) &&
          !this.check(TokenType.END) &&
          !this.check(TokenType.ELSE) &&
          !this.check(TokenType.RPAREN) &&
          !this.check(TokenType.RBRACKET) &&
          !this.isAtEnd()
        ) {
          args.push(this.parseFactor());
          this.match(TokenType.COMMA);
        }
      }
      return {
        type: 'CallExpression',
        actionName,
        args,
        line: tok.line,
        column: tok.column,
      } as any;
    }

    const t = this.peek();
    throw new ManifestError(
      `Unexpected expression token: '${t.value}'`,
      t.line,
      t.column,
      'Provide a valid literal, variable, or expression.'
    );
  }

  private match(...types: TokenType[]): boolean {
    for (const t of types) {
      if (this.check(t)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private matchIdentifier(val: string): boolean {
    if (this.peek().type === TokenType.IDENTIFIER && this.peek().value.toUpperCase() === val.toUpperCase()) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current] || { type: TokenType.EOF, value: '', line: 1, column: 1 };
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(type: TokenType, message: string, hint?: string): Token {
    if (this.check(type)) return this.advance();
    const t = this.peek();
    throw new ManifestError(message, t.line, t.column, hint);
  }

  private skipNewlines() {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }
}

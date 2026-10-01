/**
 * Manifest Core v0.1 - Parser
 * Parses token stream into a structured AST with beginner-friendly diagnostics.
 */

import { Token, TokenType } from '../lexer/tokens.ts';
import { ManifestError } from '../errors/manifest-error.ts';
import {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  AppDeclarationNode,
  UseDeclarationNode,
  SetStatementNode,
  ShowStatementNode,
  IfStatementNode,
  ElseIfBranch,
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
  LibraryDeclarationNode,
  AnimateNode,
  TableNode,
  DialogNode,
  TabsNode,
  MenuNode,
  SidebarNode,
  AvatarNode,
  BadgeNode,
  ProgressNode,
  IconNode,
  VideoNode,
  AudioNode,
  CssEscapeNode,
  JsEscapeNode,
  RustEscapeNode,
  ProgramDeclarationNode,
  AccountDeclarationNode,
  InstructionDeclarationNode,
  RequireNode,
  CpiCallNode,
  AccountField,
  LiteralNode,
  ArrayLiteralNode,
  VariableReferenceNode,
  BinaryExpressionNode,
  UnaryExpressionNode,
  CallExpressionNode,
  IndexAccessNode,
} from '../ast/ast.ts';

export class Parser {
  private readonly tokens: Token[];
  private readonly sourceLines: string[];
  private cursor: number = 0;

  constructor(tokens: Token[], source: string = '') {
    this.tokens = tokens;
    this.sourceLines = source.split('\n');
  }

  public parse(): ProgramNode {
    const statements: StatementNode[] = [];
    let appName: string | undefined;
    const capabilities: string[] = [];

    this.skipNewlines();

    while (!this.isAtEnd()) {
      if (this.peek().type === TokenType.END) {
        this.advance(); // consume optional closing END of APP block
        this.skipNewlines();
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) {
        if (stmt.type === 'AppDeclaration') {
          appName = stmt.name;
        } else if (stmt.type === 'UseDeclaration') {
          capabilities.push(stmt.capability);
        }
        statements.push(stmt);
      }
      this.skipNewlines();
    }

    return {
      type: 'Program',
      appName,
      capabilities,
      statements,
      line: 1,
      column: 1,
    };
  }

  // ----------------------------------------------------
  // Statement Parsing
  // ----------------------------------------------------

  private parseStatement(): StatementNode | null {
    this.skipNewlines();
    if (this.isAtEnd()) return null;

    const token = this.peek();

    switch (token.type) {
      case TokenType.APP:
        return this.parseAppDeclaration();

      case TokenType.USE:
        return this.parseUseDeclaration();

      case TokenType.SET:
        return this.parseSetStatement();

      case TokenType.SHOW:
        return this.parseShowStatement();

      case TokenType.IF:
        return this.parseIfStatement();

      case TokenType.WHEN:
        return this.parseWhenStatement();

      case TokenType.REPEAT:
        return this.parseRepeatStatement();

      case TokenType.FOR:
        return this.parseForEachStatement();

      case TokenType.ACTION:
        return this.parseActionDeclaration();

      case TokenType.CALL:
        return this.parseCallStatement();

      case TokenType.RETURN:
        return this.parseReturnStatement();

      case TokenType.TRY:
        return this.parseTryStatement();

      // Manifest v0.2 Application UI Primitives
      case TokenType.STATE:
        return this.parseStateDeclaration();

      case TokenType.PAGE:
        return this.parsePageDeclaration();

      case TokenType.TEXT:
        return this.parseTextNode();

      case TokenType.BUTTON:
        return this.parseButtonNode();

      case TokenType.INPUT:
        return this.parseInputNode();

      case TokenType.IMAGE:
        return this.parseImageNode();

      case TokenType.FORM:
        return this.parseFormNode();

      case TokenType.ROUTE:
        return this.parseRouteDeclaration();

      // Manifest v0.3 UI Primitives, Layout & Design System
      case TokenType.CONTAINER:
        return this.parseContainerNode();

      case TokenType.CARD:
        return this.parseCardNode();

      case TokenType.LIST:
        return this.parseListNode();

      case TokenType.LINK:
        return this.parseLinkNode();

      case TokenType.SELECT:
        return this.parseSelectNode();

      case TokenType.CHECKBOX:
        return this.parseCheckboxNode();

      case TokenType.TEXTAREA:
        return this.parseTextareaNode();

      case TokenType.HEADER:
        return this.parseHeaderNode();

      case TokenType.FOOTER:
        return this.parseFooterNode();

      case TokenType.NAV:
        return this.parseNavNode();

      case TokenType.MODAL:
        return this.parseModalNode();

      case TokenType.COMPONENT:
        return this.parseComponentDeclaration();

      case TokenType.TABLE:
        return this.parseTableNode();

      case TokenType.DIALOG:
        return this.parseDialogNode();

      case TokenType.TABS:
        return this.parseTabsNode();

      case TokenType.MENU:
        return this.parseMenuNode();

      case TokenType.SIDEBAR:
        return this.parseSidebarNode();

      case TokenType.AVATAR:
        return this.parseAvatarNode();

      case TokenType.BADGE:
        return this.parseBadgeNode();

      case TokenType.PROGRESS:
        return this.parseProgressNode();

      case TokenType.ICON:
        return this.parseIconNode();

      case TokenType.VIDEO:
        return this.parseVideoNode();

      case TokenType.AUDIO:
        return this.parseAudioNode();

      case TokenType.CSS:
        return this.parseEscapeHatch('css');

      case TokenType.JS:
        return this.parseEscapeHatch('js');

      case TokenType.RUST:
        return this.parseEscapeHatch('rust');

      case TokenType.PROGRAM:
        return this.parseProgramDeclaration();

      case TokenType.ACCOUNT:
        return this.parseAccountDeclaration();

      case TokenType.INSTRUCTION:
        return this.parseInstructionDeclaration();

      case TokenType.REQUIRE:
        return this.parseRequireNode();

      case TokenType.ANIMATE:
        return this.parseAnimateNode();

      default: {
        if (token.type === TokenType.IDENTIFIER && /^[A-Z]/.test(token.value)) {
          return this.parseComponentCall();
        }
        const lineText = this.getSourceLine(token.line);
        throw new ManifestError({
          message: `I didn't recognize this instruction: '${token.value}'`,
          line: token.line,
          column: token.column,
          sourceLine: lineText,
          expected: 'a valid command like SET, SHOW, IF, WHEN, ACTION, REPEAT, or CALL',
          found: `'${token.value}'`,
          example: 'SHOW "Hello World"',
          hint: 'Manifest instructions usually start with a capitalized action word.',
          phase: 'parser',
        });
      }
    }
  }

  private parseAppDeclaration(): AppDeclarationNode {
    const appToken = this.advance(); // consume APP

    if (this.peek().type !== TokenType.STRING) {
      const token = this.peek();
      throw new ManifestError({
        message: 'The APP declaration needs a program name in quotes.',
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: 'a text string for the application name',
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: 'APP "My Awesome Program"',
        phase: 'parser',
      });
    }

    const nameToken = this.advance();
    this.consumeStatementEnd();

    return {
      type: 'AppDeclaration',
      name: nameToken.value,
      line: appToken.line,
      column: appToken.column,
    };
  }

  private parseUseDeclaration(): UseDeclarationNode | LibraryDeclarationNode {
    const useToken = this.advance(); // consume USE

    // Support: USE LIBRARY "framer-motion"
    if (this.peek().type === TokenType.LIBRARY) {
      this.advance(); // consume LIBRARY
      let libName = 'library';
      if (this.peek().type === TokenType.STRING) {
        libName = this.advance().value;
      } else if (this.peek().type === TokenType.IDENTIFIER) {
        libName = this.advance().value;
      }
      this.consumeStatementEnd();
      return {
        type: 'LibraryDeclaration',
        libraryName: libName,
        line: useToken.line,
        column: useToken.column,
      };
    }

    // Support: USE PROGRAM "token"
    if (this.peek().type === TokenType.PROGRAM) {
      this.advance(); // consume PROGRAM
      let progName = 'token';
      if (this.peek().type === TokenType.STRING) {
        progName = this.advance().value;
      } else if (this.peek().type === TokenType.IDENTIFIER) {
        progName = this.advance().value;
      }
      this.consumeStatementEnd();
      return {
        type: 'UseDeclaration',
        capability: `SOLANA_PROGRAM:${progName.toUpperCase()}`,
        line: useToken.line,
        column: useToken.column,
      };
    }

    if (this.peek().type !== TokenType.IDENTIFIER && this.peek().type !== TokenType.STRING) {
      const token = this.peek();
      throw new ManifestError({
        message: 'The USE statement needs a capability, library, or module name.',
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: 'a capability name (like WEB, DATABASE, or USE LIBRARY "framer-motion")',
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: 'USE LIBRARY "framer-motion"',
        phase: 'parser',
      });
    }

    const capToken = this.advance();
    this.consumeStatementEnd();

    return {
      type: 'UseDeclaration',
      capability: capToken.value.toUpperCase(),
      line: useToken.line,
      column: useToken.column,
    };
  }

  private parseSetStatement(): SetStatementNode {
    const setToken = this.advance(); // consume SET

    if (this.peek().type !== TokenType.IDENTIFIER) {
      const token = this.peek();
      throw new ManifestError({
        message: 'I expected a variable name after SET.',
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: 'a variable name',
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: 'SET balance TO 100',
        hint: 'Variable names start with a letter and contain no spaces.',
        phase: 'parser',
      });
    }

    const varToken = this.advance();

    if (
      this.peek().type !== TokenType.TO &&
      this.peek().type !== TokenType.ASSIGN &&
      this.peek().type !== TokenType.EQUALS
    ) {
      const token = this.peek();
      throw new ManifestError({
        message: `I expected 'TO' or '=' after the variable name '${varToken.value}'.`,
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: "'TO' or '='",
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: `SET ${varToken.value} = 100`,
        phase: 'parser',
      });
    }

    this.advance(); // consume TO or =

    if (this.peek().type === TokenType.NEWLINE || this.peek().type === TokenType.EOF) {
      const token = this.peek();
      throw new ManifestError({
        message: `I expected a value after 'SET ${varToken.value} TO'.`,
        line: setToken.line,
        column: setToken.column,
        sourceLine: this.getSourceLine(setToken.line),
        expected: 'a value (like a number, text, or calculation)',
        found: 'nothing before the line ended',
        example: `SET ${varToken.value} TO 100`,
        phase: 'parser',
      });
    }

    const valueExpr = this.parseExpression();
    this.consumeStatementEnd();

    return {
      type: 'SetStatement',
      variable: varToken.value,
      value: valueExpr,
      line: setToken.line,
      column: setToken.column,
    };
  }

  private parseShowStatement(): ShowStatementNode {
    const showToken = this.advance(); // consume SHOW

    if (this.peek().type === TokenType.NEWLINE || this.peek().type === TokenType.EOF) {
      throw new ManifestError({
        message: 'I expected something to display after SHOW.',
        line: showToken.line,
        column: showToken.column,
        sourceLine: this.getSourceLine(showToken.line),
        expected: 'text, a number, or a variable name',
        found: 'nothing',
        example: 'SHOW "Hello World"',
        phase: 'parser',
      });
    }

    const expr = this.parseExpression();
    this.consumeStatementEnd();

    return {
      type: 'ShowStatement',
      expression: expr,
      line: showToken.line,
      column: showToken.column,
    };
  }

  private parseIfStatement(): IfStatementNode {
    const ifToken = this.advance(); // consume IF
    const condition = this.parseExpression();
    this.consumeStatementEnd();

    const consequent: StatementNode[] = [];
    const elseIfBranches: ElseIfBranch[] = [];
    let alternate: StatementNode[] | undefined;

    while (!this.isAtEnd() && this.peek().type !== TokenType.END && this.peek().type !== TokenType.ELSE) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END || this.peek().type === TokenType.ELSE) break;
      const stmt = this.parseStatement();
      if (stmt) consequent.push(stmt);
      this.skipNewlines();
    }

    // Check for ELSE / ELSE IF
    while (this.peek().type === TokenType.ELSE) {
      const elseToken = this.advance(); // consume ELSE

      if (this.peek().type === TokenType.IF) {
        // ELSE IF
        const elseIfToken = this.advance(); // consume IF
        const elseIfCondition = this.parseExpression();
        this.consumeStatementEnd();

        const branchBody: StatementNode[] = [];
        while (!this.isAtEnd() && this.peek().type !== TokenType.END && this.peek().type !== TokenType.ELSE) {
          this.skipNewlines();
          if (this.peek().type === TokenType.END || this.peek().type === TokenType.ELSE) break;
          const stmt = this.parseStatement();
          if (stmt) branchBody.push(stmt);
          this.skipNewlines();
        }

        elseIfBranches.push({
          condition: elseIfCondition,
          body: branchBody,
          line: elseIfToken.line,
        });
      } else {
        // Plain ELSE
        this.consumeStatementEnd();
        alternate = [];
        while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
          this.skipNewlines();
          if (this.peek().type === TokenType.END) break;
          const stmt = this.parseStatement();
          if (stmt) alternate.push(stmt);
          this.skipNewlines();
        }
        break;
      }
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This IF block was never closed with END.',
        line: ifToken.line,
        column: ifToken.column,
        sourceLine: this.getSourceLine(ifToken.line),
        expected: "'END' at the end of the IF block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: 'IF balance >= 10\n    SHOW "You can pay"\nELSE\n    SHOW "Insufficient"\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'IfStatement',
      condition,
      consequent,
      elseIfBranches: elseIfBranches.length > 0 ? elseIfBranches : undefined,
      alternate,
      line: ifToken.line,
      column: ifToken.column,
    };
  }

  private parseWhenStatement(): WhenStatementNode {
    const whenToken = this.advance(); // consume WHEN

    // Parse event identifier: e.g. app.starts, CLICK, SUBMIT, CHANGE, button.clicks, etc.
    let eventName = '';
    const first = this.peek();
    if (
      first.type === TokenType.IDENTIFIER ||
      first.type === TokenType.APP ||
      first.type === TokenType.CLICK ||
      first.type === TokenType.SUBMIT ||
      first.type === TokenType.CHANGE ||
      first.type === TokenType.BUTTON
    ) {
      eventName += this.advance().value.toLowerCase();
      if (this.peek().type === TokenType.DOT) {
        this.advance(); // consume .
        if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
          eventName += '.' + this.advance().value.toLowerCase();
        } else {
          throw new ManifestError({
            message: 'I expected an event name after the dot.',
            line: whenToken.line,
            column: this.peek().column,
            sourceLine: this.getSourceLine(whenToken.line),
            expected: "an event like 'starts' (e.g. app.starts)",
            found: `'${this.peek().value}'`,
            example: 'WHEN app.starts\n    SHOW "Hello"\nEND',
            phase: 'parser',
          });
        }
      }
    } else {
      throw new ManifestError({
        message: 'I expected an event name after WHEN.',
        line: whenToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(whenToken.line),
        expected: "an event name like 'CLICK', 'SUBMIT', or 'app.starts'",
        found: `'${this.peek().value}'`,
        example: 'WHEN CLICK\n    SET count TO count + 1\nEND',
        phase: 'parser',
      });
    }

    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: `This WHEN ${eventName} block was never closed with END.`,
        line: whenToken.line,
        column: whenToken.column,
        sourceLine: this.getSourceLine(whenToken.line),
        expected: "'END' at the end of the WHEN block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: `WHEN ${eventName}\n    SHOW "Hello"\nEND`,
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'WhenStatement',
      eventName,
      body,
      line: whenToken.line,
      column: whenToken.column,
    };
  }

  private parseRepeatStatement(): RepeatStatementNode {
    const repeatToken = this.advance(); // consume REPEAT
    const countExpr = this.parseExpression();

    if (this.peek().type !== TokenType.TIMES) {
      throw new ManifestError({
        message: "I expected 'TIMES' after the repeat count.",
        line: repeatToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(repeatToken.line),
        expected: "'TIMES'",
        found: `'${this.peek().value}'`,
        example: 'REPEAT 5 TIMES\n    SHOW "Hello"\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume TIMES
    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This REPEAT block was never closed with END.',
        line: repeatToken.line,
        column: repeatToken.column,
        sourceLine: this.getSourceLine(repeatToken.line),
        expected: "'END' at the end of the REPEAT block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: 'REPEAT 5 TIMES\n    SHOW "Hello"\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'RepeatStatement',
      count: countExpr,
      body,
      line: repeatToken.line,
      column: repeatToken.column,
    };
  }

  private parseForEachStatement(): ForEachStatementNode {
    const forToken = this.advance(); // consume FOR

    if (this.peek().type !== TokenType.EACH) {
      throw new ManifestError({
        message: "I expected 'EACH' after 'FOR'.",
        line: forToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(forToken.line),
        expected: "'EACH'",
        found: `'${this.peek().value}'`,
        example: 'FOR EACH item IN items\n    SHOW item\nEND',
        phase: 'parser',
      });
    }
    this.advance(); // consume EACH

    if (this.peek().type !== TokenType.IDENTIFIER) {
      throw new ManifestError({
        message: 'I expected an item variable name after FOR EACH.',
        line: forToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(forToken.line),
        expected: 'a variable name to hold each item',
        found: `'${this.peek().value}'`,
        example: 'FOR EACH name IN names\n    SHOW name\nEND',
        phase: 'parser',
      });
    }

    const itemVar = this.advance().value;

    if (this.peek().type !== TokenType.IN) {
      throw new ManifestError({
        message: `I expected 'IN' after '${itemVar}'.`,
        line: forToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(forToken.line),
        expected: "'IN'",
        found: `'${this.peek().value}'`,
        example: `FOR EACH ${itemVar} IN list\n    SHOW ${itemVar}\nEND`,
        phase: 'parser',
      });
    }
    this.advance(); // consume IN

    const collectionExpr = this.parseExpression();
    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This FOR EACH block was never closed with END.',
        line: forToken.line,
        column: forToken.column,
        sourceLine: this.getSourceLine(forToken.line),
        expected: "'END' at the end of the FOR EACH block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: `FOR EACH ${itemVar} IN list\n    SHOW ${itemVar}\nEND`,
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'ForEachStatement',
      itemVar,
      collection: collectionExpr,
      body,
      line: forToken.line,
      column: forToken.column,
    };
  }

  private parseActionDeclaration(): ActionDeclarationNode {
    const actionToken = this.advance(); // consume ACTION

    if (this.peek().type !== TokenType.IDENTIFIER) {
      throw new ManifestError({
        message: 'I expected a name for the action after ACTION.',
        line: actionToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(actionToken.line),
        expected: 'an action name',
        found: `'${this.peek().value}'`,
        example: 'ACTION greet user\n    SHOW "Hello " + user\nEND',
        phase: 'parser',
      });
    }

    const actionName = this.advance().value;
    const params: string[] = [];

    // Any identifiers on the same line before newline are parameters
    while (
      !this.isAtEnd() &&
      this.peek().type !== TokenType.NEWLINE &&
      this.peek().type !== TokenType.EOF
    ) {
      if (this.peek().type === TokenType.IDENTIFIER) {
        params.push(this.advance().value);
      } else if (this.peek().type === TokenType.COMMA) {
        this.advance(); // allow optional commas between params
      } else {
        throw new ManifestError({
          message: `Unexpected parameter name '${this.peek().value}' in ACTION declaration.`,
          line: actionToken.line,
          column: this.peek().column,
          sourceLine: this.getSourceLine(actionToken.line),
          expected: 'a parameter variable name',
          found: `'${this.peek().value}'`,
          example: `ACTION ${actionName} param1 param2\n    ...\nEND`,
          phase: 'parser',
        });
      }
    }

    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: `This ACTION ${actionName} was never closed with END.`,
        line: actionToken.line,
        column: actionToken.column,
        sourceLine: this.getSourceLine(actionToken.line),
        expected: "'END' at the end of the ACTION block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: `ACTION ${actionName} ${params.join(' ')}\n    ...\nEND`,
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'ActionDeclaration',
      name: actionName,
      params,
      body,
      line: actionToken.line,
      column: actionToken.column,
    };
  }

  private parseCallStatement(): CallStatementNode | CpiCallNode {
    const callToken = this.advance(); // consume CALL

    if (this.peek().type !== TokenType.IDENTIFIER) {
      throw new ManifestError({
        message: 'I expected an action name after CALL.',
        line: callToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(callToken.line),
        expected: 'an action name',
        found: `'${this.peek().value}'`,
        example: 'CALL greet "Christian"',
        phase: 'parser',
      });
    }

    const actionName = this.advance().value;

    // Check for CPI call: CALL token.transfer
    if (this.peek().type === TokenType.DOT) {
      this.advance(); // consume .
      const methodName = this.advance().value;
      return this.parseCpiCall(actionName, methodName, callToken);
    }
    const args: ExpressionNode[] = [];

    // Check if arguments are in parentheses: CALL greet("Christian")
    if (this.peek().type === TokenType.LPAREN) {
      this.advance(); // consume (
      while (!this.isAtEnd() && this.peek().type !== TokenType.RPAREN) {
        args.push(this.parseExpression());
        if (this.peek().type === TokenType.COMMA) {
          this.advance();
        }
      }
      if (this.peek().type !== TokenType.RPAREN) {
        throw new ManifestError({
          message: "Missing closing ')' in action call.",
          line: callToken.line,
          column: this.peek().column,
          sourceLine: this.getSourceLine(callToken.line),
          expected: "')'",
          found: `'${this.peek().value}'`,
          example: `CALL ${actionName}("Christian")`,
          phase: 'parser',
        });
      }
      this.advance(); // consume )
    } else {
      // Space-separated arguments until newline/EOF
      while (
        !this.isAtEnd() &&
        this.peek().type !== TokenType.NEWLINE &&
        this.peek().type !== TokenType.EOF
      ) {
        if (this.peek().type === TokenType.COMMA) {
          this.advance();
          continue;
        }
        args.push(this.parsePrimary());
      }
    }

    this.consumeStatementEnd();

    return {
      type: 'CallStatement',
      actionName,
      args,
      line: callToken.line,
      column: callToken.column,
    };
  }

  private parseReturnStatement(): ReturnStatementNode {
    const returnToken = this.advance(); // consume RETURN

    let value: ExpressionNode | undefined;
    if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      value = this.parseExpression();
    }

    this.consumeStatementEnd();

    return {
      type: 'ReturnStatement',
      value,
      line: returnToken.line,
      column: returnToken.column,
    };
  }

  private parseTryStatement(): TryStatementNode {
    const tryToken = this.advance(); // consume TRY
    this.consumeStatementEnd();

    const tryBlock: StatementNode[] = [];
    const catchBlock: StatementNode[] = [];

    while (
      !this.isAtEnd() &&
      this.peek().type !== TokenType.IF &&
      this.peek().type !== TokenType.END
    ) {
      this.skipNewlines();
      if (this.peek().type === TokenType.IF || this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) tryBlock.push(stmt);
      this.skipNewlines();
    }

    // Check for 'IF FAILED'
    if (this.peek().type === TokenType.IF && this.peekNext().type === TokenType.FAILED) {
      this.advance(); // consume IF
      this.advance(); // consume FAILED
      this.consumeStatementEnd();

      while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
        this.skipNewlines();
        if (this.peek().type === TokenType.END) break;
        const stmt = this.parseStatement();
        if (stmt) catchBlock.push(stmt);
        this.skipNewlines();
      }
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This TRY block was never closed with END.',
        line: tryToken.line,
        column: tryToken.column,
        sourceLine: this.getSourceLine(tryToken.line),
        expected: "'END' at the end of the TRY block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: 'TRY\n    SHOW 10 / 0\nIF FAILED\n    SHOW "Error caught"\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'TryStatement',
      tryBlock,
      catchBlock,
      line: tryToken.line,
      column: tryToken.column,
    };
  }

  // ----------------------------------------------------
  // Manifest v0.2 Application Primitive Parsers
  // ----------------------------------------------------

  private parseStateDeclaration(): StateDeclarationNode {
    const stateToken = this.advance(); // consume STATE

    if (this.peek().type !== TokenType.IDENTIFIER) {
      const token = this.peek();
      throw new ManifestError({
        message: 'I expected a state variable name after STATE.',
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: 'a variable name (like count, user, or items)',
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: 'STATE count TO 0',
        phase: 'parser',
      });
    }

    const varToken = this.advance();
    let dataType: string | undefined;

    // Optional type annotation: STATE count: NUMBER = 0
    if (this.peek().type === TokenType.COLON) {
      this.advance(); // consume :
      if (
        this.peek().type === TokenType.IDENTIFIER ||
        this.peek().type === TokenType.NUMBER ||
        this.peek().type === TokenType.TEXT ||
        this.peek().type === TokenType.BOOLEAN ||
        this.peek().type === TokenType.LIST
      ) {
        dataType = this.advance().value;
      }
    }

    if (
      this.peek().type !== TokenType.TO &&
      this.peek().type !== TokenType.EQUALS &&
      this.peek().type !== TokenType.ASSIGN
    ) {
      const token = this.peek();
      throw new ManifestError({
        message: `I expected TO or = after '${varToken.value}'.`,
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: "the word 'TO' or '='",
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: `STATE ${varToken.value}: NUMBER = 0`,
        phase: 'parser',
      });
    }

    this.advance(); // consume TO or = or ==

    const value = this.parseExpression();
    this.consumeStatementEnd();

    return {
      type: 'StateDeclaration',
      variable: varToken.value,
      dataType,
      value,
      line: stateToken.line,
      column: stateToken.column,
    };
  }

  private parsePageDeclaration(): PageDeclarationNode {
    const pageToken = this.advance(); // consume PAGE

    if (this.peek().type !== TokenType.IDENTIFIER) {
      const token = this.peek();
      throw new ManifestError({
        message: 'I expected a page name after PAGE.',
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: 'a page name (like Home, Settings, or Dashboard)',
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: 'PAGE Home\n    TEXT "Welcome"\nEND',
        phase: 'parser',
      });
    }

    const nameToken = this.advance();
    let route: string | undefined;

    // Optional ROUTE "/path" on the same line
    if (this.peek().type === TokenType.ROUTE) {
      this.advance(); // consume ROUTE
      if (this.peek().type === TokenType.STRING) {
        route = this.advance().value;
      }
    }

    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: `This PAGE ${nameToken.value} block was never closed with END.`,
        line: pageToken.line,
        column: pageToken.column,
        sourceLine: this.getSourceLine(pageToken.line),
        expected: "'END' at the end of the PAGE block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: `PAGE ${nameToken.value}\n    TEXT "Hello"\nEND`,
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'PageDeclaration',
      name: nameToken.value,
      route,
      body,
      line: pageToken.line,
      column: pageToken.column,
    };
  }

  private parseTextNode(): TextNode {
    const textToken = this.advance(); // consume TEXT

    const expression = this.parseExpression();
    this.consumeStatementEnd();

    let styles: Record<string, string | number> | undefined;
    this.skipNewlines();
    if (!this.isAtEnd() && this.peek().type === TokenType.STYLE) {
      styles = this.parseStyleBlock();
      if (!this.isAtEnd() && this.peek().type === TokenType.END) {
        this.advance();
        this.consumeStatementEnd();
      }
    }

    return {
      type: 'Text',
      expression,
      styles,
      line: textToken.line,
      column: textToken.column,
    };
  }

  private parseButtonNode(): ButtonNode {
    const btnToken = this.advance(); // consume BUTTON

    const label = this.parseExpression();
    this.consumeStatementEnd();

    const eventHandlers: WhenStatementNode[] = [];
    let styles: Record<string, string | number> | undefined;

    // Check for optional STYLE block or WHEN CLICK blocks
    this.skipNewlines();
    while (!this.isAtEnd()) {
      if (this.peek().type === TokenType.STYLE) {
        styles = { ...(styles || {}), ...this.parseStyleBlock() };
        this.skipNewlines();
      } else if (this.peek().type === TokenType.WHEN) {
        const nextTok = this.peekNext();
        const isClickEvent =
          nextTok.type === TokenType.CLICK ||
          nextTok.value.toLowerCase() === 'click' ||
          nextTok.value.toLowerCase().startsWith('button.');
        if (!isClickEvent) {
          break;
        }
        const handler = this.parseWhenStatement();
        eventHandlers.push(handler);
        this.skipNewlines();
      } else {
        break;
      }
    }

    // Check if there is an explicit closing END for the BUTTON
    if (!this.isAtEnd() && this.peek().type === TokenType.END && (eventHandlers.length > 0 || styles)) {
      this.advance(); // consume closing END for BUTTON
      this.consumeStatementEnd();
    }

    return {
      type: 'Button',
      label,
      eventHandlers,
      styles,
      line: btnToken.line,
      column: btnToken.column,
    };
  }

  private parseInputNode(): InputNode {
    const inputToken = this.advance(); // consume INPUT

    let placeholder: ExpressionNode | undefined;
    let targetVariable: string | undefined;

    if (
      this.peek().type !== TokenType.NEWLINE &&
      this.peek().type !== TokenType.EOF
    ) {
      const expr = this.parseExpression();
      if (
        this.peek().type === TokenType.INTO ||
        this.peek().type === TokenType.BIND ||
        this.peek().type === TokenType.TO
      ) {
        this.advance(); // consume INTO / BIND / TO
        if (this.peek().type === TokenType.IDENTIFIER) {
          targetVariable = this.advance().value;
          placeholder = expr;
        } else {
          throw new ManifestError({
            message: 'I expected a variable name after INTO.',
            line: this.peek().line,
            column: this.peek().column,
            sourceLine: this.getSourceLine(this.peek().line),
            expected: 'a variable name to store user input',
            found: `'${this.peek().value}'`,
            example: 'INPUT "Enter your name" INTO username',
            phase: 'parser',
          });
        }
      } else {
        if (expr.type === 'VariableReference') {
          targetVariable = expr.name;
        } else {
          placeholder = expr;
        }
      }
    }

    this.consumeStatementEnd();

    return {
      type: 'Input',
      placeholder,
      targetVariable,
      line: inputToken.line,
      column: inputToken.column,
    };
  }

  private parseImageNode(): ImageNode {
    const imgToken = this.advance(); // consume IMAGE

    const src = this.parseExpression();
    let alt: ExpressionNode | undefined;

    if (this.peek().type === TokenType.ALT) {
      this.advance(); // consume ALT
      alt = this.parseExpression();
    }

    this.consumeStatementEnd();

    return {
      type: 'Image',
      src,
      alt,
      line: imgToken.line,
      column: imgToken.column,
    };
  }

  private parseFormNode(): FormNode {
    const formToken = this.advance(); // consume FORM

    let name: string | undefined;
    if (this.peek().type === TokenType.IDENTIFIER) {
      name = this.advance().value;
    }
    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    const eventHandlers: WhenStatementNode[] = [];

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) {
        if (stmt.type === 'WhenStatement') {
          eventHandlers.push(stmt);
        } else {
          body.push(stmt);
        }
      }
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This FORM block was never closed with END.',
        line: formToken.line,
        column: formToken.column,
        sourceLine: this.getSourceLine(formToken.line),
        expected: "'END' at the end of the FORM block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: 'FORM Contact\n    INPUT "Name" INTO name\n    BUTTON "Send"\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'Form',
      name,
      body,
      eventHandlers,
      line: formToken.line,
      column: formToken.column,
    };
  }

  private parseRouteDeclaration(): RouteDeclarationNode {
    const routeToken = this.advance(); // consume ROUTE

    if (this.peek().type !== TokenType.STRING) {
      const token = this.peek();
      throw new ManifestError({
        message: 'I expected a route path string in quotes after ROUTE.',
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: 'a URL path string (like "/" or "/about")',
        found: token.type === TokenType.EOF ? 'nothing' : `'${token.value}'`,
        example: 'ROUTE "/" TO Home',
        phase: 'parser',
      });
    }

    const pathToken = this.advance();
    let targetPage = 'Home';

    if (this.peek().type === TokenType.TO) {
      this.advance(); // consume TO
      if (this.peek().type === TokenType.IDENTIFIER) {
        targetPage = this.advance().value;
      }
    }

    this.consumeStatementEnd();

    return {
      type: 'RouteDeclaration',
      path: pathToken.value,
      targetPage,
      line: routeToken.line,
      column: routeToken.column,
    };
  }

  // ----------------------------------------------------
  // Manifest v0.3 UI Primitives, Layout & Design System
  // ----------------------------------------------------

  private parseStyleBlock(): Record<string, string | number> {
    const styleToken = this.advance(); // consume STYLE
    this.consumeStatementEnd();

    const styles: Record<string, string | number> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;

      const propToken = this.advance();
      const rawProp = propToken.value.toUpperCase();

      // Support responsive blocks: MOBILE / TABLET / DESKTOP
      if (
        propToken.type === TokenType.MOBILE ||
        propToken.type === TokenType.TABLET ||
        propToken.type === TokenType.DESKTOP
      ) {
        this.consumeStatementEnd();
        const responsiveStyles: Record<string, string | number> = {};
        while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
          this.skipNewlines();
          if (this.peek().type === TokenType.END) break;
          const subProp = this.advance().value.toUpperCase();
          const subVals: string[] = [];
          while (!this.isAtEnd() && this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
            if (this.peek().type === TokenType.COLON) { this.advance(); continue; }
            subVals.push(this.advance().value);
          }
          this.consumeStatementEnd();
          const cssProp = this.mapStylePropName(subProp);
          responsiveStyles[cssProp] = this.formatStyleValue(subProp, subVals);
          this.skipNewlines();
        }
        if (this.peek().type === TokenType.END) {
          this.advance();
          this.consumeStatementEnd();
        }
        styles[`@${rawProp.toLowerCase()}`] = JSON.stringify(responsiveStyles);
        continue;
      }

      const vals: string[] = [];
      while (
        !this.isAtEnd() &&
        this.peek().type !== TokenType.NEWLINE &&
        this.peek().type !== TokenType.EOF
      ) {
        if (this.peek().type === TokenType.COLON) {
          this.advance();
          continue;
        }
        vals.push(this.advance().value);
      }
      this.consumeStatementEnd();

      const cssProp = this.mapStylePropName(rawProp);
      styles[cssProp] = this.formatStyleValue(rawProp, vals);
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance(); // consume END
      this.consumeStatementEnd();
    }

    return styles;
  }

  private mapStylePropName(rawProp: string): string {
    const key = rawProp.toUpperCase();
    const map: Record<string, string> = {
      WIDTH: 'width',
      HEIGHT: 'height',
      MIN_WIDTH: 'minWidth',
      MAX_WIDTH: 'maxWidth',
      MIN_HEIGHT: 'minHeight',
      MAX_HEIGHT: 'maxHeight',
      BACKGROUND: 'background',
      BG: 'background',
      COLOR: 'color',
      TEXT_COLOR: 'color',
      FONT_SIZE: 'fontSize',
      FONT_WEIGHT: 'fontWeight',
      FONT_FAMILY: 'fontFamily',
      LINE_HEIGHT: 'lineHeight',
      PADDING: 'padding',
      MARGIN: 'margin',
      GAP: 'gap',
      BORDER: 'border',
      BORDER_WIDTH: 'borderWidth',
      BORDER_COLOR: 'borderColor',
      RADIUS: 'borderRadius',
      BORDER_RADIUS: 'borderRadius',
      OPACITY: 'opacity',
      SHADOW: 'boxShadow',
      BOX_SHADOW: 'boxShadow',
      ALIGN: 'alignItems',
      ALIGN_ITEMS: 'alignItems',
      JUSTIFY: 'justifyContent',
      JUSTIFY_CONTENT: 'justifyContent',
      DISPLAY: 'display',
      LAYOUT: 'display',
      DIRECTION: 'flexDirection',
      FLEX_DIRECTION: 'flexDirection',
      OVERFLOW: 'overflow',
      CURSOR: 'cursor',
      LETTER_SPACING: 'letterSpacing',
      POSITION: 'position',
      Z_INDEX: 'zIndex',
      FLEX: 'flex',
      GRID: 'display',
      ROW: 'flexDirection',
      COLUMN: 'flexDirection',
    };
    if (map[key]) return map[key];
    return rawProp.toLowerCase().replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  }

  private formatStyleValue(prop: string, vals: string[]): string | number {
    if (vals.length === 0) return '';
    const key = prop.toUpperCase();

    if (key === 'LAYOUT' || key === 'DISPLAY') {
      return vals[0].toLowerCase();
    }
    if (key === 'DIRECTION' || key === 'FLEX_DIRECTION') {
      return vals[0].toLowerCase();
    }
    if (key === 'ALIGN' || key === 'ALIGN_ITEMS') {
      const v = vals[0].toUpperCase();
      if (v === 'CENTER') return 'center';
      if (v === 'START') return 'flex-start';
      if (v === 'END') return 'flex-end';
      if (v === 'STRETCH') return 'stretch';
      return v.toLowerCase();
    }
    if (key === 'JUSTIFY' || key === 'JUSTIFY_CONTENT') {
      const v = vals[0].toUpperCase();
      if (v === 'CENTER') return 'center';
      if (v === 'BETWEEN' || v === 'SPACE_BETWEEN') return 'space-between';
      if (v === 'AROUND' || v === 'SPACE_AROUND') return 'space-around';
      if (v === 'EVENLY' || v === 'SPACE_EVENLY') return 'space-evenly';
      if (v === 'START') return 'flex-start';
      if (v === 'END') return 'flex-end';
      return v.toLowerCase();
    }

    if (vals.length === 1) {
      const single = vals[0];
      if (single.startsWith('"') || single.startsWith("'")) {
        return single.slice(1, -1);
      }
      if (/^\d+(\.\d+)?$/.test(single)) {
        if (key === 'FONT_WEIGHT' || key === 'OPACITY' || key === 'LINE_HEIGHT' || key === 'Z_INDEX') {
          return Number(single);
        }
        return `${single}px`;
      }
      return single;
    }

    return vals
      .map((v) => {
        if (v.startsWith('"') || v.startsWith("'")) return v.slice(1, -1);
        if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`;
        return v;
      })
      .join(' ');
  }

  private parseContainerNode(): ContainerNode {
    const containerToken = this.advance(); // consume CONTAINER
    let layout: string | undefined;
    let direction: string | undefined;
    let styles: Record<string, string | number> = {};
    this.consumeStatementEnd();

    const children: StatementNode[] = [];

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;

      if (this.peek().type === TokenType.STYLE) {
        const parsed = this.parseStyleBlock();
        styles = { ...styles, ...parsed };
      } else if (this.peek().type === TokenType.LAYOUT) {
        this.advance(); // consume LAYOUT
        layout = this.advance().value.toLowerCase();
        styles.display = layout;
        this.consumeStatementEnd();
      } else if (this.peek().type === TokenType.DIRECTION) {
        this.advance(); // consume DIRECTION
        direction = this.advance().value.toLowerCase();
        styles.flexDirection = direction;
        this.consumeStatementEnd();
      } else if (
        this.peek().type === TokenType.IDENTIFIER &&
        ['GAP', 'ALIGN', 'JUSTIFY', 'PADDING', 'MARGIN', 'WIDTH', 'HEIGHT', 'BACKGROUND', 'COLOR'].includes(
          this.peek().value.toUpperCase()
        )
      ) {
        const propToken = this.advance();
        const rawProp = propToken.value.toUpperCase();
        const vals: string[] = [];
        while (!this.isAtEnd() && this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
          if (this.peek().type === TokenType.COLON) {
            this.advance();
            continue;
          }
          vals.push(this.advance().value);
        }
        this.consumeStatementEnd();
        const cssProp = this.mapStylePropName(rawProp);
        styles[cssProp] = this.formatStyleValue(rawProp, vals);
      } else {
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
      }
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This CONTAINER block was never closed with END.',
        line: containerToken.line,
        column: containerToken.column,
        sourceLine: this.getSourceLine(containerToken.line),
        expected: "'END' at the end of the CONTAINER block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: 'CONTAINER\n    TEXT "Hello"\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'Container',
      layout,
      direction,
      styles: Object.keys(styles).length > 0 ? styles : undefined,
      children,
      line: containerToken.line,
      column: containerToken.column,
    };
  }

  private parseCardNode(): CardNode {
    const cardToken = this.advance(); // consume CARD
    let styles: Record<string, string | number> = {};
    this.consumeStatementEnd();

    const children: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;

      if (this.peek().type === TokenType.STYLE) {
        styles = { ...styles, ...this.parseStyleBlock() };
      } else {
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
      }
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This CARD block was never closed with END.',
        line: cardToken.line,
        column: cardToken.column,
        sourceLine: this.getSourceLine(cardToken.line),
        expected: "'END' at the end of the CARD block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: 'CARD\n    TEXT "Card Title"\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'Card',
      styles: Object.keys(styles).length > 0 ? styles : undefined,
      children,
      line: cardToken.line,
      column: cardToken.column,
    };
  }

  private parseListNode(): ListNode {
    const listToken = this.advance(); // consume LIST
    let collection: ExpressionNode | undefined;
    let itemVar: string | undefined;

    if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      collection = this.parseExpression();
      if (
        this.peek().type === TokenType.AS ||
        (this.peek().type === TokenType.IDENTIFIER && this.peek().value.toUpperCase() === 'AS')
      ) {
        this.advance(); // consume AS
        if (this.peek().type === TokenType.IDENTIFIER) {
          itemVar = this.advance().value;
        }
      }
    }
    this.consumeStatementEnd();

    const children: StatementNode[] = [];
    let styles: Record<string, string | number> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      if (this.peek().type === TokenType.STYLE) {
        styles = { ...styles, ...this.parseStyleBlock() };
      } else {
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
      }
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: 'This LIST block was never closed with END.',
        line: listToken.line,
        column: listToken.column,
        sourceLine: this.getSourceLine(listToken.line),
        expected: "'END' at the end of the LIST block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: 'LIST items AS item\n    TEXT item\nEND',
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'List',
      collection,
      itemVar,
      styles: Object.keys(styles).length > 0 ? styles : undefined,
      children,
      line: listToken.line,
      column: listToken.column,
    };
  }

  private parseLinkNode(): LinkNode {
    const linkToken = this.advance(); // consume LINK
    const label = this.parseExpression();
    let target: ExpressionNode = { type: 'Literal', value: '#', raw: '"#"', line: linkToken.line };

    if (this.peek().type === TokenType.TO) {
      this.advance(); // consume TO
      target = this.parseExpression();
    } else if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      target = this.parseExpression();
    }
    this.consumeStatementEnd();

    let styles: Record<string, string | number> | undefined;
    this.skipNewlines();
    if (!this.isAtEnd() && this.peek().type === TokenType.STYLE) {
      styles = this.parseStyleBlock();
      if (!this.isAtEnd() && this.peek().type === TokenType.END) {
        this.advance();
        this.consumeStatementEnd();
      }
    }

    return {
      type: 'Link',
      label,
      target,
      styles,
      line: linkToken.line,
      column: linkToken.column,
    };
  }

  private parseSelectNode(): SelectNode {
    const selToken = this.advance(); // consume SELECT
    let bindVariable: string | undefined;

    if (
      this.peek().type === TokenType.INTO ||
      this.peek().type === TokenType.BIND ||
      this.peek().type === TokenType.TO
    ) {
      this.advance();
      if (this.peek().type === TokenType.IDENTIFIER) {
        bindVariable = this.advance().value;
      }
    } else if (this.peek().type === TokenType.IDENTIFIER) {
      bindVariable = this.advance().value;
    }
    this.consumeStatementEnd();

    let styles: Record<string, string | number> | undefined;
    const options: Array<{ label: string; value: string }> = [];

    this.skipNewlines();
    if (!this.isAtEnd() && (this.peek().type === TokenType.STYLE || this.peek().type === TokenType.IDENTIFIER)) {
      while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
        this.skipNewlines();
        if (this.peek().type === TokenType.END) break;
        if (this.peek().type === TokenType.STYLE) {
          styles = { ...(styles || {}), ...this.parseStyleBlock() };
        } else {
          const opt = this.advance().value;
          options.push({ label: opt, value: opt });
          this.consumeStatementEnd();
        }
        this.skipNewlines();
      }
      if (this.peek().type === TokenType.END) {
        this.advance();
        this.consumeStatementEnd();
      }
    }

    return {
      type: 'Select',
      bindVariable,
      options: options.length > 0 ? options : undefined,
      styles,
      line: selToken.line,
      column: selToken.column,
    };
  }

  private parseCheckboxNode(): CheckboxNode {
    const cbToken = this.advance(); // consume CHECKBOX
    let label: ExpressionNode | undefined;
    let bindVariable: string | undefined;

    if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      label = this.parseExpression();
      if (
        this.peek().type === TokenType.INTO ||
        this.peek().type === TokenType.BIND ||
        this.peek().type === TokenType.TO
      ) {
        this.advance();
        if (this.peek().type === TokenType.IDENTIFIER) {
          bindVariable = this.advance().value;
        }
      }
    }
    this.consumeStatementEnd();

    return {
      type: 'Checkbox',
      label,
      bindVariable,
      line: cbToken.line,
      column: cbToken.column,
    };
  }

  private parseTextareaNode(): TextareaNode {
    const taToken = this.advance(); // consume TEXTAREA
    let placeholder: ExpressionNode | undefined;
    let bindVariable: string | undefined;

    if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      placeholder = this.parseExpression();
      if (
        this.peek().type === TokenType.INTO ||
        this.peek().type === TokenType.BIND ||
        this.peek().type === TokenType.TO
      ) {
        this.advance();
        if (this.peek().type === TokenType.IDENTIFIER) {
          bindVariable = this.advance().value;
        }
      }
    }
    this.consumeStatementEnd();

    return {
      type: 'Textarea',
      placeholder,
      bindVariable,
      line: taToken.line,
      column: taToken.column,
    };
  }

  private parseHeaderNode(): HeaderNode {
    return this.parseSemanticContainer('Header') as HeaderNode;
  }

  private parseFooterNode(): FooterNode {
    return this.parseSemanticContainer('Footer') as FooterNode;
  }

  private parseNavNode(): NavNode {
    return this.parseSemanticContainer('Nav') as NavNode;
  }

  private parseModalNode(): ModalNode {
    return this.parseSemanticContainer('Modal') as ModalNode;
  }

  private parseSemanticContainer(type: 'Header' | 'Footer' | 'Nav' | 'Modal'): StatementNode {
    const token = this.advance();
    this.consumeStatementEnd();

    const children: StatementNode[] = [];
    let styles: Record<string, string | number> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      if (this.peek().type === TokenType.STYLE) {
        styles = { ...styles, ...this.parseStyleBlock() };
      } else {
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
      }
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: `This ${type.toUpperCase()} block was never closed with END.`,
        line: token.line,
        column: token.column,
        sourceLine: this.getSourceLine(token.line),
        expected: `'END' at the end of the ${type.toUpperCase()} block`,
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: `${type.toUpperCase()}\n    TEXT "Content"\nEND`,
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type,
      styles: Object.keys(styles).length > 0 ? styles : undefined,
      children,
      line: token.line,
      column: token.column,
    } as StatementNode;
  }

  private parseComponentDeclaration(): ComponentDeclarationNode {
    const compToken = this.advance(); // consume COMPONENT

    if (this.peek().type !== TokenType.IDENTIFIER) {
      throw new ManifestError({
        message: 'I expected a component name after COMPONENT.',
        line: compToken.line,
        column: this.peek().column,
        sourceLine: this.getSourceLine(compToken.line),
        expected: 'a capitalized component name (like Card, Header, or ItemRow)',
        found: `'${this.peek().value}'`,
        example: 'COMPONENT Card\n    INPUT title: TEXT\n    CONTAINER\n        TEXT title\n    END\nEND',
        phase: 'parser',
      });
    }

    const name = this.advance().value;
    const params: string[] = [];

    while (this.peek().type === TokenType.IDENTIFIER) {
      params.push(this.advance().value);
    }
    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;

      if (this.peek().type === TokenType.INPUT && this.peekNext().type === TokenType.IDENTIFIER) {
        this.advance(); // consume INPUT
        const paramName = this.advance().value;
        params.push(paramName);
        if (this.peek().type === TokenType.COLON) {
          this.advance(); // consume :
          if (this.peek().type === TokenType.IDENTIFIER || this.peek().type === TokenType.TEXT) {
            this.advance(); // consume type
          }
        }
        this.consumeStatementEnd();
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.END) {
      throw new ManifestError({
        message: `This COMPONENT ${name} block was never closed with END.`,
        line: compToken.line,
        column: compToken.column,
        sourceLine: this.getSourceLine(compToken.line),
        expected: "'END' at the end of the COMPONENT block",
        found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
        example: `COMPONENT ${name}\n    TEXT "Hello"\nEND`,
        phase: 'parser',
      });
    }

    this.advance(); // consume END
    this.consumeStatementEnd();

    return {
      type: 'ComponentDeclaration',
      name,
      params,
      body,
      line: compToken.line,
      column: compToken.column,
    };
  }

  private parseComponentCall(): ComponentCallNode {
    const nameToken = this.advance();
    const props: Record<string, ExpressionNode> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      if (this.peek().type === TokenType.IDENTIFIER && this.peekNext().type === TokenType.EQUALS) {
        const propKey = this.advance().value;
        this.advance(); // consume =
        props[propKey] = this.parseExpression();
      } else {
        const expr = this.parseExpression();
        props['default'] = expr;
      }
    }
    this.consumeStatementEnd();

    return {
      type: 'ComponentCall',
      name: nameToken.value,
      props,
      line: nameToken.line,
      column: nameToken.column,
    };
  }

  private parseCpiCall(programName: string, methodName: string, callToken: Token): CpiCallNode {
    this.consumeStatementEnd();
    const args: Record<string, ExpressionNode> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;

      if (this.peek().type === TokenType.IDENTIFIER || this.peek().type === TokenType.TO) {
        const paramKey = this.advance().value.toLowerCase();
        if (this.peek().type === TokenType.COLON || this.peek().type === TokenType.ASSIGN) {
          this.advance();
        }
        const valExpr = this.parseExpression();
        args[paramKey] = valExpr;
      } else {
        const expr = this.parseExpression();
        args['arg' + Object.keys(args).length] = expr;
      }
      this.consumeStatementEnd();
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance(); // consume END
      this.consumeStatementEnd();
    }

    return {
      type: 'CpiCall',
      programName,
      methodName,
      args,
      line: callToken.line,
      column: callToken.column,
    };
  }

  private parseProgramDeclaration(): ProgramDeclarationNode {
    const progToken = this.advance(); // consume PROGRAM
    const name = this.advance().value;
    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance(); // consume END
      this.consumeStatementEnd();
    }

    return {
      type: 'ProgramDeclaration',
      name,
      body,
      line: progToken.line,
      column: progToken.column,
    };
  }

  private parseAccountDeclaration(): AccountDeclarationNode {
    const accToken = this.advance(); // consume ACCOUNT
    const name = this.advance().value;
    this.consumeStatementEnd();

    const fields: AccountField[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;

      if (this.peek().type === TokenType.IDENTIFIER) {
        const fieldName = this.advance().value;
        let fieldType = 'u64';
        let isSigner = false;

        if (this.peek().type === TokenType.COLON) {
          this.advance(); // consume :
          if (
            this.peek().type === TokenType.IDENTIFIER ||
            this.peek().type === TokenType.NUMBER ||
            this.peek().type === TokenType.TEXT
          ) {
            fieldType = this.advance().value;
          }
        }
        if (this.peek().type === TokenType.SIGNER) {
          this.advance();
          isSigner = true;
        }

        fields.push({ name: fieldName, fieldType, isSigner });
      }
      this.consumeStatementEnd();
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance(); // consume END
      this.consumeStatementEnd();
    }

    return {
      type: 'AccountDeclaration',
      name,
      fields,
      line: accToken.line,
      column: accToken.column,
    };
  }

  private parseInstructionDeclaration(): InstructionDeclarationNode {
    const instToken = this.advance(); // consume INSTRUCTION
    const name = this.advance().value;
    this.consumeStatementEnd();

    const body: StatementNode[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance(); // consume END
      this.consumeStatementEnd();
    }

    return {
      type: 'InstructionDeclaration',
      name,
      body,
      line: instToken.line,
      column: instToken.column,
    };
  }

  private parseRequireNode(): RequireNode {
    const reqToken = this.advance(); // consume REQUIRE
    const condition = this.parseExpression();
    this.consumeStatementEnd();

    return {
      type: 'Require',
      condition,
      line: reqToken.line,
      column: reqToken.column,
    };
  }

  private parseEscapeHatch(type: 'css' | 'js' | 'rust'): StatementNode {
    const token = this.advance(); // consume CSS, JS, or RUST
    this.consumeStatementEnd();

    const contentLines: string[] = [];
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      if (this.peek().type === TokenType.NEWLINE) {
        contentLines.push('');
        this.advance();
        continue;
      }
      let lineStr = '';
      while (
        !this.isAtEnd() &&
        this.peek().type !== TokenType.NEWLINE &&
        this.peek().type !== TokenType.END
      ) {
        lineStr += this.advance().value + ' ';
      }
      contentLines.push(lineStr.trimEnd());
      if (this.peek().type === TokenType.NEWLINE) {
        this.advance();
      }
    }

    if (this.peek().type === TokenType.END) {
      this.advance(); // consume END
      this.consumeStatementEnd();
    }

    const content = contentLines.join('\n');
    if (type === 'css') {
      return { type: 'CssEscape', cssContent: content, line: token.line, column: token.column };
    }
    if (type === 'js') {
      return { type: 'JsEscape', jsContent: content, line: token.line, column: token.column };
    }
    return { type: 'RustEscape', rustContent: content, line: token.line, column: token.column };
  }

  private parseTableNode(): TableNode {
    const tok = this.advance(); // consume TABLE
    this.consumeStatementEnd();
    const children: StatementNode[] = [];
    let styles: Record<string, string | number> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      if (this.peek().type === TokenType.STYLE) {
        styles = { ...styles, ...this.parseStyleBlock() };
      } else {
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
      }
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance();
      this.consumeStatementEnd();
    }

    return { type: 'Table', styles, children, line: tok.line, column: tok.column };
  }

  private parseDialogNode(): DialogNode {
    const tok = this.advance(); // consume DIALOG
    let title: ExpressionNode | undefined;
    if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      title = this.parseExpression();
    }
    this.consumeStatementEnd();
    const children: StatementNode[] = [];
    let styles: Record<string, string | number> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      if (this.peek().type === TokenType.STYLE) {
        styles = { ...styles, ...this.parseStyleBlock() };
      } else {
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
      }
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance();
      this.consumeStatementEnd();
    }

    return { type: 'Dialog', title, styles, children, line: tok.line, column: tok.column };
  }

  private parseTabsNode(): TabsNode {
    const tok = this.advance(); // consume TABS
    this.consumeStatementEnd();
    const children: StatementNode[] = [];
    let styles: Record<string, string | number> = {};

    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;
      if (this.peek().type === TokenType.STYLE) {
        styles = { ...styles, ...this.parseStyleBlock() };
      } else {
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
      }
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance();
      this.consumeStatementEnd();
    }

    return { type: 'Tabs', styles, children, line: tok.line, column: tok.column };
  }

  private parseMenuNode(): MenuNode {
    return this.parseSemanticContainer('Menu' as any) as any;
  }

  private parseSidebarNode(): SidebarNode {
    return this.parseSemanticContainer('Sidebar' as any) as any;
  }

  private parseAvatarNode(): AvatarNode {
    const tok = this.advance(); // consume AVATAR
    let src: ExpressionNode | undefined;
    if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
      src = this.parseExpression();
    }
    this.consumeStatementEnd();
    return { type: 'Avatar', src, line: tok.line, column: tok.column };
  }

  private parseBadgeNode(): BadgeNode {
    const tok = this.advance(); // consume BADGE
    const text = this.parseExpression();
    this.consumeStatementEnd();
    return { type: 'Badge', text, line: tok.line, column: tok.column };
  }

  private parseProgressNode(): ProgressNode {
    const tok = this.advance(); // consume PROGRESS
    const value = this.parseExpression();
    this.consumeStatementEnd();
    return { type: 'Progress', value, line: tok.line, column: tok.column };
  }

  private parseIconNode(): IconNode {
    const tok = this.advance(); // consume ICON
    const name = this.parseExpression();
    let size = 18;
    if (this.peek().type === TokenType.NUMBER) {
      size = parseFloat(this.advance().value);
    }
    this.consumeStatementEnd();
    return { type: 'Icon', name, size, line: tok.line, column: tok.column };
  }

  private parseVideoNode(): VideoNode {
    const tok = this.advance(); // consume VIDEO
    const src = this.parseExpression();
    this.consumeStatementEnd();
    return { type: 'Video', src, controls: true, line: tok.line, column: tok.column };
  }

  private parseAudioNode(): AudioNode {
    const tok = this.advance(); // consume AUDIO
    const src = this.parseExpression();
    this.consumeStatementEnd();
    return { type: 'Audio', src, controls: true, line: tok.line, column: tok.column };
  }

  private parseAnimateNode(): AnimateNode {
    const tok = this.advance(); // consume ANIMATE
    this.consumeStatementEnd();
    const anim = this.parseAnimateBlock();
    return { type: 'Animate', ...anim, line: tok.line, column: tok.column };
  }

  private parseAnimateBlock(): Record<string, any> {
    const config: Record<string, any> = { initial: {}, to: {} };
    while (!this.isAtEnd() && this.peek().type !== TokenType.END) {
      this.skipNewlines();
      if (this.peek().type === TokenType.END) break;

      const prop = this.advance().value.toUpperCase();
      if (prop === 'DURATION' && this.peek().type === TokenType.NUMBER) {
        config.duration = parseFloat(this.advance().value);
      } else if (prop === 'EASE' && this.peek().type === TokenType.STRING) {
        config.ease = this.advance().value;
      } else if (prop === 'TO') {
        const subProp = this.advance().value.toLowerCase();
        let val: any = 1;
        if (this.peek().type === TokenType.NUMBER) {
          val = parseFloat(this.advance().value);
        } else if (this.peek().type === TokenType.STRING) {
          val = this.advance().value;
        }
        config.to[subProp] = val;
      } else if (prop === 'INITIAL') {
        const subProp = this.advance().value.toLowerCase();
        let val: any = 0;
        if (this.peek().type === TokenType.NUMBER) {
          val = parseFloat(this.advance().value);
        } else if (this.peek().type === TokenType.STRING) {
          val = this.advance().value;
        }
        config.initial[subProp] = val;
      }
      this.consumeStatementEnd();
      this.skipNewlines();
    }

    if (this.peek().type === TokenType.END) {
      this.advance(); // consume END
      this.consumeStatementEnd();
    }
    return config;
  }

  // ----------------------------------------------------
  // Expression Parsing (Precedence Climbing)
  // ----------------------------------------------------

  public parseExpression(): ExpressionNode {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): ExpressionNode {
    let expr = this.parseLogicalAnd();

    while (this.peek().type === TokenType.OR) {
      const opToken = this.advance();
      const right = this.parseLogicalAnd();
      expr = {
        type: 'BinaryExpression',
        operator: 'OR',
        left: expr,
        right,
        line: opToken.line,
        column: opToken.column,
      };
    }

    return expr;
  }

  private parseLogicalAnd(): ExpressionNode {
    let expr = this.parseEquality();

    while (this.peek().type === TokenType.AND) {
      const opToken = this.advance();
      const right = this.parseEquality();
      expr = {
        type: 'BinaryExpression',
        operator: 'AND',
        left: expr,
        right,
        line: opToken.line,
        column: opToken.column,
      };
    }

    return expr;
  }

  private parseEquality(): ExpressionNode {
    let expr = this.parseComparison();

    while (
      this.peek().type === TokenType.EQUALS ||
      this.peek().type === TokenType.NOT_EQUALS
    ) {
      const opToken = this.advance();
      const right = this.parseComparison();
      expr = {
        type: 'BinaryExpression',
        operator: opToken.value,
        left: expr,
        right,
        line: opToken.line,
        column: opToken.column,
      };
    }

    return expr;
  }

  private parseComparison(): ExpressionNode {
    let expr = this.parseAdditive();

    while (
      this.peek().type === TokenType.LESS_THAN ||
      this.peek().type === TokenType.GREATER_THAN ||
      this.peek().type === TokenType.LESS_OR_EQUAL ||
      this.peek().type === TokenType.GREATER_OR_EQUAL
    ) {
      const opToken = this.advance();
      const right = this.parseAdditive();
      expr = {
        type: 'BinaryExpression',
        operator: opToken.value,
        left: expr,
        right,
        line: opToken.line,
        column: opToken.column,
      };
    }

    return expr;
  }

  private parseAdditive(): ExpressionNode {
    let expr = this.parseMultiplicative();

    while (this.peek().type === TokenType.PLUS || this.peek().type === TokenType.MINUS) {
      const opToken = this.advance();
      const right = this.parseMultiplicative();
      expr = {
        type: 'BinaryExpression',
        operator: opToken.value,
        left: expr,
        right,
        line: opToken.line,
        column: opToken.column,
      };
    }

    return expr;
  }

  private parseMultiplicative(): ExpressionNode {
    let expr = this.parseUnary();

    while (
      this.peek().type === TokenType.MULTIPLY ||
      this.peek().type === TokenType.DIVIDE ||
      this.peek().type === TokenType.MODULO
    ) {
      const opToken = this.advance();
      const right = this.parseUnary();
      expr = {
        type: 'BinaryExpression',
        operator: opToken.value,
        left: expr,
        right,
        line: opToken.line,
        column: opToken.column,
      };
    }

    return expr;
  }

  private parseUnary(): ExpressionNode {
    if (this.peek().type === TokenType.NOT) {
      const opToken = this.advance();
      const arg = this.parseUnary();
      return {
        type: 'UnaryExpression',
        operator: 'NOT',
        argument: arg,
        line: opToken.line,
        column: opToken.column,
      };
    }

    if (this.peek().type === TokenType.MINUS) {
      const opToken = this.advance();
      const arg = this.parseUnary();
      return {
        type: 'UnaryExpression',
        operator: '-',
        argument: arg,
        line: opToken.line,
        column: opToken.column,
      };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();

    // Call Expression: CALL add 5 10 or CALL add(5, 10)
    if (token.type === TokenType.CALL) {
      const callToken = this.advance(); // consume CALL
      if (this.peek().type !== TokenType.IDENTIFIER) {
        throw new ManifestError({
          message: 'I expected an action name after CALL.',
          line: callToken.line,
          column: this.peek().column,
          sourceLine: this.getSourceLine(callToken.line),
          expected: 'an action name',
          found: `'${this.peek().value}'`,
          example: 'SET result TO CALL add 5 10',
          phase: 'parser',
        });
      }
      const actionName = this.advance().value;
      const args: ExpressionNode[] = [];

      if (this.peek().type === TokenType.LPAREN) {
        this.advance(); // (
        while (!this.isAtEnd() && this.peek().type !== TokenType.RPAREN) {
          args.push(this.parseExpression());
          if (this.peek().type === TokenType.COMMA) this.advance();
        }
        if (this.peek().type !== TokenType.RPAREN) {
          throw new ManifestError({
            message: "Missing ')' in CALL expression.",
            line: callToken.line,
            column: this.peek().column,
            expected: "')'",
            phase: 'parser',
          });
        }
        this.advance(); // )
      } else {
        // Collect single-token primaries on this line as arguments for inline call
        while (
          !this.isAtEnd() &&
          this.peek().type !== TokenType.NEWLINE &&
          this.peek().type !== TokenType.EOF &&
          this.peek().type !== TokenType.RPAREN &&
          this.peek().type !== TokenType.RBRACKET &&
          this.peek().type !== TokenType.COMMA &&
          !this.isBinaryOperator(this.peek().type)
        ) {
          args.push(this.parseAtom());
        }
      }

      return {
        type: 'CallExpression',
        actionName,
        args,
        line: callToken.line,
        column: callToken.column,
      };
    }

    return this.parseAtomWithPostFix();
  }

  private parseAtomWithPostFix(): ExpressionNode {
    let node = this.parseAtom();

    // Handle index access: e.g. names[0]
    while (this.peek().type === TokenType.LBRACKET) {
      this.advance(); // consume [
      const indexExpr = this.parseExpression();
      if (this.peek().type !== TokenType.RBRACKET) {
        throw new ManifestError({
          message: "Missing closing ']' for list item access.",
          line: node.line,
          column: this.peek().column,
          sourceLine: this.getSourceLine(node.line),
          expected: "']'",
          found: `'${this.peek().value}'`,
          example: 'SHOW names[0]',
          phase: 'parser',
        });
      }
      this.advance(); // consume ]
      node = {
        type: 'IndexAccess',
        target: node,
        index: indexExpr,
        line: node.line,
        column: node.column,
      };
    }

    return node;
  }

  private parseAtom(): ExpressionNode {
    const token = this.peek();

    // Number Literal
    if (token.type === TokenType.NUMBER) {
      this.advance();
      return {
        type: 'Literal',
        value: Number(token.value),
        raw: token.value,
        line: token.line,
        column: token.column,
      };
    }

    // String Literal
    if (token.type === TokenType.STRING) {
      this.advance();
      return {
        type: 'Literal',
        value: token.value,
        raw: `"${token.value}"`,
        line: token.line,
        column: token.column,
      };
    }

    // Boolean Literal
    if (token.type === TokenType.BOOLEAN) {
      this.advance();
      return {
        type: 'Literal',
        value: token.value.toUpperCase() === 'TRUE',
        raw: token.value,
        line: token.line,
        column: token.column,
      };
    }

    // Null Literal
    if (token.type === TokenType.NULL) {
      this.advance();
      return {
        type: 'Literal',
        value: null,
        raw: token.value,
        line: token.line,
        column: token.column,
      };
    }

    // Array Literal: ["Alice", "Bob", 123]
    if (token.type === TokenType.LBRACKET) {
      const lbracket = this.advance();
      const elements: ExpressionNode[] = [];

      this.skipNewlines();
      while (!this.isAtEnd() && this.peek().type !== TokenType.RBRACKET) {
        elements.push(this.parseExpression());
        this.skipNewlines();
        if (this.peek().type === TokenType.COMMA) {
          this.advance();
          this.skipNewlines();
        } else if (this.peek().type !== TokenType.RBRACKET) {
          throw new ManifestError({
            message: "Items in a list must be separated by commas.",
            line: this.peek().line,
            column: this.peek().column,
            sourceLine: this.getSourceLine(this.peek().line),
            expected: "',' or ']'",
            found: `'${this.peek().value}'`,
            example: 'SET fruits TO ["apple", "banana", "orange"]',
            phase: 'parser',
          });
        }
      }

      if (this.peek().type !== TokenType.RBRACKET) {
        throw new ManifestError({
          message: "List was not closed with ']'.",
          line: lbracket.line,
          column: lbracket.column,
          sourceLine: this.getSourceLine(lbracket.line),
          expected: "']' to close the list",
          found: this.peek().type === TokenType.EOF ? 'end of file' : `'${this.peek().value}'`,
          example: 'SET fruits TO ["apple", "banana"]',
          phase: 'parser',
        });
      }
      this.advance(); // consume ]

      return {
        type: 'ArrayLiteral',
        elements,
        line: lbracket.line,
        column: lbracket.column,
      };
    }

    // Parenthesized expression: (a + b)
    if (token.type === TokenType.LPAREN) {
      const lparen = this.advance();
      const inner = this.parseExpression();
      if (this.peek().type !== TokenType.RPAREN) {
        throw new ManifestError({
          message: "Missing closing ')' in expression.",
          line: lparen.line,
          column: this.peek().column,
          sourceLine: this.getSourceLine(lparen.line),
          expected: "')'",
          found: `'${this.peek().value}'`,
          example: '(balance - 10) * 2',
          phase: 'parser',
        });
      }
      this.advance(); // consume )
      return inner;
    }

    // Variable reference
    if (token.type === TokenType.IDENTIFIER) {
      this.advance();
      return {
        type: 'VariableReference',
        name: token.value,
        line: token.line,
        column: token.column,
      };
    }

    const lineText = this.getSourceLine(token.line);
    throw new ManifestError({
      message: `I didn't expect '${token.value}' here.`,
      line: token.line,
      column: token.column,
      sourceLine: lineText,
      expected: 'a value, variable name, number, string, or calculation',
      found: token.type === TokenType.EOF ? 'end of line' : `'${token.value}'`,
      example: 'SHOW "Hello World"',
      phase: 'parser',
    });
  }

  private isBinaryOperator(type: TokenType): boolean {
    return (
      type === TokenType.PLUS ||
      type === TokenType.MINUS ||
      type === TokenType.MULTIPLY ||
      type === TokenType.DIVIDE ||
      type === TokenType.MODULO ||
      type === TokenType.EQUALS ||
      type === TokenType.NOT_EQUALS ||
      type === TokenType.LESS_THAN ||
      type === TokenType.GREATER_THAN ||
      type === TokenType.LESS_OR_EQUAL ||
      type === TokenType.GREATER_OR_EQUAL ||
      type === TokenType.AND ||
      type === TokenType.OR
    );
  }

  // ----------------------------------------------------
  // Helpers
  // ----------------------------------------------------

  private peek(): Token {
    return this.tokens[this.cursor] ?? {
      type: TokenType.EOF,
      value: '',
      line: 1,
      column: 1,
      length: 0,
    };
  }

  private peekNext(): Token {
    return this.tokens[this.cursor + 1] ?? {
      type: TokenType.EOF,
      value: '',
      line: 1,
      column: 1,
      length: 0,
    };
  }

  private advance(): Token {
    const token = this.peek();
    if (!this.isAtEnd()) {
      this.cursor++;
    }
    return token;
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.tokens.length || this.peek().type === TokenType.EOF;
  }

  private skipNewlines(): void {
    while (!this.isAtEnd() && this.peek().type === TokenType.NEWLINE) {
      this.cursor++;
    }
  }

  private consumeStatementEnd(): void {
    if (this.peek().type === TokenType.NEWLINE) {
      this.advance();
    } else if (this.peek().type !== TokenType.EOF) {
      // If next token is not EOF, newline, or block closer (END / ELSE / IF FAILED), raise clear error
      if (
        this.peek().type !== TokenType.END &&
        this.peek().type !== TokenType.ELSE
      ) {
        const token = this.peek();
        throw new ManifestError({
          message: `Unexpected extra instruction on this line: '${token.value}'`,
          line: token.line,
          column: token.column,
          sourceLine: this.getSourceLine(token.line),
          expected: 'new line or next statement on a new line',
          found: `'${token.value}'`,
          hint: 'Manifest statements should each be placed on their own line.',
          phase: 'parser',
        });
      }
    }
  }

  private getSourceLine(line: number): string {
    return this.sourceLines[line - 1] ?? '';
  }
}

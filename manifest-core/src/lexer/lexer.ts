/**
 * Manifest Core v0.1 - Lexer
 * Converts raw Manifest source code into a clean stream of tokens.
 */

import { Token, TokenType } from './tokens.ts';
import { ManifestError } from '../errors/manifest-error.ts';

const KEYWORDS: Record<string, TokenType> = {
  APP: TokenType.APP,
  USE: TokenType.USE,
  SET: TokenType.SET,
  TO: TokenType.TO,
  SHOW: TokenType.SHOW,
  IF: TokenType.IF,
  ELSE: TokenType.ELSE,
  END: TokenType.END,
  WHEN: TokenType.WHEN,
  REPEAT: TokenType.REPEAT,
  TIMES: TokenType.TIMES,
  FOR: TokenType.FOR,
  EACH: TokenType.EACH,
  IN: TokenType.IN,
  AS: TokenType.AS,
  ACTION: TokenType.ACTION,
  CALL: TokenType.CALL,
  RETURN: TokenType.RETURN,
  TRY: TokenType.TRY,
  FAILED: TokenType.FAILED,

  // Manifest v0.2 Application Primitives
  PAGE: TokenType.PAGE,
  TEXT: TokenType.TEXT,
  BUTTON: TokenType.BUTTON,
  INPUT: TokenType.INPUT,
  IMAGE: TokenType.IMAGE,
  FORM: TokenType.FORM,
  STATE: TokenType.STATE,
  ROUTE: TokenType.ROUTE,
  CLICK: TokenType.CLICK,
  SUBMIT: TokenType.SUBMIT,
  CHANGE: TokenType.CHANGE,
  INTO: TokenType.INTO,
  BIND: TokenType.BIND,
  ALT: TokenType.ALT,

  // Manifest v0.3 UI Primitives, Layout & Design System
  CONTAINER: TokenType.CONTAINER,
  CARD: TokenType.CARD,
  LIST: TokenType.LIST,
  LINK: TokenType.LINK,
  SELECT: TokenType.SELECT,
  CHECKBOX: TokenType.CHECKBOX,
  TEXTAREA: TokenType.TEXTAREA,
  HEADER: TokenType.HEADER,
  FOOTER: TokenType.FOOTER,
  NAV: TokenType.NAV,
  MODAL: TokenType.MODAL,
  COMPONENT: TokenType.COMPONENT,
  STYLE: TokenType.STYLE,
  LAYOUT: TokenType.LAYOUT,
  DIRECTION: TokenType.DIRECTION,

  // Manifest v0.4 UI Primitives
  TABLE: TokenType.TABLE,
  DIALOG: TokenType.DIALOG,
  TABS: TokenType.TABS,
  MENU: TokenType.MENU,
  SIDEBAR: TokenType.SIDEBAR,
  AVATAR: TokenType.AVATAR,
  BADGE: TokenType.BADGE,
  PROGRESS: TokenType.PROGRESS,
  ICON: TokenType.ICON,
  VIDEO: TokenType.VIDEO,
  AUDIO: TokenType.AUDIO,

  // Escape Hatches
  CSS: TokenType.CSS,
  JS: TokenType.JS,
  RUST: TokenType.RUST,

  // Library & Animation
  LIBRARY: TokenType.LIBRARY,
  ANIMATE: TokenType.ANIMATE,

  // Solana First-Class Primitives
  PROGRAM: TokenType.PROGRAM,
  ACCOUNT: TokenType.ACCOUNT,
  INSTRUCTION: TokenType.INSTRUCTION,
  REQUIRE: TokenType.REQUIRE,
  SIGNER: TokenType.SIGNER,

  // Responsive Styling
  MOBILE: TokenType.MOBILE,
  TABLET: TokenType.TABLET,
  DESKTOP: TokenType.DESKTOP,

  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,

  TRUE: TokenType.BOOLEAN,
  FALSE: TokenType.BOOLEAN,
  NULL: TokenType.NULL,
  NONE: TokenType.NULL,
  EMPTY: TokenType.NULL,
};

export class Lexer {
  private readonly source: string;
  private readonly lines: string[];
  private cursor: number = 0;
  private line: number = 1;
  private column: number = 1;

  constructor(source: string) {
    this.source = source;
    this.lines = source.split('\n');
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      const char = this.peek();

      // Comments: support '--', '//', '#', or lines starting with 'NOTE:' / 'COMMENT:'
      if (
        (char === '-' && this.peekNext() === '-') ||
        (char === '/' && this.peekNext() === '/') ||
        char === '#'
      ) {
        this.skipLine();
        continue;
      }

      // Check for NOTE: or COMMENT: comment
      if (this.isCommentPrefix()) {
        this.skipLine();
        continue;
      }

      // Newlines
      if (char === '\n') {
        const line = this.line;
        const col = this.column;
        this.advance();
        this.line++;
        this.column = 1;

        // Avoid duplicate consecutive NEWLINE tokens
        if (tokens.length > 0 && tokens[tokens.length - 1].type !== TokenType.NEWLINE) {
          tokens.push({
            type: TokenType.NEWLINE,
            value: '\n',
            line,
            column: col,
            length: 1,
          });
        }
        continue;
      }

      // Whitespace
      if (char === ' ' || char === '\t' || char === '\r') {
        this.advance();
        continue;
      }

      // Strings ("..." or '...')
      if (char === '"' || char === "'") {
        tokens.push(this.readString(char));
        continue;
      }

      // Numbers
      if (this.isDigit(char)) {
        tokens.push(this.readNumber());
        continue;
      }

      // Two-character operators & special unicode symbols
      if (char === '=' && this.peekNext() === '=') {
        tokens.push(this.makeToken(TokenType.EQUALS, '==', 2));
        this.advance(2);
        continue;
      }

      if (char === '!' && this.peekNext() === '=') {
        tokens.push(this.makeToken(TokenType.NOT_EQUALS, '!=', 2));
        this.advance(2);
        continue;
      }

      if (char === '<' && this.peekNext() === '>') {
        tokens.push(this.makeToken(TokenType.NOT_EQUALS, '<>', 2));
        this.advance(2);
        continue;
      }

      if (char === '<' && this.peekNext() === '=') {
        tokens.push(this.makeToken(TokenType.LESS_OR_EQUAL, '<=', 2));
        this.advance(2);
        continue;
      }

      if (char === '>' && this.peekNext() === '=') {
        tokens.push(this.makeToken(TokenType.GREATER_OR_EQUAL, '>=', 2));
        this.advance(2);
        continue;
      }

      // Support guillemet / unicode symbols «» and «=»
      if (this.source.startsWith('«»', this.cursor)) {
        tokens.push(this.makeToken(TokenType.NOT_EQUALS, '«»', 2));
        this.advance(2);
        continue;
      }

      if (this.source.startsWith('«=»', this.cursor)) {
        tokens.push(this.makeToken(TokenType.LESS_OR_EQUAL, '«=»', 3));
        this.advance(3);
        continue;
      }

      if (this.source.startsWith('«>=»', this.cursor)) {
        tokens.push(this.makeToken(TokenType.GREATER_OR_EQUAL, '«>=»', 4));
        this.advance(4);
        continue;
      }

      // Single-character operators & punctuation
      if (char === '+') {
        tokens.push(this.makeToken(TokenType.PLUS, '+', 1));
        this.advance();
        continue;
      }
      if (char === '-') {
        tokens.push(this.makeToken(TokenType.MINUS, '-', 1));
        this.advance();
        continue;
      }
      if (char === '*') {
        tokens.push(this.makeToken(TokenType.MULTIPLY, '*', 1));
        this.advance();
        continue;
      }
      if (char === '/') {
        tokens.push(this.makeToken(TokenType.DIVIDE, '/', 1));
        this.advance();
        continue;
      }
      if (char === '%') {
        tokens.push(this.makeToken(TokenType.MODULO, '%', 1));
        this.advance();
        continue;
      }
      if (char === '<') {
        tokens.push(this.makeToken(TokenType.LESS_THAN, '<', 1));
        this.advance();
        continue;
      }
      if (char === '>') {
        tokens.push(this.makeToken(TokenType.GREATER_THAN, '>', 1));
        this.advance();
        continue;
      }
      if (char === '.') {
        tokens.push(this.makeToken(TokenType.DOT, '.', 1));
        this.advance();
        continue;
      }
      if (char === ',') {
        tokens.push(this.makeToken(TokenType.COMMA, ',', 1));
        this.advance();
        continue;
      }
      if (char === ':') {
        tokens.push(this.makeToken(TokenType.COLON, ':', 1));
        this.advance();
        continue;
      }
      if (char === '(') {
        tokens.push(this.makeToken(TokenType.LPAREN, '(', 1));
        this.advance();
        continue;
      }
      if (char === ')') {
        tokens.push(this.makeToken(TokenType.RPAREN, ')', 1));
        this.advance();
        continue;
      }
      if (char === '[') {
        tokens.push(this.makeToken(TokenType.LBRACKET, '[', 1));
        this.advance();
        continue;
      }
      if (char === ']') {
        tokens.push(this.makeToken(TokenType.RBRACKET, ']', 1));
        this.advance();
        continue;
      }
      if (char === '=') {
        tokens.push(this.makeToken(TokenType.ASSIGN, '=', 1));
        this.advance();
        continue;
      }
      if (char === '{') {
        tokens.push(this.makeToken(TokenType.LBRACE, '{', 1));
        this.advance();
        continue;
      }
      if (char === '}') {
        tokens.push(this.makeToken(TokenType.RBRACE, '}', 1));
        this.advance();
        continue;
      }
      if (char === ';') {
        tokens.push(this.makeToken(TokenType.SEMICOLON, ';', 1));
        this.advance();
        continue;
      }

      // Identifiers, keywords, booleans
      if (this.isAlpha(char)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      // Unknown character error with beginner-friendly diagnostics
      const errLine = this.getCurrentLineText();
      throw new ManifestError({
        message: `I encountered an unexpected character: '${char}'`,
        line: this.line,
        column: this.column,
        sourceLine: errLine,
        expected: 'a keyword, variable name, number, or string',
        found: `'${char}'`,
        example: 'SHOW "Hello World"',
        hint: 'Check if there is a stray symbol or typo on this line.',
        phase: 'lexer',
      });
    }

    // Append EOF token
    tokens.push({
      type: TokenType.EOF,
      value: '',
      line: this.line,
      column: this.column,
      length: 0,
    });

    return tokens;
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.source.length;
  }

  private peek(): string {
    return this.source[this.cursor] ?? '';
  }

  private peekNext(): string {
    return this.source[this.cursor + 1] ?? '';
  }

  private advance(count: number = 1): void {
    this.cursor += count;
    this.column += count;
  }

  private skipLine(): void {
    while (!this.isAtEnd() && this.peek() !== '\n') {
      this.advance();
    }
  }

  private isCommentPrefix(): boolean {
    const remaining = this.source.slice(this.cursor);
    return remaining.startsWith('NOTE:') || remaining.startsWith('COMMENT:');
  }

  private makeToken(type: TokenType, value: string, length: number): Token {
    return {
      type,
      value,
      line: this.line,
      column: this.column,
      length,
    };
  }

  private readString(quoteChar: string): Token {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance(); // Skip opening quote
    let value = '';

    while (!this.isAtEnd() && this.peek() !== quoteChar) {
      if (this.peek() === '\n') {
        const errLine = this.lines[startLine - 1] ?? '';
        throw new ManifestError({
          message: 'This text string was opened but never closed before the line ended.',
          line: startLine,
          column: startColumn,
          sourceLine: errLine,
          expected: `a closing quote (${quoteChar}) before the end of the line`,
          found: 'an unclosed string',
          example: `SHOW "Hello World"`,
          hint: `Add a closing ${quoteChar} at the end of your text.`,
          phase: 'lexer',
        });
      }

      if (this.peek() === '\\') {
        this.advance(); // Skip backslash
        const escaped = this.peek();
        if (escaped === 'n') value += '\n';
        else if (escaped === 't') value += '\t';
        else if (escaped === '"') value += '"';
        else if (escaped === "'") value += "'";
        else if (escaped === '\\') value += '\\';
        else value += escaped;
        this.advance();
      } else {
        value += this.peek();
        this.advance();
      }
    }

    if (this.isAtEnd()) {
      const errLine = this.lines[startLine - 1] ?? '';
      throw new ManifestError({
        message: 'This text string was never closed.',
        line: startLine,
        column: startColumn,
        sourceLine: errLine,
        expected: `a closing quote (${quoteChar})`,
        found: 'end of program',
        example: `SHOW "Hello World"`,
        phase: 'lexer',
      });
    }

    this.advance(); // Skip closing quote

    return {
      type: TokenType.STRING,
      value,
      line: startLine,
      column: startColumn,
      length: this.cursor - (this.cursor - (value.length + 2)),
    };
  }

  private readNumber(): Token {
    const startColumn = this.column;
    let numStr = '';

    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      numStr += this.peek();
      this.advance();
    }

    // Optional fractional part
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      numStr += '.';
      this.advance();
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        numStr += this.peek();
        this.advance();
      }
    }

    return {
      type: TokenType.NUMBER,
      value: numStr,
      line: this.line,
      column: startColumn,
      length: numStr.length,
    };
  }

  private readIdentifier(): Token {
    const startColumn = this.column;
    let ident = '';

    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === '_')) {
      ident += this.peek();
      this.advance();
    }

    const upper = ident.toUpperCase();
    const keywordType = KEYWORDS[upper];

    if (keywordType !== undefined) {
      return {
        type: keywordType,
        value: ident,
        line: this.line,
        column: startColumn,
        length: ident.length,
      };
    }

    return {
      type: TokenType.IDENTIFIER,
      value: ident,
      line: this.line,
      column: startColumn,
      length: ident.length,
    };
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }

  private getCurrentLineText(): string {
    return this.lines[this.line - 1] ?? '';
  }
}

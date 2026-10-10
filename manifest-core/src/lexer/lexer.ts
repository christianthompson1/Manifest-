import { Token, TokenType } from './tokens.ts';
import { ManifestError } from '../errors/manifest-error.ts';

export class Lexer {
  private source: string;
  private position = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];

  private static KEYWORDS: Record<string, TokenType> = {
    APP: TokenType.APP,
    WHEN: TokenType.WHEN,
    SET: TokenType.SET,
    TO: TokenType.TO,
    SHOW: TokenType.SHOW,
    CALL: TokenType.CALL,
    WITH: TokenType.WITH,
    ACTION: TokenType.ACTION,
    RETURNS: TokenType.RETURNS,
    RETURN: TokenType.RETURN,
    IF: TokenType.IF,
    ELSE: TokenType.ELSE,
    REPEAT: TokenType.REPEAT,
    TIMES: TokenType.TIMES,
    FOR: TokenType.FOR,
    EACH: TokenType.EACH,
    IN: TokenType.IN,
    TRY: TokenType.TRY,
    FAILED: TokenType.FAILED,
    USE: TokenType.USE,
    END: TokenType.END,
    TRUE: TokenType.BOOLEAN,
    FALSE: TokenType.BOOLEAN,
    PAGE: TokenType.PAGE,
    TEXT: TokenType.TEXT,
    BUTTON: TokenType.BUTTON,
    CLICK: TokenType.CLICK,
    STATE: TokenType.STATE,
    INPUT: TokenType.INPUT,
    FORM: TokenType.FORM,
    SUBMIT: TokenType.SUBMIT,
    ROUTE: TokenType.ROUTE,
    CONTAINER: TokenType.CONTAINER,
    CARD: TokenType.CARD,
    LIST: TokenType.LIST,
    LINK: TokenType.LINK,
    SELECT: TokenType.SELECT,
    OPTION: TokenType.OPTION,
    CHECKBOX: TokenType.CHECKBOX,
    TEXTAREA: TokenType.TEXTAREA,
    HEADER: TokenType.HEADER,
    NAV: TokenType.NAV,
    FOOTER: TokenType.FOOTER,
    STYLE: TokenType.STYLE,
    COMPONENT: TokenType.COMPONENT,
    SOLANA: TokenType.SOLANA,
    PROGRAM: TokenType.PROGRAM,
    ACCOUNT: TokenType.ACCOUNT,
    INSTRUCTION: TokenType.INSTRUCTION,
    ACCOUNTS: TokenType.ACCOUNTS,
    SIGNER: TokenType.SIGNER,
    MUT: TokenType.MUT,
    REQUIRE: TokenType.REQUIRE,
  };

  constructor(source: string) {
    this.source = source;
  }

  public tokenize(): Token[] {
    while (this.position < this.source.length) {
      const char = this.source[this.position];

      // Newlines
      if (char === '\n') {
        this.tokens.push({
          type: TokenType.NEWLINE,
          value: '\n',
          line: this.line,
          column: this.column,
        });
        this.line++;
        this.column = 1;
        this.position++;
        continue;
      }

      // Whitespace
      if (char === ' ' || char === '\t' || char === '\r') {
        this.column++;
        this.position++;
        continue;
      }

      // Hex color values like #2563EB or #fff
      if (char === '#' && this.isHexDigit(this.source[this.position + 1])) {
        this.readHexColor();
        continue;
      }

      // Comments: -- , // , # , NOTE:
      if (
        (char === '-' && this.source[this.position + 1] === '-') ||
        (char === '/' && this.source[this.position + 1] === '/') ||
        char === '#'
      ) {
        this.skipLine();
        continue;
      }

      if (this.source.startsWith('NOTE:', this.position)) {
        this.skipLine();
        continue;
      }

      // Escape hatches
      if (this.source.startsWith('CSS```', this.position)) {
        this.readEscapeHatch(TokenType.CSS_ESCAPE, 'CSS```');
        continue;
      }
      if (/^CSS(?:\r?\n|[ \t]+\r?\n)/.test(this.source.slice(this.position))) {
        this.readBlockEscapeHatch(TokenType.CSS_ESCAPE, 'CSS');
        continue;
      }

      if (this.source.startsWith('JS```', this.position)) {
        this.readEscapeHatch(TokenType.JS_ESCAPE, 'JS```');
        continue;
      }
      if (/^JS(?:\r?\n|[ \t]+\r?\n)/.test(this.source.slice(this.position))) {
        this.readBlockEscapeHatch(TokenType.JS_ESCAPE, 'JS');
        continue;
      }

      // Strings
      if (char === '"' || char === "'") {
        this.readString(char);
        continue;
      }

      // Numbers
      if (this.isDigit(char)) {
        this.readNumber();
        continue;
      }

      // Identifiers & Keywords
      if (this.isAlpha(char)) {
        this.readIdentifier();
        continue;
      }

      // Multi-char operators
      if (char === '=' && this.source[this.position + 1] === '=') {
        this.addToken(TokenType.EQ_EQ, '==', 2);
        continue;
      }
      if (char === '!' && this.source[this.position + 1] === '=') {
        this.addToken(TokenType.NOT_EQUALS, '!=', 2);
        continue;
      }
      if (char === '<' && this.source[this.position + 1] === '=') {
        this.addToken(TokenType.LESS_EQ, '<=', 2);
        continue;
      }
      if (char === '>' && this.source[this.position + 1] === '=') {
        this.addToken(TokenType.GREATER_EQ, '>=', 2);
        continue;
      }
      if (char === '«' && this.source[this.position + 1] === '=') {
        this.addToken(TokenType.LESS_EQ, '<=', 2);
        continue;
      }
      if (char === '»' && this.source[this.position + 1] === '=') {
        this.addToken(TokenType.GREATER_EQ, '>=', 2);
        continue;
      }

      // Single-char symbols & operators
      switch (char) {
        case '=':
          this.addToken(TokenType.EQUALS, '=');
          break;
        case '<':
        case '«':
          this.addToken(TokenType.LESS, '<');
          break;
        case '>':
        case '»':
          this.addToken(TokenType.GREATER, '>');
          break;
        case '+':
          this.addToken(TokenType.PLUS, '+');
          break;
        case '-':
          this.addToken(TokenType.MINUS, '-');
          break;
        case '*':
          this.addToken(TokenType.STAR, '*');
          break;
        case '/':
          this.addToken(TokenType.SLASH, '/');
          break;
        case '%':
          this.addToken(TokenType.PERCENT, '%');
          break;
        case '.':
          this.addToken(TokenType.DOT, '.');
          break;
        case ',':
          this.addToken(TokenType.COMMA, ',');
          break;
        case ':':
          this.addToken(TokenType.COLON, ':');
          break;
        case '(':
          this.addToken(TokenType.LPAREN, '(');
          break;
        case ')':
          this.addToken(TokenType.RPAREN, ')');
          break;
        case '[':
          this.addToken(TokenType.LBRACKET, '[');
          break;
        case ']':
          this.addToken(TokenType.RBRACKET, ']');
          break;
        case '{':
          this.addToken(TokenType.LBRACE, '{');
          break;
        case '}':
          this.addToken(TokenType.RBRACE, '}');
          break;
        default:
          throw new ManifestError(
            `Unexpected character: '${char}'`,
            this.line,
            this.column,
            'Check for syntax errors or unsupported symbols.'
          );
      }
    }

    this.tokens.push({
      type: TokenType.EOF,
      value: '',
      line: this.line,
      column: this.column,
    });

    return this.tokens;
  }

  private addToken(type: TokenType, value: string, length = 1) {
    this.tokens.push({
      type,
      value,
      line: this.line,
      column: this.column,
    });
    this.position += length;
    this.column += length;
  }

  private skipLine() {
    while (this.position < this.source.length && this.source[this.position] !== '\n') {
      this.position++;
    }
  }

  private readEscapeHatch(type: TokenType, prefix: string) {
    const startLine = this.line;
    const startCol = this.column;
    this.position += prefix.length;
    this.column += prefix.length;

    let content = '';
    while (this.position < this.source.length && !this.source.startsWith('```', this.position)) {
      if (this.source[this.position] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      content += this.source[this.position];
      this.position++;
    }

    if (this.source.startsWith('```', this.position)) {
      this.position += 3;
      this.column += 3;
    }

    this.tokens.push({
      type,
      value: content.trim(),
      line: startLine,
      column: startCol,
    });
  }

  private readBlockEscapeHatch(type: TokenType, prefix: string) {
    const startLine = this.line;
    const startCol = this.column;
    this.position += prefix.length;
    this.column += prefix.length;

    let content = '';
    while (this.position < this.source.length) {
      const remaining = this.source.slice(this.position);
      const matchEnd = remaining.match(/^[ \t]*END\b/);
      if (matchEnd) {
        this.position += matchEnd[0].length;
        this.column += matchEnd[0].length;
        break;
      }

      if (this.source[this.position] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      content += this.source[this.position];
      this.position++;
    }

    this.tokens.push({
      type,
      value: content.trim(),
      line: startLine,
      column: startCol,
    });
  }

  private readString(quote: string) {
    const startLine = this.line;
    const startCol = this.column;
    this.position++; // Skip open quote
    this.column++;

    let val = '';
    while (this.position < this.source.length && this.source[this.position] !== quote) {
      if (this.source[this.position] === '\n') {
        throw new ManifestError(
          'Unclosed string literal across newline',
          startLine,
          startCol,
          'Make sure every string is closed on the same line with matching quotes.'
        );
      }
      val += this.source[this.position];
      this.position++;
      this.column++;
    }

    if (this.position >= this.source.length) {
      throw new ManifestError(
        'Unclosed string literal at end of file',
        startLine,
        startCol,
        'Close string literal with matching quote.'
      );
    }

    this.position++; // Skip closing quote
    this.column++;

    this.tokens.push({
      type: TokenType.STRING,
      value: val,
      line: startLine,
      column: startCol,
    });
  }

  private readNumber() {
    const startLine = this.line;
    const startCol = this.column;
    let numStr = '';

    while (
      this.position < this.source.length &&
      (this.isDigit(this.source[this.position]) || this.source[this.position] === '.')
    ) {
      numStr += this.source[this.position];
      this.position++;
      this.column++;
    }

    this.tokens.push({
      type: TokenType.NUMBER,
      value: numStr,
      line: startLine,
      column: startCol,
    });
  }

  private readIdentifier() {
    const startLine = this.line;
    const startCol = this.column;
    let ident = '';

    while (
      this.position < this.source.length &&
      (this.isAlphaNumeric(this.source[this.position]) || this.source[this.position] === '_')
    ) {
      ident += this.source[this.position];
      this.position++;
      this.column++;
    }

    const upper = ident.toUpperCase();
    if (upper in Lexer.KEYWORDS) {
      this.tokens.push({
        type: Lexer.KEYWORDS[upper],
        value: ident,
        line: startLine,
        column: startCol,
      });
    } else {
      this.tokens.push({
        type: TokenType.IDENTIFIER,
        value: ident,
        line: startLine,
        column: startCol,
      });
    }
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }

  private isHexDigit(char?: string): boolean {
    if (!char) return false;
    return (
      (char >= '0' && char <= '9') ||
      (char >= 'a' && char <= 'f') ||
      (char >= 'A' && char <= 'F')
    );
  }

  private readHexColor() {
    const startLine = this.line;
    const startCol = this.column;
    let hex = '#';
    this.position++;
    this.column++;

    while (this.position < this.source.length && this.isHexDigit(this.source[this.position])) {
      hex += this.source[this.position];
      this.position++;
      this.column++;
    }

    this.tokens.push({
      type: TokenType.IDENTIFIER,
      value: hex,
      line: startLine,
      column: startCol,
    });
  }
}

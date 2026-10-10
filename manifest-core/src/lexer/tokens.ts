export enum TokenType {
  // Literals & Identifiers
  IDENTIFIER = 'IDENTIFIER',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',

  // Core Keywords
  APP = 'APP',
  WHEN = 'WHEN',
  SET = 'SET',
  TO = 'TO',
  SHOW = 'SHOW',
  CALL = 'CALL',
  WITH = 'WITH',
  ACTION = 'ACTION',
  RETURNS = 'RETURNS',
  RETURN = 'RETURN',
  IF = 'IF',
  ELSE = 'ELSE',
  REPEAT = 'REPEAT',
  TIMES = 'TIMES',
  FOR = 'FOR',
  EACH = 'EACH',
  IN = 'IN',
  TRY = 'TRY',
  FAILED = 'FAILED',
  USE = 'USE',
  END = 'END',

  // v0.2 App Primitives
  PAGE = 'PAGE',
  TEXT = 'TEXT',
  BUTTON = 'BUTTON',
  CLICK = 'CLICK',
  STATE = 'STATE',
  INPUT = 'INPUT',
  FORM = 'FORM',
  SUBMIT = 'SUBMIT',
  ROUTE = 'ROUTE',

  // v0.3 UI Primitives
  CONTAINER = 'CONTAINER',
  CARD = 'CARD',
  LIST = 'LIST',
  LINK = 'LINK',
  SELECT = 'SELECT',
  OPTION = 'OPTION',
  CHECKBOX = 'CHECKBOX',
  TEXTAREA = 'TEXTAREA',
  HEADER = 'HEADER',
  NAV = 'NAV',
  FOOTER = 'FOOTER',
  STYLE = 'STYLE',
  COMPONENT = 'COMPONENT',

  // v0.4 Solana & Escape Hatches
  SOLANA = 'SOLANA',
  PROGRAM = 'PROGRAM',
  ACCOUNT = 'ACCOUNT',
  INSTRUCTION = 'INSTRUCTION',
  ACCOUNTS = 'ACCOUNTS',
  SIGNER = 'SIGNER',
  MUT = 'MUT',
  REQUIRE = 'REQUIRE',
  CSS_ESCAPE = 'CSS_ESCAPE',
  JS_ESCAPE = 'JS_ESCAPE',

  // Operators & Delimiters
  EQUALS = 'EQUALS',
  EQ_EQ = 'EQ_EQ',
  NOT_EQUALS = 'NOT_EQUALS',
  GREATER = 'GREATER',
  GREATER_EQ = 'GREATER_EQ',
  LESS = 'LESS',
  LESS_EQ = 'LESS_EQ',
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  PERCENT = 'PERCENT',
  DOT = 'DOT',
  COMMA = 'COMMA',
  COLON = 'COLON',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

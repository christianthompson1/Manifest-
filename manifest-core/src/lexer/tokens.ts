/**
 * Manifest Core v0.1 - Token Definitions
 */

export enum TokenType {
  // Declarations & Core Keywords
  APP = 'APP',
  USE = 'USE',
  SET = 'SET',
  TO = 'TO',
  SHOW = 'SHOW',
  IF = 'IF',
  ELSE = 'ELSE',
  END = 'END',
  WHEN = 'WHEN',
  REPEAT = 'REPEAT',
  TIMES = 'TIMES',
  FOR = 'FOR',
  EACH = 'EACH',
  IN = 'IN',
  AS = 'AS',
  ACTION = 'ACTION',
  CALL = 'CALL',
  RETURN = 'RETURN',
  TRY = 'TRY',
  FAILED = 'FAILED',

  // Manifest v0.2 Application Primitives
  PAGE = 'PAGE',
  TEXT = 'TEXT',
  BUTTON = 'BUTTON',
  INPUT = 'INPUT',
  IMAGE = 'IMAGE',
  FORM = 'FORM',
  STATE = 'STATE',
  ROUTE = 'ROUTE',

  // Manifest v0.3 UI Primitives, Layout & Design System
  CONTAINER = 'CONTAINER',
  CARD = 'CARD',
  LIST = 'LIST',
  LINK = 'LINK',
  SELECT = 'SELECT',
  CHECKBOX = 'CHECKBOX',
  TEXTAREA = 'TEXTAREA',
  HEADER = 'HEADER',
  FOOTER = 'FOOTER',
  NAV = 'NAV',
  MODAL = 'MODAL',
  COMPONENT = 'COMPONENT',

  // Manifest v0.4 UI Primitives
  TABLE = 'TABLE',
  DIALOG = 'DIALOG',
  TABS = 'TABS',
  MENU = 'MENU',
  SIDEBAR = 'SIDEBAR',
  AVATAR = 'AVATAR',
  BADGE = 'BADGE',
  PROGRESS = 'PROGRESS',
  ICON = 'ICON',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',

  // Escape Hatches
  CSS = 'CSS',
  JS = 'JS',
  RUST = 'RUST',

  // Library & Animation
  LIBRARY = 'LIBRARY',
  ANIMATE = 'ANIMATE',

  // Solana First-Class Primitives
  PROGRAM = 'PROGRAM',
  ACCOUNT = 'ACCOUNT',
  INSTRUCTION = 'INSTRUCTION',
  REQUIRE = 'REQUIRE',
  SIGNER = 'SIGNER',

  // Styling & Layout keywords
  STYLE = 'STYLE',
  LAYOUT = 'LAYOUT',
  DIRECTION = 'DIRECTION',
  MOBILE = 'MOBILE',
  TABLET = 'TABLET',
  DESKTOP = 'DESKTOP',

  // UI Event & Binding Keywords
  CLICK = 'CLICK',
  SUBMIT = 'SUBMIT',
  CHANGE = 'CHANGE',
  INTO = 'INTO',
  BIND = 'BIND',
  ALT = 'ALT',

  // Logical Keywords
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  // Literal values
  IDENTIFIER = 'IDENTIFIER',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',

  // Operators
  PLUS = 'PLUS',         // +
  MINUS = 'MINUS',       // -
  MULTIPLY = 'MULTIPLY', // *
  DIVIDE = 'DIVIDE',     // /
  MODULO = 'MODULO',     // %

  // Comparisons
  EQUALS = 'EQUALS',                 // ==
  NOT_EQUALS = 'NOT_EQUALS',         // !=, <>, «»
  LESS_THAN = 'LESS_THAN',           // <
  GREATER_THAN = 'GREATER_THAN',     // >
  LESS_OR_EQUAL = 'LESS_OR_EQUAL',   // <=, «=»
  GREATER_OR_EQUAL = 'GREATER_OR_EQUAL', // >=, «>=»

  // Punctuation
  DOT = 'DOT',           // .
  COMMA = 'COMMA',       // ,
  COLON = 'COLON',       // :
  SEMICOLON = 'SEMICOLON', // ;
  ASSIGN = 'ASSIGN',     // =
  LPAREN = 'LPAREN',     // (
  RPAREN = 'RPAREN',     // )
  LBRACKET = 'LBRACKET', // [
  RBRACKET = 'RBRACKET', // ]
  LBRACE = 'LBRACE',     // {
  RBRACE = 'RBRACE',     // }

  // Delimiters
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  length: number;
}

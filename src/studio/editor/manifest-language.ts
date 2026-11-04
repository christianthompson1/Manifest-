/**
 * Manifest Language Support for CodeMirror 6
 * Provides robust syntax highlighting, tokenization, grammar definitions,
 * and authentic VS Code Dark Modern syntax token categorization.
 */

import { StreamLanguage, StringStream, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Control flow keywords -> tags.controlKeyword (Purple #c586c0)
const CONTROL_KEYWORDS = new Set([
  'IF', 'ELSE', 'END', 'WHEN', 'REPEAT', 'TIMES', 'FOR', 'EACH',
  'RETURN', 'TRY', 'FAILED', 'WHILE', 'REQUIRE', 'MATCH', 'BREAK', 'CONTINUE',
  'AWAIT', 'IMPORT', 'EXPORT', 'FROM',
  'if', 'else', 'for', 'in', 'while', 'repeat', 'match', 'break', 'continue',
  'return', 'await', 'import', 'export', 'from'
]);

// Structural & definition keywords -> tags.definitionKeyword (Blue #569cd6)
const DEFINITION_KEYWORDS = new Set([
  'MODULE', 'FUNCTION', 'RETURNS', 'LET', 'MUTABLE', 'CONSTANT',
  'STRUCT', 'ENUM', 'TRAIT', 'REQUIRES', 'PROVIDES', 'DENIES', 'EFFECTS', 'PURE', 'ASYNC',
  'APP', 'PAGE', 'ACTION', 'COMPONENT', 'CONTAINER', 'SERVER', 'ENDPOINT',
  'USE', 'METHOD', 'ROUTE', 'CARD', 'NAV', 'HEADER', 'FOOTER', 'MODAL',
  'PROGRAM', 'ACCOUNT', 'INSTRUCTION', 'CSS', 'JS', 'RUST', 'LIBRARY',
  'SOLANA', 'WALLET', 'DEPLOY', 'PDA', 'TOKEN', 'TRANSFER',
  'module', 'fn', 'let', 'mut', 'const', 'struct', 'enum', 'trait',
  'requires', 'provides', 'denies', 'effects', 'pure', 'async', 'pub'
]);

// Statement & action keywords -> tags.keyword (Blue #569cd6)
const STATEMENT_KEYWORDS = new Set([
  'SET', 'TO', 'SHOW', 'CALL', 'STATE', 'STYLE', 'LAYOUT', 'DIRECTION',
  'ANIMATE', 'SIGNER', 'CONNECT', 'DISCONNECT', 'INVOKE'
]);

// Logical operators & prepositions -> tags.operatorKeyword (Blue #569cd6)
const OPERATOR_KEYWORDS = new Set([
  'AND', 'OR', 'NOT', 'IN', 'INTO', 'BIND', 'ALT', 'WITH', 'AS', 'IS'
]);

// UI Primitives & Types -> tags.typeName (Teal #4ec9b0)
const TYPE_AND_PRIMITIVE_KEYWORDS = new Set([
  'Int', 'Float', 'Bool', 'Void', 'Array', 'Map', 'Result', 'Option',
  'i64', 'f64', 'bool', 'str', 'void',
  'INT', 'FLOAT', 'BOOL', 'VOID', 'ARRAY', 'MAP', 'RESULT',
  'TEXT', 'BUTTON', 'INPUT', 'IMAGE', 'FORM', 'LIST', 'LINK',
  'TEXTAREA', 'CHECKBOX', 'SELECT',
  'TABLE', 'DIALOG', 'TABS', 'MENU', 'SIDEBAR', 'AVATAR', 'BADGE',
  'PROGRESS', 'ICON', 'VIDEO', 'AUDIO',
  'NUMBER', 'BOOLEAN', 'OBJECT', 'ADDRESS', 'PUBKEY'
]);

// Style Properties & Layout values -> tags.propertyName (Light Blue #9cdcfe)
const STYLE_PROPERTIES = new Set([
  'WIDTH', 'HEIGHT', 'MIN_WIDTH', 'MAX_WIDTH', 'MIN_HEIGHT', 'MAX_HEIGHT',
  'BACKGROUND', 'COLOR', 'FONT_SIZE', 'FONT_WEIGHT', 'FONT_FAMILY', 'LINE_HEIGHT',
  'LETTER_SPACING', 'POSITION', 'Z_INDEX',
  'PADDING', 'MARGIN', 'GAP', 'BORDER', 'BORDER_WIDTH', 'BORDER_COLOR', 'RADIUS', 'BORDER_RADIUS',
  'OPACITY', 'SHADOW', 'ALIGN', 'JUSTIFY', 'DISPLAY', 'OVERFLOW', 'CURSOR',
  'FLEX', 'GRID', 'COLUMN', 'ROW', 'MOBILE', 'TABLET', 'DESKTOP', 'CENTER', 'START', 'BETWEEN', 'AROUND', 'EVENLY'
]);

// Event identifiers -> tags.special(tags.variableName) (Yellow #dcdcaa)
const EVENT_KEYWORDS = new Set([
  'CLICK', 'SUBMIT', 'CHANGE', 'LOAD', 'INPUT_EVENT', 'Ok', 'Err', 'Some', 'None'
]);

// Literal atoms -> tags.atom (Blue #569cd6)
const LITERAL_ATOMS = new Set([
  'true', 'false', 'TRUE', 'FALSE', 'null', 'NULL'
]);

interface ManifestTokenizerState {
  inBlockComment: boolean;
}

export const manifestStreamParser = {
  tokenTable: {
    lineComment: tags.lineComment,
    blockComment: tags.blockComment,
    string: tags.string,
    number: tags.number,
    operator: tags.operator,
    punctuation: tags.punctuation,
    controlKeyword: tags.controlKeyword,
    definitionKeyword: tags.definitionKeyword,
    keyword: tags.keyword,
    operatorKeyword: tags.operatorKeyword,
    typeName: tags.typeName,
    propertyName: tags.propertyName,
    eventIdentifier: tags.special(tags.variableName),
    atom: tags.atom,
    variableName: tags.variableName,
  },

  startState(): ManifestTokenizerState {
    return {
      inBlockComment: false,
    };
  },

  token(stream: StringStream, state: ManifestTokenizerState): string | null {
    // 0. Block comments /* ... */
    if (state.inBlockComment) {
      if (stream.match(/.*?\*\//)) {
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return 'blockComment';
    }

    // 1. Whitespace
    if (stream.eatSpace()) return null;

    if (stream.match('/*')) {
      if (!stream.match(/.*?\*\//)) {
        state.inBlockComment = true;
        stream.skipToEnd();
      }
      return 'blockComment';
    }

    // 2. Line Comments: -- , // , # , NOTE:
    if (
      stream.match('--') ||
      stream.match('//') ||
      (stream.peek() === '#' && !stream.match(/^#[0-9a-fA-F]{3,8}\b/, false)) ||
      stream.match(/NOTE:/i)
    ) {
      stream.skipToEnd();
      return 'lineComment';
    }

    // 3. String literals (double or single quotes)
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const next = stream.next();
        if (!next) break;
        if (next === ch && !escaped) {
          break;
        }
        escaped = !escaped && next === '\\';
      }
      return 'string';
    }

    // 4. Numbers (hex, integers, decimals, CSS units)
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) {
      return 'number';
    }
    if (stream.match(/^0x[0-9a-fA-F_]+\b/)) {
      return 'number';
    }
    if (stream.match(/^-?\d[0-9_]*(\.[0-9_]+)?(px|%|em|rem|vh|vw)?\b/)) {
      return 'number';
    }

    // 5. Multi-character & single-character operators (Professional & Beginner)
    if (
      stream.match(/^(\->|=>|::|&&|\|\||===|==|!==|!=|<=|>=|\+|-|\*|\/|%|<|>|=|!|\?)/)
    ) {
      return 'operator';
    }

    // 6. Delimiters, Braces, Punctuation & Colon
    if (stream.match(/^[:(),.[\]{};]/)) {
      return 'punctuation';
    }

    // 7. Standard library qualified call e.g. std::math::abs or console.print
    if (stream.match(/^std(::[a-zA-Z_][a-zA-Z0-9_]*)+/)) {
      return 'eventIdentifier';
    }

    // 8. Words / Identifiers
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_.]*/)) {
      const word = stream.current();
      const upper = word.toUpperCase();

      if (CONTROL_KEYWORDS.has(word) || (word === upper && CONTROL_KEYWORDS.has(upper))) {
        return 'controlKeyword';
      }

      if (DEFINITION_KEYWORDS.has(word) || (word === upper && DEFINITION_KEYWORDS.has(upper))) {
        return 'definitionKeyword';
      }

      if (TYPE_AND_PRIMITIVE_KEYWORDS.has(word) || (word === upper && TYPE_AND_PRIMITIVE_KEYWORDS.has(upper))) {
        return 'typeName';
      }

      if (word === upper && STATEMENT_KEYWORDS.has(upper)) {
        return 'keyword';
      }

      if (word === upper && OPERATOR_KEYWORDS.has(upper)) {
        return 'operatorKeyword';
      }

      if (word === upper && STYLE_PROPERTIES.has(upper)) {
        return 'propertyName';
      }

      if (EVENT_KEYWORDS.has(word) || (word === upper && EVENT_KEYWORDS.has(upper))) {
        return 'eventIdentifier';
      }

      if (LITERAL_ATOMS.has(word)) {
        return 'atom';
      }

      // Check if it's a stdlib / event call like console.print, fs.read, app.starts
      if (word.includes('.')) {
        return 'eventIdentifier';
      }

      // PascalCase identifier -> likely Struct or Enum type name
      if (/^[A-Z][a-zA-Z0-9_]*$/.test(word)) {
        return 'typeName';
      }

      // Look ahead for '(' to highlight function invocations
      if (stream.peek() === '(') {
        return 'eventIdentifier';
      }

      return 'variableName';
    }

    // Catch-all
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"', "'"] },
    indentOnInput: /^\s*(END|ELSE|WHEN|IF\s+FAILED|\})\s*$/,
  },
};

export const manifestLanguage = StreamLanguage.define(manifestStreamParser);

// Authentic VS Code Dark Modern Highlight Style for all 22 languages and Manifest
export const vsCodeDarkModernHighlightStyle = HighlightStyle.define([
  // Keywords & Control Flow
  { tag: tags.controlKeyword, color: '#c586c0', fontWeight: '600' }, // VS Code Purple (if, else, return, match, loop)
  { tag: tags.definitionKeyword, color: '#569cd6', fontWeight: '600' }, // VS Code Blue (fn, def, class, struct, let, const)
  { tag: tags.moduleKeyword, color: '#c586c0', fontWeight: '600' }, // VS Code Purple (import, export, use, from)
  { tag: tags.keyword, color: '#569cd6', fontWeight: '600' }, // VS Code Blue
  { tag: tags.operatorKeyword, color: '#569cd6', fontWeight: '500' }, // VS Code Blue (and, or, not, in)
  { tag: tags.modifier, color: '#569cd6', fontWeight: '600' }, // VS Code Blue (pub, mut, async, static)
  { tag: tags.self, color: '#569cd6', fontWeight: '600' }, // VS Code Blue (self, this)

  // Types & Classes
  { tag: tags.typeName, color: '#4ec9b0', fontWeight: '500' }, // VS Code Teal (u64, String, Pubkey, Number)
  { tag: tags.className, color: '#4ec9b0', fontWeight: '500' }, // VS Code Teal (Struct, Class, Interface)
  { tag: tags.standard(tags.typeName), color: '#4ec9b0' },

  // Functions & Methods
  { tag: tags.function(tags.variableName), color: '#dcdcaa', fontWeight: '500' }, // Warm Yellow (fn calls)
  { tag: tags.function(tags.propertyName), color: '#dcdcaa', fontWeight: '500' }, // Warm Yellow (method calls)
  { tag: tags.definition(tags.function(tags.variableName)), color: '#dcdcaa', fontWeight: '600' },
  { tag: tags.special(tags.variableName), color: '#dcdcaa', fontWeight: '500' }, // Warm Yellow

  // Variables & Properties
  { tag: tags.variableName, color: '#9cdcfe' }, // Light Sky Blue
  { tag: tags.definition(tags.variableName), color: '#9cdcfe' },
  { tag: tags.propertyName, color: '#9cdcfe' }, // Light Sky Blue (field names, attributes)

  // Literals: Strings & Numbers
  { tag: tags.string, color: '#ce9178' }, // Warm Peach ("string")
  { tag: tags.character, color: '#ce9178' },
  { tag: tags.special(tags.string), color: '#d7ba7d' }, // Escape chars
  { tag: tags.number, color: '#b5cea8' }, // Mint Green (123, 45.67)
  { tag: tags.integer, color: '#b5cea8' },
  { tag: tags.float, color: '#b5cea8' },
  { tag: tags.bool, color: '#569cd6', fontWeight: '600' }, // Blue (true, false)
  { tag: tags.atom, color: '#569cd6', fontWeight: '600' },
  { tag: tags.null, color: '#569cd6', fontWeight: '600' },

  // Comments
  { tag: tags.lineComment, color: '#6a9955', fontStyle: 'italic' }, // Comment Green
  { tag: tags.blockComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.docComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },

  // HTML / XML / JSX
  { tag: tags.tagName, color: '#569cd6', fontWeight: '600' }, // Tag names (div, span, button)
  { tag: tags.attributeName, color: '#9cdcfe' }, // Attributes (class, id, href)
  { tag: tags.attributeValue, color: '#ce9178' }, // Attribute values

  // Markdown & Docs
  { tag: tags.heading, color: '#569cd6', fontWeight: '700' },
  { tag: tags.link, color: '#3794ff', textDecoration: 'underline' },
  { tag: tags.url, color: '#3794ff' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },

  // Meta & Attributes (Rust macros, decorators)
  { tag: tags.meta, color: '#c586c0' }, // Rust #[derive(...)], declare_id!
  { tag: tags.macroName, color: '#569cd6', fontWeight: '600' },

  // Operators & Punctuation
  { tag: tags.operator, color: '#d4d4d4' },
  { tag: tags.punctuation, color: '#cccccc' },
  { tag: tags.bracket, color: '#ffd700' },
]);

export const manifestSyntaxHighlighting = syntaxHighlighting(vsCodeDarkModernHighlightStyle);

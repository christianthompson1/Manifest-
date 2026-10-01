/**
 * Manifest Autocomplete Engine for CodeMirror 6
 * Based on the actual Manifest Core language grammar and extensible registry.
 */

import { Completion, CompletionContext, CompletionResult, snippetCompletion } from '@codemirror/autocomplete';

export interface ManifestCompletionItem {
  label: string;
  type: 'keyword' | 'function' | 'variable' | 'class' | 'constant';
  detail?: string;
  info?: string;
  template?: string;
  boost?: number;
}

// Extensible completion registry for Manifest Core and future capabilities
class ManifestCompletionRegistry {
  private customCompletions: ManifestCompletionItem[] = [];

  public register(item: ManifestCompletionItem) {
    this.customCompletions.push(item);
  }

  public getCompletions(): ManifestCompletionItem[] {
    return [...this.customCompletions];
  }
}

export const completionRegistry = new ManifestCompletionRegistry();

// Core Language Keywords & Snippets
const CORE_COMPLETIONS: ManifestCompletionItem[] = [
  {
    label: 'APP',
    type: 'keyword',
    detail: 'APP "Name"',
    info: 'Declare the application program name.',
    template: 'APP "${1:MyProgram}"',
    boost: 90,
  },
  {
    label: 'SET',
    type: 'keyword',
    detail: 'SET variable TO value',
    info: 'Initialize or update a state variable.',
    template: 'SET ${1:variable} TO ${2:0}',
    boost: 85,
  },
  {
    label: 'TO',
    type: 'keyword',
    detail: 'Assignment keyword',
    info: 'Used in SET statements: SET variable TO value',
    boost: 80,
  },
  {
    label: 'SHOW',
    type: 'keyword',
    detail: 'SHOW expression',
    info: 'Outputs an expression to standard stream or UI.',
    template: 'SHOW ${1:"Hello World"}',
    boost: 85,
  },
  {
    label: 'WHEN app.starts',
    type: 'keyword',
    detail: 'WHEN app.starts ... END',
    info: 'Lifecycle event triggered automatically when the application starts.',
    template: 'WHEN app.starts\n    SHOW "${1:Hello Manifest}"\nEND',
    boost: 95,
  },
  {
    label: 'WHEN button.clicks',
    type: 'keyword',
    detail: 'WHEN button.clicks ... END',
    info: 'Interactive event handler for button click events.',
    template: 'WHEN ${1:button}.clicks\n    SET ${2:counter} TO ${2:counter} + 1\n    SHOW ${2:counter}\nEND',
    boost: 90,
  },
  {
    label: 'IF',
    type: 'keyword',
    detail: 'IF condition ... END',
    info: 'Conditional branch statement.',
    template: 'IF ${1:condition}\n    ${2:SHOW "True"}\nELSE\n    ${3:SHOW "False"}\nEND',
    boost: 85,
  },
  {
    label: 'ELSE',
    type: 'keyword',
    detail: 'ELSE branch',
    info: 'Alternative branch for IF statements.',
    boost: 75,
  },
  {
    label: 'END',
    type: 'keyword',
    detail: 'Block terminator',
    info: 'Closes an IF, WHEN, ACTION, REPEAT, or FOR block.',
    boost: 80,
  },
  {
    label: 'REPEAT',
    type: 'keyword',
    detail: 'REPEAT N TIMES ... END',
    info: 'Loop statement executing a fixed number of times.',
    template: 'REPEAT ${1:3} TIMES\n    ${2:SHOW "Step"}\nEND',
    boost: 80,
  },
  {
    label: 'TIMES',
    type: 'keyword',
    detail: 'REPEAT quantifier',
    info: 'Used with REPEAT: REPEAT 5 TIMES ... END',
    boost: 70,
  },
  {
    label: 'FOR EACH',
    type: 'keyword',
    detail: 'FOR EACH item IN list ... END',
    info: 'Iterates through each element in an array.',
    template: 'FOR EACH ${1:item} IN ${2:items}\n    SHOW ${1:item}\nEND',
    boost: 80,
  },
  {
    label: 'ACTION',
    type: 'function',
    detail: 'ACTION name param1 param2 ... END',
    info: 'Defines a reusable action (function).',
    template: 'ACTION ${1:name} ${2:param}\n    RETURN ${2:param}\nEND',
    boost: 85,
  },
  {
    label: 'RETURN',
    type: 'keyword',
    detail: 'RETURN value',
    info: 'Returns a value from an ACTION block.',
    template: 'RETURN ${1:result}',
    boost: 75,
  },
  {
    label: 'CALL',
    type: 'function',
    detail: 'CALL actionName arg1 arg2',
    info: 'Invokes a defined ACTION.',
    template: 'CALL ${1:actionName}',
    boost: 80,
  },
  {
    label: 'USE WEB',
    type: 'class',
    detail: 'USE WEB',
    info: 'Declares web application capability.',
    boost: 70,
  },
  {
    label: 'TRY',
    type: 'keyword',
    detail: 'TRY ... IF FAILED ... END',
    info: 'Guarded execution block catching runtime errors safely.',
    template: 'TRY\n    ${1:SHOW 10 / 2}\nIF FAILED\n    SHOW "Error handled safely"\nEND',
    boost: 75,
  },
  // Manifest v0.2 & v0.3 Application Primitives
  {
    label: 'PAGE',
    type: 'class',
    detail: 'PAGE Name ... END',
    info: 'Declare a page view container.',
    template: 'PAGE ${1:Home}\n    ${2:TEXT "Welcome"}\nEND',
    boost: 92,
  },
  {
    label: 'STATE',
    type: 'variable',
    detail: 'STATE variable: TYPE = value',
    info: 'Declare reactive application state.',
    template: 'STATE ${1:count}: NUMBER = ${2:0}',
    boost: 90,
  },
  {
    label: 'CONTAINER',
    type: 'class',
    detail: 'CONTAINER ... END',
    info: 'Defines a layout container for nested UI elements.',
    template: 'CONTAINER\n    ${1:TEXT "Container Content"}\nEND',
    boost: 88,
  },
  {
    label: 'COMPONENT',
    type: 'class',
    detail: 'COMPONENT Name [params...] ... END',
    info: 'Defines a reusable UI component.',
    template: 'COMPONENT ${1:Card} ${2:title}\n    CONTAINER\n        TEXT ${2:title}\n    END\nEND',
    boost: 87,
  },
  {
    label: 'STYLE',
    type: 'keyword',
    detail: 'STYLE ... END',
    info: 'Defines visual styling and layout properties.',
    template: 'STYLE\n    WIDTH ${1:100%}\n    PADDING ${2:16}\n    BACKGROUND "${3:#181818}"\nEND',
    boost: 86,
  },
  {
    label: 'TEXT',
    type: 'function',
    detail: 'TEXT expression',
    info: 'Renders reactive text content.',
    template: 'TEXT "${1:Hello Manifest}"',
    boost: 89,
  },
  {
    label: 'BUTTON',
    type: 'function',
    detail: 'BUTTON "Label" ... END',
    info: 'Renders an interactive button with click handling.',
    template: 'BUTTON "${1:Click Me}"\n    WHEN CLICK\n        ${2:SET count = count + 1}\n    END\nEND',
    boost: 89,
  },
  {
    label: 'INPUT',
    type: 'function',
    detail: 'INPUT "Placeholder" INTO variable',
    info: 'Renders an input field bound to a state variable.',
    template: 'INPUT "${1:Enter text...}" INTO ${2:variable}',
    boost: 87,
  },
  {
    label: 'LINK',
    type: 'function',
    detail: 'LINK "Label" TO "/path"',
    info: 'Renders a navigation link to another route.',
    template: 'LINK "${1:Home}" TO "${2:/}"',
    boost: 84,
  },
  {
    label: 'IMAGE',
    type: 'function',
    detail: 'IMAGE "src" ALT "alt"',
    info: 'Renders an image asset.',
    template: 'IMAGE "${1:https://example.com/logo.png}" ALT "${2:Logo}"',
    boost: 83,
  },
  {
    label: 'FORM',
    type: 'class',
    detail: 'FORM Name ... END',
    info: 'Groups inputs with form submit handling.',
    template: 'FORM ${1:ContactForm}\n    INPUT "${2:Your email}" INTO ${3:email}\n    BUTTON "Submit"\n    WHEN SUBMIT\n        ${4:SHOW "Submitted"}\n    END\nEND',
    boost: 85,
  },
  {
    label: 'ROUTE',
    type: 'keyword',
    detail: 'ROUTE "/path" TO Page',
    info: 'Map URL route path to designated page.',
    template: 'ROUTE "${1:/about}" TO ${2:About}',
    boost: 84,
  },
  // Types
  { label: 'NUMBER', type: 'type' as any, detail: 'Numeric primitive type', info: 'Represents 64-bit float/integer numbers.', boost: 88 },
  { label: 'TEXT', type: 'type' as any, detail: 'String primitive type', info: 'Represents unicode textual string data.', boost: 88 },
  { label: 'BOOLEAN', type: 'type' as any, detail: 'Boolean primitive type', info: 'Represents true or false.', boost: 88 },
  { label: 'LIST', type: 'type' as any, detail: 'List/array type', info: 'Ordered collection of elements.', boost: 88 },
  { label: 'OBJECT', type: 'type' as any, detail: 'Key-value map type', info: 'Dictionary object representation.', boost: 88 },

  // Manifest v0.4 UI Primitives
  {
    label: 'TABLE',
    type: 'keyword',
    detail: 'TABLE ... END',
    info: 'Structured tabular data presentation.',
    template: 'TABLE\n    ${1}\nEND',
    boost: 82,
  },
  {
    label: 'DIALOG',
    type: 'keyword',
    detail: 'DIALOG "Title" ... END',
    info: 'Accessible modal dialog overlay.',
    template: 'DIALOG "${1:Confirm Action}"\n    TEXT "${2:Are you sure?}"\n    BUTTON "Confirm"\nEND',
    boost: 82,
  },
  {
    label: 'TABS',
    type: 'keyword',
    detail: 'TABS ... END',
    info: 'Tabbed section navigation container.',
    template: 'TABS\n    ${1}\nEND',
    boost: 82,
  },
  {
    label: 'MENU',
    type: 'keyword',
    detail: 'MENU ... END',
    info: 'Dropdown or context menu container.',
    template: 'MENU\n    ${1}\nEND',
    boost: 80,
  },
  {
    label: 'SIDEBAR',
    type: 'keyword',
    detail: 'SIDEBAR ... END',
    info: 'Vertical drawer/sidebar panel layout.',
    template: 'SIDEBAR\n    ${1}\nEND',
    boost: 80,
  },
  {
    label: 'AVATAR',
    type: 'keyword',
    detail: 'AVATAR "url"',
    info: 'User profile image or initials badge.',
    template: 'AVATAR "${1:https://example.com/avatar.png}"',
    boost: 80,
  },
  {
    label: 'BADGE',
    type: 'keyword',
    detail: 'BADGE "Text"',
    info: 'Compact pill badge indicator.',
    template: 'BADGE "${1:Active}"',
    boost: 80,
  },
  {
    label: 'PROGRESS',
    type: 'keyword',
    detail: 'PROGRESS value',
    info: 'Progress bar indicator.',
    template: 'PROGRESS ${1:75}',
    boost: 80,
  },
  {
    label: 'ICON',
    type: 'keyword',
    detail: 'ICON "name"',
    info: 'Lucide SVG icon primitive without raw SVG.',
    template: 'ICON "${1:check}"',
    boost: 85,
  },

  // Library & Animation
  {
    label: 'USE LIBRARY',
    type: 'keyword',
    detail: 'USE LIBRARY "name"',
    info: 'Import high-level capability from library registry.',
    template: 'USE LIBRARY "${1:framer-motion}"',
    boost: 92,
  },
  {
    label: 'ANIMATE',
    type: 'keyword',
    detail: 'ANIMATE ... END',
    info: 'Declarative animation block using Framer Motion adapter.',
    template: 'ANIMATE\n    INITIAL SCALE 0.8\n    TO SCALE 1\n    DURATION 300\n    EASE "easeOut"\nEND',
    boost: 88,
  },

  // Solana First-Class Primitives
  {
    label: 'PROGRAM',
    type: 'class',
    detail: 'PROGRAM Name ... END',
    info: 'Declare a Solana on-chain smart contract program compiled to Anchor Rust.',
    template: 'PROGRAM ${1:Counter}\n    ACCOUNT ${1:Counter}State\n        count: NUMBER\n        authority: ADDRESS\n    END\n\n    INSTRUCTION increment\n        REQUIRE signer = authority\n        SET count = count + 1\n    END\nEND',
    boost: 95,
  },
  {
    label: 'ACCOUNT',
    type: 'class',
    detail: 'ACCOUNT Name ... END',
    info: 'Define Solana on-chain account data schema.',
    template: 'ACCOUNT ${1:State}\n    ${2:count}: NUMBER\nEND',
    boost: 90,
  },
  {
    label: 'INSTRUCTION',
    type: 'function',
    detail: 'INSTRUCTION name ... END',
    info: 'Declare a Solana program instruction endpoint.',
    template: 'INSTRUCTION ${1:execute}\n    REQUIRE signer = authority\n    ${2}\nEND',
    boost: 90,
  },
  {
    label: 'REQUIRE',
    type: 'keyword',
    detail: 'REQUIRE condition',
    info: 'On-chain Solana assertion constraint.',
    template: 'REQUIRE ${1:signer = authority}',
    boost: 90,
  },
  {
    label: 'CALL token.transfer',
    type: 'function',
    detail: 'CALL token.transfer ... END',
    info: 'Cross-Program Invocation (CPI) to SPL Token program.',
    template: 'CALL token.transfer\n    FROM ${1:source}\n    TO ${2:destination}\n    AMOUNT ${3:amount}\nEND',
    boost: 92,
  },

  // Escape Hatches
  {
    label: 'CSS',
    type: 'keyword',
    detail: 'CSS ... END',
    info: 'Raw CSS escape hatch for advanced stylesheets.',
    template: 'CSS\n    .${1:custom-class} {\n        ${2}\n    }\nEND',
    boost: 75,
  },
  {
    label: 'JS',
    type: 'keyword',
    detail: 'JS ... END',
    info: 'JavaScript escape hatch for third-party scripts.',
    template: 'JS\n    ${1:// Custom JavaScript logic}\nEND',
    boost: 75,
  },
  {
    label: 'RUST',
    type: 'keyword',
    detail: 'RUST ... END',
    info: 'Rust / Anchor escape hatch for custom Solana logic.',
    template: 'RUST\n    ${1:// Custom Anchor Rust code}\nEND',
    boost: 75,
  },
  {
    label: 'SERVER',
    type: 'class',
    detail: 'SERVER API ... END',
    info: 'Defines backend HTTP server endpoints.',
    template: 'SERVER ${1:API}\n    ENDPOINT "${2:/api/data}" METHOD GET\n        SHOW "OK"\n    END\nEND',
    boost: 70,
  },
];

/**
 * Extracts declared variables and actions from the current document
 * to provide context-aware completion.
 */
function extractDocumentScope(docText: string): ManifestCompletionItem[] {
  const items: ManifestCompletionItem[] = [];
  const seen = new Set<string>();

  // Extract variables: SET <varName> TO
  const varRegex = /SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+TO/gi;
  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(docText)) !== null) {
    const varName = match[1];
    if (!seen.has(varName)) {
      seen.add(varName);
      items.push({
        label: varName,
        type: 'variable',
        detail: 'Variable',
        info: `Defined in document via SET ${varName}`,
        boost: 60,
      });
    }
  }

  // Extract actions: ACTION <actionName> [params...]
  const actionRegex = /ACTION\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  while ((match = actionRegex.exec(docText)) !== null) {
    const actName = match[1];
    if (!seen.has(actName)) {
      seen.add(actName);
      items.push({
        label: actName,
        type: 'function',
        detail: 'Action',
        info: `User-defined action: CALL ${actName}`,
        boost: 65,
      });
    }
  }

  return items;
}

export function manifestAutocomplete(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[a-zA-Z_][a-zA-Z0-9_.]*/);
  if (!word && !context.explicit) {
    return null;
  }

  const docText = context.state.doc.toString();
  const scopeItems = extractDocumentScope(docText);
  const allItems = [...CORE_COMPLETIONS, ...completionRegistry.getCompletions(), ...scopeItems];

  const options: Completion[] = allItems.map((item) => {
    if (item.template) {
      return snippetCompletion(item.template, {
        label: item.label,
        type: item.type,
        detail: item.detail,
        info: item.info,
        boost: item.boost,
      });
    }
    return {
      label: item.label,
      type: item.type,
      detail: item.detail,
      info: item.info,
      boost: item.boost,
    };
  });

  return {
    from: word ? word.from : context.pos,
    options,
    validFor: /^[a-zA-Z0-9_.]*$/,
  };
}

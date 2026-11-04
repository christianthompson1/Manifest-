export type SyntaxProfile = 'beginner' | 'professional';

export interface ProfileMetadata {
  id: SyntaxProfile;
  name: string;
  summary: string;
  keywords: string[];
  filePragma: string;
}

export const SYNTAX_PROFILES: Record<SyntaxProfile, ProfileMetadata> = {
  beginner: {
    id: 'beginner',
    name: 'Beginner Profile',
    summary:
      'Structured, human-readable keyword block syntax (MODULE, REQUIRES, LET, MUTABLE, CONSTANT, FUNCTION ... END, IF ... END, STRUCT ... END).',
    keywords: [
      'MODULE', 'IMPORT', 'FROM', 'EXPORT', 'REQUIRES', 'PROVIDES', 'DENIES', 'EFFECTS',
      'CONSTANT', 'LET', 'MUTABLE', 'SET', 'TO', 'FUNCTION', 'ACTION', 'RETURN',
      'IF', 'ELSE', 'WHILE', 'FOR', 'EACH', 'IN', 'REPEAT', 'TIMES', 'BREAK', 'CONTINUE',
      'STRUCT', 'ENUM', 'TRAIT', 'MATCH', 'WHEN', 'TRY', 'SHOW', 'NEW', 'END',
      'AND', 'OR', 'NOT', 'TRUE', 'FALSE',
    ],
    filePragma: 'PROFILE beginner',
  },
  professional: {
    id: 'professional',
    name: 'Professional Profile',
    summary:
      'Conventional brace-and-type syntax (module, import, export, requires, denies, const, let, let mut, fn, struct, enum, match, if/while/for).',
    keywords: [
      'module', 'import', 'from', 'export', 'requires', 'provides', 'denies', 'effects',
      'const', 'let', 'mut', 'fn', 'async', 'await', 'return',
      'if', 'else', 'while', 'for', 'in', 'repeat', 'break', 'continue',
      'struct', 'enum', 'trait', 'match', 'try', 'catch', 'true', 'false',
    ],
    filePragma: 'profile professional;',
  },
};

/**
 * Detects whether a Manifest source file uses the Beginner or Professional syntax profile.
 * Explicit profile option wins unless omitted; file header pragma wins next; structural tokens follow.
 */
export function detectSyntaxProfile(
  source: string,
  explicitProfile?: SyntaxProfile | 'auto'
): SyntaxProfile {
  if (explicitProfile === 'beginner' || explicitProfile === 'professional') {
    return explicitProfile;
  }

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('--') || trimmed.startsWith('#')) {
      continue;
    }
    const pragmaMatch = trimmed.match(/^profile\s+(beginner|professional)\s*;?$/i);
    if (pragmaMatch) {
      return pragmaMatch[1].toLowerCase() as SyntaxProfile;
    }
    break;
  }

  // Strip comments and string literals before structural heuristic scan
  const stripped = source
    .replace(/\/\/.*$/gm, '')
    .replace(/--.*$/gm, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  // Unambiguous legacy/domain Beginner markers
  if (/^\s*(?:APP|PAGE|STATE|ACTION|COMPONENT|PROGRAM|USE\s+SOLANA|USE\s+WEB)\b/m.test(stripped)) {
    return 'beginner';
  }

  // Unambiguous Professional markers
  if (
    /^\s*(?:export\s+)?(?:async\s+)?fn\s+[a-zA-Z_]/m.test(stripped) ||
    /^\s*let\s+(?:mut\s+)?[a-zA-Z_]/m.test(stripped) ||
    /^\s*const\s+[a-zA-Z_]/m.test(stripped) ||
    /^\s*module\s+[a-zA-Z0-9_.]+\s*;/m.test(stripped) ||
    /^\s*(?:requires|provides|denies)\s*\[/m.test(stripped) ||
    /^\s*(?:export\s+)?struct\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:<[^>]+>)?\s*\{/m.test(stripped) ||
    /^\s*(?:export\s+)?enum\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:<[^>]+>)?\s*\{/m.test(stripped)
  ) {
    return 'professional';
  }

  return 'beginner';
}

/**
 * Maps Beginner and Professional primitive type aliases to the single canonical Manifest type name.
 */
export function normalizePrimitiveTypeName(raw: string): string {
  switch (raw) {
    case 'i64':
    case 'Int':
    case 'Integer':
    case 'INT':
      return 'i64';
    case 'f64':
    case 'Float':
    case 'Number':
    case 'NUMBER':
      return 'f64';
    case 'bool':
    case 'Bool':
    case 'Boolean':
    case 'BOOLEAN':
      return 'bool';
    case 'str':
    case 'Text':
    case 'String':
    case 'TEXT':
    case 'STRING':
      return 'str';
    case 'void':
    case 'Void':
    case 'Unit':
    case 'VOID':
      return 'void';
    case 'List':
    case 'LIST':
    case 'Array':
      return 'Array';
    case 'Map':
    case 'MAP':
    case 'Dict':
      return 'Map';
    default:
      return raw;
  }
}

/**
 * Returns true if the Manifest source file uses legacy/domain declarative UI (`APP`, `PAGE`,
 * `COMPONENT`, `STATE`, `STYLE`, `SERVER`, `ROUTE`) or Solana smart-contract (`PROGRAM`, `USE SOLANA`)
 * blocks rather than general-purpose Manifest v1.0 modules.
 */
export function isLegacyDomainManifestSource(source: string): boolean {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/--.*$/gm, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  // Explicit Professional or Beginner v1.0 module declarations
  if (/^\s*module\s+[a-zA-Z0-9_.]+\s*;/m.test(stripped)) {
    return false;
  }
  if (
    /^\s*(?:APP|PAGE|COMPONENT|PROGRAM|SERVER|ENDPOINT|ROUTE|STYLE|STATE|USE\s+SOLANA|USE\s+WEB)\b/im.test(
      stripped
    )
  ) {
    return true;
  }
  // Legacy UI widget statements at statement start without a v1.0 MODULE header
  if (
    !/^\s*MODULE\s+[a-zA-Z0-9_.]+/m.test(stripped) &&
    /^\s*(?:HEADING|BUTTON|INPUT|CONTAINER|CARD|NAV|MODAL|SAVE|LOAD|SEND|EMIT|ON\s+[A-Z_]+)\b/m.test(
      stripped
    )
  ) {
    return true;
  }
  return false;
}


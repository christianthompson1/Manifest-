import { SyntaxProfile } from '../core/profile.ts';

export interface V0MigrationOptions {
  targetProfile?: SyntaxProfile;
}

export interface V0MigrationResult {
  migratedSource: string;
  targetProfile: SyntaxProfile;
  targetHint: 'mvm' | 'web-js' | 'solana-sbf';
  changes: string[];
  warnings: string[];
}

function sanitizeModuleName(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'migrated_app'
  );
}

/**
 * Explicit opt-in migration helper translating obsolete Manifest v0.x syntax constructs
 * (`APP`, `STATE`, `ACTION`, `DEFINE`, `WHEN app.starts`, `USE SOLANA`, `USE WEB`)
 * into canonical Manifest v1.0 (`MODULE` / `module ...;`) or standalone Solana (`PROGRAM`).
 *
 * NOTE: This helper is NEVER invoked automatically by compilation, linting, or runtime execution.
 * It must be invoked explicitly via `manifest migrate <file>` or the Studio migration action.
 */
export function migrateV0ToV1(
  source: string,
  options: V0MigrationOptions = {}
): V0MigrationResult {
  const targetProfile: SyntaxProfile = options.targetProfile || 'beginner';
  const lines = source.split(/\r?\n/);
  const changes: string[] = [];
  const warnings: string[] = [];

  const hasSolanaProgram = /^\s*PROGRAM\s+[A-Za-z_]/m.test(source);
  if (hasSolanaProgram) {
    const kept: string[] = [];
    let removedLegacyWrapper = false;
    for (const line of lines) {
      const t = line.trim();
      if (/^APP\s+/i.test(t) || /^USE\s+SOLANA\b/i.test(t)) {
        removedLegacyWrapper = true;
        changes.push(`Removed legacy v0.x wrapper '${t}'`);
        continue;
      }
      kept.push(line);
    }
    if (!removedLegacyWrapper) {
      warnings.push('File already contains a standalone PROGRAM block without APP/USE SOLANA wrappers.');
    }
    return {
      migratedSource: kept.join('\n').trim() + '\n',
      targetProfile: 'beginner',
      targetHint: 'solana-sbf',
      changes,
      warnings,
    };
  }

  let moduleName = 'migrated_app';
  let hasWebUi = false;
  const requiresCaps = new Set<string>();
  const bodyLines: string[] = [];
  let inLegacyUiBlockDepth = 0;

  const uiBlockOpeners = /^(PAGE|COMPONENT|CONTAINER|CARD|NAV|NAVBAR|HEADER|FOOTER|MODAL|STYLE|CSS|JS|FORM|TABLE|SERVER|ENDPOINT)\b/;
  const oneLineUiWidgets = /^(HEADING|TEXT|BUTTON|INPUT|IMAGE|PROGRESS|BADGE|ICON|SELECT|CHECKBOX|TEXTAREA|OPTION|ROUTE)\b/;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (inLegacyUiBlockDepth > 0) {
      if (uiBlockOpeners.test(trimmed) || /^(IF|WHILE|FOR|REPEAT|FUNCTION|WHEN)\b/.test(trimmed)) {
        inLegacyUiBlockDepth++;
      } else if (trimmed === 'END') {
        inLegacyUiBlockDepth--;
      }
      continue;
    }

    const appMatch = trimmed.match(/^APP\s+"([^"]+)"$/);
    if (appMatch) {
      moduleName = sanitizeModuleName(appMatch[1]);
      changes.push(`Replaced 'APP "${appMatch[1]}"' with canonical module '${moduleName}'`);
      continue;
    }

    if (/^USE\s+WEB\b/i.test(trimmed)) {
      hasWebUi = true;
      changes.push("Removed 'USE WEB' (use 'REQUIRES [dom]' or web-js target instead)");
      requiresCaps.add('console');
      continue;
    }

    const useMatch = trimmed.match(/^USE\s+([A-Za-z0-9_.]+)$/);
    if (useMatch) {
      const cap = useMatch[1].toLowerCase();
      if (cap !== 'solana') {
        requiresCaps.add(cap);
        changes.push(`Converted 'USE ${useMatch[1]}' -> 'REQUIRES ${cap}'`);
      }
      continue;
    }

    if (uiBlockOpeners.test(trimmed)) {
      hasWebUi = true;
      inLegacyUiBlockDepth = 1;
      warnings.push(
        `Removed declarative v0.x UI block '${trimmed}'; rewrite DOM rendering using canonical v1 functions returning/printing HTML or web-js exports.`
      );
      continue;
    }

    if (oneLineUiWidgets.test(trimmed)) {
      hasWebUi = true;
      warnings.push(`Removed legacy UI widget statement '${trimmed}'; use explicit DOM/HTML builders instead.`);
      continue;
    }

    if (/^WHEN\s+app\.starts$/i.test(trimmed)) {
      changes.push("Converted 'WHEN app.starts ... END' -> 'FUNCTION main() -> Void EFFECTS console ... END'");
      bodyLines.push('FUNCTION main() -> Void EFFECTS console');
      continue;
    }

    if (/^WHEN\s+(?:CLICK|SUBMIT|CHANGE)\b/i.test(trimmed)) {
      hasWebUi = true;
      inLegacyUiBlockDepth = 1;
      warnings.push(`Removed legacy UI event hook '${trimmed}'.`);
      continue;
    }

    const stateMatch = rawLine.match(/^(\s*)STATE\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|TO)\s*(.+)$/);
    if (stateMatch) {
      changes.push(`Converted 'STATE ${stateMatch[2]}' -> 'LET MUTABLE ${stateMatch[2]}'`);
      bodyLines.push(`${stateMatch[1]}LET MUTABLE ${stateMatch[2]} = ${stateMatch[3]}`);
      continue;
    }

    const defineMatch = rawLine.match(/^(\s*)(?:DEFINE(?:\s+FUNCTION)?|ACTION)\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
    if (defineMatch) {
      const indent = defineMatch[1];
      const fnName = defineMatch[2];
      const rest = defineMatch[3].trim();
      if (rest.startsWith('(')) {
        bodyLines.push(`${indent}FUNCTION ${fnName}${rest}`);
      } else if (rest) {
        const params = rest.split(/\s+/).filter(Boolean).join(': Any, ');
        bodyLines.push(`${indent}FUNCTION ${fnName}(${params ? `${params}: Any` : ''})`);
      } else {
        bodyLines.push(`${indent}FUNCTION ${fnName}()`);
      }
      changes.push(`Converted legacy '${fnName}' routine header -> 'FUNCTION ${fnName}(...)'`);
      continue;
    }

    if (/^\s*SHOW\b/.test(rawLine)) {
      requiresCaps.add('console');
    }

    bodyLines.push(rawLine);
  }

  const outLines: string[] = [];
  if (targetProfile === 'professional') {
    outLines.push(`module ${moduleName};`);
    if (requiresCaps.size > 0) {
      outLines.push(`requires [${Array.from(requiresCaps).join(', ')}];`);
    }
    warnings.push(
      'Review generated Beginner statements (LET MUTABLE / FUNCTION ... END / SHOW) or format via rust/formatter if targeting full Professional brace syntax.'
    );
  } else {
    outLines.push(`MODULE ${moduleName}`);
    if (requiresCaps.size > 0) {
      outLines.push(`REQUIRES ${Array.from(requiresCaps).join(', ')}`);
    }
  }
  outLines.push('');
  outLines.push(...bodyLines);

  const migratedSource = outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return {
    migratedSource,
    targetProfile,
    targetHint: hasWebUi ? 'web-js' : 'mvm',
    changes,
    warnings,
  };
}

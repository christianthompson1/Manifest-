/**
 * Manifest Language Intelligence & Diagnostics for CodeMirror 6
 * Bridges Manifest v1.0 Dual-Profile TypeChecker & Capability Analyzer (Beginner & Professional)
 * AND Legacy Domain Validator (APP / PAGE / PROGRAM) directly into real-time CodeMirror 6 diagnostics.
 */

import { Diagnostic, linter } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import {
  inspectManifest,
  ManifestError,
  isLegacyDomainManifestSource,
  checkManifestSource,
} from '../../../manifest-core/src/index.ts';

function getLineOffsets(view: EditorView, lineNum: number, colNum?: number): { from: number; to: number } {
  const doc = view.state.doc;
  const safeLineNum = Math.min(Math.max(1, lineNum), doc.lines);
  const line = doc.line(safeLineNum);

  let from = line.from;
  if (colNum && colNum > 1 && colNum <= line.length + 1) {
    from = Math.min(line.from + colNum - 1, line.to);
  }

  // Highlight identifier token at column or rest of line
  const rest = line.text.slice(Math.max(0, from - line.from));
  const tokenMatch = rest.match(/^[a-zA-Z0-9_.:]+/);
  let to = tokenMatch ? from + tokenMatch[0].length : Math.min(from + 8, line.to);
  if (to <= from) {
    to = line.to > line.from ? line.to : Math.min(from + 1, doc.length);
  }

  return { from, to };
}

export function collectManifestEditorDiagnostics(view: EditorView): Diagnostic[] {
  const source = view.state.doc.toString();
  if (!source.trim()) return [];

  const diagnostics: Diagnostic[] = [];

  // 1. General-purpose v1.0 Beginner & Professional modules -> Lex + Parse + Static TypeCheck + Capability/Effect Check
  if (!isLegacyDomainManifestSource(source)) {
    const checkRes = checkManifestSource(source);
    for (const d of checkRes.diagnostics) {
      const { from, to } = getLineOffsets(view, d.line || 1, d.column || 1);
      let msg = d.code ? `[${d.code}] ${d.message}` : d.message;
      if (d.hint) {
        msg += `\nHint: ${d.hint}`;
      }
      diagnostics.push({
        from,
        to,
        severity: d.severity === 'warning' ? 'warning' : d.severity === 'info' ? 'info' : 'error',
        source: d.code || 'manifest-v1',
        message: msg,
      });
    }
    return diagnostics;
  }

  // 2. Legacy Declarative UI (APP / PAGE) & Solana Contract (PROGRAM) modules
  try {
    const inspection = inspectManifest(source);

    // Surface lexer/parser syntax diagnostics captured inside inspectManifest()
    if (Array.isArray(inspection.diagnostics) && inspection.diagnostics.length > 0) {
      for (const synDiag of inspection.diagnostics) {
        const { from, to } = getLineOffsets(view, synDiag.line || 1, synDiag.column || 1);
        let msg = synDiag.message;
        if (synDiag.hint) {
          msg += `\nHint: ${synDiag.hint}`;
        }
        diagnostics.push({
          from,
          to,
          severity: synDiag.severity === 'warning' ? 'warning' : 'error',
          source: synDiag.phase || 'parser',
          message: msg,
        });
      }
    }

    // Surface two-pass semantic validation issues
    if (inspection.validation && inspection.validation.issues.length > 0) {
      for (const issue of inspection.validation.issues) {
        const { from, to } = getLineOffsets(view, issue.line || 1, issue.column || 1);
        let msg = issue.message;
        if (issue.hint) {
          msg += `\nHint: ${issue.hint}`;
        }

        const actions = issue.example
          ? [
              {
                name: 'View Example',
                apply: () => {
                  console.info('Suggested Manifest Pattern:\n', issue.example);
                },
              },
            ]
          : undefined;

        diagnostics.push({
          from,
          to,
          severity: issue.severity === 'warning' ? 'warning' : 'error',
          source: 'validator',
          message: msg,
          actions,
        });
      }
    }
  } catch (err: any) {
    if (err instanceof ManifestError) {
      const { from, to } = getLineOffsets(view, err.line || 1, err.column || 1);
      let msg = err.message;
      if (err.hint) {
        msg += `\nHint: ${err.hint}`;
      }
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: msg,
      });
    } else {
      diagnostics.push({
        from: 0,
        to: Math.min(view.state.doc.length, 10),
        severity: 'error',
        message: String(err.message || err),
      });
    }
  }

  return diagnostics;
}

export const manifestLinter = linter(
  (view: EditorView): Diagnostic[] => collectManifestEditorDiagnostics(view),
  { delay: 220 }
);

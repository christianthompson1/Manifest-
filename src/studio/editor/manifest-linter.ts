/**
 * Manifest Language Intelligence & Diagnostics for CodeMirror 6
 * Bridges the authoritative Manifest v1.0 Rust Compiler Engine (Beginner & Professional)
 * and standalone Solana Contract (`PROGRAM`) parser into real-time CodeMirror 6 diagnostics.
 */

import { Diagnostic, linter } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import {
  checkManifestSource,
  isSolanaProgramSource,
  parseSolanaProgramSource,
} from '../../../manifest-core/src/index.ts';

function getLineOffsets(view: EditorView, lineNum: number, colNum?: number): { from: number; to: number } {
  const doc = view.state.doc;
  const safeLineNum = Math.min(Math.max(1, lineNum), doc.lines);
  const line = doc.line(safeLineNum);

  let from = line.from;
  if (colNum && colNum > 1 && colNum <= line.length + 1) {
    from = Math.min(line.from + colNum - 1, line.to);
  }

  const rest = line.text.slice(Math.max(0, from - line.from));
  const tokenMatch = rest.match(/^[a-zA-Z0-9_.:]+/);
  let to = tokenMatch ? from + tokenMatch[0].length : Math.min(from + 8, line.to);
  if (to <= from) {
    to = line.to > line.from ? line.to : Math.min(from + 1, doc.length);
  }

  return { from, to };
}

export async function collectManifestEditorDiagnostics(view: EditorView): Promise<Diagnostic[]> {
  const source = view.state.doc.toString();
  if (!source.trim()) return [];

  const diagnostics: Diagnostic[] = [];

  if (isSolanaProgramSource(source)) {
    const parsedSol = parseSolanaProgramSource(source);
    for (const d of parsedSol.diagnostics) {
      const { from, to } = getLineOffsets(view, d.line || 1, d.column || 1);
      let msg = d.code ? `[${d.code}] ${d.message}` : d.message;
      if (d.hint) msg += `\nHint: ${d.hint}`;
      diagnostics.push({
        from,
        to,
        severity: d.severity === 'warning' ? 'warning' : d.severity === 'info' ? 'info' : 'error',
        source: d.code || 'solana-program',
        message: msg,
      });
    }
    return diagnostics;
  }

  const checkRes = await checkManifestSource(source);
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

export const manifestLinter = linter(
  (view: EditorView): Promise<Diagnostic[]> => collectManifestEditorDiagnostics(view),
  { delay: 220 }
);

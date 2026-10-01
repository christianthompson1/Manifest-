/**
 * Manifest Language Intelligence & Diagnostics for CodeMirror 6
 * Bridges Manifest Lexer, Parser, and Validator directly into CodeMirror 6 linter diagnostics.
 */

import { Diagnostic, linter } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { inspectManifest, ManifestError } from '../../../manifest-core/src/index.ts';

/**
 * Computes CodeMirror character range from 1-indexed line and column numbers.
 */
function getLineOffsets(view: EditorView, lineNum: number, colNum?: number): { from: number; to: number } {
  const doc = view.state.doc;
  const safeLineNum = Math.min(Math.max(1, lineNum), doc.lines);
  const line = doc.line(safeLineNum);

  let from = line.from;
  if (colNum && colNum > 1 && colNum <= line.length + 1) {
    from = Math.min(line.from + colNum - 1, line.to);
  }

  // Highlight word or rest of line
  let to = Math.min(from + 6, line.to);
  if (to <= from) {
    to = line.to > line.from ? line.to : from + 1;
  }

  return { from, to };
}

export const manifestLinter = linter((view: EditorView): Diagnostic[] => {
  const source = view.state.doc.toString();
  if (!source.trim()) return [];

  const diagnostics: Diagnostic[] = [];

  try {
    const inspection = inspectManifest(source);

    // 1. Validator semantic issues
    if (inspection.validation && !inspection.validation.isValid) {
      for (const issue of inspection.validation.issues) {
        const { from, to } = getLineOffsets(view, issue.line || 1, issue.column || 1);
        let msg = issue.message;
        if (issue.hint) {
          msg += `\n💡 Hint: ${issue.hint}`;
        }

        const actions = issue.example
          ? [
              {
                name: 'View Example',
                apply: (editorView: EditorView) => {
                  console.info('Suggested Manifest Pattern:\n', issue.example);
                },
              },
            ]
          : undefined;

        diagnostics.push({
          from,
          to,
          severity: issue.severity === 'warning' ? 'warning' : 'error',
          message: msg,
          actions,
        });
      }
    }
  } catch (err: any) {
    // 2. Lexer or Parser Syntax Errors
    if (err instanceof ManifestError) {
      const { from, to } = getLineOffsets(view, err.line || 1, err.column || 1);
      let msg = err.message;
      if (err.hint) {
        msg += `\n💡 Hint: ${err.hint}`;
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
}, { delay: 250 });

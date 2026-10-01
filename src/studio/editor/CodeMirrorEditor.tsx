/**
 * Manifest Studio - CodeMirror 6 Editor Component
 * Professional developer editor engine with syntax highlighting, diagnostics,
 * autocomplete, active line, bracket matching, search, and touch controls.
 */

import React, { useRef, useEffect } from 'react';
import { EditorState, Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  drawSelection,
  dropCursor,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

import { getLanguageExtensions } from './language-support.ts';
import { FileLanguage } from '../types.ts';

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: FileLanguage;
  readOnly?: boolean;
  onRun?: () => void;
  onSave?: () => void;
  onCursorChange?: (line: number, col: number) => void;
}

// VS Code Dark Modern Theme (#1f1f1f charcoal background, high contrast syntax)
const vsCodeDarkModernTheme = EditorView.theme(
  {
    '&': {
      color: '#d4d4d4',
      backgroundColor: '#1f1f1f',
      fontSize: '13px',
      fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
      height: '100%',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      lineHeight: '1.65',
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: '#aeafad',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#569cd6',
      borderLeftWidth: '2px',
    },
    '.cm-gutters': {
      backgroundColor: '#1f1f1f',
      color: '#858585',
      borderRight: '1px solid #2d2d2d',
      paddingRight: '8px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      paddingLeft: '14px',
      paddingRight: '10px',
      minWidth: '34px',
      textAlign: 'right',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      color: '#c6c6c6',
      fontWeight: '600',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: '#264f78 !important',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#0e3a59',
      color: '#ffffff !important',
      outline: '1px solid #007acc',
    },
    // Authentic VS Code Dark Modern Syntax Tokens
    '.cm-keyword': { color: '#c586c0', fontWeight: '600' }, // VS Code control/keyword purple
    '.cm-controlKeyword': { color: '#c586c0', fontWeight: '600' }, // VS Code control purple (IF, WHEN, END, REPEAT)
    '.cm-definitionKeyword': { color: '#569cd6', fontWeight: '600' }, // VS Code keyword blue (ACTION, APP)
    '.cm-operatorKeyword': { color: '#569cd6', fontWeight: '600' }, // VS Code keyword blue (AND, OR, NOT, TO)
    '.cm-string': { color: '#ce9178' }, // VS Code warm peach for strings
    '.cm-number': { color: '#b5cea8' }, // VS Code mint green for numbers
    '.cm-operator': { color: '#d4d4d4' }, // VS Code light grey for operators
    '.cm-lineComment': { color: '#6a9955', fontStyle: 'italic' }, // VS Code green comments
    '.cm-atom': { color: '#569cd6' }, // VS Code blue for booleans
    '.cm-variableName': { color: '#9cdcfe' }, // VS Code light sky-blue for identifiers
    '.cm-special\\(variableName\\)': { color: '#dcdcaa', fontWeight: '500' }, // VS Code yellow for app.starts / button.clicks
    // Diagnostic Tooltip & Markers (VS Code Dark Modern styling)
    '.cm-tooltip': {
      backgroundColor: '#252526',
      border: '1px solid #2d2d2d',
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
      color: '#cccccc',
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: '#04395e',
        color: '#ffffff',
      },
    },
    '.cm-diagnostic': {
      padding: '6px 10px',
      fontSize: '12px',
      lineHeight: '1.4',
    },
    '.cm-diagnostic-error': {
      borderLeft: '3px solid #f14c4c',
      backgroundColor: '#2d1818',
    },
    '.cm-diagnostic-warning': {
      borderLeft: '3px solid #cca700',
      backgroundColor: '#2d2518',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      borderBottom: '2px dotted #f14c4c',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      borderBottom: '2px dotted #cca700',
    },
  },
  { dark: true }
);

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  value,
  onChange,
  language = 'manifest',
  readOnly = false,
  onRun,
  onSave,
  onCursorChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Keep latest callbacks in refs to prevent unnecessary re-creations
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  useEffect(() => {
    if (!containerRef.current) return;

    // Custom keyboard shortcuts
    const customKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onRunRef.current?.();
          return true;
        },
      },
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      indentWithTab,
    ]);

    // Build extension stack
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
      customKeymap,
      vsCodeDarkModernTheme,
      ...getLanguageExtensions(language, readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const docStr = update.state.doc.toString();
          onChangeRef.current(docStr);
        }
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          onCursorChangeRef.current?.(line.number, pos - line.from + 1);
        }
      }),
    ];

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [language, readOnly]);

  // Synchronize document value when changed externally (e.g. file switched or reset)
  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      const currentDoc = view.state.doc.toString();
      if (value !== currentDoc) {
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: value },
        });
      }
    }
  }, [value]);

  return (
    <div className="w-full h-full flex flex-col bg-[#1f1f1f] overflow-hidden select-text">
      <div ref={containerRef} className="flex-1 w-full h-full overflow-hidden" />
    </div>
  );
};

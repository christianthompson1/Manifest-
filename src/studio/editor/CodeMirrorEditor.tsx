/**
 * Manifest Studio - CodeMirror 6 Editor Component
 * Professional developer editor engine with syntax highlighting, diagnostics,
 * autocomplete, active line, bracket matching, search, and touch controls.
 */

import React, { useRef, useEffect } from 'react';
import { EditorState, Extension, Compartment } from '@codemirror/state';
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
import { completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

import { getLanguageExtensions } from './language-support.ts';
import { FileLanguage } from '../types.ts';

interface CodeMirrorEditorProps {
  fileId?: string;
  value: string;
  onChange: (value: string) => void;
  language?: FileLanguage;
  readOnly?: boolean;
  isBinary?: boolean;
  mimeType?: string;
  fontSize?: number;
  wordWrap?: boolean;
  onRun?: () => void;
  onSave?: () => void;
  onCursorChange?: (line: number, col: number) => void;
}

// Per-file EditorState cache preserving undo/redo history and cursor/selection across tab switches
const MAX_CACHED_EDITOR_STATES = 64;
const editorStateCache = new Map<string, EditorState>();

function setCachedEditorState(key: string, state: EditorState) {
  if (!key) return;
  if (editorStateCache.has(key)) {
    editorStateCache.delete(key);
  } else if (editorStateCache.size >= MAX_CACHED_EDITOR_STATES) {
    const oldestKey = editorStateCache.keys().next().value;
    if (oldestKey) editorStateCache.delete(oldestKey);
  }
  editorStateCache.set(key, state);
}

export function evictCachedEditorState(prefixOrKey: string) {
  for (const k of Array.from(editorStateCache.keys())) {
    if (k === prefixOrKey || k.startsWith(prefixOrKey)) {
      editorStateCache.delete(k);
    }
  }
}

// VS Code Dark Modern Theme (#1f1f1f charcoal background, high contrast syntax)
const vsCodeDarkModernTheme = EditorView.theme(
  {
    '&': {
      color: '#d4d4d4',
      backgroundColor: '#1f1f1f',
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
    '.cm-keyword': { color: '#c586c0', fontWeight: '600' },
    '.cm-controlKeyword': { color: '#c586c0', fontWeight: '600' },
    '.cm-definitionKeyword': { color: '#569cd6', fontWeight: '600' },
    '.cm-operatorKeyword': { color: '#569cd6', fontWeight: '600' },
    '.cm-string': { color: '#ce9178' },
    '.cm-number': { color: '#b5cea8' },
    '.cm-operator': { color: '#d4d4d4' },
    '.cm-lineComment': { color: '#6a9955', fontStyle: 'italic' },
    '.cm-atom': { color: '#569cd6' },
    '.cm-variableName': { color: '#9cdcfe' },
    '.cm-special\\(variableName\\)': { color: '#dcdcaa', fontWeight: '500' },
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

function buildFontSizeTheme(fontSize: number): Extension {
  const clamped = Math.max(10, Math.min(24, fontSize || 13));
  return EditorView.theme({
    '&': { fontSize: `${clamped}px` },
  });
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  fileId = 'default-buffer',
  value,
  onChange,
  language = 'manifest',
  readOnly = false,
  isBinary = false,
  mimeType,
  fontSize = 13,
  wordWrap = false,
  onRun,
  onSave,
  onCursorChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeFileIdRef = useRef<string>(fileId);

  // Compartments allow dynamic reconfiguration without resetting cursor or undo history
  const languageCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const wordWrapCompartmentRef = useRef(new Compartment());
  const fontSizeCompartmentRef = useRef(new Compartment());

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  const lastEmittedValueRef = useRef<string>((value || '').replace(/\r\n/g, '\n'));

  const createFreshState = (docText: string, lang: FileLanguage, ro: boolean, wrap: boolean, size: number) => {
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
      fontSizeCompartmentRef.current.of(buildFontSizeTheme(size)),
      wordWrapCompartmentRef.current.of(wrap ? EditorView.lineWrapping : []),
      readOnlyCompartmentRef.current.of(EditorState.readOnly.of(ro)),
      languageCompartmentRef.current.of(getLanguageExtensions(lang, ro)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const docStr = update.state.doc.toString();
          lastEmittedValueRef.current = docStr;
          onChangeRef.current(docStr);
        }
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          onCursorChangeRef.current?.(line.number, pos - line.from + 1);
        }
      }),
    ];

    return EditorState.create({
      doc: (docText || '').replace(/\r\n/g, '\n'),
      extensions,
    });
  };

  // Mount single persistent EditorView for non-binary buffers
  useEffect(() => {
    if (isBinary || !containerRef.current) return;

    const normalized = (value || '').replace(/\r\n/g, '\n');
    const cached = editorStateCache.get(fileId);
    let initialState =
      cached && cached.doc.toString() === normalized
        ? cached
        : createFreshState(normalized, language, readOnly, wordWrap, fontSize);

    const view = new EditorView({
      state: initialState,
      parent: containerRef.current,
    });

    // Ensure cached state reflects latest fontSize/wordWrap/readOnly/language settings
    if (cached && cached.doc.toString() === normalized) {
      view.dispatch({
        effects: [
          fontSizeCompartmentRef.current.reconfigure(buildFontSizeTheme(fontSize)),
          wordWrapCompartmentRef.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
          readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
          languageCompartmentRef.current.reconfigure(getLanguageExtensions(language, readOnly)),
        ],
      });
    }

    viewRef.current = view;
    activeFileIdRef.current = fileId;
    lastEmittedValueRef.current = view.state.doc.toString();

    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    onCursorChangeRef.current?.(line.number, pos - line.from + 1);

    return () => {
      if (viewRef.current) {
        setCachedEditorState(activeFileIdRef.current, viewRef.current.state);
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [isBinary]);

  // Swap EditorState when switching between open file tabs without destroying EditorView
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isBinary) return;
    if (activeFileIdRef.current === fileId) return;

    // Save outgoing tab state (cursor, selection, undo history)
    setCachedEditorState(activeFileIdRef.current, view.state);
    activeFileIdRef.current = fileId;

    const normalized = (value || '').replace(/\r\n/g, '\n');
    const cached = editorStateCache.get(fileId);
    const nextState =
      cached && cached.doc.toString() === normalized
        ? cached
        : createFreshState(normalized, language, readOnly, wordWrap, fontSize);

    lastEmittedValueRef.current = normalized;
    view.setState(nextState);

    // Sync compartments on restored cached state
    view.dispatch({
      effects: [
        fontSizeCompartmentRef.current.reconfigure(buildFontSizeTheme(fontSize)),
        wordWrapCompartmentRef.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
        readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
        languageCompartmentRef.current.reconfigure(getLanguageExtensions(language, readOnly)),
      ],
    });

    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    onCursorChangeRef.current?.(line.number, pos - line.from + 1);
  }, [fileId, isBinary]);

  // Reconfigure language & readOnly dynamically without resetting cursor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isBinary) return;
    view.dispatch({
      effects: [
        readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
        languageCompartmentRef.current.reconfigure(getLanguageExtensions(language, readOnly)),
      ],
    });
  }, [language, readOnly, isBinary]);

  // Reconfigure fontSize & wordWrap dynamically without resetting cursor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isBinary) return;
    view.dispatch({
      effects: [
        fontSizeCompartmentRef.current.reconfigure(buildFontSizeTheme(fontSize)),
        wordWrapCompartmentRef.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
      ],
    });
  }, [fontSize, wordWrap, isBinary]);

  // Synchronize document value only when changed externally (e.g. template reset or external import)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isBinary) return;

    // Never interrupt active IME composition (CJK / mobile predictive input)
    if (view.composing) return;

    const normalizedValue = (value || '').replace(/\r\n/g, '\n');
    if (normalizedValue === lastEmittedValueRef.current) {
      return;
    }

    const currentDoc = view.state.doc.toString();
    if (normalizedValue !== currentDoc) {
      const currentSelection = view.state.selection;
      const safeAnchor = Math.min(currentSelection.main.anchor, normalizedValue.length);
      const safeHead = Math.min(currentSelection.main.head, normalizedValue.length);

      lastEmittedValueRef.current = normalizedValue;
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: normalizedValue },
        selection: { anchor: safeAnchor, head: safeHead },
        scrollIntoView: false,
      });
    }
  }, [value, isBinary]);

  if (isBinary) {
    const isImage = mimeType?.startsWith('image/') && value.startsWith('data:image/');
    const isWasm = language === 'wasm' || mimeType === 'application/wasm';
    const approxBytes = value.startsWith('data:')
      ? Math.floor(((value.split(',')[1] || '').length * 3) / 4)
      : value.length;

    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#1f1f1f] text-[#cccccc] p-6 select-text">
        <div className="max-w-md w-full bg-[#181818] border border-[#2d2d2d] rounded-xl p-5 space-y-3 text-center">
          <div className="text-xs font-semibold text-[#ffffff]">
            {isWasm ? 'Compiled WebAssembly Binary (.wasm)' : 'Binary Workspace Asset'}
          </div>
          <div className="text-[11px] text-[#858585] font-mono">
            MIME: {mimeType || 'application/octet-stream'} &bull; Size: ~{approxBytes.toLocaleString()} bytes
          </div>
          {isImage && (
            <div className="p-3 bg-[#1f1f1f] border border-[#2d2d2d] rounded-lg flex items-center justify-center">
              <img src={value} alt="Binary asset preview" className="max-h-48 max-w-full object-contain" />
            </div>
          )}
          <p className="text-[11px] text-[#858585]">
            {isWasm
              ? 'Binary bytecode is protected from accidental text corruption. Click Run to instantiate and execute this WebAssembly module in the Preview panel.'
              : 'Binary asset is preserved losslessly in IndexedDB and ZIP exports.'}
          </p>
          {isWasm && onRun && (
            <button
              onClick={onRun}
              className="px-3 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-medium transition cursor-pointer"
            >
              Execute .wasm Module
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#1f1f1f] overflow-hidden select-text">
      <div ref={containerRef} className="flex-1 w-full h-full overflow-hidden" />
    </div>
  );
};

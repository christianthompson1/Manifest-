import { Extension } from '@codemirror/state';

export interface LanguageCapabilities {
  editing: boolean;
  highlighting: boolean;
  completion: 'native' | 'basic' | 'none';
  diagnostics: 'native' | 'optional' | 'none';
  formatting: 'native' | 'optional' | 'none';
  localRun: boolean;
  cloudBuild: boolean;
  debugging: 'simulated' | 'future' | 'none';
}

export interface CommentSyntax {
  lineComment?: string;
  blockComment?: { open: string; close: string };
}

export interface LanguageProvider {
  id: string;
  name: string;
  extensions: string[];
  filenames?: string[];
  capabilities: LanguageCapabilities;
  commentSyntax?: CommentSyntax;
  getExtensions?: (readOnly?: boolean) => Extension[];
}

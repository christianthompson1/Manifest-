import { Extension } from '@codemirror/state';

export type CapabilityStatus =
  | 'Available'
  | 'Partial'
  | 'Not configured'
  | 'Requires remote build'
  | 'Unsupported';

export type CapabilityDimension =
  | 'editing'
  | 'syntaxHighlighting'
  | 'completion'
  | 'diagnostics'
  | 'formatting'
  | 'localExecution'
  | 'localBuild'
  | 'remoteBuild'
  | 'debugging';

export interface HonestLanguageCapabilities {
  editing: CapabilityStatus;
  syntaxHighlighting: CapabilityStatus;
  completion: CapabilityStatus;
  diagnostics: CapabilityStatus;
  formatting: CapabilityStatus;
  localExecution: CapabilityStatus;
  localBuild: CapabilityStatus;
  remoteBuild: CapabilityStatus;
  debugging: CapabilityStatus;
}

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
  honestCapabilities?: HonestLanguageCapabilities;
  commentSyntax?: CommentSyntax;
  getExtensions?: (readOnly?: boolean) => Extension[];
  getCapabilityStatus?: (dimension: CapabilityDimension) => CapabilityStatus;
}

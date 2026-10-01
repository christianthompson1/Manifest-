/**
 * Manifest Studio - Language Provider Abstraction & Capability Metadata
 * Section 2: All-Purpose Language Architecture
 *
 * Honestly defines what capabilities (editing, highlighting, completion, diagnostics,
 * formatting, localRun, cloudBuild, debugging) are supported locally offline vs cloud.
 */

import { Extension } from '@codemirror/state';

export interface LanguageCapabilities {
  editing: boolean;
  highlighting: boolean;
  completion: 'native' | 'basic' | 'optional' | 'none';
  diagnostics: 'native' | 'optional' | 'none';
  formatting: 'native' | 'optional' | 'none';
  localRun: boolean;
  cloudBuild: boolean;
  debugging: 'supported' | 'simulated' | 'future' | 'none';
}

export interface LanguageCommentSyntax {
  lineComment?: string;
  blockComment?: { open: string; close: string };
}

export interface LanguageProvider {
  id: string;
  name: string;
  extensions: string[];
  filenames?: string[];
  capabilities: LanguageCapabilities;
  commentSyntax?: LanguageCommentSyntax;
  getExtensions?: (readOnly?: boolean) => Extension[];
}

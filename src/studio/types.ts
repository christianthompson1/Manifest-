/**
 * Manifest Studio - Type Definitions
 */

import { ManifestError } from '../../manifest-core/src/index.ts';

export type FileLanguage =
  | 'manifest'
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'html'
  | 'css'
  | 'json'
  | 'markdown'
  | 'python'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'go'
  | 'java'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'dart'
  | 'lua'
  | 'r'
  | 'julia'
  | 'zig'
  | 'elixir'
  | 'haskell'
  | 'sql'
  | 'toml'
  | 'yaml'
  | 'xml'
  | 'shell'
  | 'dockerfile'
  | 'plaintext';

export type ProjectKind = 'manifest' | 'solana' | 'node' | 'rust' | 'python' | 'web' | 'mixed';

export interface ProjectFile {
  id: string;
  name: string;
  path: string; // e.g. "src/main.manifest", "manifest.toml", "package.json", "src/App.tsx"
  content: string;
  isReadOnly?: boolean;
  language: FileLanguage;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  kind?: ProjectKind;
  files: ProjectFile[];
}

export interface ManifestProject {
  id: string;
  name: string;
  description?: string;
  kind?: ProjectKind;
  files: ProjectFile[];
  activeFilePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface StudioDiagnostic {
  line: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source?: 'lexer' | 'parser' | 'validator' | 'ir' | 'compiler' | 'runtime';
  hint?: string;
  example?: string;
  sourceLine?: string;
}

export interface BuildArtifact {
  fileName: string;
  fileType: string;
  content: string;
  sizeBytes: number;
}

export interface BuildResult {
  success: boolean;
  timestamp: number;
  target: string;
  artifacts: BuildArtifact[];
  diagnostics: StudioDiagnostic[];
  outputCode?: string;
  ir?: any;
  durationMs: number;
}

export interface ConsoleEntry {
  id: string;
  timestamp: string;
  type: 'output' | 'info' | 'error' | 'build';
  message: string;
}

export type MobileTab = 'files' | 'editor' | 'preview' | 'console' | 'problems';
export type BottomPanelTab = 'console' | 'problems' | 'ir' | 'build-output';

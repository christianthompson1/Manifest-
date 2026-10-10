/**
 * Manifest Studio - Type Definitions
 */

export type FileLanguage =
  | 'manifest'
  | 'javascript'
  | 'typescript'
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
  | 'html'
  | 'css'
  | 'json'
  | 'yaml'
  | 'xml'
  | 'markdown'
  | 'shell'
  | 'dockerfile'
  | 'toml'
  | 'plaintext'
  | string;

export interface ProjectFile {
  id: string;
  name: string;
  path: string;
  language: FileLanguage;
  content: string;
  isEntry?: boolean;
  isReadOnly?: boolean;
}

export type ProjectKind =
  | 'manifest'
  | 'solana'
  | 'node'
  | 'rust'
  | 'python'
  | 'web'
  | 'mixed'
  | 'polyglot'
  | 'other'
  | string;

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
  activeFilePath?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface StudioDiagnostic {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: 'lexer' | 'parser' | 'validator' | 'ir' | 'compiler' | string;
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
  type: 'log' | 'error' | 'warn' | 'info' | 'system' | 'build' | 'output';
  message: string;
  timestamp: number | string;
}

export interface LiteSVMStepResult {
  stepName: string;
  instructionName: string;
  success: boolean;
  signature: string;
  computeUnitsUsed: number;
  logs: string[];
  error?: string;
  accountsState: Array<{
    address: string;
    role: string;
    lamports: string;
    balanceSol: number;
  }>;
}

export interface LiteSVMTestSuiteResult {
  success: boolean;
  programName: string;
  programId: string;
  durationMs: number;
  stepsCount: number;
  passedCount: number;
  failedCount: number;
  totalComputeUnits: number;
  steps: LiteSVMStepResult[];
  idl: any;
  rustGenerated: boolean;
  error?: string;
}

export type BottomPanelTab = 'problems' | 'console' | 'build-output' | 'terminal' | 'litesvm';

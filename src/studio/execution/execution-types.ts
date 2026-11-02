/**
 * Manifest Studio - Unified Execution Architecture Types
 * Defines the shared Execution Provider interface, project kinds,
 * capabilities, and unified execution results.
 */

import { ManifestProject, ProjectFile, StudioDiagnostic } from '../types.ts';

export type ProjectKind =
  | 'manifest'
  | 'web'
  | 'solana'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'wasm'
  | 'rust'
  | 'native'
  | 'polyglot';

export type PreviewKind =
  | 'manifest-canvas'
  | 'web-document'
  | 'terminal-output'
  | 'diagnostic-error';

export interface ProviderCapability {
  editing: boolean;
  syntaxHighlighting: boolean;
  localExecution: boolean;
  localBuild: boolean;
  offlineReady: boolean;
  previewSupported: boolean;
  requiredRuntime?: string;
  runtimeInstallStatus?: 'installed' | 'browser-native' | 'cached' | 'download-needed' | 'unsupported';
}

export interface ExecutionOptions {
  activeFilePath?: string;
  target?: string;
  runId?: string;
  isDev?: boolean;
}

export interface UnifiedExecutionResult {
  runId: string;
  timestamp: number;
  success: boolean;
  providerId: string;
  projectKind: ProjectKind;
  previewKind: PreviewKind;
  resolvedEntryPath?: string;
  superseded?: boolean;
  previewHtml?: string;
  outputCode?: string;
  diagnostics: StudioDiagnostic[];
  logs: string[];
  state?: Record<string, any>;
  durationMs: number;
  ir?: any;
  error?: string;
}

export interface ExecutionProvider {
  readonly id: string;
  readonly name: string;
  readonly supportedKinds: ProjectKind[];

  detect(project: ManifestProject, activeFile?: ProjectFile): boolean;
  validate(project: ManifestProject, activeFile?: ProjectFile): Promise<{ isValid: boolean; diagnostics: StudioDiagnostic[] }>;
  execute(project: ManifestProject, options?: ExecutionOptions): Promise<UnifiedExecutionResult>;
  build?(project: ManifestProject, options?: ExecutionOptions): Promise<UnifiedExecutionResult>;
  cancel?(runId: string): void;
  getCapabilities(): ProviderCapability;
  isOfflineReady(): boolean;
}

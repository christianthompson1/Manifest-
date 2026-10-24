/**
 * Manifest Studio - Unified Execution Orchestrator
 * Coordinates provider discovery, project detection, cancellation,
 * and delivery of execution results to the preview and studio interface.
 */

import {
  ExecutionProvider,
  ProjectKind,
  ExecutionOptions,
  UnifiedExecutionResult,
} from './execution-types.ts';
import { ManifestProject, ProjectFile } from '../types.ts';
import { ManifestExecutionProvider } from './manifest-execution-provider.ts';
import { StaticWebExecutionProvider } from './static-web-execution-provider.ts';

export class ExecutionOrchestrator {
  private static instance: ExecutionOrchestrator;
  private providers: Map<string, ExecutionProvider> = new Map();
  private activeRunId: string | null = null;
  private runCounter = 0;

  private constructor() {
    this.registerProvider(new ManifestExecutionProvider());
    this.registerProvider(new StaticWebExecutionProvider());
  }

  public static getInstance(): ExecutionOrchestrator {
    if (!ExecutionOrchestrator.instance) {
      ExecutionOrchestrator.instance = new ExecutionOrchestrator();
    }
    return ExecutionOrchestrator.instance;
  }

  public registerProvider(provider: ExecutionProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): ExecutionProvider | undefined {
    return this.providers.get(id);
  }

  public listProviders(): ExecutionProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Deterministically identifies the project kind based on project structure and active file.
   * Direct user action (active file) has highest precedence so switching between Manifest
   * and Web files immediately runs the appropriate provider without stale cached preview.
   */
  public detectProjectKind(project: ManifestProject, activeFile?: ProjectFile): ProjectKind {
    // 1. Active file context (highest precedence: direct user intent)
    if (activeFile) {
      if (
        activeFile.language === 'manifest' ||
        activeFile.path.endsWith('.manifest') ||
        (activeFile.content && (activeFile.content.trimStart().startsWith('APP ') || activeFile.content.trimStart().startsWith('PAGE ')))
      ) {
        return 'manifest';
      }
      if (activeFile.language === 'html' || activeFile.path.endsWith('.html')) {
        return 'web';
      }
      if (activeFile.language === 'rust' || activeFile.path.endsWith('.rs') || activeFile.path === 'Anchor.toml') {
        return 'solana';
      }
    }

    // 2. Explicit project.kind property if set and not generic
    if (project.kind && project.kind !== 'mixed' && project.kind !== 'polyglot') {
      if (project.kind === 'manifest' || project.kind === 'web' || project.kind === 'solana') {
        return project.kind as ProjectKind;
      }
    }

    // 3. Project file hierarchy inspection
    const hasManifestFile = project.files.some(
      (f) => f.path.endsWith('.manifest') || f.language === 'manifest'
    );
    const hasManifestToml = project.files.some((f) => f.path === 'manifest.toml');
    if (hasManifestFile || hasManifestToml) {
      return 'manifest';
    }

    const hasIndexHtml = project.files.some((f) => f.path === 'index.html' || f.name === 'index.html');
    if (hasIndexHtml) {
      return 'web';
    }

    const hasSolana = project.files.some((f) => f.path.endsWith('.rs') || f.path === 'Anchor.toml');
    if (hasSolana) {
      return 'solana';
    }

    return 'manifest'; // Safe default
  }

  /**
   * Selects the most appropriate execution provider for a given project and active file
   */
  public selectProvider(project: ManifestProject, activeFile?: ProjectFile): ExecutionProvider {
    const kind = this.detectProjectKind(project, activeFile);

    for (const provider of this.providers.values()) {
      if (provider.supportedKinds.includes(kind) && provider.detect(project, activeFile)) {
        return provider;
      }
    }

    // Fallback: pick any provider claiming detect()
    for (const provider of this.providers.values()) {
      if (provider.detect(project, activeFile)) {
        return provider;
      }
    }

    // Default to Manifest provider
    return this.providers.get('manifest-provider') || new ManifestExecutionProvider();
  }

  /**
   * Orchestrates the execution of a project, preventing stale asynchronous run results
   */
  public async executeProject(
    project: ManifestProject,
    options: ExecutionOptions = {}
  ): Promise<UnifiedExecutionResult> {
    this.runCounter++;
    const currentRunId = `run-${Date.now()}-${this.runCounter}`;
    this.activeRunId = currentRunId;

    const provider = this.selectProvider(project, options.activeFilePath ? project.files.find((f) => f.path === options.activeFilePath) : undefined);
    const enrichedOptions: ExecutionOptions = {
      ...options,
      runId: currentRunId,
    };

    const result = await provider.execute(project, enrichedOptions);

    // Stale run prevention: if another run was requested while this was executing, discard result
    if (this.activeRunId !== currentRunId) {
      return {
        ...result,
        logs: [...result.logs, `[Execution Orchestrator] Superseded by newer run (${this.activeRunId}).`],
      };
    }

    return result;
  }

  public cancelActiveRun(): void {
    if (this.activeRunId) {
      for (const provider of this.providers.values()) {
        provider.cancel?.(this.activeRunId);
      }
      this.activeRunId = null;
    }
  }

  public getActiveRunId(): string | null {
    return this.activeRunId;
  }
}

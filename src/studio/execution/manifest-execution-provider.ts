/**
 * Manifest Studio - Manifest Execution Provider
 * Executes Manifest programs through the language compiler and preview runtime.
 */

import { ExecutionProvider, ProjectKind, ProviderCapability, ExecutionOptions, UnifiedExecutionResult } from './execution-types.ts';
import { ManifestProject, ProjectFile, StudioDiagnostic } from '../types.ts';
import { runManifestPipeline } from '../compiler-service.ts';

export class ManifestExecutionProvider implements ExecutionProvider {
  public readonly id = 'manifest-provider';
  public readonly name = 'Manifest Language Runtime';
  public readonly supportedKinds: ProjectKind[] = ['manifest'];

  public detect(project: ManifestProject, activeFile?: ProjectFile): boolean {
    if (project.kind === 'manifest') return true;
    if (activeFile && (activeFile.language === 'manifest' || activeFile.path.endsWith('.manifest'))) return true;
    return project.files.some((f) => f.language === 'manifest' || f.path.endsWith('.manifest'));
  }

  public async validate(project: ManifestProject, activeFile?: ProjectFile): Promise<{ isValid: boolean; diagnostics: StudioDiagnostic[] }> {
    const resolved = this.resolveEntryFile(project, activeFile);
    if (!resolved.file) {
      return {
        isValid: false,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: resolved.error || 'No Manifest entry file found (expected src/main.manifest or active .manifest file).',
            severity: 'error',
            source: 'validator',
          },
        ],
      };
    }

    const res = await runManifestPipeline(resolved.file.content, 'js');
    return {
      isValid: res.success,
      diagnostics: res.diagnostics,
    };
  }

  public async execute(project: ManifestProject, options: ExecutionOptions = {}): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    const runId = options.runId || `manifest-run-${Date.now()}`;
    const activeFile = options.activeFilePath ? project.files.find((f) => f.path === options.activeFilePath) : undefined;
    const resolved = this.resolveEntryFile(project, activeFile);

    if (!resolved.file) {
      const errMessage = resolved.error || 'No Manifest entry file found in project.';
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'diagnostic-error',
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: errMessage,
            severity: 'error',
            source: 'compiler',
          },
        ],
        logs: [`[Manifest Provider] Error: ${errMessage}`],
        durationMs: Math.round(performance.now() - startTime),
        error: errMessage,
      };
    }

    const entryFile = resolved.file;
    const pipelineRes = await runManifestPipeline(entryFile.content, options.target || 'js');
    const durationMs = Math.round(performance.now() - startTime);

    if (!pipelineRes.success || !pipelineRes.outputCode) {
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: entryFile.path,
        previewHtml: this.generateErrorHtml(entryFile.path, pipelineRes.diagnostics),
        outputCode: pipelineRes.outputCode,
        diagnostics: pipelineRes.diagnostics,
        logs: pipelineRes.diagnostics.map((d) => `[${d.severity.toUpperCase()}] line ${d.line}: ${d.message}`),
        durationMs,
        ir: pipelineRes.ir,
        error: pipelineRes.diagnostics[0]?.message || 'Compilation failed',
      };
    }

    const previewHtml = this.generateCanvasHtml(entryFile.name, pipelineRes.outputCode, pipelineRes.ir);

    return {
      runId,
      timestamp: Date.now(),
      success: true,
      providerId: this.id,
      projectKind: 'manifest',
      previewKind: 'manifest-canvas',
      resolvedEntryPath: entryFile.path,
      previewHtml,
      outputCode: pipelineRes.outputCode,
      diagnostics: pipelineRes.diagnostics,
      logs: [`Program "${entryFile.path}" compiled and mounted in ${durationMs}ms`],
      durationMs,
      ir: pipelineRes.ir,
    };
  }

  public async build(project: ManifestProject, options: ExecutionOptions = {}): Promise<UnifiedExecutionResult> {
    return this.execute(project, options);
  }

  public getCapabilities(): ProviderCapability {
    return {
      editing: true,
      syntaxHighlighting: true,
      localExecution: true,
      localBuild: true,
      offlineReady: true,
      previewSupported: true,
      requiredRuntime: 'Manifest In-Browser Runtime v0.4.0',
      runtimeInstallStatus: 'installed',
    };
  }

  public isOfflineReady(): boolean {
    return true; // 100% self-contained in browser memory & web workers
  }

  private resolveEntryFile(
    project: ManifestProject,
    activeFile?: ProjectFile
  ): { file?: ProjectFile; error?: string } {
    // 1. If active file is a .manifest file, execute the exact file the user has open
    if (activeFile && (activeFile.language === 'manifest' || activeFile.path.endsWith('.manifest'))) {
      return { file: activeFile };
    }

    // 2. Explicit project.entryPath if configured
    if (project.entryPath) {
      const explicit = project.files.find((f) => f.path === project.entryPath);
      if (explicit) return { file: explicit };
      return {
        error: `Configured project entry file "${project.entryPath}" does not exist in workspace.`,
      };
    }

    // 3. Look for manifest.toml entry declaration (never silently switch if declared entry was deleted!)
    const tomlFile = project.files.find((f) => f.path === 'manifest.toml' || f.name === 'manifest.toml');
    if (tomlFile) {
      const match = tomlFile.content.match(/entry\s*=\s*["']([^"']+)["']/);
      if (match && match[1]) {
        const configuredPath = match[1].trim();
        const declared = project.files.find((f) => f.path === configuredPath);
        if (declared) return { file: declared };
        return {
          error: `Entry file "${configuredPath}" declared in manifest.toml was not found in project.`,
        };
      }
    }

    // 4. Fallback to standard convention: src/main.manifest
    const convention = project.files.find((f) => f.path === 'src/main.manifest');
    if (convention) return { file: convention };

    // 5. Single .manifest file in project
    const manifestFiles = project.files.filter((f) => f.language === 'manifest' || f.path.endsWith('.manifest'));
    if (manifestFiles.length === 1) {
      return { file: manifestFiles[0] };
    }
    if (manifestFiles.length > 1) {
      return { file: manifestFiles[0] };
    }

    return { error: 'No Manifest (.manifest) entry file found in project.' };
  }

  private generateCanvasHtml(title: string, compiledJs: string, ir?: any): string {
    const appName = ir?.appName || title || 'Manifest Application';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: #1f1f1f;
      color: #cccccc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      width: 100%;
      overflow-x: hidden;
    }
    #manifest-root {
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
  </style>
</head>
<body>
  <!-- Sandboxed Manifest Runtime Mount Root -->
  <div id="manifest-root"></div>

  <script type="module">
    // Injected JavaScript Target Output
    ${compiledJs}

    try {
      const root = document.getElementById('manifest-root');
      if (typeof startApp === 'function') {
        startApp(root, {
          onOutput: (msg) => {
            try {
              window.parent.postMessage({ type: 'manifest-output', payload: String(msg) }, '*');
            } catch (_) {}
          },
          onState: (st) => {
            try {
              window.parent.postMessage({ type: 'manifest-state', payload: { ...st } }, '*');
            } catch (_) {}
          }
        });
      }
    } catch (err) {
      console.error('[Manifest Runtime Error]', err);
      try {
        window.parent.postMessage({ type: 'manifest-output', payload: 'Runtime Error: ' + (err.message || String(err)) }, '*');
      } catch (_) {}
    }
  </script>
</body>
</html>`;
  }

  private generateErrorHtml(filename: string, diagnostics: StudioDiagnostic[]): string {
    const errorItems = diagnostics
      .map(
        (d) => `
      <div style="background:#2d1b1e;border-left:4px solid #ef4444;padding:12px;margin-bottom:8px;border-radius:4px;">
        <div style="color:#f87171;font-weight:600;font-size:13px;">Line ${d.line}, Column ${d.column}: ${d.message}</div>
        ${d.hint ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px;">💡 Hint: ${d.hint}</div>` : ''}
        ${d.example ? `<div style="color:#60a5fa;font-size:11px;margin-top:4px;font-family:monospace;">Example: ${d.example}</div>` : ''}
      </div>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Build Diagnostics</title>
  <style>
    body {
      background: #181818;
      color: #e5e7eb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      padding: 24px;
      margin: 0;
    }
    h2 { color: #f87171; font-size: 16px; margin-top: 0; }
  </style>
</head>
<body>
  <h2>Build Issues in ${filename}</h2>
  ${errorItems || '<div style="color:#9ca3af;">Compilation halted with unspecified diagnostic.</div>'}
</body>
</html>`;
  }
}

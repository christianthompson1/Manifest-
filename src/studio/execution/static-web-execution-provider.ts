/**
 * Manifest Studio - Static Web Project Execution Provider
 * Executes ordinary HTML, CSS, JavaScript multi-file projects without converting them to Manifest.
 * Resolves relative local styles, scripts, and assets into an integrated sandboxed preview.
 */

import { ExecutionProvider, ProjectKind, ProviderCapability, ExecutionOptions, UnifiedExecutionResult } from './execution-types.ts';
import { ManifestProject, ProjectFile, StudioDiagnostic } from '../types.ts';

export class StaticWebExecutionProvider implements ExecutionProvider {
  public readonly id = 'static-web-provider';
  public readonly name = 'Static Web Execution Provider (HTML/CSS/JS)';
  public readonly supportedKinds: ProjectKind[] = ['web'];

  public detect(project: ManifestProject, activeFile?: ProjectFile): boolean {
    if (project.kind === 'web') return true;
    if (activeFile && (activeFile.language === 'html' || activeFile.path.endsWith('.html'))) return true;
    return project.files.some((f) => f.path === 'index.html' || f.name.endsWith('.html'));
  }

  public async validate(project: ManifestProject, activeFile?: ProjectFile): Promise<{ isValid: boolean; diagnostics: StudioDiagnostic[] }> {
    const rootHtml = this.resolveRootHtml(project, activeFile);
    if (!rootHtml) {
      return {
        isValid: false,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: 'No HTML document found in project (expected index.html or an active .html file).',
            severity: 'error',
            source: 'web-provider',
          },
        ],
      };
    }

    return {
      isValid: true,
      diagnostics: [],
    };
  }

  public async execute(project: ManifestProject, options: ExecutionOptions = {}): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    const runId = options.runId || `web-run-${Date.now()}`;
    const activeFile = options.activeFilePath ? project.files.find((f) => f.path === options.activeFilePath) : undefined;
    const rootHtml = this.resolveRootHtml(project, activeFile);

    if (!rootHtml) {
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'web',
        previewKind: 'diagnostic-error',
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: 'Static web execution failed: no index.html or active HTML document located.',
            severity: 'error',
            source: 'web-provider',
          },
        ],
        logs: ['[Static Web Provider] Error: Missing root HTML file.'],
        durationMs: Math.round(performance.now() - startTime),
        error: 'Missing root HTML file (expected index.html or an active .html file).',
      };
    }

    try {
      const bundledHtml = this.bundleWebProject(rootHtml, project);
      const durationMs = Math.round(performance.now() - startTime);

      return {
        runId,
        timestamp: Date.now(),
        success: true,
        providerId: this.id,
        projectKind: 'web',
        previewKind: 'web-document',
        previewHtml: bundledHtml,
        outputCode: rootHtml.content,
        diagnostics: [],
        logs: [
          `[Web Provider] Bundled "${rootHtml.name}" with local assets in ${durationMs}ms`,
        ],
        durationMs,
      };
    } catch (err: any) {
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'web',
        previewKind: 'diagnostic-error',
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: `Asset bundling error: ${err.message || String(err)}`,
            severity: 'error',
            source: 'web-provider',
          },
        ],
        logs: [`[Static Web Provider] Bundling exception: ${err.message || String(err)}`],
        durationMs: Math.round(performance.now() - startTime),
        error: err.message || String(err),
      };
    }
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
      requiredRuntime: 'Browser Native (HTML5 / ES2024 / CSS3)',
      runtimeInstallStatus: 'browser-native',
    };
  }

  public isOfflineReady(): boolean {
    return true; // 100% offline ready using browser-native web engine
  }

  private resolveRootHtml(project: ManifestProject, activeFile?: ProjectFile): ProjectFile | undefined {
    // 1. If active file is an HTML document, preview that document
    if (activeFile && (activeFile.language === 'html' || activeFile.path.endsWith('.html'))) {
      return activeFile;
    }

    // 2. index.html at root
    const indexHtml = project.files.find((f) => f.path === 'index.html' || f.name === 'index.html');
    if (indexHtml) return indexHtml;

    // 3. index.html in public or src
    const nestedIndex = project.files.find((f) => f.path.endsWith('/index.html'));
    if (nestedIndex) return nestedIndex;

    // 4. Any HTML file
    return project.files.find((f) => f.language === 'html' || f.path.endsWith('.html'));
  }

  /**
   * Resolves and inlines local relative styles, scripts, and media from the project virtual filesystem
   */
  public bundleWebProject(rootHtml: ProjectFile, project: ManifestProject): string {
    let content = rootHtml.content;
    const basePath = rootHtml.path.includes('/')
      ? rootHtml.path.substring(0, rootHtml.path.lastIndexOf('/') + 1)
      : '';

    // 1. Inline local <link rel="stylesheet" href="...">
    content = content.replace(
      /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>|<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
      (match, href1, href2) => {
        const href = (href1 || href2 || '').trim();
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//') || href.startsWith('data:')) {
          return match; // preserve remote CDN stylesheets
        }

        const resolvedPath = this.resolveRelativePath(basePath, href);
        const cssFile = project.files.find(
          (f) => f.path === resolvedPath || f.path === href || f.name === href || f.path.endsWith('/' + href)
        );

        if (cssFile) {
          return `<!-- Inlined ${cssFile.path} -->\n<style>\n${cssFile.content}\n</style>`;
        }
        return `<!-- Missing local stylesheet: ${href} -->\n${match}`;
      }
    );

    // 2. Inline local <script src="...">
    content = content.replace(
      /<script\s+([^>]*src=["']([^"']+)["'][^>]*)><\/script>/gi,
      (match, attrs, src) => {
        const scriptSrc = (src || '').trim();
        if (scriptSrc.startsWith('http://') || scriptSrc.startsWith('https://') || scriptSrc.startsWith('//') || scriptSrc.startsWith('data:')) {
          return match; // preserve remote scripts
        }

        const resolvedPath = this.resolveRelativePath(basePath, scriptSrc);
        const jsFile = project.files.find(
          (f) => f.path === resolvedPath || f.path === scriptSrc || f.name === scriptSrc || f.path.endsWith('/' + scriptSrc)
        );

        if (jsFile) {
          // Check if module type is requested in original attrs
          const isModule = /type=["']module["']/i.test(attrs);
          return `<!-- Inlined ${jsFile.path} -->\n<script ${isModule ? 'type="module"' : ''}>\n${jsFile.content}\n</script>`;
        }
        return `<!-- Missing local script: ${scriptSrc} -->\n${match}`;
      }
    );

    // 3. Resolve local image src="..." to data URLs where available
    content = content.replace(
      /(<img\s+[^>]*src=["'])([^"']+)(["'][^>]*>)/gi,
      (match, pre, src, post) => {
        const cleanSrc = (src || '').trim();
        if (cleanSrc.startsWith('http://') || cleanSrc.startsWith('https://') || cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')) {
          return match;
        }

        const resolvedPath = this.resolveRelativePath(basePath, cleanSrc);
        const assetFile = project.files.find(
          (f) => f.path === resolvedPath || f.path === cleanSrc || f.name === cleanSrc
        );

        if (assetFile) {
          if (assetFile.isBinary && assetFile.content.startsWith('data:')) {
            return `${pre}${assetFile.content}${post}`;
          }
          if (assetFile.path.endsWith('.svg')) {
            const encoded = encodeURIComponent(assetFile.content);
            return `${pre}data:image/svg+xml;utf8,${encoded}${post}`;
          }
        }
        return match;
      }
    );

    // 4. Inject safe Preview Console and Error Forwarding Bridge
    const consoleBridgeScript = `
  <script>
    (function() {
      // Forward console logs to Studio preview panel
      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;
      const origInfo = console.info;

      function post(level, args) {
        try {
          const message = Array.from(args).map(a => {
            if (typeof a === 'object') {
              try { return JSON.stringify(a); } catch(_) { return String(a); }
            }
            return String(a);
          }).join(' ');
          window.parent.postMessage({ type: 'preview-console', level: level, payload: message }, '*');
        } catch(_) {}
      }

      console.log = function() { origLog.apply(console, arguments); post('log', arguments); };
      console.warn = function() { origWarn.apply(console, arguments); post('warn', arguments); };
      console.error = function() { origError.apply(console, arguments); post('error', arguments); };
      console.info = function() { origInfo.apply(console, arguments); post('info', arguments); };

      window.onerror = function(msg, url, line, col, err) {
        post('error', ['[Uncaught Error]', msg, 'at line ' + line + ':' + col]);
        return false;
      };

      window.onunhandledrejection = function(e) {
        post('error', ['[Unhandled Promise Rejection]', e.reason ? (e.reason.message || String(e.reason)) : 'Promise rejected']);
      };
    })();
  </script>`;

    // Insert console bridge at end of <head> or start of <body>
    if (/<head[^>]*>/i.test(content)) {
      content = content.replace(/(<head[^>]*>)/i, `$1\n${consoleBridgeScript}`);
    } else if (/<html[^>]*>/i.test(content)) {
      content = content.replace(/(<html[^>]*>)/i, `$1\n<head>${consoleBridgeScript}</head>`);
    } else {
      content = `<head>${consoleBridgeScript}</head>\n${content}`;
    }

    return content;
  }

  private resolveRelativePath(baseDir: string, relative: string): string {
    if (relative.startsWith('/')) {
      return relative.substring(1);
    }
    const parts = (baseDir + relative).split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return resolved.join('/');
  }
}

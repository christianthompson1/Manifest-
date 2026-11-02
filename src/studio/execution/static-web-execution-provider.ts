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
  public readonly supportedKinds: ProjectKind[] = ['web', 'javascript'];

  public detect(project: ManifestProject, activeFile?: ProjectFile): boolean {
    if (activeFile) {
      if (
        activeFile.language === 'html' ||
        activeFile.path.endsWith('.html') ||
        activeFile.path.endsWith('.htm') ||
        activeFile.language === 'css' ||
        activeFile.path.endsWith('.css') ||
        activeFile.language === 'javascript' ||
        activeFile.path.endsWith('.js') ||
        activeFile.path.endsWith('.mjs')
      ) {
        return true;
      }
    }
    if (project.kind === 'web' || project.kind === 'javascript') return true;
    return project.files.some((f) => f.path === 'index.html' || f.name.endsWith('.html'));
  }

  public async validate(project: ManifestProject, activeFile?: ProjectFile): Promise<{ isValid: boolean; diagnostics: StudioDiagnostic[] }> {
    const rootHtml = this.resolveRootHtml(project, activeFile);
    if (!rootHtml) {
      if (this.isStandaloneJavaScript(project, activeFile)) {
        return { isValid: true, diagnostics: [] };
      }
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

    const diagnostics: StudioDiagnostic[] = [];
    this.bundleWebProject(rootHtml, project, diagnostics);
    return {
      isValid: !diagnostics.some((d) => d.severity === 'error'),
      diagnostics,
    };
  }

  public async execute(project: ManifestProject, options: ExecutionOptions = {}): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    const runId = options.runId || `web-run-${Date.now()}`;
    const activeFile = options.activeFilePath ? project.files.find((f) => f.path === options.activeFilePath) : undefined;
    const rootHtml = this.resolveRootHtml(project, activeFile);

    // Standalone JavaScript file execution when project has no HTML entry document
    if (!rootHtml && activeFile && this.isStandaloneJavaScript(project, activeFile)) {
      const previewHtml = this.generateStandaloneJsHarness(activeFile);
      const durationMs = Math.round(performance.now() - startTime);
      return {
        runId,
        timestamp: Date.now(),
        success: true,
        providerId: this.id,
        projectKind: 'javascript',
        previewKind: 'web-document',
        resolvedEntryPath: activeFile.path,
        previewHtml,
        outputCode: activeFile.content,
        diagnostics: [],
        logs: [`[JS Runtime] Executed standalone script "${activeFile.path}" in ${durationMs}ms`],
        durationMs,
      };
    }

    if (!rootHtml) {
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'web',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: activeFile?.path,
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
      const diagnostics: StudioDiagnostic[] = [];
      const bundledHtml = this.bundleWebProject(rootHtml, project, diagnostics);
      const durationMs = Math.round(performance.now() - startTime);

      const logs = [
        `[Web Provider] Bundled "${rootHtml.path}" with local assets in ${durationMs}ms`,
        ...diagnostics.map((d) => `[Web Asset ${d.severity.toUpperCase()}] line ${d.line}: ${d.message}`),
      ];

      return {
        runId,
        timestamp: Date.now(),
        success: true,
        providerId: this.id,
        projectKind: 'web',
        previewKind: 'web-document',
        resolvedEntryPath: rootHtml.path,
        previewHtml: bundledHtml,
        outputCode: bundledHtml,
        diagnostics,
        logs,
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
        resolvedEntryPath: rootHtml.path,
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

  private isStandaloneJavaScript(project: ManifestProject, activeFile?: ProjectFile): boolean {
    if (!activeFile) return false;
    const isJs =
      activeFile.language === 'javascript' ||
      activeFile.path.endsWith('.js') ||
      activeFile.path.endsWith('.mjs');
    if (!isJs) return false;
    const hasHtml = project.files.some((f) => f.language === 'html' || f.path.endsWith('.html') || f.path.endsWith('.htm'));
    return !hasHtml;
  }

  private resolveRootHtml(project: ManifestProject, activeFile?: ProjectFile): ProjectFile | undefined {
    // 1. If active file is an HTML document, preview that document
    if (activeFile && (activeFile.language === 'html' || activeFile.path.endsWith('.html') || activeFile.path.endsWith('.htm'))) {
      return activeFile;
    }

    // 2. Explicit project.entryPath if it points to an HTML document
    if (project.entryPath) {
      const explicitEntry = project.files.find((f) => f.path === project.entryPath);
      if (explicitEntry && (explicitEntry.language === 'html' || explicitEntry.path.endsWith('.html') || explicitEntry.path.endsWith('.htm'))) {
        return explicitEntry;
      }
    }

    // 3. index.html at root
    const indexHtml = project.files.find((f) => f.path === 'index.html' || f.name === 'index.html');
    if (indexHtml) return indexHtml;

    // 4. index.html in public or src
    const nestedIndex = project.files.find((f) => f.path.endsWith('/index.html'));
    if (nestedIndex) return nestedIndex;

    // 5. Any HTML file
    return project.files.find((f) => f.language === 'html' || f.path.endsWith('.html') || f.path.endsWith('.htm'));
  }

  private isExternalUrl(ref: string): boolean {
    return (
      ref.startsWith('http://') ||
      ref.startsWith('https://') ||
      ref.startsWith('//') ||
      ref.startsWith('data:') ||
      ref.startsWith('blob:') ||
      ref.startsWith('#') ||
      ref.startsWith('mailto:') ||
      ref.startsWith('javascript:')
    );
  }

  private computeLineNumber(source: string, offset: number): number {
    if (offset <= 0) return 1;
    let line = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source.charCodeAt(i) === 10) line++;
    }
    return line;
  }

  private resolveAssetDataUrl(assetFile: ProjectFile): string | null {
    if (assetFile.isBinary && assetFile.content.startsWith('data:')) {
      return assetFile.content;
    }
    if (assetFile.path.toLowerCase().endsWith('.svg')) {
      const b64 =
        typeof Buffer !== 'undefined'
          ? Buffer.from(assetFile.content, 'utf-8').toString('base64')
          : btoa(unescape(encodeURIComponent(assetFile.content)));
      return `data:image/svg+xml;base64,${b64}`;
    }
    return null;
  }

  private resolveCssUrls(
    cssText: string,
    cssBaseDir: string,
    project: ManifestProject,
    diagnostics?: StudioDiagnostic[]
  ): string {
    return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, _quote, rawUrl, offset) => {
      const cleanUrl = (rawUrl || '').trim();
      if (!cleanUrl || this.isExternalUrl(cleanUrl)) {
        return match;
      }
      const cleanNoQuery = cleanUrl.split('?')[0].split('#')[0];
      const resolvedPath = this.resolveRelativePath(cssBaseDir, cleanNoQuery);
      const assetFile = project.files.find(
        (f) => f.path === resolvedPath || f.path === cleanNoQuery || f.name === cleanNoQuery
      );
      if (assetFile) {
        const dataUrl = this.resolveAssetDataUrl(assetFile);
        if (dataUrl) {
          return `url("${dataUrl}")`;
        }
      } else if (diagnostics) {
        diagnostics.push({
          line: this.computeLineNumber(cssText, offset),
          column: 1,
          message: `Missing local CSS asset "${cleanUrl}" (resolved as "${resolvedPath}").`,
          severity: 'warning',
          source: 'web-provider',
        });
      }
      return match;
    });
  }

  /**
   * Resolves and inlines local relative styles, scripts, and media from the project virtual filesystem.
   * Records structured warnings for missing local stylesheet, script, or image references.
   */
  public bundleWebProject(
    rootHtml: ProjectFile,
    project: ManifestProject,
    diagnostics: StudioDiagnostic[] = []
  ): string {
    const originalHtml = rootHtml.content;
    let content = originalHtml;
    const basePath = rootHtml.path.includes('/')
      ? rootHtml.path.substring(0, rootHtml.path.lastIndexOf('/') + 1)
      : '';

    // 1. Inline local <link rel="stylesheet" href="...">
    content = content.replace(
      /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>|<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
      (match, href1, href2, offset) => {
        const href = (href1 || href2 || '').trim();
        if (!href || this.isExternalUrl(href)) {
          return match; // preserve remote CDN stylesheets
        }

        const cleanHref = href.split('?')[0].split('#')[0];
        const resolvedPath = this.resolveRelativePath(basePath, cleanHref);
        const cssFile = project.files.find(
          (f) => f.path === resolvedPath || f.path === cleanHref || f.name === cleanHref || f.path.endsWith('/' + cleanHref)
        );

        if (cssFile) {
          const cssDir = cssFile.path.includes('/')
            ? cssFile.path.substring(0, cssFile.path.lastIndexOf('/') + 1)
            : '';
          const resolvedCss = this.resolveCssUrls(cssFile.content, cssDir, project, diagnostics);
          return `<!-- Inlined ${cssFile.path} -->\n<style>\n${resolvedCss}\n</style>`;
        }

        const origOffset = originalHtml.indexOf(match);
        diagnostics.push({
          line: this.computeLineNumber(originalHtml, origOffset >= 0 ? origOffset : (typeof offset === 'number' ? offset : 0)),
          column: 1,
          message: `Missing local stylesheet "${href}" referenced in ${rootHtml.path}.`,
          severity: 'warning',
          source: 'web-provider',
        });
        return `<!-- Missing local stylesheet: ${href} -->${match}`;
      }
    );

    // 1b. Resolve CSS url(...) inside inline <style>...</style> blocks
    content = content.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, openTag, cssBody, closeTag) => {
      return `${openTag}${this.resolveCssUrls(cssBody, basePath, project)}${closeTag}`;
    });

    // 2. Inline local <script src="...">
    content = content.replace(
      /<script\s+([^>]*src=["']([^"']+)["'][^>]*)><\/script>/gi,
      (match, attrs, src, offset) => {
        const scriptSrc = (src || '').trim();
        if (!scriptSrc || this.isExternalUrl(scriptSrc)) {
          return match; // preserve remote scripts
        }

        const cleanSrc = scriptSrc.split('?')[0].split('#')[0];
        const resolvedPath = this.resolveRelativePath(basePath, cleanSrc);
        const jsFile = project.files.find(
          (f) => f.path === resolvedPath || f.path === cleanSrc || f.name === cleanSrc || f.path.endsWith('/' + cleanSrc)
        );

        if (jsFile) {
          const isModule = /type=["']module["']/i.test(attrs);
          const safeJs = jsFile.content.replace(/<\/script>/gi, '<\\/script>');
          return `<!-- Inlined ${jsFile.path} -->\n<script ${isModule ? 'type="module"' : ''}>\n${safeJs}\n</script>`;
        }

        const origOffset = originalHtml.indexOf(match);
        diagnostics.push({
          line: this.computeLineNumber(originalHtml, origOffset >= 0 ? origOffset : (typeof offset === 'number' ? offset : 0)),
          column: 1,
          message: `Missing local script "${scriptSrc}" referenced in ${rootHtml.path}.`,
          severity: 'warning',
          source: 'web-provider',
        });
        return `<!-- Missing local script: ${scriptSrc} -->${match}`;
      }
    );

    // 3. Resolve local image src="..." to data URLs where available
    content = content.replace(
      /(<img\s+[^>]*src=["'])([^"']+)(["'][^>]*>)/gi,
      (match, pre, src, post, offset) => {
        const cleanSrc = (src || '').trim();
        if (!cleanSrc || this.isExternalUrl(cleanSrc)) {
          return match;
        }

        const cleanNoQuery = cleanSrc.split('?')[0].split('#')[0];
        const resolvedPath = this.resolveRelativePath(basePath, cleanNoQuery);
        const assetFile = project.files.find(
          (f) => f.path === resolvedPath || f.path === cleanNoQuery || f.name === cleanNoQuery
        );

        if (assetFile) {
          const dataUrl = this.resolveAssetDataUrl(assetFile);
          if (dataUrl) {
            return `${pre}${dataUrl}${post}`;
          }
          return match;
        }

        const origOffset = originalHtml.indexOf(match);
        diagnostics.push({
          line: this.computeLineNumber(originalHtml, origOffset >= 0 ? origOffset : (typeof offset === 'number' ? offset : 0)),
          column: 1,
          message: `Missing local image asset "${cleanSrc}" referenced in ${rootHtml.path}.`,
          severity: 'warning',
          source: 'web-provider',
        });
        return match;
      }
    );

    diagnostics.sort((a, b) => a.line - b.line);

    // 4. Inject safe Preview Console and Error Forwarding Bridge
    const consoleBridgeScript = this.getConsoleBridgeScript();

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

  private getConsoleBridgeScript(mirrorToDomId?: string): string {
    return `
  <script>
    (function() {
      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;
      const origInfo = console.info;

      function post(level, args) {
        try {
          const message = Array.from(args).map(a => {
            if (typeof a === 'object' && a !== null) {
              try { return JSON.stringify(a); } catch(_) { return String(a); }
            }
            return String(a);
          }).join(' ');
          window.parent.postMessage({ type: 'preview-console', level: level, payload: message }, '*');
          ${
            mirrorToDomId
              ? `const el = document.getElementById('${mirrorToDomId}');
          if (el) {
            const row = document.createElement('div');
            row.style.color = level === 'error' ? '#f85149' : level === 'warn' ? '#cca700' : '#89d185';
            row.textContent = '> ' + message;
            el.appendChild(row);
          }`
              : ''
          }
        } catch(_) {}
      }

      console.log = function() { origLog.apply(console, arguments); post('log', arguments); };
      console.warn = function() { origWarn.apply(console, arguments); post('warn', arguments); };
      console.error = function() { origError.apply(console, arguments); post('error', arguments); };
      console.info = function() { origInfo.apply(console, arguments); post('info', arguments); };

      window.onerror = function(msg, url, line, col) {
        post('error', ['[Uncaught Error]', msg, 'at line ' + line + ':' + col]);
        return false;
      };

      window.onunhandledrejection = function(e) {
        post('error', ['[Unhandled Promise Rejection]', e.reason ? (e.reason.message || String(e.reason)) : 'Promise rejected']);
      };
    })();
  </script>`;
  }

  private generateStandaloneJsHarness(jsFile: ProjectFile): string {
    const safeJs = jsFile.content.replace(/<\/script>/gi, '<\\/script>');
    const bridge = this.getConsoleBridgeScript('js-console-out');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${jsFile.name} — JavaScript Console</title>
  <style>
    body {
      background: #1f1f1f;
      color: #cccccc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 20px;
      margin: 0;
      font-size: 12px;
      line-height: 1.6;
    }
    .header {
      color: #858585;
      font-size: 11px;
      padding-bottom: 10px;
      margin-bottom: 12px;
      border-bottom: 1px solid #2d2d2d;
    }
  </style>
  ${bridge}
</head>
<body>
  <div class="header">JavaScript Execution (${jsFile.path})</div>
  <div id="app"></div>
  <div id="js-console-out"></div>
  <script type="module">
${safeJs}
  </script>
</body>
</html>`;
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

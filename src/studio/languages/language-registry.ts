/**
 * Manifest Studio - Universal Language Registry
 * Implements Section 2: Provider-based language architecture with capability metadata.
 * Recognizes and provides syntax highlighting, brackets, indentation, and honest capabilities
 * for all 22 core programming languages and web/data formats.
 */

import { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { LanguageProvider, HonestLanguageCapabilities, CapabilityStatus } from './language-provider.ts';

// Lezer language packages
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';

// Legacy modes for languages without standalone Lezer packages
import { go } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { r } from '@codemirror/legacy-modes/mode/r';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { csharp, kotlin, dart } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';

// Manifest native mode
import { manifestLanguage, manifestSyntaxHighlighting } from '../editor/manifest-language.ts';
import { manifestAutocomplete, manifestHoverTooltip } from '../editor/manifest-autocomplete.ts';
import { manifestLinter } from '../editor/manifest-linter.ts';
import { autocompletion } from '@codemirror/autocomplete';
import { linter, Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { jsonParseLinter } from '@codemirror/lang-json';

const realJsonLinter = linter((view): CmDiagnostic[] => {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return [];
  return jsonParseLinter()(view);
});

export class LanguageRegistry {
  private static instance: LanguageRegistry;
  private providers: Map<string, LanguageProvider> = new Map();
  private extensionMap: Map<string, string> = new Map();
  private filenameMap: Map<string, string> = new Map();

  private constructor() {
    this.registerAllProviders();
  }

  public static getInstance(): LanguageRegistry {
    if (!LanguageRegistry.instance) {
      LanguageRegistry.instance = new LanguageRegistry();
    }
    return LanguageRegistry.instance;
  }

  public static computeHonestCapabilities(p: LanguageProvider): HonestLanguageCapabilities {
    if (p.id === 'manifest') {
      return {
        editing: 'Available',
        syntaxHighlighting: 'Available',
        completion: 'Available',
        diagnostics: 'Available',
        formatting: 'Available',
        localExecution: 'Available',
        localBuild: 'Available',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      };
    }
    if (p.id === 'mbc') {
      return {
        editing: 'Unsupported',
        syntaxHighlighting: 'Unsupported',
        completion: 'Unsupported',
        diagnostics: 'Available',
        formatting: 'Unsupported',
        localExecution: 'Available',
        localBuild: 'Unsupported',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      };
    }
    if (p.id === 'html' || p.id === 'css') {
      return {
        editing: 'Available',
        syntaxHighlighting: 'Available',
        completion: 'Partial',
        diagnostics: 'Partial',
        formatting: 'Partial',
        localExecution: 'Available',
        localBuild: 'Available',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      };
    }
    if (p.id === 'javascript') {
      return {
        editing: 'Available',
        syntaxHighlighting: 'Available',
        completion: 'Partial',
        diagnostics: 'Unsupported',
        formatting: 'Partial',
        localExecution: 'Available',
        localBuild: 'Available',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      };
    }
    if (p.id === 'wasm') {
      return {
        editing: 'Unsupported',
        syntaxHighlighting: 'Unsupported',
        completion: 'Unsupported',
        diagnostics: 'Available',
        formatting: 'Unsupported',
        localExecution: 'Available',
        localBuild: 'Unsupported',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      };
    }
    if (p.id === 'typescript') {
      return {
        editing: 'Available',
        syntaxHighlighting: 'Available',
        completion: 'Partial',
        diagnostics: 'Unsupported',
        formatting: 'Partial',
        localExecution: 'Unsupported',
        localBuild: 'Unsupported',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      };
    }
    if (p.id === 'json') {
      return {
        editing: 'Available',
        syntaxHighlighting: 'Available',
        completion: 'Partial',
        diagnostics: 'Available',
        formatting: 'Partial',
        localExecution: 'Unsupported',
        localBuild: 'Unsupported',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      };
    }
    if (p.id === 'rust') {
      return {
        editing: 'Available',
        syntaxHighlighting: 'Available',
        completion: 'Partial',
        diagnostics: 'Unsupported',
        formatting: 'Unsupported',
        localExecution: 'Unsupported',
        localBuild: 'Unsupported',
        remoteBuild: 'Requires remote build',
        debugging: 'Unsupported',
      };
    }
    return {
      editing: 'Available',
      syntaxHighlighting: p.capabilities.highlighting ? 'Available' : 'Unsupported',
      completion: p.capabilities.completion !== 'none' ? 'Partial' : 'Unsupported',
      diagnostics: 'Unsupported',
      formatting: 'Unsupported',
      localExecution: 'Unsupported',
      localBuild: 'Unsupported',
      remoteBuild: 'Not configured',
      debugging: 'Unsupported',
    };
  }

  private register(provider: LanguageProvider) {
    provider.honestCapabilities = provider.honestCapabilities || LanguageRegistry.computeHonestCapabilities(provider);
    provider.getCapabilityStatus = (dim) =>
      provider.honestCapabilities ? provider.honestCapabilities[dim] : 'Unsupported';

    this.providers.set(provider.id, provider);
    for (const ext of provider.extensions) {
      this.extensionMap.set(ext.toLowerCase(), provider.id);
    }
    if (provider.filenames) {
      for (const fn of provider.filenames) {
        this.filenameMap.set(fn.toLowerCase(), provider.id);
      }
    }
  }

  private registerAllProviders() {
    // 1. Manifest (First-Class Native - Dual Syntax Profiles: Beginner & Professional)
    this.register({
      id: 'manifest',
      name: 'Manifest',
      extensions: ['.manifest'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'native',
        diagnostics: 'native',
        formatting: 'optional',
        localRun: true,
        cloudBuild: false,
        debugging: 'none',
      },
      commentSyntax: { lineComment: '//' },
      getExtensions: (readOnly = false) => {
        const exts: Extension[] = [
          manifestSyntaxHighlighting,
          manifestLanguage,
          manifestHoverTooltip,
          autocompletion({ override: [manifestAutocomplete], defaultKeymap: true }),
        ];
        if (!readOnly) exts.push(manifestLinter);
        return exts;
      },
    });

    // 1a. Manifest Portable Bytecode (.mbc) — Verified & Executed by Rust MVM
    this.register({
      id: 'mbc',
      name: 'Manifest Bytecode (.mbc)',
      extensions: ['.mbc'],
      capabilities: {
        editing: false,
        highlighting: false,
        completion: 'none',
        diagnostics: 'native',
        formatting: 'none',
        localRun: true,
        cloudBuild: false,
        debugging: 'none',
      },
      getExtensions: () => [],
    });

    // 1b. TOML Configuration (manifest.toml, Cargo.toml, Anchor.toml — separated from Manifest linter!)
    this.register({
      id: 'toml',
      name: 'TOML',
      extensions: ['.toml'],
      filenames: ['manifest.toml', 'Cargo.toml', 'Cargo.lock', 'Anchor.toml'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'none',
        diagnostics: 'none',
        formatting: 'none',
        localRun: false,
        cloudBuild: false,
        debugging: 'none',
      },
      commentSyntax: { lineComment: '#' },
      getExtensions: () => [yaml()],
    });

    // 1c. WebAssembly Binary (.wasm)
    this.register({
      id: 'wasm',
      name: 'WebAssembly Binary (.wasm)',
      extensions: ['.wasm'],
      capabilities: {
        editing: false,
        highlighting: false,
        completion: 'none',
        diagnostics: 'native',
        formatting: 'none',
        localRun: true,
        cloudBuild: false,
        debugging: 'none',
      },
      getExtensions: () => [],
    });

    // 2. JavaScript
    this.register({
      id: 'javascript',
      name: 'JavaScript',
      extensions: ['.js', '.mjs', '.cjs'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'none',
        formatting: 'none',
        localRun: true,
        cloudBuild: false,
        debugging: 'none',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [javascript()],
    });

    // 3. TypeScript / JSX / TSX
    this.register({
      id: 'typescript',
      name: 'TypeScript',
      extensions: ['.ts', '.mts', '.cts', '.tsx', '.jsx'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'none',
        formatting: 'none',
        localRun: false,
        cloudBuild: false,
        debugging: 'none',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [javascript({ typescript: true, jsx: true })],
    });

    // 4. Python
    this.register({
      id: 'python',
      name: 'Python',
      extensions: ['.py', '.pyw'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'none',
        formatting: 'none',
        localRun: false,
        cloudBuild: false,
        debugging: 'none',
      },
      commentSyntax: { lineComment: '#' },
      getExtensions: () => [python()],
    });

    // 5. Rust
    this.register({
      id: 'rust',
      name: 'Rust',
      extensions: ['.rs'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'none',
        formatting: 'none',
        localRun: false,
        cloudBuild: true,
        debugging: 'none',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [rust()],
    });

    // 6. C
    this.register({
      id: 'c',
      name: 'C',
      extensions: ['.c', '.h'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [cpp()],
    });

    // 7. C++
    this.register({
      id: 'cpp',
      name: 'C++',
      extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [cpp()],
    });

    // 8. Go
    this.register({
      id: 'go',
      name: 'Go',
      extensions: ['.go'],
      filenames: ['go.mod', 'go.sum'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//' },
      getExtensions: () => [StreamLanguage.define(go)],
    });

    // 9. Java
    this.register({
      id: 'java',
      name: 'Java',
      extensions: ['.java'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [java()],
    });

    // 10. C#
    this.register({
      id: 'csharp',
      name: 'C#',
      extensions: ['.cs', '.csx'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [StreamLanguage.define(csharp)],
    });

    // 11. PHP
    this.register({
      id: 'php',
      name: 'PHP',
      extensions: ['.php', '.phtml'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [php()],
    });

    // 12. Ruby
    this.register({
      id: 'ruby',
      name: 'Ruby',
      extensions: ['.rb', '.rake'],
      filenames: ['Gemfile'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '#' },
      getExtensions: () => [StreamLanguage.define(ruby)],
    });

    // 13. Swift
    this.register({
      id: 'swift',
      name: 'Swift',
      extensions: ['.swift'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//', blockComment: { open: '/*', close: '*/' } },
      getExtensions: () => [StreamLanguage.define(swift)],
    });

    // 14. Kotlin
    this.register({
      id: 'kotlin',
      name: 'Kotlin',
      extensions: ['.kt', '.kts'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//' },
      getExtensions: () => [StreamLanguage.define(kotlin)],
    });

    // 15. Dart
    this.register({
      id: 'dart',
      name: 'Dart',
      extensions: ['.dart'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//' },
      getExtensions: () => [StreamLanguage.define(dart)],
    });

    // 16. Lua
    this.register({
      id: 'lua',
      name: 'Lua',
      extensions: ['.lua'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '--' },
      getExtensions: () => [StreamLanguage.define(lua)],
    });

    // 17. R
    this.register({
      id: 'r',
      name: 'R',
      extensions: ['.r', '.rmd'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '#' },
      getExtensions: () => [StreamLanguage.define(r)],
    });

    // 18. Julia
    this.register({
      id: 'julia',
      name: 'Julia',
      extensions: ['.jl'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '#' },
      getExtensions: () => [StreamLanguage.define(julia)],
    });

    // 19. Zig
    this.register({
      id: 'zig',
      name: 'Zig',
      extensions: ['.zig'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '//' },
      getExtensions: () => [cpp()],
    });

    // 20. Elixir
    this.register({
      id: 'elixir',
      name: 'Elixir',
      extensions: ['.ex', '.exs'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '#' },
      getExtensions: () => [StreamLanguage.define(ruby)],
    });

    // 21. Haskell
    this.register({
      id: 'haskell',
      name: 'Haskell',
      extensions: ['.hs', '.lhs'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '--' },
      getExtensions: () => [StreamLanguage.define(haskell)],
    });

    // 22. SQL
    this.register({
      id: 'sql',
      name: 'SQL',
      extensions: ['.sql'],
      capabilities: {
        editing: true,
        highlighting: true,
        completion: 'basic',
        diagnostics: 'optional',
        formatting: 'optional',
        localRun: false,
        cloudBuild: true,
        debugging: 'future',
      },
      commentSyntax: { lineComment: '--' },
      getExtensions: () => [sql()],
    });

    // Web & Data Formats
    this.register({
      id: 'html',
      name: 'HTML',
      extensions: ['.html', '.htm'],
      capabilities: { editing: true, highlighting: true, completion: 'basic', diagnostics: 'none', formatting: 'optional', localRun: true, cloudBuild: false, debugging: 'none' },
      getExtensions: () => [html()],
    });

    this.register({
      id: 'css',
      name: 'CSS / SCSS',
      extensions: ['.css', '.scss', '.less'],
      capabilities: { editing: true, highlighting: true, completion: 'basic', diagnostics: 'none', formatting: 'optional', localRun: true, cloudBuild: false, debugging: 'none' },
      getExtensions: () => [css()],
    });

    this.register({
      id: 'json',
      name: 'JSON',
      extensions: ['.json', '.jsonc'],
      capabilities: { editing: true, highlighting: true, completion: 'basic', diagnostics: 'native', formatting: 'none', localRun: false, cloudBuild: false, debugging: 'none' },
      getExtensions: (readOnly = false) => (readOnly ? [json()] : [json(), realJsonLinter]),
    });

    this.register({
      id: 'yaml',
      name: 'YAML',
      extensions: ['.yaml', '.yml'],
      capabilities: { editing: true, highlighting: true, completion: 'basic', diagnostics: 'none', formatting: 'none', localRun: false, cloudBuild: false, debugging: 'none' },
      getExtensions: () => [yaml()],
    });

    this.register({
      id: 'xml',
      name: 'XML / SVG',
      extensions: ['.xml', '.svg'],
      capabilities: { editing: true, highlighting: true, completion: 'basic', diagnostics: 'none', formatting: 'none', localRun: false, cloudBuild: false, debugging: 'none' },
      getExtensions: () => [xml()],
    });

    this.register({
      id: 'markdown',
      name: 'Markdown',
      extensions: ['.md', '.markdown'],
      capabilities: { editing: true, highlighting: true, completion: 'none', diagnostics: 'none', formatting: 'none', localRun: false, cloudBuild: false, debugging: 'none' },
      getExtensions: () => [markdown()],
    });

    this.register({
      id: 'shell',
      name: 'Shell / Bash',
      extensions: ['.sh', '.bash', '.zsh'],
      capabilities: { editing: true, highlighting: true, completion: 'none', diagnostics: 'none', formatting: 'none', localRun: false, cloudBuild: true, debugging: 'none' },
      getExtensions: () => [StreamLanguage.define(shell)],
    });

    this.register({
      id: 'dockerfile',
      name: 'Dockerfile',
      extensions: ['.dockerfile'],
      filenames: ['dockerfile', 'docker-compose.yml', 'docker-compose.yaml'],
      capabilities: { editing: true, highlighting: true, completion: 'none', diagnostics: 'none', formatting: 'none', localRun: false, cloudBuild: true, debugging: 'none' },
      getExtensions: () => [StreamLanguage.define(dockerFile)],
    });
  }

  public detectProvider(filePath: string): LanguageProvider {
    const normalized = filePath.toLowerCase();
    const filename = normalized.split('/').pop() || normalized;

    // Check exact filename matches first (e.g. Cargo.toml, Gemfile, Dockerfile)
    if (this.filenameMap.has(filename)) {
      return this.providers.get(this.filenameMap.get(filename)!)!;
    }

    // Check extension matches
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx !== -1) {
      const ext = filename.substring(dotIdx);
      if (this.extensionMap.has(ext)) {
        return this.providers.get(this.extensionMap.get(ext)!)!;
      }
    }

    // Default plaintext fallback
    return {
      id: 'plaintext',
      name: 'Plain Text',
      extensions: ['.txt'],
      capabilities: {
        editing: true,
        highlighting: false,
        completion: 'none',
        diagnostics: 'none',
        formatting: 'none',
        localRun: false,
        cloudBuild: false,
        debugging: 'none',
      },
      honestCapabilities: {
        editing: 'Available',
        syntaxHighlighting: 'Unsupported',
        completion: 'Unsupported',
        diagnostics: 'Unsupported',
        formatting: 'Unsupported',
        localExecution: 'Unsupported',
        localBuild: 'Unsupported',
        remoteBuild: 'Not configured',
        debugging: 'Unsupported',
      },
      getCapabilityStatus: (dim) => (dim === 'editing' ? 'Available' : dim === 'remoteBuild' ? 'Not configured' : 'Unsupported'),
      getExtensions: () => [],
    };
  }

  public getProvider(id: string): LanguageProvider | undefined {
    return this.providers.get(id);
  }

  public listAllProviders(): LanguageProvider[] {
    return Array.from(this.providers.values());
  }
}

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
import { WasmExecutionProvider } from './wasm-execution-provider.ts';

const NON_EXECUTABLE_SOURCE_EXTENSIONS: Record<string, { kind: ProjectKind; label: string; reason: string }> = {
  '.py': {
    kind: 'python',
    label: 'Python',
    reason: 'No local Python runtime (e.g. Pyodide/CPython) is bundled in Manifest Studio.',
  },
  '.pyw': {
    kind: 'python',
    label: 'Python',
    reason: 'No local Python runtime (e.g. Pyodide/CPython) is bundled in Manifest Studio.',
  },
  '.ts': {
    kind: 'typescript',
    label: 'TypeScript',
    reason: 'TypeScript transpilation is not bundled inside the client preview runtime. Use .js or .manifest for direct execution.',
  },
  '.tsx': {
    kind: 'typescript',
    label: 'TypeScript (TSX)',
    reason: 'TSX/JSX compilation is not bundled inside the client preview runtime.',
  },
  '.jsx': {
    kind: 'typescript',
    label: 'JSX',
    reason: 'JSX compilation is not bundled inside the client preview runtime.',
  },
  '.rs': {
    kind: 'rust',
    label: 'Rust',
    reason: 'Rust requires a native Cargo/rustc toolchain or remote CI build; raw .rs source cannot be compiled in-browser.',
  },
  '.c': {
    kind: 'native',
    label: 'C',
    reason: 'C requires a native Clang/GCC toolchain or precompiled .wasm binary.',
  },
  '.h': {
    kind: 'native',
    label: 'C Header',
    reason: 'C header files require a native C/C++ compiler toolchain.',
  },
  '.cpp': {
    kind: 'native',
    label: 'C++',
    reason: 'C++ requires a native Clang++/G++ toolchain or precompiled .wasm binary.',
  },
  '.cc': {
    kind: 'native',
    label: 'C++',
    reason: 'C++ requires a native Clang++/G++ toolchain or precompiled .wasm binary.',
  },
  '.hpp': {
    kind: 'native',
    label: 'C++ Header',
    reason: 'C++ header files require a native C++ compiler toolchain.',
  },
  '.go': {
    kind: 'native',
    label: 'Go',
    reason: 'Go requires a native Go toolchain or precompiled .wasm binary.',
  },
  '.java': {
    kind: 'native',
    label: 'Java',
    reason: 'Java requires a JDK compiler and JVM runtime.',
  },
  '.cs': {
    kind: 'native',
    label: 'C#',
    reason: 'C# requires the .NET SDK/runtime.',
  },
  '.php': {
    kind: 'native',
    label: 'PHP',
    reason: 'PHP requires a PHP interpreter runtime.',
  },
  '.rb': {
    kind: 'native',
    label: 'Ruby',
    reason: 'Ruby requires a Ruby interpreter runtime.',
  },
  '.swift': {
    kind: 'native',
    label: 'Swift',
    reason: 'Swift requires the Swift compiler toolchain.',
  },
  '.kt': {
    kind: 'native',
    label: 'Kotlin',
    reason: 'Kotlin requires the Kotlin compiler toolchain.',
  },
  '.dart': {
    kind: 'native',
    label: 'Dart',
    reason: 'Dart requires the Dart SDK.',
  },
  '.lua': {
    kind: 'native',
    label: 'Lua',
    reason: 'No local Lua VM is bundled in Manifest Studio.',
  },
  '.r': {
    kind: 'native',
    label: 'R',
    reason: 'R requires an R statistical runtime.',
  },
  '.jl': {
    kind: 'native',
    label: 'Julia',
    reason: 'Julia requires the Julia runtime.',
  },
  '.zig': {
    kind: 'native',
    label: 'Zig',
    reason: 'Zig requires a native Zig compiler toolchain or precompiled .wasm binary.',
  },
  '.ex': {
    kind: 'native',
    label: 'Elixir',
    reason: 'Elixir requires the Erlang/BEAM VM.',
  },
  '.exs': {
    kind: 'native',
    label: 'Elixir',
    reason: 'Elixir requires the Erlang/BEAM VM.',
  },
  '.hs': {
    kind: 'native',
    label: 'Haskell',
    reason: 'Haskell requires GHC.',
  },
  '.sql': {
    kind: 'native',
    label: 'SQL',
    reason: 'SQL files require a connected database engine.',
  },
  '.sh': {
    kind: 'native',
    label: 'Shell Script',
    reason: 'Shell scripts cannot be executed inside the browser sandbox.',
  },
  '.wat': {
    kind: 'native',
    label: 'WebAssembly Text (.wat)',
    reason: 'WAT text-to-binary assembly (wat2wasm) is not bundled; upload or import a compiled .wasm binary to execute.',
  },
};

export class ExecutionOrchestrator {
  private static instance: ExecutionOrchestrator;
  private providers: Map<string, ExecutionProvider> = new Map();
  private activeRunId: string | null = null;
  private runCounter = 0;

  private constructor() {
    this.registerProvider(new ManifestExecutionProvider());
    this.registerProvider(new StaticWebExecutionProvider());
    this.registerProvider(new WasmExecutionProvider());
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

  private getNonExecutableInfo(file?: ProjectFile): { kind: ProjectKind; label: string; reason: string } | null {
    if (!file) return null;
    const lower = file.path.toLowerCase();
    const dotIdx = lower.lastIndexOf('.');
    if (dotIdx !== -1) {
      const ext = lower.slice(dotIdx);
      if (NON_EXECUTABLE_SOURCE_EXTENSIONS[ext]) {
        return NON_EXECUTABLE_SOURCE_EXTENSIONS[ext];
      }
    }
    return null;
  }

  /**
   * Deterministically identifies the project kind based on active file first, then project configuration.
   * Never silently routes non-executable programming language files (.py, .rs, .c, .ts, etc.) to Manifest.
   */
  public detectProjectKind(project: ManifestProject, activeFile?: ProjectFile): ProjectKind {
    // 1. Active file context (highest precedence: direct user intent)
    if (activeFile) {
      const lowerPath = activeFile.path.toLowerCase();

      if (
        activeFile.language === 'manifest' ||
        activeFile.language === 'mbc' ||
        lowerPath.endsWith('.manifest') ||
        lowerPath.endsWith('.mbc') ||
        lowerPath === 'manifest.toml' ||
        (activeFile.language === 'plaintext' &&
          activeFile.content &&
          (activeFile.content.trimStart().startsWith('APP ') ||
            activeFile.content.trimStart().startsWith('PAGE ') ||
            activeFile.content.trimStart().startsWith('module ') ||
            activeFile.content.trimStart().startsWith('MODULE ')))
      ) {
        return 'manifest';
      }

      if (activeFile.language === 'wasm' || lowerPath.endsWith('.wasm')) {
        return 'wasm';
      }

      if (
        activeFile.language === 'html' ||
        lowerPath.endsWith('.html') ||
        lowerPath.endsWith('.htm') ||
        activeFile.language === 'css' ||
        lowerPath.endsWith('.css')
      ) {
        return 'web';
      }

      if (
        activeFile.language === 'javascript' ||
        lowerPath.endsWith('.js') ||
        lowerPath.endsWith('.mjs')
      ) {
        const hasHtml = project.files.some(
          (f) => f.language === 'html' || f.path.endsWith('.html') || f.path.endsWith('.htm')
        );
        return hasHtml ? 'web' : 'javascript';
      }

      if (lowerPath === 'anchor.toml') {
        return 'solana';
      }

      const nonExec = this.getNonExecutableInfo(activeFile);
      if (nonExec) {
        return nonExec.kind;
      }
    }

    // 2. Neutral/documentation files (e.g. README.md, .json) or no active file:
    //    consult explicit project.kind if set
    if (project.kind && project.kind !== 'mixed' && project.kind !== 'polyglot') {
      if (
        project.kind === 'manifest' ||
        project.kind === 'web' ||
        project.kind === 'wasm' ||
        project.kind === 'solana' ||
        project.kind === 'javascript'
      ) {
        return project.kind === 'solana' ? 'manifest' : (project.kind as ProjectKind);
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

    const hasHtml = project.files.some(
      (f) => f.path === 'index.html' || f.name === 'index.html' || f.path.endsWith('.html')
    );
    if (hasHtml) {
      return 'web';
    }

    const hasWasm = project.files.some((f) => f.path.endsWith('.wasm') || f.language === 'wasm');
    if (hasWasm) {
      return 'wasm';
    }

    const hasSolana = project.files.some((f) => f.path.endsWith('.rs') || f.path === 'Anchor.toml');
    if (hasSolana) {
      return 'solana';
    }

    return 'manifest';
  }

  /**
   * Selects the execution provider matching the detected project/file kind.
   */
  public selectProvider(project: ManifestProject, activeFile?: ProjectFile): ExecutionProvider {
    const kind = this.detectProjectKind(project, activeFile);

    for (const provider of this.providers.values()) {
      if (provider.supportedKinds.includes(kind)) {
        return provider;
      }
    }

    // Default to Manifest provider only when kind is manifest/solana
    return this.providers.get('manifest-provider') || new ManifestExecutionProvider();
  }

  /**
   * Orchestrates project execution, rejecting unsupported languages honestly without falling back
   * to unrelated workspace files, and flagging superseded asynchronous runs.
   */
  public async executeProject(
    project: ManifestProject,
    options: ExecutionOptions = {}
  ): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    this.runCounter++;
    const currentRunId = `run-${Date.now()}-${this.runCounter}`;
    this.activeRunId = currentRunId;

    const resolvedActivePath = options.activeFilePath || project.activeFilePath;
    const activeFile = resolvedActivePath
      ? project.files.find((f) => f.path === resolvedActivePath)
      : undefined;

    // Guard: If the user explicitly runs a non-executable source language file,
    // NEVER silently compile or preview src/main.manifest or index.html instead.
    const nonExec = this.getNonExecutableInfo(activeFile);
    if (nonExec && activeFile) {
      const msg = `Cannot execute "${activeFile.path}" (${nonExec.label}): ${nonExec.reason}`;
      return {
        runId: currentRunId,
        timestamp: Date.now(),
        success: false,
        providerId: 'unsupported-language',
        projectKind: nonExec.kind,
        previewKind: 'diagnostic-error',
        resolvedEntryPath: activeFile.path,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: msg,
            severity: 'error',
            source: 'orchestrator',
            hint: 'Select an executable file (.manifest, .html, .js, or compiled .wasm) to run locally.',
          },
        ],
        logs: [`[Execution Orchestrator] ${msg}`],
        durationMs: Math.round(performance.now() - startTime),
        error: msg,
      };
    }

    const kind = this.detectProjectKind(project, activeFile);
    const matchingProvider = Array.from(this.providers.values()).find((p) =>
      p.supportedKinds.includes(kind)
    );

    if (!matchingProvider) {
      const targetName = activeFile?.path || project.name;
      const msg = `No local execution provider is registered for project kind "${kind}" (${targetName}).`;
      return {
        runId: currentRunId,
        timestamp: Date.now(),
        success: false,
        providerId: 'unsupported-language',
        projectKind: kind,
        previewKind: 'diagnostic-error',
        resolvedEntryPath: activeFile?.path,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: msg,
            severity: 'error',
            source: 'orchestrator',
          },
        ],
        logs: [`[Execution Orchestrator] ${msg}`],
        durationMs: Math.round(performance.now() - startTime),
        error: msg,
      };
    }

    const enrichedOptions: ExecutionOptions = {
      ...options,
      activeFilePath: resolvedActivePath,
      runId: currentRunId,
    };

    const result = await matchingProvider.execute(project, enrichedOptions);

    // Stale run prevention: if another run started while this was awaiting, mark superseded
    if (this.activeRunId !== currentRunId) {
      return {
        ...result,
        superseded: true,
        logs: [...result.logs, `[Execution Orchestrator] Superseded by newer run (${this.activeRunId}).`],
      };
    }

    return result;
  }

  /**
   * Orchestrates project target artifact building without conflating Build with in-browser Run.
   */
  public async buildProject(
    project: ManifestProject,
    options: ExecutionOptions = {}
  ): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    this.runCounter++;
    const currentRunId = `build-${Date.now()}-${this.runCounter}`;

    const resolvedActivePath = options.activeFilePath || project.activeFilePath;
    const activeFile = resolvedActivePath
      ? project.files.find((f) => f.path === resolvedActivePath)
      : undefined;

    const nonExec = this.getNonExecutableInfo(activeFile);
    if (nonExec && activeFile) {
      const msg = `Cannot build "${activeFile.path}" (${nonExec.label}): ${nonExec.reason}`;
      return {
        runId: currentRunId,
        timestamp: Date.now(),
        success: false,
        providerId: 'unsupported-language',
        projectKind: nonExec.kind,
        previewKind: 'diagnostic-error',
        resolvedEntryPath: activeFile.path,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: msg,
            severity: 'error',
            source: 'orchestrator',
          },
        ],
        logs: [`[Build Orchestrator] ${msg}`],
        durationMs: Math.round(performance.now() - startTime),
        error: msg,
      };
    }

    const kind = this.detectProjectKind(project, activeFile);
    const matchingProvider = Array.from(this.providers.values()).find((p) =>
      p.supportedKinds.includes(kind)
    );

    if (!matchingProvider) {
      const msg = `No local build provider is registered for project kind "${kind}".`;
      return {
        runId: currentRunId,
        timestamp: Date.now(),
        success: false,
        providerId: 'unsupported-language',
        projectKind: kind,
        previewKind: 'diagnostic-error',
        resolvedEntryPath: activeFile?.path,
        diagnostics: [{ line: 1, column: 1, message: msg, severity: 'error', source: 'orchestrator' }],
        logs: [`[Build Orchestrator] ${msg}`],
        durationMs: Math.round(performance.now() - startTime),
        error: msg,
      };
    }

    const enrichedOptions: ExecutionOptions = {
      ...options,
      activeFilePath: resolvedActivePath,
      runId: currentRunId,
    };

    if (matchingProvider.build) {
      return matchingProvider.build(project, enrichedOptions);
    }
    return matchingProvider.execute(project, enrichedOptions);
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

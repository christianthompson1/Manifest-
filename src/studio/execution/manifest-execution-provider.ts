/**
 * Manifest Studio - Manifest Execution & Build Provider (v1.0)
 * Supports:
 * 1. Manifest VM (.mbc) — Compiles to portable .mbc bytecode, verifies, and executes on the Rust MVM (WASM).
 * 2. Direct .mbc binary execution — Verifies and runs workspace .mbc files on the Rust MVM.
 * 3. JavaScript / Web — Mounts reactive DOM apps (APP/PAGE) or capability-sandboxed Web modules.
 * 4. WebAssembly (.wasm) — Compiles numeric/control-flow Manifest modules to W3C .wasm and executes via WebAssembly VM.
 * 5. Native — Emits standalone safe Rust source (`build/<mod>.rs`) and reports host `rustc` requirement honestly.
 * 6. Solana (SBF) — Emits Anchor Rust + IDL JSON and runs deterministic local account simulation.
 */

import {
  ExecutionProvider,
  ProjectKind,
  ProviderCapability,
  ExecutionOptions,
  UnifiedExecutionResult,
} from './execution-types.ts';
import { ManifestProject, ProjectFile, StudioDiagnostic } from '../types.ts';
import {
  runManifestPipeline,
  decodeMbcFileContent,
} from '../compiler-service.ts';
import { WasmExecutionProvider } from './wasm-execution-provider.ts';
import {
  isLegacyDomainManifestSource,
  executeMbcInRustVm,
  disassembleMbcBytes,
  verifyMbcBytes,
  decodeMbcContainer,
  resolveCompilerTarget,
} from '../../../manifest-core/src/index.ts';
import { SolanaSimulator } from '../../../manifest-core/src/solana/solana-simulator.ts';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ManifestExecutionProvider implements ExecutionProvider {
  public readonly id = 'manifest-provider';
  public readonly name = 'Manifest Language & Rust MVM Runtime';
  public readonly supportedKinds: ProjectKind[] = ['manifest'];

  public detect(project: ManifestProject, activeFile?: ProjectFile): boolean {
    if (project.kind === 'manifest') return true;
    if (
      activeFile &&
      (activeFile.language === 'manifest' ||
        activeFile.language === 'mbc' ||
        activeFile.path.endsWith('.manifest') ||
        activeFile.path.endsWith('.mbc'))
    ) {
      return true;
    }
    return project.files.some(
      (f) =>
        f.language === 'manifest' ||
        f.language === 'mbc' ||
        f.path.endsWith('.manifest') ||
        f.path.endsWith('.mbc')
    );
  }

  private collectWorkspaceTextFiles(project: ManifestProject): Record<string, string> {
    const map: Record<string, string> = {};
    for (const f of project.files) {
      if (!f.isBinary && !f.path.endsWith('/.gitkeep')) {
        map[f.path] = f.content;
      }
    }
    return map;
  }

  private determineEffectiveTarget(
    source: string,
    project: ManifestProject,
    options: ExecutionOptions
  ): string {
    const explicit = options.compilerTarget || project.compilerTarget;
    if (explicit && explicit !== 'auto') {
      return explicit;
    }
    if (options.target && options.target !== 'js' && options.target !== 'auto') {
      return options.target;
    }
    if (isLegacyDomainManifestSource(source)) {
      const trimmed = source.trimStart();
      if (/^PROGRAM\s+/i.test(trimmed) && !/\bPAGE\s+/i.test(source)) {
        return 'solana-sbf';
      }
      return 'web-js';
    }
    // General-purpose Manifest v1.0 defaults to the portable Rust Manifest Virtual Machine (.mbc)!
    return 'mvm';
  }

  public async validate(
    project: ManifestProject,
    activeFile?: ProjectFile
  ): Promise<{ isValid: boolean; diagnostics: StudioDiagnostic[] }> {
    const resolved = this.resolveEntryFile(project, activeFile);
    if (!resolved.file) {
      return {
        isValid: false,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: resolved.error || 'No Manifest entry file found.',
            severity: 'error',
            source: 'validator',
          },
        ],
      };
    }

    if (resolved.file.language === 'mbc' || resolved.file.path.endsWith('.mbc')) {
      const bytes = decodeMbcFileContent(resolved.file.content);
      if (!bytes) {
        return {
          isValid: false,
          diagnostics: [{ line: 1, column: 1, message: 'Invalid .mbc binary payload.', severity: 'error', source: 'bytecode' }],
        };
      }
      try {
        const ver = verifyMbcBytes(bytes);
        return {
          isValid: ver.valid,
          diagnostics: ver.errors.map((m) => ({ line: 1, column: 1, message: m, severity: 'error', source: 'bytecode' })),
        };
      } catch (e: any) {
        return {
          isValid: false,
          diagnostics: [{ line: 1, column: 1, message: e.message || String(e), severity: 'error', source: 'bytecode' }],
        };
      }
    }

    const effectiveTarget = this.determineEffectiveTarget(resolved.file.content, project, {});
    const res = await runManifestPipeline(resolved.file.content, effectiveTarget, {
      profile: project.syntaxProfile,
      modulePath: resolved.file.path,
      files: this.collectWorkspaceTextFiles(project),
    });
    return {
      isValid: res.success,
      diagnostics: res.diagnostics,
    };
  }

  public async execute(
    project: ManifestProject,
    options: ExecutionOptions = {}
  ): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    const runId = options.runId || `manifest-run-${Date.now()}`;
    const activeFile = options.activeFilePath
      ? project.files.find((f) => f.path === options.activeFilePath)
      : undefined;
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
    const workspaceFiles = this.collectWorkspaceTextFiles(project);

    // ------------------------------------------------------------------------
    // Direct .mbc Bytecode Execution on Rust MVM
    // ------------------------------------------------------------------------
    if (entryFile.language === 'mbc' || entryFile.path.endsWith('.mbc')) {
      const mbcBytes = decodeMbcFileContent(entryFile.content);
      if (!mbcBytes) {
        const msg = `Failed to decode binary bytecode from "${entryFile.path}".`;
        return {
          runId,
          timestamp: Date.now(),
          success: false,
          providerId: this.id,
          projectKind: 'manifest',
          previewKind: 'diagnostic-error',
          resolvedEntryPath: entryFile.path,
          targetId: 'mvm',
          diagnostics: [{ line: 1, column: 1, message: msg, severity: 'error', source: 'bytecode' }],
          logs: [`[Rust MVM] ${msg}`],
          durationMs: Math.round(performance.now() - startTime),
          error: msg,
        };
      }
      return this.executeBytesOnRustMvm(runId, entryFile.path, mbcBytes, workspaceFiles, startTime);
    }

    const effectiveTarget = this.determineEffectiveTarget(entryFile.content, project, options);
    const targetMeta = resolveCompilerTarget(effectiveTarget);

    // Native target cannot execute inside the browser sandbox — report honestly!
    if (effectiveTarget === 'native') {
      const pipelineRes = await runManifestPipeline(entryFile.content, 'native', {
        profile: options.syntaxProfile || project.syntaxProfile,
        modulePath: entryFile.path,
        files: workspaceFiles,
      });
      const msg =
        'Native OS executables cannot run inside a browser sandbox. Use "Build" to emit standalone Rust source (build/*.rs) for host `rustc`, or select "Manifest VM (.mbc)" or "WebAssembly (.wasm)" to run directly in Studio.';
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: entryFile.path,
        targetId: 'native',
        targetStatus: 'requires-toolchain',
        syntaxProfile: pipelineRes.syntaxProfile,
        outputCode: pipelineRes.outputCode,
        ir: pipelineRes.ir,
        irText: pipelineRes.irText,
        capabilityAudit: pipelineRes.capabilityAudit,
        artifacts: pipelineRes.artifacts,
        diagnostics: [
          ...pipelineRes.diagnostics,
          {
            line: 1,
            column: 1,
            severity: 'error',
            source: 'compiler',
            code: 'E_NATIVE_BROWSER_SANDBOX',
            message: msg,
            hint: 'Click "Build" to generate standalone safe Rust source in build/, or switch target to Manifest VM (.mbc).',
          },
        ],
        logs: [`[Native Backend] ${msg}`],
        durationMs: Math.round(performance.now() - startTime),
        error: msg,
      };
    }

    const pipelineRes = await runManifestPipeline(entryFile.content, effectiveTarget, {
      profile: options.syntaxProfile || project.syntaxProfile,
      modulePath: entryFile.path,
      files: workspaceFiles,
    });

    if (!pipelineRes.success) {
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: entryFile.path,
        targetId: pipelineRes.targetId || effectiveTarget,
        targetStatus: pipelineRes.targetStatus || targetMeta?.status,
        syntaxProfile: pipelineRes.syntaxProfile,
        previewHtml: this.generateErrorHtml(entryFile.path, pipelineRes.diagnostics),
        outputCode: pipelineRes.outputCode,
        diagnostics: pipelineRes.diagnostics,
        logs: pipelineRes.diagnostics.map((d) => `[${d.severity.toUpperCase()}] line ${d.line}: ${d.message}`),
        durationMs: Math.round(performance.now() - startTime),
        ir: pipelineRes.ir,
        irText: pipelineRes.irText,
        disassembly: pipelineRes.disassembly,
        capabilityAudit: pipelineRes.capabilityAudit,
        error: pipelineRes.diagnostics[0]?.message || 'Compilation failed',
      };
    }

    // ------------------------------------------------------------------------
    // Target 1: Rust Manifest Virtual Machine (.mbc)
    // ------------------------------------------------------------------------
    if (effectiveTarget === 'mvm' && pipelineRes.mbcBytes) {
      return this.executeBytesOnRustMvm(
        runId,
        entryFile.path,
        pipelineRes.mbcBytes,
        workspaceFiles,
        startTime,
        pipelineRes
      );
    }

    // ------------------------------------------------------------------------
    // Target 2: Standalone WebAssembly (.wasm)
    // ------------------------------------------------------------------------
    if (effectiveTarget === 'wasm') {
      const wasmArtifact = pipelineRes.artifacts.find((a) => a.fileName.endsWith('.wasm'));
      if (wasmArtifact) {
        const wasmProvider = new WasmExecutionProvider();
        const syntheticProj: ManifestProject = {
          id: `${project.id}-wasm-exec`,
          name: project.name,
          kind: 'wasm',
          activeFilePath: wasmArtifact.fileName,
          files: [
            {
              id: 'compiled-wasm',
              name: wasmArtifact.fileName.split('/').pop() || 'module.wasm',
              path: wasmArtifact.fileName,
              language: 'wasm',
              content: wasmArtifact.content,
              isBinary: true,
              mimeType: 'application/wasm',
            },
          ],
        };
        const wasmExec = await wasmProvider.execute(syntheticProj, {
          activeFilePath: wasmArtifact.fileName,
          runId,
        });
        return {
          ...wasmExec,
          providerId: this.id,
          projectKind: 'manifest',
          resolvedEntryPath: entryFile.path,
          targetId: 'wasm',
          targetStatus: 'implemented',
          syntaxProfile: pipelineRes.syntaxProfile,
          outputCode: pipelineRes.outputCode,
          ir: pipelineRes.ir,
          irText: pipelineRes.irText,
          capabilityAudit: pipelineRes.capabilityAudit,
          artifacts: pipelineRes.artifacts,
          diagnostics: [...pipelineRes.diagnostics, ...wasmExec.diagnostics],
          logs: [
            `[WASM Backend] Compiled "${entryFile.path}" -> ${wasmArtifact.fileName} (${wasmArtifact.sizeBytes} bytes)`,
            ...wasmExec.logs,
          ],
          durationMs: Math.round(performance.now() - startTime),
        };
      }
    }

    // ------------------------------------------------------------------------
    // Target 3: Solana (SBF) Local Simulation + Anchor Codegen
    // ------------------------------------------------------------------------
    if (effectiveTarget === 'solana-sbf' || effectiveTarget === 'solana' || effectiveTarget === 'anchor') {
      const solanaProgram = pipelineRes.ir?.solanaProgram;
      const sim = new SolanaSimulator(solanaProgram);
      sim.initializeDefaultAccounts();
      const firstIx = solanaProgram?.instructions?.[0];
      let simStepSummary = 'Initialized program accounts';
      if (firstIx) {
        const tx = sim.executeInstruction(firstIx.name, 'Authority1111111111111111111111111111111111');
        simStepSummary = tx.success
          ? `Executed instruction "${firstIx.name}" (${tx.computeUnitsUsed} CU)`
          : `Instruction "${firstIx.name}" rejected: ${tx.error}`;
      }
      const durationMs = Math.round(performance.now() - startTime);
      return {
        runId,
        timestamp: Date.now(),
        success: true,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'terminal-output',
        resolvedEntryPath: entryFile.path,
        targetId: 'solana-sbf',
        targetStatus: 'implemented',
        previewHtml: this.generateSolanaPreviewHtml(
          entryFile.path,
          solanaProgram,
          simStepSummary,
          pipelineRes.outputCode || '',
          sim.exportAccounts()
        ),
        outputCode: pipelineRes.outputCode,
        ir: pipelineRes.ir,
        artifacts: pipelineRes.artifacts,
        diagnostics: pipelineRes.diagnostics,
        logs: [
          `[Solana Backend] Generated Anchor Rust & IDL for "${solanaProgram?.programName || entryFile.name}" in ${durationMs}ms`,
          `[Solana Simulator] ${simStepSummary}`,
        ],
        durationMs,
      };
    }

    // ------------------------------------------------------------------------
    // Target 4: JavaScript / Web (Legacy Declarative UI or Capability-Sandboxed v1.0 JS)
    // ------------------------------------------------------------------------
    const durationMs = Math.round(performance.now() - startTime);
    const isLegacyUi = isLegacyDomainManifestSource(entryFile.content);
    const previewHtml = isLegacyUi
      ? this.generateCanvasHtml(entryFile.name, pipelineRes.outputCode || '', pipelineRes.ir)
      : this.generateV1WebModuleHtml(entryFile.path, pipelineRes.outputCode || '', pipelineRes.capabilityAudit);

    return {
      runId,
      timestamp: Date.now(),
      success: true,
      providerId: this.id,
      projectKind: 'manifest',
      previewKind: 'manifest-canvas',
      resolvedEntryPath: entryFile.path,
      targetId: 'web-js',
      targetStatus: 'implemented',
      syntaxProfile: pipelineRes.syntaxProfile,
      previewHtml,
      outputCode: pipelineRes.outputCode,
      diagnostics: pipelineRes.diagnostics,
      logs: [`Program "${entryFile.path}" compiled to JavaScript / Web and mounted in ${durationMs}ms`],
      durationMs,
      ir: pipelineRes.ir,
      irText: pipelineRes.irText,
      capabilityAudit: pipelineRes.capabilityAudit,
      artifacts: pipelineRes.artifacts,
    };
  }

  public async build(
    project: ManifestProject,
    options: ExecutionOptions = {}
  ): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    const runId = options.runId || `manifest-build-${Date.now()}`;
    const activeFile = options.activeFilePath
      ? project.files.find((f) => f.path === options.activeFilePath)
      : undefined;
    const resolved = this.resolveEntryFile(project, activeFile);

    if (!resolved.file) {
      const errMessage = resolved.error || 'No Manifest entry file found to build.';
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'diagnostic-error',
        diagnostics: [{ line: 1, column: 1, message: errMessage, severity: 'error', source: 'compiler' }],
        logs: [`[Build] ${errMessage}`],
        durationMs: Math.round(performance.now() - startTime),
        error: errMessage,
      };
    }

    const entryFile = resolved.file;
    const effectiveTarget = this.determineEffectiveTarget(entryFile.content, project, options);
    const pipelineRes = await runManifestPipeline(entryFile.content, effectiveTarget, {
      profile: options.syntaxProfile || project.syntaxProfile,
      modulePath: entryFile.path,
      files: this.collectWorkspaceTextFiles(project),
    });

    const durationMs = Math.round(performance.now() - startTime);
    const artifactSummary = pipelineRes.artifacts
      .map((a) => `${a.fileName} (${a.sizeBytes} B)`)
      .join(', ');

    const logs: string[] = [];
    if (pipelineRes.success) {
      logs.push(
        `[Build OK] Target "${pipelineRes.targetId || effectiveTarget}" (${pipelineRes.syntaxProfile || 'auto'} profile) completed in ${durationMs}ms`
      );
      if (artifactSummary) {
        logs.push(`[Artifacts] ${artifactSummary}`);
      }
      if (effectiveTarget === 'native') {
        logs.push(
          `[Toolchain Info] Standalone safe Rust source emitted. Run \`manifest build ${entryFile.path} --target native\` on a host with \`rustc\` to produce a native OS binary.`
        );
      }
    } else {
      for (const d of pipelineRes.diagnostics) {
        logs.push(`[${d.severity.toUpperCase()}] line ${d.line}: ${d.message}`);
      }
    }

    return {
      runId,
      timestamp: Date.now(),
      success: pipelineRes.success,
      providerId: this.id,
      projectKind: 'manifest',
      previewKind: pipelineRes.success ? 'terminal-output' : 'diagnostic-error',
      resolvedEntryPath: entryFile.path,
      targetId: pipelineRes.targetId || effectiveTarget,
      targetStatus: pipelineRes.targetStatus,
      syntaxProfile: pipelineRes.syntaxProfile,
      outputCode: pipelineRes.outputCode,
      ir: pipelineRes.ir,
      irText: pipelineRes.irText,
      disassembly: pipelineRes.disassembly,
      capabilityAudit: pipelineRes.capabilityAudit,
      artifacts: pipelineRes.artifacts,
      diagnostics: pipelineRes.diagnostics,
      logs,
      durationMs,
      error: pipelineRes.success ? undefined : pipelineRes.diagnostics[0]?.message || 'Build failed',
    };
  }

  private async executeBytesOnRustMvm(
    runId: string,
    entryPath: string,
    mbcBytes: Uint8Array,
    workspaceFiles: Record<string, string>,
    startTime: number,
    pipelineRes?: any
  ): Promise<UnifiedExecutionResult> {
    let disassembly = pipelineRes?.disassembly || '';
    let grantedCaps: string[] = [];

    try {
      const decoded = decodeMbcContainer(mbcBytes);
      if (!disassembly) {
        disassembly = disassembleMbcBytes(mbcBytes);
      }
      grantedCaps = Array.from(
        new Set([...decoded.requires, ...decoded.imports.map((imp) => imp.capability)])
      ).filter((c) => !decoded.denies.includes(c));
    } catch (err: any) {
      const msg = `Bytecode container decode error: ${err.message || String(err)}`;
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: entryPath,
        targetId: 'mvm',
        diagnostics: [{ line: 1, column: 1, message: msg, severity: 'error', source: 'bytecode' }],
        logs: [`[Rust MVM] ${msg}`],
        durationMs: Math.round(performance.now() - startTime),
        error: msg,
      };
    }

    const vmRes = await executeMbcInRustVm(mbcBytes, {
      entryFunction: 'main',
      grantedCapabilities: grantedCaps.length > 0 ? grantedCaps : ['console'],
      virtualFiles: workspaceFiles,
      maxSteps: 1_000_000,
    });

    const durationMs = Math.round(performance.now() - startTime);

    if (!vmRes.ok) {
      const trapMsg = vmRes.error || 'Rust MVM trap';
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'manifest',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: entryPath,
        targetId: 'mvm',
        targetStatus: 'implemented',
        syntaxProfile: pipelineRes?.syntaxProfile,
        disassembly,
        ir: pipelineRes?.ir,
        irText: pipelineRes?.irText,
        capabilityAudit: pipelineRes?.capabilityAudit,
        outputCode: disassembly,
        artifacts: pipelineRes?.artifacts,
        diagnostics: [
          ...(pipelineRes?.diagnostics || []),
          {
            line: 1,
            column: 1,
            message: `Rust MVM Runtime Trap: ${trapMsg}`,
            severity: 'error',
            source: 'bytecode',
          },
        ],
        logs: [
          ...vmRes.stdout.map((s) => `[stdout] ${s}`),
          `[Rust MVM Trap] ${trapMsg}`,
        ],
        durationMs,
        error: trapMsg,
      };
    }

    const previewHtml = this.generateMvmPreviewHtml({
      entryPath,
      profile: pipelineRes?.syntaxProfile || 'bytecode',
      mbcSizeBytes: mbcBytes.length,
      returnValue: vmRes.returnValue,
      stdout: vmRes.stdout,
      steps: vmRes.steps,
      grantedCaps,
      durationMs,
    });

    const logs: string[] = [
      `[Rust MVM] Verified & executed "${entryPath}" (${mbcBytes.length} bytes .mbc, ${vmRes.steps} VM steps) in ${durationMs}ms`,
      ...vmRes.stdout.map((line) => `[stdout] ${line}`),
      `[Rust MVM] Return value: ${vmRes.returnValue}`,
    ];

    return {
      runId,
      timestamp: Date.now(),
      success: true,
      providerId: this.id,
      projectKind: 'manifest',
      previewKind: 'terminal-output',
      resolvedEntryPath: entryPath,
      targetId: 'mvm',
      targetStatus: 'implemented',
      syntaxProfile: pipelineRes?.syntaxProfile,
      previewHtml,
      outputCode: disassembly,
      ir: pipelineRes?.ir,
      irText: pipelineRes?.irText,
      disassembly,
      capabilityAudit: pipelineRes?.capabilityAudit,
      returnValue: vmRes.returnValue,
      vmSteps: vmRes.steps,
      artifacts: pipelineRes?.artifacts,
      diagnostics: pipelineRes?.diagnostics || [],
      logs,
      durationMs,
    };
  }

  public getCapabilities(): ProviderCapability {
    return {
      editing: true,
      syntaxHighlighting: true,
      localExecution: true,
      localBuild: true,
      offlineReady: true,
      previewSupported: true,
      requiredRuntime: 'Rust Manifest Virtual Machine v1.0 (WASM) + Web Runtime',
      runtimeInstallStatus: 'installed',
    };
  }

  public isOfflineReady(): boolean {
    return true;
  }

  private resolveEntryFile(
    project: ManifestProject,
    activeFile?: ProjectFile
  ): { file?: ProjectFile; error?: string } {
    if (
      activeFile &&
      (activeFile.language === 'manifest' ||
        activeFile.language === 'mbc' ||
        activeFile.path.endsWith('.manifest') ||
        activeFile.path.endsWith('.mbc'))
    ) {
      return { file: activeFile };
    }

    if (project.entryPath) {
      const explicit = project.files.find((f) => f.path === project.entryPath);
      if (explicit) return { file: explicit };
      return {
        error: `Configured project entry file "${project.entryPath}" does not exist in workspace.`,
      };
    }

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

    const convention = project.files.find((f) => f.path === 'src/main.manifest');
    if (convention) return { file: convention };

    const manifestFiles = project.files.filter(
      (f) => f.language === 'manifest' || f.path.endsWith('.manifest')
    );
    if (manifestFiles.length >= 1) {
      return { file: manifestFiles[0] };
    }

    return { error: 'No Manifest (.manifest or .mbc) entry file found in project.' };
  }

  private generateMvmPreviewHtml(info: {
    entryPath: string;
    profile: string;
    mbcSizeBytes: number;
    returnValue: string;
    stdout: string[];
    steps: number;
    grantedCaps: string[];
    durationMs: number;
  }): string {
    const stdoutHtml =
      info.stdout.length > 0
        ? info.stdout.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join('')
        : `<div class="muted">(no console output emitted)</div>`;

    const capsText = info.grantedCaps.length > 0 ? info.grantedCaps.join(', ') : 'none (pure deterministic)';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Rust MVM Execution</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1f1f1f;
      color: #cccccc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 20px;
      font-size: 13px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding-bottom: 12px;
      border-bottom: 1px solid #2d2d2d;
      margin-bottom: 16px;
    }
    .title { color: #ffffff; font-weight: 600; font-size: 14px; }
    .meta { color: #858585; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat {
      background: #181818;
      border: 1px solid #2d2d2d;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .stat-label { color: #858585; font-size: 11px; margin-bottom: 4px; }
    .stat-val { color: #9cdcfe; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 600; }
    .stat-val.green { color: #89d185; }
    .section-title {
      color: #858585;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .stdout-box {
      background: #181818;
      border: 1px solid #2d2d2d;
      border-radius: 6px;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #d4d4d4;
      min-height: 80px;
      white-space: pre-wrap;
    }
    .muted { color: #666666; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">Rust Manifest Virtual Machine (MVM v1.0)</div>
    <div class="meta">${escapeHtml(info.entryPath)} &bull; ${escapeHtml(info.profile)}</div>
  </div>
  <div class="grid">
    <div class="stat">
      <div class="stat-label">Return Value</div>
      <div class="stat-val green">${escapeHtml(info.returnValue)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Executed MVM Instructions</div>
      <div class="stat-val">${info.steps.toLocaleString()} steps (${info.durationMs}ms)</div>
    </div>
    <div class="stat">
      <div class="stat-label">Verified .mbc Container</div>
      <div class="stat-val">${info.mbcSizeBytes.toLocaleString()} bytes</div>
    </div>
    <div class="stat">
      <div class="stat-label">Granted Host Capabilities</div>
      <div class="stat-val">${escapeHtml(capsText)}</div>
    </div>
  </div>
  <div class="section-title">Standard Output</div>
  <div class="stdout-box">${stdoutHtml}</div>
</body>
</html>`;
  }

  private generateV1WebModuleHtml(entryPath: string, compiledJs: string, capabilityAudit?: any): string {
    const caps = (capabilityAudit?.required || []).join(', ') || 'none (network & storage isolated)';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Manifest Web JS Execution</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1f1f1f; color: #cccccc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 20px; font-size: 13px; }
    .hdr { padding-bottom: 10px; border-bottom: 1px solid #2d2d2d; margin-bottom: 14px; display: flex; justify-content: space-between; }
    .title { color: #ffffff; font-weight: 600; }
    .sub { color: #858585; font-family: monospace; font-size: 11px; }
    .box { background: #181818; border: 1px solid #2d2d2d; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap; margin-bottom: 12px; }
    .ret { color: #89d185; font-weight: 600; }
  </style>
</head>
<body>
  <div class="hdr">
    <div class="title">JavaScript / Web Target (Capability-Restricted)</div>
    <div class="sub">${escapeHtml(entryPath)}</div>
  </div>
  <div class="box">Capabilities: ${escapeHtml(caps)}</div>
  <div id="manifest-root" class="box">Running module...</div>
  <script type="module">
    ${compiledJs}
    const outEl = document.getElementById('manifest-root');
    const lines = [];
    try {
      const mod = createManifestModule({
        console: (msg) => {
          lines.push(String(msg));
          try { window.parent.postMessage({ type: 'manifest-output', payload: String(msg) }, '*'); } catch (_) {}
        }
      });
      const ret = typeof mod.main === 'function' ? mod.main() : undefined;
      const renderedReturn = typeof ret === 'bigint' ? ret.toString() : JSON.stringify(ret);
      outEl.innerHTML = (lines.length ? lines.join('\\n') + '\\n\\n' : '') + '<span class="ret">Return: ' + renderedReturn + '</span>';
    } catch (err) {
      outEl.style.color = '#f85149';
      outEl.textContent = 'Runtime Trap: ' + (err.message || String(err));
      try { window.parent.postMessage({ type: 'manifest-output', payload: 'Runtime Trap: ' + (err.message || String(err)) }, '*'); } catch (_) {}
    }
  </script>
</body>
</html>`;
  }

  private generateSolanaPreviewHtml(
    entryPath: string,
    program: any,
    stepSummary: string,
    rustCode: string,
    accounts: Record<string, any>
  ): string {
    const accRows = Object.entries(accounts)
      .map(
        ([pk, acc]: [string, any]) =>
          `<div class="stat"><div class="stat-label">${escapeHtml(pk.slice(0, 16))}...</div><div class="stat-val">${escapeHtml(JSON.stringify(acc.data))}</div></div>`
      )
      .join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Solana SBF Simulation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1f1f1f; color: #cccccc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 20px; font-size: 13px; }
    .hdr { padding-bottom: 10px; border-bottom: 1px solid #2d2d2d; margin-bottom: 14px; }
    .title { color: #ffffff; font-weight: 600; font-size: 14px; }
    .sub { color: #89d185; font-family: monospace; font-size: 11px; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 14px; }
    .stat { background: #181818; border: 1px solid #2d2d2d; border-radius: 6px; padding: 10px; font-family: monospace; font-size: 11px; }
    .stat-label { color: #858585; margin-bottom: 4px; }
    .stat-val { color: #9cdcfe; }
    pre { background: #181818; border: 1px solid #2d2d2d; border-radius: 6px; padding: 12px; font-size: 11px; overflow-x: auto; color: #d4d4d4; }
  </style>
</head>
<body>
  <div class="hdr">
    <div class="title">Solana (SBF) Anchor Target &bull; ${escapeHtml(program?.programName || entryPath)}</div>
    <div class="sub">${escapeHtml(stepSummary)}</div>
  </div>
  <div class="grid">${accRows}</div>
  <pre>${escapeHtml(rustCode)}</pre>
</body>
</html>`;
  }

  private generateCanvasHtml(title: string, compiledJs: string, ir?: any): string {
    const appName = ir?.appName || title || 'Manifest Application';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(appName)}</title>
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
  <div id="manifest-root"></div>

  <script type="module">
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
      <div style="background:#261619;border:1px solid #5a1d1d;padding:12px;margin-bottom:8px;border-radius:6px;">
        <div style="color:#f87171;font-weight:600;font-size:13px;">Line ${d.line}, Column ${d.column}: ${escapeHtml(d.message)}</div>
        ${d.hint ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px;">Hint: ${escapeHtml(d.hint)}</div>` : ''}
        ${d.example ? `<div style="color:#60a5fa;font-size:11px;margin-top:4px;font-family:monospace;">Example: ${escapeHtml(d.example)}</div>` : ''}
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
    h2 { color: #f87171; font-size: 15px; margin-top: 0; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h2>Build Issues in ${escapeHtml(filename)}</h2>
  ${errorItems || '<div style="color:#9ca3af;">Compilation halted with unspecified diagnostic.</div>'}
</body>
</html>`;
  }
}

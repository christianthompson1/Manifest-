import { formatManifestSource } from './core/formatter.ts';
import { SyntaxProfile } from './core/profile.ts';
import {
  checkManifestInRust,
  compileManifestInRust,
  RustAstSummary,
} from './engine/rust-engine.ts';
import type { OptimizationPassStats } from './ir/ir-optimizer.ts';
import type { MIRModule } from './ir/typed-ir.ts';
import { evaluateMIRModule } from './runtime/semantic-evaluator.ts';
import type { SemanticEvalResult } from './runtime/semantic-evaluator.ts';
import type { CapabilityAuditReport } from './semantics/capability-analyzer.ts';
import type { WorkspaceFiles } from './semantics/module-resolver.ts';
import type { SemanticDiagnostic } from './semantics/types.ts';
import { compileSolanaProgramSource } from './solana/solana-compiler.ts';
import { buildNativeTargetSourceOnly } from './targets/native-target.ts';
import {
  CompilerTargetArtifact,
  CompilerTargetSpec,
  resolveCompilerTarget,
} from './targets/target-registry.ts';
import { compileMIRToWasm } from './targets/wasm-target.ts';
import { compileMIRToWebJS } from './targets/web-js-target.ts';
import {
  executeMbcInRustVm,
  MvmExecutionOptions,
  MvmExecutionResponse,
} from './vm/mvm-runner.ts';

export interface ManifestPipelineOptions {
  profile?: SyntaxProfile | 'auto';
  target?: string;
  entryFile?: string;
  files?: WorkspaceFiles;
  optimize?: boolean;
}

export interface ManifestCheckSummary {
  ok: boolean;
  compilerEngine?: string;
  compilerVersion?: string;
  resolvedProfile: SyntaxProfile;
  isDomainExtension: boolean;
  domainKind?: 'solana-contract';
  astSummary?: RustAstSummary;
  capabilityAudit?: CapabilityAuditReport;
  mir?: MIRModule;
  irText?: string;
  optimizationStats?: OptimizationPassStats;
  diagnostics: SemanticDiagnostic[];
}

export interface ManifestV1BuildResult {
  success: boolean;
  compilerEngine?: string;
  target: CompilerTargetSpec;
  resolvedProfile: SyntaxProfile;
  diagnostics: SemanticDiagnostic[];
  capabilityAudit?: CapabilityAuditReport;
  mir?: MIRModule;
  irText?: string;
  mbcBytes?: Uint8Array;
  disassembly?: string;
  wasmBytes?: Uint8Array;
  watText?: string;
  jsCode?: string;
  htmlPreview?: string;
  rustCode?: string;
  idlJson?: string;
  artifacts: CompilerTargetArtifact[];
  limitations: string[];
}

/**
 * Authoritative Stage 6 frontend & IR check: routes lexing, parsing, multi-file module linking,
 * static type checking, capability/effect analysis, Typed MIR lowering, and optimization
 * directly through the compiled Rust compiler engine (`manifest-compiler` via `mvm-wasm`).
 */
export async function checkManifestSource(
  source: string,
  options: ManifestPipelineOptions = {}
): Promise<ManifestCheckSummary> {
  const res = await checkManifestInRust(source, {
    profile: options.profile,
    entryFile: options.entryFile,
    files: options.files,
    optimize: options.optimize,
  });
  return {
    ok: res.ok,
    compilerEngine: res.engine,
    compilerVersion: res.engineVersion,
    resolvedProfile: res.resolvedProfile,
    isDomainExtension: res.isDomainExtension,
    domainKind: res.domainKind,
    astSummary: res.astSummary,
    capabilityAudit: res.capabilityAudit,
    mir: res.mir,
    irText: res.irText,
    optimizationStats: res.optimizationStats,
    diagnostics: res.diagnostics,
  };
}

/**
 * Compiles a Manifest program (Beginner or Professional profile) to the selected
 * compilation target (`mvm`, `web-js`, `wasm`, `native`, `solana-sbf`, or planned targets)
 * using the authoritative Rust compiler engine.
 */
export async function compileManifestV1(
  source: string,
  options: ManifestPipelineOptions = {}
): Promise<ManifestV1BuildResult> {
  const target = resolveCompilerTarget(options.target);

  if (target.id === 'mvm') {
    const rustBuild = await compileManifestInRust(source, {
      profile: options.profile,
      entryFile: options.entryFile,
      files: options.files,
      optimize: options.optimize,
    });

    if (rustBuild.isDomainExtension) {
      return {
        success: false,
        compilerEngine: rustBuild.engine,
        target,
        resolvedProfile: rustBuild.resolvedProfile,
        diagnostics: rustBuild.diagnostics,
        artifacts: [],
        limitations: target.limitations,
      };
    }

    if (!rustBuild.ok || !rustBuild.mbcBytes) {
      return {
        success: false,
        compilerEngine: rustBuild.engine,
        target,
        resolvedProfile: rustBuild.resolvedProfile,
        diagnostics: rustBuild.diagnostics,
        capabilityAudit: rustBuild.capabilityAudit,
        mir: rustBuild.mir,
        irText: rustBuild.irText,
        artifacts: [],
        limitations: target.limitations,
      };
    }

    const modBase = (rustBuild.moduleName || 'main').replace(/[^a-zA-Z0-9_-]/g, '_');
    const disassembly = rustBuild.disassembly || '';
    const artifacts: CompilerTargetArtifact[] = [
      {
        filename: `build/${modBase}.mbc`,
        mimeType: 'application/x-manifest-bytecode',
        isBinary: true,
        bytes: rustBuild.mbcBytes,
      },
      {
        filename: `build/${modBase}.disasm.txt`,
        mimeType: 'text/plain',
        isBinary: false,
        text: disassembly,
      },
      {
        filename: `build/${modBase}.mir.txt`,
        mimeType: 'text/plain',
        isBinary: false,
        text: rustBuild.irText || '',
      },
    ];

    return {
      success: true,
      compilerEngine: rustBuild.engine,
      target,
      resolvedProfile: rustBuild.resolvedProfile,
      diagnostics: rustBuild.diagnostics,
      capabilityAudit: rustBuild.capabilityAudit,
      mir: rustBuild.mir,
      irText: rustBuild.irText,
      mbcBytes: rustBuild.mbcBytes,
      disassembly,
      artifacts,
      limitations: target.limitations,
    };
  }

  const check = await checkManifestSource(source, options);

  if (target.status === 'planned') {
    return {
      success: false,
      compilerEngine: check.compilerEngine,
      target,
      resolvedProfile: check.resolvedProfile,
      diagnostics: [
        ...check.diagnostics,
        {
          code: 'E_TARGET_PLANNED',
          severity: 'error',
          message: `Compilation target '${target.name}' has status 'Planned' and is not yet implemented.`,
          line: 1,
          column: 1,
          hint: 'Select Manifest VM (.mbc), JavaScript / Web, WebAssembly (.wasm), Native, or Solana (SBF).',
        },
      ],
      artifacts: [],
      limitations: target.limitations,
    };
  }

  if (check.isDomainExtension) {
    if (target.id === 'solana-sbf') {
      return compileSolanaExtension(source, target, check);
    }
    return {
      success: false,
      compilerEngine: check.compilerEngine,
      target,
      resolvedProfile: check.resolvedProfile,
      diagnostics: check.diagnostics.some((d) => d.severity === 'error')
        ? check.diagnostics
        : [
            ...check.diagnostics,
            {
              code: 'E_SOLANA_TARGET_ONLY',
              severity: 'error',
              message: `Solana smart contract source ('PROGRAM ... END') must target 'solana-sbf', not '${target.id}'.`,
              line: 1,
              column: 1,
            },
          ],
      artifacts: [],
      limitations: target.limitations,
    };
  }

  if (!check.ok || !check.mir) {
    return {
      success: false,
      compilerEngine: check.compilerEngine,
      target,
      resolvedProfile: check.resolvedProfile,
      diagnostics: check.diagnostics,
      capabilityAudit: check.capabilityAudit,
      artifacts: [],
      limitations: target.limitations,
    };
  }

  const mir = check.mir;
  const modBase = (mir.moduleName || 'main').replace(/[^a-zA-Z0-9_-]/g, '_');

  switch (target.id) {
    case 'web-js': {
      const web = compileMIRToWebJS(mir);
      return {
        success: true,
        compilerEngine: check.compilerEngine,
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: check.diagnostics,
        capabilityAudit: check.capabilityAudit,
        mir,
        irText: check.irText,
        jsCode: web.jsCode,
        htmlPreview: web.htmlPreview,
        artifacts: [
          {
            filename: 'dist/app.js',
            mimeType: 'text/javascript',
            isBinary: false,
            text: web.jsCode,
          },
          {
            filename: 'dist/index.html',
            mimeType: 'text/html',
            isBinary: false,
            text: web.htmlPreview,
          },
        ],
        limitations: target.limitations,
      };
    }

    case 'wasm': {
      const wasmRes = compileMIRToWasm(mir);
      const allDiags = [...check.diagnostics, ...wasmRes.diagnostics];
      if (!wasmRes.success || !wasmRes.wasmBytes) {
        return {
          success: false,
          compilerEngine: check.compilerEngine,
          target,
          resolvedProfile: check.resolvedProfile,
          diagnostics: allDiags,
          capabilityAudit: check.capabilityAudit,
          mir,
          irText: check.irText,
          artifacts: [],
          limitations: target.limitations,
        };
      }
      return {
        success: true,
        compilerEngine: check.compilerEngine,
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: allDiags,
        capabilityAudit: check.capabilityAudit,
        mir,
        irText: check.irText,
        wasmBytes: wasmRes.wasmBytes,
        watText: wasmRes.watText,
        artifacts: [
          {
            filename: `build/${modBase}.wasm`,
            mimeType: 'application/wasm',
            isBinary: true,
            bytes: wasmRes.wasmBytes,
          },
          {
            filename: `build/${modBase}.wat`,
            mimeType: 'text/plain',
            isBinary: false,
            text: wasmRes.watText || '',
          },
        ],
        limitations: target.limitations,
      };
    }

    case 'native': {
      const nat = buildNativeTargetSourceOnly(mir);
      return {
        success: nat.success,
        compilerEngine: check.compilerEngine,
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: [...check.diagnostics, ...nat.diagnostics],
        capabilityAudit: check.capabilityAudit,
        mir,
        irText: check.irText,
        rustCode: nat.rustSource,
        artifacts: [
          {
            filename: `build/${modBase}.rs`,
            mimeType: 'text/x-rust',
            isBinary: false,
            text: nat.rustSource,
          },
        ],
        limitations: target.limitations,
      };
    }

    case 'solana-sbf': {
      return {
        success: false,
        compilerEngine: check.compilerEngine,
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: [
          ...check.diagnostics,
          {
            code: 'E_SOLANA_CONTRACT_REQUIRED',
            severity: 'error',
            message:
              'Solana (SBF) target requires a smart-contract PROGRAM declaration (e.g. PROGRAM Counter ... END). For general-purpose Manifest programs, select Manifest VM (.mbc), JavaScript / Web, WebAssembly (.wasm), or Native.',
            line: 1,
            column: 1,
          },
        ],
        capabilityAudit: check.capabilityAudit,
        mir,
        irText: check.irText,
        artifacts: [],
        limitations: target.limitations,
      };
    }

    default:
      return {
        success: false,
        compilerEngine: check.compilerEngine,
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: check.diagnostics,
        artifacts: [],
        limitations: target.limitations,
      };
  }
}

function compileSolanaExtension(
  source: string,
  target: CompilerTargetSpec,
  check: ManifestCheckSummary
): ManifestV1BuildResult {
  const solRes = compileSolanaProgramSource(source);
  return {
    success: solRes.success,
    compilerEngine: check.compilerEngine,
    target,
    resolvedProfile: check.resolvedProfile,
    diagnostics: [
      ...check.diagnostics.filter((d) => d.code !== 'E_SOLANA_TARGET_ONLY'),
      ...solRes.diagnostics,
    ],
    rustCode: solRes.rustCode,
    idlJson: solRes.idlJson,
    artifacts: solRes.artifacts,
    limitations: target.limitations,
  };
}

export interface ManifestV1RunResult {
  ok: boolean;
  target: CompilerTargetSpec;
  resolvedProfile: SyntaxProfile;
  build: ManifestV1BuildResult;
  vmResult?: MvmExecutionResponse;
  referenceResult?: SemanticEvalResult;
  stdout: string[];
  returnValue: string;
  stepsExecuted: number;
  error?: string;
}

/**
 * Compiles and executes a Manifest v1.0 program through the Rust Manifest Virtual Machine (`mvm`).
 */
export async function runManifestOnRustMvm(
  source: string,
  options: ManifestPipelineOptions & MvmExecutionOptions = {}
): Promise<ManifestV1RunResult> {
  const build = await compileManifestV1(source, { ...options, target: 'mvm' });
  if (!build.success || !build.mbcBytes) {
    const firstErr = build.diagnostics.find((d) => d.severity === 'error');
    return {
      ok: false,
      target: build.target,
      resolvedProfile: build.resolvedProfile,
      build,
      stdout: [],
      returnValue: 'void',
      stepsExecuted: 0,
      error: firstErr ? `${firstErr.code}: ${firstErr.message}` : 'Compilation failed',
    };
  }

  const grantedCapabilities = options.grantedCapabilities ?? ['console'];
  const vmResult = await executeMbcInRustVm(build.mbcBytes, {
    ...options,
    grantedCapabilities,
  });

  return {
    ok: vmResult.ok,
    target: build.target,
    resolvedProfile: build.resolvedProfile,
    build,
    vmResult,
    stdout: vmResult.stdout,
    returnValue: vmResult.returnValue,
    stepsExecuted: vmResult.steps,
    error: vmResult.error,
  };
}

export { formatManifestSource, evaluateMIRModule };

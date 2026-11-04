import { compileMIRToMbc } from './bytecode/mbc-compiler.ts';
import { disassembleMbcBytes, verifyMbcBytes } from './bytecode/mbc-reader.ts';
import { compileManifest as compileLegacyManifest } from './compiler/compiler.ts';
import { SemanticModule } from './core/ast-v2.ts';
import { printSemanticModule } from './core/formatter.ts';
import { detectSyntaxProfile, SyntaxProfile } from './core/profile.ts';
import { ManifestError } from './errors/manifest-error.ts';
import { optimizeMIR, OptimizationPassStats } from './ir/ir-optimizer.ts';
import { formatMIRModule, MIRModule } from './ir/typed-ir.ts';
import { buildTypedIR } from './ir/typed-ir-builder.ts';
import { evaluateMIRModule, SemanticEvalResult } from './runtime/semantic-evaluator.ts';
import {
  analyzeCapabilitiesAndEffects,
  CapabilityAuditReport,
} from './semantics/capability-analyzer.ts';
import { resolveModuleGraph, WorkspaceFiles } from './semantics/module-resolver.ts';
import { TypeChecker, TypeCheckResult } from './semantics/type-checker.ts';
import { SemanticDiagnostic } from './semantics/types.ts';
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
  verifyMbcInRustVm,
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
  resolvedProfile: SyntaxProfile;
  isDomainExtension: boolean;
  domainKind?: 'web-ui' | 'solana-contract';
  ast?: SemanticModule;
  typeCheck?: TypeCheckResult;
  capabilityAudit?: CapabilityAuditReport;
  mir?: MIRModule;
  irText?: string;
  optimizationStats?: OptimizationPassStats;
  diagnostics: SemanticDiagnostic[];
}

export interface ManifestV1BuildResult {
  success: boolean;
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
 * Runs profile-aware lexing, parsing, multi-file module linking, static type checking,
 * capability/effect analysis, and Typed IR generation + optimization.
 */
export function checkManifestSource(
  source: string,
  options: ManifestPipelineOptions = {}
): ManifestCheckSummary {
  const resolvedProfile = detectSyntaxProfile(source, options.profile);
  const diagnostics: SemanticDiagnostic[] = [];

  try {
    const graph = resolveModuleGraph(source, {
      entryFile: options.entryFile || 'src/main.manifest',
      profile: resolvedProfile,
      files: options.files,
    });
    diagnostics.push(...graph.diagnostics);

    const ast = graph.mergedModule;

    // Domain extensions (`APP`/`PAGE` Web UI or `PROGRAM` Solana Contract)
    if (ast.hasDomainExtensions.webUI || ast.hasDomainExtensions.solanaContract) {
      const domainKind = ast.hasDomainExtensions.solanaContract ? 'solana-contract' : 'web-ui';
      return {
        ok: diagnostics.every((d) => d.severity !== 'error'),
        resolvedProfile: ast.profile,
        isDomainExtension: true,
        domainKind,
        ast,
        diagnostics,
      };
    }

    const typeChecker = new TypeChecker();
    const typeCheck = typeChecker.check(ast);
    diagnostics.push(...typeCheck.diagnostics);

    const capabilityAudit = analyzeCapabilitiesAndEffects(ast);
    diagnostics.push(...capabilityAudit.diagnostics);

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    if (hasErrors) {
      return {
        ok: false,
        resolvedProfile: ast.profile,
        isDomainExtension: false,
        ast,
        typeCheck,
        capabilityAudit,
        diagnostics,
      };
    }

    const rawMir = buildTypedIR(ast, typeCheck, capabilityAudit);
    let finalMir = rawMir;
    let optimizationStats: OptimizationPassStats | undefined;

    if (options.optimize !== false) {
      const opt = optimizeMIR(rawMir);
      finalMir = opt.module;
      optimizationStats = opt.stats;
      diagnostics.push(...opt.warnings);
    }

    return {
      ok: true,
      resolvedProfile: ast.profile,
      isDomainExtension: false,
      ast,
      typeCheck,
      capabilityAudit,
      mir: finalMir,
      irText: formatMIRModule(finalMir),
      optimizationStats,
      diagnostics,
    };
  } catch (err: any) {
    if (err instanceof ManifestError) {
      diagnostics.push({
        code: 'E_SYNTAX',
        severity: 'error',
        message: err.message,
        line: err.line || 1,
        column: err.column || 1,
        file: options.entryFile,
        hint: err.hint,
      });
    } else {
      diagnostics.push({
        code: 'E_SYNTAX',
        severity: 'error',
        message: err?.message || String(err),
        line: 1,
        column: 1,
        file: options.entryFile,
      });
    }
    return {
      ok: false,
      resolvedProfile,
      isDomainExtension: false,
      diagnostics,
    };
  }
}

/**
 * Compiles a Manifest program (Beginner or Professional profile) to the selected
 * compilation target (`mvm`, `web-js`, `wasm`, `native`, `solana-sbf`, or planned targets).
 */
export async function compileManifestV1(
  source: string,
  options: ManifestPipelineOptions = {}
): Promise<ManifestV1BuildResult> {
  const target = resolveCompilerTarget(options.target);
  const check = checkManifestSource(source, options);

  if (target.status === 'planned') {
    return {
      success: false,
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

  // Handle legacy UI `APP` / `PAGE` or `PROGRAM` Solana domain modules transparently
  if (check.isDomainExtension) {
    const legacyTarget =
      target.id === 'solana-sbf' || check.domainKind === 'solana-contract' ? 'solana' : 'js';
    try {
      const legacy = await compileLegacyManifest(source, legacyTarget, { sourceMaps: true });
      const legacyDiagnostics: SemanticDiagnostic[] = [
        ...check.diagnostics,
        ...legacy.diagnostics.map((d) => ({
          code: 'E_DOMAIN',
          severity: d.severity,
          message: d.message,
          line: d.line || 1,
          column: d.column || 1,
          hint: d.hint,
        })),
      ];
      const artifacts: CompilerTargetArtifact[] = [];
      if (legacyTarget === 'solana' && legacy.outputCode) {
        artifacts.push({
          filename: 'build/lib.rs',
          mimeType: 'text/x-rust',
          isBinary: false,
          text: legacy.outputCode,
        });
        const idlArt = legacy.artifacts?.find((a) => a.fileName.endsWith('.json'));
        if (idlArt) {
          artifacts.push({
            filename: 'build/idl.json',
            mimeType: 'application/json',
            isBinary: false,
            text: idlArt.content,
          });
        }
      } else if (legacy.outputCode) {
        artifacts.push({
          filename: 'dist/app.js',
          mimeType: 'text/javascript',
          isBinary: false,
          text: legacy.outputCode,
        });
      }

      const idlArt = legacy.artifacts?.find((a) => a.fileName.endsWith('.json'));
      return {
        success: legacy.success && legacyDiagnostics.every((d) => d.severity !== 'error'),
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: legacyDiagnostics,
        jsCode: legacyTarget === 'js' ? legacy.outputCode : undefined,
        rustCode: legacyTarget === 'solana' ? legacy.outputCode : undefined,
        idlJson: legacyTarget === 'solana' ? idlArt?.content : undefined,
        artifacts,
        limitations: target.limitations,
      };
    } catch (err: any) {
      return {
        success: false,
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: [
          ...check.diagnostics,
          {
            code: 'E_LEGACY_COMPILE',
            severity: 'error',
            message: err?.message || String(err),
            line: err?.line || 1,
            column: err?.column || 1,
          },
        ],
        artifacts: [],
        limitations: target.limitations,
      };
    }
  }

  if (!check.ok || !check.mir) {
    return {
      success: false,
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
    case 'mvm': {
      const compiled = compileMIRToMbc(mir);
      const tsVerify = verifyMbcBytes(compiled.bytes);
      if (!tsVerify.valid) {
        return {
          success: false,
          target,
          resolvedProfile: check.resolvedProfile,
          diagnostics: [
            ...check.diagnostics,
            ...tsVerify.errors.map((e) => ({
              code: 'E_MBC_VERIFY',
              severity: 'error' as const,
              message: e,
              line: 1,
              column: 1,
            })),
          ],
          capabilityAudit: check.capabilityAudit,
          mir,
          irText: check.irText,
          artifacts: [],
          limitations: target.limitations,
        };
      }

      const rustVerify = await verifyMbcInRustVm(compiled.bytes);
      if (!rustVerify.ok) {
        return {
          success: false,
          target,
          resolvedProfile: check.resolvedProfile,
          diagnostics: [
            ...check.diagnostics,
            {
              code: 'E_MVM_VERIFY',
              severity: 'error',
              message: rustVerify.error || 'Rust MVM bytecode verification failed',
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

      const disassembly = disassembleMbcBytes(compiled.bytes);
      const artifacts: CompilerTargetArtifact[] = [
        {
          filename: `build/${modBase}.mbc`,
          mimeType: 'application/x-manifest-bytecode',
          isBinary: true,
          bytes: compiled.bytes,
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
          text: check.irText || '',
        },
      ];

      return {
        success: true,
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: check.diagnostics,
        capabilityAudit: check.capabilityAudit,
        mir,
        irText: check.irText,
        mbcBytes: compiled.bytes,
        disassembly,
        artifacts,
        limitations: target.limitations,
      };
    }

    case 'web-js': {
      const web = compileMIRToWebJS(mir);
      return {
        success: true,
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
        target,
        resolvedProfile: check.resolvedProfile,
        diagnostics: check.diagnostics,
        artifacts: [],
        limitations: target.limitations,
      };
  }
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

  // Default granted capabilities: if caller doesn't override, grant `console` by default
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

/**
 * Converts Manifest source code between Beginner and Professional profiles,
 * or formats it canonically within its current profile.
 */
export function formatManifestSource(
  source: string,
  targetProfile?: SyntaxProfile
): { ok: boolean; formatted?: string; error?: string; diagnostics: SemanticDiagnostic[] } {
  const check = checkManifestSource(source, { profile: 'auto', optimize: false });
  if (!check.ast) {
    const firstErr = check.diagnostics.find((d) => d.severity === 'error');
    return {
      ok: false,
      error: firstErr?.message || 'Unable to parse source for formatting',
      diagnostics: check.diagnostics,
    };
  }
  if (check.isDomainExtension) {
    return {
      ok: true,
      formatted:
        source
          .split('\n')
          .map((l) => l.trimEnd())
          .join('\n')
          .trim() + '\n',
      diagnostics: check.diagnostics,
    };
  }
  return {
    ok: true,
    formatted: printSemanticModule(check.ast, targetProfile ?? check.resolvedProfile),
    diagnostics: check.diagnostics,
  };
}

export { evaluateMIRModule };

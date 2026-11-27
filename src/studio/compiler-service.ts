/**
 * Manifest Studio - Unified Canonical Compiler Service (v1.0)
 * Coordinates:
 * 1. General-purpose Manifest v1.0 (Beginner & Professional Syntax Profiles -> Rust Compiler Engine ->
 *    Static TypeChecker -> Capability & Effect Analyzer -> Typed MIR -> Optimizer ->
 *    .mbc Bytecode / Web JS / Standalone .wasm / Native Rust).
 * 2. Standalone Solana Contract (`PROGRAM ... END`) compilation to Anchor Rust + IDL JSON.
 */

import {
  compileManifestV1,
  resolveCompilerTarget,
  isSolanaProgramSource,
  parseSolanaProgramSource,
  SyntaxProfile,
} from '../../manifest-core/src/index.ts';
import { encodeWasmDataUrl } from './execution/wasm-execution-provider.ts';
import { BuildArtifact, BuildResult, StudioDiagnostic } from './types.ts';

export function encodeMbcDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return `data:application/x-manifest-bytecode;base64,${b64}`;
}

export function decodeMbcFileContent(content: string): Uint8Array | null {
  try {
    const raw = content.startsWith('data:') ? content.split(',')[1] || '' : content.trim();
    if (!raw) return null;
    if (typeof atob === 'function') {
      const bin = atob(raw);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(raw, 'base64'));
  } catch {
    return null;
  }
}

export interface StudioPipelineOptions {
  profile?: SyntaxProfile | 'auto';
  modulePath?: string;
  files?: Record<string, string>;
}

export async function runManifestPipeline(
  source: string,
  target = 'mvm',
  options: StudioPipelineOptions = {}
): Promise<BuildResult> {
  const startTime = performance.now();
  const diagnostics: StudioDiagnostic[] = [];
  const normalizedInputTarget =
    target === 'js'
      ? 'mvm'
      : target === 'solana' || target === 'anchor'
        ? 'solana-sbf'
        : target;
  const targetMeta = resolveCompilerTarget(normalizedInputTarget);

  if (targetMeta && targetMeta.status === 'planned') {
    diagnostics.push({
      line: 1,
      column: 1,
      severity: 'error',
      source: 'compiler',
      code: 'E_TARGET_PLANNED',
      message: `Target "${targetMeta.name}" (${targetMeta.id}) is Planned and not yet implemented in Manifest v1.0.`,
      hint: 'Select Manifest VM (.mbc), JavaScript / Web, WebAssembly (.wasm), Native, or Solana (SBF).',
    });
    return {
      success: false,
      timestamp: Date.now(),
      target: targetMeta.id,
      targetId: targetMeta.id,
      targetStatus: targetMeta.status,
      artifacts: [],
      diagnostics,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const effectiveTarget = targetMeta?.id || normalizedInputTarget;

  const v1Res = await compileManifestV1(source, {
    profile: options.profile === 'auto' ? undefined : options.profile,
    entryFile: options.modulePath || 'src/main.manifest',
    files: options.files,
    target: effectiveTarget,
    optimize: true,
  });

  for (const d of v1Res.diagnostics) {
    diagnostics.push({
      line: d.line || 1,
      column: d.column || 1,
      message: d.message,
      severity: d.severity,
      source:
        d.code?.startsWith('E_CAP') || d.code?.startsWith('E_EFF')
          ? 'capability'
          : 'compiler',
      code: d.code,
      hint: d.hint,
    });
  }

  const artifacts: BuildArtifact[] = v1Res.artifacts.map((art) => {
    if (art.isBinary && art.bytes) {
      const isWasm = art.filename.endsWith('.wasm');
      const encoded = isWasm ? encodeWasmDataUrl(art.bytes) : encodeMbcDataUrl(art.bytes);
      return {
        fileName: art.filename,
        fileType: isWasm ? 'wasm' : 'mbc',
        content: encoded,
        sizeBytes: art.bytes.byteLength,
        isBinary: true,
        mimeType: art.mimeType,
      };
    }
    const textContent = art.text || '';
    const fileType = art.filename.endsWith('.rs')
      ? 'rust'
      : art.filename.endsWith('.js')
        ? 'javascript'
        : art.filename.endsWith('.html')
          ? 'html'
          : art.filename.endsWith('.json')
            ? 'json'
            : art.filename.endsWith('.toml')
              ? 'toml'
              : 'text';
    return {
      fileName: art.filename,
      fileType,
      content: textContent,
      sizeBytes: new TextEncoder().encode(textContent).byteLength,
    };
  });

  const primaryTextOutput =
    v1Res.jsCode ||
    v1Res.rustCode ||
    v1Res.watText ||
    v1Res.disassembly ||
    v1Res.irText;

  let irPayload: any = v1Res.mir;
  if (effectiveTarget === 'solana-sbf' && isSolanaProgramSource(source)) {
    const parsedSol = parseSolanaProgramSource(source);
    if (parsedSol.program) {
      irPayload = {
        appName: parsedSol.program.programName || 'SolanaProgram',
        solanaProgram: parsedSol.program,
      };
    }
  }

  return {
    success: v1Res.success,
    timestamp: Date.now(),
    target: effectiveTarget,
    targetId: v1Res.target.id,
    targetStatus: v1Res.target.status,
    syntaxProfile: v1Res.resolvedProfile,
    artifacts,
    diagnostics,
    outputCode: primaryTextOutput,
    ir: irPayload,
    irText: v1Res.irText,
    disassembly: v1Res.disassembly,
    capabilityAudit: v1Res.capabilityAudit,
    mbcBytes: v1Res.mbcBytes,
    durationMs: Math.round(performance.now() - startTime),
  };
}

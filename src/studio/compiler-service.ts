/**
 * Manifest Studio - Unified Compiler Service (v1.0 + Legacy Domain Pipeline)
 * Coordinates:
 * 1. General-purpose Manifest v1.0 (Beginner & Professional Syntax Profiles -> SemanticModule ->
 *    Static TypeChecker -> Capability & Effect Analyzer -> Typed MIR -> Optimizer ->
 *    .mbc Bytecode / Web JS / Standalone .wasm / Native Rust).
 * 2. Declarative Web UI (APP / PAGE) & Solana Contract (PROGRAM) domain compilation.
 */

import {
  Lexer,
  Parser,
  Validator,
  generateManifestIRFromAST,
  compileManifestIR,
  ManifestError,
  isLegacyDomainManifestSource,
  compileManifestV1,
  resolveCompilerTarget,
  SyntaxProfile,
} from '../../manifest-core/src/index.ts';
import { AnchorGenerator } from '../../manifest-core/src/solana/anchor-generator.ts';
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
  target = 'js',
  options: StudioPipelineOptions = {}
): Promise<BuildResult> {
  const startTime = performance.now();
  const diagnostics: StudioDiagnostic[] = [];
  const targetMeta = resolveCompilerTarget(target);

  // Reject planned targets honestly across all profiles
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
      target,
      targetId: targetMeta.id,
      targetStatus: targetMeta.status,
      artifacts: [],
      diagnostics,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // ==========================================================================
  // PATH A: General-Purpose Manifest v1.0 (Beginner & Professional Profiles)
  // ==========================================================================
  if (!isLegacyDomainManifestSource(source)) {
    const effectiveTarget =
      target === 'js' ? 'mvm' : targetMeta?.id || target;

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
        source: d.code?.startsWith('E_CAP') || d.code?.startsWith('E_EFF') ? 'capability' : 'compiler',
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
      return {
        fileName: art.filename,
        fileType: art.filename.endsWith('.rs')
          ? 'rust'
          : art.filename.endsWith('.js')
            ? 'javascript'
            : art.filename.endsWith('.html')
              ? 'html'
              : 'text',
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
      ir: v1Res.mir,
      irText: v1Res.irText,
      disassembly: v1Res.disassembly,
      capabilityAudit: v1Res.capabilityAudit,
      mbcBytes: v1Res.mbcBytes,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // ==========================================================================
  // PATH B: Declarative Web UI (APP / PAGE) & Solana Contract (PROGRAM)
  // ==========================================================================
  try {
    let tokens: any[];
    try {
      tokens = new Lexer(source).tokenize();
    } catch (err: any) {
      diagnostics.push({
        line: err.line || 1,
        column: err.column || 1,
        message: err.message || String(err),
        severity: 'error',
        source: 'lexer',
        hint: err.hint,
        example: err.example,
        sourceLine: err.sourceLine,
      });
      return {
        success: false,
        timestamp: Date.now(),
        target,
        artifacts: [],
        diagnostics,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    let ast: any;
    try {
      ast = new Parser(tokens, source).parse();
    } catch (err: any) {
      diagnostics.push({
        line: err.line || 1,
        column: err.column || 1,
        message: err.message || String(err),
        severity: 'error',
        source: 'parser',
        hint: err.hint,
        example: err.example,
        sourceLine: err.sourceLine,
      });
      return {
        success: false,
        timestamp: Date.now(),
        target,
        artifacts: [],
        diagnostics,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    const validation = new Validator(ast, source).validate(ast);
    for (const issue of validation.issues) {
      diagnostics.push({
        line: issue.line || 1,
        column: issue.column || 1,
        message: issue.message,
        severity: issue.severity || 'error',
        source: 'validator',
        hint: issue.hint,
        example: issue.example,
      });
    }

    if (!validation.isValid) {
      return {
        success: false,
        timestamp: Date.now(),
        target,
        artifacts: [],
        diagnostics,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    let ir: any;
    try {
      ir = generateManifestIRFromAST(ast);
    } catch (err: any) {
      diagnostics.push({
        line: err.line || 1,
        column: err.column || 1,
        message: `IR generation failed: ${err.message || String(err)}`,
        severity: 'error',
        source: 'ir',
        hint: err.hint,
        example: err.example,
      });
      return {
        success: false,
        timestamp: Date.now(),
        target,
        artifacts: [],
        diagnostics,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    // Solana SBF / Anchor Rust Target for PROGRAM declarations
    if (target === 'solana-sbf' || target === 'solana' || target === 'anchor') {
      const solanaProgram = (ir as any).solanaProgram || extractSolanaProgramFromAst(ast);
      if (!solanaProgram) {
        diagnostics.push({
          line: 1,
          column: 1,
          severity: 'error',
          source: 'compiler',
          code: 'E_NO_SOLANA_PROGRAM',
          message: 'Solana (SBF) target requires a `PROGRAM <Name> ... END` smart contract declaration.',
          hint: 'Switch target to JavaScript / Web for UI apps, or declare a PROGRAM block.',
        });
        return {
          success: false,
          timestamp: Date.now(),
          target: 'solana-sbf',
          targetId: 'solana-sbf',
          targetStatus: 'implemented',
          artifacts: [],
          diagnostics,
          ir,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      const generated = AnchorGenerator.generate(solanaProgram);
      const idlJson = JSON.stringify(generated.idl, null, 2);
      const progSlug = solanaProgram.programName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      return {
        success: true,
        timestamp: Date.now(),
        target: 'solana-sbf',
        targetId: 'solana-sbf',
        targetStatus: 'implemented',
        artifacts: [
          {
            fileName: `programs/${progSlug}/src/lib.rs`,
            fileType: 'rust',
            content: generated.rustCode,
            sizeBytes: new Blob([generated.rustCode]).size,
          },
          {
            fileName: `idl/${progSlug}.json`,
            fileType: 'json',
            content: idlJson,
            sizeBytes: new Blob([idlJson]).size,
          },
        ],
        diagnostics,
        outputCode: generated.rustCode,
        ir: { ...ir, solanaProgram },
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    // Declarative UI apps require Web DOM; reject non-Web targets cleanly
    if (target === 'mvm' || target === 'wasm' || target === 'native') {
      diagnostics.push({
        line: 1,
        column: 1,
        severity: 'error',
        source: 'compiler',
        code: 'E_UI_REQUIRES_WEB_TARGET',
        message: `Declarative Web UI programs (APP / PAGE) require the "JavaScript / Web" target rather than "${target}".`,
        hint: 'Switch Compiler Target to "JavaScript / Web", or write a general-purpose Manifest module (`module` / `MODULE`) to compile to MVM (.mbc), WASM, or Native.',
      });
      return {
        success: false,
        timestamp: Date.now(),
        target,
        targetId: target,
        artifacts: [],
        diagnostics,
        ir,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    const legacyTarget = target === 'web-js' ? 'js' : target;
    const compilationResult = await compileManifestIR(ir, legacyTarget);

    if (!compilationResult.success) {
      for (const diag of compilationResult.diagnostics) {
        diagnostics.push({
          line: diag.line || 1,
          column: diag.column || 1,
          message: diag.message,
          severity: diag.severity,
          source: 'compiler',
          hint: diag.hint,
        });
      }

      return {
        success: false,
        timestamp: Date.now(),
        target,
        artifacts: [],
        diagnostics,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    for (const diag of compilationResult.diagnostics || []) {
      diagnostics.push({
        line: diag.line || 1,
        column: diag.column || 1,
        message: diag.message,
        severity: diag.severity,
        source: 'compiler',
        hint: diag.hint,
      });
    }

    const artifacts = (compilationResult.artifacts || []).map((art) => ({
      fileName: art.fileName,
      fileType: art.fileType,
      content: art.content,
      sizeBytes: new Blob([art.content]).size,
    }));

    return {
      success: true,
      timestamp: Date.now(),
      target: 'web-js',
      targetId: 'web-js',
      targetStatus: 'implemented',
      syntaxProfile: 'beginner',
      artifacts,
      diagnostics,
      outputCode: compilationResult.outputCode,
      ir: compilationResult.ir || ir,
      durationMs: Math.round(performance.now() - startTime),
    };
  } catch (err: any) {
    if (err instanceof ManifestError) {
      diagnostics.push({
        line: err.line || 1,
        column: err.column || 1,
        message: err.message,
        severity: 'error',
        source: (err.phase as any) || 'compiler',
        hint: err.hint,
        example: err.example,
        sourceLine: err.sourceLine,
      });
    } else {
      diagnostics.push({
        line: 1,
        column: 1,
        message: `Unexpected compilation error: ${err.message || String(err)}`,
        severity: 'error',
        source: 'compiler',
      });
    }

    return {
      success: false,
      timestamp: Date.now(),
      target,
      artifacts: [],
      diagnostics,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

function extractSolanaProgramFromAst(ast: any): any | null {
  const stmts = ast?.body || ast?.statements || [];
  const progNode = stmts.find((s: any) => s.type === 'ProgramDeclaration' || s.kind === 'Program');
  if (!progNode) return null;
  const programName = progNode.name || 'ManifestContract';
  const accounts = (progNode.accounts || []).map((acc: any) => ({
    name: acc.name,
    fields: (acc.fields || []).map((f: any) => ({
      name: f.name,
      fieldType: String(f.dataType || f.fieldType || 'u64').toLowerCase() === 'address' ? 'pubkey' : 'u64',
    })),
  }));
  const instructions = (progNode.instructions || []).map((ix: any) => ({
    name: ix.name,
    accounts: [
      {
        name: 'state',
        isMut: true,
        isSigner: false,
        accountType: accounts[0]?.name || `${programName}State`,
      },
      { name: 'authority', isMut: true, isSigner: true },
    ],
    requires: ix.requires || [],
    mutations: ix.mutations || [],
    cpis: ix.cpis || [],
  }));
  return {
    programName,
    programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
    accounts,
    instructions,
  };
}

/**
 * Manifest Studio - Compiler Service
 * Coordinates the full compiler pipeline:
 * Manifest Source -> Lexer -> Parser -> Validator -> Manifest IR -> JS Target Compiler.
 */

import {
  inspectManifest,
  generateManifestIR,
  compileManifest,
  ManifestError,
} from '../../manifest-core/src/index.ts';
import { BuildResult, StudioDiagnostic } from './types.ts';

export async function runManifestPipeline(source: string, target = 'js'): Promise<BuildResult> {
  const startTime = performance.now();
  const diagnostics: StudioDiagnostic[] = [];

  try {
    // 1. Lexing, Parsing & Semantic Validation
    const inspection = inspectManifest(source);

    if (inspection.validation && !inspection.validation.isValid) {
      for (const issue of inspection.validation.issues) {
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

      if (diagnostics.some((d) => d.severity === 'error')) {
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

    // 2. IR Generation
    let ir: any;
    try {
      ir = generateManifestIR(source);
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

    // 3. Target Compiler (JavaScript)
    const compilationResult = await compileManifest(source, target);

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

    // Map compiler artifacts
    const artifacts = (compilationResult.artifacts || []).map((art) => ({
      fileName: art.fileName,
      fileType: art.fileType,
      content: art.content,
      sizeBytes: new Blob([art.content]).size,
    }));

    return {
      success: true,
      timestamp: Date.now(),
      target,
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

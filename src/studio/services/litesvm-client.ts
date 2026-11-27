/**
 * Manifest Studio - LiteSVM Client
 * Coordinates execution of LiteSVM tests between the browser Studio UI
 * and the server-side native LiteSVM runtime.
 * Never silently substitutes in-browser JS simulation for LiteSVM execution.
 */

import { SolanaProgramIR } from '../../../manifest-core/src/solana/solana-ir.ts';
import type { LiteSVMTestSuiteResult } from '../../../manifest-core/src/solana/litesvm-types.ts';
import { AnchorGenerator } from '../../../manifest-core/src/solana/anchor-generator.ts';

export class LiteSVMClient {
  public static async executeTests(
    program: SolanaProgramIR,
    fetchImpl: typeof fetch = fetch
  ): Promise<LiteSVMTestSuiteResult> {
    const startTime = performance.now();
    const compilation = AnchorGenerator.generate(program);

    try {
      const response = await fetchImpl('/api/solana/litesvm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program }),
      });

      if (!response.ok) {
        return {
          success: false,
          status: 'not-run',
          execution: 'unavailable',
          backend: 'unavailable',
          programName: program.programName,
          programId: program.programId,
          durationMs: Math.round(performance.now() - startTime),
          stepsCount: 0,
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          unsupportedCount: 0,
          notRunCount: 0,
          totalComputeUnits: 0,
          steps: [],
          idl: compilation.idl,
          rustGenerated: Boolean(compilation.rustCode),
          error: `LiteSVM server backend unavailable (/api/solana/litesvm returned HTTP ${response.status})`,
        };
      }

      const data = await response.json();
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.success !== 'boolean' ||
        !Array.isArray(data.steps)
      ) {
        return {
          success: false,
          status: 'failed',
          execution: 'unavailable',
          backend: 'unavailable',
          programName: program.programName,
          programId: program.programId,
          durationMs: Math.round(performance.now() - startTime),
          stepsCount: 0,
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          unsupportedCount: 0,
          notRunCount: 0,
          totalComputeUnits: 0,
          steps: [],
          idl: compilation.idl,
          rustGenerated: Boolean(compilation.rustCode),
          error: 'Malformed response from /api/solana/litesvm',
        };
      }

      return data as LiteSVMTestSuiteResult;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        status: 'not-run',
        execution: 'unavailable',
        backend: 'unavailable',
        programName: program.programName,
        programId: program.programId,
        durationMs: Math.round(performance.now() - startTime),
        stepsCount: 0,
        passedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        unsupportedCount: 0,
        notRunCount: 0,
        totalComputeUnits: 0,
        steps: [],
        idl: compilation.idl,
        rustGenerated: Boolean(compilation.rustCode),
        error: `LiteSVM server backend unreachable (/api/solana/litesvm): ${message}`,
      };
    }
  }
}

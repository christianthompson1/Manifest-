/**
 * Manifest Studio - Test Runner Modal
 * Runs comprehensive Manifest language tests & Solana LiteSVM verification suites
 * via the full-stack server-side test runner.
 */

import React, { useState } from 'react';
import { Play, CheckCircle2, XCircle, AlertTriangle, Zap, X, RefreshCw, Cpu, Layers } from 'lucide-react';
import { LiteSVMTestSuiteResult } from '../types.ts';
import {
  executeAndParseTestRun,
  ParsedTestRunState,
} from '../../../manifest-core/src/verification/result-model.ts';

interface TestRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSource: string;
  onShowToast?: (msg: string) => void;
}

export const TestRunnerModal: React.FC<TestRunnerModalProps> = ({
  isOpen,
  onClose,
  currentSource,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'litesvm' | 'manifest-suite'>('litesvm');
  const [isRunning, setIsRunning] = useState(false);
  const [litesvmReport, setLitesvmReport] = useState<LiteSVMTestSuiteResult | null>(null);
  const [suiteState, setSuiteState] = useState<ParsedTestRunState | null>(null);

  if (!isOpen) return null;

  const handleRunLiteSVM = async () => {
    setIsRunning(true);
    setLitesvmReport(null);
    try {
      const res = await fetch('/api/solana/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: currentSource }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server verification failed: HTTP ${res.status}`);
      }

      setLitesvmReport(data.litesvm);
      onShowToast?.(`LiteSVM execution: ${data.litesvm.success ? 'PASSED' : 'FAILED'} (${data.litesvm.totalComputeUnits} CU)`);
    } catch (err: any) {
      setLitesvmReport({
        success: false,
        status: 'failed',
        execution: 'unavailable',
        backend: 'unavailable',
        programName: 'Program',
        programId: '',
        durationMs: 0,
        stepsCount: 0,
        passedCount: 0,
        failedCount: 1,
        skippedCount: 0,
        unsupportedCount: 0,
        notRunCount: 0,
        totalComputeUnits: 0,
        steps: [],
        idl: null,
        rustGenerated: false,
        error: err.message || String(err),
      });
      onShowToast?.(`Error: ${err.message || String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunManifestSuite = async () => {
    setIsRunning(true);
    setSuiteState(null);

    try {
      const parsed = await executeAndParseTestRun();
      setSuiteState(parsed);
      onShowToast?.(
        parsed.ok
          ? `Manifest suite passed (${parsed.passed}/${parsed.total})`
          : `Test suite ${parsed.status === 'error' ? 'error' : 'failed'}: ${parsed.error || ''}`
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-3xl bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="h-12 border-b border-[#2d2d2d] bg-[#252526] px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#89d185]" />
            <span className="font-semibold text-sm text-[#ffffff]">Verification & Test Bench</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Strip */}
        <div className="flex border-b border-[#2d2d2d] bg-[#181818] px-4 text-xs justify-between items-center">
          <div className="flex">
            <button
              onClick={() => setActiveTab('litesvm')}
              className={`py-2 px-3 border-b-2 font-medium transition cursor-pointer ${
                activeTab === 'litesvm'
                  ? 'border-[#89d185] text-[#89d185]'
                  : 'border-transparent text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              LiteSVM Program Verification
            </button>
            <button
              onClick={() => setActiveTab('manifest-suite')}
              className={`py-2 px-3 border-b-2 font-medium transition cursor-pointer ${
                activeTab === 'manifest-suite'
                  ? 'border-[#569cd6] text-[#569cd6]'
                  : 'border-transparent text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              Full Language Suite
            </button>
          </div>

          <button
            onClick={activeTab === 'litesvm' ? handleRunLiteSVM : handleRunManifestSuite}
            disabled={isRunning}
            className="py-1 px-3 rounded-md bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-white font-medium flex items-center gap-1.5 transition cursor-pointer my-1.5"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>Run {activeTab === 'litesvm' ? 'LiteSVM Suite' : 'All Tests'}</span>
              </>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {activeTab === 'litesvm' ? (
            <div>
              {litesvmReport ? (
                <div className="space-y-4">
                  {/* Status Banner */}
                  <div
                    className={`p-3 rounded-lg border flex items-center justify-between ${
                      litesvmReport.success
                        ? 'bg-[#1b2a1e] border-[#2ea043]/50 text-[#89d185]'
                        : 'bg-[#2d1818] border-[#f14c4c]/50 text-[#f14c4c]'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {litesvmReport.success ? (
                        <CheckCircle2 className="w-4 h-4 text-[#89d185]" />
                      ) : (
                        <XCircle className="w-4 h-4 text-[#f14c4c]" />
                      )}
                      <span>
                        {litesvmReport.success
                          ? `LiteSVM Runtime Checks Passed (${litesvmReport.passedCount} executed${
                              litesvmReport.skippedCount > 0
                                ? `, ${litesvmReport.skippedCount} skipped / uncompiled SBF`
                                : ''
                            })`
                          : `LiteSVM Execution Failed: ${litesvmReport.error || 'Unknown error'}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-[#cca700]" />
                        <strong>{(litesvmReport.totalComputeUnits || 0).toLocaleString()} CU</strong>
                      </span>
                      <span>
                        {litesvmReport.passedCount} Passed / {litesvmReport.skippedCount || 0} Skipped
                      </span>
                    </div>
                  </div>

                  {/* Steps Breakdown */}
                  <div className="space-y-2">
                    <div className="font-semibold text-[11px] text-[#858585] uppercase tracking-wider">
                      Execution &amp; Analysis Steps
                    </div>
                    {(litesvmReport.steps || []).map((step, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-[#252526] border border-[#2d2d2d] space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-medium text-[#ffffff]">
                            {step.status === 'passed' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#89d185]" />
                            ) : step.status === 'skipped' || step.status === 'unsupported' || step.status === 'not-run' ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-[#cca700]" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-[#f14c4c]" />
                            )}
                            <span>Step {idx + 1}: {step.stepName}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase ${
                                step.status === 'passed'
                                  ? 'bg-[#183a21] text-[#89d185]'
                                  : step.status === 'skipped' || step.execution === 'analyzed-only'
                                  ? 'bg-[#2d2518] text-[#cca700]'
                                  : 'bg-[#4d1f24] text-[#f14c4c]'
                              }`}
                            >
                              {step.execution === 'analyzed-only' ? 'ANALYZED (NOT RUN)' : step.status}
                            </span>
                            <span className="text-[11px] font-mono text-[#cca700]">
                              {step.computeUnitsUsed} CU
                            </span>
                          </div>
                        </div>

                        {step.reason && (
                          <div className="text-[10px] text-[#cca700]">
                            {step.reason}
                          </div>
                        )}

                        {step.signature && (
                          <div className="text-[10px] font-mono text-[#858585] truncate">
                            Tx Sig: {step.signature}
                          </div>
                        )}

                        {step.logs && step.logs.length > 0 && (
                          <div className="p-2 rounded bg-[#181818] font-mono text-[10px] text-[#cccccc] space-y-0.5 custom-scrollbar max-h-24 overflow-y-auto">
                            {step.logs.map((log, lidx) => (
                              <div key={lidx} className="text-[#858585]">
                                {log}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-[#858585]">
                  <Cpu className="w-8 h-8 mx-auto mb-2 text-[#555555]" />
                  <p>Click &quot;Run LiteSVM Suite&quot; to execute built-in LiteSVM checks and static instruction analysis against your Solana program.</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              {suiteState !== null ? (
                <div className="space-y-3">
                  <div
                    className={`p-3 rounded-lg border flex items-center justify-between gap-2 font-medium ${
                      suiteState.ok
                        ? 'bg-[#1b2a1e] border-[#2ea043]/50 text-[#89d185]'
                        : 'bg-[#2d1818] border-[#f14c4c]/50 text-[#f14c4c]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {suiteState.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-[#89d185]" />
                      ) : (
                        <XCircle className="w-4 h-4 text-[#f14c4c]" />
                      )}
                      <span>
                        {suiteState.status === 'error'
                          ? `Test Runner Error: ${suiteState.error}`
                          : suiteState.ok
                          ? `All ${suiteState.total} Language Tests Passed`
                          : `${suiteState.passed} passed, ${suiteState.failed} failed of ${suiteState.total} tests`}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[#181818] border border-[#2d2d2d] font-mono text-[11px] text-[#cccccc] space-y-1 max-h-96 overflow-y-auto custom-scrollbar">
                    {(suiteState.logs.length > 0
                      ? suiteState.logs
                      : [suiteState.error || 'No logs returned by test server.']
                    ).map((line, idx) => (
                      <div
                        key={idx}
                        className={
                          line.includes('[PASS]') || line.includes('✓')
                            ? 'text-[#89d185]'
                            : line.includes('[FAIL]') || line.includes('[ERR]') || line.includes('Error') || line.includes('Failed')
                            ? 'text-[#f14c4c]'
                            : 'text-[#858585]'
                        }
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-[#858585]">
                  <Layers className="w-8 h-8 mx-auto mb-2 text-[#555555]" />
                  <p>Run the full end-to-end Manifest v1.0 test suite covering Rust type checking, Typed MIR, .mbc VM execution, error diagnostics, and Solana code generation.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-10 border-t border-[#2d2d2d] bg-[#252526] px-4 flex items-center justify-between text-[11px] text-[#858585]">
          <span>Real VM engine powered by LiteSVM & Solana Web3</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Manifest Studio - Test Runner Modal
 * Runs comprehensive Manifest language tests & Solana LiteSVM verification suites
 * via the full-stack server-side test runner.
 */

import React, { useState } from 'react';
import { Play, CheckCircle2, XCircle, Zap, X, RefreshCw, Cpu, Layers } from 'lucide-react';
import { LiteSVMTestSuiteResult } from '../types.ts';

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
  const [suiteOutput, setSuiteOutput] = useState<string[]>([]);
  const [suitePassed, setSuitePassed] = useState<boolean | null>(null);

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
        programName: 'Program',
        programId: '',
        durationMs: 0,
        totalComputeUnits: 0,
        stepsCount: 0,
        passedCount: 0,
        failedCount: 1,
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
    setSuiteOutput([]);
    setSuitePassed(null);

    try {
      const res = await fetch('/api/tests/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      setSuitePassed(data.success);
      setSuiteOutput(data.logs || []);
      onShowToast?.(data.success ? 'All Manifest Core tests passed!' : 'Some tests failed.');
    } catch (err: any) {
      setSuitePassed(false);
      setSuiteOutput([`Network exception: ${err.message || String(err)}`]);
      onShowToast?.(`Test run error: ${err.message || String(err)}`);
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
              Full Language Suite (20+ tests)
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
                          ? 'LiteSVM Simulation Passed'
                          : `LiteSVM Execution Failed: ${litesvmReport.error || 'Unknown error'}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-[#cca700]" />
                        <strong>{(litesvmReport.totalComputeUnits || 0).toLocaleString()} CU</strong>
                      </span>
                      <span>{litesvmReport.stepsCount || 0} Steps</span>
                    </div>
                  </div>

                  {/* Steps Breakdown */}
                  <div className="space-y-2">
                    <div className="font-semibold text-[11px] text-[#858585] uppercase tracking-wider">
                      Execution Steps
                    </div>
                    {(litesvmReport.steps || []).map((step, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-[#252526] border border-[#2d2d2d] space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-medium text-[#ffffff]">
                            {step.success ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#89d185]" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-[#f14c4c]" />
                            )}
                            <span>Step {idx + 1}: {step.stepName}</span>
                          </div>
                          <span className="text-[11px] font-mono text-[#cca700]">
                            {step.computeUnitsUsed} CU
                          </span>
                        </div>

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
                  <p>Click &quot;Run LiteSVM Suite&quot; to execute transactions, compute unit benchmarks, and assertion checks against your Solana program.</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              {suitePassed !== null ? (
                <div className="space-y-3">
                  <div
                    className={`p-3 rounded-lg border flex items-center gap-2 font-medium ${
                      suitePassed
                        ? 'bg-[#1b2a1e] border-[#2ea043]/50 text-[#89d185]'
                        : 'bg-[#2d1818] border-[#f14c4c]/50 text-[#f14c4c]'
                    }`}
                  >
                    {suitePassed ? (
                      <CheckCircle2 className="w-4 h-4 text-[#89d185]" />
                    ) : (
                      <XCircle className="w-4 h-4 text-[#f14c4c]" />
                    )}
                    <span>{suitePassed ? 'All 20+ Language Tests Passed' : 'Test Suite Failed'}</span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#181818] border border-[#2d2d2d] font-mono text-[11px] text-[#cccccc] space-y-1 max-h-96 overflow-y-auto custom-scrollbar">
                    {suiteOutput.map((line, idx) => (
                      <div
                        key={idx}
                        className={
                          line.includes('[PASS]') || line.includes('✓')
                            ? 'text-[#89d185]'
                            : line.includes('[ERR]') || line.includes('Failed')
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
                  <p>Run the full end-to-end Manifest test suite covering lexing, AST parsing, v0.2 primitives, error diagnostics, and Solana code generation.</p>
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

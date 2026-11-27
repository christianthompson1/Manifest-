/**
 * Manifest Studio - Compiler & Runtime Inspector / Testbench Modal (v1.0)
 * Inspects authoritative Rust engine Typed MIR, AST Summary, MVM Bytecode Disassembly,
 * and automated test suite results.
 * Styled with VS Code Dark Modern theme tokens (#1f1f1f body, #181818 headers, #2d2d2d dividers).
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Zap,
  CheckCircle2,
  Boxes,
  Layers,
  Cpu,
  BookOpen,
} from 'lucide-react';
import {
  checkManifestSource,
  compileManifestV1,
  isSolanaProgramSource,
  parseSolanaProgramSource,
  ManifestCheckSummary,
  ManifestV1BuildResult,
} from '../../../manifest-core/src/index.ts';
import {
  executeAndParseTestRun,
  ParsedTestRunState,
} from '../../../manifest-core/src/verification/result-model.ts';

interface TestbenchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCode: string;
}

export const TestbenchModal: React.FC<TestbenchModalProps> = ({
  isOpen,
  onClose,
  currentCode,
}) => {
  const [activeTab, setActiveTab] = useState<'tests' | 'ir' | 'ast' | 'bytecode' | 'docs'>('tests');
  const [testResults, setTestResults] = useState<ParsedTestRunState | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [checkResult, setCheckResult] = useState<ManifestCheckSummary | null>(null);
  const [compileResult, setCompileResult] = useState<ManifestV1BuildResult | null>(null);
  const [solanaSummary, setSolanaSummary] = useState<any>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      if (isSolanaProgramSource(currentCode)) {
        const parsed = parseSolanaProgramSource(currentCode);
        const comp = await compileManifestV1(currentCode, { target: 'solana-sbf' });
        if (!cancelled) {
          setSolanaSummary(parsed);
          setCheckResult(null);
          setCompileResult(comp);
        }
        return;
      }
      const [checked, compiled] = await Promise.all([
        checkManifestSource(currentCode),
        compileManifestV1(currentCode, { target: 'mvm' }),
      ]);
      if (!cancelled) {
        setSolanaSummary(null);
        setCheckResult(checked);
        setCompileResult(compiled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentCode]);

  const handleRunTests = async () => {
    setIsTesting(true);
    try {
      const parsed = await executeAndParseTestRun();
      setTestResults(parsed);
      setActiveTab('tests');
    } finally {
      setIsTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[85vh] bg-[#1f1f1f] border border-[#2d2d2d] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#cccccc] font-sans">
        {/* Modal Header (#181818) */}
        <div className="h-14 border-b border-[#2d2d2d] px-6 flex items-center justify-between bg-[#181818]">
          <div className="flex items-center space-x-3">
            <div className="w-7 h-7 rounded bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#ffffff] font-mono font-bold text-xs">
              M
            </div>
            <div>
              <div className="font-semibold text-sm text-[#ffffff] flex items-center gap-2">
                Manifest Core &amp; Compiler Inspector
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#252526] text-[#4ec9b0] border border-[#2d2d2d]">
                  v1.0
                </span>
              </div>
              <p className="text-[11px] text-[#858585]">
                Authoritative Rust Compiler Engine: AST summary, Typed MIR, MVM bytecode disassembly, and automated test suite.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunTests}
              disabled={isTesting}
              className="py-1.5 px-3 rounded-md bg-[#007acc] hover:bg-[#0062a3] text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              {isTesting ? 'Running Tests...' : 'Run Test Suite'}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[#858585] hover:text-[#ffffff] hover:bg-[#252526] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Tabs (#181818) */}
        <div className="h-10 border-b border-[#2d2d2d] bg-[#181818] px-6 flex items-center space-x-1.5">
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'tests'
                ? 'bg-[#1f1f1f] text-[#ffffff] border border-[#2d2d2d]'
                : 'text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#89d185]" />
            Automated Tests
            {testResults && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#252526] text-[#cccccc] text-[10px]">
                {testResults.status === 'error' ? 'ERR' : `${testResults.passed}/${testResults.total}`}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('ir')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'ir'
                ? 'bg-[#1f1f1f] text-[#ffffff] border border-[#2d2d2d]'
                : 'text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            <Boxes className="w-3.5 h-3.5 text-[#c586c0]" />
            Typed MIR
          </button>

          <button
            onClick={() => setActiveTab('ast')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'ast'
                ? 'bg-[#1f1f1f] text-[#ffffff] border border-[#2d2d2d]'
                : 'text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#89d185]" />
            AST Summary
          </button>

          <button
            onClick={() => setActiveTab('bytecode')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'bytecode'
                ? 'bg-[#1f1f1f] text-[#ffffff] border border-[#2d2d2d]'
                : 'text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-[#9cdcfe]" />
            Bytecode Disasm
          </button>

          <button
            onClick={() => setActiveTab('docs')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'docs'
                ? 'bg-[#1f1f1f] text-[#ffffff] border border-[#2d2d2d]'
                : 'text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-[#dcdcaa]" />
            Grammar Docs
          </button>
        </div>

        {/* Modal Body (#1f1f1f) */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#1f1f1f] font-mono text-xs custom-scrollbar">
          {/* Tab: Tests */}
          {activeTab === 'tests' && (
            <div className="space-y-4 font-sans">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-[#ffffff]">
                    Automated Language Test Suite
                  </h3>
                  <p className="text-xs text-[#858585]">
                    Runs the server-side canonical v1.0 verification suite covering Rust compilation, Typed MIR, .mbc VM execution, and v0.x removal guards.
                  </p>
                </div>
                <button
                  onClick={handleRunTests}
                  disabled={isTesting}
                  className="py-1 px-3 rounded bg-[#007acc] hover:bg-[#0062a3] text-white text-xs font-medium cursor-pointer"
                >
                  {isTesting ? 'Running...' : 'Run All Tests'}
                </button>
              </div>

              {testResults ? (
                <div className="space-y-3">
                  {testResults.status === 'error' ? (
                    <div className="p-3 rounded-lg bg-[#2d1818] border border-[#5a1d1d] flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-[#f85149]">
                        Test Runner Error: {testResults.error || 'Failed to execute test suite'}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#4d1f24] text-[#f85149] border border-[#5a1d1d] shrink-0">
                        ERROR
                      </span>
                    </div>
                  ) : (
                    <div
                      className={`p-3 rounded-lg border flex items-center justify-between ${
                        testResults.ok
                          ? 'bg-[#181818] border-[#2d2d2d]'
                          : 'bg-[#2d1818] border-[#5a1d1d]'
                      }`}
                    >
                      <span className="text-xs font-medium text-[#cccccc]">
                        Executed {testResults.total} tests: {testResults.passed} passed, {testResults.failed} failed
                        {testResults.skipped > 0 ? `, ${testResults.skipped} skipped` : ''}
                        {testResults.unsupported > 0 ? `, ${testResults.unsupported} unsupported` : ''}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                          testResults.ok
                            ? 'bg-[#183a21] text-[#89d185] border-[#238636]'
                            : 'bg-[#4d1f24] text-[#f85149] border-[#5a1d1d]'
                        }`}
                      >
                        {testResults.ok ? 'ALL PASSING' : `${testResults.failed || 1} FAILED`}
                      </span>
                    </div>
                  )}

                  {testResults.results.length > 0 && (
                    <div className="space-y-1 font-mono text-xs max-h-[400px] overflow-y-auto custom-scrollbar">
                      {testResults.results.map((res, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded bg-[#181818] border border-[#2d2d2d] flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <span className="text-[#cccccc]">{res.name}</span>
                            {res.error && (
                              <div className="text-[#f85149] text-[10px] mt-0.5">{res.error}</div>
                            )}
                          </div>
                          <span
                            className={`font-semibold text-[11px] shrink-0 ${
                              res.status === 'passed'
                                ? 'text-[#89d185]'
                                : res.status === 'skipped'
                                ? 'text-[#cca700]'
                                : 'text-[#f85149]'
                            }`}
                          >
                            {res.status === 'passed'
                              ? 'PASS'
                              : res.status === 'skipped'
                              ? 'SKIP'
                              : 'FAIL'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-12 text-center text-[#858585] border border-dashed border-[#2d2d2d] rounded-lg space-y-2">
                  <Zap className="w-8 h-8 text-[#9cdcfe] mx-auto" />
                  <div className="text-sm font-medium text-[#ffffff]">
                    Testbench is Ready
                  </div>
                  <div className="text-xs text-[#858585]">
                    Click &quot;Run All Tests&quot; to execute the automated suite.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Typed MIR */}
          {activeTab === 'ir' && (
            <div className="space-y-3 font-sans">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-[#c586c0]">
                    Typed Manifest Intermediate Representation (MIR)
                  </h3>
                  <p className="text-xs text-[#858585]">
                    Target-agnostic typed IR produced by the authoritative Rust compiler engine.
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded bg-[#252526] text-[#c586c0] text-xs font-mono border border-[#2d2d2d]">
                  MIR v1.0
                </span>
              </div>

              {compileResult?.irText ? (
                <pre className="p-4 rounded-lg bg-[#181818] border border-[#2d2d2d] text-[#ce9178] overflow-x-auto text-[11px] leading-relaxed max-h-[500px]">
                  {compileResult.irText}
                </pre>
              ) : solanaSummary?.program ? (
                <pre className="p-4 rounded-lg bg-[#181818] border border-[#2d2d2d] text-[#ce9178] overflow-x-auto text-[11px] leading-relaxed max-h-[500px]">
                  {JSON.stringify(solanaSummary.program, null, 2)}
                </pre>
              ) : (
                <div className="p-4 rounded-lg bg-[#2d1818] border border-[#5a1d1d] text-[#f85149] text-xs font-mono">
                  {compileResult?.diagnostics?.[0]?.message || 'Compile diagnostics must be resolved before MIR emission.'}
                </div>
              )}
            </div>
          )}

          {/* Tab: AST Summary */}
          {activeTab === 'ast' && (
            <div className="space-y-3 font-sans">
              <div>
                <h3 className="font-semibold text-sm text-[#89d185]">
                  Canonical AST &amp; Capability Summary
                </h3>
                <p className="text-xs text-[#858585]">
                  Unified representation shared by Beginner and Professional syntax profiles.
                </p>
              </div>

              {checkResult?.astSummary ? (
                <pre className="p-4 rounded-lg bg-[#181818] border border-[#2d2d2d] text-[#ce9178] overflow-x-auto text-[11px] leading-relaxed max-h-[500px]">
                  {JSON.stringify(
                    {
                      profile: checkResult.resolvedProfile,
                      engine: checkResult.compilerEngine,
                      astSummary: checkResult.astSummary,
                      capabilities: checkResult.capabilityAudit,
                    },
                    null,
                    2
                  )}
                </pre>
              ) : solanaSummary ? (
                <pre className="p-4 rounded-lg bg-[#181818] border border-[#2d2d2d] text-[#ce9178] overflow-x-auto text-[11px] leading-relaxed max-h-[500px]">
                  {JSON.stringify(solanaSummary, null, 2)}
                </pre>
              ) : (
                <div className="p-4 rounded-lg bg-[#2d1818] border border-[#5a1d1d] text-[#f85149] text-xs font-mono">
                  {checkResult?.diagnostics?.[0]?.message || 'Syntax or semantic check failed — inspect Problems panel.'}
                </div>
              )}
            </div>
          )}

          {/* Tab: Bytecode Disasm */}
          {activeTab === 'bytecode' && (
            <div className="space-y-3 font-sans">
              <div>
                <h3 className="font-semibold text-sm text-[#9cdcfe]">
                  Manifest Bytecode (.mbc v1.0) Disassembly
                </h3>
                <p className="text-xs text-[#858585]">
                  {compileResult?.mbcBytes
                    ? `Container size: ${compileResult.mbcBytes.byteLength} bytes`
                    : 'Compile a valid v1.0 module to inspect .mbc instructions.'}
                </p>
              </div>
              {compileResult?.disassembly ? (
                <pre className="p-4 rounded-lg bg-[#181818] border border-[#2d2d2d] text-[#d4d4d4] overflow-x-auto text-[11px] leading-relaxed max-h-[500px]">
                  {compileResult.disassembly}
                </pre>
              ) : (
                <div className="p-4 rounded-lg bg-[#181818] border border-[#2d2d2d] text-[#858585] text-xs font-mono">
                  {compileResult?.rustCode || compileResult?.diagnostics?.[0]?.message || 'No .mbc disassembly available for current target.'}
                </div>
              )}
            </div>
          )}

          {/* Tab: Docs */}
          {activeTab === 'docs' && (
            <div className="space-y-4 font-sans text-[#cccccc] text-xs leading-relaxed">
              <h3 className="font-semibold text-sm text-[#ffffff]">
                Manifest v1.0 Canonical Grammar Specifications
              </h3>
              <p className="text-[#858585]">
                Both Beginner and Professional profiles compile through the authoritative Rust frontend into identical AST, Typed MIR, capability audits, and MVM bytecode (.mbc).
              </p>
              <div className="grid grid-cols-2 gap-3 font-mono">
                <div className="p-3 rounded bg-[#181818] border border-[#2d2d2d]">
                  <div className="font-bold text-[#89d185] mb-1">Module &amp; Capabilities</div>
                  <code>module app_main;<br />requires console;</code>
                </div>
                <div className="p-3 rounded bg-[#181818] border border-[#2d2d2d]">
                  <div className="font-bold text-[#89d185] mb-1">Typed Bindings</div>
                  <code>let count: i64 = 0;<br />let mut total: i64 = 10;</code>
                </div>
                <div className="p-3 rounded bg-[#181818] border border-[#2d2d2d]">
                  <div className="font-bold text-[#89d185] mb-1">Beginner Equivalent</div>
                  <code>MODULE app_main<br />FUNCTION main() RETURNS Int EFFECTS console<br />&nbsp;&nbsp;SHOW &quot;Hello&quot;<br />&nbsp;&nbsp;RETURN 0<br />END</code>
                </div>
                <div className="p-3 rounded bg-[#181818] border border-[#2d2d2d]">
                  <div className="font-bold text-[#89d185] mb-1">Solana Smart Contract</div>
                  <code>PROGRAM Vault<br />&nbsp;&nbsp;ACCOUNT State<br />&nbsp;&nbsp;&nbsp;&nbsp;balance: NUMBER<br />&nbsp;&nbsp;END<br />END</code>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

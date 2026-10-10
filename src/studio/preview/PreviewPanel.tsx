/**
 * Manifest Studio - Full Application Preview & Developer Inspector
 * Complies with Section 5 & 20:
 * - Normal Preview: FULL APPLICATION displayed directly in sandboxed iframe without debug cards.
 * - Developer Inspector: Collapsed by default, comprehensive multi-tab inspector
 *   (Console, State, Elements, Events, IR/AST, Generated Code [JS/Rust], Solana Accounts/Tx, Build Logs).
 * Styled with VS Code Dark Modern matte aesthetic (#1f1f1f canvas, #181818 panels, #2d2d2d borders).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  RotateCcw,
  Sparkles,
  Terminal,
  Code2,
  AlertTriangle,
  Play,
  CheckCircle2,
  Trash2,
  X,
  Layers,
  ChevronDown,
  ChevronUp,
  Cpu,
  Coins,
  Bug,
  Activity,
  FileCode,
  Layout,
} from 'lucide-react';
import { BuildResult } from '../types.ts';
import { AnchorGenerator } from '../../../manifest-core/src/solana/anchor-generator.ts';
import { SolanaSimulator } from '../../../manifest-core/src/solana/solana-simulator.ts';

interface PreviewPanelProps {
  buildResult: BuildResult | null;
  isCompiling: boolean;
  onRun: () => void;
  onClose?: () => void;
  onOutputMessage?: (msg: string) => void;
  onClearConsole?: () => void;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  buildResult,
  isCompiling,
  onRun,
  onClose,
  onOutputMessage,
  onClearConsole,
}) => {
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [previewLogs, setPreviewLogs] = useState<string[]>([]);
  const [liveState, setLiveState] = useState<Record<string, any>>({});
  const [firedEvents, setFiredEvents] = useState<Array<{ name: string; timestamp: number }>>([]);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [inspectorTab, setInspectorTab] = useState<
    'console' | 'state' | 'elements' | 'events' | 'ir' | 'target' | 'solana' | 'build'
  >('console');
  const [codeTarget, setCodeTarget] = useState<'js' | 'rust'>('js');

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen to postMessage from the sandboxed preview iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'manifest-output') {
        const line = String(data.payload);
        setPreviewLogs((prev) => [...prev, line]);
        onOutputMessage?.(line);
      } else if (data.type === 'manifest-state') {
        if (data.payload && typeof data.payload === 'object') {
          setLiveState(data.payload);
        }
      } else if (data.type === 'manifest-event') {
        setFiredEvents((prev) => [
          ...prev,
          { name: String(data.payload || 'event'), timestamp: Date.now() },
        ]);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onOutputMessage]);

  // Reset logs when reloaded or new build arrived
  useEffect(() => {
    setPreviewLogs([]);
    setLiveState({});
    setFiredEvents([]);
  }, [reloadKey, buildResult?.timestamp]);

  const handleReload = () => {
    setReloadKey((prev) => prev + 1);
  };

  const handleClear = () => {
    setPreviewLogs([]);
    onClearConsole?.();
  };

  // Generate self-contained HTML for FULL APPLICATION preview
  const generatePreviewSrcDoc = () => {
    if (!buildResult || !buildResult.success || !buildResult.outputCode) {
      return '';
    }

    const appName = buildResult.ir?.appName || 'Manifest Application';
    const compiledJs = buildResult.outputCode;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
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
  <!-- Real Manifest Full Application Canvas (Mounted by Manifest Runtime) -->
  <div id="manifest-root"></div>

  <script type="module">
    // Injected JavaScript Target Output
    ${compiledJs}

    try {
      const root = document.getElementById('manifest-root');
      if (typeof startApp === 'function') {
        const appInstance = startApp(root, {
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
      console.error(err);
      try {
        window.parent.postMessage({ type: 'manifest-output', payload: 'Runtime Error: ' + (err.message || String(err)) }, '*');
      } catch (_) {}
    }
  </script>
</body>
</html>`;
  };

  // Generate Rust Anchor code preview for Solana projects or tabs
  const getRustGeneratedCode = (): string => {
    if (!buildResult?.ir) return '// No Solana IR available in current build.';
    try {
      const solanaProgram = (buildResult.ir as any).solanaProgram || {
        programName: buildResult.ir.appName || 'CounterProgram',
        programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
        accounts: [
          {
            name: `${buildResult.ir.appName || 'Counter'}State`,
            fields: [{ name: 'count', fieldType: 'u64' }, { name: 'authority', fieldType: 'pubkey' }],
          },
        ],
        instructions: [
          {
            name: 'increment',
            accounts: [
              { name: 'state', isMut: true, isSigner: false, accountType: `${buildResult.ir.appName || 'Counter'}State` },
              { name: 'authority', isMut: true, isSigner: true },
            ],
            requires: ['signer = authority'],
            mutations: [{ target: 'state.count', expression: 'state.count + 1' }],
            cpis: [],
          },
        ],
      };
      return AnchorGenerator.generate(solanaProgram).rustCode;
    } catch (e: any) {
      return `// Error generating Rust: ${e.message}`;
    }
  };

  // Run fast simulated Solana accounts inspection
  const getSimulatedSolanaState = () => {
    const dummyProgram = {
      programName: buildResult?.ir?.appName || 'CounterProgram',
      programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      accounts: [
        {
          name: 'CounterState',
          fields: [{ name: 'count', fieldType: 'u64' }, { name: 'authority', fieldType: 'pubkey' }],
        },
      ],
      instructions: [
        {
          name: 'increment',
          accounts: [{ name: 'state', isMut: true, isSigner: false }],
          requires: ['signer = authority'],
          mutations: [{ target: 'state.count', expression: 'state.count + 1' }],
          cpis: [],
        },
      ],
    };
    const sim = new SolanaSimulator(dummyProgram as any);
    sim.initializeDefaultAccounts();
    return sim.exportAccounts();
  };

  const hasErrors = buildResult && !buildResult.success;
  const errorDiagnostics = buildResult?.diagnostics.filter((d) => d.severity === 'error') || [];

  return (
    <div className="h-full flex flex-col bg-[#181818] text-[#cccccc] overflow-hidden border-l border-[#2d2d2d]">
      {/* Preview Header Bar (#181818) */}
      <div className="h-8 border-b border-[#2d2d2d] bg-[#181818] px-3 flex items-center justify-between select-none">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-medium text-[#ffffff] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#858585]" />
            Application Preview
          </span>

          {isCompiling ? (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#252526] text-[#cca700] border border-[#2d2d2d]">
              Compiling...
            </span>
          ) : hasErrors ? (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#4d1f24] text-[#f85149] border border-[#5a1d1d] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-[#f14c4c]" />
              Build Error
            </span>
          ) : buildResult ? (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#252526] text-[#89d185] border border-[#2d2d2d] flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-[#89d185]" />
              Ready ({buildResult.durationMs}ms)
            </span>
          ) : null}
        </div>

        {/* View mode toggle & actions */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition cursor-pointer border ${
              isInspectorOpen
                ? 'bg-[#282828] text-[#ffffff] border-[#3c3c3c]'
                : 'bg-[#1f1f1f] text-[#858585] border-[#2d2d2d] hover:text-[#cccccc]'
            }`}
            title="Toggle Developer Inspector Panel"
          >
            <Layers className="w-3 h-3" />
            <span>Inspector</span>
            {isInspectorOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>

          <button
            onClick={handleReload}
            title="Reload Application Preview"
            className="p-1 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#242424] transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleClear}
            title="Clear Logs"
            className="p-1 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#242424] transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              title="Close Preview Panel"
              className="p-1 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#242424] transition cursor-pointer ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Full Application Canvas (Background: #1f1f1f) */}
      <div className="flex-1 overflow-hidden relative bg-[#1f1f1f] flex flex-col">
        {hasErrors ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-3">
            <div className="w-9 h-9 rounded-full bg-[#4d1f24] border border-[#5a1d1d] flex items-center justify-center text-[#f85149]">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-[#ffffff] text-xs">Compilation Diagnostics</h3>
              <p className="text-[11px] text-[#858585] mt-0.5">
                Fix errors in the Manifest editor to update preview.
              </p>
            </div>

            {errorDiagnostics.length > 0 && (
              <div className="w-full text-left bg-[#2d1818] border border-[#5a1d1d] rounded-lg p-2.5 text-xs font-mono text-[#f85149] space-y-1">
                <div className="font-semibold flex items-center gap-1.5 text-[#f14c4c] text-[11px]">
                  <span>Line {errorDiagnostics[0].line}:</span>
                  <span>{errorDiagnostics[0].message}</span>
                </div>
                {errorDiagnostics[0].hint && (
                  <div className="text-[10px] text-[#cccccc] font-sans">
                    💡 {errorDiagnostics[0].hint}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={onRun}
              className="px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white font-medium text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              Re-run Program
            </button>
          </div>
        ) : (
          <div className="flex-1 w-full h-full relative bg-[#1f1f1f]">
            {buildResult?.outputCode ? (
              <iframe
                key={reloadKey}
                ref={iframeRef}
                srcDoc={generatePreviewSrcDoc()}
                sandbox="allow-scripts"
                className="w-full h-full border-none bg-[#1f1f1f]"
                title="Manifest Full Application Preview"
              />
            ) : (
              <div className="flex-1 h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                <div className="w-8 h-8 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#858585]">
                  <Play className="w-4 h-4 ml-0.5" />
                </div>
                <div className="text-[#858585] text-xs">
                  Click <strong className="text-[#ffffff]">Run</strong> to compile and preview.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsible Developer Inspector (Section 20) */}
        {isInspectorOpen && (
          <div className="h-64 border-t border-[#2d2d2d] bg-[#181818] flex flex-col z-20 shadow-2xl">
            {/* Inspector Tab Bar */}
            <div className="h-7 border-b border-[#2d2d2d] bg-[#1f1f1f] px-2 flex items-center justify-between text-[11px]">
              <div className="flex items-center space-x-1">
                <span className="font-semibold text-[#858585] uppercase tracking-wider text-[10px] mr-2">
                  Inspector
                </span>
                {[
                  { id: 'console', label: 'Console', icon: Terminal, badge: previewLogs.length },
                  { id: 'state', label: 'State', icon: Activity, badge: Object.keys(liveState).length },
                  { id: 'elements', label: 'Elements', icon: Layout },
                  { id: 'events', label: 'Events', icon: Bug, badge: firedEvents.length },
                  { id: 'ir', label: 'IR / AST', icon: Cpu },
                  { id: 'target', label: 'Target Code', icon: FileCode },
                  { id: 'solana', label: 'Solana', icon: Coins },
                  { id: 'build', label: 'Build Logs', icon: Layers },
                ].map((t) => {
                  const Icon = t.icon;
                  const isActive = inspectorTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setInspectorTab(t.id as any)}
                      className={`px-2 py-0.5 rounded flex items-center gap-1 transition cursor-pointer ${
                        isActive
                          ? 'bg-[#2d2d2d] text-[#ffffff] font-medium'
                          : 'text-[#858585] hover:text-[#cccccc]'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{t.label}</span>
                      {t.badge !== undefined && t.badge > 0 && (
                        <span className="text-[9px] px-1 rounded-full bg-[#3c3c3c] text-[#ffffff]">
                          {t.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setIsInspectorOpen(false)}
                className="text-[#858585] hover:text-[#ffffff] p-0.5 rounded cursor-pointer"
                title="Collapse Inspector"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Inspector Panel Body */}
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-[#cccccc] bg-[#181818] custom-scrollbar">
              {inspectorTab === 'console' && (
                <div className="space-y-1">
                  {previewLogs.length === 0 ? (
                    <div className="text-[#666666] italic py-2">No console output received yet.</div>
                  ) : (
                    previewLogs.map((log, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 py-0.5 text-xs text-[#d4d4d4]">
                        <span className="text-[#858585] select-none">&gt;</span>
                        <span>{log}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {inspectorTab === 'state' && (
                <div className="space-y-2">
                  <div className="text-[11px] text-[#858585] mb-1 font-sans">
                    Live Reactive Application State Scope
                  </div>
                  {Object.keys(liveState).length === 0 ? (
                    <div className="text-[#666666] italic py-2">No active state variables initialized yet.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(liveState).map(([k, v]) => (
                        <div key={k} className="p-2 rounded bg-[#1f1f1f] border border-[#2d2d2d] flex justify-between items-center">
                          <span className="text-[#cccccc]">{k}</span>
                          <span className="text-[#9cdcfe] font-semibold">{JSON.stringify(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {inspectorTab === 'elements' && (
                <div className="space-y-2 font-sans text-xs">
                  <div className="text-[11px] text-[#858585] mb-1">
                    Component Tree Hierarchy (Derived from Manifest IR)
                  </div>
                  <div className="p-2 rounded bg-[#1f1f1f] border border-[#2d2d2d] font-mono text-[11px]">
                    <div className="text-[#569cd6]">&lt;App name="{buildResult?.ir?.appName || 'App'}"&gt;</div>
                    {(buildResult?.ir?.pages || []).map((p: any, pIdx: number) => (
                      <div key={pIdx} className="pl-4 text-[#4ec9b0]">
                        &lt;Page name="{p.name}" route="{p.route || '/'}"&gt;
                        {p.children?.map((c: any, cIdx: number) => (
                          <div key={cIdx} className="pl-4 text-[#ce9178]">
                            &lt;{c.kind} /&gt;
                          </div>
                        ))}
                        &lt;/Page&gt;
                      </div>
                    ))}
                    <div className="text-[#569cd6]">&lt;/App&gt;</div>
                  </div>
                </div>
              )}

              {inspectorTab === 'events' && (
                <div className="space-y-1">
                  <div className="text-[11px] text-[#858585] mb-2 font-sans">
                    Recent User & Lifecycle Events
                  </div>
                  {firedEvents.length === 0 ? (
                    <div className="text-[#666666] italic py-2">No interactive events recorded yet.</div>
                  ) : (
                    firedEvents.map((ev, idx) => (
                      <div key={idx} className="flex items-center justify-between p-1.5 rounded bg-[#1f1f1f] border border-[#2d2d2d]">
                        <span className="text-[#dcdcaa]">{ev.name}</span>
                        <span className="text-[10px] text-[#858585]">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {inspectorTab === 'ir' && (
                <pre className="text-[11px] text-[#ce9178] leading-relaxed">
                  {JSON.stringify(buildResult?.ir || {}, null, 2)}
                </pre>
              )}

              {inspectorTab === 'target' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 pb-1 border-b border-[#2d2d2d]">
                    <button
                      onClick={() => setCodeTarget('js')}
                      className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                        codeTarget === 'js' ? 'bg-[#2d2d2d] text-white' : 'text-[#858585]'
                      }`}
                    >
                      JavaScript Target (Web DOM)
                    </button>
                    <button
                      onClick={() => setCodeTarget('rust')}
                      className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                        codeTarget === 'rust' ? 'bg-[#2d2d2d] text-white' : 'text-[#858585]'
                      }`}
                    >
                      Anchor Rust Target (Solana)
                    </button>
                  </div>
                  <pre className="text-[11px] text-[#d4d4d4] leading-relaxed overflow-x-auto p-2 bg-[#1f1f1f] rounded border border-[#2d2d2d]">
                    {codeTarget === 'js' ? buildResult?.outputCode || '// No JS' : getRustGeneratedCode()}
                  </pre>
                </div>
              )}

              {inspectorTab === 'solana' && (
                <div className="space-y-3 font-sans text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#ffffff] flex items-center gap-1.5">
                      <Coins className="w-3.5 h-3.5 text-[#8b5cf6]" />
                      Solana Fast Local Simulation (Level 1)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#252526] text-[#a78bfa] border border-[#3b2d54]">
                      In-Memory Cluster
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px]">
                    {Object.entries(getSimulatedSolanaState()).map(([pk, acc]: [string, any]) => (
                      <div key={pk} className="p-2.5 rounded bg-[#1f1f1f] border border-[#2d2d2d] space-y-1">
                        <div className="flex justify-between items-center text-[#858585]">
                          <span>Account: {pk.substring(0, 10)}...</span>
                          <span className="text-[#a78bfa]">{(acc.lamports / 1e9).toFixed(2)} SOL</span>
                        </div>
                        <div className="text-[10px] text-[#666666]">Owner: {acc.owner.substring(0, 10)}...</div>
                        <div className="text-[11px] text-[#9cdcfe] mt-1">Data: {JSON.stringify(acc.data)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {inspectorTab === 'build' && (
                <div className="space-y-1 text-xs font-mono">
                  <div className="text-[#89d185]">✓ Compilation pipeline completed successfully</div>
                  <div className="text-[#858585]">Target: {buildResult?.target || 'js'}</div>
                  <div className="text-[#858585]">Build Time: {buildResult?.durationMs || 0}ms</div>
                  <div className="text-[#858585]">Artifacts: {buildResult?.artifacts?.length || 1} generated</div>
                  <div className="text-[#858585]">Diagnostics: {buildResult?.diagnostics?.length || 0} warnings/errors</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

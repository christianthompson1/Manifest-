/**
 * Manifest Studio - Interactive CLI Terminal Panel (v1.0)
 * Executes real Manifest v1.0 CLI commands (check, run, build, ir, bytecode, disassemble, verify, format, targets)
 * directly in the browser environment against the Rust Manifest Virtual Machine (WASM) and compiler pipeline.
 * Styled with VS Code Dark Modern tokens (#1f1f1f buffer, #181818 subheader/input, #2d2d2d borders).
 */

import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Send, Trash2 } from 'lucide-react';
import {
  executeManifest,
  inspectManifest,
  generateManifestIR,
  compileManifest,
  isLegacyDomainManifestSource,
  checkManifestSource,
  compileManifestV1,
  runManifestOnRustMvm,
  formatManifestSource,
  verifyMbcInRustVm,
  COMPILER_TARGETS,
} from '../../../manifest-core/src/index.ts';

interface TerminalPanelProps {
  currentSource: string;
  workspaceFiles?: Record<string, string>;
  onClear?: () => void;
}

interface CommandLog {
  id: string;
  command: string;
  output: string[];
  isError?: boolean;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ currentSource, workspaceFiles }) => {
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<CommandLog[]>([
    {
      id: 'init-1',
      command: 'manifest --version',
      output: ['Manifest Language & Rust MVM CLI v1.0.0 (Beginner & Professional Syntax Profiles)'],
    },
    {
      id: 'init-2',
      command: 'help',
      output: [
        'Available commands:',
        '  manifest check             - Type-check & verify capabilities/effects',
        '  manifest run               - Compile to .mbc & execute on Rust MVM (or UI runtime)',
        '  manifest ir                - Print optimized Typed Manifest IR',
        '  manifest disassemble       - Emit & disassemble .mbc v1.0 bytecode',
        '  manifest verify            - Run static .mbc verifier inside Rust MVM',
        '  manifest build [target]    - Build target (mvm | web-js | wasm | native | solana-sbf)',
        '  manifest targets           - List all compiler targets & honest statuses',
        '  clear                      - Clear terminal buffer',
      ],
    },
  ]);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleCommand = async (cmdStr: string) => {
    const trimmed = cmdStr.trim();
    if (!trimmed) return;

    if (trimmed.toLowerCase() === 'clear') {
      setHistory([]);
      setInputVal('');
      return;
    }

    const parts = trimmed.split(/\s+/);
    const primary = parts[0].toLowerCase();
    const action = parts[1]?.toLowerCase();

    let output: string[] = [];
    let isError = false;

    try {
      if (primary === 'manifest' || primary === 'm') {
        if (!action || action === 'help' || action === '--help') {
          output = [
            'Manifest v1.0 CLI',
            'Usage: manifest <command> [options]',
            '',
            'Commands:',
            '  check                 Validate syntax, static types & transitive capability effects',
            '  run                   Execute active program on Rust MVM (.mbc) or Web runtime',
            '  ir                    Inspect optimized Typed Manifest IR',
            '  bytecode              Compile to binary .mbc and report container metrics',
            '  disassemble           Print human-readable .mbc bytecode disassembly',
            '  verify                Verify .mbc stack heights & jump bounds via Rust MVM',
            '  build [target]        Compile to mvm | web-js | wasm | native | solana-sbf',
            '  format [profile]      Format source as beginner or professional',
            '  targets               List all registered compilation targets',
          ];
        } else if (action === '--version' || action === '-v') {
          output = ['Manifest Language & Rust MVM CLI v1.0.0'];
        } else if (action === 'targets') {
          output = [
            'Manifest v1.0 Compiler Targets:',
            ...COMPILER_TARGETS.map((t) => `  • ${t.id.padEnd(14)} [${t.status}] — ${t.name}`),
          ];
        } else if (action === 'check') {
          if (!isLegacyDomainManifestSource(currentSource)) {
            const res = checkManifestSource(currentSource, { files: workspaceFiles });
            if (res.ok) {
              const reqs = res.capabilityAudit?.declaredRequires.join(', ') || 'none';
              output = [
                `[CHECK PASS] Profile: ${res.resolvedProfile} | Functions: ${res.ast?.functions.length || 0} | Capabilities: ${reqs}`,
              ];
            } else {
              isError = true;
              output = [
                `[CHECK FAIL] ${res.diagnostics.length} diagnostic(s):`,
                ...res.diagnostics.map((d) => `  • [${d.code}] Line ${d.line || 1}: ${d.message}`),
              ];
            }
          } else {
            const inspection = inspectManifest(currentSource);
            const synDiags = inspection.diagnostics || [];
            const valIssues = inspection.validation?.issues || [];
            const allIssues = [...synDiags, ...valIssues];
            if (allIssues.filter((i: any) => i.severity !== 'warning').length === 0) {
              output = ['[CHECK PASS] Declarative Manifest syntax & semantics valid.'];
            } else {
              isError = true;
              output = [
                `[CHECK FAIL] ${allIssues.length} issue(s):`,
                ...allIssues.map((iss: any) => `  • Line ${iss.line || 1}: ${iss.message}`),
              ];
            }
          }
        } else if (action === 'run') {
          if (!isLegacyDomainManifestSource(currentSource)) {
            const vmRun = await runManifestOnRustMvm(currentSource, { files: workspaceFiles });
            if (vmRun.ok) {
              output = [
                `[RUST MVM OK] Profile: ${vmRun.resolvedProfile} | Steps: ${vmRun.stepsExecuted} | Return: ${vmRun.returnValue}`,
                ...vmRun.stdout.map((line) => `  > ${line}`),
              ];
            } else {
              isError = true;
              output = [
                `[RUST MVM FAIL] ${vmRun.error || ''}`,
                ...vmRun.build.diagnostics.map((d) => `  • Line ${d.line || 1}: ${d.message}`),
                ...vmRun.stdout.map((line) => `  > ${line}`),
              ];
            }
          } else {
            const runRes = await executeManifest(currentSource);
            if (runRes.validationIssues.length === 0) {
              output = [
                `[EXEC OK] Executed (${runRes.output.length} outputs):`,
                ...runRes.output.map((log: string) => `  > ${log}`),
              ];
            } else {
              isError = true;
              output = [
                `[EXEC DIAGNOSTICS] ${runRes.validationIssues.length} issue(s):`,
                ...runRes.validationIssues.map((e: any) => `  • Line ${e.line || 1}: ${e.message}`),
              ];
            }
          }
        } else if (action === 'ir') {
          if (!isLegacyDomainManifestSource(currentSource)) {
            const comp = await compileManifestV1(currentSource, { target: 'mvm', files: workspaceFiles });
            if (comp.irText) {
              output = [comp.irText];
            } else {
              isError = true;
              output = comp.diagnostics.map((d) => `  • Line ${d.line || 1}: ${d.message}`);
            }
          } else {
            const ir = generateManifestIR(currentSource);
            output = [JSON.stringify(ir, null, 2)];
          }
        } else if (action === 'bytecode' || action === 'disassemble' || action === 'disasm') {
          if (isLegacyDomainManifestSource(currentSource)) {
            isError = true;
            output = ['Declarative UI apps compile to DOM JS rather than .mbc bytecode. Open a v1.0 module to inspect .mbc.'];
          } else {
            const comp = await compileManifestV1(currentSource, { target: 'mvm', files: workspaceFiles });
            if (comp.success && comp.mbcBytes) {
              output =
                action === 'bytecode'
                  ? [
                      `[MBC OK] Emitted ${comp.mbcBytes.length} bytes (Magic: MBC\\0, Version 1.0)`,
                      `Use "manifest disassemble" to inspect instructions.`,
                    ]
                  : [comp.disassembly || ''];
            } else {
              isError = true;
              output = comp.diagnostics.map((d) => `  • Line ${d.line || 1}: ${d.message}`);
            }
          }
        } else if (action === 'verify') {
          const comp = await compileManifestV1(currentSource, { target: 'mvm', files: workspaceFiles });
          if (!comp.success || !comp.mbcBytes) {
            isError = true;
            output = comp.diagnostics.map((d) => `  • Line ${d.line || 1}: ${d.message}`);
          } else {
            const ver = await verifyMbcInRustVm(comp.mbcBytes);
            isError = !ver.ok;
            output = [
              ver.ok
                ? `[VERIFY PASS] Module "${ver.moduleName || 'main'}" verified by Rust MVM (${comp.mbcBytes.length} bytes, ${ver.functions || 0} functions)`
                : `[VERIFY FAIL] ${ver.error || 'Verification failed'}`,
            ];
          }
        } else if (action === 'format') {
          const targetProf = parts[2]?.toLowerCase() === 'beginner' ? 'beginner' : 'professional';
          const fmt = formatManifestSource(currentSource, targetProf);
          if (fmt.ok && fmt.formatted) {
            output = [`Formatted (${targetProf} profile):`, fmt.formatted];
          } else {
            isError = true;
            output = fmt.diagnostics.map((d) => `  • Line ${d.line || 1}: ${d.message}`);
          }
        } else if (action === 'build') {
          const requestedTarget = parts[2] && !parts[2].endsWith('.manifest') ? parts[2].toLowerCase() : parts[3]?.toLowerCase() || 'mvm';
          if (!isLegacyDomainManifestSource(currentSource)) {
            const comp = await compileManifestV1(currentSource, { target: requestedTarget, files: workspaceFiles });
            if (comp.success) {
              output = [
                `[BUILD OK] Target: ${comp.target.id} (${comp.target.status})`,
                ...comp.artifacts.map((a) => `  • ${a.filename} (${a.bytes ? a.bytes.byteLength : (a.text || '').length} bytes)`),
              ];
            } else {
              isError = true;
              output = comp.diagnostics.map((d) => `  • Line ${d.line || 1}: ${d.message}`);
            }
          } else {
            const compileRes = await compileManifest(currentSource, requestedTarget === 'mvm' ? 'js' : requestedTarget);
            if (compileRes.success) {
              output = [
                `[BUILD OK] Target: ${requestedTarget}`,
                ...compileRes.artifacts.map((a: any) => `  • ${a.fileName} (${a.sizeBytes || a.content?.length || 0} bytes)`),
              ];
            } else {
              isError = true;
              output = compileRes.diagnostics.map((d: any) => `  • Line ${d.line || 1}: ${d.message}`);
            }
          }
        } else {
          isError = true;
          output = [`Unknown command: "${action}". Type "manifest help" for available commands.`];
        }
      } else {
        isError = true;
        output = [`Command not found: "${primary}". Type "manifest help".`];
      }
    } catch (err: any) {
      isError = true;
      output = [`Exception: ${err.message || String(err)}`];
    }

    setHistory((prev) => [
      ...prev,
      {
        id: `cmd-${Date.now()}`,
        command: cmdStr,
        output,
        isError,
      },
    ]);
    setInputVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommand(inputVal);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#1f1f1f] font-mono text-xs overflow-hidden select-text">
      <div className="h-8 bg-[#181818] border-b border-[#2d2d2d] px-3 flex items-center justify-between text-[11px] text-[#858585] select-none">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-[#858585]" />
          <span className="font-semibold text-[#cccccc]">Manifest CLI Terminal</span>
          <span className="text-[10px] text-[#767676] font-mono">(v1.0 + Rust MVM)</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleCommand('manifest check')}
            className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#cccccc] transition cursor-pointer"
          >
            check
          </button>
          <button
            onClick={() => handleCommand('manifest ir')}
            className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#ce9178] transition cursor-pointer"
          >
            ir
          </button>
          <button
            onClick={() => handleCommand('manifest disassemble')}
            className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#9cdcfe] transition cursor-pointer"
          >
            disasm
          </button>
          <button
            onClick={() => handleCommand('manifest run')}
            className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#89d185] transition cursor-pointer"
          >
            run
          </button>
          <button
            onClick={() => setHistory([])}
            title="Clear buffer"
            className="p-1 rounded text-[#858585] hover:text-[#cccccc] transition cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#1f1f1f] custom-scrollbar">
        {history.map((log) => (
          <div key={log.id} className="space-y-1">
            <div className="flex items-center gap-2 text-[#858585]">
              <span className="text-[#858585] font-bold">$</span>
              <span className="text-[#ffffff]">{log.command}</span>
            </div>
            <div
              className={`pl-4 whitespace-pre-wrap leading-relaxed ${
                log.isError ? 'text-[#f85149]' : 'text-[#cccccc]'
              }`}
            >
              {log.output.join('\n')}
            </div>
          </div>
        ))}
        <div ref={terminalEndRef} />
      </div>

      <div className="h-9 border-t border-[#2d2d2d] bg-[#181818] px-3 flex items-center gap-2">
        <span className="text-[#858585] font-bold text-xs select-none">$</span>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="manifest check, manifest ir, manifest disassemble, manifest run..."
          className="flex-1 bg-transparent text-[#ffffff] font-mono text-xs outline-none caret-[#aeafad] placeholder:text-[#767676]"
        />
        <button
          onClick={() => handleCommand(inputVal)}
          className="p-1 rounded text-[#858585] hover:text-[#cccccc] transition cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

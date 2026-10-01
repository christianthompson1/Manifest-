/**
 * Manifest Studio - Interactive CLI Terminal Panel
 * Executes real Manifest CLI commands (check, run, build, ir, targets) directly in the browser environment.
 * Styled with VS Code Dark Modern tokens (#1f1f1f buffer, #181818 subheader/input, #2d2d2d borders).
 */

import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Send, Trash2, HelpCircle } from 'lucide-react';
import {
  executeManifest,
  inspectManifest,
  generateManifestIR,
  compileManifest,
  Compiler,
} from '../../../manifest-core/src/index.ts';

interface TerminalPanelProps {
  currentSource: string;
  onClear?: () => void;
}

interface CommandLog {
  id: string;
  command: string;
  output: string[];
  isError?: boolean;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ currentSource }) => {
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<CommandLog[]>([
    {
      id: 'init-1',
      command: 'manifest --version',
      output: ['Manifest Core CLI v0.1.0 (Architecture: IR + Target Compiler)'],
    },
    {
      id: 'init-2',
      command: 'help',
      output: [
        'Available commands:',
        '  manifest run <file>       - Execute via interpreter',
        '  manifest check <file>     - Validate syntax & semantics',
        '  manifest build <file> js  - Compile to JavaScript artifact',
        '  manifest ir <file>        - Print Manifest IR JSON',
        '  manifest targets          - List registered compilation targets',
        '  clear                     - Clear terminal buffer',
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
    const target = parts[3]?.toLowerCase() || 'js';

    let output: string[] = [];
    let isError = false;

    try {
      if (primary === 'manifest' || primary === 'm') {
        if (!action || action === 'help' || action === '--help') {
          output = [
            'Manifest Core v0.1 CLI',
            'Usage: manifest <command> [file] [options]',
            '',
            'Commands:',
            '  run [file]         Run Manifest program directly via interpreter',
            '  check [file]       Check syntax and semantic validity without running',
            '  build [file] [tg]  Compile Manifest source to target code (js)',
            '  ir [file]          Inspect target-agnostic Manifest Intermediate Representation',
            '  targets            List available target compilers',
          ];
        } else if (action === 'targets') {
          const registered = new Compiler().getSupportedTargets();
          output = [
            'Registered Compilation Targets:',
            ...registered.map((t: string) => `  • ${t} (${t === 'js' ? 'Active / Supported' : 'Future Target'})`),
          ];
        } else if (action === 'check') {
          const inspection = inspectManifest(currentSource);
          if (inspection.validation.isValid) {
            output = ['[CHECK PASS] Syntax is valid. No semantic errors detected.'];
          } else {
            isError = true;
            output = [
              `[CHECK FAIL] ${inspection.validation.issues.length} semantic issue(s) detected:`,
              ...inspection.validation.issues.map(
                (iss: any) => `  • Line ${iss.line || '?'}: ${iss.message}`
              ),
            ];
          }
        } else if (action === 'run') {
          const runRes = await executeManifest(currentSource);
          if (runRes.validationIssues.length === 0) {
            output = [
              `[EXEC OK] Application executed successfully (${runRes.output.length} SHOW outputs):`,
              ...runRes.output.map((log: string) => `  > ${log}`),
            ];
          } else {
            isError = true;
            output = [
              `[EXEC WARNING] Execution finished with ${runRes.validationIssues.length} issue(s):`,
              ...runRes.validationIssues.map((e: any) => `  • Line ${e.line || '?'}: ${e.message}`),
              ...runRes.output.map((log: string) => `  > ${log}`),
            ];
          }
        } else if (action === 'ir') {
          try {
            const ir = generateManifestIR(currentSource);
            output = [
              `Manifest IR for "${ir.appName || 'app'}":`,
              JSON.stringify(ir, null, 2),
            ];
          } catch (e: any) {
            isError = true;
            output = [`[IR BUILD ERROR] ${e.message || String(e)}`];
          }
        } else if (action === 'build') {
          try {
            const compileRes = await compileManifest(currentSource, target);
            if (compileRes.success) {
              output = [
                `[BUILD OK] Compiled target: ${target}`,
                `Artifacts: ${compileRes.artifacts.length} file(s)`,
                ...compileRes.artifacts.map((a: any) => `  • ${a.filename} (${a.sizeBytes} bytes)`),
              ];
            } else {
              isError = true;
              output = [
                `[BUILD ERROR] Compilation to target "${target}" failed:`,
                ...compileRes.diagnostics.map((d: any) => `  • ${d.message}`),
              ];
            }
          } catch (e: any) {
            isError = true;
            output = [`[COMPILER FAILURE] ${e.message || String(e)}`];
          }
        } else {
          isError = true;
          output = [`Unknown command: "${action}". Type "manifest help" for available commands.`];
        }
      } else {
        isError = true;
        output = [`Command not found: "${primary}". Type "manifest" or "help".`];
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
      {/* Terminal Subheader (#181818) */}
      <div className="h-8 bg-[#181818] border-b border-[#2d2d2d] px-3 flex items-center justify-between text-[11px] text-[#858585] select-none">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-[#858585]" />
          <span className="font-semibold text-[#cccccc]">Manifest CLI Terminal</span>
          <span className="text-[10px] text-[#767676] font-mono">(Core v0.1)</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleCommand('manifest check')}
            className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#cccccc] transition cursor-pointer"
          >
            check
          </button>
          <button
            onClick={() => handleCommand('manifest run')}
            className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#89d185] transition cursor-pointer"
          >
            run
          </button>
          <button
            onClick={() => handleCommand('manifest build')}
            className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#dcdcaa] transition cursor-pointer"
          >
            build
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

      {/* Terminal Buffer (#1f1f1f) */}
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

      {/* Interactive Input Line (#181818) */}
      <div className="h-9 border-t border-[#2d2d2d] bg-[#181818] px-3 flex items-center gap-2">
        <span className="text-[#858585] font-bold text-xs select-none">$</span>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="manifest run, manifest check, manifest build..."
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

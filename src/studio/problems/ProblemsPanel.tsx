/**
 * Manifest Studio - Problems & Diagnostics Panel
 * Displays structured diagnostics from Lexer, Parser, Validator, IR Builder, and Target Compiler.
 * Styled with VS Code Dark Modern tokens (#1f1f1f list, #181818 header, #2d2d2d borders).
 */

import React from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2, HelpCircle } from 'lucide-react';
import { StudioDiagnostic } from '../types.ts';

interface ProblemsPanelProps {
  diagnostics: StudioDiagnostic[];
  onSelectProblem?: (diagnostic: StudioDiagnostic) => void;
}

export const ProblemsPanel: React.FC<ProblemsPanelProps> = ({
  diagnostics,
  onSelectProblem,
}) => {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  return (
    <div className="flex-1 flex flex-col bg-[#1f1f1f] font-sans text-xs overflow-hidden">
      {/* Subheader */}
      <div className="h-8 bg-[#181818] border-b border-[#2d2d2d] px-3 flex items-center justify-between text-[11px] text-[#858585]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#cccccc]">Problems</span>
          <span className="flex items-center gap-1 text-[#f14c4c] font-mono">
            <AlertCircle className="w-3 h-3" /> {errors.length}
          </span>
          <span className="flex items-center gap-1 text-[#cca700] font-mono">
            <AlertTriangle className="w-3 h-3" /> {warnings.length}
          </span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar bg-[#1f1f1f]">
        {diagnostics.length === 0 ? (
          <div className="p-4 text-center text-[#858585] border border-dashed border-[#2d2d2d] rounded-lg flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#89d185]" />
            <span>No problems detected in the current Manifest project.</span>
          </div>
        ) : (
          diagnostics.map((diag, idx) => (
            <div
              key={idx}
              onClick={() => onSelectProblem?.(diag)}
              className={`p-3 rounded-lg border transition cursor-pointer space-y-1.5 ${
                diag.severity === 'error'
                  ? 'bg-[#2d1818] border-[#5a1d1d] hover:bg-[#381c1c]'
                  : 'bg-[#2d2518] border-[#544317] hover:bg-[#3b301c]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {diag.severity === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-[#f14c4c] flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#cca700] flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-[#ffffff]">{diag.message}</span>
                    <span className="ml-2 font-mono text-[10px] px-1.5 py-0.2 rounded bg-[#252526] border border-[#2d2d2d] text-[#cccccc]">
                      Line {diag.line}{diag.column ? `:${diag.column}` : ''}
                    </span>
                    {diag.source && (
                      <span className="ml-1 font-mono text-[10px] px-1.5 py-0.2 rounded bg-[#252526] border border-[#2d2d2d] text-[#858585] uppercase">
                        {diag.source}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {diag.hint && (
                <div className="text-[11px] text-[#dcdcaa] pl-6 flex items-start gap-1">
                  <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{diag.hint}</span>
                </div>
              )}

              {diag.example && (
                <div className="pl-6 pt-1">
                  <pre className="p-2 rounded bg-[#181818] border border-[#2d2d2d] text-[#ce9178] font-mono text-[10px] overflow-x-auto">
                    {diag.example}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

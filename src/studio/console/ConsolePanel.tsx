/**
 * Manifest Studio - Console Output Panel
 * Displays runtime and SHOW outputs, compiler notifications, and timestamps.
 * Styled with VS Code Dark Modern tokens (#1f1f1f stream, #181818 subheader, #2d2d2d dividers).
 */

import React from 'react';
import { Terminal, Trash2, CheckCircle2 } from 'lucide-react';
import { ConsoleEntry } from '../types.ts';

interface ConsolePanelProps {
  entries: ConsoleEntry[];
  onClear: () => void;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ entries, onClear }) => {
  return (
    <div className="flex-1 flex flex-col bg-[#1f1f1f] font-mono text-xs overflow-hidden">
      {/* Console Subheader / Actions (#181818) */}
      <div className="h-8 bg-[#181818] border-b border-[#2d2d2d] px-3 flex items-center justify-between text-[11px] text-[#858585]">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-[#858585]" />
          <span className="font-semibold text-[#cccccc]">Output Stream ({entries.length})</span>
        </div>
        <button
          onClick={onClear}
          className="text-[#858585] hover:text-[#cccccc] flex items-center gap-1 transition cursor-pointer"
        >
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </div>

      {/* Console Entries List (#1f1f1f) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-[#1f1f1f] custom-scrollbar">
        {entries.length === 0 ? (
          <div className="text-[#767676] italic py-2">
            No console output. Click &quot;Run&quot; or trigger interactive actions to see SHOW output here.
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`py-1 px-2 rounded flex items-start gap-2 ${
                entry.type === 'error'
                  ? 'bg-[#2d1818] text-[#f14c4c] border border-[#5a1d1d]'
                  : entry.type === 'build'
                  ? 'bg-[#2d2518] text-[#cca700] border border-[#544317]'
                  : 'text-[#cccccc] hover:bg-[#252526]'
              }`}
            >
              <span className="text-[#858585] text-[10px] select-none font-sans mt-0.5">
                {entry.timestamp}
              </span>
              <span className="text-[#858585] select-none">&gt;</span>
              <span className="whitespace-pre-wrap break-all flex-1">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

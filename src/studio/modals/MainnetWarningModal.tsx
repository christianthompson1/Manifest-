/**
 * Manifest Studio - Mainnet Warning Modal
 * Protects users from unintended Mainnet actions that consume real SOL.
 */

import React, { useState } from 'react';
import { AlertTriangle, X, ShieldAlert, Check } from 'lucide-react';

interface MainnetWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const MainnetWarningModal: React.FC<MainnetWarningModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-[#1e1e1e] border border-[#d29922]/50 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="h-12 border-b border-[#2d2d2d] bg-[#2a2110] px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#d29922]" />
            <span className="font-semibold text-sm text-[#f0883e]">Mainnet-Beta Caution</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 text-xs text-[#cccccc]">
          <div className="p-3 rounded-lg bg-[#38260f]/60 border border-[#bb8009]/40 flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-[#d29922] flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-[#ffffff]">Real Funds & Irreversible State</div>
              <div className="text-[11px] text-[#cccccc]/90">
                You are switching to or interacting with Solana Mainnet-Beta. Any transactions, account allocations, or contract deployments will consume <strong>real SOL</strong> and cannot be undone.
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2.5 p-2 rounded-lg bg-[#252526] border border-[#2d2d2d] cursor-pointer hover:bg-[#2a2a2b] transition">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="accent-[#d29922] w-4 h-4 rounded cursor-pointer"
            />
            <span className="text-[11px] text-[#cccccc]">
              I acknowledge that actions on Mainnet use real SOL.
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="h-12 border-t border-[#2d2d2d] bg-[#252526] px-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] text-xs transition"
          >
            Stay on Devnet
          </button>
          <button
            onClick={() => {
              if (acknowledged) {
                onConfirm();
                onClose();
              }
            }}
            disabled={!acknowledged}
            className="px-4 py-1.5 rounded-md bg-[#d29922] hover:bg-[#bb8009] disabled:opacity-40 text-black font-semibold text-xs transition cursor-pointer"
          >
            Proceed to Mainnet
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Manifest Studio - Mainnet Safety Warning & Confirmation Modal
 * Implements Section 15 & 21:
 * - High-visibility warning when switching to MAINNET
 * - Multi-point checklist for Mainnet operations
 * - Gated deployment confirmation ensuring accidental clicks cannot deploy to Mainnet
 */

import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert, Check, X, ShieldCheck } from 'lucide-react';

interface MainnetWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  actionType: 'switch_network' | 'deploy_program';
  programName?: string;
}

export const MainnetWarningModal: React.FC<MainnetWarningModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  actionType,
  programName = 'Solana Program',
}) => {
  const [checkedRealAssets, setCheckedRealAssets] = useState(false);
  const [checkedTestedDevnet, setCheckedTestedDevnet] = useState(false);
  const [checkedWalletSign, setCheckedWalletSign] = useState(false);

  if (!isOpen) return null;

  const isDeploy = actionType === 'deploy_program';
  const canProceed = isDeploy
    ? checkedRealAssets && checkedTestedDevnet && checkedWalletSign
    : checkedRealAssets;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-[#f14c4c]/40 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2d2d2d] bg-[#2d1818] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#4d1f24] border border-[#f14c4c]/50 flex items-center justify-center text-[#f85149]">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#ffffff]">
                {isDeploy ? 'Confirm Mainnet Deployment' : 'Switching to Solana Mainnet-Beta'}
              </h2>
              <p className="text-[11px] text-[#f85149]">Live blockchain environment</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#2d2d2d] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2 text-[#cccccc]">
            <p className="font-semibold text-[#ffffff]">
              {isDeploy
                ? `You are preparing to deploy "${programName}" to Solana Mainnet-Beta.`
                : 'You are switching your active network from Devnet to Mainnet-Beta.'}
            </p>
            <p className="text-[11px] text-[#858585] leading-relaxed">
              Mainnet-Beta transactions consume real SOL for rent-exemption, transaction base fees, and priority fees. All on-chain state changes are permanent and irreversible.
            </p>
          </div>

          {/* Verification Checklist */}
          <div className="space-y-2.5 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer text-[#cccccc] select-none">
              <input
                type="checkbox"
                checked={checkedRealAssets}
                onChange={(e) => setCheckedRealAssets(e.target.checked)}
                className="mt-0.5 rounded accent-[#f14c4c] w-4 h-4 cursor-pointer"
              />
              <span className="text-[11px]">
                I understand transactions on Mainnet-Beta consume real SOL and write permanent state.
              </span>
            </label>

            {isDeploy && (
              <>
                <label className="flex items-start gap-2.5 cursor-pointer text-[#cccccc] select-none">
                  <input
                    type="checkbox"
                    checked={checkedTestedDevnet}
                    onChange={(e) => setCheckedTestedDevnet(e.target.checked)}
                    className="mt-0.5 rounded accent-[#f14c4c] w-4 h-4 cursor-pointer"
                  />
                  <span className="text-[11px]">
                    This program has already been built and tested successfully on Devnet.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer text-[#cccccc] select-none">
                  <input
                    type="checkbox"
                    checked={checkedWalletSign}
                    onChange={(e) => setCheckedWalletSign(e.target.checked)}
                    className="mt-0.5 rounded accent-[#f14c4c] w-4 h-4 cursor-pointer"
                  />
                  <span className="text-[11px]">
                    I will review and sign the deployment transaction in my connected wallet.
                  </span>
                </label>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2d2d2d] bg-[#1f1f1f] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="py-1.5 px-3 rounded-md bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-xs text-[#cccccc] font-medium transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (canProceed) {
                onConfirm();
                onClose();
              }
            }}
            disabled={!canProceed}
            className="py-1.5 px-3.5 rounded-md bg-[#d32f2f] hover:bg-[#b71c1c] disabled:opacity-40 disabled:hover:bg-[#d32f2f] text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-xs"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{isDeploy ? 'Proceed to Sign Mainnet Deployment' : 'Confirm Switch to Mainnet'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

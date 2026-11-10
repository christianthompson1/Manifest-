/**
 * Manifest Studio - Professional VS Code Dark Modern Sidebar
 * Features:
 * - Activity Bar on the far left (#181818 with #2d2d2d border)
 * - Panels:
 *   - Explorer: Open Editors, File Tree, Inline File/Folder Creator, Rename, Delete, Project Actions
 *   - Solana: Live Wallet, Devnet Airdrop, Anchor Smart Contract Builder, Devnet/Mainnet Deployment
 *   - Git: GitHub Public Import, Commit & Push, GitHub Actions CI Workflow Status
 *   - Search: Global keyword & file search
 *   - Packages: Manifest Libraries (Framer Motion, Lucide, Solana Web3, etc.)
 *   - Settings: Quick Editor & Runtime preferences
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  Search,
  GitBranch,
  Boxes,
  Cpu,
  Settings,
  Plus,
  Trash2,
  Edit2,
  ChevronRight,
  ChevronDown,
  Layers,
  CheckCircle2,
  Sliders,
  Wifi,
  File,
  Coins,
  Github,
  Play,
  Download,
  Upload,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Flame,
  FolderPlus,
  FilePlus,
  Package,
  ShieldCheck,
  Check,
  AlertCircle,
  RefreshCw,
  BookOpen,
  Copy,
} from 'lucide-react';
import { ManifestProject, ProjectFile } from '../types.ts';
import { TEMPLATES, StudioSettings } from '../project-store.ts';
import { SolanaWalletService, WalletState, SolanaNetwork } from '../services/solana-wallet.ts';
import { HeliusPriorityFeeProvider, PriorityFeeEstimate, PriorityFeeLevel } from '../services/priority-fees.ts';
import { LibraryRegistry } from '../../../manifest-core/src/libraries/library-registry.ts';
import { PackageManager, OFFICIAL_PACKAGE_REGISTRY } from '../../../manifest-core/src/package/package-manager.ts';
import { StdLibraryRegistry, StdModuleDef } from '../../../manifest-core/src/stdlib/std-modules.ts';
import { ProjectTree } from '../explorer/ProjectTree.tsx';

export type ActivityTab = 'explorer' | 'search' | 'solana' | 'git' | 'packages' | 'devtools' | 'settings';

interface SidebarProps {
  project: ManifestProject;
  activeFilePath: string;
  openFilePaths: string[];
  activeActivity: ActivityTab;
  onSelectActivity: (tab: ActivityTab) => void;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDuplicateFile?: (path: string) => void;
  onWriteFile?: (path: string, content: string) => void;
  onSelectTemplate: (templateId: string) => void;
  onOpenDevTools: () => void;
  onOpenProjectMenu?: () => void;
  onOpenGitHubImport?: () => void;
  onOpenSolanaDeploy?: () => void;
  onOpenMainnetWarning?: () => void;
  onOpenSettings?: () => void;
  onShowToast?: (msg: string) => void;
  settings: StudioSettings;
  onUpdateSettings: (settings: StudioSettings) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  project,
  activeFilePath,
  openFilePaths,
  activeActivity,
  onSelectActivity,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  onDuplicateFile,
  onWriteFile,
  onSelectTemplate,
  onOpenDevTools,
  onOpenProjectMenu,
  onOpenGitHubImport,
  onOpenSolanaDeploy,
  onOpenMainnetWarning,
  onOpenSettings,
  onShowToast,
  settings,
  onUpdateSettings,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [createTrigger, setCreateTrigger] = useState<{ type: 'file' | 'folder'; nonce: number } | null>(null);

  // Packages & Standard Library state
  const [packageSubTab, setPackageSubTab] = useState<'dependencies' | 'stdlib'>('dependencies');
  const [selectedCatalogPkg, setSelectedCatalogPkg] = useState('std-core');
  const [customConstraint, setCustomConstraint] = useState('^1.0.0');
  const [verifyStatus, setVerifyStatus] = useState<{ checked: boolean; ok: boolean; errors: string[] } | null>(null);
  const [stdlibFilter, setStdlibFilter] = useState('');
  const [copiedModule, setCopiedModule] = useState<string | null>(null);

  // Solana live state
  const walletService = SolanaWalletService.getInstance();
  const feeProvider = HeliusPriorityFeeProvider.getInstance();
  const [walletState, setWalletState] = useState<WalletState>(walletService.getState());
  const [isAirdropping, setIsAirdropping] = useState(false);
  const [priorityFeeLevel, setPriorityFeeLevel] = useState<PriorityFeeLevel>('medium');
  const [feeEstimate, setFeeEstimate] = useState<PriorityFeeEstimate | null>(null);

  useEffect(() => {
    return walletService.subscribe(setWalletState);
  }, [walletService]);

  useEffect(() => {
    feeProvider.getEstimate(priorityFeeLevel).then(setFeeEstimate);
  }, [priorityFeeLevel, feeProvider]);

  const searchResults = project.files.filter(
    (f) =>
      !f.path.endsWith('/.gitkeep') &&
      (f.path.toLowerCase().includes(globalSearchQuery.toLowerCase()) ||
        (!f.isBinary && f.content.toLowerCase().includes(globalSearchQuery.toLowerCase())))
  );

  return (
    <div className="flex h-full border-r border-[#2d2d2d] bg-[#181818] select-none text-xs">
      {/* 1. Leftmost Activity Rail (VS Code #181818 Style) */}
      <div className="w-12 bg-[#181818] border-r border-[#2d2d2d] flex flex-col items-center py-2 justify-between z-20">
        <div className="flex flex-col items-center gap-1 w-full">
          {/* Explorer */}
          <button
            onClick={() => {
              if (activeActivity === 'explorer' && !isCollapsed) onToggleCollapse();
              else {
                onSelectActivity('explorer');
                if (isCollapsed) onToggleCollapse();
              }
            }}
            title="Explorer"
            className={`w-9 h-9 rounded flex items-center justify-center transition cursor-pointer relative ${
              activeActivity === 'explorer' && !isCollapsed ? 'text-[#ffffff]' : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]'
            }`}
          >
            {activeActivity === 'explorer' && !isCollapsed && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#ffffff] rounded-r" />
            )}
            <Folder className="w-4 h-4" />
          </button>

          {/* Search */}
          <button
            onClick={() => {
              if (activeActivity === 'search' && !isCollapsed) onToggleCollapse();
              else {
                onSelectActivity('search');
                if (isCollapsed) onToggleCollapse();
              }
            }}
            title="Search"
            className={`w-9 h-9 rounded flex items-center justify-center transition cursor-pointer relative ${
              activeActivity === 'search' && !isCollapsed ? 'text-[#ffffff]' : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]'
            }`}
          >
            {activeActivity === 'search' && !isCollapsed && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#ffffff] rounded-r" />
            )}
            <Search className="w-4 h-4" />
          </button>

          {/* Solana Program Manager */}
          <button
            onClick={() => {
              if (activeActivity === 'solana' && !isCollapsed) onToggleCollapse();
              else {
                onSelectActivity('solana');
                if (isCollapsed) onToggleCollapse();
              }
            }}
            title="Solana Development Foundation"
            className={`w-9 h-9 rounded flex items-center justify-center transition cursor-pointer relative ${
              activeActivity === 'solana' && !isCollapsed ? 'text-[#a78bfa]' : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]'
            }`}
          >
            {activeActivity === 'solana' && !isCollapsed && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#8b5cf6] rounded-r" />
            )}
            <Coins className="w-4 h-4" />
          </button>

          {/* Source Control / Git */}
          <button
            onClick={() => {
              if (activeActivity === 'git' && !isCollapsed) onToggleCollapse();
              else {
                onSelectActivity('git');
                if (isCollapsed) onToggleCollapse();
              }
            }}
            title="GitHub & Source Control"
            className={`w-9 h-9 rounded flex items-center justify-center transition cursor-pointer relative ${
              activeActivity === 'git' && !isCollapsed ? 'text-[#ffffff]' : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]'
            }`}
          >
            {activeActivity === 'git' && !isCollapsed && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#ffffff] rounded-r" />
            )}
            <GitBranch className="w-4 h-4" />
          </button>

          {/* Packages & Capabilities */}
          <button
            onClick={() => {
              if (activeActivity === 'packages' && !isCollapsed) onToggleCollapse();
              else {
                onSelectActivity('packages');
                if (isCollapsed) onToggleCollapse();
              }
            }}
            title="Manifest Capabilities & Libraries"
            className={`w-9 h-9 rounded flex items-center justify-center transition cursor-pointer relative ${
              activeActivity === 'packages' && !isCollapsed ? 'text-[#ffffff]' : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]'
            }`}
          >
            {activeActivity === 'packages' && !isCollapsed && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#ffffff] rounded-r" />
            )}
            <Boxes className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom Rail Controls */}
        <div className="flex flex-col items-center gap-1 w-full">
          <button
            onClick={onOpenDevTools}
            title="Compiler Testbench & Unit Tests"
            className="w-9 h-9 rounded flex items-center justify-center transition cursor-pointer text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]"
          >
            <Cpu className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              if (activeActivity === 'settings' && !isCollapsed) onToggleCollapse();
              else {
                onSelectActivity('settings');
                if (isCollapsed) onToggleCollapse();
              }
            }}
            title="Project Settings"
            className={`w-9 h-9 rounded flex items-center justify-center transition cursor-pointer ${
              activeActivity === 'settings' && !isCollapsed ? 'text-[#ffffff]' : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]'
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Secondary Sidebar Surface */}
      {!isCollapsed && (
        <div className="w-64 bg-[#181818] flex flex-col h-full border-r border-[#2d2d2d] overflow-hidden">
          {/* Header */}
          <div className="h-9 px-3 border-b border-[#2d2d2d] flex items-center justify-between text-[11px] font-semibold tracking-wider text-[#858585] uppercase">
            <span>
              {activeActivity === 'explorer' && 'Explorer'}
              {activeActivity === 'search' && 'Search'}
              {activeActivity === 'solana' && 'Solana Development'}
              {activeActivity === 'git' && 'Source Control'}
              {activeActivity === 'packages' && 'Manifest Libraries'}
              {activeActivity === 'settings' && 'Settings'}
            </span>

            {activeActivity === 'explorer' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCreateTrigger((prev) => ({ type: 'file', nonce: (prev?.nonce || 0) + 1 }))}
                  title="New File"
                  className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#242424] transition cursor-pointer"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCreateTrigger((prev) => ({ type: 'folder', nonce: (prev?.nonce || 0) + 1 }))}
                  title="New Folder"
                  className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#242424] transition cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onOpenProjectMenu}
                  title="Project Management"
                  className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#242424] transition cursor-pointer"
                >
                  <Boxes className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Activity Panel Views */}
          {activeActivity === 'explorer' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Quick Filter */}
              <div className="p-2 border-b border-[#2d2d2d]">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 absolute left-2 text-[#858585] pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter files & folders..."
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded pl-7 pr-2 py-0.5 text-xs text-[#cccccc] placeholder:text-[#767676] outline-none focus:border-[#569cd6]"
                  />
                </div>
              </div>

              {/* Recursive File & Folder Tree */}
              <ProjectTree
                project={project}
                activeFilePath={activeFilePath}
                filterQuery={searchQuery}
                createTrigger={createTrigger}
                onSelectFile={onSelectFile}
                onCreateFile={onCreateFile}
                onRenameFile={onRenameFile}
                onDuplicateFile={onDuplicateFile}
                onDeleteFile={onDeleteFile}
              />

              {/* Bottom Quick Import Actions */}
              <div className="p-2 border-t border-[#2d2d2d] bg-[#181818] grid grid-cols-2 gap-1.5">
                <button
                  onClick={onOpenGitHubImport}
                  className="py-1 px-2 rounded bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#89d185] text-[11px] text-[#cccccc] flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Github className="w-3 h-3" />
                  <span>GitHub</span>
                </button>
                <button
                  onClick={onOpenProjectMenu}
                  className="py-1 px-2 rounded bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#569cd6] text-[11px] text-[#cccccc] flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Boxes className="w-3 h-3" />
                  <span>Project</span>
                </button>
              </div>
            </div>
          )}

          {/* Search Activity View */}
          {activeActivity === 'search' && (
            <div className="flex-1 flex flex-col overflow-hidden p-2.5 space-y-2">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 absolute left-2 text-[#858585] pointer-events-none" />
                <input
                  type="text"
                  value={globalSearchQuery}
                  onChange={(e) => setGlobalSearchQuery(e.target.value)}
                  placeholder="Search across workspace..."
                  autoFocus
                  className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded pl-7 pr-2 py-1 text-xs text-[#cccccc] placeholder:text-[#767676] outline-none focus:border-[#569cd6]"
                />
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                {searchResults.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => onSelectFile(file.path)}
                    className="w-full text-left p-2 rounded bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] transition cursor-pointer"
                  >
                    <div className="font-mono text-[11px] text-[#9cdcfe] truncate">{file.path}</div>
                    {!file.isBinary && globalSearchQuery.trim() && (
                      <div className="text-[10px] text-[#858585] truncate mt-0.5">
                        {file.content
                          .split('\n')
                          .find((line) => line.toLowerCase().includes(globalSearchQuery.toLowerCase())) || ''}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Solana Development View */}
          {activeActivity === 'solana' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              {/* Wallet Status Card */}
              <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#858585] uppercase">Solana Wallet</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-mono uppercase font-semibold ${
                      walletState.network === 'mainnet'
                        ? 'bg-[#2d1818] text-[#f85149] border border-[#f14c4c]/40'
                        : 'bg-[#252526] text-[#89d185] border border-[#89d185]/30'
                    }`}
                  >
                    {walletState.network}
                  </span>
                </div>

                {walletState.connected ? (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-mono text-[#ffffff] truncate">
                      {walletState.publicKey}
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#858585]">Balance:</span>
                      <span className="font-mono text-[#89d185] font-semibold">
                        {walletState.balanceSol.toFixed(4)} SOL
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {walletState.network === 'devnet' && (
                        <button
                          onClick={async () => {
                            setIsAirdropping(true);
                            try {
                              const res = await walletService.requestAirdrop();
                              onShowToast?.(res.message);
                            } catch (err: any) {
                              onShowToast?.(err.message || 'Airdrop failed');
                            } finally {
                              setIsAirdropping(false);
                            }
                          }}
                          disabled={isAirdropping}
                          className="py-1 px-2 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#a78bfa] font-medium flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {isAirdropping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                          <span>Airdrop SOL</span>
                        </button>
                      )}
                      <button
                        onClick={() => walletService.disconnect()}
                        className="py-1 px-2 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[10px] text-[#f85149] font-medium cursor-pointer"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => walletService.connect()}
                    className="w-full py-1.5 px-3 rounded bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Coins className="w-3.5 h-3.5" />
                    <span>Connect Wallet</span>
                  </button>
                )}
              </div>

              {/* Solana Verification & Controls */}
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase font-semibold text-[#858585]">Solana Verification &amp; Tx</div>
                <button
                  onClick={onOpenSolanaDeploy}
                  className="w-full py-2 px-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#8b5cf6]/40 text-[#ffffff] text-xs font-semibold flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Coins className="w-3.5 h-3.5 text-[#8b5cf6]" />
                    <span>Solana Verification Panel</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#858585]" />
                </button>

                <div className="p-2.5 rounded-lg bg-[#252526]/50 border border-[#2d2d2d] text-[11px] text-[#858585] space-y-1">
                  <div className="flex items-center justify-between">
                    <span>Program Build:</span>
                    <span className="text-[#89d185] font-mono">Phase 3 Ready</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Native LiteSVM:</span>
                    <span className="text-[#89d185] font-mono">In-Process Active</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-[#2d2d2d]">
                    <span>Deployment:</span>
                    <span className="text-[#f85149] font-mono font-semibold">Phase 4 (Not Implemented)</span>
                  </div>
                </div>
              </div>

              {/* Priority Fees */}
              <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#ffffff] flex items-center gap-1">
                    <Flame className="w-3 h-3 text-[#cca700]" />
                    <span>Priority Fee</span>
                  </span>
                  <span className="text-[10px] text-[#89d185] font-mono">
                    {feeEstimate?.microLamports.toLocaleString() || '50,000'} µL
                  </span>
                </div>
                <select
                  value={priorityFeeLevel}
                  onChange={(e) => setPriorityFeeLevel(e.target.value as PriorityFeeLevel)}
                  className="w-full bg-[#181818] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-[#cccccc] outline-none"
                >
                  <option value="auto">Auto (Dynamic congestion)</option>
                  <option value="low">Low (1,000 µL)</option>
                  <option value="medium">Medium (50,000 µL)</option>
                  <option value="high">High (250,000 µL)</option>
                </select>
                <div className="text-[10px] text-[#858585]">
                  Est: ~{feeEstimate?.estimatedSolCost || 0.00001} SOL per 200k CU
                </div>
              </div>
            </div>
          )}

          {/* Git Source Control View */}
          {activeActivity === 'git' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#ffffff]">
                  <Github className="w-4 h-4" />
                  <span>GitHub Repository</span>
                </div>
                <p className="text-[11px] text-[#858585]">
                  Directly clone, inspect, and export repositories.
                </p>
                <button
                  onClick={onOpenGitHubImport}
                  className="w-full py-1.5 px-3 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Import from GitHub</span>
                </button>
              </div>

              <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-1.5">
                <div className="text-[11px] font-semibold text-[#858585] uppercase">GitHub Actions CI/CD</div>
                <p className="text-[11px] text-[#858585]">
                  Anchor build workflow template ready at:
                </p>
                <div className="text-[10px] font-mono text-[#9cdcfe]">
                  .github/workflows/anchor-build.yml
                </div>
                <div className="text-[10px] text-[#89d185]">
                  Pinned toolchain: Rust 1.83.0 / Solana 1.18.26 / Anchor 0.30.1
                </div>
              </div>
            </div>
          )}

          {/* Packages & Capabilities View */}
          {activeActivity === 'packages' && (() => {
            const manifestFile = project.files.find((f) => f.path === 'manifest.toml');
            const lockFile = project.files.find((f) => f.path === 'manifest.lock');

            let parsedConfig = null;
            let parseError = '';
            if (manifestFile) {
              try {
                parsedConfig = PackageManager.parsePackageToml(manifestFile.content);
              } catch (err: any) {
                parseError = err.message;
              }
            }

            let parsedLock: any = null;
            if (lockFile) {
              try {
                parsedLock = PackageManager.parseLockfile(lockFile.content);
              } catch {
                parsedLock = null;
              }
            }

            const handleInitManifest = () => {
              const defaultToml = PackageManager.initPackage(project.name || 'manifest-project');
              if (onWriteFile) {
                onWriteFile('manifest.toml', defaultToml);
              } else {
                onCreateFile('manifest.toml');
              }
              onSelectFile('manifest.toml');
              onShowToast?.('Created manifest.toml');
            };

            const handleAddDep = (pkgName: string, constraint: string) => {
              if (!manifestFile) {
                onShowToast?.('Initialize manifest.toml first');
                return;
              }
              const res = PackageManager.addDependency(manifestFile.content, pkgName, constraint);
              if (!res.ok) {
                const errMsg = res.result.diagnostics.map((d) => d.message).join('; ') || 'Resolution failed';
                onShowToast?.(`Error adding ${pkgName}: ${errMsg}`);
                return;
              }
              if (onWriteFile) {
                onWriteFile('manifest.toml', res.toml);
                if (res.lock) onWriteFile('manifest.lock', res.lock);
              }
              setVerifyStatus(null);
              onShowToast?.(`Added dependency ${pkgName} ${constraint}`);
            };

            const handleRemoveDep = (pkgName: string) => {
              if (!manifestFile) return;
              const res = PackageManager.removeDependency(manifestFile.content, pkgName);
              if (!res.ok) {
                const errMsg = res.result.diagnostics.map((d) => d.message).join('; ') || 'Removal failed';
                onShowToast?.(`Error removing ${pkgName}: ${errMsg}`);
                return;
              }
              if (onWriteFile) {
                onWriteFile('manifest.toml', res.toml);
                if (res.lock) onWriteFile('manifest.lock', res.lock);
              }
              setVerifyStatus(null);
              onShowToast?.(`Removed dependency ${pkgName}`);
            };

            const handleVerify = () => {
              if (!manifestFile) return;
              const res = PackageManager.verifyPackage(manifestFile.content, lockFile?.content);
              setVerifyStatus({ checked: true, ok: res.ok, errors: res.errors });
              if (res.ok) {
                onShowToast?.('Package & lockfile integrity verified');
              } else {
                onShowToast?.(`Verification issue: ${res.errors[0] || 'Unknown'}`);
              }
            };

            const allStdModules = StdLibraryRegistry.getInstance().listModules();
            const filteredStdModules = allStdModules.filter((m) =>
              m.name.toLowerCase().includes(stdlibFilter.toLowerCase()) ||
              m.description.toLowerCase().includes(stdlibFilter.toLowerCase())
            );

            const officialPackages = Object.keys(OFFICIAL_PACKAGE_REGISTRY);

            return (
              <div className="flex-1 flex flex-col min-h-0 bg-[#181818]">
                {/* Sub-tab Navigation */}
                <div className="flex items-center border-b border-[#2d2d2d] bg-[#1a1a1a] px-2 py-1.5 gap-1 shrink-0">
                  <button
                    onClick={() => setPackageSubTab('dependencies')}
                    className={`flex-1 py-1 px-2 text-[11px] font-medium rounded transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      packageSubTab === 'dependencies'
                        ? 'bg-[#252526] text-[#ffffff] border border-[#3c3c3c]'
                        : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#202020]'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5 text-[#569cd6]" />
                    <span>Packages</span>
                  </button>
                  <button
                    onClick={() => setPackageSubTab('stdlib')}
                    className={`flex-1 py-1 px-2 text-[11px] font-medium rounded transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      packageSubTab === 'stdlib'
                        ? 'bg-[#252526] text-[#ffffff] border border-[#3c3c3c]'
                        : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#202020]'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[#4ec9b0]" />
                    <span>Stdlib (std::*)</span>
                  </button>
                </div>

                {/* Sub-tab 1: Project Dependencies */}
                {packageSubTab === 'dependencies' && (
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                    {!manifestFile ? (
                      <div className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2.5 text-center">
                        <Package className="w-8 h-8 text-[#569cd6] mx-auto opacity-75" />
                        <div>
                          <div className="text-xs font-semibold text-[#ffffff]">No manifest.toml Found</div>
                          <p className="text-[10px] text-[#858585] mt-1 leading-relaxed">
                            Initialize a package configuration to manage versioned dependencies, SemVer constraints, and capability permissions.
                          </p>
                        </div>
                        <button
                          onClick={handleInitManifest}
                          className="w-full py-1.5 px-3 rounded bg-[#569cd6] hover:bg-[#4a89bd] text-[#ffffff] font-medium text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Initialize manifest.toml</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Package Meta Header */}
                        <div className="p-2.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Package className="w-4 h-4 text-[#569cd6] shrink-0" />
                              <span className="font-semibold text-xs text-[#ffffff] truncate">
                                {parsedConfig?.name || 'package'}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#252526] text-[#89d185] font-mono border border-[#2d2d2d]">
                                v{parsedConfig?.version || '0.1.0'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={handleVerify}
                                title="Verify package & lockfile integrity"
                                className="p-1 rounded hover:bg-[#2a2a2a] text-[#858585] hover:text-[#4ec9b0] transition cursor-pointer"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onSelectFile('manifest.toml')}
                                title="Open manifest.toml"
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#9cdcfe] border border-[#2d2d2d] transition cursor-pointer"
                              >
                                toml
                              </button>
                              {lockFile && (
                                <button
                                  onClick={() => onSelectFile('manifest.lock')}
                                  title="Open manifest.lock"
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#ce9178] border border-[#2d2d2d] transition cursor-pointer"
                                >
                                  lock
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Verification Banner */}
                          {verifyStatus && (
                            <div
                              className={`p-2 rounded text-[10px] flex items-start gap-1.5 ${
                                verifyStatus.ok
                                  ? 'bg-[#1e2a22] text-[#89d185] border border-[#2b4c33]'
                                  : 'bg-[#2a1e1e] text-[#f48771] border border-[#4c2b2b]'
                              }`}
                            >
                              {verifyStatus.ok ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>Integrity verified: all checksums match SHA-256 signatures.</span>
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <div>
                                    <div className="font-semibold">Integrity Check Failed:</div>
                                    <ul className="list-disc list-inside space-y-0.5 mt-0.5">
                                      {verifyStatus.errors.map((err, i) => (
                                        <li key={i}>{err}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Declared Dependencies List */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-semibold text-[#858585] uppercase flex items-center justify-between">
                            <span>Declared Dependencies</span>
                            <span className="text-[9px] font-mono text-[#858585]">
                              {Object.keys(parsedConfig?.dependencies || {}).length} pkgs
                            </span>
                          </div>

                          {Object.keys(parsedConfig?.dependencies || {}).length === 0 ? (
                            <div className="p-2.5 rounded bg-[#1f1f1f] border border-[#2d2d2d] text-[10px] text-[#858585] text-center">
                              No dependencies declared. Add packages below.
                            </div>
                          ) : (
                            Object.entries(parsedConfig?.dependencies || {}).map(([pkg, req]) => {
                              const locked = parsedLock?.packages?.[pkg];
                              return (
                                <div
                                  key={pkg}
                                  className="p-2 rounded bg-[#1f1f1f] border border-[#2d2d2d] flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-xs text-[#ffffff] truncate">{pkg}</span>
                                      <span className="text-[9px] font-mono px-1 rounded bg-[#252526] text-[#9cdcfe] border border-[#2d2d2d]">
                                        {String(req)}
                                      </span>
                                    </div>
                                    <div className="text-[9px] text-[#858585] flex items-center gap-1 mt-0.5 font-mono">
                                      {locked ? (
                                        <>
                                          <span className="text-[#89d185]">v{locked.version} (locked)</span>
                                          <span>•</span>
                                          <span className="truncate max-w-[120px]" title={locked.integrity}>
                                            {locked.integrity.slice(0, 15)}...
                                          </span>
                                        </>
                                      ) : (
                                        <span className="text-[#dcdcaa]">unlocked</span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleRemoveDep(pkg)}
                                    title={`Remove ${pkg}`}
                                    className="p-1 rounded hover:bg-[#2a2a2a] text-[#858585] hover:text-[#f48771] transition cursor-pointer shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Quick-add Official Catalog */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-semibold text-[#858585] uppercase">
                            Official Registry Packages
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {officialPackages.map((pkg) => {
                              const isAdded = Boolean(parsedConfig?.dependencies?.[pkg]);
                              return (
                                <button
                                  key={pkg}
                                  disabled={isAdded}
                                  onClick={() => handleAddDep(pkg, '^1.0.0')}
                                  className={`p-1.5 rounded text-left border transition text-[10px] flex items-center justify-between cursor-pointer ${
                                    isAdded
                                      ? 'bg-[#1a1a1a] border-[#252526] text-[#606060] cursor-not-allowed'
                                      : 'bg-[#1f1f1f] hover:bg-[#252526] border-[#2d2d2d] text-[#cccccc] hover:text-[#ffffff]'
                                  }`}
                                >
                                  <span className="font-mono truncate">{pkg}</span>
                                  {isAdded ? (
                                    <Check className="w-3 h-3 text-[#89d185] shrink-0" />
                                  ) : (
                                    <Plus className="w-3 h-3 text-[#569cd6] shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Add Dependency Input Form */}
                        <div className="p-2.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2">
                          <div className="text-[10px] font-semibold text-[#858585] uppercase">
                            Add Custom Dependency
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              type="text"
                              placeholder="package-name"
                              value={selectedCatalogPkg}
                              onChange={(e) => setSelectedCatalogPkg(e.target.value)}
                              className="w-full bg-[#181818] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-[#cccccc] focus:border-[#569cd6] focus:outline-none font-mono"
                            />
                            <input
                              type="text"
                              placeholder="^1.0.0"
                              value={customConstraint}
                              onChange={(e) => setCustomConstraint(e.target.value)}
                              className="w-full bg-[#181818] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-[#cccccc] focus:border-[#569cd6] focus:outline-none font-mono"
                            />
                          </div>
                          <button
                            onClick={() => handleAddDep(selectedCatalogPkg, customConstraint)}
                            className="w-full py-1 px-2.5 rounded bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] hover:text-[#ffffff] font-medium text-xs transition cursor-pointer flex items-center justify-center gap-1.5 border border-[#3c3c3c]"
                          >
                            <Plus className="w-3.5 h-3.5 text-[#569cd6]" />
                            <span>Add to Dependencies</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Sub-tab 2: Standard Library Explorer */}
                {packageSubTab === 'stdlib' && (
                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
                    {/* Search / Filter input */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#858585] absolute left-2.5 top-2" />
                      <input
                        type="text"
                        placeholder="Filter std::* modules..."
                        value={stdlibFilter}
                        onChange={(e) => setStdlibFilter(e.target.value)}
                        className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded pl-8 pr-2 py-1.5 text-xs text-[#cccccc] focus:border-[#4ec9b0] focus:outline-none font-sans"
                      />
                    </div>

                    <div className="space-y-1.5">
                      {filteredStdModules.map((mod) => {
                        const isPure = mod.capabilities.length === 0;
                        const isCopied = copiedModule === mod.name;
                        return (
                          <div
                            key={mod.name}
                            className="p-2.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-semibold text-xs text-[#ffffff] font-mono">
                                {mod.name}
                              </span>
                              <div className="flex items-center gap-1">
                                {isPure ? (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#1e2a22] text-[#89d185] border border-[#2b4c33]">
                                    pure
                                  </span>
                                ) : (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#2a241e] text-[#dcdcaa] border border-[#4c3d2b]">
                                    {mod.capabilities.join(', ')}
                                  </span>
                                )}
                                <button
                                  onClick={() => {
                                    const importStmt = `import { } from "${mod.name}";\n`;
                                    navigator.clipboard?.writeText(importStmt);
                                    setCopiedModule(mod.name);
                                    setTimeout(() => setCopiedModule(null), 1500);
                                    onShowToast?.(`Copied import for ${mod.name}`);
                                  }}
                                  title="Copy import statement"
                                  className="p-1 rounded hover:bg-[#2a2a2a] text-[#858585] hover:text-[#4ec9b0] transition cursor-pointer"
                                >
                                  {isCopied ? <Check className="w-3 h-3 text-[#89d185]" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                            <p className="text-[10px] text-[#858585] leading-relaxed">{mod.description}</p>
                            <div className="flex items-center gap-2 pt-1 border-t border-[#252526] text-[9px] text-[#666666] font-mono">
                              <span>Lang: Manifest</span>
                              <span>•</span>
                              <span>Status: Implemented</span>
                              <span>•</span>
                              <span>Targets: MVM, Web-JS, WASM</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Settings View */}
          {activeActivity === 'settings' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              <div className="space-y-1">
                <label className="text-[#cccccc] text-xs">Editor Font Size ({settings.fontSize}px)</label>
                <input
                  type="range"
                  min="11"
                  max="18"
                  value={settings.fontSize}
                  onChange={(e) => onUpdateSettings({ ...settings, fontSize: Number(e.target.value) })}
                  className="w-full accent-[#569cd6]"
                />
              </div>

              <label className="flex items-center justify-between p-2 rounded bg-[#1f1f1f] border border-[#2d2d2d] cursor-pointer">
                <span className="text-xs text-[#cccccc]">Word Wrap</span>
                <input
                  type="checkbox"
                  checked={settings.wordWrap}
                  onChange={(e) => onUpdateSettings({ ...settings, wordWrap: e.target.checked })}
                  className="accent-[#569cd6] cursor-pointer"
                />
              </label>

              <div className="pt-2 border-t border-[#2d2d2d] space-y-2">
                {onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="w-full py-1.5 px-2.5 rounded bg-[#242424] hover:bg-[#2d2d2d] text-[#cccccc] font-medium text-xs transition cursor-pointer flex items-center justify-center gap-1.5 border border-[#2d2d2d]"
                  >
                    <Settings className="w-3.5 h-3.5 text-[#9cdcfe]" />
                    <span>Project & Studio Settings</span>
                  </button>
                )}
                <button
                  onClick={onOpenDevTools}
                  className="w-full py-1.5 px-2.5 rounded bg-[#242424] hover:bg-[#2d2d2d] text-[#cccccc] font-medium text-xs transition cursor-pointer flex items-center justify-center gap-1.5 border border-[#2d2d2d]"
                >
                  <Cpu className="w-3.5 h-3.5 text-[#9cdcfe]" />
                  <span>Compiler Testbench</span>
                </button>
              </div>
            </div>
          )}

          {/* Project Switcher Footer */}
          <div className="p-2 border-t border-[#2d2d2d] bg-[#181818]">
            <select
              value={TEMPLATES.some((t) => t.name === project.name) ? TEMPLATES.find((t) => t.name === project.name)?.id : 'custom'}
              onChange={(e) => onSelectTemplate(e.target.value)}
              className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-[#cccccc] outline-none cursor-pointer hover:border-[#454545]"
            >
              {TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Manifest Studio - Comprehensive Project Settings Modal
 * Implements Section 29: Project Settings
 * Sections: General, Manifest, Web, Solana, GitHub, Libraries, Build, Environment
 */

import React, { useState, useEffect } from 'react';
import {
  Settings,
  X,
  FileCode,
  Globe,
  Coins,
  Github,
  Boxes,
  Cpu,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { ManifestProject, StudioSyntaxProfile } from '../types.ts';
import { StudioSettings } from '../project-store.ts';
import { SolanaWalletService, SolanaNetwork } from '../services/solana-wallet.ts';
import { PriorityFeeLevel } from '../services/priority-fees.ts';
import { LibraryRegistry } from '../../../manifest-core/src/libraries/library-registry.ts';
import { COMPILER_TARGETS } from '../../../manifest-core/src/index.ts';

export interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project?: ManifestProject;
  settings?: StudioSettings;
  onUpdateProject?: (proj: ManifestProject) => void;
  onUpdateSettings?: (settings: StudioSettings) => void;
  onShowToast: (msg: string) => void;
  onOpenMainnetWarning?: () => void;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  isOpen,
  onClose,
  project,
  settings,
  onUpdateProject,
  onUpdateSettings,
  onShowToast,
  onOpenMainnetWarning,
}) => {
  const [activeTab, setActiveTab] = useState<
    'general' | 'editor' | 'manifest' | 'solana' | 'github' | 'libraries' | 'build' | 'environment'
  >('general');

  const walletService = SolanaWalletService.getInstance();
  const [projectName, setProjectName] = useState(project?.name || 'Manifest Project');
  const [projectDesc, setProjectDesc] = useState(project?.description || '');
  const [entryPath, setEntryPath] = useState(
    project?.entryPath || project?.files?.find((f) => f.path.endsWith('.manifest') || f.path === 'index.html')?.path || 'src/main.manifest'
  );
  const [fontSize, setFontSize] = useState<number>(settings?.fontSize ?? 13);
  const [wordWrap, setWordWrap] = useState<boolean>(settings?.wordWrap ?? false);
  const [activeNetwork, setActiveNetwork] = useState<SolanaNetwork>(() => {
    try {
      return walletService.getNetwork();
    } catch {
      return 'devnet';
    }
  });
  const [customRpcUrl, setCustomRpcUrl] = useState('');
  const [priorityFeeMode, setPriorityFeeMode] = useState<PriorityFeeLevel>('medium');
  const [programId, setProgramId] = useState('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubBranch, setGithubBranch] = useState('main');
  const [syntaxProfile, setSyntaxProfile] = useState<StudioSyntaxProfile>(project?.syntaxProfile || 'auto');
  const [compilerTarget, setCompilerTarget] = useState<string>(project?.compilerTarget || 'auto');

  useEffect(() => {
    if (project) {
      setProjectName(project.name || 'Manifest Project');
      setProjectDesc(project.description || '');
      setSyntaxProfile(project.syntaxProfile || 'auto');
      setCompilerTarget(project.compilerTarget || 'auto');
      const toml = project.files.find((f) => f.path === 'manifest.toml');
      const tomlEntry = toml?.content.match(/entry\s*=\s*["']([^"']+)["']/)?.[1];
      setEntryPath(
        project.entryPath ||
          tomlEntry ||
          project.files.find((f) => f.path.endsWith('.manifest') || f.path === 'index.html' || f.path.endsWith('.wasm'))?.path ||
          project.files[0]?.path ||
          'src/main.manifest'
      );
    }
    if (settings) {
      setFontSize(settings.fontSize ?? 13);
      setWordWrap(settings.wordWrap ?? false);
    }
  }, [project, settings, isOpen]);

  const [hasHeliusKey, setHasHeliusKey] = useState(false);
  useEffect(() => {
    fetch('/api/solana/status')
      .then((r) => r.json())
      .then((d) => setHasHeliusKey(Boolean(d.heliusConfigured)))
      .catch(() => setHasHeliusKey(false));
  }, []);

  const registry = LibraryRegistry.getInstance();
  const libraries = registry.listLibraries();

  if (!isOpen) return null;

  const handleSave = () => {
    if (project && onUpdateProject) {
      const cleanEntry = entryPath.trim();
      const updatedFiles = project.files.map((f) => {
        if (f.path === 'manifest.toml' && cleanEntry.endsWith('.manifest')) {
          return {
            ...f,
            content: f.content.replace(/entry\s*=\s*["'][^"']+["']/, `entry = "${cleanEntry}"`),
          };
        }
        return f;
      });
      onUpdateProject({
        ...project,
        name: projectName,
        description: projectDesc,
        syntaxProfile,
        compilerTarget,
        entryPath: cleanEntry || project.entryPath,
        files: updatedFiles,
        updatedAt: Date.now(),
      });
    }
    if (settings && onUpdateSettings) {
      onUpdateSettings({
        ...settings,
        fontSize,
        wordWrap,
      });
    }
    if (customRpcUrl) {
      walletService.setCustomRpcUrl(customRpcUrl);
    }
    onShowToast('Project settings updated');
    onClose();
  };

  const handleNetworkChange = (newNet: SolanaNetwork) => {
    if (newNet === 'mainnet') {
      if (onOpenMainnetWarning) {
        onOpenMainnetWarning();
      } else {
        walletService.setNetwork('mainnet');
        setActiveNetwork('mainnet');
      }
    } else {
      walletService.setNetwork('devnet');
      setActiveNetwork('devnet');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-[#2d2d2d] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col h-[540px]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#2d2d2d] bg-[#1f1f1f] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#9cdcfe]">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#ffffff]">Project Settings</h2>
              <p className="text-[11px] text-[#858585]">{project?.name || projectName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#2d2d2d] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area with Left Navigation Rail */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Setting Nav */}
          <div className="w-44 border-r border-[#2d2d2d] bg-[#181818] p-2 space-y-0.5 text-xs">
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'general' ? 'bg-[#252526] text-[#ffffff] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>General</span>
            </button>

            <button
              onClick={() => setActiveTab('editor')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'editor' ? 'bg-[#252526] text-[#9cdcfe] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Editor & Display</span>
            </button>

            <button
              onClick={() => setActiveTab('solana')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition ${
                activeTab === 'solana' ? 'bg-[#252526] text-[#8b5cf6] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Solana & RPC</span>
            </button>

            <button
              onClick={() => setActiveTab('manifest')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition ${
                activeTab === 'manifest' ? 'bg-[#252526] text-[#569cd6] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Manifest Core</span>
            </button>

            <button
              onClick={() => setActiveTab('github')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition ${
                activeTab === 'github' ? 'bg-[#252526] text-[#ffffff] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <Github className="w-3.5 h-3.5" />
              <span>GitHub</span>
            </button>

            <button
              onClick={() => setActiveTab('libraries')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition ${
                activeTab === 'libraries' ? 'bg-[#252526] text-[#cca700] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Libraries</span>
            </button>

            <button
              onClick={() => setActiveTab('build')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition ${
                activeTab === 'build' ? 'bg-[#252526] text-[#c586c0] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Build Providers</span>
            </button>

            <button
              onClick={() => setActiveTab('environment')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 transition ${
                activeTab === 'environment' ? 'bg-[#252526] text-[#89d185] font-medium' : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Environment</span>
            </button>
          </div>

          {/* Right Setting Detail View */}
          <div className="flex-1 p-5 overflow-y-auto custom-scrollbar space-y-4 text-xs">
            {activeTab === 'general' && (
              <div className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Project Name</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Description</label>
                  <textarea
                    rows={3}
                    value={projectDesc}
                    onChange={(e) => setProjectDesc(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6]"
                  />
                </div>
                <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] text-[11px] text-[#858585] space-y-1">
                  <div>Project Kind: <span className="font-mono text-[#ffffff]">{project?.kind || 'manifest'}</span></div>
                  <div>Files Count: <span className="font-mono text-[#ffffff]">{project?.files?.length ?? 0}</span></div>
                  <div>Storage Engine: <span className="font-mono text-[#89d185]">IndexedDB (v1)</span></div>
                </div>
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[#cccccc] font-medium">Editor Font Size</label>
                    <span className="font-mono text-[#569cd6] text-xs font-semibold">{fontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="11"
                    max="18"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full accent-[#569cd6] cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-[#858585]">
                    <span>11px (Compact)</span>
                    <span>13px (Default)</span>
                    <span>18px (Large)</span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d]">
                  <div>
                    <div className="text-xs text-[#ffffff] font-medium">Word Wrap</div>
                    <div className="text-[11px] text-[#858585]">Wrap long lines inside the Manifest code editor</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={wordWrap}
                    onChange={(e) => setWordWrap(e.target.checked)}
                    className="accent-[#569cd6] w-4 h-4 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {activeTab === 'solana' && (
              <div className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Solana Cluster</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleNetworkChange('devnet')}
                      className={`py-2 px-3 rounded-md border text-center transition cursor-pointer ${
                        activeNetwork === 'devnet'
                          ? 'bg-[#252526] border-[#8b5cf6] text-[#ffffff] font-semibold'
                          : 'bg-[#1f1f1f] border-[#2d2d2d] text-[#858585] hover:text-[#cccccc]'
                      }`}
                    >
                      Devnet (Testnet)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNetworkChange('mainnet')}
                      className={`py-2 px-3 rounded-md border text-center transition cursor-pointer ${
                        activeNetwork === 'mainnet'
                          ? 'bg-[#2d1818] border-[#f14c4c] text-[#f85149] font-semibold'
                          : 'bg-[#1f1f1f] border-[#2d2d2d] text-[#858585] hover:text-[#cccccc]'
                      }`}
                    >
                      Mainnet-Beta (Live Assets)
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">RPC Provider Endpoint</label>
                  <input
                    type="text"
                    value={customRpcUrl}
                    onChange={(e) => setCustomRpcUrl(e.target.value)}
                    placeholder={walletService.getRpcEndpoint()}
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6] font-mono"
                  />
                  <p className="text-[11px] text-[#858585]">
                    {hasHeliusKey
                      ? '✓ Enhanced Helius RPC active via server-side HELIUS_API_KEY proxy.'
                      : 'Using default public Solana cluster endpoint. Configure HELIUS_API_KEY on server for higher throughput.'}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Dynamic Priority Fee Mode</label>
                  <select
                    value={priorityFeeMode}
                    onChange={(e) => setPriorityFeeMode(e.target.value as PriorityFeeLevel)}
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#cccccc] outline-none"
                  >
                    <option value="auto">Auto (Dynamically estimated based on cluster congestion)</option>
                    <option value="low">Low (1,000 micro-lamports / CU)</option>
                    <option value="medium">Medium (50,000 micro-lamports / CU - Default)</option>
                    <option value="high">High (250,000 micro-lamports / CU)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Program ID (Anchor)</label>
                  <input
                    type="text"
                    value={programId}
                    onChange={(e) => setProgramId(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none font-mono focus:border-[#569cd6]"
                  />
                </div>
              </div>
            )}

            {activeTab === 'manifest' && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-1.5">
                  <div className="font-semibold text-[#ffffff]">Manifest Language Core &amp; Rust MVM</div>
                  <p className="text-[11px] text-[#858585]">
                    Compiler &amp; VM Version: <span className="text-[#569cd6] font-mono font-semibold">1.0.0</span>
                  </p>
                  <p className="text-[11px] text-[#858585]">
                    Architecture: Dual Syntax Profiles (Beginner &amp; Professional) &rarr; Semantic AST &rarr; Static Type &amp; Capability Verifier &rarr; Typed IR &rarr; .mbc Bytecode / Rust MVM / WASM / Web / Native / Solana.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[#cccccc] font-medium">Syntax Profile</label>
                    <select
                      value={syntaxProfile}
                      onChange={(e) => setSyntaxProfile(e.target.value as StudioSyntaxProfile)}
                      className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-2.5 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6]"
                    >
                      <option value="auto">Auto-detect from source</option>
                      <option value="beginner">Beginner Profile (Keyword-guided)</option>
                      <option value="professional">Professional Profile (Concise)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[#cccccc] font-medium">Default Compiler Target</label>
                    <select
                      value={compilerTarget}
                      onChange={(e) => setCompilerTarget(e.target.value)}
                      className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-2.5 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6]"
                    >
                      <option value="auto">Automatic (MVM for v1.0 / Web for UI)</option>
                      {COMPILER_TARGETS.map((t) => (
                        <option key={t.id} value={t.id} disabled={t.status === 'planned'}>
                          {t.name}{t.status === 'planned' ? ' (Planned)' : t.status === 'requires-toolchain' ? ' (Host rustc)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Default Application Entry Point</label>
                  <select
                    value={entryPath}
                    onChange={(e) => setEntryPath(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] font-mono outline-none focus:border-[#569cd6]"
                  >
                    {(project?.files || [])
                      .filter((f) => !f.path.endsWith('/.gitkeep'))
                      .map((f) => (
                        <option key={f.path} value={f.path}>
                          {f.path}
                        </option>
                      ))}
                  </select>
                  <p className="text-[10px] text-[#858585]">
                    Used when running from neutral config/documentation files. Active executable files (.manifest, .mbc, .html, .wasm) take direct precedence.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'github' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Repository URL</label>
                  <input
                    type="text"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="https://github.com/owner/repository"
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none font-mono focus:border-[#569cd6]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[#cccccc] font-medium">Default Branch</label>
                  <input
                    type="text"
                    value={githubBranch}
                    onChange={(e) => setGithubBranch(e.target.value)}
                    className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none font-mono focus:border-[#569cd6]"
                  />
                </div>
              </div>
            )}

            {activeTab === 'libraries' && (
              <div className="space-y-2">
                <p className="text-[11px] text-[#858585]">
                  Manifest libraries and declared permission capabilities:
                </p>
                {libraries.map((lib: any) => (
                  <div
                    key={lib.name}
                    className="p-2.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-[#ffffff] flex items-center gap-2">
                        <span>{lib.name}</span>
                        <span className="text-[10px] text-[#858585] font-mono">v{lib.version}</span>
                      </div>
                      <div className="text-[10px] text-[#858585]">{lib.description}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {lib.requiredPermissions.map((perm: any) => (
                        <span
                          key={perm}
                          className="px-1.5 py-0.5 rounded text-[9px] bg-[#252526] text-[#9cdcfe] font-mono border border-[#2d2d2d]"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'build' && (
              <div className="space-y-2.5">
                {COMPILER_TARGETS.map((tgt) => {
                  const statusColor =
                    tgt.status === 'available' || tgt.status === 'available-with-limitations'
                      ? 'text-[#89d185]'
                      : tgt.status === 'requires-toolchain'
                      ? 'text-[#cca700]'
                      : 'text-[#858585]';
                  const statusLabel =
                    tgt.status === 'available'
                      ? 'Available (Offline Ready)'
                      : tgt.status === 'available-with-limitations'
                      ? 'Available (Subset / Local Simulation)'
                      : tgt.status === 'requires-toolchain'
                      ? 'Emits Rust Source (Binary Requires Host rustc)'
                      : 'Planned (Not Implemented in v1.0)';
                  return (
                    <div key={tgt.id} className="p-2.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#ffffff]">{tgt.name}</span>
                        <span className={`text-[10px] font-mono ${statusColor}`}>{statusLabel}</span>
                      </div>
                      <p className="text-[11px] text-[#858585]">{tgt.description}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'environment' && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2">
                  <div className="font-semibold text-[#ffffff]">Environment Variables Configuration</div>
                  <p className="text-[11px] text-[#858585]">
                    Managed securely via .env file (see .env.example). Never hardcode API keys or secrets in source code.
                  </p>
                  <div className="space-y-1 font-mono text-[11px]">
                    <div className="flex items-center justify-between p-2 rounded bg-[#181818] border border-[#2d2d2d]">
                      <span className="text-[#9cdcfe]">HELIUS_API_KEY (Server-only)</span>
                      <span className={hasHeliusKey ? 'text-[#89d185]' : 'text-[#858585]'}>
                        {hasHeliusKey ? 'Configured (Active on backend)' : 'Not Set (Using Public RPC)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2d2d2d] bg-[#1f1f1f] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="py-1 px-3 rounded-md bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-xs text-[#cccccc] font-medium transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="py-1 px-3.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold transition cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

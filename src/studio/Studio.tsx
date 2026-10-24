/**
 * Manifest Studio - Professional Integrated Development Environment (IDE)
 * Built with VS Code Dark Modern theme aesthetic:
 * - Main Editor Background: #1f1f1f (VS Code Charcoal)
 * - Sidebars, Panels, Activity Bars, Headers, Footer: #181818
 * - Borders and Dividers: #2d2d2d
 * - High contrast light text against #1f1f1f (#cccccc, #ffffff, #d4d4d4)
 * - Smooth pill-shaped rounded tabs for open files
 * - Split Panes, Bottom Status Bar, and Mobile Touch Layout
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Hammer,
  RotateCcw,
  Terminal,
  AlertCircle,
  AlertTriangle,
  FileCode,
  FileText,
  FileJson,
  Menu,
  X,
  Boxes,
  HelpCircle,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Columns,
  Eye,
  EyeOff,
  Cpu,
  Search,
  Settings,
  FolderOpen,
  ChevronRight,
  GitBranch,
  Wifi,
  Sparkles,
  MoreHorizontal,
  Info,
} from 'lucide-react';
import {
  ManifestProject,
  ProjectFile,
  BuildResult,
  ConsoleEntry,
  StudioDiagnostic,
  BottomPanelTab,
} from './types.ts';
import {
  loadProjectFromStorage,
  loadProjectAsync,
  saveProjectAsync,
  createDefaultProject,
  loadSettingsFromStorage,
  saveSettingsToStorage,
  StudioSettings,
  TEMPLATES,
} from './project-store.ts';
import { runManifestPipeline } from './compiler-service.ts';
import { ExecutionOrchestrator } from './execution/execution-orchestrator.ts';
import { UnifiedExecutionResult } from './execution/execution-types.ts';
import { Sidebar, ActivityTab } from './sidebar/Sidebar.tsx';
import { CodeMirrorEditor } from './editor/CodeMirrorEditor.tsx';
import { PreviewPanel } from './preview/PreviewPanel.tsx';
import { ConsolePanel } from './console/ConsolePanel.tsx';
import { ProblemsPanel } from './problems/ProblemsPanel.tsx';
import { TerminalPanel } from './terminal/TerminalPanel.tsx';
import { TestbenchModal } from './testbench/TestbenchModal.tsx';
import { WelcomeScreen } from './welcome/WelcomeScreen.tsx';
import { ProjectMenuModal } from './modals/ProjectMenuModal.tsx';
import { GitHubImportModal } from './modals/GitHubImportModal.tsx';
import { ProjectSettingsModal } from './modals/ProjectSettingsModal.tsx';
import { MainnetWarningModal } from './modals/MainnetWarningModal.tsx';
import { TestRunnerModal } from './modals/TestRunnerModal.tsx';
import { SolanaDeployModal } from './modals/SolanaDeployModal.tsx';
import { SolanaWalletService, WalletState, SolanaNetwork } from './services/solana-wallet.ts';
import { detectLanguage } from './editor/language-support.ts';
import { Coins, ShieldCheck } from 'lucide-react';
import { LanguageRegistry } from './languages/language-registry.ts';

interface StudioProps {
  onSwitchToTestbench?: () => void;
}

export function Studio({ onSwitchToTestbench }: StudioProps = {}) {
  const [project, setProject] = useState<ManifestProject>(() => loadProjectFromStorage());
  const [activeFilePath, setActiveFilePath] = useState<string>(project.activeFilePath || 'src/main.manifest');
  const [openFilePaths, setOpenFilePaths] = useState<string[]>(['src/main.manifest', 'manifest.toml']);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [executionResult, setExecutionResult] = useState<UnifiedExecutionResult | null>(null);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [activeBottomTab, setActiveBottomTab] = useState<BottomPanelTab>('console');
  const [isBottomOpen, setIsBottomOpen] = useState<boolean>(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [activeActivity, setActiveActivity] = useState<ActivityTab>('explorer');
  const [isTestbenchOpen, setIsTestbenchOpen] = useState<boolean>(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState<boolean>(() => {
    return !localStorage.getItem('manifest_studio_seen_welcome_v02');
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<StudioSettings>(() => loadSettingsFromStorage());

  // New Modals State
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState<boolean>(false);
  const [isGitHubImportOpen, setIsGitHubImportOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isTestRunnerOpen, setIsTestRunnerOpen] = useState<boolean>(false);
  const [isSolanaDeployOpen, setIsSolanaDeployOpen] = useState<boolean>(false);
  const [isMainnetWarningOpen, setIsMainnetWarningOpen] = useState<boolean>(false);
  const [mainnetActionType, setMainnetActionType] = useState<'switch_network' | 'deploy_program'>('switch_network');

  // Solana Wallet live state
  const walletService = SolanaWalletService.getInstance();
  const [walletState, setWalletState] = useState<WalletState>(walletService.getState());

  useEffect(() => {
    return walletService.subscribe(setWalletState);
  }, [walletService]);

  // Split pane state
  const [isSplitView, setIsSplitView] = useState<boolean>(false);
  const [splitFilePath, setSplitFilePath] = useState<string>('manifest.toml');

  // Cursor position tracking for status bar
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  // Mobile specific state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [mobileActiveView, setMobileActiveView] = useState<'editor' | 'preview' | 'terminal' | 'problems'>('editor');
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState<boolean>(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState<boolean>(false);

  // Load project asynchronously from IndexedDB on initial mount
  useEffect(() => {
    loadProjectAsync().then((loadedProject) => {
      setProject(loadedProject);
      const activeP = loadedProject.activeFilePath || loadedProject.files[0]?.path || 'src/main.manifest';
      setActiveFilePath(activeP);
      const activeF = loadedProject.files.find((f) => f.path === activeP) || loadedProject.files[0];
      handleRun(loadedProject, activeF);
    });
  }, []);

  // Save project asynchronously to IndexedDB upon updates
  useEffect(() => {
    saveProjectAsync(project);
  }, [project]);

  // Save settings upon updates
  useEffect(() => {
    saveSettingsToStorage(settings);
  }, [settings]);

  // Active file object
  const activeFile = useMemo(() => {
    return (
      project.files.find((f) => f.path === activeFilePath) ||
      project.files[0] || {
        id: 'fallback',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: '',
      }
    );
  }, [project.files, activeFilePath]);

  // Split secondary file object
  const splitFile = useMemo(() => {
    return (
      project.files.find((f) => f.path === splitFilePath) ||
      project.files.find((f) => f.path !== activeFilePath) ||
      project.files[0]
    );
  }, [project.files, splitFilePath, activeFilePath]);

  // Main Manifest source file for compilation
  const mainManifestFile = useMemo(() => {
    return project.files.find((f) => f.path === 'src/main.manifest') || activeFile;
  }, [project.files, activeFile]);

  // Toast notification helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Add console log
  const addConsoleEntry = useCallback((message: string, type: 'output' | 'info' | 'error' | 'build' = 'output') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setConsoleEntries((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random()}`,
        timestamp: time,
        type,
        message,
      },
    ]);
  }, []);

  // Update active file content
  const handleFileChange = (newContent: string) => {
    setProject((prev) => ({
      ...prev,
      files: prev.files.map((f) =>
        f.path === activeFilePath ? { ...f, content: newContent } : f
      ),
      updatedAt: Date.now(),
    }));
  };

  // Update split file content
  const handleSplitFileChange = (newContent: string) => {
    if (!splitFile) return;
    setProject((prev) => ({
      ...prev,
      files: prev.files.map((f) =>
        f.path === splitFile.path ? { ...f, content: newContent } : f
      ),
      updatedAt: Date.now(),
    }));
  };

  // Switch active file and maintain open tabs
  const handleSelectFile = (path: string) => {
    setActiveFilePath(path);
    if (!openFilePaths.includes(path)) {
      setOpenFilePaths((prev) => [...prev, path]);
    }
    setMobileDrawerOpen(false);
  };

  // Close tab
  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = openFilePaths.filter((p) => p !== path);
    setOpenFilePaths(filtered);
    if (activeFilePath === path) {
      if (filtered.length > 0) {
        setActiveFilePath(filtered[filtered.length - 1]);
      } else if (project.files.length > 0) {
        setActiveFilePath(project.files[0].path);
      }
    }
  };

  // Unified Run pipeline: uses ExecutionOrchestrator to detect and execute project
  const handleRun = useCallback(
    async (projOverride?: ManifestProject | React.MouseEvent | any, fileOverride?: ProjectFile) => {
      const isActualProject = projOverride && typeof projOverride === 'object' && 'files' in projOverride;
      const currentProj = isActualProject ? (projOverride as ManifestProject) : project;
      const currentFile =
        fileOverride ||
        (activeFilePath ? currentProj.files.find((f) => f.path === activeFilePath) : undefined) ||
        activeFile;

      setIsCompiling(true);
      const orchestrator = ExecutionOrchestrator.getInstance();
      const provider = orchestrator.selectProvider(currentProj, currentFile);

      addConsoleEntry(`Running project "${currentProj.name}" via ${provider.name}...`, 'info');

      try {
        const res = await orchestrator.executeProject(currentProj, {
          activeFilePath: currentFile.path,
          target: 'js',
        });

        setExecutionResult(res);

        // Create/update BuildResult for backward compatibility with existing inspector & components
        const bRes: BuildResult = {
          success: res.success,
          timestamp: res.timestamp,
          target: res.projectKind === 'manifest' ? 'js' : res.projectKind,
          artifacts: res.outputCode
            ? [
                {
                  fileName:
                    res.projectKind === 'manifest'
                      ? `${(res.ir?.appName || 'app').toLowerCase()}.js`
                      : currentFile.name,
                  fileType: res.projectKind === 'manifest' ? 'javascript' : currentFile.language,
                  content: res.outputCode,
                  sizeBytes: new Blob([res.outputCode]).size,
                },
              ]
            : [],
          diagnostics: res.diagnostics,
          outputCode: res.outputCode,
          ir: res.ir,
          durationMs: res.durationMs,
        };
        setBuildResult(bRes);

        if (res.success) {
          addConsoleEntry(`[${provider.name}] Execution ready in ${res.durationMs}ms`, 'build');
          setIsPreviewOpen(true);
          setMobileActiveView('preview');
          showToast(`Running "${currentFile.name}" in Preview`);

          // If manifest code produced an output artifact, update build/ folder
          if (res.projectKind === 'manifest' && res.outputCode) {
            const appSlug = (res.ir?.appName || 'app').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            const artifactPath = `build/${appSlug}.js`;
            setProject((prev) => {
              const hasBuild = prev.files.some((f) => f.path === artifactPath);
              const updated = hasBuild
                ? prev.files.map((f) => (f.path === artifactPath ? { ...f, content: res.outputCode! } : f))
                : [
                    ...prev.files,
                    {
                      id: `artifact-${Date.now()}`,
                      name: `${appSlug}.js`,
                      path: artifactPath,
                      language: 'javascript' as const,
                      content: res.outputCode!,
                      isReadOnly: true,
                    },
                  ];
              return { ...prev, files: updated };
            });
          }
        } else {
          const errorCount = res.diagnostics.filter((d) => d.severity === 'error').length;
          addConsoleEntry(`Execution halted with ${errorCount} error(s). Check Problems panel.`, 'error');
          setActiveBottomTab('problems');
          setIsBottomOpen(true);
        }
      } catch (err: any) {
        addConsoleEntry(`Execution failure: ${err.message || String(err)}`, 'error');
      } finally {
        setIsCompiling(false);
      }
    },
    [project, activeFile, activeFilePath, addConsoleEntry]
  );

  // Build command: generates and registers build artifacts
  const handleBuild = async () => {
    if (activeFile.language !== 'manifest') {
      const provider = LanguageRegistry.getInstance().detectProvider(activeFile.path);
      const status = provider.getCapabilityStatus ? provider.getCapabilityStatus('localBuild') : 'Unsupported';
      addConsoleEntry(
        `[Language Registry] Cannot build "${activeFile.name}" locally. Language "${provider.name}" local build is ${status}.`,
        'error'
      );
      showToast(`${provider.name}: Local build is ${status}`);
      return;
    }

    setIsCompiling(true);
    addConsoleEntry(`Building project artifacts for "${project.name}" (Target: JS)...`, 'build');

    try {
      const source = mainManifestFile.content;
      const res = await runManifestPipeline(source, 'js');
      setBuildResult(res);

      if (res.success && res.outputCode) {
        const appSlug = (res.ir?.appName || 'app').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const artifactPath = `build/${appSlug}.js`;

        setProject((prev) => {
          const filtered = prev.files.filter((f) => !f.path.startsWith('build/'));
          const newFiles: ProjectFile[] = [
            ...filtered,
            {
              id: `artifact-${Date.now()}`,
              name: `${appSlug}.js`,
              path: artifactPath,
              language: 'javascript',
              content: res.outputCode!,
              isReadOnly: true,
            },
          ];
          return { ...prev, files: newFiles };
        });

        addConsoleEntry(`Artifact generated: ${artifactPath} (${res.artifacts[0]?.sizeBytes || 0} bytes)`, 'build');
        showToast(`Artifact built: ${artifactPath}`);
      } else {
        addConsoleEntry(`Build failed. Inspect problems tab.`, 'error');
        setActiveBottomTab('problems');
        setIsBottomOpen(true);
      }
    } finally {
      setIsCompiling(false);
    }
  };

  // Handle template selection with immediate preview refresh
  const handleSelectTemplate = (templateId: string) => {
    const newProj = createDefaultProject(templateId);
    setProject(newProj);
    const entryPath = newProj.activeFilePath || newProj.files[0]?.path || 'src/main.manifest';
    setActiveFilePath(entryPath);
    const activeF = newProj.files.find((f) => f.path === entryPath) || newProj.files[0];
    setOpenFilePaths(newProj.files.slice(0, 3).map((f) => f.path));
    setConsoleEntries([]);
    setExecutionResult(null);
    setBuildResult(null);
    showToast(`Loaded template: ${newProj.name}`);
    handleRun(newProj, activeF);
  };

  // Create new file in project
  const handleCreateFile = (path: string) => {
    if (project.files.some((f) => f.path === path)) {
      showToast('File already exists');
      return;
    }
    const name = path.split('/').pop() || path;
    const isManifest = path.endsWith('.manifest');

    const newFile: ProjectFile = {
      id: `file-${Date.now()}`,
      name,
      path,
      language: detectLanguage(path),
      content: isManifest ? `APP "Module"\n\nPAGE Home\n    TEXT "Module loaded"\nEND\n` : '',
    };

    setProject((prev) => ({
      ...prev,
      files: [...prev.files, newFile],
    }));
    setActiveFilePath(path);
    if (!openFilePaths.includes(path)) {
      setOpenFilePaths((prev) => [...prev, path]);
    }
    showToast(`Created ${path}`);
  };

  // Rename file in project
  const handleRenameFile = (oldPath: string, newPath: string) => {
    if (oldPath === 'src/main.manifest') {
      showToast('Cannot rename main.manifest entry point');
      return;
    }
    if (project.files.some((f) => f.path === newPath)) {
      showToast('A file with that name already exists');
      return;
    }
    const newName = newPath.split('/').pop() || newPath;
    setProject((prev) => ({
      ...prev,
      files: prev.files.map((f) =>
        f.path === oldPath
          ? { ...f, name: newName, path: newPath, language: detectLanguage(newPath) }
          : f
      ),
      updatedAt: Date.now(),
    }));
    setOpenFilePaths((prev) => prev.map((p) => (p === oldPath ? newPath : p)));
    if (activeFilePath === oldPath) {
      setActiveFilePath(newPath);
    }
    showToast(`Renamed to ${newPath}`);
  };

  // Delete file in project
  const handleDeleteFile = (path: string) => {
    if (path === 'src/main.manifest') {
      showToast('Cannot delete main.manifest');
      return;
    }
    setProject((prev) => ({
      ...prev,
      files: prev.files.filter((f) => f.path !== path),
    }));
    setOpenFilePaths((prev) => prev.filter((p) => p !== path));
    if (activeFilePath === path) {
      setActiveFilePath('src/main.manifest');
    }
    showToast(`Deleted ${path}`);
  };

  const getFileIcon = (file: ProjectFile) => {
    if (file.language === 'manifest') {
      return <FileCode className="w-3.5 h-3.5 text-[#ce9178]" />;
    }
    if (file.language === 'toml') {
      return <Settings className="w-3.5 h-3.5 text-[#9cdcfe]" />;
    }
    if (file.language === 'javascript') {
      return <FileJson className="w-3.5 h-3.5 text-[#dcdcaa]" />;
    }
    return <FileText className="w-3.5 h-3.5 text-[#858585]" />;
  };

  const errorDiagnostics = buildResult?.diagnostics || [];
  const errorCount = errorDiagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = errorDiagnostics.filter((d) => d.severity === 'warning').length;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#181818] text-[#cccccc] font-sans select-none">
      {/* 1. Desktop & Mobile Top Bar (VS Code #181818 Header) */}
      <header className="h-10 border-b border-[#2d2d2d] bg-[#181818] px-3 flex items-center justify-between flex-shrink-0 z-30">
        {/* Left: Branding & Breadcrumbs */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Mobile Drawer Toggle */}
          <button
            onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
            aria-label="Open mobile navigation drawer"
            className="md:hidden min-h-[36px] min-w-[36px] p-1.5 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#242424] flex items-center justify-center transition cursor-pointer"
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Logo badge - clean VS Code style */}
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 rounded bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#ffffff] font-mono font-bold text-[11px]">
              M
            </div>
            <span className="font-semibold text-[#ffffff] text-xs tracking-tight hidden sm:inline">
              Manifest Studio
            </span>
          </div>

          <div className="h-3 w-px bg-[#2d2d2d] hidden sm:block" />

          {/* Breadcrumb path */}
          <div className="flex items-center gap-1 text-[11px] text-[#858585]">
            <span className="font-medium text-[#cccccc] truncate max-w-[100px] xs:max-w-[120px] sm:max-w-xs">{project.name}</span>
            <ChevronRight className="w-3 h-3 text-[#555555]" />
            <span className="text-[#858585] font-mono text-[10px] hidden sm:inline">{activeFile.path}</span>
          </div>
        </div>

        {/* Center: Command Palette Search Bar (VS Code style #1f1f1f) */}
        <div className="hidden lg:flex items-center">
          <button
            onClick={() => {
              setActiveActivity('search');
              setIsSidebarCollapsed(false);
            }}
            className="px-3 py-1 rounded-md bg-[#1f1f1f] border border-[#2d2d2d] text-[#858585] text-xs flex items-center gap-2 hover:border-[#454545] hover:text-[#cccccc] transition cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 text-[#858585]" />
            <span className="text-[11px]">Search files, keywords...</span>
            <kbd className="px-1 py-0.2 rounded bg-[#2d2d2d] text-[#858585] text-[9px] font-mono">Ctrl+P</kbd>
          </button>
        </div>

        {/* Right: Primary Run / Build / Preview Actions */}
        <div className="flex items-center space-x-1.5 sm:space-x-2">
          {/* Primary Run Button - VS Code Green #238636 */}
          <button
            onClick={handleRun}
            disabled={isCompiling}
            title="Compile & Run in Preview (Mod+Enter)"
            className="py-1 px-3 min-h-[32px] rounded-md bg-[#238636] hover:bg-[#2ea043] active:scale-[0.98] text-white font-medium text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run</span>
          </button>

          {/* Mobile Actions Overflow Button (sm:hidden) */}
          <button
            onClick={() => setIsMobileActionsOpen(true)}
            aria-label="More Studio Actions"
            title="More Studio Actions (Build, Projects, Tests, Solana, Settings, Terminal, Problems)"
            className="sm:hidden min-h-[32px] min-w-[36px] px-2 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-[#ffffff] text-xs font-medium flex items-center justify-center gap-1 border border-[#2d2d2d] transition cursor-pointer"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {/* Build Button */}
          <button
            onClick={handleBuild}
            disabled={isCompiling}
            title="Compile JavaScript target artifact"
            className="hidden sm:flex py-1 px-2.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-medium items-center gap-1.5 border border-[#2d2d2d] transition cursor-pointer"
          >
            <Hammer className="w-3 h-3 text-[#dcdcaa]" />
            <span className="hidden md:inline">Build</span>
          </button>

          {/* Projects / Welcome Button */}
          <button
            onClick={() => setIsWelcomeOpen(true)}
            title="Projects & Templates"
            className="hidden sm:flex py-1 px-2.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-medium items-center gap-1.5 border border-[#2d2d2d] transition cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#569cd6]" />
            <span className="hidden md:inline">Projects</span>
          </button>

          {/* Verification & Test Runner */}
          <button
            onClick={() => setIsTestRunnerOpen(true)}
            title="Run Manifest & Solana LiteSVM Tests"
            className="hidden sm:flex py-1 px-2.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#89d185] hover:text-[#a6e3a1] text-xs font-medium items-center gap-1.5 border border-[#2d2d2d] transition cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#89d185]" />
            <span className="hidden xl:inline">Tests</span>
          </button>

          {/* Solana Deploy & Transaction */}
          <button
            onClick={() => setIsSolanaDeployOpen(true)}
            title="Solana Deploy & Transactions"
            className="hidden sm:flex py-1 px-2.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cca700] hover:text-[#ffd700] text-xs font-medium items-center gap-1.5 border border-[#2d2d2d] transition cursor-pointer"
          >
            <Coins className="w-3.5 h-3.5 text-[#cca700]" />
            <span className="hidden xl:inline">Solana</span>
          </button>

          {/* Collapsible Preview Toggle Button */}
          <button
            onClick={() => {
              setIsPreviewOpen(!isPreviewOpen);
              if (mobileActiveView === 'preview') {
                setMobileActiveView('editor');
              } else {
                setMobileActiveView('preview');
              }
            }}
            title={isPreviewOpen ? 'Hide Preview panel' : 'Show Preview panel'}
            className={`py-1 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition cursor-pointer ${
              isPreviewOpen
                ? 'bg-[#2d2d2d] text-[#ffffff] border-[#3c3c3c]'
                : 'bg-[#252526] text-[#858585] border-[#2d2d2d] hover:text-[#cccccc]'
            }`}
          >
            {isPreviewOpen ? <Eye className="w-3 h-3 text-[#ffffff]" /> : <EyeOff className="w-3 h-3" />}
            <span className="hidden md:inline">Preview</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            title="Project & Studio Settings"
            className="hidden sm:flex py-1 px-2.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-[#ffffff] text-xs font-medium items-center gap-1.5 border border-[#2d2d2d] transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-[#9cdcfe]" />
            <span className="hidden xl:inline">Settings</span>
          </button>

          {/* Developer Tools / Testbench Toggle */}
          <button
            onClick={onSwitchToTestbench || (() => setIsTestbenchOpen(true))}
            title="Developer Mode: Compiler Inspector & Testbench"
            className="py-1 px-2.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#858585] hover:text-[#cccccc] border border-[#2d2d2d] transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
          >
            <Cpu className="w-3.5 h-3.5 text-[#cca700]" />
            <span className="hidden lg:inline">Developer Mode</span>
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-12 right-4 z-50 py-1.5 px-3 rounded-lg bg-[#252526] border border-[#2d2d2d] text-[#ffffff] text-xs shadow-2xl flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#89d185]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 2. Desktop Workspace Multi-pane Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Activity Rail & Modular Sidebar (#181818) */}
        <div className="hidden md:flex h-full">
          <Sidebar
            project={project}
            activeFilePath={activeFilePath}
            openFilePaths={openFilePaths}
            activeActivity={activeActivity}
            onSelectActivity={setActiveActivity}
            onSelectFile={handleSelectFile}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
            onSelectTemplate={handleSelectTemplate}
            onOpenDevTools={() => setIsTestbenchOpen(true)}
            onOpenProjectMenu={() => setIsProjectMenuOpen(true)}
            onOpenGitHubImport={() => setIsGitHubImportOpen(true)}
            onOpenSolanaDeploy={() => setIsSolanaDeployOpen(true)}
            onOpenMainnetWarning={() => setIsMainnetWarningOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onShowToast={showToast}
            settings={settings}
            onUpdateSettings={setSettings}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
        </div>

        {/* Center Editor Surface (#1f1f1f VS Code Charcoal) & Bottom Panels */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1f1f1f]">
          {/* Top Pill-Shaped Tabs Bar (#181818 background with #1f1f1f active pill tab) */}
          <div className="h-9 border-b border-[#2d2d2d] bg-[#181818] px-3 flex items-center justify-between select-none">
            {/* Pill Tabs strip */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 custom-scrollbar">
              {openFilePaths.map((path) => {
                const file = project.files.find((f) => f.path === path);
                const isSelected = activeFilePath === path;
                const fileName = path.split('/').pop() || path;

                return (
                  <div
                    key={path}
                    onClick={() => setActiveFilePath(path)}
                    className={`h-7 px-3 rounded-full text-xs font-sans flex items-center gap-2 transition cursor-pointer select-none ${
                      isSelected
                        ? 'bg-[#1f1f1f] text-[#ffffff] border border-[#2d2d2d] font-medium shadow-xs'
                        : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424] border border-transparent'
                    }`}
                  >
                    {file ? getFileIcon(file) : <FileCode className="w-3.5 h-3.5 text-[#858585]" />}
                    <span className="truncate max-w-[140px]">{fileName}</span>
                    {openFilePaths.length > 1 && (
                      <button
                        onClick={(e) => handleCloseTab(path, e)}
                        className="hover:text-[#ffffff] text-[#858585] hover:bg-[#333333] rounded-full p-0.5 transition ml-0.5"
                        title="Close tab"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Split Editor Toggle & Language Indicators */}
            <div className="hidden sm:flex items-center gap-2 pl-2">
              <button
                onClick={() => setIsSplitView(!isSplitView)}
                title={isSplitView ? 'Close Split Editor' : 'Split Editor (Side-by-Side)'}
                className={`p-1 rounded-md transition cursor-pointer flex items-center gap-1 text-[11px] ${
                  isSplitView
                    ? 'bg-[#2d2d2d] text-[#ffffff] border border-[#3c3c3c]'
                    : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#242424]'
                }`}
              >
                <Columns className="w-3.5 h-3.5" />
                <span className="hidden lg:inline text-[10px]">Split</span>
              </button>

              <div className="hidden lg:flex items-center gap-2 text-[10px] text-[#858585] font-mono pr-1">
                <span>{activeFile.language}</span>
                <span>UTF-8</span>
              </div>
            </div>
          </div>

          {/* Main Code Editor Area (Main Editor Background: #1f1f1f) */}
          <div className="flex-1 overflow-hidden relative flex bg-[#1f1f1f]">
            {/* Primary Left Editor Pane */}
            <div className="flex-1 h-full overflow-hidden flex flex-col bg-[#1f1f1f]">
              <CodeMirrorEditor
                key={activeFile.path}
                value={activeFile.content}
                onChange={handleFileChange}
                language={activeFile.language}
                readOnly={activeFile.isReadOnly}
                onRun={handleRun}
                onSave={handleBuild}
                onCursorChange={(line, col) => setCursorPos({ line, col })}
              />
            </div>

            {/* Split Right Editor Pane (When Split View Enabled) */}
            {isSplitView && splitFile && (
              <div className="flex-1 h-full border-l border-[#2d2d2d] flex flex-col bg-[#1f1f1f]">
                {/* Secondary Pill Tab Header */}
                <div className="h-8 bg-[#181818] border-b border-[#2d2d2d] px-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-semibold text-[#858585] tracking-wider">
                      Split Pane:
                    </span>
                    <select
                      value={splitFile.path}
                      onChange={(e) => setSplitFilePath(e.target.value)}
                      className="bg-[#252526] border border-[#2d2d2d] rounded px-2 py-0.5 text-xs text-[#cccccc] outline-none"
                    >
                      {project.files.map((f) => (
                        <option key={f.path} value={f.path}>
                          {f.name} ({f.path})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => setIsSplitView(false)}
                    className="p-1 rounded text-[#858585] hover:text-[#cccccc]"
                    title="Close split pane"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex-1 overflow-hidden bg-[#1f1f1f]">
                  <CodeMirrorEditor
                    key={splitFile.path}
                    value={splitFile.content}
                    onChange={handleSplitFileChange}
                    language={splitFile.language}
                    readOnly={splitFile.isReadOnly}
                    onRun={handleRun}
                    onSave={handleBuild}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bottom Panel Toggle Header (Problems / Output / CLI Terminal) (#181818) */}
          <div className="h-7 border-t border-[#2d2d2d] bg-[#181818] px-3 flex items-center justify-between text-xs select-none">
            <div className="flex items-center space-x-1">
              <button
                onClick={() => {
                  setActiveBottomTab('problems');
                  setIsBottomOpen(true);
                }}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  activeBottomTab === 'problems' && isBottomOpen
                    ? 'bg-[#1f1f1f] text-[#f14c4c]'
                    : 'text-[#858585] hover:text-[#cccccc]'
                }`}
              >
                <AlertCircle className="w-3 h-3 text-[#f14c4c]" />
                <span>Problems</span>
                {errorCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#4d1f24] text-[#f85149] text-[9px] font-mono">
                    {errorCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setActiveBottomTab('console');
                  setIsBottomOpen(true);
                }}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  activeBottomTab === 'console' && isBottomOpen
                    ? 'bg-[#1f1f1f] text-[#89d185]'
                    : 'text-[#858585] hover:text-[#cccccc]'
                }`}
              >
                <Terminal className="w-3 h-3 text-[#89d185]" />
                <span>Output</span>
                {consoleEntries.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#252526] text-[#cccccc] text-[9px] font-mono">
                    {consoleEntries.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setActiveBottomTab('build-output');
                  setIsBottomOpen(true);
                }}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  activeBottomTab === 'build-output' && isBottomOpen
                    ? 'bg-[#1f1f1f] text-[#c586c0]'
                    : 'text-[#858585] hover:text-[#cccccc]'
                }`}
              >
                <Terminal className="w-3 h-3 text-[#c586c0]" />
                <span>CLI Terminal</span>
              </button>
            </div>

            <button
              onClick={() => setIsBottomOpen(!isBottomOpen)}
              className="p-1 rounded text-[#858585] hover:text-[#cccccc] cursor-pointer"
            >
              {isBottomOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Bottom Panel Content (#1f1f1f with #2d2d2d border) */}
          {isBottomOpen && (
            <div className="h-44 border-t border-[#2d2d2d] bg-[#1f1f1f] flex flex-col overflow-hidden">
              {activeBottomTab === 'problems' && (
                <ProblemsPanel
                  diagnostics={errorDiagnostics}
                  onSelectProblem={(diag) => {
                    showToast(`Problem at line ${diag.line}`);
                  }}
                />
              )}
              {activeBottomTab === 'console' && (
                <ConsolePanel
                  entries={consoleEntries}
                  onClear={() => setConsoleEntries([])}
                />
              )}
              {activeBottomTab === 'build-output' && (
                <TerminalPanel currentSource={mainManifestFile.content} />
              )}
            </div>
          )}
        </div>

        {/* Right Collapsible Preview Panel (#181818 with #2d2d2d border) */}
        {isPreviewOpen && (
          <div className="w-[420px] lg:w-[460px] flex-shrink-0 flex flex-col h-full bg-[#181818] z-10 border-l border-[#2d2d2d]">
            <PreviewPanel
              buildResult={buildResult}
              executionResult={executionResult}
              isCompiling={isCompiling}
              onRun={handleRun}
              onClose={() => setIsPreviewOpen(false)}
              onOutputMessage={(msg) => addConsoleEntry(msg, 'output')}
              onClearConsole={() => setConsoleEntries([])}
            />
          </div>
        )}
      </div>

      {/* 3. Real VS Code Style Bottom Status Bar (#181818 with #2d2d2d border) */}
      <footer className="h-6 bg-[#181818] border-t border-[#2d2d2d] px-3 flex items-center justify-between text-[11px] text-[#858585] font-mono select-none z-20 flex-shrink-0">
        {/* Left Side: Git, Errors, Warnings, Terminal Ready */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-1.5 text-[#cccccc]">
            <GitBranch className="w-3 h-3 text-[#858585]" />
            <span>main</span>
          </div>

          <button
            onClick={() => {
              setActiveBottomTab('problems');
              setIsBottomOpen(true);
            }}
            className="flex items-center gap-2 hover:text-[#ffffff] transition cursor-pointer"
            title="View Problems"
          >
            <span className="flex items-center gap-1 text-[#f14c4c]">
              <AlertCircle className="w-3 h-3" />
              <span>{errorCount}</span>
            </span>
            <span className="flex items-center gap-1 text-[#cca700]">
              <AlertTriangle className="w-3 h-3" />
              <span>{warningCount}</span>
            </span>
          </button>

          <button
            onClick={() => {
              setActiveBottomTab('console');
              setIsBottomOpen(true);
            }}
            className="hidden sm:flex items-center gap-1 text-[#858585] hover:text-[#cccccc] transition cursor-pointer"
          >
            <Terminal className="w-3 h-3" />
            <span>Ready</span>
          </button>
        </div>

        {/* Right Side: Ln/Col, Spaces, UTF-8, Language, Offline */}
        <div className="flex items-center space-x-3">
          <span className="hidden sm:inline">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span className="hidden md:inline">Spaces: 4</span>
          <span className="hidden md:inline">UTF-8</span>
          <button
            onClick={() => setIsLanguageModalOpen(true)}
            title="Inspect Language Capabilities & Limits"
            className="text-[#cccccc] font-medium hover:text-[#ffffff] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>{activeFile.language === 'manifest' ? 'Manifest' : activeFile.language.toUpperCase()}</span>
            <Info className="w-3 h-3 text-[#569cd6]" />
          </button>
          <div className="flex items-center gap-1 text-[#858585]">
            <Wifi className="w-3 h-3 text-[#89d185]" />
            <span className="hidden lg:inline text-[10px]">Offline Ready</span>
          </div>
        </div>
      </footer>

      {/* 4. Mobile Dedicated Modal / Bottom Drawer for Files & Navigation */}
      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="h-12 border-b border-[#2d2d2d] bg-[#181818] px-4 flex items-center justify-between">
            <span className="font-bold text-xs text-[#ffffff]">Project Files</span>
            <button
              onClick={() => setMobileDrawerOpen(false)}
              className="p-1 text-[#858585] hover:text-[#ffffff] min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Actions Toolbar in Mobile Drawer */}
          <div className="p-2 border-b border-[#2d2d2d] bg-[#1f1f1f] grid grid-cols-5 gap-1">
            <button
              onClick={() => {
                setMobileDrawerOpen(false);
                handleBuild();
              }}
              className="py-1.5 px-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#dcdcaa] text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            >
              <Hammer className="w-3.5 h-3.5" />
              <span>Build</span>
            </button>
            <button
              onClick={() => {
                setMobileDrawerOpen(false);
                setIsWelcomeOpen(true);
              }}
              className="py-1.5 px-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#569cd6] text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Projects</span>
            </button>
            <button
              onClick={() => {
                setMobileDrawerOpen(false);
                setIsTestRunnerOpen(true);
              }}
              className="py-1.5 px-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#89d185] text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Tests</span>
            </button>
            <button
              onClick={() => {
                setMobileDrawerOpen(false);
                setIsSolanaDeployOpen(true);
              }}
              className="py-1.5 px-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cca700] text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Solana</span>
            </button>
            <button
              onClick={() => {
                setMobileDrawerOpen(false);
                setIsSettingsOpen(true);
              }}
              className="py-1.5 px-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#9cdcfe] text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Settings</span>
            </button>
          </div>

          <div className="flex-1 overflow-hidden bg-[#181818]">
            <Sidebar
              project={project}
              activeFilePath={activeFilePath}
              openFilePaths={openFilePaths}
              activeActivity={activeActivity}
              onSelectActivity={setActiveActivity}
              onSelectFile={handleSelectFile}
              onCreateFile={handleCreateFile}
              onDeleteFile={handleDeleteFile}
              onSelectTemplate={handleSelectTemplate}
              onOpenDevTools={() => {
                setMobileDrawerOpen(false);
                setIsTestbenchOpen(true);
              }}
              settings={settings}
              onUpdateSettings={setSettings}
              isCollapsed={false}
              onToggleCollapse={() => {}}
            />
          </div>
        </div>
      )}

      {/* 5. Mobile Bottom View Switcher with Actions Sheet Access (Kodezi-style #181818) */}
      <div className="md:hidden h-12 border-t border-[#2d2d2d] bg-[#181818] grid grid-cols-5 text-center text-[10px] z-20">
        <button
          onClick={() => {
            setMobileActiveView('editor');
            setIsPreviewOpen(false);
          }}
          className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${
            mobileActiveView === 'editor' && !isPreviewOpen ? 'text-[#ffffff] font-bold' : 'text-[#858585]'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>Editor</span>
        </button>

        <button
          onClick={() => {
            setIsPreviewOpen(true);
            setMobileActiveView('preview');
          }}
          className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${
            isPreviewOpen ? 'text-[#ffffff] font-bold' : 'text-[#858585]'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Preview</span>
        </button>

        <button
          onClick={() => {
            setActiveBottomTab('build-output');
            setIsBottomOpen(true);
            setMobileActiveView('terminal');
          }}
          className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${
            mobileActiveView === 'terminal' ? 'text-[#c586c0] font-bold' : 'text-[#858585]'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Terminal</span>
        </button>

        <button
          onClick={() => {
            setActiveBottomTab('problems');
            setIsBottomOpen(true);
            setMobileActiveView('problems');
          }}
          className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${
            mobileActiveView === 'problems' ? 'text-[#f14c4c] font-bold' : 'text-[#858585]'
          }`}
        >
          <AlertCircle className="w-4 h-4" />
          <span>Problems {errorCount > 0 ? `(${errorCount})` : ''}</span>
        </button>

        <button
          onClick={() => setIsMobileActionsOpen(true)}
          className="flex flex-col items-center justify-center gap-1 min-h-[44px] text-[#858585] hover:text-[#cca700]"
        >
          <MoreHorizontal className="w-4 h-4 text-[#cca700]" />
          <span>Actions</span>
        </button>
      </div>

      {/* Mobile Actions Drawer Bottom Sheet */}
      {isMobileActionsOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/80 flex flex-col justify-end">
          <div className="bg-[#181818] border-t border-[#2d2d2d] rounded-t-xl p-4 space-y-3 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d2d2d]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[#ffffff]">Studio Actions</span>
                <span className="text-[10px] text-[#858585] font-mono">{project.name}</span>
              </div>
              <button
                onClick={() => setIsMobileActionsOpen(false)}
                className="p-1.5 rounded-md text-[#858585] hover:text-[#ffffff] hover:bg-[#252526] min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Build */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  handleBuild();
                }}
                disabled={isCompiling}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-[#ffffff] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <Hammer className="w-4 h-4 text-[#dcdcaa]" />
                <div className="text-left">
                  <div>Build</div>
                  <div className="text-[10px] text-[#858585]">Compile target</div>
                </div>
              </button>

              {/* Projects */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setIsWelcomeOpen(true);
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-[#ffffff] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <FolderOpen className="w-4 h-4 text-[#569cd6]" />
                <div className="text-left">
                  <div>Projects</div>
                  <div className="text-[10px] text-[#858585]">Templates & files</div>
                </div>
              </button>

              {/* Tests */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setIsTestRunnerOpen(true);
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#89d185] hover:text-[#a6e3a1] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <ShieldCheck className="w-4 h-4 text-[#89d185]" />
                <div className="text-left">
                  <div>Tests</div>
                  <div className="text-[10px] text-[#858585]">Core & LiteSVM</div>
                </div>
              </button>

              {/* Solana */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setIsSolanaDeployOpen(true);
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cca700] hover:text-[#ffd700] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <Coins className="w-4 h-4 text-[#cca700]" />
                <div className="text-left">
                  <div>Solana</div>
                  <div className="text-[10px] text-[#858585]">Deploy & wallet</div>
                </div>
              </button>

              {/* Settings */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setIsSettingsOpen(true);
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-[#ffffff] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <Settings className="w-4 h-4 text-[#9cdcfe]" />
                <div className="text-left">
                  <div>Settings</div>
                  <div className="text-[10px] text-[#858585]">RPC & IDE</div>
                </div>
              </button>

              {/* Preview */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setIsPreviewOpen(true);
                  setMobileActiveView('preview');
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#569cd6] hover:text-[#9cdcfe] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <Sparkles className="w-4 h-4 text-[#569cd6]" />
                <div className="text-left">
                  <div>Preview</div>
                  <div className="text-[10px] text-[#858585]">App canvas</div>
                </div>
              </button>

              {/* Terminal */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setActiveBottomTab('build-output');
                  setIsBottomOpen(true);
                  setMobileActiveView('terminal');
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#c586c0] hover:text-[#dcdcaa] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <Terminal className="w-4 h-4 text-[#c586c0]" />
                <div className="text-left">
                  <div>Terminal</div>
                  <div className="text-[10px] text-[#858585]">Output & logs</div>
                </div>
              </button>

              {/* Problems */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setActiveBottomTab('problems');
                  setIsBottomOpen(true);
                  setMobileActiveView('problems');
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#f14c4c] hover:text-[#f88080] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <AlertCircle className="w-4 h-4 text-[#f14c4c]" />
                <div className="text-left">
                  <div>Problems {errorCount > 0 ? `(${errorCount})` : ''}</div>
                  <div className="text-[10px] text-[#858585]">Diagnostics</div>
                </div>
              </button>

              {/* Developer Mode */}
              <button
                onClick={() => {
                  setIsMobileActionsOpen(false);
                  setIsTestbenchOpen(true);
                }}
                className="min-h-[44px] p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#858585] hover:text-[#cccccc] text-xs font-medium flex items-center gap-2 border border-[#2d2d2d] transition"
              >
                <Cpu className="w-4 h-4 text-[#cca700]" />
                <div className="text-left">
                  <div>Dev Mode</div>
                  <div className="text-[10px] text-[#858585]">AST inspector</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Language Truthful Capabilities Modal */}
      {isLanguageModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#181818] border border-[#2d2d2d] rounded-xl max-w-md w-full p-4 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d2d2d]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[#ffffff]">
                  Language Capabilities & Limits
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#252526] text-[#569cd6] font-mono border border-[#2d2d2d]">
                  {LanguageRegistry.getInstance().detectProvider(activeFile.path).name}
                </span>
              </div>
              <button
                onClick={() => setIsLanguageModalOpen(false)}
                className="p-1 rounded text-[#858585] hover:text-[#ffffff] min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-[#858585]">
              Manifest Studio reports honest capability status for each language. A capability is only marked available when the corresponding compiler or runtime genuinely executes in this environment.
            </p>

            <div className="space-y-1.5 text-xs">
              {(() => {
                const prov = LanguageRegistry.getInstance().detectProvider(activeFile.path);
                const caps = prov.honestCapabilities || LanguageRegistry.computeHonestCapabilities(prov);
                const items: Array<{ label: string; key: keyof typeof caps; desc: string }> = [
                  { label: 'Editing', key: 'editing', desc: 'CodeMirror buffer & multi-file tabs' },
                  { label: 'Syntax Highlighting', key: 'syntaxHighlighting', desc: 'Lezer / stream mode parser' },
                  { label: 'Autocompletion', key: 'completion', desc: 'Context-aware keywords & snippet tokens' },
                  { label: 'Diagnostics / Linter', key: 'diagnostics', desc: 'Syntax error markers & linting' },
                  { label: 'Code Formatting', key: 'formatting', desc: 'Indentation & bracket structure' },
                  { label: 'Local Execution', key: 'localExecution', desc: 'In-browser reactive engine / live preview' },
                  { label: 'Local Build', key: 'localBuild', desc: 'JS Target code generator' },
                  { label: 'Remote Build', key: 'remoteBuild', desc: 'Cloud CI / Anchor build pipeline' },
                  { label: 'Debugging', key: 'debugging', desc: 'Step-through breakpoint debugger' },
                ];

                return items.map((it) => {
                  const status = caps[it.key];
                  const color =
                    status === 'Available'
                      ? 'text-[#89d185] bg-[#1e3422] border-[#2ea043]/30'
                      : status === 'Partial'
                      ? 'text-[#cca700] bg-[#332b00] border-[#cca700]/30'
                      : status === 'Requires remote build'
                      ? 'text-[#c586c0] bg-[#301c36] border-[#c586c0]/30'
                      : status === 'Not configured'
                      ? 'text-[#858585] bg-[#252526] border-[#3c3c3c]'
                      : 'text-[#858585] bg-[#1f1f1f] border-[#2d2d2d]';

                  return (
                    <div
                      key={it.key}
                      className="flex items-center justify-between p-2 rounded bg-[#1f1f1f] border border-[#2d2d2d]"
                    >
                      <div>
                        <div className="font-medium text-[#cccccc]">{it.label}</div>
                        <div className="text-[10px] text-[#6e7681]">{it.desc}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${color}`}>
                        {status}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="text-[11px] text-[#858585] pt-2 border-t border-[#2d2d2d]">
              Clicking Run on non-Manifest files will not compile them as Manifest. Web files (HTML/CSS) are rendered in Preview; systems languages require native toolchains or remote build CI.
            </div>
          </div>
        </div>
      )}

      {/* 6. Developer Tools & Compiler Testbench Modal */}
      <TestbenchModal
        isOpen={isTestbenchOpen}
        onClose={() => setIsTestbenchOpen(false)}
        currentCode={mainManifestFile.content}
      />

      {/* 7. Welcome & Project Launch Screen */}
      <WelcomeScreen
        isOpen={isWelcomeOpen}
        onClose={() => {
          setIsWelcomeOpen(false);
          localStorage.setItem('manifest_studio_seen_welcome_v02', 'true');
        }}
        onOpenTemplate={(tplId, customName) => {
          const newProj = createDefaultProject(tplId);
          if (customName) newProj.name = customName;
          setProject(newProj);
          const entryPath = newProj.activeFilePath || newProj.files[0]?.path || 'src/main.manifest';
          setActiveFilePath(entryPath);
          setOpenFilePaths(newProj.files.slice(0, 3).map((f) => f.path));
          setConsoleEntries([]);
          showToast(`Loaded ${newProj.name}`);
          setIsWelcomeOpen(false);
          localStorage.setItem('manifest_studio_seen_welcome_v02', 'true');
          setTimeout(() => {
            handleRun();
          }, 50);
        }}
        onImportProject={(importedProj) => {
          setProject(importedProj);
          setActiveFilePath(importedProj.activeFilePath || importedProj.files[0]?.path || 'src/main.manifest');
          setOpenFilePaths(importedProj.files.slice(0, 3).map((f) => f.path));
          setConsoleEntries([]);
          showToast(`Imported ${importedProj.name}`);
          setIsWelcomeOpen(false);
          localStorage.setItem('manifest_studio_seen_welcome_v02', 'true');
          setTimeout(() => {
            handleRun();
          }, 50);
        }}
        onOpenTestbench={onSwitchToTestbench || (() => setIsTestbenchOpen(true))}
      />

      {/* 8. Project Menu Modal */}
      <ProjectMenuModal
        isOpen={isProjectMenuOpen}
        onClose={() => setIsProjectMenuOpen(false)}
        project={project}
        onUpdateProject={(newProj) => {
          setProject(newProj);
          setActiveFilePath(newProj.activeFilePath || newProj.files[0]?.path || 'src/main.manifest');
          setOpenFilePaths(newProj.files.slice(0, 3).map((f) => f.path));
        }}
        onShowToast={showToast}
        onSelectTemplate={(tplId) => {
          const newProj = createDefaultProject(tplId);
          setProject(newProj);
          const entryPath = newProj.activeFilePath || newProj.files[0]?.path || 'src/main.manifest';
          setActiveFilePath(entryPath);
          setOpenFilePaths(newProj.files.slice(0, 3).map((f) => f.path));
          showToast(`Loaded ${newProj.name}`);
        }}
      />

      {/* 9. GitHub Import Modal */}
      <GitHubImportModal
        isOpen={isGitHubImportOpen}
        onClose={() => setIsGitHubImportOpen(false)}
        onImportProject={(importedProj) => {
          setProject(importedProj);
          setActiveFilePath(importedProj.activeFilePath || importedProj.files[0]?.path || 'src/main.manifest');
          setOpenFilePaths(importedProj.files.slice(0, 3).map((f) => f.path));
        }}
        onShowToast={showToast}
      />

      {/* 10. Studio Settings Modal */}
      <ProjectSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        project={project}
        settings={settings}
        onUpdateProject={setProject}
        onUpdateSettings={setSettings}
        onShowToast={showToast}
        onOpenMainnetWarning={() => {
          setMainnetActionType('switch_network');
          setIsMainnetWarningOpen(true);
        }}
      />

      {/* 11. Mainnet Warning Modal */}
      <MainnetWarningModal
        isOpen={isMainnetWarningOpen}
        onClose={() => setIsMainnetWarningOpen(false)}
        onConfirm={() => {
          walletService.setNetwork('mainnet');
          showToast('Switched to Solana Mainnet-Beta');
        }}
      />

      {/* 12. Test Runner Modal */}
      <TestRunnerModal
        isOpen={isTestRunnerOpen}
        onClose={() => setIsTestRunnerOpen(false)}
        currentSource={mainManifestFile.content}
        onShowToast={showToast}
      />

      {/* 13. Solana Deploy & Transaction Modal */}
      <SolanaDeployModal
        isOpen={isSolanaDeployOpen}
        onClose={() => setIsSolanaDeployOpen(false)}
        programSource={mainManifestFile.content}
        onShowToast={showToast}
      />
    </div>
  );
}

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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  StudioSyntaxProfile,
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
import { ExecutionOrchestrator } from './execution/execution-orchestrator.ts';
import { UnifiedExecutionResult } from './execution/execution-types.ts';
import { Sidebar, ActivityTab } from './sidebar/Sidebar.tsx';
import { CodeMirrorEditor, evictCachedEditorState } from './editor/CodeMirrorEditor.tsx';
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
import { SolanaWalletService, WalletState } from './services/solana-wallet.ts';
import { detectLanguage } from './editor/language-support.ts';
import { Coins, ShieldCheck, Wand2 } from 'lucide-react';
import { LanguageRegistry } from './languages/language-registry.ts';
import {
  COMPILER_TARGETS,
  formatManifestSource,
  detectSyntaxProfile,
  isLegacyDomainManifestSource,
} from '../../manifest-core/src/index.ts';

interface StudioProps {
  onSwitchToTestbench?: () => void;
}

export function Studio({ onSwitchToTestbench }: StudioProps = {}) {
  const [project, setProject] = useState<ManifestProject>(() => loadProjectFromStorage());
  const [activeFilePath, setActiveFilePath] = useState<string>(
    project.activeFilePath || project.files[0]?.path || 'src/main.manifest'
  );
  const [openFilePaths, setOpenFilePaths] = useState<string[]>(() =>
    project.files
      .filter((f) => !f.path.endsWith('/.gitkeep'))
      .slice(0, 3)
      .map((f) => f.path)
  );
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

  // Dirty (unsaved) file tracking
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set());

  // Cursor position tracking for status bar
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  // Mobile specific state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [mobileActiveView, setMobileActiveView] = useState<'editor' | 'preview' | 'terminal' | 'problems'>('editor');
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState<boolean>(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState<boolean>(false);

  const isHydratedRef = useRef<boolean>(false);

  // Load project asynchronously from IndexedDB on initial mount BEFORE enabling auto-save
  useEffect(() => {
    let cancelled = false;
    loadProjectAsync().then((loadedProject) => {
      if (cancelled) return;
      isHydratedRef.current = true;
      setProject(loadedProject);
      const visibleFiles = loadedProject.files.filter((f) => !f.path.endsWith('/.gitkeep'));
      const activeP =
        loadedProject.activeFilePath && visibleFiles.some((f) => f.path === loadedProject.activeFilePath)
          ? loadedProject.activeFilePath
          : visibleFiles[0]?.path || 'src/main.manifest';
      setActiveFilePath(activeP);
      setOpenFilePaths(visibleFiles.slice(0, 3).map((f) => f.path));
      const activeF = visibleFiles.find((f) => f.path === activeP) || visibleFiles[0];
      if (activeF) {
        handleRun(loadedProject, activeF);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Save project asynchronously to IndexedDB only after initial hydration completes
  useEffect(() => {
    if (!isHydratedRef.current) return;
    const saveTimer = setTimeout(() => {
      saveProjectAsync({ ...project, activeFilePath }).then((res) => {
        if (res.saved) {
          setDirtyPaths(new Set());
        } else if (res.error) {
          addConsoleEntry(`[Storage Warning] ${res.error}`, 'error');
          showToast('Warning: Workspace storage quota exceeded');
        }
      });
    }, 180);
    return () => clearTimeout(saveTimer);
  }, [project, activeFilePath]);

  // Save settings upon updates
  useEffect(() => {
    saveSettingsToStorage(settings);
  }, [settings]);

  // Active file object
  const activeFile = useMemo(() => {
    const visible = project.files.filter((f) => !f.path.endsWith('/.gitkeep'));
    return (
      visible.find((f) => f.path === activeFilePath) ||
      visible[0] || {
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
    const visible = project.files.filter((f) => !f.path.endsWith('/.gitkeep'));
    return (
      visible.find((f) => f.path === splitFilePath) ||
      visible.find((f) => f.path !== activeFilePath) ||
      visible[0]
    );
  }, [project.files, splitFilePath, activeFilePath]);

  // Primary Manifest source file for CLI Terminal / Testbench inspection
  const mainManifestFile = useMemo(() => {
    if (activeFile.language === 'manifest' || activeFile.path.endsWith('.manifest')) {
      return activeFile;
    }
    if (project.entryPath) {
      const configured = project.files.find((f) => f.path === project.entryPath && f.path.endsWith('.manifest'));
      if (configured) return configured;
    }
    return (
      project.files.find((f) => f.path === 'src/main.manifest') ||
      project.files.find((f) => f.path.endsWith('.manifest')) ||
      activeFile
    );
  }, [project.files, project.entryPath, activeFile]);

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
    setDirtyPaths((prev) => {
      const next = new Set(prev);
      next.add(activeFilePath);
      return next;
    });
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
    setDirtyPaths((prev) => {
      const next = new Set(prev);
      next.add(splitFile.path);
      return next;
    });
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

  // Format or convert active Manifest source file into selected Syntax Profile
  const handleFormatManifest = (targetProfOverride?: 'beginner' | 'professional') => {
    if (activeFile.language !== 'manifest' && !activeFile.path.endsWith('.manifest')) {
      showToast('Open a .manifest source file to format');
      return;
    }
    if (isLegacyDomainManifestSource(activeFile.content)) {
      showToast('Declarative UI / Solana domain blocks keep their canonical block layout');
      return;
    }
    const targetProf: 'beginner' | 'professional' =
      targetProfOverride ||
      (project.syntaxProfile && project.syntaxProfile !== 'auto'
        ? project.syntaxProfile
        : detectSyntaxProfile(activeFile.content));
    const fmt = formatManifestSource(activeFile.content, targetProf);
    if (!fmt.ok || !fmt.formatted) {
      const msg = fmt.diagnostics[0]?.message || 'Cannot format file with syntax errors';
      addConsoleEntry(`[Formatter] ${msg}`, 'error');
      showToast('Fix syntax errors before formatting');
      return;
    }
    handleFileChange(fmt.formatted);
    setProject((prev) => ({ ...prev, syntaxProfile: targetProf }));
    showToast(`Formatted as ${targetProf === 'professional' ? 'Professional' : 'Beginner'} Profile`);
  };

  // Helper to persist generated BuildArtifacts into project.files under build/ (or declared artifact path)
  const writeArtifactsToWorkspace = (
    projId: string,
    artifacts: Array<{
      fileName: string;
      fileType: string;
      content: string;
      sizeBytes: number;
      isBinary?: boolean;
      mimeType?: string;
    }>
  ) => {
    if (!artifacts || artifacts.length === 0) return;
    setProject((prev) => {
      if (prev.id !== projId) return prev;
      let nextFiles = [...prev.files];
      for (const art of artifacts) {
        const cleanPath = art.fileName.includes('/') ? art.fileName : `build/${art.fileName}`;
        const name = cleanPath.split('/').pop() || cleanPath;
        const lang = detectLanguage(cleanPath);
        const existingIdx = nextFiles.findIndex((f) => f.path === cleanPath);
        const fileEntry: ProjectFile = {
          id: existingIdx >= 0 ? nextFiles[existingIdx].id : `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          path: cleanPath,
          language: lang,
          content: art.content,
          isReadOnly: true,
          isBinary: art.isBinary,
          mimeType: art.mimeType,
        };
        if (existingIdx >= 0) {
          nextFiles[existingIdx] = fileEntry;
        } else {
          nextFiles.push(fileEntry);
        }
      }
      return { ...prev, files: nextFiles };
    });
  };

  // Unified Run pipeline: uses ExecutionOrchestrator to detect and execute project deterministically
  const handleRun = useCallback(
    async (
      projOverride?: ManifestProject | React.MouseEvent | any,
      fileOverride?: ProjectFile,
      targetOverride?: string
    ) => {
      const isActualProject = projOverride && typeof projOverride === 'object' && 'files' in projOverride;
      const currentProj = isActualProject ? (projOverride as ManifestProject) : project;
      const currentFile =
        fileOverride ||
        (activeFilePath ? currentProj.files.find((f) => f.path === activeFilePath) : undefined) ||
        activeFile;

      setIsCompiling(true);
      const orchestrator = ExecutionOrchestrator.getInstance();
      const chosenTarget = targetOverride || currentProj.compilerTarget || 'auto';
      addConsoleEntry(
        `Running "${currentFile.path}"${chosenTarget !== 'auto' ? ` [Target: ${chosenTarget}]` : ''}...`,
        'info'
      );

      try {
        const res = await orchestrator.executeProject(currentProj, {
          activeFilePath: currentFile.path,
          compilerTarget: chosenTarget === 'auto' ? undefined : chosenTarget,
          syntaxProfile: currentProj.syntaxProfile,
        });

        if (res.superseded) {
          return;
        }

        setExecutionResult(res);

        const bRes: BuildResult = {
          success: res.success,
          timestamp: res.timestamp,
          target: res.targetId || (res.projectKind === 'manifest' ? 'mvm' : res.projectKind),
          targetId: res.targetId,
          targetStatus: res.targetStatus,
          syntaxProfile: res.syntaxProfile,
          artifacts: res.artifacts || [],
          diagnostics: res.diagnostics,
          outputCode: res.outputCode,
          ir: res.ir,
          irText: res.irText,
          disassembly: res.disassembly,
          capabilityAudit: res.capabilityAudit,
          returnValue: res.returnValue,
          vmSteps: res.vmSteps,
          durationMs: res.durationMs,
        };
        setBuildResult(bRes);

        for (const line of res.logs) {
          addConsoleEntry(line, res.success ? 'build' : 'error');
        }

        if (res.success) {
          const entryLabel = res.resolvedEntryPath || currentFile.path;
          setIsPreviewOpen(true);
          setMobileActiveView('preview');
          showToast(
            res.targetId === 'mvm'
              ? `Executed "${entryLabel}" on Rust MVM`
              : `Running "${entryLabel}" (${res.targetId || res.projectKind})`
          );
        } else {
          const errorCount = res.diagnostics.filter((d) => d.severity === 'error').length || 1;
          addConsoleEntry(`Execution halted with ${errorCount} diagnostic(s).`, 'error');
          setIsPreviewOpen(true);
          setActiveBottomTab('problems');
          setIsBottomOpen(true);
          showToast(`Execution halted (${currentFile.name})`);
        }
      } catch (err: any) {
        addConsoleEntry(`Execution failure: ${err.message || String(err)}`, 'error');
      } finally {
        setIsCompiling(false);
      }
    },
    [project, activeFile, activeFilePath, addConsoleEntry]
  );

  // Build command: emits real target artifacts (.mbc, .disasm.txt, .wasm, .wat, .rs, .js, bundle.html) into workspace
  const handleBuild = async () => {
    const langProvider = LanguageRegistry.getInstance().detectProvider(activeFile.path);
    const buildStatus = langProvider.getCapabilityStatus
      ? langProvider.getCapabilityStatus('localBuild')
      : 'Unsupported';

    if (buildStatus !== 'Available' && activeFile.language !== 'manifest') {
      addConsoleEntry(
        `[Build] Cannot build "${activeFile.path}" locally. ${langProvider.name} local build is ${buildStatus}.`,
        'error'
      );
      showToast(`${langProvider.name}: Local build is ${buildStatus}`);
      return;
    }

    setIsCompiling(true);

    try {
      // Static Web / JS local bundle build
      if (activeFile.language === 'html' || activeFile.language === 'css' || activeFile.language === 'javascript') {
        const orchestrator = ExecutionOrchestrator.getInstance();
        const webRes = await orchestrator.executeProject(project, { activeFilePath: activeFile.path });
        if (webRes.success && webRes.previewHtml) {
          const bundlePath = 'build/bundle.html';
          setProject((prev) => {
            const withoutOldBundle = prev.files.filter((f) => f.path !== bundlePath);
            return {
              ...prev,
              files: [
                ...withoutOldBundle,
                {
                  id: `web-bundle-${Date.now()}`,
                  name: 'bundle.html',
                  path: bundlePath,
                  language: 'html',
                  content: webRes.previewHtml!,
                  isReadOnly: true,
                },
              ],
            };
          });
          addConsoleEntry(`Web bundle generated: ${bundlePath} (${webRes.previewHtml.length} bytes)`, 'build');
          showToast(`Built ${bundlePath}`);
        } else {
          setExecutionResult(webRes);
          addConsoleEntry(`Web build failed: ${webRes.error || 'Missing HTML entry'}`, 'error');
        }
        return;
      }

      const orchestrator = ExecutionOrchestrator.getInstance();
      const targetManifest =
        activeFile.language === 'manifest' || activeFile.path.endsWith('.manifest')
          ? activeFile
          : mainManifestFile;

      const buildRes = await orchestrator.buildProject(project, {
        activeFilePath: targetManifest.path,
        compilerTarget: project.compilerTarget === 'auto' ? undefined : project.compilerTarget,
        syntaxProfile: project.syntaxProfile,
      });

      const bRes: BuildResult = {
        success: buildRes.success,
        timestamp: buildRes.timestamp,
        target: buildRes.targetId || project.compilerTarget || 'mvm',
        targetId: buildRes.targetId,
        targetStatus: buildRes.targetStatus,
        syntaxProfile: buildRes.syntaxProfile,
        artifacts: buildRes.artifacts || [],
        diagnostics: buildRes.diagnostics,
        outputCode: buildRes.outputCode,
        ir: buildRes.ir,
        irText: buildRes.irText,
        disassembly: buildRes.disassembly,
        capabilityAudit: buildRes.capabilityAudit,
        durationMs: buildRes.durationMs,
      };
      setBuildResult(bRes);

      for (const line of buildRes.logs) {
        addConsoleEntry(line, buildRes.success ? 'build' : 'error');
      }

      if (buildRes.success && buildRes.artifacts && buildRes.artifacts.length > 0) {
        writeArtifactsToWorkspace(project.id, buildRes.artifacts);
        const primaryArt = buildRes.artifacts[0];
        const primaryPath = primaryArt.fileName.includes('/')
          ? primaryArt.fileName
          : `build/${primaryArt.fileName}`;
        showToast(`Built ${primaryPath} (${primaryArt.sizeBytes} B)`);
      } else if (!buildRes.success) {
        setActiveBottomTab('problems');
        setIsBottomOpen(true);
        showToast(`Build failed (${targetManifest.name})`);
      }
    } finally {
      setIsCompiling(false);
    }
  };

  // Helper to activate a newly selected/imported project without losing previous projects
  const activateWorkspaceProject = (newProj: ManifestProject, toastLabel: string) => {
    setProject(newProj);
    const visible = newProj.files.filter((f) => !f.path.endsWith('/.gitkeep'));
    const entryPath =
      (newProj.activeFilePath && visible.some((f) => f.path === newProj.activeFilePath)
        ? newProj.activeFilePath
        : undefined) ||
      visible[0]?.path ||
      'src/main.manifest';
    setActiveFilePath(entryPath);
    const activeF = visible.find((f) => f.path === entryPath) || visible[0];
    setOpenFilePaths(visible.slice(0, 3).map((f) => f.path));
    setConsoleEntries([]);
    setExecutionResult(null);
    setBuildResult(null);
    showToast(toastLabel);
    if (activeF) {
      handleRun(newProj, activeF);
    }
  };

  // Handle template selection with immediate preview refresh
  const handleSelectTemplate = (templateId: string) => {
    const newProj = createDefaultProject(templateId);
    activateWorkspaceProject(newProj, `Loaded template: ${newProj.name}`);
  };

  // Create new file or folder placeholder in project
  const handleCreateFile = (path: string) => {
    const cleanPath = path.replace(/^\/+/, '');
    if (project.files.some((f) => f.path === cleanPath)) {
      showToast('File or folder already exists');
      return;
    }
    const isGitKeep = cleanPath.endsWith('/.gitkeep');
    const name = cleanPath.split('/').pop() || cleanPath;
    const isManifest = cleanPath.endsWith('.manifest');
    const modIdent = name.replace(/\.manifest$/i, '').replace(/[^a-zA-Z0-9_]/g, '_') || 'mod';

    const starterContent = !isManifest
      ? ''
      : project.syntaxProfile === 'professional'
      ? `module ${modIdent};\n\nexport fn helper(x: i64) -> i64 {\n    return x;\n}\n`
      : project.syntaxProfile === 'beginner'
      ? `MODULE ${modIdent}\n\nEXPORT FUNCTION helper(x: Int) RETURNS Int\n    RETURN x\nEND\n`
      : `module ${modIdent};\n\nrequires console;\n\nfn main() -> i64 effects(console) {\n    console.print("Module ${modIdent} ready");\n    return 0;\n}\n`;

    const newFile: ProjectFile = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      path: cleanPath,
      language: detectLanguage(cleanPath),
      content: starterContent,
    };

    setProject((prev) => ({
      ...prev,
      files: [...prev.files, newFile],
      updatedAt: Date.now(),
    }));

    if (isGitKeep) {
      showToast(`Created folder ${cleanPath.slice(0, -9)}`);
    } else {
      setActiveFilePath(cleanPath);
      if (!openFilePaths.includes(cleanPath)) {
        setOpenFilePaths((prev) => [...prev, cleanPath]);
      }
      showToast(`Created ${cleanPath}`);
    }
  };

  // Rename file or folder in project and update entry/HTML/TOML references
  const handleRenameFile = (oldPath: string, newPath: string) => {
    const cleanNew = newPath.replace(/^\/+|\/+$/g, '');
    if (!cleanNew || cleanNew === oldPath) return;

    const isDirectFile = project.files.some((f) => f.path === oldPath);
    const isFolder = project.files.some((f) => f.path.startsWith(oldPath + '/'));
    if (!isDirectFile && !isFolder) return;

    const conflict = project.files.some(
      (f) =>
        f.path === cleanNew ||
        (isFolder && f.path.startsWith(cleanNew + '/') && !f.path.startsWith(oldPath + '/'))
    );
    if (conflict) {
      showToast('A file or folder with that name already exists');
      return;
    }

    evictCachedEditorState(`${project.id}:${oldPath}`);

    const mapPath = (p: string) => {
      if (p === oldPath) return cleanNew;
      if (isFolder && p.startsWith(oldPath + '/')) {
        return cleanNew + p.slice(oldPath.length);
      }
      return p;
    };

    const oldFileName = oldPath.split('/').pop() || oldPath;
    const newFileName = cleanNew.split('/').pop() || cleanNew;

    setProject((prev) => {
      const nextEntry = prev.entryPath ? mapPath(prev.entryPath) : prev.entryPath;
      const updatedFiles = prev.files.map((f) => {
        const mappedPath = mapPath(f.path);
        const renamed =
          mappedPath !== f.path
            ? {
                ...f,
                name: mappedPath.split('/').pop() || mappedPath,
                path: mappedPath,
                language: detectLanguage(mappedPath),
              }
            : f;

        // Keep manifest.toml entry reference synchronized
        if (renamed.path === 'manifest.toml' && !renamed.isBinary) {
          return {
            ...renamed,
            content: renamed.content.replace(
              /entry\s*=\s*(["'])([^"']+)\1/,
              (full, quote, val) => {
                const updatedRef = mapPath(val.trim());
                return updatedRef !== val.trim() ? `entry = ${quote}${updatedRef}${quote}` : full;
              }
            ),
          };
        }

        // Keep local HTML asset/script/style href & src synchronized on file rename
        if ((renamed.language === 'html' || renamed.path.endsWith('.html')) && !renamed.isBinary && isDirectFile) {
          let htmlContent = renamed.content;
          htmlContent = htmlContent
            .split(`"${oldPath}"`).join(`"${cleanNew}"`)
            .split(`'${oldPath}'`).join(`'${cleanNew}'`);
          if (!oldPath.includes('/') && !cleanNew.includes('/')) {
            htmlContent = htmlContent
              .split(`"${oldFileName}"`).join(`"${newFileName}"`)
              .split(`'${oldFileName}'`).join(`'${newFileName}'`);
          }
          if (htmlContent !== renamed.content) {
            return { ...renamed, content: htmlContent };
          }
        }

        return renamed;
      });

      return {
        ...prev,
        entryPath: nextEntry,
        files: updatedFiles,
        updatedAt: Date.now(),
      };
    });

    setOpenFilePaths((prev) => prev.map(mapPath));
    setActiveFilePath((prev) => mapPath(prev));
    setSplitFilePath((prev) => mapPath(prev));
    showToast(`Renamed ${oldPath} → ${cleanNew}`);
  };

  // Delete file or folder in project with reference & entry diagnostics
  const handleDeleteFile = (targetPath: string) => {
    const remaining = project.files.filter(
      (f) => f.path !== targetPath && !f.path.startsWith(targetPath + '/')
    );
    const remainingVisible = remaining.filter((f) => !f.path.endsWith('/.gitkeep'));
    if (remainingVisible.length === 0) {
      showToast('Cannot delete the last file in the project');
      return;
    }

    evictCachedEditorState(`${project.id}:${targetPath}`);

    // Warn if deleted path was referenced in manifest.toml or HTML files
    const toml = remaining.find((f) => f.path === 'manifest.toml');
    const tomlEntry = toml?.content.match(/entry\s*=\s*["']([^"']+)["']/)?.[1];
    if (
      project.entryPath === targetPath ||
      (project.entryPath && project.entryPath.startsWith(targetPath + '/')) ||
      tomlEntry === targetPath
    ) {
      addConsoleEntry(
        `[Workspace Warning] Deleted configured entry point "${targetPath}". Update entry point in Settings or manifest.toml before running.`,
        'error'
      );
    }

    setProject((prev) => ({
      ...prev,
      entryPath:
        prev.entryPath === targetPath || (prev.entryPath && prev.entryPath.startsWith(targetPath + '/'))
          ? undefined
          : prev.entryPath,
      files: remaining,
      updatedAt: Date.now(),
    }));

    const nextOpen = openFilePaths.filter(
      (p) => p !== targetPath && !p.startsWith(targetPath + '/')
    );
    const ensuredOpen = nextOpen.length > 0 ? nextOpen : [remainingVisible[0].path];
    setOpenFilePaths(ensuredOpen);

    if (activeFilePath === targetPath || activeFilePath.startsWith(targetPath + '/')) {
      setActiveFilePath(ensuredOpen[0]);
    }
    showToast(`Deleted ${targetPath}`);
  };

  const getFileIcon = (file: ProjectFile) => {
    if (file.language === 'manifest') {
      return <FileCode className="w-3.5 h-3.5 text-[#ce9178]" />;
    }
    if (file.language === 'mbc') {
      return <Cpu className="w-3.5 h-3.5 text-[#89d185]" />;
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

        {/* Right: Syntax Profile, Compiler Target, Run / Build / Preview Actions */}
        <div className="flex items-center space-x-1.5 sm:space-x-2">
          {/* Syntax Profile Selector (Beginner | Professional | Auto) */}
          <div className="hidden xl:flex items-center gap-1">
            <select
              aria-label="Manifest Syntax Profile"
              title="Syntax Profile (Beginner & Professional normalize to identical AST, IR, and .mbc bytecode)"
              value={project.syntaxProfile || 'auto'}
              onChange={(e) => {
                const nextProf = e.target.value as StudioSyntaxProfile;
                setProject((prev) => ({ ...prev, syntaxProfile: nextProf, updatedAt: Date.now() }));
              }}
              className="h-[30px] px-2 rounded-md bg-[#1f1f1f] border border-[#2d2d2d] text-[#cccccc] text-[11px] outline-none hover:border-[#454545] cursor-pointer"
            >
              <option value="auto">Profile: Auto</option>
              <option value="beginner">Profile: Beginner</option>
              <option value="professional">Profile: Professional</option>
            </select>

            {activeFile.language === 'manifest' && !isLegacyDomainManifestSource(activeFile.content) && (
              <button
                onClick={() => handleFormatManifest()}
                title="Format active .manifest file in selected Syntax Profile"
                className="h-[30px] px-2 rounded-md bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[#cccccc] text-[11px] flex items-center gap-1 transition cursor-pointer"
              >
                <Wand2 className="w-3 h-3 text-[#9cdcfe]" />
                <span>Format</span>
              </button>
            )}
          </div>

          {/* Compiler Target Selector */}
          <select
            aria-label="Compiler Target"
            title="Select Manifest Compilation & Execution Target"
            value={project.compilerTarget || 'auto'}
            onChange={(e) => {
              const nextTarget = e.target.value;
              const updatedProj = { ...project, compilerTarget: nextTarget, updatedAt: Date.now() };
              setProject(updatedProj);
              if (activeFile.language === 'manifest' || activeFile.path.endsWith('.manifest')) {
                handleRun(updatedProj, activeFile, nextTarget);
              }
            }}
            className="hidden md:block h-[30px] px-2 rounded-md bg-[#1f1f1f] border border-[#2d2d2d] text-[#cccccc] text-[11px] outline-none hover:border-[#454545] cursor-pointer max-w-[185px]"
          >
            <option value="auto">Target: Auto</option>
            {COMPILER_TARGETS.map((tgt) => (
              <option key={tgt.id} value={tgt.id} disabled={tgt.status === 'planned'}>
                {tgt.name}
                {tgt.status === 'planned'
                  ? ' (Planned)'
                  : tgt.status === 'requires-toolchain'
                  ? ' (rustc)'
                  : ''}
              </option>
            ))}
          </select>

          {/* Primary Run Button - VS Code Green #238636 */}
          <button
            onClick={handleRun}
            disabled={isCompiling}
            title="Compile & Run Active Entry (Mod+Enter)"
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
            title="Emit target build artifacts (.mbc, .wasm, .rs, .js) into workspace build/"
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
            onRenameFile={handleRenameFile}
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
                    {dirtyPaths.has(path) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#cca700]" title="Unsaved edits" />
                    )}
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
                fileId={`${project.id}:${activeFile.path}`}
                value={activeFile.content}
                onChange={handleFileChange}
                language={activeFile.language}
                readOnly={activeFile.isReadOnly}
                isBinary={activeFile.isBinary}
                mimeType={activeFile.mimeType}
                fontSize={settings.fontSize}
                wordWrap={settings.wordWrap}
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
                      {project.files
                        .filter((f) => !f.path.endsWith('/.gitkeep'))
                        .map((f) => (
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
                    fileId={`split:${project.id}:${splitFile.path}`}
                    value={splitFile.content}
                    onChange={handleSplitFileChange}
                    language={splitFile.language}
                    readOnly={splitFile.isReadOnly}
                    isBinary={splitFile.isBinary}
                    mimeType={splitFile.mimeType}
                    fontSize={settings.fontSize}
                    wordWrap={settings.wordWrap}
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
                <TerminalPanel
                  currentSource={mainManifestFile.content}
                  workspaceFiles={Object.fromEntries(
                    project.files
                      .filter((f) => !f.isBinary && !f.path.endsWith('/.gitkeep'))
                      .map((f) => [f.path, f.content])
                  )}
                />
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
              onRenameFile={handleRenameFile}
              onSelectTemplate={handleSelectTemplate}
              onOpenDevTools={() => {
                setMobileDrawerOpen(false);
                setIsTestbenchOpen(true);
              }}
              onOpenProjectMenu={() => {
                setMobileDrawerOpen(false);
                setIsProjectMenuOpen(true);
              }}
              onOpenGitHubImport={() => {
                setMobileDrawerOpen(false);
                setIsGitHubImportOpen(true);
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
          setIsWelcomeOpen(false);
          localStorage.setItem('manifest_studio_seen_welcome_v02', 'true');
          activateWorkspaceProject(newProj, `Loaded ${newProj.name}`);
        }}
        onImportProject={(importedProj) => {
          setIsWelcomeOpen(false);
          localStorage.setItem('manifest_studio_seen_welcome_v02', 'true');
          activateWorkspaceProject(importedProj, `Imported ${importedProj.name}`);
        }}
        onOpenTestbench={onSwitchToTestbench || (() => setIsTestbenchOpen(true))}
      />

      {/* 8. Project Menu Modal */}
      <ProjectMenuModal
        isOpen={isProjectMenuOpen}
        onClose={() => setIsProjectMenuOpen(false)}
        project={project}
        onUpdateProject={(newProj) => {
          activateWorkspaceProject(newProj, `Opened ${newProj.name}`);
        }}
        onShowToast={showToast}
        onSelectTemplate={(tplId) => {
          handleSelectTemplate(tplId);
        }}
      />

      {/* 9. GitHub Import Modal */}
      <GitHubImportModal
        isOpen={isGitHubImportOpen}
        onClose={() => setIsGitHubImportOpen(false)}
        onImportProject={(importedProj) => {
          activateWorkspaceProject(importedProj, `Imported ${importedProj.name}`);
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

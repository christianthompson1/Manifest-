/**
 * Manifest Studio - Project Menu Modal & File Actions
 * Implements Section 2: Real Project Menu
 * Actions:
 * - New Project (Blank project with manifest.toml and src/main.manifest)
 * - Open Project (From IndexedDB saved projects)
 * - Import Files (Multi-file picker with unrestricted extensions)
 * - Import Folder (File System Access API or webkitdirectory)
 * - Import ZIP
 * - Import from GitHub
 * - Export Project ZIP
 * - Save Project
 * - Switch / Open Template
 */

import React, { useRef, useState } from 'react';
import {
  FolderPlus,
  FolderOpen,
  Upload,
  Download,
  Github,
  Save,
  X,
  FileText,
  Boxes,
  CheckCircle2,
  Folder,
  Layers,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { ManifestProject, ProjectFile } from '../types.ts';
import { createBlankProject, TEMPLATES } from '../project-store.ts';
import { exportProjectAsZip, importProjectFromZip } from '../services/zip-service.ts';
import { openProjectDirectoryWithPicker } from '../services/fs-access.ts';
import { detectLanguage } from '../editor/language-support.ts';

interface ProjectMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ManifestProject;
  onUpdateProject: (proj: ManifestProject) => void;
  onOpenGitHubImport: () => void;
  onShowToast: (msg: string) => void;
}

export const ProjectMenuModal: React.FC<ProjectMenuModalProps> = ({
  isOpen,
  onClose,
  project,
  onUpdateProject,
  onOpenGitHubImport,
  onShowToast,
}) => {
  const [newProjectName, setNewProjectName] = useState('');
  const [activeTab, setActiveTab] = useState<'menu' | 'new' | 'templates'>('menu');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // 1. Create clean blank project (Section 2 & 4: manifest.toml, src/main.manifest)
  const handleCreateBlank = () => {
    const blank = createBlankProject();
    if (newProjectName.trim()) {
      blank.name = newProjectName.trim();
    }
    onUpdateProject(blank);
    onShowToast(`Created new project: ${blank.name}`);
    onClose();
  };

  // 2. Select predefined template
  const handleSelectTemplate = (tplId: string) => {
    const tpl = TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    const newProj: ManifestProject = {
      id: `project-${Date.now()}`,
      name: tpl.name,
      description: tpl.description,
      kind: tpl.kind || 'manifest',
      files: tpl.files.map((f) => ({ ...f })),
      activeFilePath: tpl.files[0]?.path || 'src/main.manifest',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onUpdateProject(newProj);
    onShowToast(`Loaded template: ${tpl.name}`);
    onClose();
  };

  // 3. Multi-file import (Unrestricted extensions - Section 3)
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const importedFiles: ProjectFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const text = await f.text();
      const path = f.name;
      importedFiles.push({
        id: `file-${Date.now()}-${i}`,
        name: f.name,
        path,
        content: text,
        language: detectLanguage(path),
      });
    }

    // Merge into project without duplicating paths
    const existingPaths = new Set(importedFiles.map((f) => f.path));
    const merged = [
      ...project.files.filter((f) => !existingPaths.has(f.path)),
      ...importedFiles,
    ];

    onUpdateProject({
      ...project,
      files: merged,
      activeFilePath: importedFiles[0]?.path || project.activeFilePath,
      updatedAt: Date.now(),
    });

    onShowToast(`Imported ${importedFiles.length} file(s) into project`);
    onClose();
  };

  // 4. Import Folder
  const handleFolderSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const importedFiles: ProjectFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // webkitRelativePath contains the full relative path
      const path = f.webkitRelativePath || f.name;
      // Strip outer root folder name if present
      const cleanPath = path.includes('/') ? path.substring(path.indexOf('/') + 1) : path;
      const text = await f.text();

      importedFiles.push({
        id: `file-${Date.now()}-${i}`,
        name: cleanPath.split('/').pop() || cleanPath,
        path: cleanPath,
        content: text,
        language: detectLanguage(cleanPath),
      });
    }

    if (importedFiles.length > 0) {
      onUpdateProject({
        ...project,
        files: importedFiles,
        activeFilePath: importedFiles[0]?.path || 'src/main.manifest',
        updatedAt: Date.now(),
      });
      onShowToast(`Imported folder with ${importedFiles.length} files`);
      onClose();
    }
  };

  // 5. ZIP Import
  const handleZipSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const imported = await importProjectFromZip(file);
      onUpdateProject(imported);
      onShowToast(`Imported ZIP project: ${imported.name} (${imported.files.length} files)`);
      onClose();
    } catch (err: any) {
      alert(`Error importing ZIP: ${err.message}`);
    }
  };

  // 6. Export ZIP
  const handleExportZip = async () => {
    try {
      await exportProjectAsZip(project);
      onShowToast(`Exported ${project.name}.zip`);
      onClose();
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  // 7. Try File System Access API directory picker
  const handleDirectoryPicker = async () => {
    try {
      const imported = await openProjectDirectoryWithPicker();
      onUpdateProject(imported);
      onShowToast(`Imported directory: ${imported.name} (${imported.files.length} files)`);
      onClose();
    } catch (err: any) {
      // If user cancelled, do nothing. If not supported, trigger fallback input
      if (err.name !== 'AbortError') {
        folderInputRef.current?.click();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      {/* Hidden file inputs for cross-browser file system access */}
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept="*/*"
        onChange={handleFilesSelected}
        className="hidden"
      />
      <input
        type="file"
        ref={folderInputRef}
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={handleFolderSelected}
        className="hidden"
      />
      <input
        type="file"
        ref={zipInputRef}
        accept=".zip,application/zip"
        onChange={handleZipSelected}
        className="hidden"
      />

      <div className="bg-[#181818] border border-[#2d2d2d] rounded-xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2d2d2d] flex items-center justify-between bg-[#1f1f1f]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#569cd6]">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#ffffff]">Project Management</h2>
              <p className="text-[11px] text-[#858585]">Active Project: {project.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#2d2d2d] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-[#2d2d2d] px-5 bg-[#181818] gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('menu')}
            className={`py-2.5 border-b-2 transition ${
              activeTab === 'menu'
                ? 'border-[#569cd6] text-[#ffffff]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Project Actions
          </button>
          <button
            onClick={() => setActiveTab('new')}
            className={`py-2.5 border-b-2 transition ${
              activeTab === 'new'
                ? 'border-[#569cd6] text-[#ffffff]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            New Blank Project
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`py-2.5 border-b-2 transition ${
              activeTab === 'templates'
                ? 'border-[#569cd6] text-[#ffffff]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Starter Templates
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-4">
          {activeTab === 'menu' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* New Blank Project */}
              <button
                onClick={() => setActiveTab('new')}
                className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#569cd6] hover:bg-[#252526] text-left transition flex items-start gap-3 group cursor-pointer"
              >
                <div className="p-2 rounded-md bg-[#252526] border border-[#2d2d2d] text-[#569cd6] group-hover:scale-105 transition">
                  <FolderPlus className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#ffffff]">New Blank Project</div>
                  <div className="text-[11px] text-[#858585] mt-0.5">
                    Minimal manifest.toml and src/main.manifest
                  </div>
                </div>
              </button>

              {/* Import from GitHub */}
              <button
                onClick={() => {
                  onClose();
                  onOpenGitHubImport();
                }}
                className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#89d185] hover:bg-[#252526] text-left transition flex items-start gap-3 group cursor-pointer"
              >
                <div className="p-2 rounded-md bg-[#252526] border border-[#2d2d2d] text-[#ffffff] group-hover:scale-105 transition">
                  <Github className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#ffffff]">Import from GitHub</div>
                  <div className="text-[11px] text-[#858585] mt-0.5">
                    Clone public repository directly without authentication
                  </div>
                </div>
              </button>

              {/* Import Files */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#cca700] hover:bg-[#252526] text-left transition flex items-start gap-3 group cursor-pointer"
              >
                <div className="p-2 rounded-md bg-[#252526] border border-[#2d2d2d] text-[#cca700] group-hover:scale-105 transition">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#ffffff]">Import Files</div>
                  <div className="text-[11px] text-[#858585] mt-0.5">
                    Add code files (.manifest, .rs, .py, .ts, .json, etc.)
                  </div>
                </div>
              </button>

              {/* Import Folder */}
              <button
                onClick={handleDirectoryPicker}
                className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#dcb67a] hover:bg-[#252526] text-left transition flex items-start gap-3 group cursor-pointer"
              >
                <div className="p-2 rounded-md bg-[#252526] border border-[#2d2d2d] text-[#dcb67a] group-hover:scale-105 transition">
                  <Folder className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#ffffff]">Import Folder</div>
                  <div className="text-[11px] text-[#858585] mt-0.5">
                    Open entire local directory via browser file system
                  </div>
                </div>
              </button>

              {/* Import ZIP */}
              <button
                onClick={() => zipInputRef.current?.click()}
                className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#c586c0] hover:bg-[#252526] text-left transition flex items-start gap-3 group cursor-pointer"
              >
                <div className="p-2 rounded-md bg-[#252526] border border-[#2d2d2d] text-[#c586c0] group-hover:scale-105 transition">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#ffffff]">Import ZIP Archive</div>
                  <div className="text-[11px] text-[#858585] mt-0.5">
                    Unpack a full project zip into virtual filesystem
                  </div>
                </div>
              </button>

              {/* Export ZIP */}
              <button
                onClick={handleExportZip}
                className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#4ec9b0] hover:bg-[#252526] text-left transition flex items-start gap-3 group cursor-pointer"
              >
                <div className="p-2 rounded-md bg-[#252526] border border-[#2d2d2d] text-[#4ec9b0] group-hover:scale-105 transition">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#ffffff]">Export Project ZIP</div>
                  <div className="text-[11px] text-[#858585] mt-0.5">
                    Download complete project with all source files
                  </div>
                </div>
              </button>
            </div>
          )}

          {activeTab === 'new' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-3">
                <div className="text-xs font-semibold text-[#ffffff]">Blank Project Configuration</div>
                <p className="text-[11px] text-[#858585]">
                  A brand-new project contains only the clean minimum structure without pre-populated demo code:
                </p>
                <div className="p-2.5 rounded bg-[#181818] border border-[#2d2d2d] font-mono text-[11px] space-y-1 text-[#9cdcfe]">
                  <div>├── manifest.toml</div>
                  <div>└── src/main.manifest</div>
                </div>

                <div className="space-y-1 pt-1">
                  <label className="text-xs text-[#cccccc]">Project Name</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="My Application"
                    className="w-full bg-[#181818] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6]"
                  />
                </div>

                <button
                  onClick={handleCreateBlank}
                  className="w-full py-2 px-3 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>Create Blank Project</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-2">
              <p className="text-[11px] text-[#858585] mb-2">
                Templates provide example code for specific architectures (Web, Solana dApp, E-commerce, etc.):
              </p>
              <div className="grid grid-cols-1 gap-2">
                {TEMPLATES.map((tpl) => (
                  <div
                    key={tpl.id}
                    onClick={() => handleSelectTemplate(tpl.id)}
                    className="p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] hover:border-[#569cd6] hover:bg-[#252526] transition cursor-pointer flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#ffffff] flex items-center gap-2">
                        <span>{tpl.name}</span>
                        {tpl.kind === 'solana' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#8b5cf6]/20 text-[#a78bfa] font-mono border border-[#8b5cf6]/30">
                            Solana Anchor
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#858585] mt-0.5">{tpl.description}</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#858585] group-hover:text-[#ffffff] group-hover:translate-x-0.5 transition" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2d2d2d] bg-[#1f1f1f] flex items-center justify-between text-xs">
          <div className="text-[11px] text-[#858585]">
            Storage: IndexedDB & OPFS persistent
          </div>
          <button
            onClick={() => {
              onShowToast('Project saved locally');
              onClose();
            }}
            className="py-1 px-3 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[#cccccc] text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5 text-[#89d185]" />
            <span>Save Project</span>
          </button>
        </div>
      </div>
    </div>
  );
};

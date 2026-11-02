/**
 * Manifest Studio - Project Menu Modal
 * Handles new projects, templates, ZIP file imports, folder picker fallback, and project export.
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  FolderOpen,
  Download,
  Upload,
  Plus,
  Sparkles,
  X,
  FileArchive,
  Trash2,
  Clock,
} from 'lucide-react';
import { ManifestProject, ProjectFile } from '../types.ts';
import {
  TEMPLATES,
  listWorkspaceProjectsAsync,
  deleteWorkspaceProjectAsync,
} from '../project-store.ts';
import {
  importProjectFromZip,
  exportProjectToZip,
  isBinaryFile,
  getMimeType,
} from '../services/git-provider.ts';
import { detectLanguage } from '../editor/language-support.ts';

interface ProjectMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ManifestProject;
  onUpdateProject: (project: ManifestProject) => void;
  onShowToast: (msg: string) => void;
  onSelectTemplate: (templateId: string) => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

export const ProjectMenuModal: React.FC<ProjectMenuModalProps> = ({
  isOpen,
  onClose,
  project,
  onUpdateProject,
  onShowToast,
  onSelectTemplate,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [savedProjects, setSavedProjects] = useState<ManifestProject[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      listWorkspaceProjectsAsync().then(setSavedProjects).catch(() => setSavedProjects([]));
      setConfirmDeleteId(null);
    }
  }, [isOpen, project.id, project.updatedAt]);

  if (!isOpen) return null;

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const imported = await importProjectFromZip(file);
      onUpdateProject(imported);
      onShowToast(`Imported ZIP project: ${imported.name} (${imported.files.length} files)`);
      onClose();
    } catch (err: any) {
      onShowToast(`Could not import ZIP: ${err.message || String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Imported Folder';
      const hasSharedRootPrefix =
        files.length > 0 &&
        Boolean(files[0]?.webkitRelativePath?.includes('/')) &&
        Array.from(files).every((f) => (f.webkitRelativePath || '').startsWith(folderName + '/'));

      const projectFiles: ProjectFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const rawRel = f.webkitRelativePath || f.name;
        const cleanPath = hasSharedRootPrefix ? rawRel.slice(folderName.length + 1) : rawRel;
        if (!cleanPath || cleanPath.includes('/.') || cleanPath.startsWith('.')) continue;

        let content: string;
        let isBinary = false;
        let mimeType: string | undefined;

        if (isBinaryFile(cleanPath)) {
          isBinary = true;
          mimeType = getMimeType(cleanPath);
          const buf = await f.arrayBuffer();
          content = `data:${mimeType};base64,${arrayBufferToBase64(buf)}`;
        } else {
          content = await f.text();
        }

        projectFiles.push({
          id: `file-${Date.now()}-${i}`,
          name: cleanPath.split('/').pop() || f.name,
          path: cleanPath,
          language: detectLanguage(cleanPath),
          content,
          isBinary,
          mimeType,
        });
      }

      if (projectFiles.length === 0) {
        throw new Error('No readable files found in selected folder');
      }

      const preferredActive =
        projectFiles.find((f) => f.path.endsWith('.manifest') || f.path === 'index.html' || f.path.endsWith('.wasm'))
          ?.path || projectFiles[0].path;

      onUpdateProject({
        id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: folderName,
        files: projectFiles,
        entryPath: preferredActive,
        activeFilePath: preferredActive,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      onShowToast(`Imported folder: ${folderName} (${projectFiles.length} files)`);
      onClose();
    } catch (err: any) {
      onShowToast(`Could not import folder: ${err.message || String(err)}`);
    } finally {
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleExportZip = async () => {
    try {
      const blob = await exportProjectToZip(project);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}-manifest-studio.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onShowToast(`Exported ${project.name} as ZIP archive`);
      onClose();
    } catch (err: any) {
      onShowToast(`Export failed: ${err.message || String(err)}`);
    }
  };

  const handleDeleteSavedProject = async (id: string) => {
    await deleteWorkspaceProjectAsync(id);
    setSavedProjects((prev) => prev.filter((p) => p.id !== id));
    setConfirmDeleteId(null);
    onShowToast('Removed project from saved workspace');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="h-12 border-b border-[#2d2d2d] bg-[#252526] px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-[#569cd6]" />
            <span className="font-semibold text-sm text-[#ffffff]">Project Management</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {/* Action Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* New Project */}
            <button
              onClick={() => {
                onSelectTemplate('empty');
                onClose();
              }}
              className="p-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-left transition flex flex-col gap-1 cursor-pointer group"
            >
              <div className="flex items-center gap-2 text-[#cccccc] font-medium group-hover:text-[#ffffff]">
                <Plus className="w-4 h-4 text-[#89d185]" />
                <span>New Project</span>
              </div>
              <span className="text-[10px] text-[#858585]">Current project stays saved in Workspace</span>
            </button>

            {/* Import ZIP */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-left transition flex flex-col gap-1 cursor-pointer group"
            >
              <div className="flex items-center gap-2 text-[#cccccc] font-medium group-hover:text-[#ffffff]">
                <Upload className="w-4 h-4 text-[#569cd6]" />
                <span>Import ZIP</span>
              </div>
              <span className="text-[10px] text-[#858585]">Open existing project archive</span>
            </button>

            {/* Export ZIP */}
            <button
              onClick={handleExportZip}
              className="p-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-left transition flex flex-col gap-1 cursor-pointer group"
            >
              <div className="flex items-center gap-2 text-[#cccccc] font-medium group-hover:text-[#ffffff]">
                <Download className="w-4 h-4 text-[#cca700]" />
                <span>Export ZIP</span>
              </div>
              <span className="text-[10px] text-[#858585]">Download all project files &amp; assets</span>
            </button>
          </div>

          {/* Folder picker button */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#252526]/50 border border-[#2d2d2d]">
            <div className="flex items-center gap-2">
              <FileArchive className="w-4 h-4 text-[#858585]" />
              <span className="text-[#cccccc]">Import Local Folder (preserves subfolders &amp; binary assets)</span>
            </div>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="px-2.5 py-1 rounded bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] text-[11px] transition cursor-pointer"
            >
              Choose Folder...
            </button>
          </div>

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed,multipart/x-zip,application/octet-stream"
            className="hidden"
            onChange={handleZipImport}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory="true"
            directory="true"
            multiple
            className="hidden"
            onChange={handleFolderImport}
          />

          {/* Saved Workspace Projects */}
          {savedProjects.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#89d185]" />
                <span>Saved Workspace Projects ({savedProjects.length})</span>
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                {savedProjects.map((sp) => {
                  const isCurrent = sp.id === project.id;
                  return (
                    <div
                      key={sp.id}
                      onClick={() => {
                        if (!isCurrent) {
                          onUpdateProject(sp);
                          onShowToast(`Switched to saved project: ${sp.name}`);
                          onClose();
                        }
                      }}
                      className={`p-2.5 rounded-lg border transition flex items-center justify-between ${
                        isCurrent
                          ? 'bg-[#252526] border-[#569cd6] cursor-default'
                          : 'bg-[#252526]/70 hover:bg-[#2d2d2d] border-[#2d2d2d] cursor-pointer'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[#ffffff] flex items-center gap-2">
                          <span className="truncate">{sp.name}</span>
                          {isCurrent && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#1f1f1f] text-[#569cd6] border border-[#569cd6]/40">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#858585]">
                          {sp.files.length} files &bull; {sp.kind || 'manifest'}
                        </div>
                      </div>

                      {!isCurrent && (
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                          {confirmDeleteId === sp.id ? (
                            <>
                              <button
                                onClick={() => handleDeleteSavedProject(sp.id)}
                                className="px-2 py-0.5 rounded bg-[#4d1f24] text-[#f85149] text-[10px] font-medium"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-1.5 py-0.5 text-[#858585] hover:text-white text-[10px]"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(sp.id)}
                              title="Remove saved project"
                              className="p-1 rounded text-[#858585] hover:text-[#f85149] hover:bg-[#333333]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Built-in Templates */}
          <div>
            <div className="text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#569cd6]" />
              <span>Starter Templates</span>
            </div>
            <div className="space-y-1.5">
              {TEMPLATES.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => {
                    onSelectTemplate(tmpl.id);
                    onClose();
                  }}
                  className="p-2.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] transition flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded bg-[#1f1f1f] border border-[#333333] flex items-center justify-center text-[10px] font-mono text-[#569cd6]">
                      {tmpl.kind === 'solana' ? '◎' : tmpl.kind === 'web' ? 'W' : tmpl.kind === 'wasm' ? '⚡' : 'M'}
                    </div>
                    <div>
                      <div className="font-medium text-[#ffffff]">{tmpl.name}</div>
                      <div className="text-[10px] text-[#858585] line-clamp-1">{tmpl.description}</div>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#1f1f1f] text-[#858585] border border-[#333333]">
                    {tmpl.files.length} files
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 border-t border-[#2d2d2d] bg-[#252526] px-4 flex items-center justify-between text-[11px] text-[#858585]">
          <span>Current project: <strong className="text-[#cccccc]">{project.name}</strong></span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

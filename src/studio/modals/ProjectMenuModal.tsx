/**
 * Manifest Studio - Project Menu Modal
 * Handles new projects, templates, ZIP file imports, folder picker fallback, and project export.
 */

import React, { useRef } from 'react';
import {
  FolderOpen,
  Download,
  Upload,
  Plus,
  Sparkles,
  X,
  FileArchive,
  Layers,
} from 'lucide-react';
import { ManifestProject } from '../types.ts';
import { TEMPLATES } from '../project-store.ts';
import { importProjectFromZip, exportProjectToZip } from '../services/git-provider.ts';

interface ProjectMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ManifestProject;
  onUpdateProject: (project: ManifestProject) => void;
  onShowToast: (msg: string) => void;
  onSelectTemplate: (templateId: string) => void;
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
      const projectFiles = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const relativePath = f.webkitRelativePath || f.name;
        if (relativePath.includes('/.') || relativePath.startsWith('.')) continue;

        const content = await f.text();
        projectFiles.push({
          id: `file-${Date.now()}-${i}`,
          name: f.name,
          path: relativePath,
          language: relativePath.endsWith('.manifest') ? 'manifest' : 'plaintext',
          content,
        });
      }

      if (projectFiles.length === 0) {
        throw new Error('No files found in selected folder');
      }

      const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Imported Folder';
      onUpdateProject({
        id: `proj-${Date.now()}`,
        name: folderName,
        files: projectFiles,
        activeFilePath: projectFiles.find((f) => f.path.endsWith('.manifest'))?.path || projectFiles[0].path,
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
              <span className="text-[10px] text-[#858585]">Start from clean minimal blank workspace</span>
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
              <span className="text-[10px] text-[#858585]">Download all project files</span>
            </button>
          </div>

          {/* Folder picker fallback button */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#252526]/50 border border-[#2d2d2d]">
            <div className="flex items-center gap-2">
              <FileArchive className="w-4 h-4 text-[#858585]" />
              <span className="text-[#cccccc]">Import Local Folder</span>
            </div>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="px-2.5 py-1 rounded bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] text-[11px] transition"
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
                      {tmpl.kind === 'solana' ? '◎' : 'M'}
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

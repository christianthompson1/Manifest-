/**
 * Manifest Studio - Project & File Explorer
 * Manages project structure, files, templates, and build artifacts.
 */

import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  Settings,
  Boxes,
} from 'lucide-react';
import { ManifestProject, ProjectFile } from '../types.ts';
import { TEMPLATES } from '../project-store.ts';

interface FileExplorerProps {
  project: ManifestProject;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onSelectTemplate: (templateId: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  project,
  activeFilePath,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onSelectTemplate,
}) => {
  const [isSrcOpen, setIsSrcOpen] = useState(true);
  const [isBuildOpen, setIsBuildOpen] = useState(true);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const srcFiles = project.files.filter((f) => f.path.startsWith('src/'));
  const rootFiles = project.files.filter((f) => !f.path.includes('/'));
  const buildFiles = project.files.filter((f) => f.path.startsWith('build/'));

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    let path = newFileName.trim();
    if (!path.includes('/') && !path.endsWith('.toml')) {
      path = `src/${path}`;
    }
    if (!path.includes('.')) {
      path += '.manifest';
    }
    onCreateFile(path);
    setNewFileName('');
    setIsCreatingFile(false);
  };

  const getFileIcon = (file: ProjectFile) => {
    if (file.language === 'manifest') {
      return <FileCode className="w-3.5 h-3.5 text-emerald-400" />;
    }
    if (file.language === 'toml') {
      return <Settings className="w-3.5 h-3.5 text-sky-400" />;
    }
    if (file.language === 'javascript') {
      return <FileJson className="w-3.5 h-3.5 text-amber-400" />;
    }
    return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div className="w-64 flex-shrink-0 bg-[#181818] border-r border-[#2d2d2d] flex flex-col text-xs font-sans select-none">
      {/* Project Header */}
      <div className="p-3 border-b border-[#2d2d2d]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase font-bold tracking-wider text-[#858585]">
            Current Project
          </span>
          <button
            onClick={() => setIsCreatingFile(true)}
            title="Create New File"
            className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#252526] transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Template / Project Switcher */}
        <select
          value={TEMPLATES.some((t) => t.name === project.name) ? TEMPLATES.find((t) => t.name === project.name)?.id : 'custom'}
          onChange={(e) => onSelectTemplate(e.target.value)}
          className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded px-2 py-1.5 text-xs text-[#cccccc] outline-none cursor-pointer hover:border-[#3c3c3c] transition"
        >
          {TEMPLATES.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              📁 {tpl.name}
            </option>
          ))}
        </select>
      </div>

      {/* New File Inline Form */}
      {isCreatingFile && (
        <form onSubmit={handleCreateSubmit} className="p-2 border-b border-[#2d2d2d] bg-[#1f1f1f]">
          <div className="text-[10px] text-[#858585] mb-1">New file name (e.g. utils.manifest):</div>
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            autoFocus
            placeholder="name.manifest"
            className="w-full bg-[#181818] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-[#ffffff] outline-none focus:border-[#007acc]"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setIsCreatingFile(false);
            }}
          />
          <div className="flex justify-end gap-1 mt-1.5">
            <button
              type="button"
              onClick={() => setIsCreatingFile(false)}
              className="px-2 py-0.5 rounded text-[10px] text-[#858585] hover:text-[#cccccc] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-2 py-0.5 rounded text-[10px] bg-[#007acc] text-[#ffffff] font-medium cursor-pointer hover:bg-[#0062a3]"
            >
              Add
            </button>
          </div>
        </form>
      )}

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {/* Project Root Label */}
        <div className="text-[11px] font-semibold text-[#858585] px-2 py-1 flex items-center gap-1.5">
          <Boxes className="w-3.5 h-3.5 text-[#9cdcfe]" />
          <span>my-app/</span>
        </div>

        {/* Root files (e.g. manifest.toml) */}
        {rootFiles.map((file) => {
          const isSelected = activeFilePath === file.path;
          return (
            <div
              key={file.id}
              onClick={() => onSelectFile(file.path)}
              className={`group flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition cursor-pointer ${
                isSelected
                  ? 'bg-[#04395e] text-[#ffffff] font-medium border border-[#007acc]/40'
                  : 'text-[#cccccc] hover:bg-[#252526]'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                {getFileIcon(file)}
                <span className="truncate">{file.name}</span>
              </div>
            </div>
          );
        })}

        {/* src/ folder */}
        <div>
          <button
            onClick={() => setIsSrcOpen(!isSrcOpen)}
            className="w-full flex items-center gap-1 px-1.5 py-1 text-[#858585] hover:text-[#cccccc] text-xs cursor-pointer font-medium"
          >
            {isSrcOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {isSrcOpen ? <FolderOpen className="w-3.5 h-3.5 text-[#dcb67a]" /> : <Folder className="w-3.5 h-3.5 text-[#dcb67a]" />}
            <span>src/</span>
          </button>

          {isSrcOpen && (
            <div className="pl-4 space-y-0.5">
              {srcFiles.map((file) => {
                const isSelected = activeFilePath === file.path;
                return (
                  <div
                    key={file.id}
                    onClick={() => onSelectFile(file.path)}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#04395e] text-[#ffffff] font-medium border border-[#007acc]/40'
                        : 'text-[#cccccc] hover:bg-[#252526]'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {getFileIcon(file)}
                      <span className="truncate">{file.name}</span>
                    </div>

                    {file.path !== 'src/main.manifest' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFile(file.path);
                        }}
                        title="Delete file"
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-[#858585] hover:text-[#f14c4c] transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* build/ folder (output artifacts) */}
        <div>
          <button
            onClick={() => setIsBuildOpen(!isBuildOpen)}
            className="w-full flex items-center gap-1 px-1.5 py-1 text-[#858585] hover:text-[#cccccc] text-xs cursor-pointer font-medium"
          >
            {isBuildOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {isBuildOpen ? <FolderOpen className="w-3.5 h-3.5 text-[#c586c0]" /> : <Folder className="w-3.5 h-3.5 text-[#c586c0]" />}
            <span>build/</span>
          </button>

          {isBuildOpen && (
            <div className="pl-4 space-y-0.5">
              {buildFiles.length === 0 ? (
                <div className="text-[10px] text-[#858585] px-2 py-1 italic">
                  (Run or Build to generate artifacts)
                </div>
              ) : (
                buildFiles.map((file) => {
                  const isSelected = activeFilePath === file.path;
                  return (
                    <div
                      key={file.id}
                      onClick={() => onSelectFile(file.path)}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#04395e] text-[#ffffff] font-medium border border-[#007acc]/40'
                          : 'text-[#858585] hover:bg-[#252526]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {getFileIcon(file)}
                        <span className="truncate">{file.name}</span>
                      </div>
                      <span className="text-[9px] font-mono text-[#858585] uppercase">Artifact</span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Architecture Spec Info Footer */}
      <div className="p-3 border-t border-[#2d2d2d] text-[10px] text-[#858585] bg-[#181818] space-y-1">
        <div className="flex items-center justify-between text-[#cccccc] font-semibold">
          <span>Target Platform</span>
          <span className="text-[#4ec9b0] font-mono">JavaScript (Web)</span>
        </div>
        <div>Manifest &rarr; IR &rarr; JS Target &rarr; Preview</div>
      </div>
    </div>
  );
};

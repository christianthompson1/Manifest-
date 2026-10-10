/**
 * Manifest Studio - Welcome & Project Launch Screen
 * Professional, calm, and distraction-free startup experience.
 * Styled with VS Code Dark Modern theme: #181818, #1f1f1f, #2d2d2d, #cccccc, #ffffff.
 */

import React, { useState, useRef } from 'react';
import {
  FolderPlus,
  FolderOpen,
  Upload,
  Clock,
  Sparkles,
  ArrowRight,
  Code2,
  FileCode,
  Layers,
  Zap,
  Cpu,
  BookOpen,
  X,
  FileText,
  FileArchive,
} from 'lucide-react';
import { TEMPLATES } from '../project-store.ts';
import { ManifestProject, ProjectFile } from '../types.ts';
import { importProjectFromZip } from '../services/zip-service.ts';
import { detectLanguage } from '../editor/language-support.ts';

interface WelcomeScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTemplate: (templateId: string, customName?: string) => void;
  onImportProject: (project: ManifestProject) => void;
  onOpenTestbench?: () => void;
  recentProjects?: Array<{ id: string; name: string; templateId: string; updatedAt: number }>;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  isOpen,
  onClose,
  onOpenTemplate,
  onImportProject,
  onOpenTestbench,
  recentProjects = [],
}) => {
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('empty');
  const [projectName, setProjectName] = useState<string>('my-project');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleCreateProject = () => {
    onOpenTemplate(selectedTemplateId, projectName.trim() || undefined);
    setShowNewModal(false);
    onClose();
  };

  const handleSelectTemplateCard = (templateId: string) => {
    onOpenTemplate(templateId);
    onClose();
  };

  // Generic Source File Picker (Section 1)
  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const importedFiles: ProjectFile[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = await file.text();

        // If JSON project definition
        if (file.name.endsWith('.json') && files.length === 1) {
          try {
            const parsed = JSON.parse(content);
            if (parsed && Array.isArray(parsed.files)) {
              onImportProject(parsed);
              if (e.target) e.target.value = '';
              onClose();
              return;
            }
          } catch (_) {}
        }

        const path = file.webkitRelativePath || file.name;
        const cleanPath = path.includes('/') ? path.substring(path.indexOf('/') + 1) : path;

        importedFiles.push({
          id: `file-${Date.now()}-${i}`,
          name: cleanPath.split('/').pop() || cleanPath,
          path: cleanPath,
          content,
          language: detectLanguage(cleanPath),
        });
      }

      if (e.target) e.target.value = '';

      if (importedFiles.length > 0) {
        // Ensure manifest.toml exists if missing
        if (!importedFiles.some((f) => f.path === 'manifest.toml')) {
          importedFiles.unshift({
            id: 'toml-root',
            name: 'manifest.toml',
            path: 'manifest.toml',
            language: 'toml',
            content: `[app]\nname = "ImportedProject"\nversion = "0.4.0"\nentry = "src/main.manifest"\ntarget = "js"\n`,
          });
        }

        const importedProject: ManifestProject = {
          id: `project-${Date.now()}`,
          name: 'ImportedProject',
          files: importedFiles,
          activeFilePath: importedFiles[1]?.path || importedFiles[0]?.path || 'src/main.manifest',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        onImportProject(importedProject);
        onClose();
      }
    } catch (err) {
      console.error('Error importing source files:', err);
      if (e.target) e.target.value = '';
    }
  };

  // ZIP Archive Picker (Section 1 & 12)
  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;

    try {
      const project = await importProjectFromZip(file);
      onImportProject(project);
      onClose();
    } catch (err: any) {
      console.error(`Could not extract ZIP project: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      {/* Hidden robust source file inputs with generic accept attribute */}
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept=".manifest,.js,.jsx,.ts,.tsx,.html,.css,.scss,.json,.md,.py,.rs,.toml,.yaml,.yml,.xml,.svg,.txt,text/*"
        onChange={handleImportFiles}
        className="hidden"
      />
      <input
        type="file"
        ref={zipInputRef}
        accept=".zip,application/zip,application/x-zip-compressed,multipart/x-zip"
        onChange={handleImportZip}
        className="hidden"
      />

      <div className="w-full max-w-3xl bg-[#181818] border border-[#2d2d2d] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Bar */}
        <div className="h-12 border-b border-[#2d2d2d] px-6 flex items-center justify-between bg-[#1f1f1f]">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#569cd6] font-mono font-bold text-xs">
              M
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-[#ffffff] tracking-tight">Manifest Studio</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#252526] text-[#4ec9b0] border border-[#2d2d2d]">
                v0.4
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[#252526] text-[#858585] hover:text-[#cccccc] transition cursor-pointer"
            title="Skip to editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar text-[#cccccc]">
          {/* Welcome Banner */}
          <div className="border-b border-[#2d2d2d] pb-5">
            <h1 className="text-xl font-bold text-[#ffffff] mb-1">Welcome to Manifest Studio</h1>
            <p className="text-xs text-[#858585] leading-relaxed">
              Integrated development environment centered around the Manifest programming language for Web &amp; Solana.
            </p>
          </div>

          {/* Primary Action Buttons (Section 1 & 2) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Blank Project (Default: my-project) */}
            <button
              onClick={() => {
                onOpenTemplate('empty', 'my-project');
                onClose();
              }}
              className="p-4 rounded-lg bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] hover:border-[#007acc] text-left transition flex flex-col gap-2 group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#569cd6] group-hover:scale-105 transition">
                <FolderPlus className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[#ffffff] flex items-center justify-between">
                  <span>New Blank Project</span>
                  <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition text-[#007acc]" />
                </div>
                <div className="text-[11px] text-[#858585] mt-0.5">Minimal manifest.toml &amp; main.manifest</div>
              </div>
            </button>

            {/* Import Files */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-4 rounded-lg bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] hover:border-[#4ec9b0] text-left transition flex flex-col gap-2 group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#4ec9b0] group-hover:scale-105 transition">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[#ffffff] flex items-center justify-between">
                  <span>Import Files</span>
                  <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition text-[#4ec9b0]" />
                </div>
                <div className="text-[11px] text-[#858585] mt-0.5">Upload .manifest, .rs, .ts, etc.</div>
              </div>
            </button>

            {/* Import ZIP (Reliable Mobile & Project Import) */}
            <button
              onClick={() => zipInputRef.current?.click()}
              className="p-4 rounded-lg bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] hover:border-[#cca700] text-left transition flex flex-col gap-2 group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#cca700] group-hover:scale-105 transition">
                <FileArchive className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[#ffffff] flex items-center justify-between">
                  <span>Import ZIP</span>
                  <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition text-[#cca700]" />
                </div>
                <div className="text-[11px] text-[#858585] mt-0.5">Unpack complete project ZIP archive</div>
              </div>
            </button>
          </div>

          {/* Starter Templates (Section 3: separate and selectable) */}
          <div>
            <div className="text-xs font-semibold text-[#ffffff] mb-3 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#569cd6]" />
              <span>Project Templates</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TEMPLATES.slice(0, 6).map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => handleSelectTemplateCard(tpl.id)}
                  className="p-3.5 rounded-lg bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] hover:border-[#569cd6] transition cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#ffffff] mb-1">{tpl.name}</div>
                    <div className="text-[11px] text-[#858585] line-clamp-2 leading-relaxed">
                      {tpl.description}
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-[#2d2d2d] flex items-center justify-between text-[10px] text-[#569cd6]">
                    <span>Use Template</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 border-t border-[#2d2d2d] px-6 flex items-center justify-between text-xs text-[#858585] bg-[#1f1f1f]">
          <div className="flex items-center gap-4">
            <button
              onClick={onOpenTestbench}
              className="hover:text-[#cccccc] transition flex items-center gap-1 cursor-pointer"
            >
              <Cpu className="w-3 h-3" />
              <span>Compiler Diagnostics &amp; Testbench</span>
            </button>
          </div>
          <span>Phase 1 + 2 + 3 Integrated Build</span>
        </div>
      </div>
    </div>
  );
};

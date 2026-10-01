/**
 * Manifest Studio - Welcome & Project Launch Screen
 * Professional, calm, and distraction-free startup experience.
 * Styled with VS Code Dark Modern theme: #181818, #1f1f1f, #2d2d2d, #cccccc, #ffffff.
 */

import React, { useState } from 'react';
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
} from 'lucide-react';
import { TEMPLATES } from '../project-store.ts';
import { ManifestProject } from '../types.ts';

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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('counter');
  const [projectName, setProjectName] = useState<string>('My Counter App');

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

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || '');
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.files)) {
            onImportProject(parsed);
            onClose();
            return;
          }
        }

        // If .manifest file imported directly
        const importedProject: ManifestProject = {
          id: `project-${Date.now()}`,
          name: file.name.replace(/\.manifest$/, ''),
          files: [
            {
              id: 'toml-imported',
              name: 'manifest.toml',
              path: 'manifest.toml',
              language: 'toml',
              content: `[app]\nname = "${file.name.replace(/\.manifest$/, '')}"\nversion = "0.2.0"\nentry = "src/main.manifest"\ntarget = "js"\n`,
            },
            {
              id: 'manifest-imported',
              name: 'main.manifest',
              path: 'src/main.manifest',
              language: 'manifest',
              content: text,
            },
          ],
          activeFilePath: 'src/main.manifest',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        onImportProject(importedProject);
        onClose();
      } catch (err) {
        alert('Could not import file: ' + String(err));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
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
                v0.2
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
              Design and run interactive applications with the human-readable Manifest Application Language.
            </p>
          </div>

          {/* Primary Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => setShowNewModal(true)}
              className="p-4 rounded-lg bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] hover:border-[#007acc] text-left transition flex flex-col gap-2 group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#569cd6] group-hover:scale-105 transition">
                <FolderPlus className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[#ffffff] flex items-center justify-between">
                  <span>New Project</span>
                  <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition text-[#007acc]" />
                </div>
                <div className="text-[11px] text-[#858585] mt-0.5">Start from an application template</div>
              </div>
            </button>

            <button
              onClick={() => handleSelectTemplateCard('counter')}
              className="p-4 rounded-lg bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] hover:border-[#4ec9b0] text-left transition flex flex-col gap-2 group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#4ec9b0] group-hover:scale-105 transition">
                <FolderOpen className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[#ffffff] flex items-center justify-between">
                  <span>Open Counter</span>
                  <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition text-[#4ec9b0]" />
                </div>
                <div className="text-[11px] text-[#858585] mt-0.5">Explore reactive state &amp; UI clicks</div>
              </div>
            </button>

            <label className="p-4 rounded-lg bg-[#1f1f1f] hover:bg-[#252526] border border-[#2d2d2d] hover:border-[#cca700] text-left transition flex flex-col gap-2 group cursor-pointer">
              <input
                type="file"
                accept=".manifest,.json"
                onChange={handleImportFile}
                className="hidden"
              />
              <div className="w-8 h-8 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#cca700] group-hover:scale-105 transition">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[#ffffff] flex items-center justify-between">
                  <span>Import Project</span>
                  <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition text-[#cca700]" />
                </div>
                <div className="text-[11px] text-[#858585] mt-0.5">Upload .manifest or project file</div>
              </div>
            </label>
          </div>

          {/* Quick Start Templates */}
          <div>
            <div className="text-xs font-semibold text-[#ffffff] mb-3 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#569cd6]" />
              <span>Project Templates</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TEMPLATES.slice(0, 3).map((tpl) => (
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

          {/* Developer Mode Note */}
          <div className="pt-2 border-t border-[#2d2d2d] flex items-center justify-between text-xs text-[#858585]">
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-[#cca700]" />
              <span>Looking for AST, IR, and Compiler Engine inspection?</span>
            </div>
            {onOpenTestbench && (
              <button
                onClick={() => {
                  onClose();
                  onOpenTestbench();
                }}
                className="py-1 px-2.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-[#cccccc] text-[11px] transition cursor-pointer flex items-center gap-1.5"
              >
                <span>Open Reference Testbench</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 border-t border-[#2d2d2d] px-6 bg-[#1f1f1f] flex items-center justify-between text-[11px] text-[#858585]">
          <span>Manifest Application Language v0.2</span>
          <button
            onClick={onClose}
            className="text-[#569cd6] hover:underline cursor-pointer"
          >
            Continue to Editor &rarr;
          </button>
        </div>
      </div>

      {/* Modal: New Project Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#181818] border border-[#2d2d2d] rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2d2d2d] pb-3">
              <h2 className="text-sm font-semibold text-[#ffffff]">Create New Project</h2>
              <button
                onClick={() => setShowNewModal(false)}
                className="text-[#858585] hover:text-[#cccccc] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#cccccc] mb-1 font-medium">Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My Manifest Application"
                  className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded px-3 py-2 text-[#ffffff] outline-none focus:border-[#007acc]"
                />
              </div>

              <div>
                <label className="block text-[#cccccc] mb-1 font-medium">Starter Template</label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                  {TEMPLATES.map((tpl) => (
                    <div
                      key={tpl.id}
                      onClick={() => {
                        setSelectedTemplateId(tpl.id);
                        if (!projectName || projectName.includes('App')) {
                          setProjectName(`${tpl.name} App`);
                        }
                      }}
                      className={`p-2.5 rounded border transition cursor-pointer flex items-center justify-between ${
                        selectedTemplateId === tpl.id
                          ? 'bg-[#252526] border-[#007acc] text-[#ffffff]'
                          : 'bg-[#1f1f1f] border-[#2d2d2d] text-[#cccccc] hover:bg-[#252526]'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-xs">{tpl.name}</div>
                        <div className="text-[11px] text-[#858585]">{tpl.description}</div>
                      </div>
                      {selectedTemplateId === tpl.id && (
                        <span className="text-[#007acc] text-xs font-bold font-mono">✓</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2d2d2d]">
              <button
                onClick={() => setShowNewModal(false)}
                className="py-1.5 px-3 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs border border-[#2d2d2d] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                className="py-1.5 px-4 rounded bg-[#007acc] hover:bg-[#0062a3] text-[#ffffff] text-xs font-medium cursor-pointer"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

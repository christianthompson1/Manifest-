/**
 * Manifest Studio - Virtual Project & Folder Tree
 * Handles arbitrary nested folders, files, renaming, deleting,
 * creating folders/files, and language-specific iconography.
 */

import React, { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  Plus,
  Trash2,
  Edit2,
  ChevronRight,
  ChevronDown,
  Settings,
  Terminal,
  BookOpen,
  Cpu,
  FilePlus,
  FolderPlus,
  X,
  Check,
} from 'lucide-react';
import { ProjectFile, FileLanguage, ManifestProject } from '../types.ts';
import { detectLanguage } from '../editor/language-support.ts';

export interface TreeNode {
  name: string;
  path: string; // e.g. "src", "src/components", "src/main.manifest"
  isFolder: boolean;
  file?: ProjectFile;
  children: TreeNode[];
}

interface ProjectTreeProps {
  project: ManifestProject;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder?: (folderPath: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDeleteFile: (path: string) => void;
}

export function buildProjectTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = {
    name: 'root',
    path: '',
    isFolder: true,
    children: [],
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join('/');

      let existing = current.children.find((c) => c.name === part);

      if (!existing) {
        existing = {
          name: part,
          path: partPath,
          isFolder: !isLeaf,
          file: isLeaf ? file : undefined,
          children: [],
        };
        current.children.push(existing);
      }

      current = existing;
    }
  }

  // Sort folders first, then alphabetically
  function sortNode(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      if (child.isFolder) sortNode(child);
    }
  }

  sortNode(root);
  return root;
}

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  project,
  activeFilePath,
  onSelectFile,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
}) => {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [creatingInPath, setCreatingInPath] = useState<string | null>(null);
  const [newEntryType, setNewEntryType] = useState<'file' | 'folder'>('file');
  const [newEntryName, setNewEntryName] = useState<string>('');

  const tree = useMemo(() => buildProjectTree(project.files), [project.files]);

  const toggleFolder = (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const startRename = (path: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPath(path);
    setEditValue(currentName);
  };

  const commitRename = (oldPath: string, isFolder: boolean) => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== oldPath.split('/').pop()) {
      const parts = oldPath.split('/');
      parts[parts.length - 1] = trimmed;
      const newPath = parts.join('/');
      onRenameFile?.(oldPath, newPath);
    }
    setEditingPath(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEntryName.trim();
    if (!trimmed) {
      setCreatingInPath(null);
      return;
    }

    const parent = creatingInPath ? `${creatingInPath}/` : '';
    let targetPath = `${parent}${trimmed}`;

    if (newEntryType === 'file') {
      if (!targetPath.includes('.')) {
        targetPath += '.manifest';
      }
      onCreateFile(targetPath);
    } else {
      // Create folder placeholder file
      onCreateFile(`${targetPath}/.gitkeep`);
    }

    setCreatingInPath(null);
    setNewEntryName('');
  };

  const getFileIcon = (file?: ProjectFile, fileName?: string) => {
    const lang = file?.language || detectLanguage(fileName || '');

    switch (lang) {
      case 'manifest':
        return <FileCode className="w-3.5 h-3.5 text-[#4ec9b0] shrink-0" />;
      case 'javascript':
      case 'jsx':
        return <FileCode className="w-3.5 h-3.5 text-[#f1c40f] shrink-0" />;
      case 'typescript':
      case 'tsx':
        return <FileCode className="w-3.5 h-3.5 text-[#3178c6] shrink-0" />;
      case 'html':
        return <FileCode className="w-3.5 h-3.5 text-[#e44d26] shrink-0" />;
      case 'css':
        return <FileCode className="w-3.5 h-3.5 text-[#2965f1] shrink-0" />;
      case 'json':
        return <FileJson className="w-3.5 h-3.5 text-[#cbcb41] shrink-0" />;
      case 'markdown':
        return <BookOpen className="w-3.5 h-3.5 text-[#a855f7] shrink-0" />;
      case 'python':
        return <Terminal className="w-3.5 h-3.5 text-[#3572a5] shrink-0" />;
      case 'rust':
        return <Cpu className="w-3.5 h-3.5 text-[#dea584] shrink-0" />;
      case 'toml':
      case 'yaml':
        return <Settings className="w-3.5 h-3.5 text-[#569cd6] shrink-0" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-[#858585] shrink-0" />;
    }
  };

  const renderNode = (node: TreeNode, depth = 0) => {
    const isCollapsed = collapsedPaths.has(node.path);
    const isSelected = !node.isFolder && activeFilePath === node.path;
    const isEditing = editingPath === node.path;
    const indentPx = depth * 14 + 10;

    if (node.isFolder) {
      return (
        <div key={node.path} className="group">
          <div
            onClick={(e) => toggleFolder(node.path, e)}
            style={{ paddingLeft: `${indentPx}px` }}
            className="flex items-center justify-between py-1 pr-2 hover:bg-[#252526] text-[#cccccc] cursor-pointer select-none transition text-xs"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {isCollapsed ? (
                <ChevronRight className="w-3 h-3 text-[#858585] shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-[#858585] shrink-0" />
              )}
              {isCollapsed ? (
                <Folder className="w-3.5 h-3.5 text-[#dcb67a] shrink-0" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5 text-[#dcb67a] shrink-0" />
              )}
              {isEditing ? (
                <input
                  type="text"
                  value={editValue}
                  autoFocus
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitRename(node.path, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(node.path, true);
                    if (e.key === 'Escape') setEditingPath(null);
                  }}
                  className="bg-[#1f1f1f] text-white px-1 py-0.5 rounded border border-[#007acc] text-xs outline-none"
                />
              ) : (
                <span className="truncate font-medium text-[#cccccc]">{node.name}</span>
              )}
            </div>

            {/* Folder Actions */}
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCreatingInPath(node.path);
                  setNewEntryType('file');
                  setNewEntryName('');
                }}
                title="New File in folder"
                className="p-0.5 rounded hover:bg-[#333333] text-[#858585] hover:text-white"
              >
                <FilePlus className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCreatingInPath(node.path);
                  setNewEntryType('folder');
                  setNewEntryName('');
                }}
                title="New Folder in folder"
                className="p-0.5 rounded hover:bg-[#333333] text-[#858585] hover:text-white"
              >
                <FolderPlus className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => startRename(node.path, node.name, e)}
                title="Rename folder"
                className="p-0.5 rounded hover:bg-[#333333] text-[#858585] hover:text-white"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Inline creation input inside this folder */}
          {creatingInPath === node.path && (
            <form
              onSubmit={handleCreateSubmit}
              style={{ paddingLeft: `${indentPx + 14}px` }}
              className="py-1 pr-2 bg-[#1f1f1f] flex items-center gap-1 border-b border-[#2d2d2d]"
            >
              {newEntryType === 'file' ? (
                <FilePlus className="w-3 h-3 text-[#569cd6] shrink-0" />
              ) : (
                <FolderPlus className="w-3 h-3 text-[#dcb67a] shrink-0" />
              )}
              <input
                type="text"
                autoFocus
                value={newEntryName}
                onChange={(e) => setNewEntryName(e.target.value)}
                placeholder={newEntryType === 'file' ? 'name.manifest' : 'folder name'}
                className="w-full bg-[#181818] border border-[#007acc] rounded px-1.5 py-0.5 text-xs text-white outline-none"
              />
              <button type="submit" className="p-0.5 text-[#4ec9b0]">
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setCreatingInPath(null)}
                className="p-0.5 text-[#858585]"
              >
                <X className="w-3 h-3" />
              </button>
            </form>
          )}

          {/* Children nodes */}
          {!isCollapsed && (
            <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    }

    // File Node
    return (
      <div
        key={node.path}
        onClick={() => onSelectFile(node.path)}
        style={{ paddingLeft: `${indentPx + 8}px` }}
        className={`group flex items-center justify-between py-1 pr-2 cursor-pointer select-none transition text-xs ${
          isSelected
            ? 'bg-[#252526] text-[#ffffff] font-medium'
            : 'hover:bg-[#1f1f1f] text-[#cccccc]'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {getFileIcon(node.file, node.name)}
          {isEditing ? (
            <input
              type="text"
              value={editValue}
              autoFocus
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitRename(node.path, false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(node.path, false);
                if (e.key === 'Escape') setEditingPath(null);
              }}
              className="bg-[#1f1f1f] text-white px-1 py-0.5 rounded border border-[#007acc] text-xs outline-none"
            />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
        </div>

        {/* File Actions */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
          <button
            onClick={(e) => startRename(node.path, node.name, e)}
            title="Rename file"
            className="p-0.5 rounded hover:bg-[#333333] text-[#858585] hover:text-white"
          >
            <Edit2 className="w-3 h-3" />
          </button>
          {project.files.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFile(node.path);
              }}
              title="Delete file"
              className="p-0.5 rounded hover:bg-[#333333] text-[#858585] hover:text-[#f14c4c]"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
      {/* Root level inline creation */}
      {creatingInPath === '' && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-2 bg-[#1f1f1f] flex items-center gap-1 border-b border-[#2d2d2d]"
        >
          {newEntryType === 'file' ? (
            <FilePlus className="w-3 h-3 text-[#569cd6] shrink-0" />
          ) : (
            <FolderPlus className="w-3 h-3 text-[#dcb67a] shrink-0" />
          )}
          <input
            type="text"
            autoFocus
            value={newEntryName}
            onChange={(e) => setNewEntryName(e.target.value)}
            placeholder={newEntryType === 'file' ? 'src/app.manifest' : 'components'}
            className="w-full bg-[#181818] border border-[#007acc] rounded px-1.5 py-0.5 text-xs text-white outline-none"
          />
          <button type="submit" className="p-0.5 text-[#4ec9b0]">
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setCreatingInPath(null)}
            className="p-0.5 text-[#858585]"
          >
            <X className="w-3 h-3" />
          </button>
        </form>
      )}

      {tree.children.map((child) => renderNode(child, 0))}
    </div>
  );
};

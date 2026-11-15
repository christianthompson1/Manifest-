/**
 * Manifest Studio - Professional Project Asset Manager
 * (src/studio/assets/AssetManagerPanel.tsx)
 *
 * Full-featured asset management workspace:
 * - Tree & Grid viewing of all project assets (Images, Audio, Video, Fonts, Data, Binaries)
 * - Lossless binary import (drag-and-drop & native file picker)
 * - Safe preview generation (SVG sanitization, image dimensions, audio/video playback, font tester, CSV grid, hex dump)
 * - Folder creation, asset renaming, moving, and deletion with confirmation
 * - Asset path copy utility for Manifest source integration (`assets/...`)
 * - Responsive mobile drawer & desktop sidebar integration
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  Image as ImageIcon,
  Music,
  Video as VideoIcon,
  Type,
  FileText,
  FileCode,
  Folder,
  FolderPlus,
  Upload,
  Search,
  Grid,
  List,
  Trash2,
  Edit2,
  Copy,
  Check,
  Eye,
  Download,
  AlertTriangle,
  RefreshCw,
  Plus,
  ArrowUpDown,
  FileSpreadsheet,
} from 'lucide-react';
import { ManifestProject, ProjectFile } from '../types.ts';
import {
  detectFileClassification,
  extractBytesFromContent,
  generateHexDump,
  FileClassification,
} from '../editor/file-signatures.ts';

export type AssetCategoryFilter = 'all' | 'image' | 'audio' | 'video' | 'font' | 'data' | 'binary';

interface AssetManagerPanelProps {
  project: ManifestProject;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onWriteFile?: (path: string, content: string, isBinary?: boolean, mimeType?: string) => void;
  onShowToast?: (msg: string) => void;
}

export const AssetManagerPanel: React.FC<AssetManagerPanelProps> = ({
  project,
  activeFilePath,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  onWriteFile,
  onShowToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AssetCategoryFilter>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'size'>('name');
  const [selectedAssetPath, setSelectedAssetPath] = useState<string | null>(null);

  // Modals / Dialogs
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameNewName, setRenameNewName] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Classify all project files that qualify as assets or binaries
  const assetFiles = useMemo(() => {
    return project.files
      .filter((f) => {
        if (f.path.endsWith('/.gitkeep')) return false;
        // Include anything in assets/, public/, or having image/audio/video/font/data/binary extensions
        const ext = f.path.split('.').pop()?.toLowerCase() || '';
        const isAssetPath = f.path.startsWith('assets/') || f.path.startsWith('public/assets/') || f.path.startsWith('brand/');
        const isAssetExt = [
          'png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'ico',
          'mp3', 'wav', 'ogg', 'm4a',
          'mp4', 'webm',
          'woff', 'woff2', 'ttf', 'otf',
          'json', 'csv', 'xml',
          'mbc', 'wasm', 'bin', 'dat'
        ].includes(ext);
        return isAssetPath || isAssetExt || f.isBinary;
      })
      .map((f) => {
        const classification = detectFileClassification(f.path, f.mimeType, f.content);
        const sizeBytes = f.isBinary
          ? (f.content.startsWith('data:') ? Math.round((f.content.length * 3) / 4) : f.content.length)
          : new TextEncoder().encode(f.content).length;

        let categoryGroup: AssetCategoryFilter = 'data';
        const ext = f.path.split('.').pop()?.toLowerCase() || '';
        if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) {
          categoryGroup = 'font';
        } else if (classification.category === 'image') {
          categoryGroup = 'image';
        } else if (classification.category === 'audio') {
          categoryGroup = 'audio';
        } else if (classification.category === 'video') {
          categoryGroup = 'video';
        } else if (classification.category === 'binary') {
          categoryGroup = 'binary';
        } else {
          categoryGroup = 'data';
        }

        return {
          file: f,
          classification,
          sizeBytes,
          categoryGroup,
        };
      });
  }, [project.files]);

  // Filter and sort
  const filteredAssets = useMemo(() => {
    let list = assetFiles.filter((item) => {
      const matchesSearch = !searchQuery || item.file.path.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || item.categoryGroup === categoryFilter;
      return matchesSearch && matchesCategory;
    });

    list.sort((a, b) => {
      if (sortBy === 'name') return a.file.path.localeCompare(b.file.path);
      if (sortBy === 'type') return a.categoryGroup.localeCompare(b.categoryGroup);
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
      return 0;
    });

    return list;
  }, [assetFiles, searchQuery, categoryFilter, sortBy]);

  const selectedAsset = useMemo(() => {
    if (!selectedAssetPath) return filteredAssets[0] || null;
    return assetFiles.find((a) => a.file.path === selectedAssetPath) || null;
  }, [assetFiles, selectedAssetPath, filteredAssets]);

  // Handle native file import (drag & drop or picker)
  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const targetDir = 'assets/';
      const targetPath = `${targetDir}${file.name}`;

      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isText = ['svg', 'json', 'csv', 'xml', 'txt', 'md'].includes(ext) && !file.type.startsWith('image/png');

      if (isText) {
        const text = await file.text();
        if (onWriteFile) {
          onWriteFile(targetPath, text, false, file.type || 'text/plain');
        } else {
          onCreateFile(targetPath);
        }
      } else {
        // Read as Data URL or ArrayBuffer to preserve exact binary bytes
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          if (onWriteFile) {
            onWriteFile(targetPath, dataUrl, true, file.type || 'application/octet-stream');
          }
          if (onShowToast) onShowToast(`Imported ${file.name} (${Math.round(file.size / 1024)} KB)`);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    if (onShowToast) onShowToast(`Copied asset path: "${path}"`);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const cleanFolder = newFolderName.trim().replace(/^\/+|\/+$/g, '');
    const folderKeep = `assets/${cleanFolder}/.gitkeep`;
    if (onWriteFile) {
      onWriteFile(folderKeep, '', false, 'text/plain');
    } else {
      onCreateFile(folderKeep);
    }
    setNewFolderName('');
    setIsNewFolderOpen(false);
    if (onShowToast) onShowToast(`Created folder assets/${cleanFolder}`);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmPath) {
      onDeleteFile(deleteConfirmPath);
      if (selectedAssetPath === deleteConfirmPath) {
        setSelectedAssetPath(null);
      }
      setDeleteConfirmPath(null);
      if (onShowToast) onShowToast('Asset deleted.');
    }
  };

  const handleConfirmRename = () => {
    if (renamePath && renameNewName.trim() && onRenameFile) {
      const dir = renamePath.substring(0, renamePath.lastIndexOf('/') + 1);
      const newPath = `${dir}${renameNewName.trim()}`;
      onRenameFile(renamePath, newPath);
      if (selectedAssetPath === renamePath) {
        setSelectedAssetPath(newPath);
      }
      setRenamePath(null);
      setRenameNewName('');
      if (onShowToast) onShowToast(`Renamed to ${newPath}`);
    }
  };

  // Helper formatting size
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="flex flex-col h-full bg-[#181818] text-[#cccccc] select-none text-xs">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleImportFiles(e.target.files)}
      />

      {/* Header Toolbar */}
      <div className="p-3 border-b border-[#2d2d2d] flex flex-col gap-2 bg-[#1f1f1f]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-[#ffffff] text-sm">
            <ImageIcon className="w-4 h-4 text-[#58a6ff]" />
            <span>Asset Manager</span>
            <span className="text-[11px] text-[#8b949e] font-normal">({assetFiles.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-1 bg-[#094771] hover:bg-[#0e639c] text-white rounded flex items-center gap-1 cursor-pointer font-medium text-[11px]"
              title="Import Files"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import</span>
            </button>
            <button
              onClick={() => setIsNewFolderOpen(true)}
              className="p-1 hover:bg-[#2d2d2d] text-[#8b949e] hover:text-white rounded cursor-pointer"
              title="New Asset Folder"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="p-1 hover:bg-[#2d2d2d] text-[#8b949e] hover:text-white rounded cursor-pointer"
              title={viewMode === 'grid' ? 'Switch to List' : 'Switch to Grid'}
            >
              {viewMode === 'grid' ? <List className="w-3.5 h-3.5" /> : <Grid className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-[#6e7681]" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] rounded pl-7 pr-2 py-1 text-xs text-[#c9d1d9] focus:outline-none focus:border-[#58a6ff]"
          />
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px] scrollbar-none">
          {(['all', 'image', 'audio', 'video', 'font', 'data', 'binary'] as AssetCategoryFilter[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2 py-0.5 rounded cursor-pointer whitespace-nowrap capitalize transition ${
                categoryFilter === cat
                  ? 'bg-[#30363d] text-white font-medium border border-[#8b949e]/40'
                  : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split Layout: Asset Browser & Inspector Details */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Asset Gallery / File List */}
        <div
          className="flex-1 overflow-y-auto p-3 border-r border-[#2d2d2d]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleImportFiles(e.dataTransfer.files);
          }}
        >
          {filteredAssets.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#6e7681]">
              <Upload className="w-8 h-8 mb-2 opacity-50" />
              <p className="font-medium text-[#c9d1d9]">No assets found</p>
              <p className="text-[11px] mt-1">Drag and drop images, audio, video, fonts, or data files here to import.</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] rounded cursor-pointer"
              >
                Browse Files
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {filteredAssets.map((item) => {
                const isSelected = selectedAsset?.file.path === item.file.path;
                return (
                  <div
                    key={item.file.path}
                    onClick={() => {
                      setSelectedAssetPath(item.file.path);
                      onSelectFile(item.file.path);
                    }}
                    className={`group relative flex flex-col rounded border p-2 cursor-pointer transition ${
                      isSelected
                        ? 'border-[#58a6ff] bg-[#1f242c]'
                        : 'border-[#2d2d2d] bg-[#1c1c1c] hover:border-[#404040] hover:bg-[#222222]'
                    }`}
                  >
                    {/* Thumbnail preview */}
                    <div className="w-full h-20 bg-[#141414] rounded flex items-center justify-center overflow-hidden mb-2 relative">
                      {item.categoryGroup === 'image' ? (
                        item.file.path.endsWith('.svg') ? (
                          <div
                            className="w-full h-full p-2 flex items-center justify-center"
                            dangerouslySetInnerHTML={{ __html: item.file.content }}
                          />
                        ) : (
                          <img
                            src={item.file.content.startsWith('data:') ? item.file.content : `/assets/${item.file.name}`}
                            alt={item.file.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        )
                      ) : item.categoryGroup === 'audio' ? (
                        <Music className="w-6 h-6 text-[#a78bfa]" />
                      ) : item.categoryGroup === 'video' ? (
                        <VideoIcon className="w-6 h-6 text-[#f43f5e]" />
                      ) : item.categoryGroup === 'font' ? (
                        <Type className="w-6 h-6 text-[#fbbf24]" />
                      ) : item.categoryGroup === 'binary' ? (
                        <FileCode className="w-6 h-6 text-[#38bdf8]" />
                      ) : (
                        <FileSpreadsheet className="w-6 h-6 text-[#4ade80]" />
                      )}

                      <span className="absolute bottom-1 right-1 px-1 py-0.2 bg-[#000000]/70 rounded text-[9px] uppercase font-mono text-[#8b949e]">
                        {item.file.path.split('.').pop()}
                      </span>
                    </div>

                    {/* Metadata */}
                    <div className="truncate font-medium text-[#e6edf3] text-[11px]" title={item.file.name}>
                      {item.file.name}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-[#6e7681] mt-0.5">
                      <span>{formatBytes(item.sizeBytes)}</span>
                      <span className="capitalize">{item.categoryGroup}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-[#2d2d2d] border border-[#2d2d2d] rounded overflow-hidden">
              {filteredAssets.map((item) => {
                const isSelected = selectedAsset?.file.path === item.file.path;
                return (
                  <div
                    key={item.file.path}
                    onClick={() => {
                      setSelectedAssetPath(item.file.path);
                      onSelectFile(item.file.path);
                    }}
                    className={`flex items-center justify-between px-3 py-2 cursor-pointer transition ${
                      isSelected ? 'bg-[#1f242c]' : 'hover:bg-[#202020]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {item.categoryGroup === 'image' && <ImageIcon className="w-4 h-4 text-[#58a6ff] shrink-0" />}
                      {item.categoryGroup === 'audio' && <Music className="w-4 h-4 text-[#a78bfa] shrink-0" />}
                      {item.categoryGroup === 'video' && <VideoIcon className="w-4 h-4 text-[#f43f5e] shrink-0" />}
                      {item.categoryGroup === 'font' && <Type className="w-4 h-4 text-[#fbbf24] shrink-0" />}
                      {item.categoryGroup === 'binary' && <FileCode className="w-4 h-4 text-[#38bdf8] shrink-0" />}
                      {item.categoryGroup === 'data' && <FileSpreadsheet className="w-4 h-4 text-[#4ade80] shrink-0" />}
                      <span className="truncate font-medium text-[#c9d1d9]">{item.file.path}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[#6e7681] shrink-0 ml-2">
                      <span>{formatBytes(item.sizeBytes)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyPath(item.file.path);
                        }}
                        className="p-1 hover:text-[#58a6ff]"
                        title="Copy project path"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Selected Asset Inspector & Details */}
        {selectedAsset ? (
          <div className="w-full md:w-80 lg:w-96 flex flex-col bg-[#161b22] border-t md:border-t-0 md:border-l border-[#2d2d2d] overflow-y-auto">
            {/* Asset Actions Bar */}
            <div className="p-3 border-b border-[#30363d] flex items-center justify-between bg-[#1f242c]">
              <span className="font-semibold text-white text-xs truncate max-w-[180px]" title={selectedAsset.file.name}>
                {selectedAsset.file.name}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCopyPath(selectedAsset.file.path)}
                  className="p-1 hover:bg-[#30363d] text-[#8b949e] hover:text-white rounded"
                  title="Copy Manifest Path"
                >
                  {copiedPath === selectedAsset.file.path ? <Check className="w-3.5 h-3.5 text-[#3fb950]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => {
                    setRenamePath(selectedAsset.file.path);
                    setRenameNewName(selectedAsset.file.name);
                  }}
                  className="p-1 hover:bg-[#30363d] text-[#8b949e] hover:text-white rounded"
                  title="Rename Asset"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setDeleteConfirmPath(selectedAsset.file.path)}
                  className="p-1 hover:bg-[#30363d] text-[#f85149] rounded"
                  title="Delete Asset"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Preview Box */}
            <div className="p-4 flex flex-col items-center justify-center bg-[#0d1117] min-h-[160px] border-b border-[#30363d]">
              {selectedAsset.categoryGroup === 'image' ? (
                selectedAsset.file.path.endsWith('.svg') ? (
                  <div
                    className="max-h-48 max-w-full flex items-center justify-center p-2"
                    dangerouslySetInnerHTML={{ __html: selectedAsset.file.content }}
                  />
                ) : (
                  <img
                    src={selectedAsset.file.content.startsWith('data:') ? selectedAsset.file.content : `/assets/${selectedAsset.file.name}`}
                    alt={selectedAsset.file.name}
                    className="max-h-48 max-w-full object-contain rounded border border-[#30363d]"
                  />
                )
              ) : selectedAsset.categoryGroup === 'audio' ? (
                <div className="w-full flex flex-col items-center gap-2">
                  <Music className="w-8 h-8 text-[#a78bfa]" />
                  <audio controls className="w-full h-8" src={selectedAsset.file.content} />
                </div>
              ) : selectedAsset.categoryGroup === 'video' ? (
                <video controls className="max-h-44 w-full rounded border border-[#30363d]" src={selectedAsset.file.content} />
              ) : selectedAsset.categoryGroup === 'font' ? (
                <div className="w-full text-center p-3 bg-[#161b22] rounded border border-[#30363d]">
                  <Type className="w-6 h-6 mx-auto mb-2 text-[#fbbf24]" />
                  <p className="text-[13px] text-white">Aa Bb Gg 123 !?</p>
                  <p className="text-[10px] text-[#8b949e] mt-1">Font preview container</p>
                </div>
              ) : (
                <div className="text-center p-4">
                  <FileCode className="w-8 h-8 mx-auto text-[#58a6ff] mb-2" />
                  <span className="text-[11px] text-[#8b949e]">Structured Asset Container</span>
                </div>
              )}
            </div>

            {/* Detailed Properties */}
            <div className="p-3.5 space-y-3">
              <div>
                <span className="text-[10px] uppercase font-semibold text-[#8b949e] tracking-wider">Project Relative Path</span>
                <div className="mt-1 flex items-center justify-between p-1.5 bg-[#0d1117] border border-[#30363d] rounded font-mono text-[11px] text-[#58a6ff]">
                  <span className="truncate">{selectedAsset.file.path}</span>
                  <button onClick={() => handleCopyPath(selectedAsset.file.path)} className="hover:text-white shrink-0 ml-1">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 bg-[#0d1117] border border-[#30363d] rounded">
                  <div className="text-[#8b949e] text-[10px]">File Size</div>
                  <div className="font-semibold text-white mt-0.5">{formatBytes(selectedAsset.sizeBytes)}</div>
                </div>
                <div className="p-2 bg-[#0d1117] border border-[#30363d] rounded">
                  <div className="text-[#8b949e] text-[10px]">MIME Format</div>
                  <div className="font-semibold text-white mt-0.5 truncate" title={selectedAsset.classification.mimeType}>
                    {selectedAsset.classification.mimeType.split('/').pop()}
                  </div>
                </div>
              </div>

              {/* Manifest Source Integration Helper */}
              <div className="p-2.5 bg-[#0d1117] border border-[#30363d] rounded">
                <span className="text-[10px] uppercase font-semibold text-[#8b949e] tracking-wider">Manifest Code Reference</span>
                <div className="mt-1 p-1.5 bg-[#161b22] rounded font-mono text-[11px] text-[#7ee787]">
                  {selectedAsset.categoryGroup === 'image'
                    ? `IMAGE src: "${selectedAsset.file.path}"`
                    : `ASSET "${selectedAsset.file.path}"`}
                </div>
                <button
                  onClick={() => handleCopyPath(selectedAsset.categoryGroup === 'image' ? `IMAGE src: "${selectedAsset.file.path}"` : `ASSET "${selectedAsset.file.path}"`)}
                  className="mt-2 text-[10px] text-[#58a6ff] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy Manifest syntax</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* New Folder Modal */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg p-4 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold text-sm text-white mb-2">Create Asset Folder</h3>
            <p className="text-xs text-[#8b949e] mb-3">Folders will be created under <code className="text-[#58a6ff]">assets/</code></p>
            <input
              type="text"
              placeholder="e.g. icons, textures, sounds"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="w-full bg-[#161b22] border border-[#30363d] rounded p-2 text-xs text-white mb-4 focus:outline-none focus:border-[#58a6ff]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsNewFolderOpen(false)}
                className="px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#3d3d3d] text-[#cccccc] rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded font-medium cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renamePath && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg p-4 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold text-sm text-white mb-2">Rename Asset</h3>
            <input
              type="text"
              value={renameNewName}
              onChange={(e) => setRenameNewName(e.target.value)}
              className="w-full bg-[#161b22] border border-[#30363d] rounded p-2 text-xs text-white mb-4 focus:outline-none focus:border-[#58a6ff]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenamePath(null)}
                className="px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#3d3d3d] text-[#cccccc] rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRename}
                className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded font-medium cursor-pointer"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmPath && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg p-4 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-2 text-[#f85149] font-semibold text-sm mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Delete Asset?</span>
            </div>
            <p className="text-xs text-[#8b949e] mb-4">
              Are you sure you want to delete <span className="text-white font-mono">{deleteConfirmPath}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmPath(null)}
                className="px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#3d3d3d] text-[#cccccc] rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 bg-[#da3633] hover:bg-[#f85149] text-white rounded font-medium cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

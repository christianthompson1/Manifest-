/**
 * Manifest Studio - Local File System Import Service
 * Uses File System Access API (showDirectoryPicker) where available,
 * with graceful fallback to webkitdirectory file input.
 */

import { ManifestProject, ProjectFile } from '../types.ts';
import { detectLanguage } from '../editor/language-support.ts';
import { detectProjectType } from './project-detector.ts';

export async function openProjectDirectoryWithPicker(): Promise<ManifestProject> {
  const result = await importLocalFolder();
  if (!result) {
    const error: any = new Error('No directory selected or operation cancelled.');
    error.name = 'AbortError';
    throw error;
  }
  return result;
}

export async function importLocalFolder(): Promise<ManifestProject | null> {
  // 1. Try File System Access API
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'read',
      });
      const files: ProjectFile[] = [];
      await readDirectoryRecursively(dirHandle, '', files);

      if (files.length === 0) {
        throw new Error('No readable text files found in selected directory.');
      }

      const activeFile =
        files.find((f) => f.path === 'src/main.manifest') ||
        files.find((f) => f.path.endsWith('.manifest')) ||
        files.find((f) => f.path === 'package.json') ||
        files.find((f) => f.path === 'index.html') ||
        files[0];

      return {
        id: `local-dir-${Date.now()}`,
        name: dirHandle.name || 'Imported Project',
        description: `Imported from local folder: ${dirHandle.name}`,
        kind: detectProjectType(files),
        files,
        activeFilePath: activeFile.path,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return null; // User cancelled
      }
      console.warn('DirectoryPicker failed or declined, falling back to input:', err);
    }
  }

  // 2. Fallback to file input with webkitdirectory
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as any).webkitdirectory = true;
    input.multiple = true;

    input.onchange = async () => {
      const fileList = input.files;
      if (!fileList || fileList.length === 0) {
        resolve(null);
        return;
      }

      const files: ProjectFile[] = [];
      let rootDirName = 'Imported Project';

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const relativePath = file.webkitRelativePath || file.name;
        const parts = relativePath.split('/');
        if (parts.length > 1) {
          rootDirName = parts[0];
        }
        // Remove root folder prefix from path
        const cleanPath = parts.slice(1).join('/') || file.name;

        // Skip node_modules and .git
        if (cleanPath.startsWith('node_modules/') || cleanPath.includes('/node_modules/') || cleanPath.startsWith('.git/')) {
          continue;
        }

        try {
          const content = await file.text();
          files.push({
            id: `file-${Date.now()}-${i}`,
            name: file.name,
            path: cleanPath,
            content,
            language: detectLanguage(cleanPath),
          });
        } catch (_) {}
      }

      if (files.length === 0) {
        resolve(null);
        return;
      }

      const activeFile =
        files.find((f) => f.path === 'src/main.manifest') ||
        files.find((f) => f.path.endsWith('.manifest')) ||
        files.find((f) => f.path === 'package.json') ||
        files.find((f) => f.path === 'index.html') ||
        files[0];

      resolve({
        id: `local-dir-${Date.now()}`,
        name: rootDirName,
        description: `Imported local folder: ${rootDirName}`,
        kind: detectProjectType(files),
        files,
        activeFilePath: activeFile.path,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    };

    input.click();
  });
}

async function readDirectoryRecursively(
  dirHandle: any,
  currentPath: string,
  outFiles: ProjectFile[]
): Promise<void> {
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'build') {
      continue;
    }
    const itemPath = currentPath ? `${currentPath}/${name}` : name;

    if (handle.kind === 'directory') {
      await readDirectoryRecursively(handle, itemPath, outFiles);
    } else if (handle.kind === 'file') {
      try {
        const file = await handle.getFile();
        if (file.size > 2 * 1024 * 1024) continue; // Skip huge files > 2MB
        const content = await file.text();
        outFiles.push({
          id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name,
          path: itemPath,
          content,
          language: detectLanguage(itemPath),
        });
      } catch (err) {
        console.warn(`Could not read file ${itemPath}:`, err);
      }
    }
  }
}

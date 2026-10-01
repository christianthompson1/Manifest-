/**
 * Manifest Studio - ZIP Import & Export Service
 * Uses JSZip for robust browser-compatible project archiving and extraction.
 */

import JSZip from 'jszip';
import { ManifestProject, ProjectFile } from '../types.ts';
import { detectLanguage } from '../editor/language-support.ts';
import { detectProjectType } from './project-detector.ts';

export async function exportProjectToZip(project: ManifestProject): Promise<Blob> {
  const zip = new JSZip();

  for (const file of project.files) {
    zip.file(file.path, file.content);
  }

  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return content;
}

export async function exportProjectAsZip(project: ManifestProject, filename?: string): Promise<void> {
  const blob = await exportProjectToZip(project);
  const targetName = filename || `${project.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.zip`;
  triggerDownloadBlob(blob, targetName);
}

export function triggerDownloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export async function importProjectFromZip(file: File): Promise<ManifestProject> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  const projectFiles: ProjectFile[] = [];
  const entries = Object.keys(loadedZip.files);

  for (const relativePath of entries) {
    const entry = loadedZip.files[relativePath];
    if (entry.dir) continue;

    // Filter noise
    if (
      relativePath.startsWith('__MACOSX/') ||
      relativePath.endsWith('.DS_Store') ||
      relativePath.includes('/.git/') ||
      relativePath.startsWith('.git/')
    ) {
      continue;
    }

    try {
      const content = await entry.async('text');
      const cleanPath = relativePath.replace(/^[/\\]+/, '');
      const name = cleanPath.split('/').pop() || cleanPath;

      projectFiles.push({
        id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name,
        path: cleanPath,
        content,
        language: detectLanguage(cleanPath),
      });
    } catch (err) {
      console.warn(`Could not read file from zip: ${relativePath}`, err);
    }
  }

  if (projectFiles.length === 0) {
    throw new Error('The ZIP archive did not contain any readable files.');
  }

  const projectName = file.name.replace(/\.zip$/i, '');
  const activeFile =
    projectFiles.find((f) => f.path === 'src/main.manifest') ||
    projectFiles.find((f) => f.path.endsWith('.manifest')) ||
    projectFiles.find((f) => f.path === 'package.json') ||
    projectFiles.find((f) => f.path === 'index.html') ||
    projectFiles[0];

  return {
    id: `project-zip-${Date.now()}`,
    name: projectName,
    description: `Imported from ${file.name}`,
    kind: detectProjectType(projectFiles),
    files: projectFiles,
    activeFilePath: activeFile.path,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

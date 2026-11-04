/**
 * Manifest Studio - ZIP Import & Export Service
 * Uses JSZip for robust browser-compatible project archiving and extraction.
 */

import JSZip from 'jszip';
import { ManifestProject, ProjectFile } from '../types.ts';
import { detectLanguage } from '../editor/language-support.ts';
import { detectProjectType } from './project-detector.ts';

const BINARY_ZIP_MIME_MAP: Record<string, string> = {
  mbc: 'application/x-manifest-bytecode',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  bin: 'application/octet-stream',
  so: 'application/octet-stream',
};

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function exportProjectToZip(project: ManifestProject): Promise<Blob> {
  const zip = new JSZip();

  for (const file of project.files) {
    const base64Match = file.content.match(/^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/);
    if (
      (file.isBinary ||
        file.path.toLowerCase().endsWith('.wasm') ||
        file.path.toLowerCase().endsWith('.mbc')) &&
      base64Match
    ) {
      zip.file(file.path, base64Match[1].replace(/\s+/g, ''), { base64: true });
    } else {
      zip.file(file.path, file.content);
    }
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

export async function importProjectFromZip(
  file: File | Blob | ArrayBuffer | Uint8Array,
  archiveName?: string
): Promise<ManifestProject> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file as any);

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
      const cleanPath = relativePath.replace(/^[/\\]+/, '');
      const name = cleanPath.split('/').pop() || cleanPath;
      const ext = (name.split('.').pop() || '').toLowerCase();
      const binaryMime = BINARY_ZIP_MIME_MAP[ext];

      if (binaryMime) {
        const bytes = await entry.async('uint8array');
        const b64 = uint8ToBase64(bytes);
        projectFiles.push({
          id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name,
          path: cleanPath,
          content: `data:${binaryMime};base64,${b64}`,
          language: detectLanguage(cleanPath),
          isBinary: true,
        });
      } else {
        const content = await entry.async('text');
        projectFiles.push({
          id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name,
          path: cleanPath,
          content,
          language: detectLanguage(cleanPath),
          isBinary: false,
        });
      }
    } catch (err) {
      console.warn(`Could not read file from zip: ${relativePath}`, err);
    }
  }

  if (projectFiles.length === 0) {
    throw new Error('The ZIP archive did not contain any readable files.');
  }

  const rawName = archiveName || (typeof (file as any)?.name === 'string' ? (file as any).name : 'imported-project.zip');
  const projectName = rawName.replace(/\.zip$/i, '');
  const activeFile =
    projectFiles.find((f) => f.path === 'src/main.manifest') ||
    projectFiles.find((f) => f.path.endsWith('.manifest')) ||
    projectFiles.find((f) => f.path.endsWith('.mbc')) ||
    projectFiles.find((f) => f.path.endsWith('.wasm')) ||
    projectFiles.find((f) => f.path === 'package.json') ||
    projectFiles.find((f) => f.path === 'index.html') ||
    projectFiles[0];

  return {
    id: `project-zip-${Date.now()}`,
    name: projectName,
    description: `Imported from ${rawName}`,
    kind: detectProjectType(projectFiles),
    files: projectFiles,
    activeFilePath: activeFile.path,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

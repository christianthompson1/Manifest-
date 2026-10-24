/**
 * Manifest Studio - Git & GitHub Integration Provider
 * Supports GitHub repository import via REST API (archive zipball & Git Trees API)
 * and ZIP import/export using JSZip.
 */

import JSZip from 'jszip';
import { ManifestProject, ProjectFile } from '../types.ts';
import { detectLanguage } from '../editor/language-support.ts';

export interface GitRepoMeta {
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string;
  stars: number;
  isPrivate?: boolean;
}

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch?: string;
  subpath?: string;
}

export type ImportProgressCallback = (status: {
  phase: 'metadata' | 'downloading' | 'extracting' | 'processing' | 'done' | 'error';
  message: string;
  loaded?: number;
  total?: number;
}) => void;

export interface GitProvider {
  name: string;
  getMetadata(url: string): Promise<GitRepoMeta>;
  importRepository(
    url: string,
    branch?: string,
    onProgress?: ImportProgressCallback
  ): Promise<ManifestProject>;
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'webp', 'avif', 'bmp', 'tiff',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'wav', 'ogg', 'mp4', 'webm',
  'pdf', 'wasm', 'bin', 'so', 'dll', 'dylib', 'zip', 'tar', 'gz'
]);

export function isBinaryFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'ico': return 'image/x-icon';
    case 'svg': return 'image/svg+xml';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'woff': return 'font/woff';
    case 'woff2': return 'font/woff2';
    case 'ttf': return 'font/ttf';
    case 'otf': return 'font/otf';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'ogg': return 'audio/ogg';
    case 'mp4': return 'video/mp4';
    case 'pdf': return 'application/pdf';
    case 'wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

/**
 * Safely parse common GitHub URL forms:
 * - https://github.com/OWNER/REPO
 * - https://github.com/OWNER/REPO/tree/BRANCH
 * - https://github.com/OWNER/REPO/tree/BRANCH/SUBPATH
 * - https://github.com/OWNER/REPO/blob/BRANCH/PATH
 * - OWNER/REPO
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  if (!url || typeof url !== 'string') return null;
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  const standardMatch = cleaned.match(
    /^(?:https?:\/\/(?:www\.)?github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/(tree|blob)\/(.+))?$/i
  );
  if (!standardMatch) return null;

  const owner = standardMatch[1];
  const repo = standardMatch[2];
  const rest = standardMatch[4];

  if (!rest) {
    return { owner, repo };
  }

  return {
    owner,
    repo,
    branch: rest,
  };
}

export function getStoredGitHubToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  // Prefer sessionStorage for security against persistent token theft
  const sessionToken = sessionStorage.getItem('manifest_github_pat');
  if (sessionToken) return sessionToken.trim();

  // Migrate legacy localStorage if present
  const localToken = localStorage.getItem('manifest_github_pat');
  if (localToken) {
    sessionStorage.setItem('manifest_github_pat', localToken.trim());
    localStorage.removeItem('manifest_github_pat');
    return localToken.trim();
  }
  return undefined;
}

export function setStoredGitHubToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (!token) {
    sessionStorage.removeItem('manifest_github_pat');
    localStorage.removeItem('manifest_github_pat');
  } else {
    sessionStorage.setItem('manifest_github_pat', token.trim());
    localStorage.removeItem('manifest_github_pat');
  }
}

export class GitHubProvider implements GitProvider {
  public readonly name = 'GitHub';
  private token?: string;
  private fetchFn: typeof fetch;

  constructor(token?: string, customFetch?: typeof fetch) {
    this.fetchFn = customFetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (fetch as any));
    if (token) {
      this.token = token.trim();
    } else {
      this.token = getStoredGitHubToken();
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Manifest-Studio/1.0',
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  public async getMetadata(url: string): Promise<GitRepoMeta> {
    const parsed = parseGitHubUrl(url);
    if (!parsed) throw new Error('Invalid GitHub repository URL');

    const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
    let res: Response;
    try {
      res = await this.fetchFn(apiUrl, { headers: this.getHeaders() });
    } catch (err: any) {
      throw new Error(`Network failure connecting to GitHub API: ${err.message || String(err)}`);
    }

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        throw new Error('GitHub API rate limit exceeded. Please configure a GitHub Personal Access Token in settings.');
      }
      if (res.status === 401) {
        throw new Error('Invalid or expired GitHub Personal Access Token.');
      }
      if (res.status === 404) {
        throw new Error(
          this.token
            ? 'Repository not found. Please verify the owner and repository name.'
            : 'Repository not found or is private. If private, configure a GitHub Personal Access Token.'
        );
      }
      throw new Error(`GitHub error: HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      owner: data.owner?.login || parsed.owner,
      repo: data.name || parsed.repo,
      defaultBranch: parsed.branch || data.default_branch || 'main',
      description: data.description || '',
      stars: data.stargazers_count || 0,
      isPrivate: Boolean(data.private),
    };
  }

  public async importRepository(
    url: string,
    specificBranch?: string,
    onProgress?: ImportProgressCallback
  ): Promise<ManifestProject> {
    onProgress?.({ phase: 'metadata', message: 'Fetching repository metadata...' });
    const meta = await this.getMetadata(url);
    const branch = specificBranch || meta.defaultBranch;

    // 1. Prefer downloading repository archive (zipball)
    try {
      onProgress?.({ phase: 'downloading', message: `Downloading repository archive (${branch})...` });
      const zipUrl = `https://api.github.com/repos/${meta.owner}/${meta.repo}/zipball/${encodeURIComponent(branch)}`;
      const zipRes = await this.fetchFn(zipUrl, {
        headers: this.getHeaders(),
        redirect: 'follow',
      });

      if (zipRes.ok) {
        onProgress?.({ phase: 'extracting', message: 'Extracting archive contents...' });
        const arrayBuf = await zipRes.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuf);
        const files: ProjectFile[] = [];

        const entries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);
        let processed = 0;
        const total = entries.length;

        for (const [relativePath, zipEntry] of entries) {
          // Strip top-level directory GitHub adds in zipballs (e.g., owner-repo-sha/)
          const parts = relativePath.split('/');
          parts.shift();
          const cleanPath = parts.join('/');
          if (!cleanPath || cleanPath.startsWith('.') || cleanPath.includes('/.')) continue;

          let content: string;
          let isBinary = false;
          let mimeType: string | undefined;

          if (isBinaryFile(cleanPath)) {
            isBinary = true;
            mimeType = getMimeType(cleanPath);
            const base64 = await zipEntry.async('base64');
            content = `data:${mimeType};base64,${base64}`;
          } else {
            content = await zipEntry.async('string');
          }

          const fileName = cleanPath.split('/').pop() || cleanPath;
          files.push({
            id: `gh-${Math.random().toString(36).slice(2, 9)}`,
            name: fileName,
            path: cleanPath,
            language: detectLanguage(cleanPath),
            content,
            isBinary,
            mimeType,
          });

          processed++;
          if (processed % 10 === 0 || processed === total) {
            onProgress?.({
              phase: 'processing',
              message: `Processed ${processed}/${total} files...`,
              loaded: processed,
              total,
            });
          }
        }

        if (files.length > 0) {
          onProgress?.({ phase: 'done', message: `Successfully imported ${files.length} files.` });
          return {
            id: `proj-${Date.now()}`,
            name: meta.repo,
            description: meta.description,
            files,
            activeFilePath: files.find((f) => f.path.endsWith('.manifest'))?.path || files[0].path,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        }
      }
    } catch (err: any) {
      // Fall through to Git Trees API
    }

    // 2. Fall back to Git Trees API with pagination & full file fetching
    onProgress?.({ phase: 'downloading', message: 'Fetching Git Trees API...' });
    const treeApiUrl = `https://api.github.com/repos/${meta.owner}/${meta.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const treeRes = await this.fetchFn(treeApiUrl, {
      headers: this.getHeaders(),
    });

    if (!treeRes.ok) {
      if (treeRes.status === 403 || treeRes.status === 429) {
        throw new Error('GitHub API rate limit exceeded during tree retrieval. Please configure a GitHub Token.');
      }
      if (treeRes.status === 404) {
        throw new Error(`Branch or tree '${branch}' not found in repository.`);
      }
      throw new Error(`Failed to load repository tree: HTTP ${treeRes.status}`);
    }

    const treeData = await treeRes.json();
    const treeItems = (treeData.tree || []).filter(
      (item: any) => item.type === 'blob' && !item.path.startsWith('.') && !item.path.includes('/.')
    );

    if (treeItems.length > 1000) {
      throw new Error(`Repository too large (${treeItems.length} files). Maximum allowed files for direct import is 1000.`);
    }

    const files: ProjectFile[] = [];
    let loaded = 0;
    const totalFiles = treeItems.length;

    for (const item of treeItems) {
      const cleanPath = item.path;
      const isBin = isBinaryFile(cleanPath);
      let content = '';
      let mimeType: string | undefined;

      // Use GitHub Git Blobs API if SHA is present to support binary and text
      if (item.sha) {
        const blobUrl = `https://api.github.com/repos/${meta.owner}/${meta.repo}/git/blobs/${item.sha}`;
        const blobRes = await this.fetchFn(blobUrl, { headers: this.getHeaders() });
        if (blobRes.ok) {
          const blobData = await blobRes.json();
          if (blobData.encoding === 'base64') {
            const rawBase64 = (blobData.content || '').replace(/\s+/g, '');
            if (isBin) {
              mimeType = getMimeType(cleanPath);
              content = `data:${mimeType};base64,${rawBase64}`;
            } else {
              try {
                content = typeof atob !== 'undefined' ? decodeURIComponent(escape(atob(rawBase64))) : Buffer.from(rawBase64, 'base64').toString('utf-8');
              } catch {
                content = typeof atob !== 'undefined' ? atob(rawBase64) : Buffer.from(rawBase64, 'base64').toString('utf-8');
              }
            }
          }
        }
      }

      // Raw content fallback if blob failed or returned empty
      if (!content && !isBin) {
        const rawUrl = `https://raw.githubusercontent.com/${meta.owner}/${meta.repo}/${encodeURIComponent(branch)}/${cleanPath}`;
        const rawRes = await this.fetchFn(rawUrl);
        if (rawRes.ok) {
          content = await rawRes.text();
        }
      }

      const fileName = cleanPath.split('/').pop() || cleanPath;
      files.push({
        id: `gh-${Math.random().toString(36).slice(2, 9)}`,
        name: fileName,
        path: cleanPath,
        language: detectLanguage(cleanPath),
        content,
        isBinary: isBin,
        mimeType,
      });

      loaded++;
      if (loaded % 5 === 0 || loaded === totalFiles) {
        onProgress?.({
          phase: 'processing',
          message: `Fetched ${loaded}/${totalFiles} files...`,
          loaded,
          total: totalFiles,
        });
      }
    }

    onProgress?.({ phase: 'done', message: `Successfully imported ${files.length} files.` });
    return {
      id: `proj-${Date.now()}`,
      name: meta.repo,
      description: meta.description,
      files,
      activeFilePath: files.find((f) => f.path.endsWith('.manifest'))?.path || files[0]?.path || 'src/main.manifest',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export async function importProjectFromZip(file: File | Blob, projectName?: string): Promise<ManifestProject> {
  const zip = await JSZip.loadAsync(file);
  const files: ProjectFile[] = [];

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    if (relativePath.startsWith('__MACOSX/') || relativePath.includes('/.')) continue;

    let content: string;
    let isBinary = false;
    let mimeType: string | undefined;

    if (isBinaryFile(relativePath)) {
      isBinary = true;
      mimeType = getMimeType(relativePath);
      const base64 = await zipEntry.async('base64');
      content = `data:${mimeType};base64,${base64}`;
    } else {
      content = await zipEntry.async('string');
    }

    const fileName = relativePath.split('/').pop() || relativePath;
    files.push({
      id: `file-${Math.random().toString(36).slice(2, 9)}`,
      name: fileName,
      path: relativePath,
      language: detectLanguage(relativePath),
      content,
      isBinary,
      mimeType,
    });
  }

  if (files.length === 0) {
    throw new Error('No readable files found in ZIP archive.');
  }

  const projName = projectName || ((file as any).name ? (file as any).name.replace(/\.zip$/i, '') : 'Imported Project');
  return {
    id: `proj-${Date.now()}`,
    name: projName,
    files,
    activeFilePath: files.find((f) => f.path.endsWith('.manifest'))?.path || files[0].path,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function exportProjectToZip(project: ManifestProject): Promise<Blob> {
  const zip = new JSZip();
  for (const f of project.files) {
    if (f.isBinary && f.content.startsWith('data:')) {
      const base64Data = f.content.split(',')[1];
      if (base64Data) {
        zip.file(f.path, base64Data, { base64: true });
        continue;
      }
    }
    zip.file(f.path, f.content);
  }
  return await zip.generateAsync({ type: 'blob' });
}

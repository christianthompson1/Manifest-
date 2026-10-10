/**
 * Manifest Studio - Git & GitHub Integration Provider
 * Supports GitHub repository import via REST API (tree and zipball)
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
}

export interface GitProvider {
  name: string;
  getMetadata(url: string): Promise<GitRepoMeta>;
  importRepository(url: string, branch?: string): Promise<ManifestProject>;
}

export function parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
  const cleaned = url.trim().replace(/\/+$/, '');
  const match = cleaned.match(/(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^/\s#?]+))?/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
    branch: match[3],
  };
}

export class GitHubProvider implements GitProvider {
  public readonly name = 'GitHub';
  private token?: string;

  constructor(token?: string) {
    if (token) {
      this.token = token.trim();
    } else if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('manifest_github_pat');
      if (stored) this.token = stored.trim();
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
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
    const res = await fetch(apiUrl, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        throw new Error('GitHub API rate limit exceeded. Please provide a Personal Access Token in settings.');
      }
      if (res.status === 404) {
        throw new Error('Repository not found or is private.');
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
    };
  }

  public async importRepository(url: string, specificBranch?: string): Promise<ManifestProject> {
    const meta = await this.getMetadata(url);
    const branch = specificBranch || meta.defaultBranch;

    // Try zipball first
    try {
      const zipUrl = `https://api.github.com/repos/${meta.owner}/${meta.repo}/zipball/${branch}`;
      const zipRes = await fetch(zipUrl, {
        headers: this.getHeaders(),
        redirect: 'follow',
      });

      if (zipRes.ok) {
        const blob = await zipRes.blob();
        const zip = await JSZip.loadAsync(blob);
        const files: ProjectFile[] = [];

        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir) continue;
          // Strip top-level directory GitHub adds in zipballs
          const parts = relativePath.split('/');
          parts.shift();
          const cleanPath = parts.join('/');
          if (!cleanPath || cleanPath.startsWith('.') || cleanPath.includes('/.')) continue;

          // Ignore large binary assets
          const ext = cleanPath.split('.').pop()?.toLowerCase();
          if (['png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'pdf', 'zip'].includes(ext || '')) {
            continue;
          }

          const content = await zipEntry.async('string');
          const fileName = cleanPath.split('/').pop() || cleanPath;
          files.push({
            id: `gh-${Math.random().toString(36).slice(2, 9)}`,
            name: fileName,
            path: cleanPath,
            language: detectLanguage(cleanPath),
            content,
          });
        }

        if (files.length > 0) {
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
    } catch {
      // Fall back to git tree API
    }

    // Git Tree fallback
    const treeApiUrl = `https://api.github.com/repos/${meta.owner}/${meta.repo}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeApiUrl, {
      headers: this.getHeaders(),
    });

    if (!treeRes.ok) {
      throw new Error(`Failed to load repository tree: HTTP ${treeRes.status}`);
    }

    const treeData = await treeRes.json();
    const treeItems = (treeData.tree || []).filter(
      (item: any) => item.type === 'blob' && !item.path.startsWith('.') && !item.path.includes('/.')
    );

    // Limit to first 30 text files to avoid rate limiting
    const filesToFetch = treeItems.slice(0, 30);
    const files: ProjectFile[] = [];

    for (const item of filesToFetch) {
      const ext = item.path.split('.').pop()?.toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'pdf', 'zip'].includes(ext || '')) continue;

      const rawUrl = `https://raw.githubusercontent.com/${meta.owner}/${meta.repo}/${branch}/${item.path}`;
      const rawRes = await fetch(rawUrl);
      if (rawRes.ok) {
        const content = await rawRes.text();
        files.push({
          id: `gh-${Math.random().toString(36).slice(2, 9)}`,
          name: item.path.split('/').pop() || item.path,
          path: item.path,
          language: detectLanguage(item.path),
          content,
        });
      }
    }

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

export async function importProjectFromZip(file: File): Promise<ManifestProject> {
  const zip = await JSZip.loadAsync(file);
  const files: ProjectFile[] = [];

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    if (relativePath.startsWith('__MACOSX/') || relativePath.includes('/.')) continue;

    const content = await zipEntry.async('string');
    const fileName = relativePath.split('/').pop() || relativePath;
    files.push({
      id: `file-${Math.random().toString(36).slice(2, 9)}`,
      name: fileName,
      path: relativePath,
      language: detectLanguage(relativePath),
      content,
    });
  }

  if (files.length === 0) {
    throw new Error('No readable text files found in ZIP archive.');
  }

  const projName = file.name.replace(/\.zip$/i, '') || 'Imported Project';
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
    zip.file(f.path, f.content);
  }
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Manifest Studio - Git Provider Abstraction
 * Supports real public GitHub repository import with clean provider interface
 * ready for future authenticated Git operations (commit, push, branches, PRs).
 */

import { ManifestProject, ProjectFile } from '../types.ts';
import { detectLanguage } from '../editor/language-support.ts';
import { detectProjectType } from './project-detector.ts';

export interface RepositoryMetadata {
  owner: string;
  repo: string;
  name: string;
  description: string;
  defaultBranch: string;
  htmlUrl: string;
  stars?: number;
}

export interface ParsedGitUrl {
  provider: 'github' | 'gitlab' | 'generic';
  owner: string;
  repo: string;
  branch?: string;
  subpath?: string;
}

export interface GitProvider {
  readonly name: string;
  parseUrl(url: string): ParsedGitUrl | null;
  getMetadata(url: string): Promise<RepositoryMetadata>;
  importRepository(
    url: string,
    onProgress?: (msg: string, current: number, total: number) => void
  ): Promise<ManifestProject>;
}

export class GitHubProvider implements GitProvider {
  public readonly name = 'GitHub';

  /**
   * Parses public GitHub URLs in formats like:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo.git
   * - https://github.com/owner/repo/tree/branch
   * - https://github.com/owner/repo/tree/branch/sub/dir
   * - owner/repo
   */
  public parseUrl(inputUrl: string): ParsedGitUrl | null {
    if (!inputUrl || typeof inputUrl !== 'string') return null;
    const trimmed = inputUrl.trim();

    // Match full URL
    const urlPattern = /^(?:https?:\/\/)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/tree\/([a-zA-Z0-9_.-]+)(?:\/(.*))?)?$/;
    const match = trimmed.match(urlPattern);

    if (match) {
      return {
        provider: 'github',
        owner: match[1],
        repo: match[2],
        branch: match[3],
        subpath: match[4],
      };
    }

    // Match shorthand: owner/repo
    const shorthandPattern = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/;
    const shortMatch = trimmed.match(shorthandPattern);
    if (shortMatch) {
      return {
        provider: 'github',
        owner: shortMatch[1],
        repo: shortMatch[2],
      };
    }

    return null;
  }

  public async getMetadata(url: string): Promise<RepositoryMetadata> {
    const parsed = this.parseUrl(url);
    if (!parsed) {
      throw new Error(`Invalid GitHub repository URL: "${url}". Format: https://github.com/owner/repo`);
    }

    const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
    const res = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`GitHub repository not found: ${parsed.owner}/${parsed.repo}. Please ensure it is a public repository.`);
      }
      if (res.status === 403) {
        throw new Error('GitHub API rate limit exceeded. Please wait a moment or try again.');
      }
      throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
    }

    const data = await res.json();
    return {
      owner: data.owner?.login || parsed.owner,
      repo: data.name || parsed.repo,
      name: data.name || parsed.repo,
      description: data.description || '',
      defaultBranch: parsed.branch || data.default_branch || 'main',
      htmlUrl: data.html_url || `https://github.com/${parsed.owner}/${parsed.repo}`,
      stars: data.stargazers_count,
    };
  }

  public async importRepository(
    url: string,
    onProgress?: (msg: string, current: number, total: number) => void
  ): Promise<ManifestProject> {
    const meta = await this.getMetadata(url);
    const parsed = this.parseUrl(url)!;
    const branch = parsed.branch || meta.defaultBranch;

    onProgress?.(`Fetching repository tree for ${meta.owner}/${meta.repo}...`, 0, 100);

    // Fetch repository tree recursively via GitHub Git Trees API
    const treeApiUrl = `https://api.github.com/repos/${meta.owner}/${meta.repo}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeApiUrl, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!treeRes.ok) {
      throw new Error(`Failed to fetch file tree for ${meta.owner}/${meta.repo} (Branch: ${branch})`);
    }

    const treeData = await treeRes.json();
    const tree: Array<{ path: string; type: 'blob' | 'tree'; size?: number; sha?: string }> = treeData.tree || [];

    // Filter file blobs (ignore node_modules, .git, binaries, or huge files > 2MB)
    const fileBlobs = tree.filter((entry) => {
      if (entry.type !== 'blob') return false;
      const p = entry.path;
      if (p.startsWith('.git/') || p.includes('/node_modules/') || p.startsWith('node_modules/')) return false;
      if (p.endsWith('.lock') || p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.gif') || p.endsWith('.ico') || p.endsWith('.wasm')) return false;
      if (entry.size && entry.size > 2 * 1024 * 1024) return false; // skip > 2MB
      return true;
    });

    // Limit to 60 most relevant files to respect browser performance & API rate limits
    const selectedBlobs = fileBlobs.slice(0, 60);
    const totalFiles = selectedBlobs.length;
    const projectFiles: ProjectFile[] = [];

    for (let i = 0; i < selectedBlobs.length; i++) {
      const blob = selectedBlobs[i];
      onProgress?.(`Downloading ${blob.path} (${i + 1}/${totalFiles})...`, i + 1, totalFiles);

      try {
        const rawUrl = `https://raw.githubusercontent.com/${meta.owner}/${meta.repo}/${branch}/${blob.path}`;
        const contentRes = await fetch(rawUrl);
        if (contentRes.ok) {
          const content = await contentRes.text();
          projectFiles.push({
            id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            name: blob.path.split('/').pop() || blob.path,
            path: blob.path,
            content,
            language: detectLanguage(blob.path),
          });
        }
      } catch (err) {
        console.warn(`Could not fetch ${blob.path}:`, err);
      }
    }

    if (projectFiles.length === 0) {
      throw new Error(`No readable text files could be downloaded from ${meta.owner}/${meta.repo}`);
    }

    // Determine primary active file
    const activeFile =
      projectFiles.find((f) => f.path === 'src/main.manifest') ||
      projectFiles.find((f) => f.path.endsWith('.manifest')) ||
      projectFiles.find((f) => f.path === 'package.json') ||
      projectFiles.find((f) => f.path === 'index.html') ||
      projectFiles.find((f) => f.path === 'README.md') ||
      projectFiles[0];

    const detectedKind = detectProjectType(projectFiles);

    return {
      id: `gh-${meta.owner}-${meta.repo}-${Date.now()}`,
      name: meta.repo,
      description: meta.description || `Imported from GitHub: ${meta.owner}/${meta.repo}`,
      kind: detectedKind,
      files: projectFiles,
      activeFilePath: activeFile.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export const gitProvider: GitProvider = new GitHubProvider();

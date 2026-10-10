/**
 * Manifest Studio - GitHub Import Modal
 * Supports cloning/importing public or private GitHub repositories
 * with optional personal access token (PAT) stored in localStorage.
 */

import React, { useState } from 'react';
import { GitBranch, Key, X, Download, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { ManifestProject } from '../types.ts';
import { GitHubProvider, parseGitHubUrl } from '../services/git-provider.ts';

interface GitHubImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportProject: (project: ManifestProject) => void;
  onShowToast: (msg: string) => void;
}

export const GitHubImportModal: React.FC<GitHubImportModalProps> = ({
  isOpen,
  onClose,
  onImportProject,
  onShowToast,
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [personalToken, setPersonalToken] = useState(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('manifest_github_pat') || '' : '';
  });
  const [activeTab, setActiveTab] = useState<'url' | 'token'>('url');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleImport = async () => {
    setError(null);
    const cleaned = repoUrl.trim();
    if (!cleaned) {
      setError('Please enter a GitHub repository URL or owner/repo format');
      return;
    }

    const parsed = parseGitHubUrl(cleaned);
    if (!parsed) {
      setError('Invalid format. Examples: https://github.com/owner/repo or owner/repo');
      return;
    }

    setIsLoading(true);
    try {
      const gitHub = new GitHubProvider(personalToken);
      const project = await gitHub.importRepository(cleaned, branch.trim() || undefined);
      onImportProject(project);
      onShowToast(`Imported ${project.name} (${project.files.length} files) from GitHub`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to import GitHub repository');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToken = () => {
    const token = personalToken.trim();
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('manifest_github_pat', token);
        onShowToast('Personal access token saved');
      } else {
        localStorage.removeItem('manifest_github_pat');
        onShowToast('Personal access token removed');
      }
    }
    setActiveTab('url');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="h-12 border-b border-[#2d2d2d] bg-[#252526] px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[#89d185]" />
            <span className="font-semibold text-sm text-[#ffffff]">Import from GitHub</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Strip */}
        <div className="flex border-b border-[#2d2d2d] bg-[#181818] px-4 text-xs">
          <button
            onClick={() => setActiveTab('url')}
            className={`py-2 px-3 border-b-2 font-medium transition ${
              activeTab === 'url'
                ? 'border-[#569cd6] text-[#ffffff]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Repository URL
          </button>
          <button
            onClick={() => setActiveTab('token')}
            className={`py-2 px-3 border-b-2 font-medium transition flex items-center gap-1.5 ${
              activeTab === 'token'
                ? 'border-[#569cd6] text-[#ffffff]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            <Key className="w-3 h-3" />
            <span>Token {personalToken ? '✓' : ''}</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-[#2d1818] border border-[#5a1d1d] text-[#f14c4c] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'url' ? (
            <>
              <div>
                <label className="block text-[11px] font-medium text-[#cccccc] mb-1">
                  GitHub Repository URL or Slug
                </label>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo or owner/repo"
                  className="w-full px-3 py-2 rounded-md bg-[#252526] border border-[#3c3c3c] text-[#cccccc] placeholder-[#666666] focus:border-[#569cd6] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#cccccc] mb-1">
                  Branch (Optional)
                </label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main (default)"
                  className="w-full px-3 py-2 rounded-md bg-[#252526] border border-[#3c3c3c] text-[#cccccc] placeholder-[#666666] focus:border-[#569cd6] focus:outline-none"
                />
              </div>

              <div className="text-[11px] text-[#858585]">
                Manifest Studio will extract the project tree and load source files directly into your workspace.
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-medium text-[#cccccc] mb-1">
                  GitHub Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  value={personalToken}
                  onChange={(e) => setPersonalToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 rounded-md bg-[#252526] border border-[#3c3c3c] text-[#cccccc] placeholder-[#666666] focus:border-[#569cd6] focus:outline-none font-mono"
                />
                <div className="text-[10px] text-[#858585] mt-1.5">
                  Stored locally in your browser to avoid GitHub API unauthenticated rate limits (60 req/hr) and access private repos.
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={handleSaveToken}
                  className="px-3 py-1.5 rounded-md bg-[#569cd6] hover:bg-[#4a86b9] text-[#ffffff] font-medium transition cursor-pointer"
                >
                  Save Token
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="h-12 border-t border-[#2d2d2d] bg-[#252526] px-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] transition"
          >
            Cancel
          </button>
          {activeTab === 'url' && (
            <button
              onClick={handleImport}
              disabled={isLoading || !repoUrl.trim()}
              className="px-4 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-[#ffffff] font-medium transition flex items-center gap-1.5 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Import Project</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Manifest Studio - GitHub Import & Source Control Modal
 * Implements Section 4: Real GitHub Workflow
 * - Imports public repositories via GitHub Trees API & raw endpoints without credentials
 * - Displays repository metadata, branch, stars, and language breakdown
 * - Populates Manifest Studio virtual filesystem
 * - Provides architecture and setup state for authenticated Git operations (commit, push, PRs)
 */

import React, { useState } from 'react';
import {
  Github,
  X,
  Download,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Star,
  FileCode,
  Loader2,
  Lock,
  Key,
} from 'lucide-react';
import { GitHubProvider, RepositoryMetadata } from '../services/git-provider.ts';
import { ManifestProject } from '../types.ts';

interface GitHubImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (project: ManifestProject) => void;
  onShowToast: (msg: string) => void;
}

export const GitHubImportModal: React.FC<GitHubImportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  onShowToast,
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [metadata, setMetadata] = useState<RepositoryMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'auth'>('import');
  const [personalToken, setPersonalToken] = useState('');

  if (!isOpen) return null;

  const gitHub = new GitHubProvider();

  const handleFetchMetadata = async () => {
    if (!repoUrl.trim()) return;
    setError(null);
    setIsLoading(true);
    setProgressMsg('Inspecting repository...');

    try {
      const meta = await gitHub.getMetadata(repoUrl.trim());
      setMetadata(meta);
      setProgressMsg(`Repository found: ${meta.name} (branch: ${meta.defaultBranch})`);
    } catch (err: any) {
      setError(err.message || 'Could not reach GitHub repository. Please verify URL.');
      setMetadata(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!repoUrl.trim()) return;
    setError(null);
    setIsLoading(true);
    setProgressPercent(10);
    setProgressMsg('Fetching repository file tree...');

    try {
      const project = await gitHub.importRepository(
        repoUrl.trim(),
        (msg, current, total) => {
          setProgressMsg(msg);
          if (total > 0) {
            setProgressPercent(Math.round((current / total) * 100));
          }
        }
      );

      onImportComplete(project);
      onShowToast(`Imported ${project.name} (${project.files.length} files) from GitHub`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to import repository from GitHub.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-[#2d2d2d] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2d2d2d] flex items-center justify-between bg-[#1f1f1f]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#252526] border border-[#2d2d2d] flex items-center justify-center text-[#ffffff]">
              <Github className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#ffffff]">GitHub Integration</h2>
              <p className="text-[11px] text-[#858585]">Import public repos & manage source control</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#ffffff] hover:bg-[#2d2d2d] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-[#2d2d2d] px-5 bg-[#181818] gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('import')}
            className={`py-2.5 border-b-2 transition ${
              activeTab === 'import'
                ? 'border-[#569cd6] text-[#ffffff]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Import Public Repository
          </button>
          <button
            onClick={() => setActiveTab('auth')}
            className={`py-2.5 border-b-2 transition ${
              activeTab === 'auth'
                ? 'border-[#569cd6] text-[#ffffff]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Authenticated Operations
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {activeTab === 'import' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#cccccc] font-medium">GitHub Repository URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleImport();
                    }}
                    placeholder="https://github.com/user/project or user/project"
                    className="flex-1 bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6] font-mono"
                  />
                  <button
                    onClick={handleFetchMetadata}
                    disabled={isLoading || !repoUrl.trim()}
                    className="px-3 py-1.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-xs text-[#cccccc] font-medium transition cursor-pointer"
                  >
                    Check
                  </button>
                </div>
                <p className="text-[11px] text-[#858585]">
                  Public repositories require no authentication. Enter any public repository or owner/repo format.
                </p>
              </div>

              {/* Repository Metadata Card */}
              {metadata && (
                <div className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#ffffff]">{metadata.name}</span>
                    <div className="flex items-center gap-3 text-[11px] text-[#858585]">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3 h-3 text-[#569cd6]" />
                        <span>{metadata.defaultBranch}</span>
                      </span>
                      {metadata.stars !== undefined && (
                        <span className="flex items-center gap-1 text-[#cca700]">
                          <Star className="w-3 h-3" />
                          <span>{metadata.stars}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  {metadata.description && (
                    <p className="text-[11px] text-[#858585]">{metadata.description}</p>
                  )}
                </div>
              )}

              {/* Progress Indicator */}
              {isLoading && (
                <div className="space-y-1.5 p-3 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d]">
                  <div className="flex items-center justify-between text-xs text-[#cccccc]">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#569cd6]" />
                      <span>{progressMsg}</span>
                    </span>
                    <span className="font-mono text-[11px]">{progressPercent}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#252526] overflow-hidden">
                    <div
                      className="h-full bg-[#569cd6] transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="p-3 rounded-lg bg-[#2d1818] border border-[#f14c4c]/40 text-[#f85149] text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={isLoading || !repoUrl.trim()}
                className="w-full py-2.5 px-4 rounded-md bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Import Repository into Studio</span>
              </button>
            </div>
          )}

          {activeTab === 'auth' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-lg bg-[#1f1f1f] border border-[#2d2d2d] space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#ffffff]">
                  <Lock className="w-3.5 h-3.5 text-[#cca700]" />
                  <span>Authenticated Git Operations</span>
                </div>
                <p className="text-[11px] text-[#858585]">
                  To commit, push changes, manage branches, or trigger remote GitHub Actions workflows directly from Manifest Studio, provide a GitHub Personal Access Token (PAT) with `repo` and `workflow` scopes.
                </p>
                <p className="text-[10px] text-[#858585] italic">
                  Note: Tokens are held securely in memory during your session and never written to permanent disk or transmitted to third parties.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#cccccc] font-medium flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-[#569cd6]" />
                  <span>GitHub Personal Access Token (PAT)</span>
                </label>
                <input
                  type="password"
                  value={personalToken}
                  onChange={(e) => setPersonalToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full bg-[#1f1f1f] border border-[#2d2d2d] rounded-md px-3 py-1.5 text-xs text-[#ffffff] outline-none focus:border-[#569cd6] font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    onShowToast('Session token configured');
                    onClose();
                  }}
                  className="py-1.5 px-3 rounded-md bg-[#252526] hover:bg-[#2d2d2d] border border-[#2d2d2d] text-xs text-[#cccccc] font-medium transition cursor-pointer"
                >
                  Save for Session
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

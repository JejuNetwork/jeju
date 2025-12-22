'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  GitPullRequest,
  ArrowLeft,
  GitBranch,
  ChevronDown,
  ArrowRight,
  Loader2,
  Send,
  AlertCircle,
  CheckCircle,
  FileCode,
  Plus,
  Minus,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useRepo, useCreatePullRequest } from '../../../../../../hooks';

export default function NewPullRequestPage() {
  const params = useParams();
  const router = useRouter();
  const { isConnected } = useAccount();
  const owner = params.owner as string;
  const repo = params.repo as string;

  const { repo: repoData, isLoading: repoLoading } = useRepo(owner, repo);
  const createPR = useCreatePullRequest(owner, repo);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('main');
  const [isDraft, setIsDraft] = useState(false);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);

  const branches = repoData?.branches || ['main'];
  const canMerge = sourceBranch && targetBranch && sourceBranch !== targetBranch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !canMerge) return;

    const result = await createPR.mutateAsync({
      title,
      body,
      head: sourceBranch,
      base: targetBranch,
      draft: isDraft,
    });

    if (result) {
      router.push(`/git/${owner}/${repo}/pulls/${result.number}`);
    }
  };

  if (repoLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/git/${owner}/${repo}`}
            className="text-factory-400 hover:text-factory-300 text-sm inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {owner}/{repo}
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <GitPullRequest className="w-7 h-7 text-green-400" />
            Open a Pull Request
          </h1>
        </div>

        {/* Branch Selection */}
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-4">
            {/* Target Branch */}
            <div className="relative">
              <button
                onClick={() => setShowTargetDropdown(!showTargetDropdown)}
                className="flex items-center gap-2 px-3 py-2 bg-factory-800 rounded-lg text-sm"
              >
                <GitBranch className="w-4 h-4 text-factory-400" />
                <span className="text-factory-200">base:</span>
                <span className="text-factory-100 font-medium">{targetBranch}</span>
                <ChevronDown className="w-4 h-4 text-factory-400" />
              </button>
              {showTargetDropdown && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-factory-900 border border-factory-700 rounded-lg shadow-xl z-10">
                  {branches.map(branch => (
                    <button
                      key={branch}
                      onClick={() => {
                        setTargetBranch(branch);
                        setShowTargetDropdown(false);
                      }}
                      className={clsx(
                        'w-full text-left px-3 py-2 text-sm hover:bg-factory-800',
                        branch === targetBranch && 'bg-factory-800 text-accent-400'
                      )}
                    >
                      {branch}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ArrowRight className="w-5 h-5 text-factory-500" />

            {/* Source Branch */}
            <div className="relative">
              <button
                onClick={() => setShowSourceDropdown(!showSourceDropdown)}
                className="flex items-center gap-2 px-3 py-2 bg-factory-800 rounded-lg text-sm"
              >
                <GitBranch className="w-4 h-4 text-factory-400" />
                <span className="text-factory-200">compare:</span>
                <span className="text-factory-100 font-medium">{sourceBranch || 'Select branch'}</span>
                <ChevronDown className="w-4 h-4 text-factory-400" />
              </button>
              {showSourceDropdown && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-factory-900 border border-factory-700 rounded-lg shadow-xl z-10">
                  {branches.filter(b => b !== targetBranch).map(branch => (
                    <button
                      key={branch}
                      onClick={() => {
                        setSourceBranch(branch);
                        setShowSourceDropdown(false);
                      }}
                      className={clsx(
                        'w-full text-left px-3 py-2 text-sm hover:bg-factory-800',
                        branch === sourceBranch && 'bg-factory-800 text-accent-400'
                      )}
                    >
                      {branch}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />

            {canMerge ? (
              <span className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                Able to merge
              </span>
            ) : sourceBranch === targetBranch ? (
              <span className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                Cannot merge same branch
              </span>
            ) : (
              <span className="flex items-center gap-2 text-factory-500 text-sm">
                <AlertCircle className="w-4 h-4" />
                Select branches to compare
              </span>
            )}
          </div>
        </div>

        {canMerge && (
          <>
            {/* Diff Summary */}
            <div className="card p-4 mb-6">
              <div className="flex items-center gap-6 text-sm">
                <span className="text-factory-400">
                  Comparing changes
                </span>
                <span className="text-green-400">
                  <Plus className="w-4 h-4 inline" /> additions
                </span>
                <span className="text-red-400">
                  <Minus className="w-4 h-4 inline" /> deletions
                </span>
              </div>
              <p className="text-factory-500 text-sm mt-2">
                Files will be shown once you select branches with differences.
              </p>
            </div>

            {/* PR Form */}
            <form onSubmit={handleSubmit}>
              <div className="card p-6">
                {/* Title */}
                <div className="mb-4">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Add a title"
                    className="input text-lg font-medium"
                    required
                  />
                </div>

                {/* Body */}
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={`Add a description...

## Summary
What does this PR do?

## Changes
- Change 1
- Change 2

## Testing
How was this tested?

## Related Issues
Closes #`}
                  rows={12}
                  className="input resize-none font-mono text-sm mb-4"
                />

                {/* Draft Toggle */}
                <label className="flex items-center gap-3 mb-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDraft}
                    onChange={(e) => setIsDraft(e.target.checked)}
                    className="rounded border-factory-600 bg-factory-800 text-accent-500"
                  />
                  <span className="text-factory-300">Create as draft pull request</span>
                  <span className="text-factory-500 text-sm">(mark as not ready for review)</span>
                </label>

                {/* Submit */}
                <div className="flex justify-end gap-3">
                  <Link href={`/git/${owner}/${repo}`} className="btn btn-secondary">
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    disabled={!title.trim() || createPR.isPending || !isConnected}
                    className="btn btn-primary"
                  >
                    {createPR.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        {isDraft ? 'Create draft PR' : 'Create pull request'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

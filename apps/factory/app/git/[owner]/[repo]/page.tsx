/**
 * Repository Detail Page
 * GitHub-like repo view with files, commits, issues, PRs
 */

'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  AlertCircle,
  Star,
  GitFork,
  Code,
  FileText,
  Folder,
  File,
  Download,
  Play,
  Copy,
  Check,
  Globe,
  Tag,
  History,
  Users,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useRepo, useIssues, usePullRequests } from '../../../../hooks';

type RepoTab = 'code' | 'commits' | 'issues' | 'pulls' | 'actions';

export default function RepoDetailPage() {
  const params = useParams();
  const owner = params.owner as string;
  const repo = params.repo as string;
  const [tab, setTab] = useState<RepoTab>('code');
  const [branch] = useState('main');
  const [isStarred, setIsStarred] = useState(false);
  const [copied, setCopied] = useState(false);

  const { repo: repoData, isLoading } = useRepo(owner, repo);
  const { issues } = useIssues(owner, repo, { state: tab === 'issues' ? undefined : 'open' });
  const { pullRequests } = usePullRequests(owner, repo, { state: tab === 'pulls' ? undefined : 'open' });

  const fullName = `${owner}/${repo}`;
  const cloneUrl = `https://git.jejunetwork.org/${fullName}.git`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(cloneUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) return 'Just now';
      return `${hours} hours ago`;
    }
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

  const files = repoData?.files || [];
  const commits = repoData?.commits || [];
  const openIssues = issues.filter(i => i.state === 'open').length;
  const openPRs = pullRequests.filter(pr => pr.state === 'open').length;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-factory-800 bg-factory-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
          {/* Repo Title */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <GitBranch className="w-6 h-6 text-factory-400 flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-semibold text-factory-100 truncate">
                  <Link href={`/git?owner=${owner}`} className="text-accent-400 hover:underline">{owner}</Link>
                  <span className="text-factory-500 mx-1">/</span>
                  <span>{repo}</span>
                </h1>
                <span className="badge bg-factory-700/50 text-factory-400 border border-factory-600 mt-1">
                  <Globe className="w-3 h-3 mr-1" /> {repoData?.isPrivate ? 'Private' : 'Public'}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsStarred(!isStarred)}
                className={clsx(
                  'btn text-sm',
                  isStarred ? 'btn-primary' : 'btn-secondary'
                )}
              >
                <Star className={clsx('w-4 h-4', isStarred && 'fill-current')} />
                <span className="hidden sm:inline">{isStarred ? 'Starred' : 'Star'}</span>
                <span className="ml-1">{repoData?.stars || 0}</span>
              </button>
              <button className="btn btn-secondary text-sm">
                <GitFork className="w-4 h-4" />
                <span className="hidden sm:inline">Fork</span>
                <span className="ml-1">{repoData?.forks || 0}</span>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {([
              { id: 'code' as const, label: 'Code', icon: Code, count: undefined },
              { id: 'commits' as const, label: 'Commits', icon: History, count: commits.length },
              { id: 'issues' as const, label: 'Issues', icon: AlertCircle, count: openIssues },
              { id: 'pulls' as const, label: 'Pull Requests', icon: GitPullRequest, count: openPRs },
              { id: 'actions' as const, label: 'Actions', icon: Play, count: undefined },
            ]).map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  tab === id
                    ? 'border-accent-500 text-accent-400'
                    : 'border-transparent text-factory-400 hover:text-factory-100 hover:border-factory-600'
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
                {count !== undefined && count > 0 && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-factory-800">{count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
        {tab === 'code' && (
          <div className="space-y-4">
            {/* Branch & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <button className="btn btn-secondary text-sm">
                  <GitBranch className="w-4 h-4" />
                  {branch}
                </button>
                <span className="text-factory-500 text-sm">
                  <Tag className="w-4 h-4 inline mr-1" />
                  {repoData?.tags || 0} tags
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <button className="btn btn-primary text-sm">
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Clone</span>
                </button>
              </div>
            </div>

            {/* Clone URL */}
            <div className="card p-3 flex items-center gap-2">
              <code className="flex-1 text-sm text-factory-300 font-mono truncate">
                {cloneUrl}
              </code>
              <button
                onClick={copyToClipboard}
                className="p-2 hover:bg-factory-800 rounded transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-factory-400" />
                )}
              </button>
            </div>

            {/* File Browser */}
            <div className="card overflow-hidden">
              {/* Latest Commit */}
              {commits.length > 0 && (
                <div className="p-3 sm:p-4 bg-factory-800/50 border-b border-factory-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {commits[0].author[0].toUpperCase()}
                    </div>
                    <span className="text-factory-100 text-sm font-medium truncate">{commits[0].author}</span>
                    <span className="text-factory-400 text-sm truncate hidden sm:inline">
                      {commits[0].message}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-factory-500">
                    <GitCommit className="w-4 h-4" />
                    <code className="font-mono">{commits[0].sha.substring(0, 7)}</code>
                    <span className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline">{formatDate(commits[0].date)}</span>
                  </div>
                </div>
              )}

              {/* Files */}
              <div className="divide-y divide-factory-800">
                {files.sort((a, b) => {
                  if (a.type === b.type) return a.name.localeCompare(b.name);
                  return a.type === 'dir' ? -1 : 1;
                }).map((file) => (
                  <Link
                    key={file.path}
                    href={`/git/${fullName}/${file.type === 'dir' ? 'tree' : 'blob'}/${branch}/${file.path}`}
                    className="flex items-center gap-3 p-3 hover:bg-factory-800/50 transition-colors"
                  >
                    {file.type === 'dir' ? (
                      <Folder className="w-5 h-5 text-accent-400" />
                    ) : (
                      <File className="w-5 h-5 text-factory-400" />
                    )}
                    <span className="text-factory-100 hover:text-accent-400 hover:underline">
                      {file.name}
                    </span>
                    <span className="flex-1 text-factory-500 text-sm truncate hidden sm:block">
                      {file.lastCommitMessage}
                    </span>
                    <span className="text-factory-500 text-sm hidden md:block">
                      {file.lastModified && formatDate(file.lastModified)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* README */}
            {repoData?.readme && (
              <div className="card">
                <div className="p-4 border-b border-factory-800">
                  <h3 className="font-semibold text-factory-100 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    README.md
                  </h3>
                </div>
                <div className="p-4 sm:p-6 prose prose-invert max-w-none">
                  <div dangerouslySetInnerHTML={{ __html: repoData.readme }} />
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'commits' && (
          <div className="card divide-y divide-factory-800">
            {commits.length === 0 ? (
              <div className="p-12 text-center">
                <History className="w-12 h-12 mx-auto mb-4 text-factory-600" />
                <p className="text-factory-400">No commits yet</p>
              </div>
            ) : (
              commits.map((commit) => (
                <Link
                  key={commit.sha}
                  href={`/git/${fullName}/commit/${commit.sha}`}
                  className="flex items-center gap-4 p-4 hover:bg-factory-800/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {commit.author[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-factory-100 font-medium truncate">{commit.message}</p>
                    <p className="text-factory-500 text-sm">
                      {commit.author} committed {formatDate(commit.date)}
                    </p>
                  </div>
                  <code className="text-factory-400 font-mono text-sm hidden sm:block">
                    {commit.sha.substring(0, 7)}
                  </code>
                </Link>
              ))
            )}
          </div>
        )}

        {tab === 'issues' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <button className="btn btn-secondary text-sm">Open ({issues.filter(i => i.state === 'open').length})</button>
                <button className="btn btn-ghost text-sm">Closed ({issues.filter(i => i.state === 'closed').length})</button>
              </div>
              <Link href={`/git/${fullName}/issues/new`} className="btn btn-primary text-sm">
                New Issue
              </Link>
            </div>
            
            <div className="card divide-y divide-factory-800">
              {issues.length === 0 ? (
                <div className="p-12 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4 text-factory-600" />
                  <p className="text-factory-400">No issues yet</p>
                </div>
              ) : (
                issues.map((issue) => (
                  <Link
                    key={issue.id}
                    href={`/git/${fullName}/issues/${issue.number}`}
                    className="flex items-start gap-3 p-4 hover:bg-factory-800/50 transition-colors"
                  >
                    <AlertCircle className={clsx(
                      'w-5 h-5 flex-shrink-0 mt-0.5',
                      issue.state === 'open' ? 'text-green-400' : 'text-purple-400'
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-factory-100">{issue.title}</span>
                        {issue.labels.map((label) => (
                          <span
                            key={label.name}
                            className="px-2 py-0.5 text-xs rounded-full"
                            style={{ backgroundColor: `#${label.color}20`, color: `#${label.color}` }}
                          >
                            {label.name}
                          </span>
                        ))}
                      </div>
                      <p className="text-factory-500 text-sm mt-1">
                        #{issue.number} opened {formatDate(issue.createdAt)} by {issue.author.login}
                      </p>
                    </div>
                    <span className="text-factory-500 text-sm flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      {issue.comments}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'pulls' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <button className="btn btn-secondary text-sm">Open ({pullRequests.filter(pr => pr.state === 'open').length})</button>
                <button className="btn btn-ghost text-sm">Merged ({pullRequests.filter(pr => pr.state === 'merged').length})</button>
              </div>
              <Link href={`/git/${fullName}/pulls/new`} className="btn btn-primary text-sm">
                New Pull Request
              </Link>
            </div>

            {pullRequests.length === 0 ? (
              <div className="card p-12 text-center">
                <GitPullRequest className="w-12 h-12 mx-auto mb-4 text-factory-600" />
                <h3 className="text-lg font-medium text-factory-300 mb-2">No pull requests yet</h3>
                <p className="text-factory-500 mb-4">Create a pull request to propose changes</p>
                <Link href={`/git/${fullName}/compare`} className="btn btn-primary">
                  New Pull Request
                </Link>
              </div>
            ) : (
              <div className="card divide-y divide-factory-800">
                {pullRequests.map((pr) => (
                  <Link
                    key={pr.id}
                    href={`/git/${fullName}/pulls/${pr.number}`}
                    className="flex items-start gap-3 p-4 hover:bg-factory-800/50 transition-colors"
                  >
                    <GitPullRequest className={clsx(
                      'w-5 h-5 flex-shrink-0 mt-0.5',
                      pr.state === 'open' ? 'text-green-400' : pr.state === 'merged' ? 'text-purple-400' : 'text-red-400'
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-factory-100">{pr.title}</span>
                        {pr.draft && (
                          <span className="badge bg-gray-500/20 text-gray-400 text-xs">Draft</span>
                        )}
                      </div>
                      <p className="text-factory-500 text-sm mt-1">
                        #{pr.number} by {pr.author.login} • {pr.head.ref} → {pr.base.ref}
                      </p>
                    </div>
                    <span className="text-factory-500 text-sm">{formatDate(pr.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'actions' && (
          <div className="card p-12 text-center">
            <Play className="w-12 h-12 mx-auto mb-4 text-factory-600" />
            <h3 className="text-lg font-medium text-factory-300 mb-2">Actions coming soon</h3>
            <p className="text-factory-500">CI/CD workflows will be available here</p>
          </div>
        )}
      </div>
    </div>
  );
}

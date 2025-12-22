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
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

type RepoTab = 'code' | 'commits' | 'issues' | 'pulls' | 'actions';

interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  sha: string;
  lastCommit?: {
    message: string;
    date: number;
  };
}

interface Commit {
  sha: string;
  message: string;
  author: string;
  date: number;
  avatar?: string;
}

interface Issue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: string;
  labels: { name: string; color: string }[];
  comments: number;
  createdAt: number;
}

const mockFiles: FileEntry[] = [
  { name: '.github', type: 'dir', sha: 'abc123', lastCommit: { message: 'Update CI workflow', date: Date.now() - 2 * 24 * 60 * 60 * 1000 } },
  { name: 'src', type: 'dir', sha: 'def456', lastCommit: { message: 'Add new features', date: Date.now() - 1 * 24 * 60 * 60 * 1000 } },
  { name: 'test', type: 'dir', sha: 'ghi789', lastCommit: { message: 'Add test cases', date: Date.now() - 3 * 24 * 60 * 60 * 1000 } },
  { name: '.gitignore', type: 'file', size: 234, sha: 'jkl012', lastCommit: { message: 'Initial commit', date: Date.now() - 30 * 24 * 60 * 60 * 1000 } },
  { name: 'LICENSE', type: 'file', size: 1067, sha: 'mno345', lastCommit: { message: 'Add MIT license', date: Date.now() - 30 * 24 * 60 * 60 * 1000 } },
  { name: 'README.md', type: 'file', size: 4521, sha: 'pqr678', lastCommit: { message: 'Update documentation', date: Date.now() - 4 * 60 * 60 * 1000 } },
  { name: 'package.json', type: 'file', size: 2134, sha: 'stu901', lastCommit: { message: 'Bump version to 1.2.0', date: Date.now() - 6 * 60 * 60 * 1000 } },
  { name: 'tsconfig.json', type: 'file', size: 567, sha: 'vwx234', lastCommit: { message: 'Configure strict mode', date: Date.now() - 7 * 24 * 60 * 60 * 1000 } },
];

const mockCommits: Commit[] = [
  { sha: 'a1b2c3d', message: 'feat: add CI/CD dashboard with workflow visualization', author: 'alice.eth', date: Date.now() - 2 * 60 * 60 * 1000, avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
  { sha: 'e4f5g6h', message: 'fix: resolve caching issue in CDN edge nodes', author: 'bob.eth', date: Date.now() - 5 * 60 * 60 * 1000, avatar: 'https://avatars.githubusercontent.com/u/2?v=4' },
  { sha: 'i7j8k9l', message: 'docs: update API documentation for v2 endpoints', author: 'carol.eth', date: Date.now() - 12 * 60 * 60 * 1000, avatar: 'https://avatars.githubusercontent.com/u/3?v=4' },
  { sha: 'm0n1o2p', message: 'refactor: migrate to new DWS storage backend', author: 'alice.eth', date: Date.now() - 24 * 60 * 60 * 1000, avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
  { sha: 'q3r4s5t', message: 'test: add integration tests for bounty contracts', author: 'dave.eth', date: Date.now() - 48 * 60 * 60 * 1000, avatar: 'https://avatars.githubusercontent.com/u/4?v=4' },
];

const mockIssues: Issue[] = [
  { number: 42, title: 'Support multi-token bounty rewards', state: 'open', author: 'alice.eth', labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'bounty', color: '0e8a16' }], comments: 12, createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000 },
  { number: 41, title: 'Guardian slashing mechanism needs review', state: 'open', author: 'bob.eth', labels: [{ name: 'security', color: 'd73a4a' }], comments: 8, createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000 },
  { number: 40, title: 'Add pagination to repository list', state: 'closed', author: 'carol.eth', labels: [{ name: 'bug', color: 'd73a4a' }], comments: 3, createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000 },
];

export default function RepoDetailPage() {
  const params = useParams();
  const owner = params.owner as string;
  const repo = params.repo as string;
  const [tab, setTab] = useState<RepoTab>('code');
  const [branch] = useState('main');
  // const [path, setPath] = useState('');
  const [isStarred, setIsStarred] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // const formatSize = (bytes: number) => {
  //   if (bytes < 1024) return `${bytes} B`;
  //   if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  //   return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  // };

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
                  <Globe className="w-3 h-3 mr-1" /> Public
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
                <span className="ml-1">234</span>
              </button>
              <button className="btn btn-secondary text-sm">
                <GitFork className="w-4 h-4" />
                <span className="hidden sm:inline">Fork</span>
                <span className="ml-1">45</span>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {([
              { id: 'code' as const, label: 'Code', icon: Code, count: undefined },
              { id: 'commits' as const, label: 'Commits', icon: History, count: 156 },
              { id: 'issues' as const, label: 'Issues', icon: AlertCircle, count: 12 },
              { id: 'pulls' as const, label: 'Pull Requests', icon: GitPullRequest, count: 3 },
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
                {count !== undefined && (
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
                  3 tags
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
              <div className="p-3 sm:p-4 bg-factory-800/50 border-b border-factory-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src="https://avatars.githubusercontent.com/u/1?v=4"
                    alt="alice.eth"
                    className="w-6 h-6 rounded-full flex-shrink-0"
                  />
                  <span className="text-factory-100 text-sm font-medium truncate">alice.eth</span>
                  <span className="text-factory-400 text-sm truncate hidden sm:inline">
                    {mockCommits[0].message}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-factory-500">
                  <GitCommit className="w-4 h-4" />
                  <code className="font-mono">{mockCommits[0].sha}</code>
                  <span className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline">{formatDate(mockCommits[0].date)}</span>
                </div>
              </div>

              {/* Files */}
              <div className="divide-y divide-factory-800">
                {mockFiles.sort((a, b) => {
                  if (a.type === b.type) return a.name.localeCompare(b.name);
                  return a.type === 'dir' ? -1 : 1;
                }).map((file) => (
                  <Link
                    key={file.sha}
                    href={`/git/${fullName}/${file.type === 'dir' ? 'tree' : 'blob'}/${branch}/${file.name}`}
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
                      {file.lastCommit?.message}
                    </span>
                    <span className="text-factory-500 text-sm hidden md:block">
                      {file.lastCommit && formatDate(file.lastCommit.date)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* README */}
            <div className="card">
              <div className="p-4 border-b border-factory-800">
                <h3 className="font-semibold text-factory-100 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  README.md
                </h3>
              </div>
              <div className="p-4 sm:p-6 prose prose-invert max-w-none">
                <h1>Factory</h1>
                <p>Developer coordination hub for Jeju Network - bounties, jobs, git, packages, containers, and models.</p>
                <h2>Features</h2>
                <ul>
                  <li>Multi-token bounty rewards with milestone tracking</li>
                  <li>Guardian validator network for quality assurance</li>
                  <li>Decentralized git hosting</li>
                  <li>Package registry with npm compatibility</li>
                  <li>Container registry</li>
                  <li>AI model hub</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {tab === 'commits' && (
          <div className="card divide-y divide-factory-800">
            {mockCommits.map((commit) => (
              <Link
                key={commit.sha}
                href={`/git/${fullName}/commit/${commit.sha}`}
                className="flex items-center gap-4 p-4 hover:bg-factory-800/50 transition-colors"
              >
                <img
                  src={commit.avatar}
                  alt={commit.author}
                  className="w-10 h-10 rounded-full flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-factory-100 font-medium truncate">{commit.message}</p>
                  <p className="text-factory-500 text-sm">
                    {commit.author} committed {formatDate(commit.date)}
                  </p>
                </div>
                <code className="text-factory-400 font-mono text-sm hidden sm:block">
                  {commit.sha}
                </code>
              </Link>
            ))}
          </div>
        )}

        {tab === 'issues' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <button className="btn btn-secondary text-sm">Open (2)</button>
                <button className="btn btn-ghost text-sm">Closed (10)</button>
              </div>
              <Link href={`/git/${fullName}/issues/new`} className="btn btn-primary text-sm">
                New Issue
              </Link>
            </div>
            
            <div className="card divide-y divide-factory-800">
              {mockIssues.map((issue) => (
                <Link
                  key={issue.number}
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
                      #{issue.number} opened {formatDate(issue.createdAt)} by {issue.author}
                    </p>
                  </div>
                  <span className="text-factory-500 text-sm flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {issue.comments}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {tab === 'pulls' && (
          <div className="card p-12 text-center">
            <GitPullRequest className="w-12 h-12 mx-auto mb-4 text-factory-600" />
            <h3 className="text-lg font-medium text-factory-300 mb-2">No pull requests yet</h3>
            <p className="text-factory-500 mb-4">Create a pull request to propose changes</p>
            <Link href={`/git/${fullName}/compare`} className="btn btn-primary">
              New Pull Request
            </Link>
          </div>
        )}

        {tab === 'actions' && (
          <div className="space-y-4">
            <Link href="/ci" className="btn btn-secondary text-sm">
              View All Workflows
            </Link>
            
            <div className="card divide-y divide-factory-800">
              {[
                { name: 'CI', status: 'success', branch: 'main', time: '2h ago' },
                { name: 'Deploy', status: 'success', branch: 'main', time: '2h ago' },
                { name: 'Security Scan', status: 'running', branch: 'feature/x', time: 'Running' },
              ].map((workflow, i) => (
                <div key={i} className="flex items-center gap-4 p-4">
                  {workflow.status === 'success' ? (
                    <Check className="w-5 h-5 text-green-400" />
                  ) : (
                    <Play className="w-5 h-5 text-blue-400 animate-pulse" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-factory-100">{workflow.name}</p>
                    <p className="text-factory-500 text-sm">{workflow.branch}</p>
                  </div>
                  <span className="text-factory-500 text-sm">{workflow.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


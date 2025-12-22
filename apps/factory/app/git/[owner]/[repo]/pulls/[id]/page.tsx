'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  GitPullRequest,
  GitMerge,
  ArrowLeft,
  GitBranch,
  MessageSquare,
  FileCode,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  Send,
  Check,
  X,
  Eye,
  Code,
  Users,
  Tag,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';

type PRTab = 'conversation' | 'commits' | 'files';

const mockPR = {
  id: '45',
  number: 45,
  title: 'Fix contract verification on Base Sepolia',
  body: `## Summary
Fixes the contract verification issue on Base Sepolia testnet.

## Changes
- Fixed constructor argument encoding
- Added retry logic for verification API
- Updated error messages

## Testing
- Tested locally with Base Sepolia
- All existing tests pass

Closes #42`,
  author: { name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4' },
  status: 'open' as 'open' | 'merged' | 'closed',
  isDraft: false,
  sourceBranch: 'fix/verification',
  targetBranch: 'main',
  labels: ['bug fix', 'contracts'],
  reviewers: [
    { id: '1', name: 'alice.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4', status: 'approved' as const },
    { id: '3', name: 'charlie.eth', avatar: 'https://avatars.githubusercontent.com/u/3?v=4', status: 'pending' as const },
  ],
  createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
  checks: {
    passed: 4,
    failed: 0,
    pending: 1,
  },
};

const mockCommits = [
  {
    sha: 'abc1234',
    message: 'fix: constructor argument encoding',
    author: 'bob.eth',
    date: Date.now() - 6 * 60 * 60 * 1000,
  },
  {
    sha: 'def5678',
    message: 'fix: add retry logic for verification API',
    author: 'bob.eth',
    date: Date.now() - 2 * 60 * 60 * 1000,
  },
];

const mockFiles = [
  {
    path: 'src/lib/verify.ts',
    additions: 15,
    deletions: 3,
    hunks: [
      {
        header: '@@ -45,8 +45,20 @@ export async function verifyContract(',
        lines: [
          { type: 'context', content: 'async function encodeConstructorArgs(' },
          { type: 'context', content: '  args: unknown[],' },
          { type: 'deletion', content: '  abi: Abi' },
          { type: 'addition', content: '  abi: Abi,' },
          { type: 'addition', content: '  options: { strict?: boolean } = {}' },
          { type: 'context', content: ') {' },
          { type: 'deletion', content: '  return encodeAbiParameters(abi, args);' },
          { type: 'addition', content: '  const { strict = true } = options;' },
          { type: 'addition', content: '  try {' },
          { type: 'addition', content: '    return encodeAbiParameters(abi, args);' },
          { type: 'addition', content: '  } catch (err) {' },
          { type: 'addition', content: '    if (strict) throw err;' },
          { type: 'addition', content: '    return fallbackEncode(abi, args);' },
          { type: 'addition', content: '  }' },
          { type: 'context', content: '}' },
        ],
      },
    ],
  },
  {
    path: 'src/lib/deploy.ts',
    additions: 8,
    deletions: 2,
    hunks: [
      {
        header: '@@ -120,6 +120,12 @@ export async function deploy(',
        lines: [
          { type: 'context', content: '  const hash = await walletClient.deployContract({' },
          { type: 'context', content: '    abi,' },
          { type: 'context', content: '    bytecode,' },
          { type: 'deletion', content: '    args: constructorArgs,' },
          { type: 'addition', content: '    args: constructorArgs ?? [],' },
          { type: 'addition', content: '    // Ensure proper encoding for verification' },
          { type: 'addition', content: '    ...(verifyOnDeploy && {' },
          { type: 'addition', content: '      metadata: { constructorArgs }' },
          { type: 'addition', content: '    })' },
          { type: 'context', content: '  });' },
        ],
      },
    ],
  },
];

const mockComments = [
  {
    id: '1',
    author: { name: 'alice.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
    body: 'Nice fix! The retry logic looks good. Just one small suggestion - could we add a configurable retry count?',
    createdAt: Date.now() - 4 * 60 * 60 * 1000,
    type: 'review' as const,
    file: 'src/lib/verify.ts',
    line: 52,
  },
  {
    id: '2',
    author: { name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4' },
    body: 'Good point! Added a `maxRetries` option in the latest commit.',
    createdAt: Date.now() - 2 * 60 * 60 * 1000,
    type: 'comment' as const,
  },
];

export default function PullRequestDetailPage() {
  const params = useParams();
  const { isConnected } = useAccount();
  const owner = params.owner as string;
  const repo = params.repo as string;

  const [tab, setTab] = useState<PRTab>('conversation');
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<string[]>(mockFiles.map(f => f.path));

  const toggleFile = (path: string) => {
    setExpandedFiles(prev =>
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    );
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    setNewComment('');
    setIsSubmitting(false);
  };

  // const totalChanges = mockFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/git/${owner}/${repo}`}
            className="text-factory-400 hover:text-factory-300 text-sm inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {owner}/{repo}
          </Link>

          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-factory-100">
                {mockPR.title}
                <span className="text-factory-500 font-normal ml-2">#{mockPR.number}</span>
              </h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className={clsx(
                  'badge flex items-center gap-1',
                  mockPR.status === 'open' && !mockPR.isDraft && 'bg-green-500/20 text-green-400 border-green-500/30',
                  mockPR.isDraft && 'bg-gray-500/20 text-gray-400 border-gray-500/30',
                  mockPR.status === 'merged' && 'bg-purple-500/20 text-purple-400 border-purple-500/30',
                  mockPR.status === 'closed' && 'bg-red-500/20 text-red-400 border-red-500/30',
                )}>
                  {mockPR.isDraft ? (
                    <>Draft</>
                  ) : mockPR.status === 'open' ? (
                    <><GitPullRequest className="w-3.5 h-3.5" /> Open</>
                  ) : mockPR.status === 'merged' ? (
                    <><GitMerge className="w-3.5 h-3.5" /> Merged</>
                  ) : (
                    <><XCircle className="w-3.5 h-3.5" /> Closed</>
                  )}
                </span>
                <span className="text-factory-500 text-sm">
                  <strong className="text-factory-300">{mockPR.author.name}</strong> wants to merge{' '}
                  <code className="bg-factory-800 px-1 rounded">{mockPR.sourceBranch}</code>
                  {' into '}
                  <code className="bg-factory-800 px-1 rounded">{mockPR.targetBranch}</code>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary">
                <Code className="w-4 h-4" />
                Code
              </button>
              <button className="btn btn-primary">
                <GitMerge className="w-4 h-4" />
                Merge
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-factory-800">
          {[
            { id: 'conversation' as const, label: 'Conversation', icon: MessageSquare, count: mockComments.length },
            { id: 'commits' as const, label: 'Commits', icon: GitBranch, count: mockCommits.length },
            { id: 'files' as const, label: 'Files changed', icon: FileCode, count: mockFiles.length },
          ].map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === id
                  ? 'border-accent-500 text-accent-400'
                  : 'border-transparent text-factory-400 hover:text-factory-100'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              <span className="bg-factory-800 px-2 py-0.5 rounded-full text-xs">{count}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-6">
          {/* Main Content */}
          <div className="flex-1">
            {tab === 'conversation' && (
              <div className="space-y-4">
                {/* PR Body */}
                <div className="card">
                  <div className="flex items-center gap-3 p-4 border-b border-factory-800">
                    <img src={mockPR.author.avatar} alt="" className="w-10 h-10 rounded-full" />
                    <div>
                      <span className="font-medium text-factory-200">{mockPR.author.name}</span>
                      <span className="text-factory-500 text-sm ml-2">
                        {formatDistanceToNow(mockPR.createdAt, { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 prose prose-invert max-w-none">
                    <ReactMarkdown>{mockPR.body}</ReactMarkdown>
                  </div>
                </div>

                {/* Comments */}
                {mockComments.map(comment => (
                  <div key={comment.id} className={clsx('card', comment.type === 'review' && 'border-l-4 border-l-yellow-500')}>
                    <div className="flex items-center gap-3 p-4 border-b border-factory-800">
                      <img src={comment.author.avatar} alt="" className="w-10 h-10 rounded-full" />
                      <div>
                        <span className="font-medium text-factory-200">{comment.author.name}</span>
                        {comment.type === 'review' && (
                          <span className="ml-2 badge badge-warning text-xs">Review comment</span>
                        )}
                        <span className="text-factory-500 text-sm ml-2">
                          {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    {comment.file && (
                      <div className="px-4 py-2 bg-factory-800/50 text-sm font-mono text-factory-400">
                        {comment.file}:{comment.line}
                      </div>
                    )}
                    <div className="p-4 prose prose-invert max-w-none">
                      <ReactMarkdown>{comment.body}</ReactMarkdown>
                    </div>
                  </div>
                ))}

                {/* New Comment */}
                <form onSubmit={handleSubmitComment} className="card p-4">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Leave a comment..."
                    rows={4}
                    className="input resize-none mb-3"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!newComment.trim() || isSubmitting || !isConnected}
                      className="btn btn-primary"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Comment
                    </button>
                  </div>
                </form>
              </div>
            )}

            {tab === 'commits' && (
              <div className="card divide-y divide-factory-800">
                {mockCommits.map(commit => (
                  <div key={commit.sha} className="p-4 flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <div className="flex-1">
                      <p className="text-factory-200 font-medium">{commit.message}</p>
                      <p className="text-factory-500 text-sm">
                        {commit.author} committed {formatDistanceToNow(commit.date, { addSuffix: true })}
                      </p>
                    </div>
                    <code className="text-factory-400 text-sm font-mono">{commit.sha}</code>
                  </div>
                ))}
              </div>
            )}

            {tab === 'files' && (
              <div className="space-y-4">
                {/* Stats Bar */}
                <div className="card p-4 flex items-center justify-between">
                  <span className="text-factory-400 text-sm">
                    Showing <strong className="text-factory-100">{mockFiles.length}</strong> changed files with{' '}
                    <strong className="text-green-400">{mockFiles.reduce((s, f) => s + f.additions, 0)} additions</strong> and{' '}
                    <strong className="text-red-400">{mockFiles.reduce((s, f) => s + f.deletions, 0)} deletions</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary text-sm">
                      <Eye className="w-4 h-4" />
                      Viewed
                    </button>
                  </div>
                </div>

                {/* File Diffs */}
                {mockFiles.map(file => (
                  <div key={file.path} className="card overflow-hidden">
                    <button
                      onClick={() => toggleFile(file.path)}
                      className="w-full flex items-center gap-3 p-3 bg-factory-800/50 hover:bg-factory-800 text-left"
                    >
                      {expandedFiles.includes(file.path) ? (
                        <ChevronDown className="w-4 h-4 text-factory-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-factory-400" />
                      )}
                      <FileCode className="w-4 h-4 text-factory-400" />
                      <span className="text-factory-200 font-mono text-sm flex-1">{file.path}</span>
                      <span className="text-green-400 text-sm">+{file.additions}</span>
                      <span className="text-red-400 text-sm">-{file.deletions}</span>
                    </button>

                    {expandedFiles.includes(file.path) && (
                      <div className="overflow-x-auto">
                        {file.hunks.map((hunk, i) => (
                          <div key={i}>
                            <div className="px-4 py-2 bg-blue-500/10 text-blue-400 font-mono text-sm border-t border-factory-800">
                              {hunk.header}
                            </div>
                            <table className="w-full text-sm font-mono">
                              <tbody>
                                {hunk.lines.map((line, j) => (
                                  <tr
                                    key={j}
                                    className={clsx(
                                      line.type === 'addition' && 'bg-green-500/10',
                                      line.type === 'deletion' && 'bg-red-500/10',
                                    )}
                                  >
                                    <td className="w-12 text-center text-factory-500 select-none border-r border-factory-800 px-2">
                                      {line.type === 'deletion' ? '-' : line.type === 'addition' ? '+' : ' '}
                                    </td>
                                    <td className={clsx(
                                      'px-4 py-0.5 whitespace-pre',
                                      line.type === 'addition' && 'text-green-400',
                                      line.type === 'deletion' && 'text-red-400',
                                      line.type === 'context' && 'text-factory-400',
                                    )}>
                                      {line.content}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-64 space-y-4">
            {/* Reviewers */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-factory-300">Reviewers</span>
                <button className="text-factory-500 hover:text-factory-300">
                  <Users className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {mockPR.reviewers.map(reviewer => (
                  <div key={reviewer.id} className="flex items-center gap-2">
                    <img src={reviewer.avatar} alt="" className="w-6 h-6 rounded-full" />
                    <span className="text-sm text-factory-200 flex-1">{reviewer.name}</span>
                    {reviewer.status === 'approved' ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : reviewer.status === 'pending' ? (
                      <Clock className="w-4 h-4 text-yellow-400" />
                    ) : (
                      <X className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Labels */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-factory-300">Labels</span>
                <button className="text-factory-500 hover:text-factory-300">
                  <Tag className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {mockPR.labels.map(label => (
                  <span key={label} className="badge badge-info text-xs">{label}</span>
                ))}
              </div>
            </div>

            {/* Checks */}
            <div className="card p-4">
              <div className="text-sm font-medium text-factory-300 mb-3">Checks</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-factory-300">{mockPR.checks.passed} passed</span>
                </div>
                {mockPR.checks.pending > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-yellow-400" />
                    <span className="text-factory-300">{mockPR.checks.pending} pending</span>
                  </div>
                )}
                {mockPR.checks.failed > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span className="text-factory-300">{mockPR.checks.failed} failed</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



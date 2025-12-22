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
import { usePullRequest, useMergePullRequest, useSubmitReview } from '../../../../../../hooks';

type PRTab = 'conversation' | 'commits' | 'files';

export default function PullRequestDetailPage() {
  const params = useParams();
  const { isConnected } = useAccount();
  const owner = params.owner as string;
  const repo = params.repo as string;
  const prNumber = Number(params.id);

  const { pullRequest, commits, files, reviews, isLoading } = usePullRequest(owner, repo, prNumber);
  const mergePR = useMergePullRequest(owner, repo);
  const submitReview = useSubmitReview(owner, repo, prNumber);

  const [tab, setTab] = useState<PRTab>('conversation');
  const [newComment, setNewComment] = useState('');
  const [expandedFiles, setExpandedFiles] = useState<string[]>([]);

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
    await submitReview.mutateAsync({ body: newComment, event: 'comment' });
    setNewComment('');
  };

  const handleMerge = async () => {
    await mergePR.mutateAsync({ prNumber, method: 'squash' });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

  if (!pullRequest) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-6xl mx-auto">
          <div className="card p-12 text-center">
            <GitPullRequest className="w-12 h-12 mx-auto mb-4 text-factory-600" />
            <p className="text-factory-400">Pull request not found</p>
          </div>
        </div>
      </div>
    );
  }

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
                {pullRequest.title}
                <span className="text-factory-500 font-normal ml-2">#{pullRequest.number}</span>
              </h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className={clsx(
                  'badge flex items-center gap-1',
                  pullRequest.state === 'open' && !pullRequest.draft && 'bg-green-500/20 text-green-400 border-green-500/30',
                  pullRequest.draft && 'bg-gray-500/20 text-gray-400 border-gray-500/30',
                  pullRequest.state === 'merged' && 'bg-purple-500/20 text-purple-400 border-purple-500/30',
                  pullRequest.state === 'closed' && 'bg-red-500/20 text-red-400 border-red-500/30',
                )}>
                  {pullRequest.draft ? (
                    <>Draft</>
                  ) : pullRequest.state === 'open' ? (
                    <><GitPullRequest className="w-3.5 h-3.5" /> Open</>
                  ) : pullRequest.state === 'merged' ? (
                    <><GitMerge className="w-3.5 h-3.5" /> Merged</>
                  ) : (
                    <><XCircle className="w-3.5 h-3.5" /> Closed</>
                  )}
                </span>
                <span className="text-factory-500 text-sm">
                  <strong className="text-factory-300">{pullRequest.author.login}</strong> wants to merge{' '}
                  <code className="bg-factory-800 px-1 rounded">{pullRequest.head.ref}</code>
                  {' into '}
                  <code className="bg-factory-800 px-1 rounded">{pullRequest.base.ref}</code>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary">
                <Code className="w-4 h-4" />
                Code
              </button>
              {pullRequest.state === 'open' && pullRequest.mergeable && (
                <button 
                  onClick={handleMerge}
                  disabled={mergePR.isPending}
                  className="btn btn-primary"
                >
                  {mergePR.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <GitMerge className="w-4 h-4" />
                  )}
                  Merge
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-factory-800">
          {[
            { id: 'conversation' as const, label: 'Conversation', icon: MessageSquare, count: reviews.length },
            { id: 'commits' as const, label: 'Commits', icon: GitBranch, count: commits.length },
            { id: 'files' as const, label: 'Files changed', icon: FileCode, count: files.length },
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
                    <img src={pullRequest.author.avatar} alt="" className="w-10 h-10 rounded-full" />
                    <div>
                      <span className="font-medium text-factory-200">{pullRequest.author.login}</span>
                      <span className="text-factory-500 text-sm ml-2">
                        {formatDistanceToNow(pullRequest.createdAt, { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 prose prose-invert max-w-none">
                    <ReactMarkdown>{pullRequest.body}</ReactMarkdown>
                  </div>
                </div>

                {/* Reviews */}
                {reviews.map(review => (
                  <div key={review.id} className={clsx('card', review.state === 'changes_requested' && 'border-l-4 border-l-red-500')}>
                    <div className="flex items-center gap-3 p-4 border-b border-factory-800">
                      <img src={review.author.avatar} alt="" className="w-10 h-10 rounded-full" />
                      <div>
                        <span className="font-medium text-factory-200">{review.author.login}</span>
                        <span className={clsx('ml-2 badge text-xs',
                          review.state === 'approved' && 'bg-green-500/20 text-green-400',
                          review.state === 'changes_requested' && 'bg-red-500/20 text-red-400',
                          review.state === 'commented' && 'bg-blue-500/20 text-blue-400',
                        )}>
                          {review.state.replace('_', ' ')}
                        </span>
                        <span className="text-factory-500 text-sm ml-2">
                          {formatDistanceToNow(review.submittedAt, { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    {review.body && (
                      <div className="p-4 prose prose-invert max-w-none">
                        <ReactMarkdown>{review.body}</ReactMarkdown>
                      </div>
                    )}
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
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => submitReview.mutate({ body: newComment, event: 'approve' })}
                      disabled={!newComment.trim() || submitReview.isPending || !isConnected}
                      className="btn btn-secondary"
                    >
                      <Check className="w-4 h-4" />
                      Approve
                    </button>
                    <button
                      type="submit"
                      disabled={!newComment.trim() || submitReview.isPending || !isConnected}
                      className="btn btn-primary"
                    >
                      {submitReview.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Comment
                    </button>
                  </div>
                </form>
              </div>
            )}

            {tab === 'commits' && (
              <div className="card divide-y divide-factory-800">
                {commits.map(commit => (
                  <div key={commit.sha} className="p-4 flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <div className="flex-1">
                      <p className="text-factory-200 font-medium">{commit.message}</p>
                      <p className="text-factory-500 text-sm">
                        {commit.author.login} committed {formatDistanceToNow(commit.date, { addSuffix: true })}
                      </p>
                    </div>
                    <code className="text-factory-400 text-sm font-mono">{commit.sha.substring(0, 7)}</code>
                  </div>
                ))}
              </div>
            )}

            {tab === 'files' && (
              <div className="space-y-4">
                {/* Stats Bar */}
                <div className="card p-4 flex items-center justify-between">
                  <span className="text-factory-400 text-sm">
                    Showing <strong className="text-factory-100">{files.length}</strong> changed files with{' '}
                    <strong className="text-green-400">{pullRequest.additions} additions</strong> and{' '}
                    <strong className="text-red-400">{pullRequest.deletions} deletions</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary text-sm">
                      <Eye className="w-4 h-4" />
                      Viewed
                    </button>
                  </div>
                </div>

                {/* File Diffs */}
                {files.map(file => (
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
                      <span className={clsx(
                        'badge text-xs',
                        file.status === 'added' && 'bg-green-500/20 text-green-400',
                        file.status === 'modified' && 'bg-yellow-500/20 text-yellow-400',
                        file.status === 'deleted' && 'bg-red-500/20 text-red-400',
                      )}>
                        {file.status}
                      </span>
                    </button>

                    {expandedFiles.includes(file.path) && file.patch && (
                      <div className="overflow-x-auto">
                        <pre className="p-4 text-sm font-mono text-factory-300 whitespace-pre-wrap">
                          {file.patch}
                        </pre>
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
                {pullRequest.reviewers.map(reviewer => (
                  <div key={reviewer.login} className="flex items-center gap-2">
                    <img src={reviewer.avatar} alt="" className="w-6 h-6 rounded-full" />
                    <span className="text-sm text-factory-200 flex-1">{reviewer.login}</span>
                    {reviews.find(r => r.author.login === reviewer.login)?.state === 'approved' ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-yellow-400" />
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
                {pullRequest.labels.map(label => (
                  <span 
                    key={label.name} 
                    className="badge badge-info text-xs"
                    style={{ backgroundColor: `#${label.color}20`, color: `#${label.color}` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Merge Status */}
            <div className="card p-4">
              <div className="text-sm font-medium text-factory-300 mb-3">Merge Status</div>
              {pullRequest.mergeable ? (
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Ready to merge
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <XCircle className="w-4 h-4" />
                  Has conflicts
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  Tag,
  Users,
  Clock,
  MessageSquare,
  Edit3,
  MoreHorizontal,
  ThumbsUp,
  ThumbsDown,
  Laugh,
  Heart,
  Loader2,
  Send,
  Lock,
  GitBranch,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import { formatDistanceToNow } from 'date-fns';
import { useIssue, useAddIssueComment, useUpdateIssue } from '../../../../../../hooks';

const labelColors: Record<string, string> = {
  bug: 'bg-red-500',
  enhancement: 'bg-blue-500',
  documentation: 'bg-purple-500',
  'good first issue': 'bg-green-500',
  'help wanted': 'bg-yellow-500',
  question: 'bg-pink-500',
};

export default function IssueDetailPage() {
  const params = useParams();
  const { isConnected } = useAccount();
  const owner = params.owner as string;
  const repo = params.repo as string;
  const issueNumber = Number(params.id);

  const { issue, comments, isLoading } = useIssue(owner, repo, issueNumber);
  const addComment = useAddIssueComment(owner, repo, issueNumber);
  const updateIssue = useUpdateIssue(owner, repo);

  const [newComment, setNewComment] = useState('');

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    await addComment.mutateAsync(newComment);
    setNewComment('');
  };

  const handleToggleState = async () => {
    if (!issue) return;
    await updateIssue.mutateAsync({
      issueNumber: issue.number,
      data: { state: issue.state === 'open' ? 'closed' : 'open' },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-5xl mx-auto">
          <div className="card p-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-factory-600" />
            <p className="text-factory-400">Issue not found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto">
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
                {issue.title}
                <span className="text-factory-500 font-normal ml-2">#{issue.number}</span>
              </h1>
              <div className="flex items-center gap-3 mt-2">
                <span className={clsx(
                  'badge flex items-center gap-1',
                  issue.state === 'open' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                )}>
                  {issue.state === 'open' ? (
                    <AlertCircle className="w-3.5 h-3.5" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5" />
                  )}
                  {issue.state === 'open' ? 'Open' : 'Closed'}
                </span>
                <span className="text-factory-500 text-sm">
                  <strong className="text-factory-300">{issue.author.login}</strong> opened this issue{' '}
                  {formatDistanceToNow(issue.createdAt, { addSuffix: true })}
                </span>
                <span className="text-factory-600">·</span>
                <span className="text-factory-500 text-sm flex items-center gap-1">
                  <MessageSquare className="w-4 h-4" />
                  {comments.length} comments
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary">
                <Edit3 className="w-4 h-4" />
                Edit
              </button>
              <button 
                onClick={handleToggleState}
                disabled={updateIssue.isPending}
                className="btn btn-secondary"
              >
                {updateIssue.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : issue.state === 'open' ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Close issue
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    Reopen issue
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Main Content */}
          <div className="flex-1 space-y-4">
            {/* Issue Body */}
            <div className="card">
              <div className="flex items-center gap-3 p-4 border-b border-factory-800">
                <img src={issue.author.avatar} alt="" className="w-10 h-10 rounded-full" />
                <div>
                  <span className="font-medium text-factory-200">{issue.author.login}</span>
                  <span className="text-factory-500 text-sm ml-2">
                    commented {formatDistanceToNow(issue.createdAt, { addSuffix: true })}
                  </span>
                </div>
                <div className="flex-1" />
                <span className="badge badge-info text-xs">Author</span>
                <button className="p-1 hover:bg-factory-800 rounded">
                  <MoreHorizontal className="w-4 h-4 text-factory-400" />
                </button>
              </div>
              <div className="p-4 prose prose-invert max-w-none">
                <ReactMarkdown>{issue.body}</ReactMarkdown>
              </div>
              <div className="flex items-center gap-2 px-4 py-3 border-t border-factory-800">
                <button className="p-1.5 hover:bg-factory-800 rounded text-factory-400 hover:text-factory-200">
                  <ThumbsUp className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-factory-800 rounded text-factory-400 hover:text-factory-200">
                  <ThumbsDown className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-factory-800 rounded text-factory-400 hover:text-factory-200">
                  <Laugh className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-factory-800 rounded text-factory-400 hover:text-factory-200">
                  <Heart className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Comments */}
            {comments.map((comment) => (
              <div key={comment.id} className="card">
                <div className="flex items-center gap-3 p-4 border-b border-factory-800">
                  <img src={comment.author.avatar} alt="" className="w-10 h-10 rounded-full" />
                  <div>
                    <span className="font-medium text-factory-200">{comment.author.login}</span>
                    <span className="text-factory-500 text-sm ml-2">
                      commented {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
                    </span>
                  </div>
                  <div className="flex-1" />
                  <button className="p-1 hover:bg-factory-800 rounded">
                    <MoreHorizontal className="w-4 h-4 text-factory-400" />
                  </button>
                </div>
                <div className="p-4 prose prose-invert max-w-none">
                  <ReactMarkdown>{comment.body}</ReactMarkdown>
                </div>
              </div>
            ))}

            {/* New Comment */}
            <form onSubmit={handleSubmitComment} className="card p-4">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-factory-700 flex items-center justify-center">
                  <Users className="w-5 h-5 text-factory-400" />
                </div>
                <div className="flex-1">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Leave a comment..."
                    rows={4}
                    className="input resize-none font-mono text-sm"
                  />
                  <div className="flex justify-between items-center mt-3">
                    <p className="text-factory-500 text-sm">
                      Markdown supported
                    </p>
                    <button
                      type="submit"
                      disabled={!newComment.trim() || addComment.isPending || !isConnected}
                      className="btn btn-primary"
                    >
                      {addComment.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>

          {/* Sidebar */}
          <div className="w-64 space-y-4">
            {/* Assignees */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-factory-300">Assignees</span>
                <button className="text-factory-500 hover:text-factory-300">
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              {issue.assignees.length > 0 ? (
                <div className="space-y-2">
                  {issue.assignees.map((user) => (
                    <div key={user.login} className="flex items-center gap-2">
                      <img src={user.avatar} alt="" className="w-6 h-6 rounded-full" />
                      <span className="text-sm text-factory-200">{user.login}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-factory-500 text-sm">No one assigned</p>
              )}
            </div>

            {/* Labels */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-factory-300">Labels</span>
                <button className="text-factory-500 hover:text-factory-300">
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              {issue.labels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {issue.labels.map((label) => (
                    <span 
                      key={label.name} 
                      className={clsx('badge text-xs text-white', labelColors[label.name] || 'bg-gray-500')}
                      style={{ backgroundColor: `#${label.color}` }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-factory-500 text-sm">None yet</p>
              )}
            </div>

            {/* Actions */}
            <div className="card p-4 space-y-2">
              <button className="w-full flex items-center gap-2 text-sm text-factory-400 hover:text-factory-200 p-2 hover:bg-factory-800 rounded">
                <Lock className="w-4 h-4" />
                Lock conversation
              </button>
              <button className="w-full flex items-center gap-2 text-sm text-factory-400 hover:text-factory-200 p-2 hover:bg-factory-800 rounded">
                <Tag className="w-4 h-4" />
                Pin issue
              </button>
              <button className="w-full flex items-center gap-2 text-sm text-factory-400 hover:text-factory-200 p-2 hover:bg-factory-800 rounded">
                <GitBranch className="w-4 h-4" />
                Create branch
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

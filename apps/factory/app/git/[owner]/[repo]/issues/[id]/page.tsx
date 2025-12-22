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

interface Comment {
  id: string;
  author: { name: string; avatar: string };
  body: string;
  createdAt: number;
  reactions: { emoji: string; count: number }[];
  isAuthor: boolean;
}

const mockIssue = {
  id: '42',
  number: 42,
  title: 'Bug: Smart contract verification fails on Base Sepolia',
  body: `## Description

When attempting to verify a contract on Base Sepolia, the verification process fails with an error.

## Steps to Reproduce

1. Deploy contract using \`bun jeju deploy\`
2. Run \`bun jeju verify --network=base-sepolia\`
3. See error in console

## Expected Behavior

Contract should verify successfully.

## Actual Behavior

\`\`\`
Error: Contract verification failed: Invalid constructor arguments
\`\`\`

## Environment

- Jeju CLI: v1.2.0
- Node: v20.10.0
- OS: Ubuntu 22.04`,
  author: { name: 'alice.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
  status: 'open' as const,
  labels: ['bug', 'help wanted'],
  assignees: [
    { id: '1', name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4' },
  ],
  createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  updatedAt: Date.now() - 1 * 60 * 60 * 1000,
  milestone: 'v1.1 Release',
  linkedPr: { number: 45, title: 'Fix contract verification' },
};

const mockComments: Comment[] = [
  {
    id: '1',
    author: { name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4' },
    body: `Thanks for the detailed report! I can reproduce this issue.

Looking at the logs, it seems the constructor arguments are being encoded differently between deploy and verify.

I'll investigate and push a fix soon.`,
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    reactions: [
      { emoji: '👍', count: 3 },
      { emoji: '🎉', count: 1 },
    ],
    isAuthor: false,
  },
  {
    id: '2',
    author: { name: 'alice.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
    body: `Great, thanks for looking into this @bob.eth! Let me know if you need any additional information.`,
    createdAt: Date.now() - 12 * 60 * 60 * 1000,
    reactions: [],
    isAuthor: true,
  },
];

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

  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comments, setComments] = useState(mockComments);

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 500));

    setComments([
      ...comments,
      {
        id: String(comments.length + 1),
        author: { name: 'you.eth', avatar: 'https://avatars.githubusercontent.com/u/0?v=4' },
        body: newComment,
        createdAt: Date.now(),
        reactions: [],
        isAuthor: false,
      },
    ]);
    setNewComment('');
    setIsSubmitting(false);
  };

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
                {mockIssue.title}
                <span className="text-factory-500 font-normal ml-2">#{mockIssue.number}</span>
              </h1>
              <div className="flex items-center gap-3 mt-2">
                <span className={clsx(
                  'badge flex items-center gap-1',
                  mockIssue.status === 'open' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                )}>
                  {mockIssue.status === 'open' ? (
                    <AlertCircle className="w-3.5 h-3.5" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5" />
                  )}
                  {mockIssue.status === 'open' ? 'Open' : 'Closed'}
                </span>
                <span className="text-factory-500 text-sm">
                  <strong className="text-factory-300">{mockIssue.author.name}</strong> opened this issue{' '}
                  {formatDistanceToNow(mockIssue.createdAt, { addSuffix: true })}
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
              <button className="btn btn-secondary">
                {mockIssue.status === 'open' ? (
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
                <img src={mockIssue.author.avatar} alt="" className="w-10 h-10 rounded-full" />
                <div>
                  <span className="font-medium text-factory-200">{mockIssue.author.name}</span>
                  <span className="text-factory-500 text-sm ml-2">
                    commented {formatDistanceToNow(mockIssue.createdAt, { addSuffix: true })}
                  </span>
                </div>
                <div className="flex-1" />
                <span className="badge badge-info text-xs">Author</span>
                <button className="p-1 hover:bg-factory-800 rounded">
                  <MoreHorizontal className="w-4 h-4 text-factory-400" />
                </button>
              </div>
              <div className="p-4 prose prose-invert max-w-none">
                <ReactMarkdown>{mockIssue.body}</ReactMarkdown>
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
                    <span className="font-medium text-factory-200">{comment.author.name}</span>
                    <span className="text-factory-500 text-sm ml-2">
                      commented {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
                    </span>
                  </div>
                  <div className="flex-1" />
                  {comment.isAuthor && <span className="badge badge-info text-xs">Author</span>}
                  <button className="p-1 hover:bg-factory-800 rounded">
                    <MoreHorizontal className="w-4 h-4 text-factory-400" />
                  </button>
                </div>
                <div className="p-4 prose prose-invert max-w-none">
                  <ReactMarkdown>{comment.body}</ReactMarkdown>
                </div>
                <div className="flex items-center gap-2 px-4 py-3 border-t border-factory-800">
                  {comment.reactions.map((reaction) => (
                    <button key={reaction.emoji} className="px-2 py-1 bg-factory-800 rounded-full text-sm flex items-center gap-1 hover:bg-factory-700">
                      <span>{reaction.emoji}</span>
                      <span className="text-factory-400">{reaction.count}</span>
                    </button>
                  ))}
                  <button className="p-1.5 hover:bg-factory-800 rounded text-factory-400 hover:text-factory-200">
                    <ThumbsUp className="w-4 h-4" />
                  </button>
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
                      disabled={!newComment.trim() || isSubmitting || !isConnected}
                      className="btn btn-primary"
                    >
                      {isSubmitting ? (
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
              {mockIssue.assignees.length > 0 ? (
                <div className="space-y-2">
                  {mockIssue.assignees.map((user) => (
                    <div key={user.id} className="flex items-center gap-2">
                      <img src={user.avatar} alt="" className="w-6 h-6 rounded-full" />
                      <span className="text-sm text-factory-200">{user.name}</span>
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
              {mockIssue.labels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {mockIssue.labels.map((label) => (
                    <span key={label} className={clsx('badge text-xs text-white', labelColors[label] || 'bg-gray-500')}>
                      {label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-factory-500 text-sm">None yet</p>
              )}
            </div>

            {/* Milestone */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-factory-300">Milestone</span>
                <button className="text-factory-500 hover:text-factory-300">
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              {mockIssue.milestone ? (
                <div className="flex items-center gap-2 text-sm text-factory-200">
                  <Clock className="w-4 h-4 text-factory-400" />
                  {mockIssue.milestone}
                </div>
              ) : (
                <p className="text-factory-500 text-sm">No milestone</p>
              )}
            </div>

            {/* Linked PR */}
            {mockIssue.linkedPr && (
              <div className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <GitBranch className="w-4 h-4 text-factory-400" />
                  <span className="text-sm font-medium text-factory-300">Linked Pull Request</span>
                </div>
                <Link 
                  href={`/git/${owner}/${repo}/pulls/${mockIssue.linkedPr.number}`}
                  className="flex items-center gap-2 text-sm text-accent-400 hover:text-accent-300"
                >
                  #{mockIssue.linkedPr.number} {mockIssue.linkedPr.title}
                </Link>
              </div>
            )}

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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



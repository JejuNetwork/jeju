'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  MessageSquare,
  ArrowLeft,
  Plus,
  Search,
  Filter,
  ThumbsUp,
  MessageCircle,
  Clock,
  CheckCircle,
  Loader2,
  Send,
  Pin,
  Lock,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';
// Remove unused import if possible, but ReactMarkdown is often used in JSX. 
// If unused, remove it. Assuming it's unused based on logs.
// Checking logs: 'ReactMarkdown' is declared but its value is never read.
// So I will remove it.

interface Discussion {
  id: string;
  title: string;
  author: { name: string; avatar: string };
  createdAt: number;
  lastReplyAt: number;
  replyCount: number;
  upvotes: number;
  category: 'question' | 'announcement' | 'general' | 'bug' | 'feature';
  isPinned: boolean;
  isLocked: boolean;
  isResolved: boolean;
  preview: string;
  tags: string[];
}

const mockDiscussions: Discussion[] = [
  {
    id: '1',
    title: 'How to fine-tune this model for code review tasks?',
    author: { name: 'dev.eth', avatar: 'https://avatars.githubusercontent.com/u/5?v=4' },
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    lastReplyAt: Date.now() - 2 * 60 * 60 * 1000,
    replyCount: 8,
    upvotes: 15,
    category: 'question',
    isPinned: false,
    isLocked: false,
    isResolved: true,
    preview: 'I want to fine-tune this model specifically for reviewing Solidity code. What dataset and parameters would you recommend?',
    tags: ['fine-tuning', 'solidity'],
  },
  {
    id: '2',
    title: 'v1.2.0 Release - Improved code generation quality',
    author: { name: 'jeju.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    lastReplyAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    replyCount: 12,
    upvotes: 42,
    category: 'announcement',
    isPinned: true,
    isLocked: false,
    isResolved: false,
    preview: 'We are excited to release v1.2.0 with significant improvements to code generation quality, especially for complex smart contracts.',
    tags: ['release', 'update'],
  },
  {
    id: '3',
    title: 'Model outputs incorrect gas estimates',
    author: { name: 'auditor.eth', avatar: 'https://avatars.githubusercontent.com/u/3?v=4' },
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    lastReplyAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
    replyCount: 4,
    upvotes: 7,
    category: 'bug',
    isPinned: false,
    isLocked: false,
    isResolved: false,
    preview: 'When asking the model to estimate gas for complex transactions, it often underestimates by 20-30%. This could cause issues.',
    tags: ['bug', 'gas-estimation'],
  },
  {
    id: '4',
    title: 'Feature request: Support for Vyper code generation',
    author: { name: 'vyper-fan.eth', avatar: 'https://avatars.githubusercontent.com/u/4?v=4' },
    createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    lastReplyAt: Date.now() - 6 * 24 * 60 * 60 * 1000,
    replyCount: 6,
    upvotes: 23,
    category: 'feature',
    isPinned: false,
    isLocked: false,
    isResolved: false,
    preview: 'Would love to see Vyper code generation support. The model currently only handles Solidity well.',
    tags: ['feature-request', 'vyper'],
  },
];

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  question: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  announcement: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  general: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
  bug: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  feature: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
};

export default function ModelDiscussionsPage() {
  const params = useParams();
  const { isConnected } = useAccount();
  const org = params.org as string;
  const name = params.name as string;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showNewDiscussion, setShowNewDiscussion] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState<Discussion['category']>('general');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredDiscussions = mockDiscussions
    .filter(d => !searchQuery || d.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(d => !selectedCategory || d.category === selectedCategory)
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.lastReplyAt - a.lastReplyAt;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newBody.trim()) return;

    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSubmitting(false);
    setShowNewDiscussion(false);
    setNewTitle('');
    setNewBody('');
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/models/${org}/${name}`}
            className="text-factory-400 hover:text-factory-300 text-sm inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {org}/{name}
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
              <MessageSquare className="w-7 h-7 text-blue-400" />
              Discussions
            </h1>
            <button
              onClick={() => setShowNewDiscussion(true)}
              className="btn btn-primary"
            >
              <Plus className="w-4 h-4" />
              New Discussion
            </button>
          </div>
        </div>

        {/* New Discussion Form */}
        {showNewDiscussion && (
          <div className="card p-6 mb-6">
            <h2 className="text-lg font-semibold text-factory-100 mb-4">Start a Discussion</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">Category</label>
                <div className="flex gap-2">
                  {(['question', 'general', 'bug', 'feature'] as const).map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setNewCategory(cat)}
                      className={clsx(
                        'px-3 py-1 rounded-full text-sm capitalize',
                        newCategory === cat
                          ? categoryColors[cat].bg + ' ' + categoryColors[cat].text
                          : 'bg-factory-800 text-factory-400 hover:text-factory-200'
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="What would you like to discuss?"
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">Details</label>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Provide more context..."
                  rows={6}
                  className="input resize-none"
                  required
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewDiscussion(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || !newBody.trim() || isSubmitting || !isConnected}
                  className="btn btn-primary"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Post Discussion
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search discussions..."
                className="input pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-factory-400" />
              <select
                value={selectedCategory || ''}
                onChange={(e) => setSelectedCategory(e.target.value || null)}
                className="input text-sm py-2"
              >
                <option value="">All categories</option>
                <option value="question">Questions</option>
                <option value="announcement">Announcements</option>
                <option value="bug">Bug Reports</option>
                <option value="feature">Feature Requests</option>
                <option value="general">General</option>
              </select>
            </div>
          </div>
        </div>

        {/* Discussion List */}
        <div className="space-y-3">
          {filteredDiscussions.map(discussion => (
            <Link
              key={discussion.id}
              href={`/models/${org}/${name}/discussions/${discussion.id}`}
              className="card p-4 block hover:border-factory-600 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center gap-1 text-center min-w-[50px]">
                  <button className="p-1 hover:bg-factory-800 rounded">
                    <ThumbsUp className="w-4 h-4 text-factory-400" />
                  </button>
                  <span className="text-factory-200 font-medium">{discussion.upvotes}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {discussion.isPinned && (
                      <Pin className="w-4 h-4 text-yellow-400" />
                    )}
                    {discussion.isLocked && (
                      <Lock className="w-4 h-4 text-factory-500" />
                    )}
                    <span className={clsx(
                      'badge text-xs capitalize',
                      categoryColors[discussion.category].bg,
                      categoryColors[discussion.category].text,
                      categoryColors[discussion.category].border
                    )}>
                      {discussion.category}
                    </span>
                    {discussion.isResolved && (
                      <span className="badge bg-green-500/20 text-green-400 border-green-500/30 text-xs flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Resolved
                      </span>
                    )}
                  </div>

                  <h3 className="text-factory-100 font-medium mb-1 truncate">
                    {discussion.title}
                  </h3>

                  <p className="text-factory-500 text-sm mb-2 line-clamp-2">
                    {discussion.preview}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-factory-500">
                    <span className="flex items-center gap-1">
                      <img src={discussion.author.avatar} alt="" className="w-4 h-4 rounded-full" />
                      {discussion.author.name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(discussion.createdAt, { addSuffix: true })}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" />
                      {discussion.replyCount} replies
                    </span>
                    {discussion.tags.map(tag => (
                      <span key={tag} className="badge bg-factory-800 text-factory-400 text-xs">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {filteredDiscussions.length === 0 && (
            <div className="card p-12 text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-factory-600" />
              <p className="text-factory-400">No discussions found</p>
              <button
                onClick={() => setShowNewDiscussion(true)}
                className="btn btn-primary mt-4"
              >
                Start the first discussion
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



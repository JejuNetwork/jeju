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
import { useDiscussions, useCreateDiscussion, type DiscussionCategory } from '../../../../../hooks';

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  question: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  announcements: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  general: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
  show: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  ideas: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
};

export default function ModelDiscussionsPage() {
  const params = useParams();
  const { isConnected } = useAccount();
  const org = params.org as string;
  const name = params.name as string;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<DiscussionCategory | null>(null);
  const [showNewDiscussion, setShowNewDiscussion] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState<DiscussionCategory>('general');
  const [newTags, setNewTags] = useState('');

  const { discussions, isLoading } = useDiscussions('models', `${org}/${name}`, { category: selectedCategory || undefined });
  const createDiscussion = useCreateDiscussion('models', `${org}/${name}`);

  const filteredDiscussions = discussions
    .filter(d => !searchQuery || d.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.lastReplyAt - a.lastReplyAt;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newBody.trim()) return;

    await createDiscussion.mutateAsync({
      title: newTitle,
      content: newBody,
      category: newCategory,
      tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
    });

    setShowNewDiscussion(false);
    setNewTitle('');
    setNewBody('');
    setNewTags('');
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
                  {(['questions', 'general', 'ideas', 'show'] as const).map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setNewCategory(cat)}
                      className={clsx(
                        'px-3 py-1 rounded-full text-sm capitalize',
                        newCategory === cat
                          ? (categoryColors[cat]?.bg || 'bg-gray-500/20') + ' ' + (categoryColors[cat]?.text || 'text-gray-400')
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

              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">Tags (comma separated)</label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="fine-tuning, pytorch, etc."
                  className="input"
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
                  disabled={!newTitle.trim() || !newBody.trim() || createDiscussion.isPending || !isConnected}
                  className="btn btn-primary"
                >
                  {createDiscussion.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
                onChange={(e) => setSelectedCategory((e.target.value || null) as DiscussionCategory | null)}
                className="input text-sm py-2"
              >
                <option value="">All categories</option>
                <option value="questions">Questions</option>
                <option value="announcements">Announcements</option>
                <option value="ideas">Ideas</option>
                <option value="show">Show & Tell</option>
                <option value="general">General</option>
              </select>
            </div>
          </div>
        </div>

        {/* Discussion List */}
        {isLoading ? (
          <div className="card p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent-400" />
          </div>
        ) : filteredDiscussions.length === 0 ? (
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
        ) : (
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
                    <span className="text-factory-200 font-medium">{discussion.likes}</span>
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
                        categoryColors[discussion.category]?.bg || 'bg-gray-500/20',
                        categoryColors[discussion.category]?.text || 'text-gray-400',
                        categoryColors[discussion.category]?.border || 'border-gray-500/30'
                      )}>
                        {discussion.category}
                      </span>
                    </div>

                    <h3 className="text-factory-100 font-medium mb-1 truncate">
                      {discussion.title}
                    </h3>

                    <p className="text-factory-500 text-sm mb-2 line-clamp-2">
                      {discussion.content.substring(0, 200)}...
                    </p>

                    <div className="flex items-center gap-4 text-xs text-factory-500">
                      <span className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-[8px] font-bold">
                          {discussion.author.name[0].toUpperCase()}
                        </div>
                        {discussion.author.name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(discussion.createdAt, { addSuffix: true })}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {discussion.replies} replies
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
          </div>
        )}
      </div>
    </div>
  );
}

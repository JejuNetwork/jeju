'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { 
  MessageSquare, 
  Heart,
  Repeat2,
  Share,
  Send,
  Image as ImageIcon,
  Code,
  Link as LinkIcon,
  MoreHorizontal,
  Users,
  TrendingUp,
  Bell,
  Settings,
  ExternalLink
} from 'lucide-react';
import { clsx } from 'clsx';

type FeedTab = 'feed' | 'mentions' | 'highlights';

const mockPosts = [
  {
    id: '1',
    author: {
      name: 'alice.eth',
      handle: '@alice',
      avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
      fid: 12345,
    },
    content: 'Just deployed a new model to the Factory model hub! 🚀 Fine-tuned LLaMA 3 on the jeju documentation corpus. Try it out: factory.jeju.network/models/alice/llama-3-jeju',
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
    likes: 42,
    recasts: 12,
    replies: 8,
    hasLiked: false,
    hasRecasted: false,
  },
  {
    id: '2',
    author: {
      name: 'bob.base',
      handle: '@bob',
      avatar: 'https://avatars.githubusercontent.com/u/2?v=4',
      fid: 23456,
    },
    content: 'Looking for help auditing our new BountyRegistry contract. 5 ETH bounty for a thorough security review. Must have experience with DeFi protocols.\n\n#security #solidity #bounty',
    timestamp: Date.now() - 4 * 60 * 60 * 1000,
    likes: 89,
    recasts: 34,
    replies: 23,
    hasLiked: true,
    hasRecasted: false,
  },
  {
    id: '3',
    author: {
      name: 'Factory Updates',
      handle: '@factory',
      avatar: '/factory-icon.png',
      fid: 1,
      verified: true,
    },
    content: '📢 New release: Factory v1.2.0\n\n• Multi-token bounty rewards\n• Guardian validator network live\n• Model hub inference endpoints\n• Container registry alpha\n\nUpgrade now and start earning!',
    timestamp: Date.now() - 8 * 60 * 60 * 1000,
    likes: 256,
    recasts: 89,
    replies: 45,
    hasLiked: false,
    hasRecasted: true,
    isPinned: true,
  },
  {
    id: '4',
    author: {
      name: 'carol.dev',
      handle: '@caroldev',
      avatar: 'https://avatars.githubusercontent.com/u/3?v=4',
      fid: 34567,
    },
    content: 'Just completed my first milestone on the indexer optimization bounty! 🎉\n\nQuery performance improved by 40%. Guardian review pending.\n\n@factory #bounty #indexer',
    timestamp: Date.now() - 12 * 60 * 60 * 1000,
    likes: 67,
    recasts: 15,
    replies: 12,
    hasLiked: false,
    hasRecasted: false,
  },
];

const trendingTopics = [
  { tag: '#bounty', posts: 234 },
  { tag: '#models', posts: 189 },
  { tag: '#security', posts: 156 },
  { tag: '#guardian', posts: 98 },
  { tag: '#compute', posts: 87 },
];

export default function FeedPage() {
  const { isConnected, address } = useAccount();
  const [tab, setTab] = useState<FeedTab>('feed');
  const [newPost, setNewPost] = useState('');

  const formatTime = (timestamp: number) => {
    const hours = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours === 1) return '1h';
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto p-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Feed */}
          <div className="lg:col-span-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
                <MessageSquare className="w-7 h-7 text-purple-400" />
                Factory Feed
              </h1>
              <div className="flex items-center gap-2">
                {(['feed', 'mentions', 'highlights'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={clsx(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                      tab === t
                        ? 'bg-accent-600 text-white'
                        : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Compose */}
            <div className="card p-6 mb-6">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full bg-factory-800 flex items-center justify-center flex-shrink-0">
                  <Users className="w-6 h-6 text-factory-400" />
                </div>
                <div className="flex-1">
                  <textarea
                    placeholder="What's happening in Factory?"
                    value={newPost}
                    onChange={(e) => setNewPost(e.target.value)}
                    className="w-full bg-transparent border-0 resize-none text-factory-100 placeholder-factory-500 focus:outline-none min-h-[80px]"
                  />
                  <div className="flex items-center justify-between border-t border-factory-800 pt-4 mt-4">
                    <div className="flex items-center gap-2">
                      <button className="p-2 hover:bg-factory-800 rounded-lg transition-colors text-factory-400 hover:text-accent-400">
                        <ImageIcon className="w-5 h-5" />
                      </button>
                      <button className="p-2 hover:bg-factory-800 rounded-lg transition-colors text-factory-400 hover:text-accent-400">
                        <Code className="w-5 h-5" />
                      </button>
                      <button className="p-2 hover:bg-factory-800 rounded-lg transition-colors text-factory-400 hover:text-accent-400">
                        <LinkIcon className="w-5 h-5" />
                      </button>
                    </div>
                    <button 
                      className="btn btn-primary"
                      disabled={!newPost.trim() || !isConnected}
                    >
                      <Send className="w-4 h-4" />
                      Cast
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Posts */}
            <div className="space-y-4">
              {mockPosts.map((post) => (
                <div 
                  key={post.id} 
                  className={clsx(
                    'card p-6',
                    post.isPinned && 'border-accent-500/30'
                  )}
                >
                  {post.isPinned && (
                    <div className="flex items-center gap-2 text-accent-400 text-sm mb-3">
                      <TrendingUp className="w-4 h-4" />
                      <span>Pinned</span>
                    </div>
                  )}
                  
                  <div className="flex gap-4">
                    <img 
                      src={post.author.avatar} 
                      alt={post.author.name}
                      className="w-12 h-12 rounded-full flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-factory-100">{post.author.name}</span>
                        {'verified' in post.author && post.author.verified && (
                          <span className="w-4 h-4 bg-accent-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                        <span className="text-factory-500">{post.author.handle}</span>
                        <span className="text-factory-600">·</span>
                        <span className="text-factory-500">{formatTime(post.timestamp)}</span>
                      </div>
                      
                      <p className="text-factory-200 whitespace-pre-wrap mb-4">{post.content}</p>
                      
                      <div className="flex items-center gap-6 text-factory-500">
                        <button className="flex items-center gap-2 hover:text-accent-400 transition-colors">
                          <MessageSquare className="w-4 h-4" />
                          <span className="text-sm">{post.replies}</span>
                        </button>
                        <button className={clsx(
                          'flex items-center gap-2 transition-colors',
                          post.hasRecasted ? 'text-green-400' : 'hover:text-green-400'
                        )}>
                          <Repeat2 className="w-4 h-4" />
                          <span className="text-sm">{post.recasts}</span>
                        </button>
                        <button className={clsx(
                          'flex items-center gap-2 transition-colors',
                          post.hasLiked ? 'text-red-400' : 'hover:text-red-400'
                        )}>
                          <Heart className={clsx('w-4 h-4', post.hasLiked && 'fill-current')} />
                          <span className="text-sm">{post.likes}</span>
                        </button>
                        <button className="flex items-center gap-2 hover:text-accent-400 transition-colors">
                          <Share className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    <button className="text-factory-500 hover:text-factory-300 p-1">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Channel Info */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-purple-400" />
                /factory channel
              </h3>
              <p className="text-factory-400 text-sm mb-4">
                The official Farcaster channel for Factory. Share bounties, showcase work, connect with builders.
              </p>
              <div className="flex items-center gap-4 text-sm text-factory-500 mb-4">
                <span>1.2k members</span>
                <span>•</span>
                <span>234 posts/week</span>
              </div>
              <a 
                href="https://warpcast.com/~/channel/factory"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary w-full"
              >
                <ExternalLink className="w-4 h-4" />
                Open in Warpcast
              </a>
            </div>

            {/* Trending */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-accent-400" />
                Trending
              </h3>
              <div className="space-y-3">
                {trendingTopics.map((topic) => (
                  <button 
                    key={topic.tag}
                    className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-factory-800 transition-colors"
                  >
                    <span className="text-accent-400 font-medium">{topic.tag}</span>
                    <span className="text-factory-500 text-sm">{topic.posts} posts</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <button className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-factory-800 transition-colors text-left">
                  <Bell className="w-5 h-5 text-factory-400" />
                  <span className="text-factory-300">Notifications</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-factory-800 transition-colors text-left">
                  <Settings className="w-5 h-5 text-factory-400" />
                  <span className="text-factory-300">Channel Settings</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


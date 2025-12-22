'use client'

import { clsx } from 'clsx'
import {
  Bell,
  Code,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Repeat2,
  Send,
  Settings,
  Share,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { type Cast, farcasterClient } from '@/lib/services/farcaster'

type FeedTab = 'feed' | 'mentions' | 'highlights'

interface PostData {
  id: string
  author: {
    name: string
    handle: string
    avatar: string
    fid: number
    verified?: boolean
  }
  content: string
  timestamp: number
  likes: number
  recasts: number
  replies: number
  hasLiked: boolean
  hasRecasted: boolean
  isPinned?: boolean
}

const trendingTopics = [
  { tag: '#bounty', posts: 234 },
  { tag: '#models', posts: 189 },
  { tag: '#security', posts: 156 },
  { tag: '#guardian', posts: 98 },
  { tag: '#compute', posts: 87 },
]

export default function FeedPage() {
  const { isConnected, address } = useAccount()
  const [tab, setTab] = useState<FeedTab>('feed')
  const [newPost, setNewPost] = useState('')
  const [posts, setPosts] = useState<PostData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const transformCastToPost = useCallback(
    (cast: Cast): PostData => ({
      id: cast.hash,
      author: {
        name: cast.author.displayName || cast.author.username,
        handle: `@${cast.author.username}`,
        avatar: cast.author.pfpUrl || 'https://via.placeholder.com/48',
        fid: cast.author.fid,
      },
      content: cast.text,
      timestamp: cast.timestamp,
      likes: cast.reactions.likes,
      recasts: cast.reactions.recasts,
      replies: cast.replies,
      hasLiked: false,
      hasRecasted: false,
    }),
    [],
  )

  const loadFeed = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    farcasterClient
      .getChannelFeed('factory', { limit: 20 })
      .then(({ casts }) => {
        setPosts(casts.map(transformCastToPost))
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [transformCastToPost])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  const handlePost = async () => {
    if (!newPost.trim() || !isConnected) return

    setIsPosting(true)
    try {
      // In production, this would use the user's Farcaster signer
      // For now, just add to local state as demo
      const demoPost: PostData = {
        id: `local-${Date.now()}`,
        author: {
          name: address
            ? `${address.slice(0, 6)}...${address.slice(-4)}`
            : 'Anonymous',
          handle: '@user',
          avatar: 'https://via.placeholder.com/48',
          fid: 0,
        },
        content: newPost,
        timestamp: Date.now(),
        likes: 0,
        recasts: 0,
        replies: 0,
        hasLiked: false,
        hasRecasted: false,
      }
      setPosts((prev) => [demoPost, ...prev])
      setNewPost('')
    } catch (err) {
      setError('Failed to post')
      console.error('Failed to post:', err)
    } finally {
      setIsPosting(false)
    }
  }

  const formatTime = (timestamp: number) => {
    const hours = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60))
    if (hours < 1) return 'Just now'
    if (hours === 1) return '1h'
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  }

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
                <button
                  onClick={loadFeed}
                  disabled={isLoading}
                  className="p-2 hover:bg-factory-800 rounded-lg transition-colors"
                >
                  <RefreshCw
                    className={clsx(
                      'w-4 h-4 text-factory-400',
                      isLoading && 'animate-spin',
                    )}
                  />
                </button>
                {(['feed', 'mentions', 'highlights'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={clsx(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                      tab === t
                        ? 'bg-accent-600 text-white'
                        : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Compose */}
            <div className="card p-6 mb-6">
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
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
                      disabled={!newPost.trim() || !isConnected || isPosting}
                      onClick={handlePost}
                    >
                      {isPosting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Cast
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Loading State */}
            {isLoading && posts.length === 0 && (
              <div className="card p-12 text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-4 text-factory-400 animate-spin" />
                <p className="text-factory-500">Loading feed...</p>
              </div>
            )}

            {/* Posts */}
            <div className="space-y-4">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className={clsx(
                    'card p-6',
                    post.isPinned && 'border-accent-500/30',
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
                        <span className="font-semibold text-factory-100">
                          {post.author.name}
                        </span>
                        {'verified' in post.author && post.author.verified && (
                          <span className="w-4 h-4 bg-accent-500 rounded-full flex items-center justify-center">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </span>
                        )}
                        <span className="text-factory-500">
                          {post.author.handle}
                        </span>
                        <span className="text-factory-600">·</span>
                        <span className="text-factory-500">
                          {formatTime(post.timestamp)}
                        </span>
                      </div>

                      <p className="text-factory-200 whitespace-pre-wrap mb-4">
                        {post.content}
                      </p>

                      <div className="flex items-center gap-6 text-factory-500">
                        <button className="flex items-center gap-2 hover:text-accent-400 transition-colors">
                          <MessageSquare className="w-4 h-4" />
                          <span className="text-sm">{post.replies}</span>
                        </button>
                        <button
                          className={clsx(
                            'flex items-center gap-2 transition-colors',
                            post.hasRecasted
                              ? 'text-green-400'
                              : 'hover:text-green-400',
                          )}
                        >
                          <Repeat2 className="w-4 h-4" />
                          <span className="text-sm">{post.recasts}</span>
                        </button>
                        <button
                          className={clsx(
                            'flex items-center gap-2 transition-colors',
                            post.hasLiked
                              ? 'text-red-400'
                              : 'hover:text-red-400',
                          )}
                        >
                          <Heart
                            className={clsx(
                              'w-4 h-4',
                              post.hasLiked && 'fill-current',
                            )}
                          />
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
                The official Farcaster channel for Factory. Share bounties,
                showcase work, connect with builders.
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
                    <span className="text-accent-400 font-medium">
                      {topic.tag}
                    </span>
                    <span className="text-factory-500 text-sm">
                      {topic.posts} posts
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">
                Quick Actions
              </h3>
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
  )
}

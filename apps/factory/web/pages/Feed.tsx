/**
 * Feed Page
 *
 * Farcaster-powered community feed for Factory.
 * Supports the Factory channel, trending, and user feeds.
 */

import {
  Hash,
  Loader2,
  MessageSquare,
  RefreshCw,
  Settings,
  TrendingUp,
  User,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import {
  CastCard,
  CastComposer,
  FarcasterConnect,
} from '../components/farcaster'
import {
  type Cast,
  useFarcasterStatus,
  useFeed,
  useTrendingFeed,
} from '../hooks/useFarcaster'

type FeedType = 'factory' | 'trending' | 'user'

export function FeedPage() {
  const { isConnected: walletConnected } = useAccount()
  const { data: farcasterStatus, isLoading: statusLoading } =
    useFarcasterStatus()
  const [feedType, setFeedType] = useState<FeedType>('factory')
  const [replyingTo, setReplyingTo] = useState<Cast | null>(null)
  const [showConnect, setShowConnect] = useState(false)

  const {
    data: factoryFeed,
    isLoading: factoryLoading,
    refetch: refetchFactory,
  } = useFeed({
    channel: 'factory',
  })
  const {
    data: trendingFeed,
    isLoading: trendingLoading,
    refetch: refetchTrending,
  } = useTrendingFeed()
  const {
    data: userFeed,
    isLoading: userLoading,
    refetch: refetchUser,
  } = useFeed({
    feedType: 'user',
    fid: farcasterStatus?.fid ?? undefined,
  })

  const currentFeed =
    feedType === 'factory'
      ? factoryFeed
      : feedType === 'trending'
        ? trendingFeed
        : userFeed

  const isLoading =
    feedType === 'factory'
      ? factoryLoading
      : feedType === 'trending'
        ? trendingLoading
        : userLoading

  const handleRefresh = () => {
    if (feedType === 'factory') refetchFactory()
    else if (feedType === 'trending') refetchTrending()
    else refetchUser()
  }

  const handleReply = (cast: Cast) => {
    setReplyingTo(cast)
    // Scroll to composer
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleViewProfile = (fid: number) => {
    // Navigate to user profile - could open in new tab or modal
    window.open(`https://warpcast.com/profiles/${fid}`, '_blank')
  }

  // Show connect modal
  if (
    showConnect ||
    (!farcasterStatus?.connected && walletConnected && !statusLoading)
  ) {
    return (
      <div className="min-h-screen p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
              <MessageSquare className="w-7 h-7 text-accent-400" />
              Feed
            </h1>
            <p className="text-factory-400 mt-1">
              Developer community on Farcaster
            </p>
          </div>
          {farcasterStatus?.connected && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowConnect(false)}
            >
              Back to Feed
            </button>
          )}
        </div>

        <div className="max-w-lg mx-auto">
          <FarcasterConnect onComplete={() => setShowConnect(false)} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <MessageSquare className="w-7 h-7 text-accent-400" />
            Feed
          </h1>
          <p className="text-factory-400 mt-1">
            Developer community on Farcaster
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Refresh */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
            />
          </button>

          {/* User status */}
          {farcasterStatus?.connected ? (
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-factory-800 hover:bg-factory-700 transition-colors"
              onClick={() => setShowConnect(true)}
            >
              {farcasterStatus.pfpUrl ? (
                <img
                  src={farcasterStatus.pfpUrl}
                  alt={farcasterStatus.username ?? ''}
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-factory-700 flex items-center justify-center text-factory-400 text-xs">
                  {farcasterStatus.username?.slice(0, 2).toUpperCase() ?? '?'}
                </div>
              )}
              <span className="text-sm text-factory-200">
                @{farcasterStatus.username}
              </span>
              <Settings className="w-4 h-4 text-factory-500" />
            </button>
          ) : walletConnected ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowConnect(true)}
            >
              Connect Farcaster
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-8">
        {/* Main feed */}
        <div className="flex-1 max-w-2xl">
          {/* Composer */}
          {farcasterStatus?.connected && (
            <div className="mb-6">
              <CastComposer
                channelId={feedType === 'factory' ? 'factory' : undefined}
                replyTo={replyingTo}
                onClearReply={() => setReplyingTo(null)}
                onSuccess={handleRefresh}
                placeholder={
                  feedType === 'factory'
                    ? "What's happening in the Factory?"
                    : "What's on your mind?"
                }
              />
            </div>
          )}

          {/* Feed type tabs */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-factory-900 mb-6">
            <button
              type="button"
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                feedType === 'factory'
                  ? 'bg-accent-600 text-white'
                  : 'text-factory-400 hover:text-factory-200'
              }`}
              onClick={() => setFeedType('factory')}
            >
              <Hash className="w-4 h-4" />
              Factory
            </button>
            <button
              type="button"
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                feedType === 'trending'
                  ? 'bg-accent-600 text-white'
                  : 'text-factory-400 hover:text-factory-200'
              }`}
              onClick={() => setFeedType('trending')}
            >
              <TrendingUp className="w-4 h-4" />
              Trending
            </button>
            {farcasterStatus?.connected && (
              <button
                type="button"
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  feedType === 'user'
                    ? 'bg-accent-600 text-white'
                    : 'text-factory-400 hover:text-factory-200'
                }`}
                onClick={() => setFeedType('user')}
              >
                <User className="w-4 h-4" />
                My Casts
              </button>
            )}
          </div>

          {/* Feed content */}
          {isLoading ? (
            <div className="card p-12 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-accent-500" />
            </div>
          ) : !currentFeed?.casts?.length ? (
            <div className="card p-12 text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-factory-600" />
              <h3 className="text-lg font-medium text-factory-300 mb-2">
                {feedType === 'factory'
                  ? 'No casts in /factory yet'
                  : feedType === 'user'
                    ? "You haven't posted anything yet"
                    : 'No trending casts'}
              </h3>
              <p className="text-factory-500">
                {feedType === 'factory'
                  ? 'Be the first to post in the Factory channel'
                  : 'Check back later for new content'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {currentFeed.casts.map((cast) => (
                <CastCard
                  key={cast.hash}
                  cast={cast}
                  onReply={handleReply}
                  onViewProfile={handleViewProfile}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="hidden lg:block w-80">
          {/* Channel info */}
          {feedType === 'factory' && (
            <div className="card p-4 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent-500/20 flex items-center justify-center">
                  <Hash className="w-5 h-5 text-accent-400" />
                </div>
                <div>
                  <h3 className="font-medium text-factory-100">factory</h3>
                  <p className="text-sm text-factory-500">Factory Channel</p>
                </div>
              </div>
              <p className="text-sm text-factory-400">
                Developer coordination on Jeju. Share bounties, packages, and
                project updates.
              </p>
            </div>
          )}

          {/* Quick links */}
          <div className="card p-4">
            <h3 className="font-medium text-factory-200 mb-3">Resources</h3>
            <div className="space-y-2">
              <a
                href="https://warpcast.com/~/channel/factory"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-factory-400 hover:text-accent-400 transition-colors"
              >
                Open /factory in Warpcast →
              </a>
              <a
                href="https://docs.farcaster.xyz/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-factory-400 hover:text-accent-400 transition-colors"
              >
                Farcaster Documentation →
              </a>
            </div>
          </div>

          {/* Connection status */}
          {!farcasterStatus?.connected && walletConnected && (
            <div className="card p-4 mt-4">
              <h3 className="font-medium text-factory-200 mb-2">
                Join the conversation
              </h3>
              <p className="text-sm text-factory-400 mb-3">
                Connect your Farcaster account to post and interact with the
                community.
              </p>
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={() => setShowConnect(true)}
              >
                Connect Farcaster
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

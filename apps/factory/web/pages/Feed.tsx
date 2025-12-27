/**
 * Feed Page
 *
 * Farcaster-powered community feed for Factory.
 * Supports the Factory channel, trending, and user feeds.
 */

import { clsx } from 'clsx'
import { Hash, Loader2, MessageSquare, RefreshCw, Settings, TrendingUp, User } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import { CastCard, CastComposer, FarcasterConnect } from '../components/farcaster'
import { EmptyState, LoadingState, PageHeader } from '../components/shared'
import { type Cast, useFarcasterStatus, useFeed, useTrendingFeed } from '../hooks/useFarcaster'

type FeedType = 'factory' | 'trending' | 'user'

const feedTabs = [
  { value: 'factory', label: 'Factory', icon: Hash },
  { value: 'trending', label: 'Trending', icon: TrendingUp },
]

export function FeedPage() {
  const { isConnected: walletConnected } = useAccount()
  const { data: farcasterStatus, isLoading: statusLoading } = useFarcasterStatus()
  const [feedType, setFeedType] = useState<FeedType>('factory')
  const [replyingTo, setReplyingTo] = useState<Cast | null>(null)
  const [showConnect, setShowConnect] = useState(false)

  const { data: factoryFeed, isLoading: factoryLoading, refetch: refetchFactory } = useFeed({ channel: 'factory' })
  const { data: trendingFeed, isLoading: trendingLoading, refetch: refetchTrending } = useTrendingFeed()
  const { data: userFeed, isLoading: userLoading, refetch: refetchUser } = useFeed({
    feedType: 'user',
    fid: farcasterStatus?.fid ?? undefined,
  })

  const currentFeed = feedType === 'factory' ? factoryFeed : feedType === 'trending' ? trendingFeed : userFeed
  const isLoading = feedType === 'factory' ? factoryLoading : feedType === 'trending' ? trendingLoading : userLoading

  const handleRefresh = useCallback(() => {
    if (feedType === 'factory') refetchFactory()
    else if (feedType === 'trending') refetchTrending()
    else refetchUser()
  }, [feedType, refetchFactory, refetchTrending, refetchUser])

  const handleReply = useCallback((cast: Cast) => {
    setReplyingTo(cast)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const handleViewProfile = useCallback((fid: number) => {
    window.open(`https://warpcast.com/profiles/${fid}`, '_blank')
  }, [])

  // Show connect modal
  if (showConnect || (!farcasterStatus?.connected && walletConnected && !statusLoading)) {
    return (
      <div className="page-container">
        <PageHeader
          title="Feed"
          icon={MessageSquare}
          iconColor="text-accent-400"
          action={
            farcasterStatus?.connected ? (
              <button type="button" className="btn btn-secondary" onClick={() => setShowConnect(false)}>
                Back to Feed
              </button>
            ) : undefined
          }
        />
        <div className="max-w-lg mx-auto animate-in">
          <FarcasterConnect onComplete={() => setShowConnect(false)} />
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between page-header animate-in">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-accent-500/15 border border-accent-500/20 flex items-center justify-center">
            <MessageSquare className="w-6 h-6 text-accent-400" aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-50 font-display">Feed</h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label="Refresh feed"
          >
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>

          {farcasterStatus?.connected ? (
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-800/80 hover:bg-surface-700 transition-colors"
              onClick={() => setShowConnect(true)}
            >
              {farcasterStatus.pfpUrl ? (
                <img
                  src={farcasterStatus.pfpUrl}
                  alt={farcasterStatus.username ?? ''}
                  className="w-7 h-7 rounded-full object-cover"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-surface-700 flex items-center justify-center text-surface-400 text-xs">
                  {farcasterStatus.username?.slice(0, 2).toUpperCase() ?? '?'}
                </div>
              )}
              <span className="text-sm text-surface-200 hidden sm:inline">@{farcasterStatus.username}</span>
              <Settings className="w-4 h-4 text-surface-500" aria-hidden="true" />
            </button>
          ) : walletConnected ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowConnect(true)}>
              Connect Farcaster
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
        {/* Main feed */}
        <div className="flex-1 max-w-2xl">
          {/* Composer */}
          {farcasterStatus?.connected && (
            <div className="mb-6 animate-in">
              <CastComposer
                channelId={feedType === 'factory' ? 'factory' : undefined}
                replyTo={replyingTo}
                onClearReply={() => setReplyingTo(null)}
                onSuccess={handleRefresh}
                placeholder={feedType === 'factory' ? "Share an update..." : "Share an update..."}
              />
            </div>
          )}

          {/* Feed type tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-900/80 mb-6 animate-in" role="tablist">
            {feedTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={feedType === tab.value}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all flex-1 justify-center',
                  feedType === tab.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'text-surface-400 hover:text-surface-200',
                )}
                onClick={() => setFeedType(tab.value as FeedType)}
              >
                <tab.icon className="w-4 h-4" aria-hidden="true" />
                {tab.label}
              </button>
            ))}
            {farcasterStatus?.connected && (
              <button
                type="button"
                role="tab"
                aria-selected={feedType === 'user'}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all flex-1 justify-center',
                  feedType === 'user'
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'text-surface-400 hover:text-surface-200',
                )}
                onClick={() => setFeedType('user')}
              >
                <User className="w-4 h-4" aria-hidden="true" />
                My Casts
              </button>
            )}
          </div>

          {/* Feed content */}
          {isLoading ? (
            <LoadingState text="Loading feed..." />
          ) : !currentFeed?.casts?.length ? (
            <EmptyState
              icon={MessageSquare}
              title={
                feedType === 'factory'
                  ? 'No posts yet'
                  : feedType === 'user'
                    ? 'No posts yet'
                    : 'No trending posts'
              }
              description={
                feedType === 'factory'
                  ? 'Be the first to share an update'
                  : 'Check back later'
              }
            />
          ) : (
            <div className="space-y-4">
              {currentFeed.casts.map((cast, index) => (
                <div key={cast.hash} className="animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                  <CastCard cast={cast} onReply={handleReply} onViewProfile={handleViewProfile} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="hidden lg:block w-80">
          {/* Channel info */}
          {feedType === 'factory' && (
            <div className="card p-4 mb-4 animate-in">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-accent-500/15 flex items-center justify-center">
                  <Hash className="w-5 h-5 text-accent-400" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-surface-100">factory</h3>
                  <p className="text-sm text-surface-500">Factory Channel</p>
                </div>
              </div>
              <p className="text-sm text-surface-400">
                Share progress, find collaborators, and discuss ideas.
              </p>
            </div>
          )}

          {/* Quick links */}
          <div className="card p-4 animate-in">
            <h3 className="font-semibold text-surface-200 mb-3">Resources</h3>
            <div className="space-y-2">
              <a
                href="https://warpcast.com/~/channel/factory"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-surface-400 hover:text-factory-400 transition-colors"
              >
                Open /factory in Warpcast →
              </a>
              <a
                href="https://docs.farcaster.xyz/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-surface-400 hover:text-factory-400 transition-colors"
              >
                Farcaster Documentation →
              </a>
            </div>
          </div>

          {/* Connection CTA */}
          {!farcasterStatus?.connected && walletConnected && (
            <div className="card p-4 mt-4 animate-in">
              <h3 className="font-semibold text-surface-200 mb-2">Post updates</h3>
              <p className="text-sm text-surface-400 mb-3">
                Connect Farcaster to share updates and interact with others.
              </p>
              <button type="button" className="btn btn-primary w-full" onClick={() => setShowConnect(true)}>
                Connect Farcaster
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

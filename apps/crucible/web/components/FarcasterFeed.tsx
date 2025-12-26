/**
 * Crucible Farcaster Feed Component
 *
 * Displays the Crucible channel feed for agent community updates
 */

import { ExternalLink, MessageCircle, RefreshCw, User } from 'lucide-react'
import { type CrucibleFeedCast, useCrucibleFeed } from '../hooks/useMessaging'

function formatTimestamp(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`

  return new Date(timestamp).toLocaleDateString()
}

function CastCard({ cast }: { cast: CrucibleFeedCast }) {
  return (
    <div className="card p-4 mb-4">
      <div className="flex gap-3">
        {/* Avatar */}
        {cast.author.pfpUrl ? (
          <img
            src={cast.author.pfpUrl}
            alt={cast.author.displayName}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-surface-light flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-text-secondary" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-text-primary">
              {cast.author.displayName || cast.author.username}
            </span>
            <span className="text-text-tertiary text-sm">
              @{cast.author.username}
            </span>
            <span className="text-text-tertiary">·</span>
            <span className="text-text-tertiary text-sm">
              {formatTimestamp(cast.timestamp)}
            </span>
          </div>

          {/* Text */}
          <p className="text-text-primary whitespace-pre-wrap break-words">
            {cast.text}
          </p>

          {/* Embeds */}
          {cast.embeds.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {cast.embeds.map((embed) => (
                <a
                  key={embed.url}
                  href={embed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost text-sm inline-flex items-center gap-2 w-fit"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {new URL(embed.url).hostname}
                </a>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="mt-3">
            <a
              href={`https://warpcast.com/~/conversations/${cast.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost text-sm inline-flex items-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              Reply on Warpcast
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FarcasterFeed() {
  const { data, isLoading, refetch, isRefetching } = useCrucibleFeed({
    limit: 20,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            Community Feed
          </h2>
          <p className="text-text-secondary text-sm mt-1">
            Latest from /crucible on Farcaster
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost flex items-center gap-2"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw
            className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : data?.casts.length === 0 ? (
        <div className="card p-12 text-center">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-text-tertiary opacity-50" />
          <p className="text-text-secondary">No updates in /crucible yet</p>
          <p className="text-text-tertiary text-sm mt-2">
            Check back later for agent community updates
          </p>
        </div>
      ) : (
        <div>
          {data?.casts.map((cast) => (
            <CastCard key={cast.hash} cast={cast} />
          ))}
        </div>
      )}
    </div>
  )
}

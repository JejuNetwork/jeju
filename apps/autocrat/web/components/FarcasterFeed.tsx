/**
 * Autocrat Farcaster Feed Component
 *
 * Displays the Autocrat channel feed for governance updates
 */

import { ExternalLink, MessageCircle, RefreshCw, User } from 'lucide-react'
import { type AutocratFeedCast, useAutocratFeed } from '../hooks/useMessaging'

function formatTimestamp(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`

  return new Date(timestamp).toLocaleDateString()
}

function CastCard({ cast }: { cast: AutocratFeedCast }) {
  return (
    <div className="bg-autocrat-800 rounded-xl p-4 mb-4 border border-autocrat-700">
      <div className="flex gap-3">
        {/* Avatar */}
        {cast.author.pfpUrl ? (
          <img
            src={cast.author.pfpUrl}
            alt={cast.author.displayName}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-autocrat-700 flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-autocrat-400" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-autocrat-100">
              {cast.author.displayName || cast.author.username}
            </span>
            <span className="text-autocrat-400 text-sm">
              @{cast.author.username}
            </span>
            <span className="text-autocrat-500">·</span>
            <span className="text-autocrat-400 text-sm">
              {formatTimestamp(cast.timestamp)}
            </span>
          </div>

          {/* Text */}
          <p className="text-autocrat-200 whitespace-pre-wrap break-words">
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
                  className="inline-flex items-center gap-2 text-sm text-autocrat-300 hover:text-autocrat-100 transition-colors"
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
              className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-autocrat-700 text-autocrat-300 hover:bg-autocrat-600 hover:text-autocrat-100 transition-colors"
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
  const { data, isLoading, refetch, isRefetching } = useAutocratFeed({
    limit: 20,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-autocrat-100">
            Governance Feed
          </h2>
          <p className="text-autocrat-400 text-sm mt-1">
            Latest from /autocrat on Farcaster
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-autocrat-700 text-autocrat-300 hover:bg-autocrat-600 hover:text-autocrat-100 transition-colors"
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
        <div className="bg-autocrat-800 rounded-xl p-12 flex items-center justify-center border border-autocrat-700">
          <RefreshCw className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : data?.casts.length === 0 ? (
        <div className="bg-autocrat-800 rounded-xl p-12 text-center border border-autocrat-700">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-autocrat-500" />
          <p className="text-autocrat-300">No updates in /autocrat yet</p>
          <p className="text-autocrat-500 text-sm mt-2">
            Check back later for governance updates
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

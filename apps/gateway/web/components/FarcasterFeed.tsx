/**
 * Gateway Farcaster Feed Component
 *
 * Displays the Gateway channel feed for protocol updates
 */

import { ExternalLink, MessageCircle, RefreshCw, User } from 'lucide-react'
import { type GatewayFeedCast, useGatewayFeed } from '../hooks/useMessaging'

function formatTimestamp(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`

  return new Date(timestamp).toLocaleDateString()
}

function CastCard({ cast }: { cast: GatewayFeedCast }) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: '1rem' }}>
        {/* Avatar */}
        {cast.author.pfpUrl ? (
          <img
            src={cast.author.pfpUrl}
            alt={cast.author.displayName}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'var(--color-bg-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <User size={20} />
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.5rem',
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {cast.author.displayName || cast.author.username}
            </span>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              @{cast.author.username}
            </span>
            <span style={{ color: 'var(--color-text-secondary)' }}>·</span>
            <span
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: '0.875rem',
              }}
            >
              {formatTimestamp(cast.timestamp)}
            </span>
          </div>

          {/* Text */}
          <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {cast.text}
          </p>

          {/* Embeds */}
          {cast.embeds.length > 0 && (
            <div
              style={{
                marginTop: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {cast.embeds.map((embed) => (
                <a
                  key={embed.url}
                  href={embed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    width: 'fit-content',
                  }}
                >
                  <ExternalLink size={14} />
                  {new URL(embed.url).hostname}
                </a>
              ))}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              marginTop: '0.75rem',
              display: 'flex',
              gap: '1rem',
            }}
          >
            <a
              href={`https://warpcast.com/~/conversations/${cast.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="button button-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
              }}
            >
              <MessageCircle size={14} />
              Reply on Warpcast
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FarcasterFeed() {
  const { data, isLoading, refetch, isRefetching } = useGatewayFeed({
    limit: 20,
  })

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Gateway Updates</h2>
          <p
            style={{
              color: 'var(--color-text-secondary)',
              marginTop: '0.25rem',
            }}
          >
            Latest from /gateway on Farcaster
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => refetch()}
          disabled={isRefetching}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={16} className={isRefetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3rem',
            }}
          >
            <RefreshCw
              size={24}
              className="animate-spin"
              style={{ color: 'var(--color-primary)' }}
            />
          </div>
        </div>
      ) : data?.casts.length === 0 ? (
        <div className="card">
          <div
            style={{
              textAlign: 'center',
              padding: '3rem',
              color: 'var(--color-text-secondary)',
            }}
          >
            <MessageCircle
              size={48}
              style={{ opacity: 0.5, marginBottom: '1rem' }}
            />
            <p>No updates in /gateway yet</p>
            <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Check back later for protocol updates
            </p>
          </div>
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

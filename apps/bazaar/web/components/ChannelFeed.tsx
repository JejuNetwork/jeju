/**
 * Channel Feed Component
 *
 * Reusable component for displaying and posting to Farcaster channels.
 * Used for coin, item, perp, and prediction feeds.
 */

import {
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Send,
  User,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import type { BazaarChannel, BazaarFeedCast } from '../hooks/useMessaging'
import { useChannelFeed, useFarcasterProfile } from '../hooks/useMessaging'
import { AuthButton } from './auth/AuthButton'

function formatTimestamp(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`

  return new Date(timestamp).toLocaleDateString()
}

function CastCard({ cast }: { cast: BazaarFeedCast }) {
  return (
    <div className="card p-4 mb-3">
      <div className="flex gap-3">
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

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-text-primary">
              {cast.author.displayName || cast.author.username || 'Anonymous'}
            </span>
            {cast.author.username && (
              <>
                <span className="text-text-tertiary text-sm">
                  @{cast.author.username}
                </span>
                <span className="text-text-tertiary">·</span>
              </>
            )}
            <span className="text-text-tertiary text-sm">
              {formatTimestamp(cast.timestamp)}
            </span>
          </div>

          <p className="text-text-primary whitespace-pre-wrap break-words">
            {cast.text}
          </p>

          {cast.embeds.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {cast.embeds.map((embed) => (
                <a
                  key={embed.url}
                  href={embed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost text-xs inline-flex items-center gap-1.5 w-fit py-1 px-2"
                >
                  <ExternalLink className="w-3 h-3" />
                  {new URL(embed.url).hostname}
                </a>
              ))}
            </div>
          )}

          <div className="mt-2">
            <a
              href={`https://warpcast.com/~/conversations/${cast.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost text-xs inline-flex items-center gap-1.5 py-1 px-2"
            >
              <MessageCircle className="w-3 h-3" />
              Reply
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ComposeBoxProps {
  channel: BazaarChannel
  onSuccess?: () => void
}

function ComposeBox({ channel, onSuccess }: ComposeBoxProps) {
  const { isConnected } = useAccount()
  const { data: profile } = useFarcasterProfile()
  const [text, setText] = useState('')

  const handleSubmit = () => {
    if (!text.trim()) return

    if (!profile?.fid) {
      toast.error('Connect your Farcaster account to post')
      return
    }

    // Posting requires a signer key - redirect to Warpcast
    // When signer integration is complete, this will post directly:
    // postMutation.mutate({ text: text.trim(), fid: profile.fid, signerPrivateKey }, {
    //   onSuccess: () => { setText(''); onSuccess?.(); }
    // })
    window.open(
      `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&channelKey=${encodeURIComponent(channel.url)}`,
      '_blank',
    )
    setText('')
    onSuccess?.()
  }

  if (!isConnected) {
    return (
      <div className="card p-4 mb-4">
        <p className="text-text-secondary text-sm mb-3">
          Connect wallet to join the conversation
        </p>
        <AuthButton />
      </div>
    )
  }

  if (!profile?.fid) {
    return (
      <div className="card p-4 mb-4">
        <p className="text-text-secondary text-sm mb-2">
          Link your Farcaster account to post
        </p>
        <a
          href={channel.warpcastUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary text-sm inline-flex items-center gap-2"
        >
          <ExternalLink className="w-4 h-4" />
          Open in Warpcast
        </a>
      </div>
    )
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex gap-3">
        {profile.pfpUrl ? (
          <img
            src={profile.pfpUrl}
            alt={profile.displayName}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-surface-light flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-text-secondary" />
          </div>
        )}
        <div className="flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share your thoughts..."
            className="w-full bg-transparent border-none resize-none text-text-primary placeholder:text-text-tertiary focus:outline-none min-h-[60px]"
            maxLength={320}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-tertiary">
              {text.length}/320
            </span>
            <div className="flex gap-2">
              <a
                href={channel.warpcastUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost text-xs inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Warpcast
              </a>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!text.trim()}
                className="btn btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                Post
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ChannelFeedProps {
  channel: BazaarChannel
  limit?: number
  showCompose?: boolean
  compact?: boolean
}

export function ChannelFeed({
  channel,
  limit = 20,
  showCompose = true,
  compact = false,
}: ChannelFeedProps) {
  const { data, isLoading, refetch, isRefetching } = useChannelFeed(
    channel.url,
    { limit },
  )

  return (
    <div className={compact ? '' : 'mt-6'}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3
            className={`font-bold text-text-primary ${compact ? 'text-base' : 'text-lg'}`}
          >
            Discussion
          </h3>
          <a
            href={channel.warpcastUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-bazaar-primary hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            Open in Warpcast
          </a>
        </div>
        <button
          type="button"
          className="btn btn-ghost text-xs inline-flex items-center gap-1.5"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      {showCompose && (
        <ComposeBox channel={channel} onSuccess={() => refetch()} />
      )}

      {isLoading ? (
        <div className="card p-8 flex items-center justify-center">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : data?.casts.length === 0 ? (
        <div className="card p-8 text-center">
          <MessageCircle className="w-10 h-10 mx-auto mb-3 text-text-tertiary opacity-50" />
          <p className="text-text-secondary text-sm">No posts yet</p>
          <p className="text-text-tertiary text-xs mt-1">
            Be the first to start the conversation
          </p>
          <a
            href={channel.warpcastUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary text-sm mt-4 inline-flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            Post on Warpcast
          </a>
        </div>
      ) : (
        <div>
          {data?.casts.map((cast) => (
            <CastCard key={cast.hash} cast={cast} />
          ))}
          {data?.cursor && (
            <div className="text-center">
              <a
                href={channel.warpcastUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost text-sm inline-flex items-center gap-2"
              >
                View more on Warpcast
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { ComposeBox, CastCard }

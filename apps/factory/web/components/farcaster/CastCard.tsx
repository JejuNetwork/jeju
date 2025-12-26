/**
 * Cast Card Component
 *
 * Displays a single Farcaster cast with author info, reactions, and actions.
 */

import {
  Copy,
  ExternalLink,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { Cast } from '../../hooks/useFarcaster'
import {
  useDeleteCast,
  useFarcasterStatus,
  useLikeCast,
  useRecastCast,
  useUnlikeCast,
  useUnrecastCast,
} from '../../hooks/useFarcaster'

interface CastCardProps {
  cast: Cast
  onReply?: (cast: Cast) => void
  onViewProfile?: (fid: number) => void
  compact?: boolean
}

export function CastCard({
  cast,
  onReply,
  onViewProfile,
  compact,
}: CastCardProps) {
  const { data: status } = useFarcasterStatus()
  const [showMenu, setShowMenu] = useState(false)

  const likeMutation = useLikeCast()
  const unlikeMutation = useUnlikeCast()
  const recastMutation = useRecastCast()
  const unrecastMutation = useUnrecastCast()
  const deleteMutation = useDeleteCast()

  const isMyPost = status?.fid === cast.author.fid
  const isConnected = status?.connected

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    if (days < 7) return `${days}d`
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  const handleLike = () => {
    if (!isConnected) return

    if (cast.reactions.viewerLiked) {
      unlikeMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    } else {
      likeMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    }
  }

  const handleRecast = () => {
    if (!isConnected) return

    if (cast.reactions.viewerRecasted) {
      unrecastMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    } else {
      recastMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    }
  }

  const handleDelete = () => {
    if (!isMyPost) return
    if (confirm('Are you sure you want to delete this cast?')) {
      deleteMutation.mutate(cast.hash)
    }
    setShowMenu(false)
  }

  const handleCopyLink = () => {
    const url = `https://warpcast.com/${cast.author.username}/${cast.hash.slice(0, 10)}`
    navigator.clipboard.writeText(url)
    setShowMenu(false)
  }

  const handleOpenWarpcast = () => {
    window.open(
      `https://warpcast.com/${cast.author.username}/${cast.hash.slice(0, 10)}`,
      '_blank',
    )
    setShowMenu(false)
  }

  return (
    <div className={`card p-4 ${compact ? '' : 'card-hover'}`}>
      <div className="flex gap-3">
        {/* Avatar */}
        <button
          type="button"
          className="flex-shrink-0"
          onClick={() => onViewProfile?.(cast.author.fid)}
        >
          {cast.author.pfpUrl ? (
            <img
              src={cast.author.pfpUrl}
              alt={cast.author.username}
              className="w-10 h-10 rounded-full object-cover hover:ring-2 ring-accent-500 transition-all"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-factory-700 flex items-center justify-center text-factory-400">
              {cast.author.username.slice(0, 2).toUpperCase()}
            </div>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                className="font-medium text-factory-100 hover:text-accent-400 truncate"
                onClick={() => onViewProfile?.(cast.author.fid)}
              >
                {cast.author.displayName || cast.author.username}
              </button>
              <span className="text-factory-500 text-sm truncate">
                @{cast.author.username}
              </span>
              <span className="text-factory-600">·</span>
              <span className="text-factory-500 text-sm flex-shrink-0">
                {formatTimestamp(cast.timestamp)}
              </span>
            </div>

            {/* More menu */}
            <div className="relative">
              <button
                type="button"
                className="p-1 rounded hover:bg-factory-800 text-factory-500 hover:text-factory-300"
                onClick={() => setShowMenu(!showMenu)}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showMenu && (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="fixed inset-0 z-10 bg-transparent border-none cursor-default"
                    onClick={() => setShowMenu(false)}
                    onKeyDown={(e) => e.key === 'Escape' && setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-20 card py-1 min-w-[160px]">
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-factory-200 hover:bg-factory-800 flex items-center gap-2"
                      onClick={handleCopyLink}
                    >
                      <Copy className="w-4 h-4" />
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-factory-200 hover:bg-factory-800 flex items-center gap-2"
                      onClick={handleOpenWarpcast}
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open in Warpcast
                    </button>
                    {isMyPost && (
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-factory-800 flex items-center gap-2"
                        onClick={handleDelete}
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Channel badge */}
          {cast.channel && (
            <div className="mb-2">
              <span className="badge badge-info text-xs">
                /{cast.channel.id}
              </span>
            </div>
          )}

          {/* Content */}
          <div className="text-factory-100 whitespace-pre-wrap break-words mb-3">
            {cast.text}
          </div>

          {/* Embeds */}
          {cast.embeds.length > 0 && (
            <div className="mb-3 space-y-2">
              {cast.embeds.map((embed) =>
                embed.url ? (
                  <a
                    key={embed.url}
                    href={embed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 rounded-lg bg-factory-900 border border-factory-700 hover:border-factory-600 transition-colors"
                  >
                    {embed.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img
                        src={embed.url}
                        alt="Embedded content"
                        className="max-w-full max-h-80 rounded"
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-accent-400 text-sm">
                        <ExternalLink className="w-4 h-4" />
                        <span className="truncate">{embed.url}</span>
                      </div>
                    )}
                  </a>
                ) : null,
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-6 -ml-2">
            {/* Reply */}
            <button
              type="button"
              className="flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-accent-500/10 text-factory-500 hover:text-accent-400 transition-colors group"
              onClick={() => onReply?.(cast)}
              disabled={!isConnected}
            >
              <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span className="text-sm">{cast.replies}</span>
            </button>

            {/* Recast */}
            <button
              type="button"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-green-500/10 transition-colors group ${
                cast.reactions.viewerRecasted
                  ? 'text-green-400'
                  : 'text-factory-500 hover:text-green-400'
              }`}
              onClick={handleRecast}
              disabled={
                !isConnected ||
                recastMutation.isPending ||
                unrecastMutation.isPending
              }
            >
              <Repeat2
                className={`w-4 h-4 group-hover:scale-110 transition-transform ${
                  cast.reactions.viewerRecasted ? 'fill-current' : ''
                }`}
              />
              <span className="text-sm">{cast.reactions.recasts}</span>
            </button>

            {/* Like */}
            <button
              type="button"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-red-500/10 transition-colors group ${
                cast.reactions.viewerLiked
                  ? 'text-red-400'
                  : 'text-factory-500 hover:text-red-400'
              }`}
              onClick={handleLike}
              disabled={
                !isConnected ||
                likeMutation.isPending ||
                unlikeMutation.isPending
              }
            >
              <Heart
                className={`w-4 h-4 group-hover:scale-110 transition-transform ${
                  cast.reactions.viewerLiked ? 'fill-current' : ''
                }`}
              />
              <span className="text-sm">{cast.reactions.likes}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

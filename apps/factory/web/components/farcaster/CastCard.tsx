import { clsx } from 'clsx'
import {
  Copy,
  ExternalLink,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Trash2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Cast } from '../../hooks/useFarcaster'
import {
  useDeleteCast,
  useFarcasterStatus,
  useLikeCast,
  useRecastCast,
  useUnlikeCast,
  useUnrecastCast,
} from '../../hooks/useFarcaster'
import { formatShortRelativeTime } from '../../lib/format'

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

  const handleLike = useCallback(() => {
    if (!isConnected) return
    if (cast.reactions.viewerLiked) {
      unlikeMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    } else {
      likeMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    }
  }, [isConnected, cast, likeMutation, unlikeMutation])

  const handleRecast = useCallback(() => {
    if (!isConnected) return
    if (cast.reactions.viewerRecasted) {
      unrecastMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    } else {
      recastMutation.mutate({ castHash: cast.hash, castFid: cast.author.fid })
    }
  }, [isConnected, cast, recastMutation, unrecastMutation])

  const handleDelete = useCallback(() => {
    if (!isMyPost) return
    if (confirm('Are you sure you want to delete this cast?')) {
      deleteMutation.mutate(cast.hash)
    }
    setShowMenu(false)
  }, [isMyPost, cast.hash, deleteMutation])

  const handleCopyLink = useCallback(() => {
    const url = `https://warpcast.com/${cast.author.username}/${cast.hash.slice(0, 10)}`
    navigator.clipboard.writeText(url)
    setShowMenu(false)
  }, [cast])

  const handleOpenWarpcast = useCallback(() => {
    window.open(
      `https://warpcast.com/${cast.author.username}/${cast.hash.slice(0, 10)}`,
      '_blank',
    )
    setShowMenu(false)
  }, [cast])

  return (
    <div className={clsx('card p-4', !compact && 'card-hover')}>
      <div className="flex gap-3">
        {/* Avatar */}
        <button
          type="button"
          className="flex-shrink-0"
          onClick={() => onViewProfile?.(cast.author.fid)}
          aria-label={`View ${cast.author.username}'s profile`}
        >
          {cast.author.pfpUrl ? (
            <img
              src={cast.author.pfpUrl}
              alt={cast.author.username}
              className="w-10 h-10 rounded-full object-cover hover:ring-2 ring-factory-500 transition-all"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-surface-700 flex items-center justify-center text-surface-400">
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
                className="font-medium text-surface-100 hover:text-factory-400 truncate transition-colors"
                onClick={() => onViewProfile?.(cast.author.fid)}
              >
                {cast.author.displayName || cast.author.username}
              </button>
              <span className="text-surface-500 text-sm truncate">
                @{cast.author.username}
              </span>
              <span className="text-surface-600" aria-hidden="true">
                ·
              </span>
              <span className="text-surface-500 text-sm flex-shrink-0">
                {formatShortRelativeTime(cast.timestamp)}
              </span>
            </div>

            {/* More menu */}
            <div className="relative">
              <button
                type="button"
                className="p-1 rounded-lg hover:bg-surface-800 text-surface-500 hover:text-surface-300 transition-colors"
                onClick={() => setShowMenu(!showMenu)}
                aria-label="More options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showMenu && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 bg-transparent border-none cursor-default"
                    onClick={() => setShowMenu(false)}
                    aria-label="Close menu"
                  />
                  <div className="absolute right-0 top-full mt-1 z-20 card py-1 min-w-[160px]">
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 flex items-center gap-2 transition-colors"
                      onClick={handleCopyLink}
                    >
                      <Copy className="w-4 h-4" />
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 flex items-center gap-2 transition-colors"
                      onClick={handleOpenWarpcast}
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open in Warpcast
                    </button>
                    {isMyPost && (
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-error-400 hover:bg-surface-800 flex items-center gap-2 transition-colors"
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
          <div className="text-surface-100 whitespace-pre-wrap break-words mb-3">
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
                    className="block p-3 rounded-xl bg-surface-900/80 border border-surface-800 hover:border-surface-700 transition-colors"
                  >
                    {embed.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img
                        src={embed.url}
                        alt="Embedded content"
                        className="max-w-full max-h-80 rounded-lg"
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-factory-400 text-sm">
                        <ExternalLink className="w-4 h-4" aria-hidden="true" />
                        <span className="truncate">{embed.url}</span>
                      </div>
                    )}
                  </a>
                ) : null,
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-4 sm:gap-6 -ml-2">
            {/* Reply */}
            <button
              type="button"
              className="flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-factory-500/10 text-surface-500 hover:text-factory-400 transition-colors group"
              onClick={() => onReply?.(cast)}
              disabled={!isConnected}
              aria-label={`Reply to cast (${cast.replies} replies)`}
            >
              <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span className="text-sm">{cast.replies}</span>
            </button>

            {/* Recast */}
            <button
              type="button"
              className={clsx(
                'flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-success-500/10 transition-colors group',
                cast.reactions.viewerRecasted
                  ? 'text-success-400'
                  : 'text-surface-500 hover:text-success-400',
              )}
              onClick={handleRecast}
              disabled={
                !isConnected ||
                recastMutation.isPending ||
                unrecastMutation.isPending
              }
              aria-label={`Recast (${cast.reactions.recasts} recasts)`}
              aria-pressed={cast.reactions.viewerRecasted}
            >
              <Repeat2
                className={clsx(
                  'w-4 h-4 group-hover:scale-110 transition-transform',
                  cast.reactions.viewerRecasted && 'fill-current',
                )}
              />
              <span className="text-sm">{cast.reactions.recasts}</span>
            </button>

            {/* Like */}
            <button
              type="button"
              className={clsx(
                'flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-error-500/10 transition-colors group',
                cast.reactions.viewerLiked
                  ? 'text-error-400'
                  : 'text-surface-500 hover:text-error-400',
              )}
              onClick={handleLike}
              disabled={
                !isConnected ||
                likeMutation.isPending ||
                unlikeMutation.isPending
              }
              aria-label={`Like (${cast.reactions.likes} likes)`}
              aria-pressed={cast.reactions.viewerLiked}
            >
              <Heart
                className={clsx(
                  'w-4 h-4 group-hover:scale-110 transition-transform',
                  cast.reactions.viewerLiked && 'fill-current',
                )}
              />
              <span className="text-sm">{cast.reactions.likes}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

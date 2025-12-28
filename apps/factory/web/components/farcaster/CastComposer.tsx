import { clsx } from 'clsx'
import { Link2, Loader2, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Cast,
  useFarcasterStatus,
  usePublishCast,
} from '../../hooks/useFarcaster'

interface CastComposerProps {
  channelId?: string
  replyTo?: Cast | null
  onClearReply?: () => void
  onSuccess?: () => void
  placeholder?: string
  autoFocus?: boolean
}

const MAX_CAST_LENGTH = 320

export function CastComposer({
  channelId,
  replyTo,
  onClearReply,
  onSuccess,
  placeholder = 'Share an update...',
  autoFocus = false,
}: CastComposerProps) {
  const { data: status } = useFarcasterStatus()
  const publishMutation = usePublishCast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [text, setText] = useState('')
  const [embedUrl, setEmbedUrl] = useState('')
  const [showEmbedInput, setShowEmbedInput] = useState(false)

  const isConnected = status?.connected
  const remainingChars = MAX_CAST_LENGTH - text.length
  const isOverLimit = remainingChars < 0
  const canSubmit = text.trim().length > 0 && !isOverLimit && isConnected

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [])

  // Auto-focus
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return

    const embeds = embedUrl.trim() ? [{ url: embedUrl.trim() }] : undefined

    await publishMutation.mutateAsync({
      text: text.trim(),
      channelId,
      parentHash: replyTo?.hash,
      embeds,
    })

    setText('')
    setEmbedUrl('')
    setShowEmbedInput(false)
    onClearReply?.()
    onSuccess?.()
  }, [
    canSubmit,
    embedUrl,
    text,
    channelId,
    replyTo,
    publishMutation,
    onClearReply,
    onSuccess,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  if (!isConnected) {
    return (
      <div className="card p-4 text-center">
        <p className="text-surface-400 text-sm">Connect Farcaster to post</p>
      </div>
    )
  }

  return (
    <div className="card p-4">
      {/* Reply indicator */}
      {replyTo && (
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-surface-800/50">
          <div className="flex items-center gap-2 text-sm text-surface-400">
            <span>Replying to</span>
            <span className="text-factory-400">@{replyTo.author.username}</span>
          </div>
          <button
            type="button"
            className="p-1 rounded-lg hover:bg-surface-800 text-surface-500 transition-colors"
            onClick={onClearReply}
            aria-label="Cancel reply"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Author info */}
      <div className="flex items-start gap-3">
        {status.pfpUrl ? (
          <img
            src={status.pfpUrl}
            alt={status.username ?? ''}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-surface-700 flex items-center justify-center text-surface-400">
            {status.username?.slice(0, 2).toUpperCase() ?? '?'}
          </div>
        )}

        <div className="flex-1">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent border-none resize-none focus:outline-none text-surface-100 placeholder-surface-500 min-h-[60px]"
            rows={1}
            disabled={publishMutation.isPending}
            aria-label="Cast content"
          />

          {/* Embed input */}
          {showEmbedInput && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="url"
                value={embedUrl}
                onChange={(e) => setEmbedUrl(e.target.value)}
                placeholder="Enter URL..."
                className="input flex-1 text-sm py-1.5"
                aria-label="Embed URL"
              />
              <button
                type="button"
                className="p-1.5 rounded-lg hover:bg-surface-800 text-surface-500 transition-colors"
                onClick={() => {
                  setShowEmbedInput(false)
                  setEmbedUrl('')
                }}
                aria-label="Remove URL"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Channel indicator */}
          {channelId && (
            <div className="mt-2">
              <span className="badge badge-info text-xs">
                Posting to /{channelId}
              </span>
            </div>
          )}

          {/* Actions bar */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-800/50">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={clsx(
                  'p-2 rounded-lg hover:bg-surface-800 transition-colors',
                  showEmbedInput
                    ? 'text-factory-400'
                    : 'text-surface-500 hover:text-factory-400',
                )}
                onClick={() => setShowEmbedInput(!showEmbedInput)}
                title="Add link"
                aria-label="Add link"
              >
                <Link2 className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              {/* Character count */}
              <span
                className={clsx(
                  'text-sm',
                  isOverLimit
                    ? 'text-error-400'
                    : remainingChars < 50
                      ? 'text-warning-400'
                      : 'text-surface-500',
                )}
                title={`${remainingChars} characters remaining`}
              >
                {remainingChars}
              </span>

              {/* Submit button */}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit || publishMutation.isPending}
              >
                {publishMutation.isPending ? (
                  <Loader2
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Send className="w-4 h-4" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">
                  {replyTo ? 'Reply' : 'Cast'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

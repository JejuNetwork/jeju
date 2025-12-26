/**
 * Cast Composer Component
 *
 * Form for composing and publishing new Farcaster casts.
 */

import { Send, X, Image, Link2, AtSign, Loader2 } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { usePublishCast, useFarcasterStatus, type Cast } from '../../hooks/useFarcaster'

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
  placeholder = "What's happening?",
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

  // Auto-resize textarea based on content
  // biome-ignore lint/correctness/useExhaustiveDependencies: text changes should trigger resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [text])

  // Auto-focus
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  const handleSubmit = async () => {
    if (!canSubmit) return

    const embeds = embedUrl.trim()
      ? [{ url: embedUrl.trim() }]
      : undefined

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
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!isConnected) {
    return (
      <div className="card p-4 text-center">
        <p className="text-factory-400 text-sm">
          Connect your Farcaster account to post
        </p>
      </div>
    )
  }

  return (
    <div className="card p-4">
      {/* Reply indicator */}
      {replyTo && (
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-factory-800">
          <div className="flex items-center gap-2 text-sm text-factory-400">
            <span>Replying to</span>
            <span className="text-accent-400">@{replyTo.author.username}</span>
          </div>
          <button
            type="button"
            className="p-1 rounded hover:bg-factory-800 text-factory-500"
            onClick={onClearReply}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Author info */}
      <div className="flex items-start gap-3">
        {status?.pfpUrl ? (
          <img
            src={status.pfpUrl}
            alt={status.username ?? ''}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-factory-700 flex items-center justify-center text-factory-400">
            {status?.username?.slice(0, 2).toUpperCase() ?? '?'}
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
            className="w-full bg-transparent border-none resize-none focus:outline-none text-factory-100 placeholder-factory-500 min-h-[60px]"
            rows={1}
            disabled={publishMutation.isPending}
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
              />
              <button
                type="button"
                className="p-1.5 rounded hover:bg-factory-800 text-factory-500"
                onClick={() => {
                  setShowEmbedInput(false)
                  setEmbedUrl('')
                }}
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
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-factory-800">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-factory-800 text-factory-500 hover:text-accent-400 transition-colors"
                onClick={() => setShowEmbedInput(!showEmbedInput)}
                title="Add link"
              >
                <Link2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-factory-800 text-factory-500 hover:text-accent-400 transition-colors opacity-50 cursor-not-allowed"
                title="Add image (coming soon)"
                disabled
              >
                <Image className="w-5 h-5" />
              </button>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-factory-800 text-factory-500 hover:text-accent-400 transition-colors opacity-50 cursor-not-allowed"
                title="Mention user (coming soon)"
                disabled
              >
                <AtSign className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              {/* Character count */}
              <span
                className={`text-sm ${
                  isOverLimit
                    ? 'text-red-400'
                    : remainingChars < 50
                      ? 'text-amber-400'
                      : 'text-factory-500'
                }`}
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
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
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

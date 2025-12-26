/**
 * Message Thread Component
 *
 * Displays messages in a conversation with input for sending new messages
 */

import {
  ArrowLeft,
  AtSign,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  MoreVertical,
  Send,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation, Message } from '../../../api/services/messaging'

interface MessageThreadProps {
  conversation: Conversation | null
  messages: Message[]
  isLoading: boolean
  isSending: boolean
  onSend: (text: string) => void
  onBack: () => void
  onBlock: () => void
}

export function MessageThread({
  conversation,
  messages,
  isLoading,
  isSending,
  onSend,
  onBack,
  onBlock,
}: MessageThreadProps) {
  const [inputValue, setInputValue] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally scroll on messages.length change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Auto-resize textarea
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value)
      e.target.style.height = 'auto'
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
    },
    [],
  )

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text || isSending) return

    onSend(text)
    setInputValue('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [inputValue, isSending, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return 'Today'
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    }
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
  }

  // Group messages by date
  const groupedMessages = messages.reduce<
    Array<{ date: string; messages: Message[] }>
  >((groups, message) => {
    const date = formatDate(message.timestamp)
    const lastGroup = groups[groups.length - 1]

    if (lastGroup && lastGroup.date === date) {
      lastGroup.messages.push(message)
    } else {
      groups.push({ date, messages: [message] })
    }

    return groups
  }, [])

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center mb-6">
          <Send className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Select a conversation</h3>
        <p className="text-muted-foreground max-w-md">
          Choose a conversation from the list to start messaging, or start a new
          conversation.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card/50">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-secondary"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Avatar */}
          {conversation.recipientAvatar ? (
            <img
              src={conversation.recipientAvatar}
              alt={conversation.recipientName}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
              {conversation.type === 'farcaster' ? (
                <AtSign className="w-4 h-4 text-purple-400" />
              ) : (
                <Wallet className="w-4 h-4 text-emerald-400" />
              )}
            </div>
          )}

          <div>
            <h3 className="font-semibold">{conversation.recipientName}</h3>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {conversation.type === 'farcaster' ? (
                <>
                  <AtSign className="w-3 h-3 text-purple-400" />
                  <span>Farcaster</span>
                  {conversation.recipientFid && (
                    <span>• FID {conversation.recipientFid}</span>
                  )}
                </>
              ) : (
                <>
                  <Wallet className="w-3 h-3 text-emerald-400" />
                  <span>XMTP</span>
                  {conversation.recipientAddress && (
                    <span className="font-mono">
                      • {conversation.recipientAddress.slice(0, 6)}...
                      {conversation.recipientAddress.slice(-4)}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-lg hover:bg-secondary"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {showMenu && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-xl shadow-lg z-20 overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    onBlock()
                    setShowMenu(false)
                  }}
                  className="w-full px-4 py-2.5 text-sm text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Block User
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-muted-foreground">No messages yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Send a message to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedMessages.map((group) => (
              <div key={group.date}>
                {/* Date divider */}
                <div className="flex items-center justify-center mb-4">
                  <span className="px-3 py-1 text-xs text-muted-foreground bg-secondary/50 rounded-full">
                    {group.date}
                  </span>
                </div>

                {/* Messages */}
                <div className="space-y-2">
                  {group.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${
                        message.isFromMe ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          message.isFromMe
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
                            : 'bg-secondary'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {message.text}
                        </p>

                        <div
                          className={`flex items-center justify-end gap-1.5 mt-1 ${
                            message.isFromMe
                              ? 'text-white/70'
                              : 'text-muted-foreground'
                          }`}
                        >
                          <span className="text-xs">
                            {formatTime(message.timestamp)}
                          </span>

                          {/* Status indicator */}
                          {message.isFromMe && (
                            <>
                              {message.status === 'sending' && (
                                <Clock className="w-3 h-3" />
                              )}
                              {message.status === 'sent' && (
                                <Check className="w-3 h-3" />
                              )}
                              {message.status === 'delivered' && (
                                <CheckCheck className="w-3 h-3" />
                              )}
                              {message.status === 'read' && (
                                <CheckCheck className="w-3 h-3 text-blue-300" />
                              )}
                              {message.status === 'failed' && (
                                <X className="w-3 h-3 text-red-300" />
                              )}
                            </>
                          )}

                          {/* Protocol badge */}
                          {message.protocol === 'farcaster' && (
                            <AtSign className="w-3 h-3" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border bg-card/50">
        <div className="flex items-end gap-3">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={isSending}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 disabled:opacity-50 transition-all"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            className="w-12 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white disabled:opacity-50 hover:shadow-lg hover:shadow-emerald-500/20 flex items-center justify-center transition-all flex-shrink-0"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

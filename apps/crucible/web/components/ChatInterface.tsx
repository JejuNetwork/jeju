import { useCallback, useEffect, useRef, useState } from 'react'
import { type ChatResponse, useChat } from '../hooks'
import { formatDistanceToNow } from '../lib/utils'
import { LoadingSpinner } from './LoadingSpinner'

interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
  actions?: ChatResponse['actions']
  agentName?: string
}

interface ChatInterfaceProps {
  characterId: string
  characterName: string
}

const ACTION_ICONS: Record<string, string> = {
  TRANSFER: '💸',
  SWAP: '🔄',
  VOTE: '🗳️',
  STAKE: '🔒',
  UNSTAKE: '🔓',
  PROPOSE: '📝',
  EXECUTE: '⚡',
  MINT: '🌟',
  BURN: '🔥',
  APPROVE: '✅',
  DEFAULT: '🔧',
}

export function ChatInterface({
  characterId,
  characterName,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chat = useChat()

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  useEffect(() => {
    setMessages([])
    setInput('')
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedInput = input.trim()
    if (!trimmedInput || chat.isPending) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')

    setIsTyping(true)

    const response = await chat.mutateAsync({
      characterId,
      text: trimmedInput,
      userId: 'web-user',
      roomId: 'web-chat',
    })

    setIsTyping(false)

    const agentMessage: Message = {
      id: `agent-${Date.now()}`,
      role: 'agent',
      content: response.text,
      timestamp: Date.now(),
      actions: response.actions,
      agentName: characterName,
    }

    setMessages((prev) => [...prev, agentMessage])
  }

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[400px] max-h-[800px] gap-4">
      {/* Main Chat Area */}
      <div className="card-static flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center gap-3 p-4 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)' }}
            role="img"
            aria-label="Agent"
          >
            🤖
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="font-bold truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {characterName}
            </h3>
            <p
              className="text-sm flex items-center gap-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <span className="status-dot-active" aria-hidden="true" />
              {isTyping ? 'Typing...' : 'Online'}
            </p>
          </div>
        </div>

        {/* Messages Area */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4"
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
        >
          {/* Empty State */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <div className="text-4xl mb-4 animate-float" aria-hidden="true">
                💬
              </div>
              <p
                className="font-medium mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                No messages yet
              </p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Type below to start chatting with {characterName}
              </p>
            </div>
          )}

          {/* Message List */}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex justify-start animate-slide-up">
              <div
                className="flex items-center gap-2 px-4 py-3 rounded-2xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{
                      backgroundColor: 'var(--text-tertiary)',
                      animationDelay: '0ms',
                    }}
                  />
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{
                      backgroundColor: 'var(--text-tertiary)',
                      animationDelay: '150ms',
                    }}
                  />
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{
                      backgroundColor: 'var(--text-tertiary)',
                      animationDelay: '300ms',
                    }}
                  />
                </div>
                <span
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {characterName} is typing
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} aria-hidden="true" />
        </div>

        {/* Input Area */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t flex-shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="input flex-1"
              disabled={chat.isPending}
              aria-label="Message"
            />
            <button
              type="submit"
              disabled={!input.trim() || chat.isPending}
              className="btn-primary px-5 sm:px-6 flex-shrink-0"
              aria-label="Send"
            >
              {chat.isPending ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <span className="hidden sm:inline">Send</span>
                  <svg
                    className="w-5 h-5 sm:hidden"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </>
              )}
            </button>
          </div>

          {/* Error Message */}
          {chat.isError && (
            <div
              className="mt-3 p-3 rounded-lg"
              style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)' }}
              role="alert"
            >
              <p className="text-sm" style={{ color: 'var(--color-error)' }}>
                {chat.error.message}
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

interface MessageBubbleProps {
  message: Message
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-slide-up`}
    >
      <div className={`max-w-[80%] ${isUser ? '' : 'flex gap-2'}`}>
        {!isUser && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
            style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)' }}
          >
            🤖
          </div>
        )}
        <div>
          {!isUser && message.agentName && (
            <p
              className="text-xs font-medium mb-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {message.agentName}
            </p>
          )}
          <div className={isUser ? 'chat-bubble-user' : 'chat-bubble-agent'}>
            <p className="whitespace-pre-wrap">{message.content}</p>

            {/* Action Results */}
            {message.actions && message.actions.length > 0 && (
              <div
                className="mt-3 pt-3 border-t space-y-2"
                style={{
                  borderColor: isUser
                    ? 'rgba(255,255,255,0.2)'
                    : 'var(--border)',
                }}
              >
                <p
                  className="text-xs font-medium"
                  style={{
                    color: isUser
                      ? 'rgba(255,255,255,0.7)'
                      : 'var(--text-tertiary)',
                  }}
                >
                  Actions Executed:
                </p>
                {message.actions.map((action, idx) => (
                  <ActionResult
                    key={`${action.type ?? 'action'}-${idx}`}
                    action={action}
                    isUserMessage={isUser}
                  />
                ))}
              </div>
            )}
          </div>
          <p
            className={`text-xs mt-1 ${isUser ? 'text-right' : ''}`}
            style={{ color: 'var(--text-tertiary)' }}
          >
            {formatDistanceToNow(message.timestamp)}
          </p>
        </div>
      </div>
    </div>
  )
}

interface ActionResultProps {
  action: {
    type: string
    success: boolean
    result?: { txHash?: string; error?: string }
  }
  isUserMessage: boolean
}

function ActionResult({ action, isUserMessage }: ActionResultProps) {
  const actionType = action.type ?? 'UNKNOWN'
  const icon = ACTION_ICONS[actionType.toUpperCase()] ?? ACTION_ICONS.DEFAULT
  const txHash = action.result?.txHash

  return (
    <div
      className="flex items-start gap-2 p-2 rounded-lg text-xs"
      style={{
        backgroundColor: isUserMessage
          ? 'rgba(255,255,255,0.1)'
          : 'var(--bg-secondary)',
      }}
    >
      <span className="text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="font-mono font-medium">{actionType}</code>
          <span
            className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
              action.success
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {action.success ? '✓' : '✗'}
          </span>
        </div>
        {txHash && (
          <a
            href={`https://explorer.jeju.network/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1 hover:underline"
            style={{ color: 'var(--color-primary)' }}
          >
            <span className="font-mono truncate max-w-[120px]">
              {txHash.slice(0, 10)}...{txHash.slice(-6)}
            </span>
            <svg
              className="w-3 h-3 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}
        {action.result?.error && (
          <p className="mt-1 text-red-400">{action.result.error}</p>
        )}
      </div>
    </div>
  )
}

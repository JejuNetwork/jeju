/**
 * Chat Interface Component
 *
 * Real-time chat interface with an AI agent
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { type ChatResponse, useChat } from '../hooks'
import { LoadingSpinner } from './LoadingSpinner'

interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
  actions?: ChatResponse['actions']
}

interface ChatInterfaceProps {
  characterId: string
  characterName: string
  roomId?: string
}

export function ChatInterface({
  characterId,
  characterName,
  roomId,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chat = useChat()

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  // Clear messages when switching characters
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

    const response = await chat.mutateAsync({
      characterId,
      text: trimmedInput,
      userId: 'web-user',
      roomId: roomId ?? 'web-chat',
    })

    const agentMessage: Message = {
      id: `agent-${Date.now()}`,
      role: 'agent',
      content: response.text,
      timestamp: Date.now(),
      actions: response.actions,
    }

    setMessages((prev) => [...prev, agentMessage])
  }

  return (
    <div className="card-static flex flex-col h-[calc(100vh-220px)] min-h-[400px] max-h-[800px] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="text-2xl" role="img" aria-label="Agent">
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
            Ready
          </p>
        </div>
        {roomId && <span className="badge-info text-xs">{roomId}</span>}
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
              Type below to start
            </p>
          </div>
        )}

        {/* Message List */}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
          >
            <div
              className={
                message.role === 'user'
                  ? 'chat-bubble-user'
                  : 'chat-bubble-agent'
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>

              {/* Action Results */}
              {message.actions && message.actions.length > 0 && (
                <div
                  className="mt-3 pt-3 border-t space-y-1.5"
                  style={{
                    borderColor:
                      message.role === 'user'
                        ? 'rgba(255,255,255,0.2)'
                        : 'var(--border)',
                  }}
                >
                  <p
                    className="text-xs font-medium mb-2"
                    style={{
                      color:
                        message.role === 'user'
                          ? 'rgba(255,255,255,0.7)'
                          : 'var(--text-tertiary)',
                    }}
                  >
                    Actions:
                  </p>
                  {message.actions.map((action, idx) => (
                    <div
                      key={`${action.type}-${idx}`}
                      className="text-xs flex items-center gap-2"
                    >
                      <span
                        className={
                          action.success ? 'text-green-400' : 'text-red-400'
                        }
                        title={action.success ? 'Success' : 'Failed'}
                      >
                        {action.success ? '✓' : '✗'}
                      </span>
                      <code className="font-mono">{action.type}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing Indicator */}
        {chat.isPending && (
          <div className="flex justify-start animate-slide-up">
            <div className="chat-bubble-agent flex items-center gap-2">
              <LoadingSpinner size="sm" />
              <span style={{ color: 'var(--text-tertiary)' }}>Thinking</span>
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
            placeholder="Type a message"
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
  )
}

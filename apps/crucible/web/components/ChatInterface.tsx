/**
 * Chat Interface Component
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
  const chat = useChat()

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || chat.isPending) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')

    const response = await chat.mutateAsync({
      characterId,
      text: userMessage.content,
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
    <div className="flex flex-col h-[600px] card-static overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3">
          <div className="text-2xl">🤖</div>
          <div>
            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
              {characterName}
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Online
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4">💬</div>
            <p style={{ color: 'var(--text-secondary)' }}>
              Start a conversation with {characterName}
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={
                message.role === 'user'
                  ? 'chat-bubble-user'
                  : 'chat-bubble-agent'
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.actions && message.actions.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/20 space-y-1">
                  {message.actions.map((action) => (
                    <div
                      key={`${action.type}-${action.success}`}
                      className="text-xs flex items-center gap-2"
                    >
                      <span
                        className={
                          action.success ? 'text-green-300' : 'text-red-300'
                        }
                      >
                        {action.success ? '✓' : '✗'}
                      </span>
                      <span className="font-mono">{action.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {chat.isPending && (
          <div className="flex justify-start">
            <div className="chat-bubble-agent flex items-center gap-2">
              <LoadingSpinner size="sm" />
              <span style={{ color: 'var(--text-tertiary)' }}>Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ${characterName}...`}
            className="input flex-1"
            disabled={chat.isPending}
          />
          <button
            type="submit"
            disabled={!input.trim() || chat.isPending}
            className="btn-primary px-6"
          >
            {chat.isPending ? <LoadingSpinner size="sm" /> : 'Send'}
          </button>
        </div>
        {chat.isError && (
          <p className="mt-2 text-sm text-red-500">{chat.error.message}</p>
        )}
      </form>
    </div>
  )
}

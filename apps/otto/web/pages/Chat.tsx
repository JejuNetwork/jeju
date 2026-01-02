import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, SendIcon, SettingsIcon } from '../components/Icons'

interface Props {
  onNavigate: (page: 'landing' | 'onboard' | 'configure' | 'chat') => void
  sessionId: string | null
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export function Chat({ onNavigate, sessionId: initialSessionId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content:
        "Hey there. I'm Otto, your AI trading assistant. I can help you swap tokens, bridge across chains, check prices, launch tokens, and more.\n\nWhat would you like to do?",
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const initSession = useCallback(async () => {
    const response = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const data = await response.json()
    setSessionId(data.sessionId)
  }, [])

  // Initialize session if needed
  useEffect(() => {
    if (!sessionId) {
      initSession()
    }
  }, [sessionId, initSession])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setIsLoading(true)

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMessage])

    // Send to API
    const response = await fetch('/api/chat/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId ?? '',
      },
      body: JSON.stringify({ message: text }),
    })

    const data = await response.json()

    // Add assistant response
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content:
        data.message?.content ??
        data.response ??
        'I encountered an error processing your request.',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, assistantMessage])
    setIsLoading(false)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const quickCommands = [
    { label: 'Check ETH price', command: 'price ETH' },
    { label: 'My balance', command: 'balance' },
    { label: 'Swap 0.1 ETH to USDC', command: 'swap 0.1 ETH to USDC' },
    { label: 'Help', command: 'help' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-pattern" />
      <div className="grid-pattern" />

      {/* Header */}
      <header className="relative z-10 border-b border-surface-border backdrop-blur-xl bg-otto-darker/80">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate('landing')}
              className="text-white/60 hover:text-white transition-colors"
            >
              <span className="w-6 h-6 block">
                <ArrowLeftIcon />
              </span>
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-xl flex items-center justify-center text-lg shadow-lg shadow-otto-cyan/30">
                O
              </div>
              <div>
                <h1 className="font-bold">Otto</h1>
                <p className="text-xs text-otto-green">Online</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('configure')}
            className="p-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          >
            <span className="w-5 h-5 block">
              <SettingsIcon />
            </span>
          </button>
        </div>
      </header>

      {/* Chat Messages */}
      <main className="flex-1 relative z-10 overflow-hidden">
        <div className="h-full max-w-4xl mx-auto flex flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-xl flex items-center justify-center text-xs flex-shrink-0">
                  O
                </div>
                <div className="bg-surface-elevated border border-surface-border rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span
                      className="w-2 h-2 bg-white/40 rounded-full animate-bounce"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="w-2 h-2 bg-white/40 rounded-full animate-bounce"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="w-2 h-2 bg-white/40 rounded-full animate-bounce"
                      style={{ animationDelay: '300ms' }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Commands */}
          {messages.length <= 1 && (
            <div className="px-6 pb-4">
              <p className="text-sm text-white/40 mb-3">Quick commands:</p>
              <div className="flex flex-wrap gap-2">
                {quickCommands.map((cmd) => (
                  <button
                    type="button"
                    key={cmd.command}
                    onClick={() => setInput(cmd.command)}
                    className="px-4 py-2 bg-surface-elevated border border-surface-border rounded-xl text-sm hover:border-otto-cyan/50 transition-all"
                  >
                    {cmd.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-6 pb-6">
            <div className="flex gap-3 bg-surface-elevated border border-surface-border rounded-2xl p-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Send a message..."
                className="flex-1 bg-transparent px-4 py-3 text-white placeholder-white/40 focus:outline-none"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={isLoading || !input.trim()}
                className={`w-12 h-12 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-xl flex items-center justify-center transition-all ${
                  isLoading || !input.trim()
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:scale-105 hover:shadow-lg hover:shadow-otto-cyan/30'
                }`}
              >
                <span className="w-5 h-5 text-black">
                  <SendIcon />
                </span>
              </button>
            </div>
            <p className="text-center text-xs text-white/30 mt-3">
              Otto can make mistakes. Verify important transactions.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  // Format message content - simple text-based rendering
  const formatContent = (content: string) => {
    const lines = content.split('\n')
    return lines.map((line, i) => (
      <p key={`${message.id}-line-${i}`} className="mb-1 last:mb-0">
        {line || '\u00A0'}
      </p>
    ))
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="bg-gradient-to-br from-otto-cyan to-[#0099ff] text-black rounded-2xl rounded-br-md px-4 py-3 max-w-[80%]">
          <p>{message.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-xl flex items-center justify-center text-xs flex-shrink-0">
        O
      </div>
      <div className="bg-surface-elevated border border-surface-border rounded-2xl rounded-bl-md px-4 py-3 max-w-[80%]">
        {formatContent(message.content)}
      </div>
    </div>
  )
}

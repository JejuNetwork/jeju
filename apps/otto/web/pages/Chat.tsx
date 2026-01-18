/**
 * Otto Chat Interface
 */

import type { FormEvent, KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  pending?: boolean
}

interface PendingAction {
  type: 'swap' | 'bridge' | 'launch'
  description: string
  details: Record<string, string | number>
}

interface ChatProps {
  sessionId: string
  walletAddress: string | null
  onConnect: () => Promise<void>
  onBack: () => void
}

export function Chat({
  sessionId,
  walletAddress,
  onConnect,
  onBack,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hey! I'm Otto, your AI trading assistant. I can help you swap tokens, bridge assets, launch tokens, and check your portfolio. What would you like to do?",
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [connecting, setConnecting] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, userMessage])
      setInput('')
      setLoading(true)

      // Add a pending message
      const pendingId = crypto.randomUUID()
      setMessages((prev) => [
        ...prev,
        {
          id: pendingId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          pending: true,
        },
      ])

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId,
            ...(walletAddress && { 'X-Wallet-Address': walletAddress }),
          },
          body: JSON.stringify({ message: text.trim() }),
        })

        if (!response.ok) {
          throw new Error(`Chat request failed: ${response.status}`)
        }

        const data = (await response.json()) as {
          response: string
          pendingAction?: PendingAction
          sessionId?: string
        }

        // Replace pending message with actual response
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === pendingId
              ? { ...msg, content: data.response, pending: false }
              : msg,
          ),
        )

        if (data.pendingAction) {
          setPendingAction(data.pendingAction)
        }
      } catch (error) {
        console.error('Chat error:', error)
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === pendingId
              ? {
                  ...msg,
                  content: "Sorry, I couldn't process that. Please try again.",
                  pending: false,
                }
              : msg,
          ),
        )
      } finally {
        setLoading(false)
      }
    },
    [sessionId, walletAddress, loading],
  )

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      sendMessage(input)
    },
    [input, sendMessage],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage(input)
      }
    },
    [input, sendMessage],
  )

  const handleConfirm = useCallback(() => {
    sendMessage('confirm')
    setPendingAction(null)
  }, [sendMessage])

  const handleCancel = useCallback(() => {
    sendMessage('cancel')
    setPendingAction(null)
  }, [sendMessage])

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    try {
      await onConnect()
    } catch (error) {
      console.error('Connection error:', error)
    } finally {
      setConnecting(false)
    }
  }, [onConnect])

  const quickActions = [
    { label: 'Check Balance', message: 'What is my balance?' },
    { label: 'Swap ETH', message: 'Swap 0.1 ETH to USDC' },
    { label: 'Price of ETH', message: 'What is the price of ETH?' },
    { label: 'Help', message: 'What can you do?' },
  ]

  return (
    <div className="chat-container">
      <header className="chat-header">
        <button
          type="button"
          className="back-button"
          onClick={onBack}
          aria-label="Go back"
        >
          ←
        </button>
        <div className="chat-title">
          <span className="chat-logo">🤖</span>
          <span>Otto</span>
        </div>
        {walletAddress ? (
          <div className="wallet-connected">
            <span className="wallet-indicator" />
            <span className="wallet-address">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="connect-button"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}
      </header>

      <div className="messages-container">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.role} ${message.pending ? 'pending' : ''}`}
          >
            {message.role === 'assistant' && (
              <span className="message-avatar">🤖</span>
            )}
            <div className="message-content">
              {message.pending ? (
                <span className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                message.content
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {pendingAction && (
        <div className="pending-action">
          <div className="pending-action-header">
            <span className="pending-icon">⚡</span>
            <span>Confirm {pendingAction.type}</span>
          </div>
          <p className="pending-description">{pendingAction.description}</p>
          <div className="pending-details">
            {Object.entries(pendingAction.details).map(([key, value]) => (
              <div key={key} className="pending-detail">
                <span className="detail-key">{key}:</span>
                <span className="detail-value">{value}</span>
              </div>
            ))}
          </div>
          <div className="pending-actions">
            <button
              type="button"
              className="confirm-button"
              onClick={handleConfirm}
            >
              Confirm
            </button>
            <button
              type="button"
              className="cancel-button"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="quick-actions">
        {quickActions.map((action) => (
          <button
            type="button"
            key={action.label}
            className="quick-action"
            onClick={() => sendMessage(action.message)}
            disabled={loading}
          >
            {action.label}
          </button>
        ))}
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (e.g., 'swap 1 ETH to USDC')"
          disabled={loading}
        />
        <button
          type="submit"
          className="send-button"
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  )
}

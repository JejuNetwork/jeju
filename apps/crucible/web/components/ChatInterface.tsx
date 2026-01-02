import { useCallback, useEffect, useRef, useState } from 'react'
import { type ChatResponse, useChat } from '../hooks'
import { formatDistanceToNow } from '../lib/utils'
import { LoadingSpinner } from './LoadingSpinner'

interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  actions?: ChatResponse['actions']
  agentName?: string
}

interface RoomMember {
  agentId: string
  name: string
  role: string
  lastActive?: number
}

interface ChatInterfaceProps {
  characterId: string
  characterName: string
  roomId?: string
  roomType?: 'collaboration' | 'adversarial' | 'debate' | 'council'
  members?: RoomMember[]
  showMemberSidebar?: boolean
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
  roomId,
  roomType,
  members = [],
  showMemberSidebar = false,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [typingAgents, setTypingAgents] = useState<string[]>([])
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

    // Add system message for room
    if (roomType) {
      const systemMessage: Message = {
        id: 'system-welcome',
        role: 'system',
        content: getRoomWelcomeMessage(roomType),
        timestamp: Date.now(),
      }
      setMessages([systemMessage])
    }
  }, [roomType])

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
    setTypingAgents([characterName])

    const response = await chat.mutateAsync({
      characterId,
      text: trimmedInput,
      userId: 'web-user',
      roomId: roomId ?? 'web-chat',
    })

    setIsTyping(false)
    setTypingAgents([])

    const agentMessage: Message = {
      id: `agent-${Date.now()}`,
      role: 'agent',
      content: response.text,
      timestamp: Date.now(),
      actions: response.actions,
      agentName: characterName,
    }

    setMessages((prev) => [...prev, agentMessage])

    // Show notification for executed actions
    if (response.actions && response.actions.length > 0) {
      const successCount = response.actions.filter((a) => a.success).length
      if (successCount > 0) {
        // Could integrate with toast here
      }
    }
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
          {roomType && (
            <span
              className="badge text-xs"
              style={{
                backgroundColor: getRoomTypeColor(roomType),
                color: 'white',
              }}
            >
              {roomType}
            </span>
          )}
          {roomId && (
            <span
              className="text-xs font-mono px-2 py-1 rounded"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-tertiary)',
              }}
            >
              {roomId.slice(0, 8)}...
            </span>
          )}
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
          {isTyping && typingAgents.length > 0 && (
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
                  {typingAgents.join(', ')}{' '}
                  {typingAgents.length > 1 ? 'are' : 'is'} typing
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

      {/* Member Sidebar */}
      {showMemberSidebar && members.length > 0 && (
        <div className="hidden lg:flex flex-col w-64 card-static overflow-hidden flex-shrink-0">
          <div
            className="p-4 border-b flex-shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
              Members ({members.length})
            </h3>
          </div>
          <ul className="flex-1 overflow-y-auto p-2 space-y-1">
            {members.map((member) => (
              <li
                key={member.agentId}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-secondary)]"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                  style={{
                    backgroundColor: `hsl(${(parseInt(member.agentId, 10) * 137) % 360}, 70%, 50%)`,
                    color: 'white',
                  }}
                >
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {member.name}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {member.role}
                  </p>
                </div>
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      member.lastActive &&
                      Date.now() - member.lastActive < 60000
                        ? 'var(--color-success)'
                        : 'var(--text-tertiary)',
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

interface MessageBubbleProps {
  message: Message
}

function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center animate-fade-in">
        <div
          className="px-4 py-2 rounded-full text-sm text-center max-w-md"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-tertiary)',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

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
                    key={`${action.type}-${idx}`}
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
  const icon = ACTION_ICONS[action.type.toUpperCase()] ?? ACTION_ICONS.DEFAULT
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
          <code className="font-mono font-medium">{action.type}</code>
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

function getRoomTypeColor(type: string): string {
  const colors: Record<string, string> = {
    collaboration: 'rgb(16, 185, 129)',
    adversarial: 'rgb(239, 68, 68)',
    debate: 'rgb(245, 158, 11)',
    council: 'rgb(99, 102, 241)',
  }
  return colors[type] ?? colors.collaboration
}

function getRoomWelcomeMessage(type: string): string {
  const messages: Record<string, string> = {
    collaboration:
      'Welcome to the collaboration room. Work together to achieve your goals.',
    adversarial:
      'Red Team vs Blue Team. The battle begins. May the best team win.',
    debate:
      'Welcome to the debate. Present your arguments clearly and respectfully.',
    council:
      'Council session started. Proposals will be voted on by all members.',
  }
  return messages[type] ?? 'Welcome to the chat room.'
}

/**
 * Messages Page
 *
 * Direct Cast (encrypted DM) interface for Factory.
 * End-to-end encrypted messaging between Farcaster users.
 */

import {
  Archive,
  BellOff,
  Check,
  CheckCheck,
  Loader2,
  Lock,
  MessageSquare,
  MoreVertical,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { FarcasterConnect } from '../components/farcaster'
import { useFarcasterStatus } from '../hooks/useFarcaster'
import {
  type Conversation,
  type Message,
  useArchiveConversation,
  useConversations,
  useMarkAsRead,
  useMessages,
  useMessagingStatus,
  useMuteConversation,
  useReconnect,
  useSearchUsers,
  useSendMessage,
} from '../hooks/useMessages'

export function MessagesPage() {
  const { isConnected: walletConnected } = useAccount()
  const { data: farcasterStatus, isLoading: statusLoading } =
    useFarcasterStatus()
  const { data: messagingStatus } = useMessagingStatus()
  const { data: conversationsData, isLoading: conversationsLoading } =
    useConversations()
  const reconnect = useReconnect()

  const [selectedFid, setSelectedFid] = useState<number | null>(null)
  const [showNewConversation, setShowNewConversation] = useState(false)

  const conversations = conversationsData?.conversations ?? []

  // If not connected to Farcaster, show connect prompt
  if (!farcasterStatus?.connected && walletConnected && !statusLoading) {
    return (
      <div className="min-h-screen p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
              <MessageSquare className="w-7 h-7 text-accent-400" />
              Messages
            </h1>
            <p className="text-factory-400 mt-1">
              End-to-end encrypted direct messages
            </p>
          </div>
        </div>

        <div className="max-w-lg mx-auto">
          <FarcasterConnect />
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-factory-800">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <MessageSquare className="w-7 h-7 text-accent-400" />
            Messages
            {messagingStatus?.unreadCount ? (
              <span className="px-2 py-0.5 text-xs rounded-full bg-accent-500 text-white">
                {messagingStatus.unreadCount}
              </span>
            ) : null}
          </h1>
          <p className="text-factory-400 mt-1 flex items-center gap-2">
            <Lock className="w-3 h-3" />
            End-to-end encrypted with Direct Casts
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection status */}
          <div
            className={`w-2 h-2 rounded-full ${
              messagingStatus?.connected ? 'bg-green-400' : 'bg-factory-500'
            }`}
          />
          <span className="text-sm text-factory-400">
            {messagingStatus?.connected ? 'Connected' : 'Disconnected'}
          </span>

          {/* Reconnect button */}
          {!messagingStatus?.connected && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => reconnect.mutate()}
              disabled={reconnect.isPending}
            >
              <RefreshCw
                className={`w-4 h-4 ${reconnect.isPending ? 'animate-spin' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversation list */}
        <div className="w-80 border-r border-factory-800 flex flex-col">
          {/* Search/New conversation */}
          <div className="p-4 border-b border-factory-800">
            <button
              type="button"
              className="btn btn-primary w-full"
              onClick={() => setShowNewConversation(true)}
            >
              New Message
            </button>
          </div>

          {/* Conversations */}
          <div className="flex-1 overflow-y-auto">
            {conversationsLoading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-factory-500" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 text-factory-600" />
                <p className="text-factory-400 text-sm">No conversations yet</p>
                <p className="text-factory-500 text-xs mt-1">
                  Start a new conversation to chat
                </p>
              </div>
            ) : (
              <div className="divide-y divide-factory-800">
                {conversations.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isSelected={selectedFid === conv.otherUser?.fid}
                    onClick={() => {
                      if (conv.otherUser?.fid) {
                        setSelectedFid(conv.otherUser.fid)
                        setShowNewConversation(false)
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Message area */}
        <div className="flex-1 flex flex-col">
          {showNewConversation ? (
            <NewConversation
              onSelect={(fid) => {
                setSelectedFid(fid)
                setShowNewConversation(false)
              }}
              onCancel={() => setShowNewConversation(false)}
            />
          ) : selectedFid ? (
            <MessageThread recipientFid={selectedFid} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 text-factory-700" />
                <h3 className="text-lg font-medium text-factory-300 mb-2">
                  Select a conversation
                </h3>
                <p className="text-factory-500 text-sm">
                  Choose an existing conversation or start a new one
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function ConversationItem({
  conversation,
  isSelected,
  onClick,
}: {
  conversation: Conversation
  isSelected: boolean
  onClick: () => void
}) {
  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const days = Math.floor(diff / 86400000)

    if (days === 0) {
      return new Date(timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    }
    if (days < 7) {
      return new Date(timestamp).toLocaleDateString('en-US', {
        weekday: 'short',
      })
    }
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <button
      type="button"
      className={`w-full p-4 text-left hover:bg-factory-800 transition-colors ${
        isSelected ? 'bg-factory-800' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {conversation.otherUser?.pfpUrl ? (
          <img
            src={conversation.otherUser.pfpUrl}
            alt={conversation.otherUser.username}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-factory-700 flex items-center justify-center text-factory-400 flex-shrink-0">
            {conversation.otherUser?.username?.slice(0, 2).toUpperCase() ?? '?'}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-factory-100 truncate">
              {conversation.otherUser?.displayName ||
                conversation.otherUser?.username ||
                'Unknown'}
            </span>
            {conversation.lastMessage && (
              <span className="text-xs text-factory-500 flex-shrink-0 ml-2">
                {formatTime(conversation.lastMessage.timestamp)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-factory-400 truncate flex-1">
              {conversation.lastMessage?.text ?? 'No messages yet'}
            </p>
            {conversation.unreadCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-accent-500 text-white flex-shrink-0">
                {conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function NewConversation({
  onSelect,
  onCancel,
}: {
  onSelect: (fid: number) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const { data: searchResults, isLoading } = useSearchUsers(query)

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-factory-800">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-factory-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username..."
            className="flex-1 bg-transparent border-none focus:outline-none text-factory-100 placeholder-factory-500"
          />
          <button
            type="button"
            className="text-factory-400 hover:text-factory-200 text-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-factory-500" />
          </div>
        ) : query.length < 2 ? (
          <div className="p-8 text-center">
            <p className="text-factory-500 text-sm">
              Enter a username to search
            </p>
          </div>
        ) : searchResults?.users.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-factory-400 text-sm">No users found</p>
          </div>
        ) : (
          <div className="divide-y divide-factory-800">
            {searchResults?.users.map((user) => (
              <button
                key={user.fid}
                type="button"
                className="w-full p-4 text-left hover:bg-factory-800 transition-colors"
                onClick={() => onSelect(user.fid)}
              >
                <div className="flex items-center gap-3">
                  {user.pfpUrl ? (
                    <img
                      src={user.pfpUrl}
                      alt={user.username}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-factory-700 flex items-center justify-center text-factory-400">
                      {user.username.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-factory-100">
                      {user.displayName || user.username}
                    </p>
                    <p className="text-sm text-factory-400">@{user.username}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageThread({ recipientFid }: { recipientFid: number }) {
  const { data: messagesData, isLoading } = useMessages(recipientFid)
  const sendMessage = useSendMessage()
  const markAsRead = useMarkAsRead()
  const muteConversation = useMuteConversation()
  const archiveConversation = useArchiveConversation()

  const [messageText, setMessageText] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const messages = messagesData?.messages ?? []

  // Mark as read when viewing
  // biome-ignore lint/correctness/useExhaustiveDependencies: markAsRead should not trigger re-run
  useEffect(() => {
    if (recipientFid && messages.length > 0) {
      markAsRead.mutate(recipientFid)
    }
  }, [recipientFid, messages.length])

  // Scroll to bottom on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages changes should trigger scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!messageText.trim()) return

    await sendMessage.mutateAsync({
      recipientFid,
      text: messageText.trim(),
    })

    setMessageText('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-factory-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-factory-700 flex items-center justify-center text-factory-400 text-sm">
            {recipientFid}
          </div>
          <span className="font-medium text-factory-100">
            FID: {recipientFid}
          </span>
        </div>

        {/* Menu */}
        <div className="relative">
          <button
            type="button"
            className="p-2 rounded hover:bg-factory-800 text-factory-500"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {showMenu && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-10 bg-transparent border-none cursor-default"
                onClick={() => setShowMenu(false)}
                onKeyDown={(e) => e.key === 'Escape' && setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 card py-1 min-w-[160px]">
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-factory-200 hover:bg-factory-800 flex items-center gap-2"
                  onClick={() => {
                    archiveConversation.mutate(recipientFid)
                    setShowMenu(false)
                  }}
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </button>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-factory-200 hover:bg-factory-800 flex items-center gap-2"
                  onClick={() => {
                    muteConversation.mutate({ recipientFid, muted: true })
                    setShowMenu(false)
                  }}
                >
                  <BellOff className="w-4 h-4" />
                  Mute
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-factory-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <Lock className="w-8 h-8 mx-auto mb-3 text-factory-600" />
            <p className="text-factory-400 text-sm">
              Messages are end-to-end encrypted
            </p>
            <p className="text-factory-500 text-xs mt-1">
              Start the conversation below
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-factory-800">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="input flex-1"
            disabled={sendMessage.isPending}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSend}
            disabled={!messageText.trim() || sendMessage.isPending}
          >
            {sendMessage.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div
      className={`flex ${message.isFromMe ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[70%] rounded-2xl px-4 py-2 ${
          message.isFromMe
            ? 'bg-accent-600 text-white rounded-br-md'
            : 'bg-factory-800 text-factory-100 rounded-bl-md'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <div
          className={`flex items-center gap-1 mt-1 ${
            message.isFromMe ? 'justify-end' : 'justify-start'
          }`}
        >
          <span
            className={`text-xs ${
              message.isFromMe ? 'text-white/60' : 'text-factory-500'
            }`}
          >
            {formatTime(message.timestamp)}
          </span>
          {message.isFromMe &&
            (message.isRead ? (
              <CheckCheck className="w-3 h-3 text-white/60" />
            ) : (
              <Check className="w-3 h-3 text-white/60" />
            ))}
        </div>
      </div>
    </div>
  )
}

import {
  AtSign,
  MessageCircle,
  Search,
  Volume2,
  VolumeX,
  Wallet,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Conversation } from '../../../api/services/messaging'

interface ConversationListProps {
  conversations: Conversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  onMute: (id: string, muted: boolean) => void
  isLoading: boolean
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onMute,
  isLoading,
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations
    const query = searchQuery.toLowerCase()
    return conversations.filter(
      (c) =>
        c.recipientName.toLowerCase().includes(query) ||
        c.recipientAddress?.toLowerCase().includes(query),
    )
  }, [conversations, searchQuery])

  const formatTime = (timestamp: number): string => {
    const now = Date.now()
    const diff = now - timestamp

    if (diff < 60_000) return 'now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d`

    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-border">
          <div className="h-10 bg-secondary/50 rounded-xl animate-pulse" />
        </div>
        <div className="flex-1 p-2 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 bg-secondary/30 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary/50 border border-border focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm transition-all"
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <MessageCircle className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Start a new conversation to get going
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredConversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                className={`w-full flex items-start gap-3 p-3 rounded-xl transition-all text-left group ${
                  selectedId === conv.id
                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                    : 'hover:bg-secondary/50 border border-transparent'
                }`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  {conv.recipientAvatar ? (
                    <img
                      src={conv.recipientAvatar}
                      alt={conv.recipientName}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                      {conv.type === 'farcaster' ? (
                        <AtSign className="w-5 h-5 text-purple-400" />
                      ) : (
                        <Wallet className="w-5 h-5 text-emerald-400" />
                      )}
                    </div>
                  )}

                  {/* Protocol indicator */}
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center ${
                      conv.type === 'farcaster'
                        ? 'bg-purple-500'
                        : 'bg-emerald-500'
                    }`}
                  >
                    {conv.type === 'farcaster' ? (
                      <AtSign className="w-2.5 h-2.5 text-white" />
                    ) : (
                      <Wallet className="w-2.5 h-2.5 text-white" />
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-medium truncate ${
                        conv.unreadCount > 0
                          ? 'text-foreground'
                          : 'text-foreground/80'
                      }`}
                    >
                      {conv.recipientName}
                    </span>
                    {conv.lastMessage && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatTime(conv.lastMessage.timestamp)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    {conv.lastMessage ? (
                      <p
                        className={`text-sm truncate ${
                          conv.unreadCount > 0
                            ? 'text-foreground/80 font-medium'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {conv.lastMessage.isFromMe && (
                          <span className="text-muted-foreground">You: </span>
                        )}
                        {conv.lastMessage.text}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No messages yet
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {conv.isMuted && (
                        <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                      {conv.unreadCount > 0 && (
                        <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-xs font-medium flex items-center justify-center">
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mute button (on hover) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMute(conv.id, !conv.isMuted)
                  }}
                  className="absolute right-3 top-3 p-1.5 rounded-lg bg-secondary/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-secondary"
                  title={conv.isMuted ? 'Unmute' : 'Mute'}
                >
                  {conv.isMuted ? (
                    <Volume2 className="w-3.5 h-3.5" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5" />
                  )}
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

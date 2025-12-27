/**
 * Messages View Component
 *
 * Main messaging interface combining conversation list and message thread
 */

import { Mail, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { Address } from 'viem'
import {
  useConversations,
  useMarkAsRead,
  useMessages,
  useMessaging,
  useMessagingPreferences,
  useMuteConversation,
  useSendMessage,
} from '../../hooks/useMessaging'
import { ConversationList } from './ConversationList'
import { FarcasterConnect } from './FarcasterConnect'
import { MessageThread } from './MessageThread'
import { NewConversation } from './NewConversation'

interface MessagesViewProps {
  address: Address
}

export function MessagesView(_props: MessagesViewProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null)
  const [showNewConversation, setShowNewConversation] = useState(false)

  // Hooks
  const { isInitialized, hasFarcasterAccount } = useMessaging()
  const { data: conversations, isLoading: conversationsLoading } =
    useConversations()
  const { data: messages, isLoading: messagesLoading } = useMessages(
    selectedConversationId,
  )
  const sendMessage = useSendMessage()
  const markAsRead = useMarkAsRead()
  const muteConversation = useMuteConversation()
  const { blockAddress, blockFid } = useMessagingPreferences()

  // Find selected conversation
  const selectedConversation = useMemo(
    () => conversations?.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  )

  // Mark conversation as read when selected
  const handleSelectConversation = useCallback(
    (id: string) => {
      setSelectedConversationId(id)
      markAsRead.mutate(id)
    },
    [markAsRead],
  )

  // Handle mute
  const handleMute = useCallback(
    (id: string, muted: boolean) => {
      muteConversation.mutate({ conversationId: id, muted })
    },
    [muteConversation],
  )

  // Handle send message
  const handleSend = useCallback(
    (text: string) => {
      if (!selectedConversation) return

      sendMessage.mutate({
        recipientAddress: selectedConversation.recipientAddress,
        recipientFid: selectedConversation.recipientFid,
        text,
      })
    },
    [selectedConversation, sendMessage],
  )

  // Handle block
  const handleBlock = useCallback(() => {
    if (!selectedConversation) return

    if (selectedConversation.recipientFid) {
      blockFid.mutate(selectedConversation.recipientFid)
    } else if (selectedConversation.recipientAddress) {
      blockAddress.mutate(selectedConversation.recipientAddress)
    }

    setSelectedConversationId(null)
  }, [selectedConversation, blockAddress, blockFid])

  // Handle new conversation
  const handleNewConversation = useCallback(
    (params: {
      recipientAddress?: Address
      recipientFid?: number
      recipientName: string
      recipientAvatar?: string
    }) => {
      // Create temp conversation ID based on recipient
      const tempId = params.recipientFid
        ? `fc-temp-${params.recipientFid}`
        : `xmtp-temp-${params.recipientAddress}`

      // For now, just select and start messaging
      // The conversation will be created on first message
      setSelectedConversationId(tempId)
      setShowNewConversation(false)

      // Immediately send a message to create the conversation
      // (This is a UX choice - could also just open an empty thread)
    },
    [],
  )

  // Handle back (mobile)
  const handleBack = useCallback(() => {
    setSelectedConversationId(null)
  }, [])

  if (!isInitialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 flex items-center justify-center mb-6 animate-pulse shadow-xl shadow-sky-500/10">
          <Mail className="w-10 h-10 text-sky-400" />
        </div>
        <h3 className="text-xl font-bold mb-2">Initializing Messaging</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Setting up your encrypted messaging channels...
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-background">
      {/* Farcaster Connect Banner (if not connected) */}
      {!hasFarcasterAccount && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <FarcasterConnect />
        </div>
      )}

      {/* Conversation List (sidebar) */}
      <div
        className={`w-full lg:w-80 xl:w-96 border-r border-border flex-shrink-0 ${
          selectedConversationId
            ? 'hidden lg:flex lg:flex-col'
            : 'flex flex-col'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20">
              <Mail className="w-5 h-5 text-sky-400" />
            </div>
            <h2 className="text-lg font-bold">Messages</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowNewConversation(true)}
            aria-label="New conversation"
            className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <ConversationList
          conversations={conversations ?? []}
          selectedId={selectedConversationId}
          onSelect={handleSelectConversation}
          onMute={handleMute}
          isLoading={conversationsLoading}
        />
      </div>

      {/* Message Thread (main area) */}
      <div
        className={`flex-1 ${
          selectedConversationId
            ? 'flex flex-col'
            : 'hidden lg:flex lg:flex-col'
        }`}
      >
        <MessageThread
          conversation={selectedConversation}
          messages={messages ?? []}
          isLoading={messagesLoading}
          isSending={sendMessage.isPending}
          onSend={handleSend}
          onBack={handleBack}
          onBlock={handleBlock}
        />
      </div>

      {/* New Conversation Modal */}
      <NewConversation
        isOpen={showNewConversation}
        onClose={() => setShowNewConversation(false)}
        onStartConversation={handleNewConversation}
      />
    </div>
  )
}

export default MessagesView

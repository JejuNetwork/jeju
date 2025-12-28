import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import * as dcService from '../services/direct-cast'
import {
  getLinkedFid,
  getUser,
  isFarcasterConnected,
} from '../services/farcaster'

const SendMessageBodySchema = t.Object({
  recipientFid: t.Number({ minimum: 1 }),
  text: t.String({ minLength: 1, maxLength: 2000 }),
  embeds: t.Optional(t.Array(t.Object({ url: t.String() }))),
  replyTo: t.Optional(t.String()),
})

const ConversationParamsSchema = t.Object({
  fid: t.String(),
})

const MessagesQuerySchema = t.Object({
  before: t.Optional(t.String()),
  after: t.Optional(t.String()),
  limit: t.Optional(t.String()),
})

export const messagesRoutes = new Elysia({ prefix: '/api/messages' })
  // Get all conversations
  .get(
    '/',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      if (!isFarcasterConnected(address)) {
        set.status = 401
        return {
          error: {
            code: 'NOT_CONNECTED',
            message: 'Please connect your Farcaster account first',
          },
        }
      }

      const conversations = await dcService.getConversations(address)

      // Enrich conversations with participant profiles
      const enrichedConversations = await Promise.all(
        conversations.map(async (conv) => {
          const link = getLinkedFid(address)
          const otherFid = conv.participants.find((fid) => fid !== link?.fid)
          let otherUser = null

          if (otherFid) {
            otherUser = await getUser(otherFid)
          }

          return {
            id: conv.id,
            participants: conv.participants,
            otherUser: otherUser
              ? {
                  fid: otherUser.fid,
                  username: otherUser.username,
                  displayName: otherUser.displayName,
                  pfpUrl: otherUser.pfpUrl,
                }
              : null,
            unreadCount: conv.unreadCount,
            lastMessage: conv.lastMessage
              ? {
                  id: conv.lastMessage.id,
                  text: conv.lastMessage.text,
                  senderFid: conv.lastMessage.senderFid,
                  timestamp: conv.lastMessage.timestamp,
                }
              : null,
            isMuted: conv.isMuted ?? false,
            isArchived: conv.isArchived ?? false,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
          }
        }),
      )

      return {
        conversations: enrichedConversations,
      }
    },
    {
      detail: {
        tags: ['messages'],
        summary: 'Get conversations',
        description: 'Get all Direct Cast conversations',
      },
    },
  )
  // Get client state (connection status, unread count)
  .get(
    '/status',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      if (!isFarcasterConnected(address)) {
        return {
          connected: false,
          isInitialized: false,
          unreadCount: 0,
        }
      }

      const state = await dcService.getClientState(address)
      if (!state) {
        return {
          connected: false,
          isInitialized: false,
          unreadCount: 0,
        }
      }

      return {
        connected: state.isConnected,
        isInitialized: state.isInitialized,
        conversationCount: state.conversationCount,
        unreadCount: state.unreadCount,
        fid: state.fid,
      }
    },
    {
      detail: {
        tags: ['messages'],
        summary: 'Get messaging status',
        description: 'Get Direct Cast client status and unread count',
      },
    },
  )
  // Get or create conversation with a user
  .get(
    '/conversation/:fid',
    async ({ params, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      if (!isFarcasterConnected(address)) {
        set.status = 401
        return {
          error: {
            code: 'NOT_CONNECTED',
            message: 'Please connect your Farcaster account first',
          },
        }
      }

      const recipientFid = parseInt(params.fid, 10)
      const conversation = await dcService.getConversation(
        address,
        recipientFid,
      )

      if (!conversation) {
        set.status = 404
        return {
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        }
      }

      // Get recipient profile
      const otherUser = await getUser(recipientFid)

      return {
        conversation: {
          id: conversation.id,
          participants: conversation.participants,
          otherUser: otherUser
            ? {
                fid: otherUser.fid,
                username: otherUser.username,
                displayName: otherUser.displayName,
                pfpUrl: otherUser.pfpUrl,
              }
            : null,
          unreadCount: conversation.unreadCount,
          isMuted: conversation.isMuted ?? false,
          isArchived: conversation.isArchived ?? false,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      }
    },
    {
      params: ConversationParamsSchema,
      detail: {
        tags: ['messages'],
        summary: 'Get conversation',
        description: 'Get or create a conversation with a user',
      },
    },
  )
  // Get messages in a conversation
  .get(
    '/conversation/:fid/messages',
    async ({ params, query, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      if (!isFarcasterConnected(address)) {
        set.status = 401
        return {
          error: {
            code: 'NOT_CONNECTED',
            message: 'Please connect your Farcaster account first',
          },
        }
      }

      const recipientFid = parseInt(params.fid, 10)
      const limit = query.limit ? parseInt(query.limit, 10) : 50

      const messages = await dcService.getMessages(address, recipientFid, {
        before: query.before,
        after: query.after,
        limit,
      })

      // Get user profiles for message authors
      const link = getLinkedFid(address)
      const myFid = link?.fid

      return {
        messages: messages.map((msg) => ({
          id: msg.id,
          conversationId: msg.conversationId,
          senderFid: msg.senderFid,
          recipientFid: msg.recipientFid,
          text: msg.text,
          embeds: msg.embeds ?? [],
          replyTo: msg.replyTo,
          timestamp: msg.timestamp,
          isRead: msg.isRead,
          isFromMe: msg.senderFid === myFid,
        })),
      }
    },
    {
      params: ConversationParamsSchema,
      query: MessagesQuerySchema,
      detail: {
        tags: ['messages'],
        summary: 'Get messages',
        description: 'Get messages in a conversation',
      },
    },
  )
  // Send a message
  .post(
    '/',
    async ({ body, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      if (!isFarcasterConnected(address)) {
        set.status = 401
        return {
          error: {
            code: 'NOT_CONNECTED',
            message: 'Please connect your Farcaster account first',
          },
        }
      }

      const message = await dcService.sendDirectMessage(
        address,
        body.recipientFid,
        body.text,
        {
          embeds: body.embeds,
          replyTo: body.replyTo,
        },
      )

      set.status = 201
      return {
        success: true,
        message: {
          id: message.id,
          conversationId: message.conversationId,
          senderFid: message.senderFid,
          recipientFid: message.recipientFid,
          text: message.text,
          timestamp: message.timestamp,
        },
      }
    },
    {
      body: SendMessageBodySchema,
      detail: {
        tags: ['messages'],
        summary: 'Send message',
        description: 'Send a Direct Cast message',
      },
    },
  )
  // Mark conversation as read
  .post(
    '/conversation/:fid/read',
    async ({ params, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const recipientFid = parseInt(params.fid, 10)
      await dcService.markConversationAsRead(address, recipientFid)

      return { success: true }
    },
    {
      params: ConversationParamsSchema,
      detail: {
        tags: ['messages'],
        summary: 'Mark as read',
        description: 'Mark a conversation as read',
      },
    },
  )
  // Archive conversation
  .post(
    '/conversation/:fid/archive',
    async ({ params, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const recipientFid = parseInt(params.fid, 10)
      await dcService.archiveConversation(address, recipientFid)

      return { success: true }
    },
    {
      params: ConversationParamsSchema,
      detail: {
        tags: ['messages'],
        summary: 'Archive conversation',
        description: 'Archive a conversation',
      },
    },
  )
  // Mute/unmute conversation
  .post(
    '/conversation/:fid/mute',
    async ({ params, body, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const recipientFid = parseInt(params.fid, 10)
      await dcService.setConversationMuted(address, recipientFid, body.muted)

      return { success: true }
    },
    {
      params: ConversationParamsSchema,
      body: t.Object({ muted: t.Boolean() }),
      detail: {
        tags: ['messages'],
        summary: 'Mute conversation',
        description: 'Mute or unmute a conversation',
      },
    },
  )
  // Reconnect client
  .post(
    '/reconnect',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await dcService.reconnectClient(address)

      return { success: true }
    },
    {
      detail: {
        tags: ['messages'],
        summary: 'Reconnect',
        description: 'Force reconnect Direct Cast client',
      },
    },
  )
  // Get encryption public key
  .get(
    '/encryption-key',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const publicKey = dcService.getEncryptionPublicKey(address)

      return { publicKey }
    },
    {
      detail: {
        tags: ['messages'],
        summary: 'Get encryption key',
        description: 'Get your encryption public key for Direct Casts',
      },
    },
  )
  // Publish encryption key
  .post(
    '/encryption-key/publish',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await dcService.publishEncryptionKey(address)

      return { success: true }
    },
    {
      detail: {
        tags: ['messages'],
        summary: 'Publish encryption key',
        description: 'Publish your encryption key to the hub for discovery',
      },
    },
  )
  // Search users by username (for starting new conversations)
  .get(
    '/search/users',
    async ({ query, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const username = query.q
      if (!username) {
        return { users: [] }
      }

      const { getUserByUsername } = await import('../services/farcaster')
      const user = await getUserByUsername(username)

      if (!user) {
        return { users: [] }
      }

      return {
        users: [
          {
            fid: user.fid,
            username: user.username,
            displayName: user.displayName,
            pfpUrl: user.pfpUrl,
          },
        ],
      }
    },
    {
      query: t.Object({ q: t.Optional(t.String()) }),
      detail: {
        tags: ['messages'],
        summary: 'Search users',
        description: 'Search for users to start a conversation',
      },
    },
  )

/**
 * Socket.IO Manager for real-time messaging
 * Handles WebSocket connection to ElizaOS
 */

import { io, type Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_ELIZA_WS_URL || 'http://localhost:3000'

// Allowed socket server origins (whitelist for security)
const ALLOWED_SOCKET_ORIGINS = [
  'http://localhost:3000',
  'https://eliza.jejunetwork.org',
  'https://agent.jejunetwork.org',
]

// Maximum reconnection attempts to prevent infinite retries
const MAX_RECONNECTION_ATTEMPTS = 5

// Maximum message handlers to prevent memory exhaustion
const MAX_MESSAGE_HANDLERS = 50

type MessageHandler = (data: MessageData) => void

/**
 * Validate that a URL is an allowed socket origin
 */
function isAllowedOrigin(url: string): boolean {
  try {
    const parsed = new URL(url)
    const origin = `${parsed.protocol}//${parsed.host}`
    return (
      ALLOWED_SOCKET_ORIGINS.includes(origin) ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    )
  } catch {
    return false
  }
}

interface MessageData {
  id?: string
  content?: string
  text?: string
  message?: string
  senderId: string
  channelId: string
  createdAt: string | number
  senderName?: string
  sourceType?: string
  type?: string
  rawMessage?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

class SocketManager {
  private socket: Socket | null = null
  private messageHandlers: Set<MessageHandler> = new Set()
  private userId: string | null = null
  private userName: string | null = null
  private currentChannel: string | null = null

  connect(userId: string, userName?: string): Socket {
    if (this.socket?.connected && this.userId === userId) {
      return this.socket
    }

    // Validate the socket URL before connecting
    if (!isAllowedOrigin(SOCKET_URL)) {
      throw new Error(
        `Socket connection refused: ${SOCKET_URL} is not an allowed origin`,
      )
    }

    this.userId = userId
    this.userName = userName || null

    // Disconnect existing socket
    if (this.socket) {
      this.socket.disconnect()
    }

    this.socket = io(SOCKET_URL, {
      auth: { userId, userName },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECTION_ATTEMPTS,
      reconnectionDelay: 1000,
    })

    this.socket.on('connect', () => {
      // Connected
    })

    this.socket.on('disconnect', (_reason) => {
      // Disconnected
    })

    this.socket.on('connect_error', (_error) => {
      // Connection error handled
    })

    // Listen for messages
    this.socket.on('message', (data: MessageData) => {
      for (const handler of this.messageHandlers) {
        handler(data)
      }
    })

    this.socket.on('messageBroadcast', (data: MessageData) => {
      for (const handler of this.messageHandlers) {
        handler(data)
      }
    })

    return this.socket
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.userId = null
    this.userName = null
    this.currentChannel = null
  }

  setUserName(name: string) {
    this.userName = name
    if (this.socket?.connected) {
      this.socket.emit('setUserName', { userName: name })
    }
  }

  joinChannel(
    channelId: string,
    serverId: string,
    options?: { isDm?: boolean },
  ) {
    if (!this.socket?.connected) {
      return
    }

    if (this.currentChannel) {
      this.leaveChannel(this.currentChannel)
    }

    this.currentChannel = channelId
    this.socket.emit('joinChannel', {
      channelId,
      serverId,
      userId: this.userId,
      ...options,
    })
  }

  leaveChannel(channelId: string) {
    if (!this.socket?.connected) return

    this.socket.emit('leaveChannel', { channelId })
    if (this.currentChannel === channelId) {
      this.currentChannel = null
    }
  }

  sendMessage(
    channelId: string,
    content: string,
    serverId: string,
    options?: {
      userId?: string
      isDm?: boolean
      targetUserId?: string
    },
  ) {
    if (!this.socket?.connected) {
      return
    }

    const message = {
      channelId,
      content,
      serverId,
      senderId: options?.userId || this.userId,
      senderName: this.userName,
      isDm: options?.isDm,
      targetUserId: options?.targetUserId,
      timestamp: Date.now(),
    }

    this.socket.emit('message', message)
  }

  onMessage(handler: MessageHandler): () => void {
    // Prevent too many handlers (memory protection)
    if (this.messageHandlers.size >= MAX_MESSAGE_HANDLERS) {
      throw new Error('Too many message handlers registered')
    }

    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false
  }

  getCurrentUserId(): string | null {
    return this.userId
  }
}

export const socketManager = new SocketManager()
export type { MessageData, MessageHandler }

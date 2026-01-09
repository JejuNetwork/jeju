/**
 * In-memory message store for autonomous agent system
 * Works in workerd environment (no Node.js APIs)
 */

export interface StoredMessage {
  id: string
  roomId: string
  agentId: string
  content: string
  action: string | null
  timestamp: number
}

export interface MessageStoreConfig {
  maxMessagesPerRoom: number
  maxRooms: number
  ttlMs: number
}

export interface GetMessagesOptions {
  limit?: number
  since?: number
}

export interface MessageStoreStats {
  roomCount: number
  totalMessages: number
}

export interface IMessageStore {
  addMessage(roomId: string, agentId: string, content: string, action?: string): StoredMessage
  getMessages(roomId: string, opts?: GetMessagesOptions): StoredMessage[]
  getRecentMessages(opts?: GetMessagesOptions): StoredMessage[]
  clearRoom(roomId: string): void
  roomExists(roomId: string): boolean
  createRoom(roomId: string): void
  getStats(): MessageStoreStats
}

const DEFAULT_CONFIG: MessageStoreConfig = {
  maxMessagesPerRoom: 100,
  maxRooms: 50,
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
}

interface RoomData {
  messages: StoredMessage[]
  lastAccess: number
}

class MessageStore implements IMessageStore {
  private rooms: Map<string, RoomData> = new Map()
  private config: MessageStoreConfig

  constructor(config: Partial<MessageStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  private evictExpiredMessages(): void {
    const now = Date.now()
    const cutoff = now - this.config.ttlMs

    for (const [roomId, room] of this.rooms) {
      room.messages = room.messages.filter((m) => m.timestamp > cutoff)
      if (room.messages.length === 0 && room.lastAccess < cutoff) {
        this.rooms.delete(roomId)
      }
    }
  }

  private evictLRURoom(): void {
    if (this.rooms.size < this.config.maxRooms) return

    let oldestRoomId: string | null = null
    let oldestAccess = Infinity

    for (const [roomId, room] of this.rooms) {
      if (room.lastAccess < oldestAccess) {
        oldestAccess = room.lastAccess
        oldestRoomId = roomId
      }
    }

    if (oldestRoomId) {
      this.rooms.delete(oldestRoomId)
    }
  }

  private getOrCreateRoom(roomId: string): RoomData {
    let room = this.rooms.get(roomId)
    if (!room) {
      this.evictLRURoom()
      room = { messages: [], lastAccess: Date.now() }
      this.rooms.set(roomId, room)
    }
    return room
  }

  addMessage(roomId: string, agentId: string, content: string, action?: string): StoredMessage {
    this.evictExpiredMessages()

    const room = this.getOrCreateRoom(roomId)
    room.lastAccess = Date.now()

    const message: StoredMessage = {
      id: this.generateId(),
      roomId,
      agentId,
      content,
      action: action ?? null,
      timestamp: Date.now(),
    }

    room.messages.push(message)

    // Evict oldest messages if over limit
    if (room.messages.length > this.config.maxMessagesPerRoom) {
      room.messages = room.messages.slice(-this.config.maxMessagesPerRoom)
    }

    return message
  }

  getMessages(roomId: string, opts: GetMessagesOptions = {}): StoredMessage[] {
    const room = this.rooms.get(roomId)
    if (!room) return []

    room.lastAccess = Date.now()

    let messages = room.messages

    if (opts.since) {
      messages = messages.filter((m) => m.timestamp > opts.since!)
    }

    if (opts.limit && opts.limit > 0) {
      messages = messages.slice(-opts.limit)
    }

    return messages
  }

  getRecentMessages(opts: GetMessagesOptions = {}): StoredMessage[] {
    const allMessages: StoredMessage[] = []

    for (const room of this.rooms.values()) {
      allMessages.push(...room.messages)
    }

    allMessages.sort((a, b) => a.timestamp - b.timestamp)

    let messages = allMessages

    if (opts.since) {
      messages = messages.filter((m) => m.timestamp > opts.since!)
    }

    if (opts.limit && opts.limit > 0) {
      messages = messages.slice(-opts.limit)
    }

    return messages
  }

  clearRoom(roomId: string): void {
    this.rooms.delete(roomId)
  }

  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId)
  }

  createRoom(roomId: string): void {
    if (!this.rooms.has(roomId)) {
      this.getOrCreateRoom(roomId)
    }
  }

  getStats(): MessageStoreStats {
    let totalMessages = 0
    for (const room of this.rooms.values()) {
      totalMessages += room.messages.length
    }

    return {
      roomCount: this.rooms.size,
      totalMessages,
    }
  }
}

// Singleton instance
let instance: MessageStore | null = null

export function getMessageStore(config?: Partial<MessageStoreConfig>): IMessageStore {
  if (!instance) {
    instance = new MessageStore(config)
  }
  return instance
}

// For testing: reset the singleton
export function resetMessageStore(): void {
  instance = null
}

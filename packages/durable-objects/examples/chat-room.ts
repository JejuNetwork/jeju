/**
 * Example Durable Object: Chat Room
 *
 * Demonstrates a real-time chat room using Durable Objects with:
 * - WebSocket connections for real-time messaging
 * - Persistent storage for message history
 * - Alarm scheduling for cleanup tasks
 *
 * This is the DWS equivalent of Cloudflare's chat room example.
 */

import type {
  DurableObject,
  DurableObjectNamespace,
  DurableObjectState,
} from '../src/types.js'

/**
 * Message stored in the chat room
 */
interface ChatMessage {
  id: string
  from: string
  text: string
  timestamp: number
}

/**
 * Chat room member
 */
interface ChatMember {
  name: string
  joinedAt: number
}

/**
 * ChatRoom Durable Object
 *
 * Each instance represents a single chat room. The room name is used
 * as the DO name, so `namespace.idFromName('general')` always routes
 * to the same room instance.
 */
export class ChatRoom implements DurableObject {
  private state: DurableObjectState
  private members: Map<WebSocket, ChatMember> = new Map()
  private messageCount = 0

  constructor(state: DurableObjectState, _env: Record<string, unknown>) {
    this.state = state

    // Initialize from storage on first request
    this.state.blockConcurrencyWhile(async () => {
      const count = await this.state.storage.get<number>('messageCount')
      if (count !== undefined) {
        this.messageCount = count
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }

    // REST API
    switch (path) {
      case '/messages':
        return this.getMessages()
      case '/members':
        return this.getMembers()
      case '/info':
        return this.getRoomInfo()
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocket(request: Request): Response {
    const url = new URL(request.url)
    const name = url.searchParams.get('name') ?? 'Anonymous'

    // Accept the WebSocket
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    // Track this member
    const member: ChatMember = {
      name,
      joinedAt: Date.now(),
    }
    this.members.set(server, member)

    // Accept and store the WebSocket
    this.state.acceptWebSocket(server, [name])

    // Set up message handler
    server.addEventListener('message', (event) => {
      this.handleMessage(server, member, event.data as string)
    })

    server.addEventListener('close', () => {
      this.handleDisconnect(server, member)
    })

    server.addEventListener('error', () => {
      this.handleDisconnect(server, member)
    })

    // Send welcome message
    server.send(
      JSON.stringify({
        type: 'system',
        text: `Welcome to the chat room, ${name}!`,
        timestamp: Date.now(),
      }),
    )

    // Broadcast join
    this.broadcast(
      {
        type: 'system',
        text: `${name} joined the room`,
        timestamp: Date.now(),
      },
      server,
    )

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Handle incoming message from a WebSocket
   */
  private async handleMessage(
    ws: WebSocket,
    member: ChatMember,
    data: string,
  ): Promise<void> {
    let parsed: { text: string }

    try {
      parsed = JSON.parse(data)
    } catch {
      ws.send(
        JSON.stringify({
          type: 'error',
          text: 'Invalid message format',
        }),
      )
      return
    }

    const message: ChatMessage = {
      id: `msg-${++this.messageCount}`,
      from: member.name,
      text: parsed.text,
      timestamp: Date.now(),
    }

    // Store message
    await this.state.storage.put(`message:${message.id}`, message)
    await this.state.storage.put('messageCount', this.messageCount)

    // Broadcast to all members
    this.broadcast({
      type: 'message',
      ...message,
    })
  }

  /**
   * Handle WebSocket disconnect
   */
  private handleDisconnect(ws: WebSocket, member: ChatMember): void {
    this.members.delete(ws)

    // Broadcast leave
    this.broadcast({
      type: 'system',
      text: `${member.name} left the room`,
      timestamp: Date.now(),
    })
  }

  /**
   * Broadcast message to all connected WebSockets
   */
  private broadcast(
    message: Record<string, unknown>,
    exclude?: WebSocket,
  ): void {
    const json = JSON.stringify(message)
    const sockets = this.state.getWebSockets()

    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(json)
      }
    }
  }

  /**
   * Get recent messages
   */
  private async getMessages(): Promise<Response> {
    const messages = await this.state.storage.list<ChatMessage>({
      prefix: 'message:',
      limit: 100,
    })

    return Response.json({
      messages: Array.from(messages.values()),
      total: this.messageCount,
    })
  }

  /**
   * Get current members
   */
  private getMembers(): Response {
    const members = Array.from(this.members.values())
    return Response.json({
      members,
      count: members.length,
    })
  }

  /**
   * Get room info
   */
  private async getRoomInfo(): Promise<Response> {
    return Response.json({
      id: this.state.id.toString(),
      name: this.state.id.name,
      messageCount: this.messageCount,
      memberCount: this.members.size,
    })
  }

  /**
   * Alarm handler - called when a scheduled alarm fires
   */
  async alarm(): Promise<void> {
    // Clean up old messages (keep last 1000)
    if (this.messageCount > 1000) {
      const deleteCount = this.messageCount - 1000
      const keysToDelete: string[] = []

      for (let i = 1; i <= deleteCount; i++) {
        keysToDelete.push(`message:msg-${i}`)
      }

      await this.state.storage.delete(keysToDelete)

      // Renumber messages
      this.messageCount = 1000
      await this.state.storage.put('messageCount', this.messageCount)
    }

    // Schedule next cleanup in 24 hours
    await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)
  }
}

/**
 * Worker entry point
 *
 * This shows how a worker would use the ChatRoom Durable Object.
 */
export default {
  async fetch(
    request: Request,
    env: { CHAT_ROOMS: DurableObjectNamespace },
  ): Promise<Response> {
    const url = new URL(request.url)
    const roomName = url.pathname.split('/')[2] ?? 'general'

    // Get the DO instance for this room
    const roomId = env.CHAT_ROOMS.idFromName(roomName)
    const room = env.CHAT_ROOMS.get(roomId)

    // Forward the request to the Durable Object
    return room.fetch(request)
  },
}

/**
 * Durable Object binding configuration
 *
 * This would be in the worker's wrangler.toml or DWS manifest:
 *
 * ```toml
 * [durable_objects]
 * bindings = [
 *   { name = "CHAT_ROOMS", class_name = "ChatRoom" }
 * ]
 *
 * [[migrations]]
 * tag = "v1"
 * new_classes = ["ChatRoom"]
 * ```
 */

import { createServer, type IncomingMessage } from 'node:http'
import type { Intent, JsonObject } from '@jejunetwork/types'
import { type RawData, WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'

interface WebSocketClient {
  ws: WebSocket
  subscriptions: Set<string>
  chainFilters: Set<number>
}

interface IntentUpdate {
  type:
    | 'intent_created'
    | 'intent_claimed'
    | 'intent_filled'
    | 'intent_expired'
    | 'intent_settled'
  intent: Intent
  timestamp: number
}

interface SolverUpdate {
  type: 'solver_registered' | 'solver_slashed' | 'solver_fill'
  solver: string
  data: JsonObject
  timestamp: number
}

const WSMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('subscribe'),
    channel: z.string().min(1).max(50),
    chainId: z.number().int().positive().nullable(),
  }),
  z.object({
    action: z.literal('unsubscribe'),
    channel: z.string().min(1).max(50),
  }),
  z.object({ action: z.literal('ping') }),
])

type WSMessage = z.infer<typeof WSMessageSchema>

const MAX_CONNECTIONS = 1000
const MAX_MESSAGE_SIZE = 4096 // 4KB max message size
const VALID_CHANNELS = new Set(['intents', 'solvers', 'stats'])

const ALLOWED_ORIGINS =
  process.env.WS_ALLOWED_ORIGINS?.split(',').filter(Boolean) || []
const isProduction = process.env.NODE_ENV === 'production'

function isOriginAllowed(origin: string | undefined): boolean {
  if (!isProduction || ALLOWED_ORIGINS.length === 0) return true
  if (!origin) return false
  return ALLOWED_ORIGINS.some(
    (allowed) => origin === allowed || origin.endsWith(`.${allowed}`),
  )
}

export class IntentWebSocketServer {
  private wss: WebSocketServer
  private clients: Map<WebSocket, WebSocketClient> = new Map()
  private heartbeatInterval: ReturnType<typeof setInterval>

  constructor(port: number = 4012) {
    const server = createServer()
    this.wss = new WebSocketServer({
      server,
      maxPayload: MAX_MESSAGE_SIZE,
      verifyClient: (info: {
        origin: string
        secure: boolean
        req: IncomingMessage
      }) => {
        if (this.clients.size >= MAX_CONNECTIONS) {
          console.warn(
            '[WebSocket] Connection rejected: max connections reached',
          )
          return false
        }
        if (!isOriginAllowed(info.origin)) {
          console.warn(
            `[WebSocket] Connection rejected: invalid origin ${info.origin}`,
          )
          return false
        }
        return true
      },
    })
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))

    server.listen(port, () => {
      console.log(`📡 WebSocket server running on ws://localhost:${port}`)
      if (isProduction && ALLOWED_ORIGINS.length > 0) {
        console.log(`   Origin whitelist: ${ALLOWED_ORIGINS.join(', ')}`)
      }
    })

    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.ping()
      })
    }, 30000)
  }

  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const client: WebSocketClient = {
      ws,
      subscriptions: new Set(),
      chainFilters: new Set(),
    }
    this.clients.set(ws, client)

    ws.on('message', (data: RawData) => {
      const dataStr = data.toString()
      if (dataStr.length > MAX_MESSAGE_SIZE) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }))
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(dataStr)
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
        return
      }

      const result = WSMessageSchema.safeParse(parsed)
      if (!result.success) {
        ws.send(
          JSON.stringify({ type: 'error', message: 'Invalid message format' }),
        )
        return
      }

      this.handleMessage(client, result.data)
    })

    ws.on('close', () => this.clients.delete(ws))
    ws.on('error', (error: Error) =>
      console.error('WebSocket error:', error.message),
    )

    ws.send(
      JSON.stringify({
        type: 'connected',
        channels: Array.from(VALID_CHANNELS),
        timestamp: Date.now(),
      }),
    )
  }

  private handleMessage(client: WebSocketClient, message: WSMessage): void {
    switch (message.action) {
      case 'subscribe':
        if (!VALID_CHANNELS.has(message.channel)) {
          client.ws.send(
            JSON.stringify({ type: 'error', message: 'Invalid channel' }),
          )
          return
        }
        if (client.subscriptions.size >= 10) {
          client.ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Too many subscriptions',
            }),
          )
          return
        }
        client.subscriptions.add(message.channel)
        if (message.chainId) client.chainFilters.add(message.chainId)
        client.ws.send(
          JSON.stringify({
            type: 'subscribed',
            channel: message.channel,
            chainId: message.chainId,
          }),
        )
        break
      case 'unsubscribe':
        client.subscriptions.delete(message.channel)
        client.ws.send(
          JSON.stringify({ type: 'unsubscribed', channel: message.channel }),
        )
        break
      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
        break
    }
  }

  broadcastIntent(update: IntentUpdate): void {
    const message = JSON.stringify(update)
    this.clients.forEach((client) => {
      if (!client.subscriptions.has('intents')) return
      if (client.chainFilters.size > 0) {
        const intentChain = update.intent.sourceChainId
        const destChain = update.intent.outputs[0]?.chainId
        if (
          !client.chainFilters.has(intentChain) &&
          (!destChain || !client.chainFilters.has(destChain))
        )
          return
      }
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(message)
    })
  }

  broadcastSolver(update: SolverUpdate): void {
    const message = JSON.stringify(update)
    this.clients.forEach((client) => {
      if (
        client.subscriptions.has('solvers') &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(message)
      }
    })
  }

  broadcastStats(stats: JsonObject): void {
    const message = JSON.stringify({
      type: 'stats_update',
      stats,
      timestamp: Date.now(),
    })
    this.clients.forEach((client) => {
      if (
        client.subscriptions.has('stats') &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(message)
      }
    })
  }

  getClientCount(): number {
    return this.clients.size
  }

  close(): void {
    clearInterval(this.heartbeatInterval)
    this.wss.close()
  }
}

let wsServer: IntentWebSocketServer | null = null

export function getWebSocketServer(port?: number): IntentWebSocketServer {
  if (!wsServer) wsServer = new IntentWebSocketServer(port)
  return wsServer
}

export function broadcastIntentUpdate(update: IntentUpdate): void {
  wsServer?.broadcastIntent(update)
}

export function broadcastSolverUpdate(update: SolverUpdate): void {
  wsServer?.broadcastSolver(update)
}

export function broadcastStatsUpdate(stats: JsonObject): void {
  wsServer?.broadcastStats(stats)
}

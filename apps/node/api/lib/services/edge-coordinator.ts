import * as nodeHttp from 'node:http'
import { randomHex } from '@jejunetwork/shared'
import { expectAddress, expectHex } from '@jejunetwork/types'
import { LRUCache } from 'lru-cache'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import {
  type Address,
  createPublicClient,
  recoverMessageAddress,
  http as viemHttp,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'

// Configuration Schema

const EdgeCoordinatorConfigSchema = z.object({
  nodeId: z.string().min(1),
  operator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  listenPort: z.number().min(1024).max(65535),
  gossipInterval: z.number().min(1000).default(30000),
  maxPeers: z.number().min(1).max(1000).default(100),
  gossipFanout: z.number().min(1).max(20).default(6),
  bootstrapNodes: z.array(z.string()).default([]),
  region: z.string().default('unknown'),
  rpcUrl: z.string().url().optional(),
  nodeRegistryAddress: z.string().optional(),
  staleThresholdMs: z.number().default(300000),
  metricsPort: z.number().optional(),
  requireOnChainRegistration: z.boolean().default(true),
  // Security: WebSocket message size limit (default 1MB)
  maxMessageSizeBytes: z
    .number()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(1024 * 1024),
  // Security: Allowed origins (empty = allow all, for P2P networks)
  allowedOrigins: z.array(z.string()).default([]),
})

export type EdgeCoordinatorConfig = z.infer<typeof EdgeCoordinatorConfigSchema>

// Gossip Message Payload Types

/** Typed payload for announce messages */
export interface AnnouncePayload {
  action: 'join' | 'leave'
  nodeId?: string
  nodeInfo?: EdgeNodeInfo
}

/** Typed payload for query messages */
export interface QueryPayload {
  contentHash: string
}

/** Typed payload for response messages */
export interface ResponsePayload {
  contentHash: string
  nodeId: string
  endpoint: string
}

/** Typed payload for cache update messages */
export interface CacheUpdatePayload {
  action: 'add' | 'remove'
  contentHash: string
  nodeId: string
  size?: number
}

/** Typed payload for peer list messages */
export interface PeerListPayload {
  peers: EdgeNodeInfo[]
}

/** Typed payload for pong messages */
export interface PongPayload {
  metrics: EdgeMetrics
  latency: number
}

/**
 * Gossip payload - typed union for compile-time safety.
 * Runtime validation done via Zod schema below.
 */
export type GossipPayload =
  | AnnouncePayload
  | QueryPayload
  | ResponsePayload
  | CacheUpdatePayload
  | PeerListPayload
  | PongPayload
  | Record<string, never>

// Type guards for payload narrowing
function isAnnouncePayload(p: GossipPayload): p is AnnouncePayload {
  return 'action' in p && (p.action === 'join' || p.action === 'leave')
}

function isQueryPayload(p: GossipPayload): p is QueryPayload {
  return 'contentHash' in p && !('nodeId' in p) && !('action' in p)
}

function isResponsePayload(p: GossipPayload): p is ResponsePayload {
  return 'contentHash' in p && 'nodeId' in p && 'endpoint' in p
}

function isCacheUpdatePayload(p: GossipPayload): p is CacheUpdatePayload {
  return (
    'action' in p &&
    (p.action === 'add' || p.action === 'remove') &&
    'contentHash' in p
  )
}

function isPeerListPayload(p: GossipPayload): p is PeerListPayload {
  return 'peers' in p && Array.isArray(p.peers)
}

// Schema for gossip messages - payload validated permissively at runtime,
// type safety ensured via GossipPayload union type at compile time
const GossipMessageSchema = z.object({
  type: z.enum([
    'announce',
    'query',
    'response',
    'ping',
    'pong',
    'cache_update',
    'peer_list',
  ]),
  id: z.string().min(1),
  sender: z.string().min(1),
  timestamp: z.number().int().positive(),
  ttl: z.number().int().min(0),
  signature: z.string(),
  payload: z.custom<GossipPayload>(
    (val): val is GossipPayload =>
      typeof val === 'object' && val !== null && 'action' in val,
    'Invalid gossip payload',
  ),
})

// Types

export interface EdgeNodeInfo {
  nodeId: string
  operator: Address
  endpoint: string
  region: string
  capabilities: EdgeCapabilities
  metrics: EdgeMetrics
  lastSeen: number
  version: string
  signature?: string
}

export interface EdgeCapabilities {
  maxCacheSizeMb: number
  maxBandwidthMbps: number
  supportsWebRTC: boolean
  supportsTCP: boolean
  supportsIPFS: boolean
  supportsTorrent: boolean
}

export interface EdgeMetrics {
  cacheHitRate: number
  avgLatencyMs: number
  bytesServed: number
  activeConnections: number
  cacheUtilization: number
}

export interface ContentLocation {
  contentHash: string
  nodeIds: string[]
  lastUpdated: number
  popularity: number
}

export interface GossipMessage {
  type:
    | 'announce'
    | 'query'
    | 'response'
    | 'ping'
    | 'pong'
    | 'cache_update'
    | 'peer_list'
  id: string
  sender: string
  timestamp: number
  ttl: number
  signature: string
  payload: GossipPayload
}

// Prometheus Metrics

const metricsRegistry = new Registry()

const coordinatorPeersTotal = new Gauge({
  name: 'coordinator_peers_total',
  help: 'Total connected peers',
  registers: [metricsRegistry],
})

const coordinatorMessagesTotal = new Counter({
  name: 'coordinator_messages_total',
  help: 'Total gossip messages',
  labelNames: ['type', 'direction'],
  registers: [metricsRegistry],
})

const coordinatorAuthFailures = new Counter({
  name: 'coordinator_auth_failures_total',
  help: 'Authentication failures',
  labelNames: ['reason'],
  registers: [metricsRegistry],
})

const coordinatorContentIndex = new Gauge({
  name: 'coordinator_content_index_size',
  help: 'Content index size',
  registers: [metricsRegistry],
})

const coordinatorGossipLatency = new Histogram({
  name: 'coordinator_gossip_latency_seconds',
  help: 'Gossip message latency',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [metricsRegistry],
})

// Edge Coordinator

export class EdgeCoordinator {
  private config: EdgeCoordinatorConfig
  private account: ReturnType<typeof privateKeyToAccount>
  private peers = new LRUCache<string, { ws: WebSocket; info: EdgeNodeInfo }>({
    max: 1000,
    ttl: 10 * 60 * 1000, // 10 minutes
    dispose: (value, _key) => {
      if (value.ws.readyState === WebSocket.OPEN) {
        value.ws.close()
      }
    },
  })
  private contentIndex = new LRUCache<string, ContentLocation>({
    max: 100000,
    ttl: 60 * 60 * 1000, // 1 hour
  })
  private seenMessages = new LRUCache<string, boolean>({
    max: 50000,
    ttl: 5 * 60 * 1000, // 5 minutes
  })
  private messageHandlers = new Map<string, (msg: GossipMessage) => void>()
  private wss: WebSocketServer | null = null
  private httpServer: nodeHttp.Server | null = null
  private gossipInterval: ReturnType<typeof setInterval> | null = null
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private running = false

  // On-chain integration
  private publicClient: ReturnType<typeof createPublicClient> | null = null
  private nodeRegistryAddress: string | null = null
  private registeredOperators = new LRUCache<string, boolean>({
    max: 10000,
    ttl: 5 * 60 * 1000, // Cache registration status for 5 min
  })

  // Real-time metrics tracking
  private metricsState = {
    cacheHits: 0,
    cacheMisses: 0,
    totalBytesServed: 0,
    latencySamples: [] as number[],
    maxLatencySamples: 100,
  }

  constructor(config: EdgeCoordinatorConfig) {
    this.config = EdgeCoordinatorConfigSchema.parse(config)

    // Initialize signing account
    this.account = privateKeyToAccount(
      expectHex(this.config.privateKey, 'Edge coordinator private key'),
    )

    // Setup on-chain integration
    if (this.config.rpcUrl && this.config.nodeRegistryAddress) {
      this.publicClient = createPublicClient({
        transport: viemHttp(this.config.rpcUrl),
      })
      this.nodeRegistryAddress = this.config.nodeRegistryAddress
    }
  }

  // Lifecycle

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    console.log(`[EdgeCoordinator] Starting node ${this.config.nodeId}`)

    // Start WebSocket server
    await this.startServer()

    // Connect to bootstrap nodes
    await this.connectToBootstrapNodes()

    // Start gossip protocol
    this.gossipInterval = setInterval(
      () => this.gossip(),
      this.config.gossipInterval,
    )

    // Cleanup stale peers
    this.cleanupInterval = setInterval(() => this.cleanupStalePeers(), 60000)

    console.log(`[EdgeCoordinator] Started on port ${this.config.listenPort}`)
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    // Announce departure
    await this.broadcast({
      type: 'announce',
      id: this.generateMessageId(),
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 3,
      signature: '',
      payload: { action: 'leave', nodeId: this.config.nodeId },
    })

    // Cleanup
    if (this.gossipInterval) clearInterval(this.gossipInterval)
    if (this.cleanupInterval) clearInterval(this.cleanupInterval)

    // Close all peer connections
    for (const [_nodeId, peer] of Array.from(this.peers.entries())) {
      peer.ws.close()
    }

    // Close servers
    if (this.wss) this.wss.close()
    if (this.httpServer) this.httpServer.close()

    console.log('[EdgeCoordinator] Stopped')
  }

  private async startServer(): Promise<void> {
    const httpServer = nodeHttp.createServer(
      async (req: nodeHttp.IncomingMessage, res: nodeHttp.ServerResponse) => {
        if (req.url === '/health') {
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              status: this.running ? 'healthy' : 'stopped',
              peers: this.peers.size,
              contentIndexSize: this.contentIndex.size,
            }),
          )
          return
        }

        if (req.url === '/metrics') {
          res.setHeader('Content-Type', metricsRegistry.contentType)
          res.end(await metricsRegistry.metrics())
          return
        }

        if (req.url === '/gossip' && req.method === 'POST') {
          // Handle HTTP gossip transport
          let body = ''
          req.on('data', (chunk: string) => {
            body += chunk
          })
          req.on('end', async () => {
            const parseResult = GossipMessageSchema.safeParse(JSON.parse(body))
            if (!parseResult.success) {
              res.writeHead(400)
              res.end('Invalid message')
              return
            }
            await this.handleMessage(parseResult.data, null)
            res.writeHead(200)
            res.end('OK')
          })
          return
        }

        res.writeHead(404)
        res.end('Not found')
      },
    )
    this.httpServer = httpServer

    this.wss = new WebSocketServer({
      server: httpServer,
      maxPayload: this.config.maxMessageSizeBytes,
    })

    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress ?? 'unknown'

      // Validate origin if allowedOrigins is configured
      if (this.config.allowedOrigins.length > 0) {
        const origin = req.headers.origin ?? ''
        if (!this.config.allowedOrigins.includes(origin)) {
          console.warn(
            `[EdgeCoordinator] Rejected connection from ${ip}: origin '${origin}' not in allowed list`,
          )
          ws.close(1008, 'Origin not allowed')
          return
        }
      }

      console.log(`[EdgeCoordinator] New connection from ${ip}`)

      ws.on('message', async (data: Buffer | ArrayBuffer | Buffer[]) => {
        // Check message size (defense in depth, WebSocketServer also enforces maxPayload)
        const rawData = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data)
        if (rawData.length > this.config.maxMessageSizeBytes) {
          console.error(
            `[EdgeCoordinator] Message too large: ${rawData.length} bytes from ${ip}`,
          )
          ws.close(1009, 'Message too large')
          return
        }

        const parseResult = GossipMessageSchema.safeParse(
          JSON.parse(rawData.toString()),
        )
        if (!parseResult.success) {
          console.error(
            '[EdgeCoordinator] Invalid message:',
            parseResult.error.message,
          )
          return
        }
        await this.handleMessage(parseResult.data, ws)
      })

      ws.on('close', () => {
        // Remove peer associated with this socket
        for (const [nodeId, peer] of Array.from(this.peers.entries())) {
          if (peer.ws === ws) {
            this.peers.delete(nodeId)
            coordinatorPeersTotal.dec()
            break
          }
        }
      })

      ws.on('error', (error) => {
        console.error('[EdgeCoordinator] WebSocket error:', error.message)
      })
    })

    await new Promise<void>((resolve) => {
      this.httpServer?.listen(this.config.listenPort, resolve)
    })
  }

  // Peer Authentication

  private async verifyPeerAuthentication(msg: GossipMessage): Promise<boolean> {
    // Verify message signature
    const messageData = JSON.stringify({
      type: msg.type,
      id: msg.id,
      sender: msg.sender,
      timestamp: msg.timestamp,
      ttl: msg.ttl,
      payload: msg.payload,
    })

    try {
      // Recover signer from signature
      const signer = await recoverMessageAddress({
        message: messageData,
        signature: expectHex(msg.signature, 'message signature'),
      })

      // Check if signer is registered on-chain (if required)
      if (this.config.requireOnChainRegistration && this.publicClient) {
        const isRegistered = await this.checkRegistration(signer)
        if (!isRegistered) {
          coordinatorAuthFailures.inc({ reason: 'not_registered' })
          console.warn(`[EdgeCoordinator] Unregistered peer: ${signer}`)
          return false
        }
      }

      // Verify timestamp is recent (within 5 minutes)
      if (Math.abs(Date.now() - msg.timestamp) > 5 * 60 * 1000) {
        coordinatorAuthFailures.inc({ reason: 'stale_timestamp' })
        return false
      }

      return true
    } catch (error) {
      coordinatorAuthFailures.inc({ reason: 'invalid_signature' })
      throw error
    }
  }

  private async checkRegistration(operator: string): Promise<boolean> {
    // Check cache first
    const cached = this.registeredOperators.get(operator)
    if (cached !== undefined) return cached

    if (!this.publicClient || !this.nodeRegistryAddress) return true // Skip if no registry configured

    const registryAddress = expectHex(
      this.nodeRegistryAddress,
      'node registry address',
    )
    const operatorHex = expectHex(operator, 'operator address')

    const isRegistered = await this.publicClient.readContract({
      address: registryAddress,
      abi: [
        {
          name: 'isRegistered',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'operator', type: 'address' }],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'isRegistered',
      args: [operatorHex],
    })
    const result = Boolean(isRegistered)
    this.registeredOperators.set(operator, result)
    return result
  }

  private async signMessage(
    msg: Omit<GossipMessage, 'signature'>,
  ): Promise<string> {
    const messageData = JSON.stringify({
      type: msg.type,
      id: msg.id,
      sender: msg.sender,
      timestamp: msg.timestamp,
      ttl: msg.ttl,
      payload: msg.payload,
    })

    // Use proper ECDSA signing with viem
    return await this.account.signMessage({ message: messageData })
  }

  // Message Handling

  private async handleMessage(
    msg: GossipMessage,
    source: WebSocket | null,
  ): Promise<void> {
    const startTime = Date.now()

    // Deduplicate
    if (this.seenMessages.has(msg.id)) return
    this.seenMessages.set(msg.id, true)

    // Track message latency from send time
    const latencyMs = startTime - msg.timestamp
    coordinatorGossipLatency.observe(latencyMs / 1000)

    coordinatorMessagesTotal.inc({ type: msg.type, direction: 'received' })

    // Verify authentication for non-ping messages
    if (msg.type !== 'ping' && msg.type !== 'pong') {
      const isAuthenticated = await this.verifyPeerAuthentication(msg)
      if (!isAuthenticated) {
        return
      }
    }

    // Check for registered handler
    const handler = this.messageHandlers.get(msg.id)
    if (handler) handler(msg)

    // Process by type
    switch (msg.type) {
      case 'announce':
        await this.handleAnnounce(msg, source)
        break
      case 'query':
        await this.handleQuery(msg, source)
        break
      case 'cache_update':
        this.handleCacheUpdate(msg)
        break
      case 'ping':
        await this.handlePing(msg, source)
        break
      case 'peer_list':
        await this.handlePeerList(msg)
        break
    }

    // Propagate with fanout (not to all peers)
    if (msg.ttl > 1) {
      await this.propagateWithFanout({
        ...msg,
        ttl: msg.ttl - 1,
      })
    }
  }

  private async handleAnnounce(
    msg: GossipMessage,
    source: WebSocket | null,
  ): Promise<void> {
    if (!isAnnouncePayload(msg.payload)) return
    const payload = msg.payload

    if (payload.action === 'join' && payload.nodeInfo) {
      const nodeInfo = payload.nodeInfo

      if (source) {
        this.peers.set(nodeInfo.nodeId, {
          ws: source,
          info: { ...nodeInfo, lastSeen: Date.now() },
        })
        coordinatorPeersTotal.set(this.peers.size)
        console.log(`[EdgeCoordinator] Peer joined: ${nodeInfo.nodeId}`)
      }
    } else if (payload.action === 'leave' && payload.nodeId) {
      this.peers.delete(payload.nodeId)
      coordinatorPeersTotal.set(this.peers.size)
      console.log(`[EdgeCoordinator] Peer left: ${payload.nodeId}`)
    }
  }

  private async handleQuery(
    msg: GossipMessage,
    source: WebSocket | null,
  ): Promise<void> {
    if (!isQueryPayload(msg.payload)) return
    const payload = msg.payload
    const location = this.contentIndex.get(payload.contentHash)

    if (location?.nodeIds.includes(this.config.nodeId)) {
      const response: GossipMessage = {
        type: 'response',
        id: msg.id,
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        signature: '',
        payload: {
          contentHash: payload.contentHash,
          nodeId: this.config.nodeId,
          endpoint: `https://localhost:${this.config.listenPort}`,
        },
      }

      response.signature = await this.signMessage(response)

      if (source && source.readyState === WebSocket.OPEN) {
        source.send(JSON.stringify(response))
        coordinatorMessagesTotal.inc({ type: 'response', direction: 'sent' })
      }
    }
  }

  private handleCacheUpdate(msg: GossipMessage): void {
    if (!isCacheUpdatePayload(msg.payload)) return
    const { action, contentHash, nodeId } = msg.payload

    if (action === 'add') {
      const existing = this.contentIndex.get(contentHash)
      if (existing) {
        if (!existing.nodeIds.includes(nodeId)) {
          existing.nodeIds.push(nodeId)
        }
        existing.lastUpdated = Date.now()
        existing.popularity++
      } else {
        this.contentIndex.set(contentHash, {
          contentHash,
          nodeIds: [nodeId],
          lastUpdated: Date.now(),
          popularity: 1,
        })
      }
    } else if (action === 'remove') {
      const existing = this.contentIndex.get(contentHash)
      if (existing) {
        existing.nodeIds = existing.nodeIds.filter((id) => id !== nodeId)
        if (existing.nodeIds.length === 0) {
          this.contentIndex.delete(contentHash)
        }
      }
    }

    coordinatorContentIndex.set(this.contentIndex.size)
  }

  private async handlePing(
    msg: GossipMessage,
    source: WebSocket | null,
  ): Promise<void> {
    if (!source || source.readyState !== WebSocket.OPEN) return

    const pong: GossipMessage = {
      type: 'pong',
      id: msg.id,
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 1,
      signature: '',
      payload: {
        metrics: this.getLocalMetrics(),
        latency: Date.now() - msg.timestamp,
      },
    }

    pong.signature = await this.signMessage(pong)
    source.send(JSON.stringify(pong))
    coordinatorMessagesTotal.inc({ type: 'pong', direction: 'sent' })
  }

  private async handlePeerList(msg: GossipMessage): Promise<void> {
    if (!isPeerListPayload(msg.payload)) return
    const payload = msg.payload

    for (const peerInfo of payload.peers) {
      if (
        !this.peers.has(peerInfo.nodeId) &&
        peerInfo.nodeId !== this.config.nodeId
      ) {
        if (this.peers.size < this.config.maxPeers) {
          await this.connectToPeer(peerInfo.endpoint)
        }
      }
    }
  }

  // Gossip with Fanout

  private async gossip(): Promise<void> {
    // Get random subset of peers
    const selectedPeers = this.getRandomPeers(this.config.gossipFanout)

    // Share peer list
    const peerList = Array.from(this.peers.values())
      .slice(0, 20)
      .map((p) => p.info)

    const peerListMsg: GossipMessage = {
      type: 'peer_list',
      id: this.generateMessageId(),
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 1,
      signature: '',
      payload: { peers: peerList },
    }
    peerListMsg.signature = await this.signMessage(peerListMsg)

    // Send to selected peers
    for (const peer of selectedPeers) {
      this.sendToPeer(peer.info.nodeId, peerListMsg)
    }

    // Ping random peers for latency measurement
    const pingPeers = this.getRandomPeers(3)
    for (const peer of pingPeers) {
      const pingMsg: GossipMessage = {
        type: 'ping',
        id: this.generateMessageId(),
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        signature: '',
        payload: {},
      }
      pingMsg.signature = await this.signMessage(pingMsg)
      this.sendToPeer(peer.info.nodeId, pingMsg)
    }
  }

  private async propagateWithFanout(msg: GossipMessage): Promise<void> {
    const selectedPeers = this.getRandomPeers(this.config.gossipFanout)

    for (const peer of selectedPeers) {
      this.sendToPeer(peer.info.nodeId, msg)
    }
  }

  private async broadcast(msg: GossipMessage): Promise<void> {
    msg.signature = await this.signMessage(msg)
    await this.propagateWithFanout(msg)
  }

  private sendToPeer(nodeId: string, msg: GossipMessage): void {
    const peer = this.peers.get(nodeId)
    if (!peer || peer.ws.readyState !== WebSocket.OPEN) return

    peer.ws.send(JSON.stringify(msg))
    coordinatorMessagesTotal.inc({ type: msg.type, direction: 'sent' })
  }

  // Peer Management

  private async connectToBootstrapNodes(): Promise<void> {
    for (const endpoint of this.config.bootstrapNodes) {
      await this.connectToPeer(endpoint)
    }
  }

  private async connectToPeer(endpoint: string): Promise<void> {
    try {
      // Convert HTTP to WebSocket protocol: http -> ws, https -> wss
      const wsUrl = endpoint.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
      const ws = new WebSocket(`${wsUrl}/gossip`)

      ws.on('open', async () => {
        const announceMsg: GossipMessage = {
          type: 'announce',
          id: this.generateMessageId(),
          sender: this.config.nodeId,
          timestamp: Date.now(),
          ttl: 1,
          signature: '',
          payload: {
            action: 'join',
            nodeInfo: this.getLocalNodeInfo(),
          },
        }
        announceMsg.signature = await this.signMessage(announceMsg)
        ws.send(JSON.stringify(announceMsg))
      })

      ws.on('message', async (data) => {
        const parseResult = GossipMessageSchema.safeParse(
          JSON.parse(data.toString()),
        )
        if (!parseResult.success) {
          console.error(
            '[EdgeCoordinator] Invalid peer message:',
            parseResult.error.message,
          )
          return
        }
        await this.handleMessage(parseResult.data, ws)
      })

      ws.on('error', (error) => {
        console.error(
          `[EdgeCoordinator] Connection error to ${endpoint}:`,
          error.message,
        )
      })

      ws.on('close', () => {
        console.log(`[EdgeCoordinator] Disconnected from ${endpoint}`)
      })
    } catch (error) {
      console.error(
        `[EdgeCoordinator] Failed to connect to ${endpoint}:`,
        error,
      )
    }
  }

  private cleanupStalePeers(): void {
    const now = Date.now()

    for (const [nodeId, peer] of Array.from(this.peers.entries())) {
      if (now - peer.info.lastSeen > this.config.staleThresholdMs) {
        peer.ws.close()
        this.peers.delete(nodeId)
        console.log(`[EdgeCoordinator] Removed stale peer: ${nodeId}`)
      }
    }

    coordinatorPeersTotal.set(this.peers.size)
  }

  private getRandomPeers(
    count: number,
  ): Array<{ ws: WebSocket; info: EdgeNodeInfo }> {
    const allPeers = Array.from(this.peers.values())
    const shuffled = [...allPeers].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, Math.min(count, shuffled.length))
  }

  // Public API

  async announceContent(contentHash: string, size: number): Promise<void> {
    const existing = this.contentIndex.get(contentHash)
    if (existing) {
      if (!existing.nodeIds.includes(this.config.nodeId)) {
        existing.nodeIds.push(this.config.nodeId)
      }
      existing.lastUpdated = Date.now()
    } else {
      this.contentIndex.set(contentHash, {
        contentHash,
        nodeIds: [this.config.nodeId],
        lastUpdated: Date.now(),
        popularity: 1,
      })
    }

    coordinatorContentIndex.set(this.contentIndex.size)

    await this.broadcast({
      type: 'cache_update',
      id: this.generateMessageId(),
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 5,
      signature: '',
      payload: {
        action: 'add',
        contentHash,
        size,
        nodeId: this.config.nodeId,
      },
    })
  }

  async queryContent(contentHash: string): Promise<string[]> {
    const local = this.contentIndex.get(contentHash)
    if (local && local.nodeIds.length > 0) {
      return local.nodeIds
    }

    return new Promise((resolve) => {
      const queryId = this.generateMessageId()
      const results: string[] = []
      // Timeout to collect responses - not cleared early to gather all available results
      setTimeout(() => {
        this.messageHandlers.delete(queryId)
        resolve(results)
      }, 5000)

      this.messageHandlers.set(queryId, (msg: GossipMessage) => {
        if (msg.type === 'response' && isResponsePayload(msg.payload)) {
          const payload = msg.payload
          if (payload.nodeId && !results.includes(payload.nodeId)) {
            results.push(payload.nodeId)
          }
        }
      })

      this.broadcast({
        type: 'query',
        id: queryId,
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 3,
        signature: '',
        payload: { contentHash },
      })
    })
  }

  getPeers(): EdgeNodeInfo[] {
    return Array.from(this.peers.values()).map((p) => p.info)
  }

  getContentLocations(contentHash: string): ContentLocation | null {
    return this.contentIndex.get(contentHash) ?? null
  }

  // Helpers

  private getLocalNodeInfo(): EdgeNodeInfo {
    return {
      nodeId: this.config.nodeId,
      operator: expectAddress(this.config.operator, 'operator'),
      endpoint: `https://localhost:${this.config.listenPort}`,
      region: this.config.region,
      capabilities: {
        maxCacheSizeMb: 512,
        maxBandwidthMbps: 100,
        supportsWebRTC: true,
        supportsTCP: true,
        supportsIPFS: true,
        supportsTorrent: true,
      },
      metrics: this.getLocalMetrics(),
      lastSeen: Date.now(),
      version: '1.0.0',
    }
  }

  private getLocalMetrics(): EdgeMetrics {
    // Calculate cache hit rate from actual hits/misses
    const totalRequests =
      this.metricsState.cacheHits + this.metricsState.cacheMisses
    const cacheHitRate =
      totalRequests > 0 ? this.metricsState.cacheHits / totalRequests : 0

    // Calculate average latency from samples
    const avgLatencyMs =
      this.metricsState.latencySamples.length > 0
        ? this.metricsState.latencySamples.reduce((a, b) => a + b, 0) /
          this.metricsState.latencySamples.length
        : 0

    // Calculate cache utilization based on content index size
    const maxCacheEntries = 100000
    const cacheUtilization = this.contentIndex.size / maxCacheEntries

    return {
      cacheHitRate,
      avgLatencyMs,
      bytesServed: this.metricsState.totalBytesServed,
      activeConnections: this.peers.size,
      cacheUtilization,
    }
  }

  /** Record a cache hit for metrics */
  recordCacheHit(): void {
    this.metricsState.cacheHits++
  }

  /** Record a cache miss for metrics */
  recordCacheMiss(): void {
    this.metricsState.cacheMisses++
  }

  /** Record bytes served for metrics */
  recordBytesServed(bytes: number): void {
    this.metricsState.totalBytesServed += bytes
  }

  /** Record a latency sample for metrics */
  recordLatency(latencyMs: number): void {
    this.metricsState.latencySamples.push(latencyMs)
    // Keep only the most recent samples
    if (
      this.metricsState.latencySamples.length >
      this.metricsState.maxLatencySamples
    ) {
      this.metricsState.latencySamples.shift()
    }
  }

  private generateMessageId(): string {
    return randomHex(16).slice(2)
  }
}

// Factory

export function createEdgeCoordinator(
  config: EdgeCoordinatorConfig,
): EdgeCoordinator {
  return new EdgeCoordinator(config)
}

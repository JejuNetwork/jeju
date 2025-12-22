import { createHash, randomBytes } from 'node:crypto'
import * as http from 'node:http'
import * as https from 'node:https'
import * as net from 'node:net'
import type { Duplex } from 'node:stream'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import { type Address, verifyMessage } from 'viem'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { PROXY_REGISTRY_ABI } from '../abis'
import { getChain, type NodeClient } from '../contracts'

// Configuration Schema

const ProxyConfigSchema = z.object({
  coordinatorWsUrl: z.string().url(),
  localPort: z.number().min(1024).max(65535),
  maxConcurrentRequests: z.number().min(1).max(1000),
  bandwidthLimitMbps: z.number().min(1),
  allowedPorts: z.array(z.number()),
  blockedDomains: z.array(z.string()),
  stakeAmount: z.bigint(),
  authTokenTtlMs: z.number().default(30000),
  metricsPort: z.number().optional(),
  drainTimeoutMs: z.number().default(30000),
  // Security: Maximum message size from coordinator (default 64KB)
  maxCoordinatorMessageBytes: z
    .number()
    .min(1024)
    .max(1024 * 1024)
    .default(64 * 1024),
})

export type ProxyConfig = z.infer<typeof ProxyConfigSchema>

// Schema for auth tokens
const AuthTokenSchema = z.object({
  nodeId: z.string().min(1),
  requestId: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: z.string().min(1),
})

// Schema for coordinator messages
const CoordinatorMessageSchema = z
  .object({
    type: z.string().min(1),
    domain: z.string().optional(),
  })
  .passthrough()

// Types

export interface ProxyState {
  isRegistered: boolean
  nodeId: `0x${string}`
  status: 'online' | 'busy' | 'offline' | 'suspended'
  totalRequests: number
  totalBytesTransferred: number
  currentConnections: number
  earnings: bigint
}

// Prometheus Metrics

const metricsRegistry = new Registry()

const proxyRequestsTotal = new Counter({
  name: 'proxy_requests_total',
  help: 'Total proxy requests',
  labelNames: ['method', 'status'],
  registers: [metricsRegistry],
})

const proxyRequestDuration = new Histogram({
  name: 'proxy_request_duration_seconds',
  help: 'Proxy request duration',
  labelNames: ['method'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
})

const proxyBytesTransferred = new Counter({
  name: 'proxy_bytes_transferred_total',
  help: 'Total bytes transferred',
  labelNames: ['direction'],
  registers: [metricsRegistry],
})

const proxyActiveConnections = new Gauge({
  name: 'proxy_active_connections',
  help: 'Active proxy connections',
  registers: [metricsRegistry],
})

const proxyCoordinatorConnected = new Gauge({
  name: 'proxy_coordinator_connected',
  help: 'Coordinator connection status',
  registers: [metricsRegistry],
})

// Circuit Breaker

class CircuitBreaker {
  private failures = 0
  private lastFailure = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'

  constructor(
    private readonly threshold = 5,
    private readonly resetTimeout = 30000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open'
      } else {
        throw new Error('Circuit breaker open')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  }

  private onFailure(): void {
    this.failures++
    this.lastFailure = Date.now()
    if (this.failures >= this.threshold) {
      this.state = 'open'
    }
  }

  getState(): string {
    return this.state
  }
}

// Residential Proxy Service

export class ResidentialProxyService {
  private client: NodeClient
  private config: ProxyConfig
  private ws: WebSocket | null = null
  private server: http.Server | null = null
  private metricsServer: http.Server | null = null
  private nodeId: `0x${string}` | null = null
  private running = false
  private draining = false
  private activeConnections = new Map<string, net.Socket | Duplex>()
  private metricsReportInterval: ReturnType<typeof setInterval> | null = null
  private tokenCleanupInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private coordinatorBreaker = new CircuitBreaker(5, 30000)
  private validTokens = new Map<string, number>() // requestId -> expiry

  constructor(client: NodeClient, config: Partial<ProxyConfig>) {
    this.client = client

    // Validate config
    this.config = ProxyConfigSchema.parse({
      coordinatorWsUrl:
        config.coordinatorWsUrl ?? 'wss://proxy.jejunetwork.org/ws',
      localPort: config.localPort ?? 4025,
      maxConcurrentRequests: config.maxConcurrentRequests ?? 100,
      bandwidthLimitMbps: config.bandwidthLimitMbps ?? 100,
      allowedPorts: config.allowedPorts ?? [80, 443, 8080, 8443],
      blockedDomains: config.blockedDomains ?? [],
      stakeAmount: config.stakeAmount ?? BigInt('100000000000000000'),
      ...config,
    })
  }

  // ============================================================================
  // Public API
  // ============================================================================

  async getState(address: Address): Promise<ProxyState | null> {
    // Get node info directly by address
    const node = (await this.client.publicClient.readContract({
      address: this.client.addresses.proxyRegistry,
      abi: PROXY_REGISTRY_ABI,
      functionName: 'getNode',
      args: [address],
    })) as {
      owner: Address
      regionCode: `0x${string}`
      endpoint: string
      stake: bigint
      registeredAt: bigint
      totalBytesServed: bigint
      totalSessions: bigint
      successfulSessions: bigint
      active: boolean
    }

    // Not registered if registeredAt is 0
    if (node.registeredAt === BigInt(0)) return null

    // Derive status from active flag and connection count
    let status: ProxyState['status'] = 'offline'
    if (node.active) {
      status =
        this.activeConnections.size >= this.config.maxConcurrentRequests
          ? 'busy'
          : 'online'
    }

    return {
      isRegistered: true,
      nodeId: address as `0x${string}`, // Use address as nodeId since contract uses address-based lookup
      status,
      totalRequests: Number(node.totalSessions),
      totalBytesTransferred: Number(node.totalBytesServed),
      currentConnections: this.activeConnections.size,
      earnings: node.stake,
    }
  }

  async register(regionCode?: string): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    // Hash region code (e.g., "US" -> keccak256("US"))
    const region = regionCode ?? process.env.PROXY_REGION ?? 'GLOBAL'
    const regionHash =
      `0x${createHash('sha256').update(region).digest('hex')}` as `0x${string}`

    // Get endpoint URL for callback
    const endpoint = `http://localhost:${this.config.localPort}`

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.proxyRegistry,
      abi: PROXY_REGISTRY_ABI,
      functionName: 'register',
      args: [regionHash, endpoint],
      value: this.config.stakeAmount,
    })

    return hash
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn('[Proxy] Already running')
      return
    }

    this.running = true
    this.draining = false

    // Get node ID
    const address = this.client.walletClient?.account?.address
    if (address) {
      const state = await this.getState(address)
      if (state) {
        this.nodeId = state.nodeId
      }
    }

    // Start servers
    await this.startProxyServer()
    await this.startMetricsServer()
    await this.connectToCoordinator()

    // Metrics reporting
    this.metricsReportInterval = setInterval(() => this.reportMetrics(), 60000)

    // Periodic token cleanup to prevent memory leaks from expired tokens
    this.tokenCleanupInterval = setInterval(
      () => this.cleanupExpiredTokens(),
      30000,
    )

    console.log(`[Proxy] Started on port ${this.config.localPort}`)
  }

  async stop(): Promise<void> {
    if (!this.running) return

    console.log('[Proxy] Stopping (draining connections)...')
    this.draining = true

    // Stop accepting new connections
    this.server?.close()

    // Wait for active connections to drain
    const drainStart = Date.now()
    while (
      this.activeConnections.size > 0 &&
      Date.now() - drainStart < this.config.drainTimeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // Force close remaining connections
    const entries = Array.from(this.activeConnections.entries())
    for (const [id, socket] of entries) {
      socket.destroy()
      this.activeConnections.delete(id)
    }

    // Cleanup
    this.running = false
    if (this.metricsReportInterval) clearInterval(this.metricsReportInterval)
    if (this.tokenCleanupInterval) clearInterval(this.tokenCleanupInterval)
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
    if (this.ws) this.ws.close()
    if (this.metricsServer) this.metricsServer.close()

    // Final metrics report
    await this.reportMetrics()

    console.log('[Proxy] Stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  async getMetrics(): Promise<string> {
    return metricsRegistry.metrics()
  }

  getHealth(): { status: string; connections: number; coordinator: boolean } {
    return {
      status: this.running
        ? this.draining
          ? 'draining'
          : 'healthy'
        : 'stopped',
      connections: this.activeConnections.size,
      coordinator: this.ws?.readyState === WebSocket.OPEN,
    }
  }

  // ============================================================================
  // Server Setup
  // ============================================================================

  private async startProxyServer(): Promise<void> {
    this.server = http.createServer((req, res) => {
      // Health check endpoint
      if (req.url === '/health') {
        const health = this.getHealth()
        res.writeHead(health.status === 'healthy' ? 200 : 503, {
          'Content-Type': 'application/json',
        })
        res.end(JSON.stringify(health))
        return
      }

      // Readiness check
      if (req.url === '/ready') {
        const ready =
          this.running &&
          !this.draining &&
          this.ws?.readyState === WebSocket.OPEN
        res.writeHead(ready ? 200 : 503)
        res.end(ready ? 'ready' : 'not ready')
        return
      }

      // Regular HTTP proxy
      this.handleHttpRequest(req, res)
    })

    // HTTPS tunneling
    this.server.on('connect', (req, clientSocket: Duplex, head) => {
      this.handleConnectRequest(req, clientSocket, head)
    })

    this.server.on('error', (err) => {
      console.error('[Proxy] Server error:', err.message)
    })

    await new Promise<void>((resolve) => {
      this.server?.listen(this.config.localPort, resolve)
    })
  }

  private async startMetricsServer(): Promise<void> {
    if (!this.config.metricsPort) return

    this.metricsServer = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsRegistry.contentType)
        res.end(await this.getMetrics())
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    await new Promise<void>((resolve) => {
      this.metricsServer?.listen(this.config.metricsPort, resolve)
    })

    console.log(`[Proxy] Metrics server on port ${this.config.metricsPort}`)
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  private async validateAuthToken(req: http.IncomingMessage): Promise<boolean> {
    const authHeader = req.headers['x-proxy-auth']
    if (!authHeader || typeof authHeader !== 'string') {
      return false
    }

    const tokenData = JSON.parse(Buffer.from(authHeader, 'base64').toString())
    const token = AuthTokenSchema.parse(tokenData)

    // Check token hasn't expired
    if (Date.now() - token.timestamp > this.config.authTokenTtlMs) {
      return false
    }

    // Check not already used (replay protection)
    if (this.validTokens.has(token.requestId)) {
      return false
    }

    // Verify signature from coordinator
    const message = `${token.nodeId}:${token.requestId}:${token.timestamp}`
    const coordinatorAddress = process.env.PROXY_COORDINATOR_ADDRESS as Address

    if (!coordinatorAddress) {
      console.warn('[Proxy] No coordinator address configured')
      return false
    }

    const isValid = await verifyMessage({
      address: coordinatorAddress,
      message,
      signature: token.signature as `0x${string}`,
    })

    if (isValid) {
      // Mark token as used
      this.validTokens.set(
        token.requestId,
        Date.now() + this.config.authTokenTtlMs,
      )

      // Cleanup expired tokens
      this.cleanupExpiredTokens()
    }

    return isValid
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now()
    for (const [requestId, expiry] of Array.from(this.validTokens.entries())) {
      if (expiry < now) {
        this.validTokens.delete(requestId)
      }
    }
  }

  // ============================================================================
  // Request Handling
  // ============================================================================

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const requestId = randomBytes(8).toString('hex')
    const timer = proxyRequestDuration.startTimer({ method: 'http' })

    // Check if draining
    if (this.draining) {
      res.writeHead(503, { 'Retry-After': '5' })
      res.end('Service draining')
      proxyRequestsTotal.inc({ method: 'http', status: 'rejected' })
      return
    }

    // Validate authentication
    const isAuthenticated = await this.validateAuthToken(req)
    if (!isAuthenticated) {
      res.writeHead(401)
      res.end('Unauthorized')
      proxyRequestsTotal.inc({ method: 'http', status: 'unauthorized' })
      timer()
      return
    }

    if (!req.url) {
      res.writeHead(400)
      res.end('Bad Request')
      proxyRequestsTotal.inc({ method: 'http', status: 'bad_request' })
      timer()
      return
    }

    // Parse target
    const targetUrl = new URL(req.url)
    const hostname = targetUrl.hostname
    const port =
      parseInt(targetUrl.port, 10) ||
      (targetUrl.protocol === 'https:' ? 443 : 80)

    // Validate
    if (this.isBlocked(hostname)) {
      res.writeHead(403)
      res.end('Forbidden')
      proxyRequestsTotal.inc({ method: 'http', status: 'blocked' })
      timer()
      return
    }

    if (!this.config.allowedPorts.includes(port)) {
      res.writeHead(403)
      res.end('Port not allowed')
      proxyRequestsTotal.inc({ method: 'http', status: 'port_blocked' })
      timer()
      return
    }

    // Check concurrent connections
    if (this.activeConnections.size >= this.config.maxConcurrentRequests) {
      res.writeHead(503)
      res.end('Too many connections')
      proxyRequestsTotal.inc({ method: 'http', status: 'overloaded' })
      timer()
      return
    }

    proxyActiveConnections.inc()

    // Forward request
    const options: http.RequestOptions = {
      hostname,
      port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: { ...req.headers, host: hostname },
      timeout: 30000,
    }

    const proxyReq: http.ClientRequest =
      targetUrl.protocol === 'https:'
        ? https.request(options as https.RequestOptions)
        : http.request(options)

    proxyReq.on('response', (proxyRes: http.IncomingMessage) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)

      proxyRes.on('data', (chunk: Buffer) => {
        proxyBytesTransferred.inc({ direction: 'download' }, chunk.length)
      })

      proxyRes.pipe(res)

      proxyRes.on('end', () => {
        proxyRequestsTotal.inc({ method: 'http', status: 'success' })
        proxyActiveConnections.dec()
        timer()
      })
    })

    proxyReq.on('error', (err: Error) => {
      console.error(`[Proxy] Request ${requestId} failed:`, err.message)
      proxyRequestsTotal.inc({ method: 'http', status: 'error' })
      proxyActiveConnections.dec()
      res.writeHead(502)
      res.end('Bad Gateway')
      timer()
    })

    req.on('data', (chunk: Buffer) => {
      proxyBytesTransferred.inc({ direction: 'upload' }, chunk.length)
    })

    req.pipe(proxyReq)
  }

  private async handleConnectRequest(
    req: http.IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const requestId = randomBytes(8).toString('hex')
    const timer = proxyRequestDuration.startTimer({ method: 'connect' })

    // Validate authentication
    const isAuthenticated = await this.validateAuthToken(req)
    if (!isAuthenticated) {
      clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      clientSocket.end()
      proxyRequestsTotal.inc({ method: 'connect', status: 'unauthorized' })
      timer()
      return
    }

    if (!req.url) {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      clientSocket.end()
      proxyRequestsTotal.inc({ method: 'connect', status: 'bad_request' })
      timer()
      return
    }

    const [hostname, portStr] = req.url.split(':')
    const port = parseInt(portStr, 10) || 443

    // Validate
    if (this.isBlocked(hostname)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      clientSocket.end()
      proxyRequestsTotal.inc({ method: 'connect', status: 'blocked' })
      timer()
      return
    }

    if (!this.config.allowedPorts.includes(port)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      clientSocket.end()
      proxyRequestsTotal.inc({ method: 'connect', status: 'port_blocked' })
      timer()
      return
    }

    if (this.activeConnections.size >= this.config.maxConcurrentRequests) {
      clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
      clientSocket.end()
      proxyRequestsTotal.inc({ method: 'connect', status: 'overloaded' })
      timer()
      return
    }

    proxyActiveConnections.inc()
    this.activeConnections.set(requestId, clientSocket)

    // Connect to target
    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

      if (head.length > 0) {
        serverSocket.write(head)
        proxyBytesTransferred.inc({ direction: 'upload' }, head.length)
      }

      serverSocket.pipe(clientSocket)
      clientSocket.pipe(serverSocket)

      serverSocket.on('data', (chunk: Buffer) => {
        proxyBytesTransferred.inc({ direction: 'download' }, chunk.length)
      })

      clientSocket.on('data', (chunk: Buffer) => {
        proxyBytesTransferred.inc({ direction: 'upload' }, chunk.length)
      })
    })

    const cleanup = (status: string) => {
      proxyRequestsTotal.inc({ method: 'connect', status })
      proxyActiveConnections.dec()
      this.activeConnections.delete(requestId)
      serverSocket.destroy()
      clientSocket.destroy()
      timer()
    }

    serverSocket.on('error', () => cleanup('server_error'))
    clientSocket.on('error', () => cleanup('client_error'))
    serverSocket.on('close', () => cleanup('success'))
    clientSocket.on('close', () => {
      if (this.activeConnections.has(requestId)) {
        cleanup('client_close')
      }
    })
  }

  // ============================================================================
  // Coordinator Communication
  // ============================================================================

  private async connectToCoordinator(): Promise<void> {
    if (!this.running) return

    try {
      await this.coordinatorBreaker.execute(async () => {
        const ws = new WebSocket(this.config.coordinatorWsUrl)

        ws.on('open', () => {
          console.log('[Proxy] Connected to coordinator')
          proxyCoordinatorConnected.set(1)

          // Register
          ws.send(
            JSON.stringify({
              type: 'register',
              nodeId: this.nodeId,
              address: this.client.walletClient?.account?.address,
              capabilities: {
                maxConnections: this.config.maxConcurrentRequests,
                bandwidthMbps: this.config.bandwidthLimitMbps,
                allowedPorts: this.config.allowedPorts,
              },
            }),
          )
        })

        ws.on('message', (data) => {
          // Defense in depth: check message size from coordinator
          const rawData = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer)
          if (rawData.length > this.config.maxCoordinatorMessageBytes) {
            console.error(
              `[Proxy] Coordinator message too large: ${rawData.length} bytes, closing connection`,
            )
            ws.close(1009, 'Message too large')
            return
          }

          const message = CoordinatorMessageSchema.parse(
            JSON.parse(rawData.toString()),
          )
          this.handleCoordinatorMessage(message)
        })

        ws.on('error', (error) => {
          console.error('[Proxy] WebSocket error:', error.message)
        })

        ws.on('close', () => {
          console.log('[Proxy] Coordinator disconnected')
          proxyCoordinatorConnected.set(0)
          this.ws = null

          if (this.running && !this.draining) {
            this.reconnectTimeout = setTimeout(
              () => this.connectToCoordinator(),
              5000,
            )
          }
        })

        this.ws = ws
      })
    } catch (error) {
      console.error('[Proxy] Coordinator connection failed:', error)
      if (this.running && !this.draining) {
        this.reconnectTimeout = setTimeout(
          () => this.connectToCoordinator(),
          10000,
        )
      }
    }
  }

  private handleCoordinatorMessage(
    message: z.infer<typeof CoordinatorMessageSchema>,
  ): void {
    switch (message.type) {
      case 'registered':
        console.log('[Proxy] Registered with coordinator')
        break

      case 'block_domain': {
        const domain = message.domain as string
        if (!this.config.blockedDomains.includes(domain)) {
          this.config.blockedDomains.push(domain)
        }
        break
      }

      case 'status_request':
        this.ws?.send(
          JSON.stringify({
            type: 'status',
            health: this.getHealth(),
            timestamp: Date.now(),
          }),
        )
        break
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private isBlocked(hostname: string): boolean {
    return this.config.blockedDomains.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
    )
  }

  private async reportMetrics(): Promise<void> {
    if (!this.nodeId || !this.ws || this.ws.readyState !== WebSocket.OPEN)
      return

    this.ws.send(
      JSON.stringify({
        type: 'metrics',
        nodeId: this.nodeId,
        health: this.getHealth(),
        timestamp: Date.now(),
      }),
    )
  }
}

// Factory

export function createResidentialProxyService(
  client: NodeClient,
  config?: Partial<ProxyConfig>,
): ResidentialProxyService {
  return new ResidentialProxyService(client, config ?? {})
}

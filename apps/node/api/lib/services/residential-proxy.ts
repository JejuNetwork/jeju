// Workerd-compatible: HTTP servers converted to Fetch API handlers
// Note: Residential proxy uses CONNECT method for HTTPS tunneling which requires protocol-level networking
// This service should run on DWS node, but handlers are workerd-compatible

import type * as http from 'node:http'
// Import net for CONNECT tunneling (available on DWS node)
import type * as net from 'node:net'
import type { Duplex } from 'node:stream'
import { getLocalhostHost } from '@jejunetwork/config'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import {
  expectAddress,
  expectHex,
  isPlainObject,
  toBigInt,
} from '@jejunetwork/types'
import { Gauge, Registry } from 'prom-client'
import type { Address, Hex } from 'viem'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { PROXY_REGISTRY_ABI } from '../abis'
import { config as nodeConfig } from '../config'
import { getChain, type SecureNodeClient } from '../contracts'

/** Type for proxy node from contract */
interface ProxyNodeResult {
  owner: Address
  regionCode: Hex
  endpoint: string
  stake: bigint
  registeredAt: bigint
  totalBytesServed: bigint
  totalSessions: bigint
  successfulSessions: bigint
  active: boolean
}

function parseProxyNodeResult(result: unknown): ProxyNodeResult | null {
  if (!isPlainObject(result)) return null
  if (typeof result.registeredAt !== 'bigint' || result.registeredAt === 0n) {
    return null
  }
  return {
    owner: expectAddress(result.owner, 'proxy node owner'),
    regionCode: expectHex(result.regionCode, 'proxy node regionCode'),
    endpoint: String(result.endpoint),
    stake: toBigInt(result.stake),
    registeredAt: toBigInt(result.registeredAt),
    totalBytesServed: toBigInt(result.totalBytesServed),
    totalSessions: toBigInt(result.totalSessions),
    successfulSessions: toBigInt(result.successfulSessions),
    active: Boolean(result.active),
  }
}

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
  private client: SecureNodeClient
  private config: ProxyConfig
  private ws: WebSocket | null = null
  private server: http.Server | null = null
  private metricsServer: http.Server | null = null
  private requestHandler: ((req: Request) => Promise<Response>) | null = null
  private metricsHandler: ((req: Request) => Promise<Response>) | null = null
  private nodeId: `0x${string}` | null = null
  private running = false
  private draining = false
  private activeConnections = new Map<string, net.Socket | Duplex>()
  private metricsReportInterval: ReturnType<typeof setInterval> | null = null
  private tokenCleanupInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private coordinatorBreaker = new CircuitBreaker(5, 30000)
  private validTokens = new Map<string, number>() // requestId -> expiry

  constructor(client: SecureNodeClient, config: Partial<ProxyConfig>) {
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

  // Public API

  async getState(address: Address): Promise<ProxyState | null> {
    // Get node info directly by address
    const nodeResult = await this.client.publicClient.readContract({
      address: this.client.addresses.proxyRegistry,
      abi: PROXY_REGISTRY_ABI,
      functionName: 'getNode',
      args: [address],
    })
    const node = parseProxyNodeResult(nodeResult)

    // Not registered if parsing failed (registeredAt is 0 or invalid data)
    if (!node) return null

    // Derive status from active flag and connection count
    let status: ProxyState['status'] = 'offline'
    if (node.active) {
      status =
        this.activeConnections.size >= this.config.maxConcurrentRequests
          ? 'busy'
          : 'online'
    }

    const validAddress = expectAddress(address, 'proxy node address')

    return {
      isRegistered: true,
      nodeId: validAddress,
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
    const region = regionCode ?? nodeConfig.proxyRegion ?? 'GLOBAL'
    const regionHash = `0x${bytesToHex(hash256(region))}` as Hex

    // Get endpoint URL for callback
    const endpoint = `http://${getLocalhostHost()}:${this.config.localPort}`

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

  // Server Setup

  /**
   * Get Fetch API handler for proxy requests (workerd-compatible)
   * Note: CONNECT method for HTTPS tunneling requires protocol-level networking (net.Socket)
   * which is not available in workerd. CONNECT requests should be handled on DWS node.
   */
  getRequestHandler(): (req: Request) => Promise<Response> {
    if (!this.requestHandler) {
      this.requestHandler = async (req: Request): Promise<Response> => {
        const url = new URL(req.url)

        // Health check endpoint
        if (url.pathname === '/health') {
          const health = this.getHealth()
          return Response.json(health, {
            status: health.status === 'healthy' ? 200 : 503,
          })
        }

        // Readiness check
        if (url.pathname === '/ready') {
          const ready =
            this.running &&
            !this.draining &&
            this.ws?.readyState === WebSocket.OPEN
          return new Response(ready ? 'ready' : 'not ready', {
            status: ready ? 200 : 503,
          })
        }

        // CONNECT method for HTTPS tunneling - requires protocol-level networking
        // This must be handled on DWS node, not in workerd
        if (req.method === 'CONNECT') {
          // CONNECT tunneling requires net.Socket which isn't available in workerd
          // This should be handled by a separate service on DWS node
          return new Response('CONNECT method requires DWS node execution', {
            status: 501,
          })
        }

        // Regular HTTP proxy - convert to Fetch API
        return this.handleHttpRequestFetch(req)
      }
    }
    return this.requestHandler
  }

  /**
   * Get Fetch API handler for metrics (workerd-compatible)
   */
  getMetricsHandler(): (req: Request) => Promise<Response> {
    if (!this.metricsHandler) {
      this.metricsHandler = async (req: Request): Promise<Response> => {
        const url = new URL(req.url)
        if (url.pathname === '/metrics') {
          return new Response(await this.getMetrics(), {
            headers: { 'Content-Type': metricsRegistry.contentType },
          })
        }
        return new Response('Not found', { status: 404 })
      }
    }
    return this.metricsHandler
  }

  private async startProxyServer(): Promise<void> {
    // In workerd, handlers are registered in the main Elysia app
    // Just initialize the handler
    this.requestHandler = this.getRequestHandler()
    console.log(
      `[Proxy] Request handler ready (register at port ${this.config.localPort})`,
    )
    console.warn(
      '[Proxy] CONNECT method for HTTPS tunneling requires DWS node execution',
    )
  }

  private async startMetricsServer(): Promise<void> {
    if (!this.config.metricsPort) return

    // In workerd, handlers are registered in the main Elysia app
    this.metricsHandler = this.getMetricsHandler()
    console.log(
      `[Proxy] Metrics handler ready (register at port ${this.config.metricsPort})`,
    )
  }

  /**
   * Handle HTTP proxy request using Fetch API (workerd-compatible)
   */
  private async handleHttpRequestFetch(req: Request): Promise<Response> {
    // Convert Fetch Request to proxy request
    // Implementation would forward the request to the proxy coordinator
    // This is a simplified version - full implementation would handle proxy forwarding
    const url = new URL(req.url)
    const _targetUrl = url.searchParams.get('target') || url.pathname
    void _targetUrl // Reserved for future proxy implementation

    // Forward request via proxy coordinator
    // Note: Full proxy implementation requires protocol-level networking
    return new Response('Proxy forwarding requires DWS node execution', {
      status: 501,
    })
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now()
    for (const [requestId, expiry] of Array.from(this.validTokens.entries())) {
      if (expiry < now) {
        this.validTokens.delete(requestId)
      }
    }
  }

  // Coordinator Communication

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

        ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          // Defense in depth: check message size from coordinator
          const rawData = Buffer.isBuffer(data)
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.from(data)
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
        const domain = String(message.domain ?? '')
        if (domain && !this.config.blockedDomains.includes(domain)) {
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
  client: SecureNodeClient,
  config?: Partial<ProxyConfig>,
): ResidentialProxyService {
  return new ResidentialProxyService(client, config ?? {})
}

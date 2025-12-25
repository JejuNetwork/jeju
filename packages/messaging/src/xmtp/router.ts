/**
 * XMTP Message Router
 *
 * Routes XMTP messages through Jeju relay network.
 *
 * Flow:
 * 1. Client encrypts with XMTP/MLS
 * 2. Router wraps in Jeju envelope
 * 3. Sends to Jeju relay nodes
 * 4. Recipient decrypts with XMTP/MLS
 */

import { createLogger } from '@jejunetwork/shared'
import type { Address } from 'viem'

const log = createLogger('xmtp-router')

import type { RouteConfig, RouteResult, XMTPEnvelope } from './types'

export interface RelayNode {
  /** Node ID */
  id: string
  /** Node URL */
  url: string
  /** Region */
  region: string
  /** Latency in ms */
  latencyMs: number
  /** Active connections */
  activeConnections: number
  /** Last health check */
  lastHealthCheck: number
  /** Is healthy */
  isHealthy: boolean
}

export interface RouterStats {
  /** Total messages routed */
  totalMessages: number
  /** Successful deliveries */
  successfulDeliveries: number
  /** Failed deliveries */
  failedDeliveries: number
  /** Average latency ms */
  averageLatencyMs: number
  /** Messages by region */
  messagesByRegion: Record<string, number>
}

// Maximum pending messages to prevent memory exhaustion
const MAX_PENDING_MESSAGES = 10000

/**
 * Routes XMTP messages through Jeju relay network
 */
export class XMTPMessageRouter {
  private config: RouteConfig
  private relayNodes: Map<string, RelayNode> = new Map()
  private stats: RouterStats
  private pendingMessages: Map<
    string,
    { envelope: XMTPEnvelope; attempts: number; queuedAt: number }
  > = new Map()
  private healthCheckInterval: NodeJS.Timeout | null = null
  private pendingCleanupInterval: NodeJS.Timeout | null = null

  constructor(config?: Partial<RouteConfig>) {
    this.config = {
      multiRegion: config?.multiRegion ?? true,
      preferredRegions: config?.preferredRegions,
      maxRetries: config?.maxRetries ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
      timeoutMs: config?.timeoutMs ?? 10000,
    }

    this.stats = {
      totalMessages: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageLatencyMs: 0,
      messagesByRegion: {},
    }
  }

  /**
   * Initialize the router
   */
  async initialize(): Promise<void> {
    log.info('Initializing')

    // Discover relay nodes
    await this.discoverNodes()

    // Start health check loop
    this.startHealthChecks()

    log.info('Initialized', { nodeCount: this.relayNodes.size })
  }

  /**
   * Shutdown the router
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    if (this.pendingCleanupInterval) {
      clearInterval(this.pendingCleanupInterval)
    }

    // Flush pending messages
    await this.flushPending()

    log.info('Shutdown complete')
  }

  /**
   * Discover relay nodes from registry
   */
  private async discoverNodes(): Promise<void> {
    // In production, query MessageNodeRegistry contract
    // For now, use default nodes
    const defaultNodes: RelayNode[] = [
      {
        id: 'relay-us-east',
        url: 'wss://relay-us-east.jejunetwork.org',
        region: 'us-east',
        latencyMs: 50,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
      {
        id: 'relay-eu-west',
        url: 'wss://relay-eu-west.jejunetwork.org',
        region: 'eu-west',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
      {
        id: 'relay-ap-east',
        url: 'wss://relay-ap-east.jejunetwork.org',
        region: 'ap-east',
        latencyMs: 150,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
    ]

    for (const node of defaultNodes) {
      this.relayNodes.set(node.id, node)
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.checkNodeHealth()
    }, 30000) // Every 30 seconds
  }

  /**
   * Check health of all nodes
   */
  private async checkNodeHealth(): Promise<void> {
    for (const [id, node] of this.relayNodes) {
      const startTime = Date.now()

      const response = await fetch(
        `${node.url.replace('wss', 'https')}/health`,
        {
          signal: AbortSignal.timeout(5000),
        },
      ).catch(() => null)

      if (response?.ok) {
        node.isHealthy = true
        node.latencyMs = Date.now() - startTime
      } else {
        node.isHealthy = false
        node.latencyMs = -1
      }
      node.lastHealthCheck = Date.now()

      this.relayNodes.set(id, node)
    }
  }

  /**
   * Route an envelope to recipients
   */
  async route(envelope: XMTPEnvelope): Promise<RouteResult> {
    const startTime = Date.now()
    this.stats.totalMessages++

    // Select best node for routing
    const node = this.selectBestNode(envelope)
    if (!node) {
      this.stats.failedDeliveries++
      return {
        success: false,
        error: 'No healthy relay nodes available',
      }
    }

    // Attempt delivery with retries
    let lastError: string | undefined

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.sendToNode(node, envelope)

        const deliveryTimeMs = Date.now() - startTime
        this.stats.successfulDeliveries++
        this.updateAverageLatency(deliveryTimeMs)
        this.incrementRegionStats(node.region)

        return {
          success: true,
          messageId: envelope.id,
          relayNode: node.id,
          deliveryTimeMs,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error'

        if (attempt < this.config.maxRetries) {
          await this.delay(this.config.retryDelayMs * attempt)
        }
      }
    }

    // All retries failed
    this.stats.failedDeliveries++

    // Queue for later if under limit
    if (this.pendingMessages.size < MAX_PENDING_MESSAGES) {
      this.pendingMessages.set(envelope.id, {
        envelope,
        attempts: this.config.maxRetries,
        queuedAt: Date.now(),
      })
    } else {
      // Drop oldest pending messages to make room
      this.evictOldestPendingMessages(1)
      this.pendingMessages.set(envelope.id, {
        envelope,
        attempts: this.config.maxRetries,
        queuedAt: Date.now(),
      })
    }

    return {
      success: false,
      error: lastError,
    }
  }

  /**
   * Evict oldest pending messages
   */
  private evictOldestPendingMessages(count: number): void {
    const sorted = Array.from(this.pendingMessages.entries()).sort(
      ([, a], [, b]) => a.queuedAt - b.queuedAt,
    )

    for (let i = 0; i < count && i < sorted.length; i++) {
      const entry = sorted[i]
      if (entry) this.pendingMessages.delete(entry[0])
    }
  }

  /**
   * Route to specific addresses
   */
  async routeToAddresses(
    envelope: XMTPEnvelope,
    addresses: Address[],
  ): Promise<Map<Address, RouteResult>> {
    const results = new Map<Address, RouteResult>()

    // Group by region for optimal routing
    const byRegion = this.groupByRegion(addresses)

    for (const [region, regionAddresses] of byRegion) {
      const node = this.getNodeForRegion(region)
      if (!node) continue

      // Create envelope copy with specific recipients
      const regionEnvelope: XMTPEnvelope = {
        ...envelope,
        recipients: regionAddresses,
      }

      const result = await this.route(regionEnvelope)

      for (const address of regionAddresses) {
        results.set(address, result)
      }
    }

    return results
  }

  /**
   * Select the best node for routing
   */
  private selectBestNode(_envelope: XMTPEnvelope): RelayNode | null {
    const healthyNodes = Array.from(this.relayNodes.values()).filter(
      (n) => n.isHealthy,
    )

    if (healthyNodes.length === 0) return null

    // If preferred regions configured, try those first
    if (this.config.preferredRegions?.length) {
      for (const region of this.config.preferredRegions) {
        const node = healthyNodes.find((n) => n.region === region)
        if (node) return node
      }
    }

    // Otherwise, select by lowest latency
    healthyNodes.sort((a, b) => a.latencyMs - b.latencyMs)
    return healthyNodes[0] ?? null
  }

  /**
   * Get node for specific region
   */
  private getNodeForRegion(region: string): RelayNode | null {
    for (const node of this.relayNodes.values()) {
      if (node.region === region && node.isHealthy) {
        return node
      }
    }
    return null
  }

  /**
   * Group addresses by region (based on prior routing data)
   */
  private groupByRegion(addresses: Address[]): Map<string, Address[]> {
    // In production, look up region preferences per address
    // For now, group all in default region
    const result = new Map<string, Address[]>()
    result.set('default', addresses)
    return result
  }

  /**
   * Send envelope to a relay node
   */
  private async sendToNode(
    node: RelayNode,
    envelope: XMTPEnvelope,
  ): Promise<void> {
    const response = await fetch(
      `${node.url.replace('wss', 'https')}/api/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: envelope.id,
          sender: envelope.sender,
          recipients: envelope.recipients,
          contentTopic: envelope.contentTopic,
          ciphertext: Buffer.from(envelope.ciphertext).toString('base64'),
          signature: Buffer.from(envelope.signature).toString('base64'),
          timestamp: envelope.timestamp,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    )

    if (!response.ok) {
      throw new Error(`Relay error: ${response.status} ${response.statusText}`)
    }
  }

  /**
   * Retry pending messages
   */
  async retryPending(): Promise<number> {
    let retried = 0
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours max age
    const now = Date.now()

    for (const [id, pending] of this.pendingMessages) {
      // Remove messages older than 24 hours
      if (now - pending.queuedAt > maxAge) {
        this.pendingMessages.delete(id)
        continue
      }

      const result = await this.route(pending.envelope)

      if (result.success) {
        this.pendingMessages.delete(id)
        retried++
      } else {
        pending.attempts++

        // Give up after too many attempts
        if (pending.attempts >= this.config.maxRetries * 3) {
          this.pendingMessages.delete(id)
        }
      }
    }

    return retried
  }

  /**
   * Flush pending messages
   */
  private async flushPending(): Promise<void> {
    log.info('Flushing pending messages', { count: this.pendingMessages.size })
    await this.retryPending()
  }

  /**
   * Get router statistics
   */
  getStats(): RouterStats {
    return { ...this.stats }
  }

  /**
   * Get node statistics
   */
  getNodeStats(): RelayNode[] {
    return Array.from(this.relayNodes.values())
  }

  /**
   * Get healthy node count
   */
  getHealthyNodeCount(): number {
    return Array.from(this.relayNodes.values()).filter((n) => n.isHealthy)
      .length
  }

  private updateAverageLatency(latencyMs: number): void {
    const total = this.stats.successfulDeliveries
    this.stats.averageLatencyMs =
      (this.stats.averageLatencyMs * (total - 1) + latencyMs) / total
  }

  private incrementRegionStats(region: string): void {
    this.stats.messagesByRegion[region] =
      (this.stats.messagesByRegion[region] ?? 0) + 1
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create and initialize an XMTP router
 */
export async function createRouter(
  config?: Partial<RouteConfig>,
): Promise<XMTPMessageRouter> {
  const router = new XMTPMessageRouter(config)
  await router.initialize()
  return router
}

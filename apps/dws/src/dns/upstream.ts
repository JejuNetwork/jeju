/**
 * Upstream DNS Forwarder
 *
 * Forwards non-.jns domain queries to upstream DNS resolvers (Cloudflare, Google, etc.)
 * Uses UDP for standard DNS resolution with fallback to multiple servers.
 */

import * as dgram from 'node:dgram'
import { LRUCache } from 'lru-cache'
import type { DNSConfig, DNSMessage, DNSStats } from './types'
import {
  createSERVFAILResponse,
  decodeDNSMessage,
  encodeDNSMessage,
} from './wire-format'

const DNS_PORT = 53
const DNS_TIMEOUT_MS = 5000
const MAX_RETRIES = 2

interface PendingQuery {
  resolve: (response: DNSMessage) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  retries: number
  upstreamIndex: number
}

interface CacheEntry {
  response: DNSMessage
  expiresAt: number
}

export class UpstreamDNSForwarder {
  private config: DNSConfig
  private socket: dgram.Socket | null = null
  private pendingQueries: Map<number, PendingQuery> = new Map()
  private queryIdCounter = 0
  private cache: LRUCache<string, CacheEntry>
  private stats: DNSStats = {
    totalQueries: 0,
    jnsQueries: 0,
    upstreamQueries: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    averageLatencyMs: 0,
    queriesByType: {},
  }
  private latencies: number[] = []
  private readonly MAX_LATENCY_SAMPLES = 100

  constructor(config: DNSConfig) {
    this.config = config
    this.cache = new LRUCache<string, CacheEntry>({
      max: 10000,
      ttl: config.cacheTTL * 1000,
    })
  }

  /**
   * Initialize the UDP socket for upstream queries
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4')

      this.socket.on('message', (msg) => {
        this.handleResponse(Buffer.from(msg))
      })

      this.socket.on('error', (err) => {
        console.error('[UpstreamDNS] Socket error:', err.message)
        this.stats.errors++
        // Reject if we haven't started listening yet
        reject(err)
      })

      this.socket.on('listening', () => {
        const address = this.socket?.address()
        if (this.config.verbose && address) {
          console.log(
            `[UpstreamDNS] Listening on ${address.address}:${address.port}`,
          )
        }
        resolve()
      })

      // Bind to ephemeral port - the 'listening' event handler will call resolve()
      this.socket.bind(0)
    })
  }

  /**
   * Forward a DNS query to upstream resolvers
   */
  async forward(query: DNSMessage): Promise<DNSMessage> {
    const question = query.questions[0]
    if (!question) {
      return createSERVFAILResponse(query)
    }

    const cacheKey = `${question.name}:${question.type}:${question.class}`

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      this.stats.cacheHits++
      // Return cached response with original query ID
      return {
        ...cached.response,
        id: query.id,
      }
    }

    this.stats.cacheMisses++
    this.stats.upstreamQueries++
    this.stats.totalQueries++
    this.stats.queriesByType[question.type] =
      (this.stats.queriesByType[question.type] || 0) + 1

    const startTime = Date.now()

    // Try upstream resolvers in order
    let lastError: Error | null = null
    for (
      let upstreamIndex = 0;
      upstreamIndex < this.config.upstreamDNS.length;
      upstreamIndex++
    ) {
      const upstream = this.config.upstreamDNS[upstreamIndex]
      if (!upstream) continue

      for (let retry = 0; retry <= MAX_RETRIES; retry++) {
        const response = await this.sendQuery(
          query,
          upstream,
          upstreamIndex,
          retry,
        ).catch((err: unknown) => {
          lastError = err instanceof Error ? err : new Error(String(err))
          return null
        })

        if (response) {
          // Record latency
          const latency = Date.now() - startTime
          this.recordLatency(latency)

          // Cache successful response
          const minTTL = this.getMinTTL(response)
          if (minTTL > 0) {
            this.cache.set(cacheKey, {
              response,
              expiresAt: Date.now() + minTTL * 1000,
            })
          }

          return response
        }
      }
    }

    this.stats.errors++
    const errorMessage = lastError
      ? (lastError as Error).message
      : 'Unknown error'
    console.error('[UpstreamDNS] All resolvers failed:', errorMessage)
    return createSERVFAILResponse(query)
  }

  /**
   * Send query to a specific upstream resolver
   */
  private sendQuery(
    query: DNSMessage,
    upstream: string,
    upstreamIndex: number,
    retry: number,
  ): Promise<DNSMessage> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not initialized'))
        return
      }

      // Generate unique query ID
      const queryId = this.queryIdCounter++ % 65536
      const queryWithId = { ...query, id: queryId }
      const encoded = encodeDNSMessage(queryWithId)

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingQueries.delete(queryId)
        reject(new Error(`DNS query timeout to ${upstream}`))
      }, DNS_TIMEOUT_MS)

      // Store pending query
      this.pendingQueries.set(queryId, {
        resolve,
        reject,
        timeout,
        retries: retry,
        upstreamIndex,
      })

      // Send query
      this.socket.send(encoded, DNS_PORT, upstream, (err) => {
        if (err) {
          clearTimeout(timeout)
          this.pendingQueries.delete(queryId)
          reject(err)
        }
      })
    })
  }

  /**
   * Handle response from upstream resolver
   */
  private handleResponse(data: Buffer): void {
    const response = decodeDNSMessage(data)
    const pending = this.pendingQueries.get(response.id)

    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingQueries.delete(response.id)
      pending.resolve(response)
    }
  }

  /**
   * Get minimum TTL from response records
   */
  private getMinTTL(response: DNSMessage): number {
    let minTTL = this.config.cacheTTL

    for (const record of response.answers) {
      if (record.ttl > 0 && record.ttl < minTTL) {
        minTTL = record.ttl
      }
    }

    return minTTL
  }

  /**
   * Record query latency for statistics
   */
  private recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs)
    if (this.latencies.length > this.MAX_LATENCY_SAMPLES) {
      this.latencies.shift()
    }
    this.stats.averageLatencyMs =
      this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
  }

  /**
   * Get forwarder statistics
   */
  getStats(): DNSStats {
    return { ...this.stats }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Shutdown forwarder
   */
  shutdown(): void {
    // Clear all pending queries
    for (const [id, pending] of this.pendingQueries) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Forwarder shutting down'))
      this.pendingQueries.delete(id)
    }

    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }
}

// Factory
let forwarder: UpstreamDNSForwarder | null = null

export async function getUpstreamForwarder(
  config: DNSConfig,
): Promise<UpstreamDNSForwarder> {
  if (!forwarder) {
    forwarder = new UpstreamDNSForwarder(config)
    await forwarder.initialize()
  }
  return forwarder
}

export function shutdownUpstreamForwarder(): void {
  if (forwarder) {
    forwarder.shutdown()
    forwarder = null
  }
}

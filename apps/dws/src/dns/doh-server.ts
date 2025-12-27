/**
 * DNS-over-HTTPS (DoH) Server
 *
 * Implements RFC 8484 for DNS resolution over HTTPS.
 * Supports both GET (dns parameter) and POST (application/dns-message) methods.
 *
 * Integrates with:
 * - JNS Resolver: For .jns domain resolution via on-chain lookups
 * - Upstream Forwarder: For standard DNS resolution
 * - Moderation System: For banned domain checking
 */

import { Elysia } from 'elysia'
import { initializeJNSResolver, type JNSResolver } from './jns-resolver'
import type { DNSMessage, DNSResourceRecord } from './types'
import {
  createDefaultDNSConfig,
  type DNSConfig,
  DNSRecordType,
  DNSResponseCode,
  type DNSStats,
} from './types'
import {
  getUpstreamForwarder,
  shutdownUpstreamForwarder,
  type UpstreamDNSForwarder,
} from './upstream'
import {
  createDNSResponse,
  createNXDOMAINResponse,
  createSERVFAILResponse,
  decodeDNSMessage,
  encodeDNSMessage,
  validateDNSMessage,
} from './wire-format'

const DOH_CONTENT_TYPE = 'application/dns-message'

// Rate limiting store
interface RateLimitEntry {
  count: number
  resetAt: number
}

export class DoHServer {
  private config: DNSConfig
  private jnsResolver: JNSResolver
  private upstreamForwarder: UpstreamDNSForwarder | null = null
  private rateLimitStore: Map<string, RateLimitEntry> = new Map()
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
  private initialized = false

  constructor(config: DNSConfig) {
    this.config = config
    this.jnsResolver = initializeJNSResolver(config)
  }

  /**
   * Initialize the DoH server
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    this.upstreamForwarder = await getUpstreamForwarder(this.config)
    this.initialized = true

    if (this.config.verbose) {
      console.log('[DoH] Server initialized')
      console.log(`[DoH] JNS suffix: ${this.config.jnsSuffix}`)
      console.log(`[DoH] Upstream DNS: ${this.config.upstreamDNS.join(', ')}`)
    }
  }

  /**
   * Handle DoH GET request (RFC 8484 Section 4.1)
   * DNS query is base64url encoded in the 'dns' query parameter
   */
  async handleGet(dnsParam: string, clientIP: string): Promise<Response> {
    // Rate limit check
    const rateLimitResult = this.checkRateLimit(clientIP)
    if (!rateLimitResult.allowed) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
          ),
        },
      })
    }

    // Decode base64url DNS message
    const dnsBuffer = this.base64urlDecode(dnsParam)
    if (!dnsBuffer) {
      return new Response('Invalid DNS message encoding', { status: 400 })
    }

    return this.processQuery(dnsBuffer, clientIP)
  }

  /**
   * Handle DoH POST request (RFC 8484 Section 4.1)
   * DNS query is in raw wire format in request body
   */
  async handlePost(body: ArrayBuffer, clientIP: string): Promise<Response> {
    // Rate limit check
    const rateLimitResult = this.checkRateLimit(clientIP)
    if (!rateLimitResult.allowed) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
          ),
        },
      })
    }

    const dnsBuffer = Buffer.from(body)
    return this.processQuery(dnsBuffer, clientIP)
  }

  /**
   * Process a DNS query and return response
   */
  private async processQuery(
    queryBuffer: Buffer,
    _clientIP: string,
  ): Promise<Response> {
    const startTime = Date.now()
    this.stats.totalQueries++

    // Decode DNS message
    let query: DNSMessage
    try {
      query = decodeDNSMessage(queryBuffer)
    } catch (_err) {
      this.stats.errors++
      return new Response('Invalid DNS message format', { status: 400 })
    }

    // Validate query
    const validation = validateDNSMessage(query)
    if (!validation.valid) {
      this.stats.errors++
      return new Response(validation.error ?? 'Invalid DNS query', {
        status: 400,
      })
    }

    const question = query.questions[0]
    if (!question) {
      this.stats.errors++
      return new Response('No question in query', { status: 400 })
    }

    // Track query type
    this.stats.queriesByType[question.type] =
      (this.stats.queriesByType[question.type] || 0) + 1

    // Route query based on domain
    let response: DNSMessage
    if (this.isJNSDomain(question.name)) {
      response = await this.resolveJNS(query, question.name, question.type)
      this.stats.jnsQueries++
    } else {
      response = await this.resolveUpstream(query)
      this.stats.upstreamQueries++
    }

    // Record latency
    const latency = Date.now() - startTime
    this.recordLatency(latency)

    // Encode response
    const responseBuffer = encodeDNSMessage(response)

    return new Response(new Uint8Array(responseBuffer), {
      status: 200,
      headers: {
        'Content-Type': DOH_CONTENT_TYPE,
        'Cache-Control': `max-age=${this.getCacheMaxAge(response)}`,
        'X-DNS-Question': `${question.name} ${question.type}`,
        'X-DNS-Answers': String(response.answers.length),
        'X-DNS-Latency': `${latency}ms`,
      },
    })
  }

  /**
   * Check if domain is a .jns domain
   */
  private isJNSDomain(name: string): boolean {
    const normalized = name.toLowerCase()
    return (
      normalized.endsWith(this.config.jnsSuffix) ||
      normalized.endsWith(`${this.config.jnsSuffix}.`)
    )
  }

  /**
   * Resolve a .jns domain
   */
  private async resolveJNS(
    query: DNSMessage,
    name: string,
    queryType: number,
  ): Promise<DNSMessage> {
    // Normalize name
    let normalizedName = name.toLowerCase()
    if (normalizedName.endsWith('.')) {
      normalizedName = normalizedName.slice(0, -1)
    }

    // Resolve via JNS
    const result = await this.jnsResolver.resolve(normalizedName)
    if (!result) {
      return createNXDOMAINResponse(query)
    }

    // Build answer records based on query type
    const answers: DNSResourceRecord[] = []

    switch (queryType) {
      case DNSRecordType.A: {
        const aRecord = this.jnsResolver.createARecord(result)
        answers.push(aRecord)
        break
      }

      case DNSRecordType.AAAA: {
        const aaaaRecord = this.jnsResolver.createAAAARecord(result)
        if (aaaaRecord) {
          answers.push(aaaaRecord)
        }
        break
      }

      case DNSRecordType.TXT: {
        const txtRecord = this.jnsResolver.createTXTRecord(result)
        answers.push(txtRecord)
        break
      }

      case DNSRecordType.ANY: {
        // Return all available records
        const aRecord = this.jnsResolver.createARecord(result)
        answers.push(aRecord)

        const aaaaRecord = this.jnsResolver.createAAAARecord(result)
        if (aaaaRecord) {
          answers.push(aaaaRecord)
        }

        const txtRecord = this.jnsResolver.createTXTRecord(result)
        answers.push(txtRecord)
        break
      }

      default: {
        // For unsupported types, return A record as fallback
        const aRecord = this.jnsResolver.createARecord(result)
        answers.push(aRecord)
      }
    }

    return createDNSResponse(query, answers)
  }

  /**
   * Forward query to upstream DNS
   */
  private async resolveUpstream(query: DNSMessage): Promise<DNSMessage> {
    if (!this.upstreamForwarder) {
      return createSERVFAILResponse(query)
    }

    return this.upstreamForwarder.forward(query)
  }

  /**
   * Check rate limit for client
   */
  private checkRateLimit(clientIP: string): {
    allowed: boolean
    resetAt: number
  } {
    const now = Date.now()
    const windowMs = 60000 // 1 minute

    let entry = this.rateLimitStore.get(clientIP)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      this.rateLimitStore.set(clientIP, entry)
    }

    entry.count++

    if (entry.count > this.config.rateLimit) {
      return { allowed: false, resetAt: entry.resetAt }
    }

    return { allowed: true, resetAt: entry.resetAt }
  }

  /**
   * Get cache max-age for response
   */
  private getCacheMaxAge(response: DNSMessage): number {
    let minTTL = this.config.cacheTTL

    for (const record of response.answers) {
      if (record.ttl > 0 && record.ttl < minTTL) {
        minTTL = record.ttl
      }
    }

    return minTTL
  }

  /**
   * Record query latency
   */
  private recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs)
    if (this.latencies.length > 100) {
      this.latencies.shift()
    }
    this.stats.averageLatencyMs =
      this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
  }

  /**
   * Decode base64url string to Buffer
   */
  private base64urlDecode(str: string): Buffer | null {
    try {
      // Convert base64url to base64
      let base64 = str.replace(/-/g, '+').replace(/_/g, '/')

      // Add padding if needed
      const padding = 4 - (base64.length % 4)
      if (padding !== 4) {
        base64 += '='.repeat(padding)
      }

      return Buffer.from(base64, 'base64')
    } catch {
      return null
    }
  }

  /**
   * Get server statistics
   */
  getStats(): DNSStats {
    const upstreamStats = this.upstreamForwarder?.getStats()
    return {
      ...this.stats,
      cacheHits: this.stats.cacheHits + (upstreamStats?.cacheHits ?? 0),
      cacheMisses: this.stats.cacheMisses + (upstreamStats?.cacheMisses ?? 0),
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.jnsResolver.clearCache()
    this.upstreamForwarder?.clearCache()
  }

  /**
   * Shutdown server
   */
  shutdown(): void {
    shutdownUpstreamForwarder()
    this.rateLimitStore.clear()
  }
}

// Factory and singleton
let dohServer: DoHServer | null = null

export function getDoHServer(config?: DNSConfig): DoHServer {
  if (!dohServer && config) {
    dohServer = new DoHServer(config)
  }
  if (!dohServer) {
    throw new Error('DoH server not initialized. Call with config first.')
  }
  return dohServer
}

export async function initializeDoHServer(
  config: DNSConfig,
): Promise<DoHServer> {
  dohServer = new DoHServer(config)
  await dohServer.initialize()
  return dohServer
}

export function shutdownDoHServer(): void {
  if (dohServer) {
    dohServer.shutdown()
    dohServer = null
  }
}

/**
 * Create Elysia router for DoH endpoints
 */
export function createDoHRouter(config?: DNSConfig) {
  const dnsConfig = config ?? createDefaultDNSConfig()

  return (
    new Elysia({ prefix: '/dns' })
      .onStart(async () => {
        if (dnsConfig.dohEnabled) {
          await initializeDoHServer(dnsConfig)
          console.log('[DNS] DoH server initialized')
        }
      })
      .onStop(() => {
        shutdownDoHServer()
      })
      // DoH endpoint - RFC 8484
      .get('/dns-query', async ({ query, request, set }) => {
        if (!dnsConfig.dohEnabled) {
          set.status = 503
          return { error: 'DoH not enabled' }
        }

        const dnsParam = query.dns
        if (!dnsParam || typeof dnsParam !== 'string') {
          set.status = 400
          return { error: 'Missing dns parameter' }
        }

        const clientIP = getClientIP(request)
        const server = getDoHServer()
        return server.handleGet(dnsParam, clientIP)
      })
      .post('/dns-query', async ({ request, set }) => {
        if (!dnsConfig.dohEnabled) {
          set.status = 503
          return { error: 'DoH not enabled' }
        }

        const contentType = request.headers.get('content-type')
        if (contentType !== DOH_CONTENT_TYPE) {
          set.status = 415
          return {
            error: `Unsupported content type. Expected ${DOH_CONTENT_TYPE}`,
          }
        }

        const body = await request.arrayBuffer()
        const clientIP = getClientIP(request)
        const server = getDoHServer()
        return server.handlePost(body, clientIP)
      })
      // Health and stats endpoints
      .get('/health', () => {
        return {
          status: 'healthy',
          service: 'dns-doh',
          dohEnabled: dnsConfig.dohEnabled,
          dotEnabled: dnsConfig.dotEnabled,
        }
      })
      .get('/stats', () => {
        if (dohServer) {
          return dohServer.getStats()
        }
        return { error: 'Server not initialized' }
      })
      // Resolve endpoint (JSON API)
      .get('/resolve', async ({ query, set }) => {
        const name = query.name
        const type = query.type ?? 'A'

        if (!name || typeof name !== 'string') {
          set.status = 400
          return { error: 'Missing name parameter' }
        }

        // Simple JSON resolution for debugging/testing
        const typeNum =
          typeof type === 'string' ? parseQueryType(type) : DNSRecordType.A

        // Build a minimal query message
        const queryMsg: DNSMessage = {
          id: Math.floor(Math.random() * 65536),
          flags: {
            qr: false,
            opcode: 0,
            aa: false,
            tc: false,
            rd: true,
            ra: false,
            rcode: DNSResponseCode.NOERROR,
          },
          questions: [{ name, type: typeNum, class: 1 }],
          answers: [],
          authorities: [],
          additionals: [],
        }

        const server = getDoHServer()

        // Check if JNS domain
        if (name.endsWith('.jns') || name.endsWith('.jns.')) {
          const response = await server.resolveJNS(queryMsg, name, typeNum)
          return {
            name,
            type,
            answers: response.answers.map((a: DNSResourceRecord) => ({
              name: a.name,
              type: a.type,
              ttl: a.ttl,
              data: String(a.data),
            })),
            rcode: response.flags.rcode,
          }
        }

        // Forward to upstream
        const response = await server.resolveUpstream(queryMsg)
        return {
          name,
          type,
          answers: response.answers.map((a: DNSResourceRecord) => ({
            name: a.name,
            type: a.type,
            ttl: a.ttl,
            data: String(a.data),
          })),
          rcode: response.flags.rcode,
        }
      })
  )
}

/**
 * Get client IP from request headers
 */
function getClientIP(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim() ?? 'unknown'
  }
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    'unknown'
  )
}

/**
 * Parse query type string to number
 */
function parseQueryType(type: string): number {
  const typeMap: Record<string, number> = {
    A: DNSRecordType.A,
    AAAA: DNSRecordType.AAAA,
    CNAME: DNSRecordType.CNAME,
    TXT: DNSRecordType.TXT,
    MX: DNSRecordType.MX,
    NS: DNSRecordType.NS,
    SOA: DNSRecordType.SOA,
    PTR: DNSRecordType.PTR,
    SRV: DNSRecordType.SRV,
    ANY: DNSRecordType.ANY,
  }
  return typeMap[type.toUpperCase()] ?? DNSRecordType.A
}

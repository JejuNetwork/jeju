/**
 * DNS API Routes
 *
 * Exposes DNS-over-HTTPS endpoints as part of the DWS API.
 * Mounted at /dns/* in the main server.
 *
 * Endpoints:
 * - GET/POST /dns/dns-query: RFC 8484 DoH endpoint
 * - GET /dns/resolve: JSON resolution API
 * - GET /dns/health: Health check
 * - GET /dns/stats: Statistics
 */

import { getContract, getCurrentNetwork, getRpcUrl } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  createDefaultDNSConfig,
  type DNSConfig,
  type DNSMessage,
  DNSRecordType,
  type DNSResourceRecord,
  DNSResponseCode,
  getDoHServer,
  initializeDoHServer,
  shutdownDoHServer,
} from '../../../src/dns'

const NETWORK = getCurrentNetwork()

const DOH_CONTENT_TYPE = 'application/dns-message'

/**
 * Get contract address safely
 */
function getContractSafe(name: string): Address {
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Address
  try {
    const addr = getContract('registry', name, NETWORK)
    return (addr || ZERO_ADDR) as Address
  } catch {
    return ZERO_ADDR
  }
}

/**
 * Create DNS configuration from environment and on-chain registry
 */
function createDNSConfigFromEnv(): DNSConfig {
  // Get edge node IPs from environment or use defaults
  const edgeIPv4 = process.env.DNS_EDGE_IPV4?.split(',').filter(Boolean) ?? []
  const edgeIPv6 = process.env.DNS_EDGE_IPV6?.split(',').filter(Boolean) ?? []

  // If no edge IPs configured, use the DWS server's public IP (for development)
  if (edgeIPv4.length === 0) {
    const publicIP = process.env.PUBLIC_IP ?? '127.0.0.1'
    edgeIPv4.push(publicIP)
  }

  if (edgeIPv6.length === 0) {
    edgeIPv6.push('::1')
  }

  return createDefaultDNSConfig({
    dohEnabled: process.env.DOH_ENABLED !== 'false',
    dotEnabled: process.env.DOT_ENABLED === 'true',
    dotPort: parseInt(process.env.DOT_PORT ?? '853', 10),
    upstreamDNS: process.env.UPSTREAM_DNS?.split(',').filter(Boolean) ?? [
      '1.1.1.1',
      '8.8.8.8',
      '9.9.9.9',
    ],
    cacheTTL: parseInt(process.env.DNS_CACHE_TTL ?? '300', 10),
    jnsSuffix: process.env.JNS_SUFFIX ?? '.jns',
    rpcUrl: getRpcUrl(NETWORK),
    jnsRegistryAddress: getContractSafe('jns'),
    jnsResolverAddress: getContractSafe('jnsResolver'),
    edgeNodeIPs: {
      ipv4: edgeIPv4,
      ipv6: edgeIPv6,
    },
    rateLimit: parseInt(process.env.DNS_RATE_LIMIT ?? '1000', 10),
    verbose: process.env.DNS_VERBOSE === 'true',
  })
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

// Module-level config
let dnsConfig: DNSConfig | null = null

/**
 * Create the DNS router - implements DoH endpoints directly
 */
export function createDNSRouter() {
  dnsConfig = createDNSConfigFromEnv()
  const config = dnsConfig

  return (
    new Elysia({ prefix: '/dns' })
      .onStart(async () => {
        if (config.dohEnabled) {
          await initializeDoHServer(config)
          console.log('[DNS] DoH server initialized')
        }
      })
      .onStop(() => {
        shutdownDoHServer()
      })
      // DoH endpoint - RFC 8484 GET
      .get('/dns-query', async ({ query, request, set }) => {
        if (!config.dohEnabled) {
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
      // DoH endpoint - RFC 8484 POST
      .post('/dns-query', async ({ request, set }) => {
        if (!config.dohEnabled) {
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
      // Health endpoint
      .get('/health', () => {
        return {
          status: 'healthy',
          service: 'dns-doh',
          dohEnabled: config.dohEnabled,
          dotEnabled: config.dotEnabled,
        }
      })
      // Stats endpoint
      .get('/stats', () => {
        try {
          const server = getDoHServer()
          return server.getStats()
        } catch {
          return { error: 'Server not initialized' }
        }
      })
      // JSON resolve endpoint
      .get('/resolve', async ({ query, set }) => {
        const name = query.name
        const type = query.type ?? 'A'

        if (!name || typeof name !== 'string') {
          set.status = 400
          return { error: 'Missing name parameter' }
        }

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
      // Config endpoint
      .get('/config', () => {
        return {
          dohEnabled: config.dohEnabled,
          dotEnabled: config.dotEnabled,
          jnsSuffix: config.jnsSuffix,
          upstreamDNS: config.upstreamDNS,
          cacheTTL: config.cacheTTL,
          rateLimit: config.rateLimit,
          edgeNodes: {
            ipv4Count: config.edgeNodeIPs.ipv4.length,
            ipv6Count: config.edgeNodeIPs.ipv6.length,
          },
        }
      })
      // Direct JNS resolution endpoint
      .get('/jns/:name', async ({ params }) => {
        const { name } = params
        const fullName = name.endsWith('.jns') ? name : `${name}.jns`

        const { getJNSResolver } = await import('../../../src/dns/jns-resolver')
        const resolver = getJNSResolver(config)

        const result = await resolver.resolve(fullName)
        if (!result) {
          return {
            error: 'Domain not found',
            name: fullName,
          }
        }

        return {
          name: result.name,
          protocol: result.protocol,
          hash: result.hash,
          edgeIP: result.edgeNodeIP,
          edgeIPv6: result.edgeNodeIPv6,
          ttl: result.ttl,
          resolvedAt: result.resolvedAt,
          url: `${result.protocol}://${result.hash}`,
        }
      })
      // Moderation status endpoint
      .get('/jns/:name/moderation', async ({ params }) => {
        const { name } = params
        const fullName = name.endsWith('.jns') ? name : `${name}.jns`

        const { getJNSResolver } = await import('../../../src/dns/jns-resolver')
        const resolver = getJNSResolver(config)

        const moderation = await resolver.checkModeration(fullName)
        return moderation
      })
  )
}

/**
 * Standalone DNS server entry point
 * Can be run separately from DWS for dedicated DNS infrastructure
 */
export async function startStandaloneDNSServer(port = 4053): Promise<void> {
  const config = createDNSConfigFromEnv()
  await initializeDoHServer(config)

  new Elysia()
    .use(createDNSRouter())
    .get('/health', () => ({ status: 'healthy', service: 'dns-standalone' }))
    .listen(port)

  console.log(`[DNS] Standalone server running on port ${port}`)
  console.log(`[DNS] DoH endpoint: http://localhost:${port}/dns/dns-query`)
  console.log(
    `[DNS] Resolve endpoint: http://localhost:${port}/dns/resolve?name=example.jns`,
  )
}

// CLI entry point
if (import.meta.main) {
  const port = parseInt(process.env.DNS_PORT ?? '4053', 10)
  startStandaloneDNSServer(port)
}

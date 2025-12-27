/**
 * DNS Types for DoH/DoT Server
 *
 * Implements RFC 8484 (DNS over HTTPS) and RFC 7858 (DNS over TLS)
 * with JNS (Jeju Name Service) integration for .jns domain resolution.
 */

import { z } from 'zod'

// DNS Record Types (RFC 1035)
export const DNSRecordType = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  HTTPS: 65,
  ANY: 255,
} as const

export type DNSRecordType = (typeof DNSRecordType)[keyof typeof DNSRecordType]

// DNS Response Codes (RFC 1035)
export const DNSResponseCode = {
  NOERROR: 0,
  FORMERR: 1, // Format error
  SERVFAIL: 2, // Server failure
  NXDOMAIN: 3, // Non-existent domain
  NOTIMP: 4, // Not implemented
  REFUSED: 5, // Query refused
} as const

export type DNSResponseCode =
  (typeof DNSResponseCode)[keyof typeof DNSResponseCode]

// DNS Question structure
export interface DNSQuestion {
  name: string
  type: number
  class: number
}

// DNS Resource Record structure
export interface DNSResourceRecord {
  name: string
  type: number
  class: number
  ttl: number
  data: string | Buffer | DNSRecordData
}

// Specific record data types
export interface DNSRecordDataA {
  type: 'A'
  address: string
}

export interface DNSRecordDataAAAA {
  type: 'AAAA'
  address: string
}

export interface DNSRecordDataCNAME {
  type: 'CNAME'
  target: string
}

export interface DNSRecordDataTXT {
  type: 'TXT'
  data: string[]
}

export interface DNSRecordDataMX {
  type: 'MX'
  preference: number
  exchange: string
}

export interface DNSRecordDataSOA {
  type: 'SOA'
  mname: string
  rname: string
  serial: number
  refresh: number
  retry: number
  expire: number
  minimum: number
}

export interface DNSRecordDataNS {
  type: 'NS'
  target: string
}

export type DNSRecordData =
  | DNSRecordDataA
  | DNSRecordDataAAAA
  | DNSRecordDataCNAME
  | DNSRecordDataTXT
  | DNSRecordDataMX
  | DNSRecordDataSOA
  | DNSRecordDataNS

// DNS Message structure (simplified from RFC 1035)
export interface DNSMessage {
  id: number
  flags: {
    qr: boolean // Query (0) or Response (1)
    opcode: number // 0 = standard query
    aa: boolean // Authoritative answer
    tc: boolean // Truncated
    rd: boolean // Recursion desired
    ra: boolean // Recursion available
    rcode: DNSResponseCode
  }
  questions: DNSQuestion[]
  answers: DNSResourceRecord[]
  authorities: DNSResourceRecord[]
  additionals: DNSResourceRecord[]
}

// JNS Resolution result
export interface JNSResolutionResult {
  name: string
  protocol: 'ipfs' | 'ipns' | 'arweave'
  hash: string
  edgeNodeIP: string
  edgeNodeIPv6?: string
  ttl: number
  resolvedAt: number
}

// DNS Configuration
export interface DNSConfig {
  /** Port for DoH endpoint (usually same as HTTPS port) */
  dohEnabled: boolean

  /** Port for DoT server (853 standard) */
  dotEnabled: boolean
  dotPort: number

  /** Upstream DNS servers for non-.jns domains */
  upstreamDNS: string[]

  /** Cache TTL for DNS responses (seconds) */
  cacheTTL: number

  /** JNS domain suffix */
  jnsSuffix: string

  /** RPC URL for on-chain JNS resolution */
  rpcUrl: string

  /** JNS Registry contract address */
  jnsRegistryAddress: `0x${string}`

  /** JNS Resolver contract address */
  jnsResolverAddress: `0x${string}`

  /** Edge node IPs to return for JNS resolutions */
  edgeNodeIPs: {
    ipv4: string[]
    ipv6: string[]
  }

  /** Rate limit per client IP (queries per minute) */
  rateLimit: number

  /** Enable verbose logging */
  verbose: boolean
}

// DNS Cache entry
export interface DNSCacheEntry {
  message: DNSMessage
  createdAt: number
  expiresAt: number
  source: 'jns' | 'upstream' | 'static'
}

// DoH Request format (RFC 8484)
export const DoHRequestSchema = z.object({
  dns: z.string().optional(), // Base64url encoded DNS message (GET)
  // POST body is raw DNS wire format (application/dns-message)
})

// DNS Statistics
export interface DNSStats {
  totalQueries: number
  jnsQueries: number
  upstreamQueries: number
  cacheHits: number
  cacheMisses: number
  errors: number
  averageLatencyMs: number
  queriesByType: Record<number, number>
}

// Edge Node selection criteria
export interface EdgeNodeSelection {
  clientIP: string
  region?: string
  preferIPv6: boolean
}

// Moderation status for JNS domains
export interface JNSDomainModeration {
  name: string
  isBanned: boolean
  bannedAt?: number
  reason?: string
  appealable: boolean
}

// Default configuration factory
export function createDefaultDNSConfig(
  overrides: Partial<DNSConfig> = {},
): DNSConfig {
  return {
    dohEnabled: true,
    dotEnabled: false, // DoT requires TLS setup
    dotPort: 853,
    upstreamDNS: ['1.1.1.1', '8.8.8.8', '9.9.9.9'],
    cacheTTL: 300, // 5 minutes
    jnsSuffix: '.jns',
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
    jnsRegistryAddress:
      (process.env.JNS_REGISTRY_ADDRESS as `0x${string}`) ??
      '0x0000000000000000000000000000000000000000',
    jnsResolverAddress:
      (process.env.JNS_RESOLVER_ADDRESS as `0x${string}`) ??
      '0x0000000000000000000000000000000000000000',
    edgeNodeIPs: {
      ipv4: ['127.0.0.1'], // Will be populated from on-chain registry
      ipv6: ['::1'],
    },
    rateLimit: 1000,
    verbose: process.env.DNS_VERBOSE === 'true',
    ...overrides,
  }
}

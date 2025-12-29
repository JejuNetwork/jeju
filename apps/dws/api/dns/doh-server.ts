/**
 * DNS over HTTPS (DoH) Server
 *
 * RFC 8484 compliant DoH server that:
 * - Accepts DNS queries over HTTPS (GET and POST)
 * - Supports both application/dns-message and application/dns-json
 * - Integrates with JNS for .jeju TLD
 * - Falls back to upstream DNS for other domains
 */

import { getContract, getRpcUrl } from '@jejunetwork/config'
import { readContract } from '@jejunetwork/contracts'
import { Elysia, t } from 'elysia'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  keccak256,
  stringToBytes,
} from 'viem'
import {
  DNSClass,
  type DNSMessage,
  type DNSQuestion,
  DNSRecordType,
  DNSResponseCode,
  type DoHResponse,
} from './types'

// JNS ABI for resolver
const JNS_REGISTRY_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'resolver',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'addr',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'contenthash',
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    name: 'text',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ENS Registry on Ethereum Mainnet
const ENS_REGISTRY_ADDRESS =
  '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address

// ENS Public Resolver ABI (same structure as JNS)
const ENS_RESOLVER_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'addr',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'contenthash',
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    name: 'text',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

function namehash(name: string): Hex {
  const labels = name.toLowerCase().replace(/\.$/, '').split('.').reverse()
  let node: Hex = `0x${'0'.repeat(64)}` as Hex

  for (const label of labels) {
    const labelHash = keccak256(stringToBytes(label))
    node = keccak256(`${node}${labelHash.slice(2)}` as Hex) as Hex
  }

  return node
}

export interface DoHServerConfig {
  port: number
  /** Upstream DoH servers for fallback (Cloudflare, Google, etc.) */
  upstreamServers: string[]
  /** JNS resolver for .jeju domains */
  jnsResolverAddress?: Address
  /** ENS resolver for .eth domains */
  ensResolverAddress?: Address
  /** RPC URL for blockchain resolution (Jeju network) */
  rpcUrl?: string
  /** Ethereum mainnet RPC URL for ENS resolution */
  ethRpcUrl?: string
  /** Enable DNSSEC validation */
  dnssecEnabled: boolean
  /** Cache TTL in seconds */
  cacheTTL: number
  /** Custom TLDs handled by this server */
  customTLDs: string[]
}

const DEFAULT_CONFIG: DoHServerConfig = {
  port: 5353,
  upstreamServers: [
    'https://cloudflare-dns.com/dns-query',
    'https://dns.google/dns-query',
    'https://dns.quad9.net/dns-query',
  ],
  dnssecEnabled: false,
  cacheTTL: 300,
  customTLDs: ['jeju', 'jns'],
}

interface CacheEntry {
  response: DoHResponse
  expiresAt: number
}

export class DoHServer {
  private config: DoHServerConfig
  private cache = new Map<string, CacheEntry>()
  private app: ReturnType<typeof this.createApp>

  constructor(config: Partial<DoHServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.app = this.createApp()
  }

  private createApp() {
    return (
      new Elysia({ name: 'doh-server' })
        .get('/dns-query', async ({ query, set, headers }) => {
          // RFC 8484 GET method with dns parameter (base64url encoded)
          const dnsParam = query.dns
          if (!dnsParam) {
            set.status = 400
            return { error: 'Missing dns parameter' }
          }

          const wireFormat = this.base64UrlDecode(dnsParam)
          const message = this.parseDNSMessage(wireFormat)

          if (message.questions.length === 0) {
            set.status = 400
            return { error: 'No questions in query' }
          }

          const response = await this.resolve(message.questions[0])

          // Check Accept header for response format
          const accept = headers.accept ?? 'application/dns-message'

          if (accept.includes('application/dns-json')) {
            set.headers['content-type'] = 'application/dns-json'
            return response
          }

          // Default: return wire format
          set.headers['content-type'] = 'application/dns-message'
          const responseData = this.encodeDNSResponse(message.id, response)
          // Create a fresh ArrayBuffer copy to avoid SharedArrayBuffer type issues
          const buf = new ArrayBuffer(responseData.byteLength)
          new Uint8Array(buf).set(responseData)
          return new Response(buf)
        })

        .post('/dns-query', async ({ body, set, headers }) => {
          // RFC 8484 POST method with body as DNS wire format
          const wireFormat = new Uint8Array(body as ArrayBuffer)
          const message = this.parseDNSMessage(wireFormat)

          if (message.questions.length === 0) {
            set.status = 400
            return { error: 'No questions in query' }
          }

          const response = await this.resolve(message.questions[0])

          const accept = headers.accept ?? 'application/dns-message'

          if (accept.includes('application/dns-json')) {
            set.headers['content-type'] = 'application/dns-json'
            return response
          }

          set.headers['content-type'] = 'application/dns-message'
          const encoded = this.encodeDNSResponse(message.id, response)
          // Create a fresh ArrayBuffer copy to avoid SharedArrayBuffer type issues
          const buf = new ArrayBuffer(encoded.byteLength)
          new Uint8Array(buf).set(encoded)
          return new Response(buf)
        })

        // JSON API for easier debugging
        .get(
          '/resolve',
          async ({ query }) => {
            const name = query.name
            const typeStr = query.type ?? 'A'
            const type =
              DNSRecordType[typeStr as keyof typeof DNSRecordType] ??
              DNSRecordType.A

            const question: DNSQuestion = {
              name,
              type,
              class: DNSClass.IN,
            }

            return this.resolve(question)
          },
          {
            query: t.Object({
              name: t.String(),
              type: t.Optional(t.String()),
            }),
          },
        )

        .get('/health', () => ({
          status: 'healthy',
          service: 'doh-server',
          upstreams: this.config.upstreamServers,
          customTLDs: this.config.customTLDs,
          cacheSize: this.cache.size,
        }))
    )
  }

  /**
   * Resolve a DNS question
   */
  async resolve(question: DNSQuestion): Promise<DoHResponse> {
    const cacheKey = `${question.name}:${question.type}`

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.response
    }

    // Determine resolver based on TLD
    const tld = this.getTLD(question.name)

    let response: DoHResponse

    if (this.config.customTLDs.includes(tld)) {
      // Handle custom TLDs (jeju, jns)
      response = await this.resolveCustomTLD(question)
    } else if (tld === 'eth') {
      // Handle ENS domains
      response = await this.resolveENS(question)
    } else {
      // Fallback to upstream DNS
      response = await this.resolveUpstream(question)
    }

    // Cache the response
    const minTTL = response.Answer
      ? Math.min(...response.Answer.map((a) => a.TTL))
      : this.config.cacheTTL

    this.cache.set(cacheKey, {
      response,
      expiresAt: Date.now() + minTTL * 1000,
    })

    return response
  }

  /**
   * Resolve custom TLDs (jeju, jns) via JNS on-chain
   */
  private async resolveCustomTLD(question: DNSQuestion): Promise<DoHResponse> {
    const response: DoHResponse = {
      Status: DNSResponseCode.NOERROR,
      TC: false,
      RD: true,
      RA: true,
      AD: false,
      CD: false,
      Question: [{ name: question.name, type: question.type }],
    }

    try {
      // Get JNS contract addresses
      const jnsRegistry =
        this.config.jnsResolverAddress ||
        (getContract('jns', 'jnsRegistry') as Address | undefined)
      const rpcUrl = this.config.rpcUrl || getRpcUrl()

      if (!jnsRegistry || !rpcUrl) {
        console.warn('[DoH] JNS not configured')
        response.Status = DNSResponseCode.SERVFAIL
        return response
      }

      // Create public client for on-chain queries
      const client = createPublicClient({
        transport: http(rpcUrl),
      })

      // Calculate namehash for the domain
      const node = namehash(question.name)

      // Get resolver for this name
      const resolverAddress = await readContract(client, {
        address: jnsRegistry,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      })

      if (
        !resolverAddress ||
        resolverAddress === '0x0000000000000000000000000000000000000000'
      ) {
        response.Status = DNSResponseCode.NXDOMAIN
        return response
      }

      // Handle different record types
      if (question.type === DNSRecordType.A) {
        // Get address from JNS resolver
        const addr = await readContract(client, {
          address: resolverAddress,
          abi: JNS_RESOLVER_ABI,
          functionName: 'addr',
          args: [node],
        })

        if (addr && addr !== '0x0000000000000000000000000000000000000000') {
          // Check if there's an app.endpoint text record
          const endpoint = await readContract(client, {
            address: resolverAddress,
            abi: JNS_RESOLVER_ABI,
            functionName: 'text',
            args: [node, 'app.endpoint'],
          }).catch(() => null)

          if (endpoint) {
            // Parse endpoint URL to get IP
            const url = new URL(endpoint)
            response.Answer = [
              {
                name: question.name,
                type: DNSRecordType.A,
                TTL: this.config.cacheTTL,
                data: url.hostname, // May need DNS lookup if not IP
              },
            ]
          } else {
            // Return DWS gateway IP for this name
            response.Answer = [
              {
                name: question.name,
                type: DNSRecordType.A,
                TTL: this.config.cacheTTL,
                data: '127.0.0.1', // DWS gateway IP
              },
            ]
          }
        } else {
          response.Status = DNSResponseCode.NXDOMAIN
        }
      } else if (question.type === DNSRecordType.TXT) {
        // Try to get contenthash or text records
        const contenthash = await readContract(client, {
          address: resolverAddress,
          abi: JNS_RESOLVER_ABI,
          functionName: 'contenthash',
          args: [node],
        }).catch(() => null)

        if (contenthash && contenthash !== '0x') {
          // Decode contenthash to IPFS CID (simplified - just show raw hex)
          response.Answer = [
            {
              name: question.name,
              type: DNSRecordType.TXT,
              TTL: this.config.cacheTTL,
              data: `"dnslink=/ipfs/${contenthash}"`,
            },
          ]
        } else {
          // Try to get url text record
          const url = await readContract(client, {
            address: resolverAddress,
            abi: JNS_RESOLVER_ABI,
            functionName: 'text',
            args: [node, 'url'],
          }).catch(() => null)

          if (url) {
            response.Answer = [
              {
                name: question.name,
                type: DNSRecordType.TXT,
                TTL: this.config.cacheTTL,
                data: `"url=${url}"`,
              },
            ]
          }
        }
      }

      return response
    } catch (error) {
      console.error('[DoH] JNS resolution error:', error)
      response.Status = DNSResponseCode.SERVFAIL
      return response
    }
  }

  /**
   * Resolve ENS domains via Ethereum mainnet
   */
  private async resolveENS(question: DNSQuestion): Promise<DoHResponse> {
    const response: DoHResponse = {
      Status: DNSResponseCode.NOERROR,
      TC: false,
      RD: true,
      RA: true,
      AD: false,
      CD: false,
      Question: [{ name: question.name, type: question.type }],
    }

    // Check if Ethereum RPC is configured
    const ethRpcUrl =
      this.config.ethRpcUrl ||
      process.env.ETH_RPC_URL ||
      process.env.ETH_MAINNET_RPC_URL

    if (!ethRpcUrl) {
      console.warn('[DoH] ENS resolution requires ETH_RPC_URL to be configured')
      response.Status = DNSResponseCode.SERVFAIL
      return response
    }

    try {
      // Create client for Ethereum mainnet
      const client = createPublicClient({
        transport: http(ethRpcUrl),
      })

      // Calculate namehash for the ENS domain
      const node = namehash(question.name)

      // Get resolver from ENS registry
      const resolverAddress = await readContract(client, {
        address: ENS_REGISTRY_ADDRESS,
        abi: JNS_REGISTRY_ABI, // Same ABI structure
        functionName: 'resolver',
        args: [node],
      })

      if (
        !resolverAddress ||
        resolverAddress === '0x0000000000000000000000000000000000000000'
      ) {
        response.Status = DNSResponseCode.NXDOMAIN
        return response
      }

      // Handle different record types
      if (question.type === DNSRecordType.A) {
        // Get Ethereum address from ENS resolver
        const addr = await readContract(client, {
          address: resolverAddress,
          abi: ENS_RESOLVER_ABI,
          functionName: 'addr',
          args: [node],
        })

        if (addr && addr !== '0x0000000000000000000000000000000000000000') {
          // ENS A records typically point to IPFS gateway or a DWS endpoint
          // Check for ip.addr text record first (custom for DNS)
          const ipAddr = await readContract(client, {
            address: resolverAddress,
            abi: ENS_RESOLVER_ABI,
            functionName: 'text',
            args: [node, 'ip.addr'],
          }).catch(() => null)

          if (ipAddr && this.isValidIPv4(ipAddr)) {
            response.Answer = [
              {
                name: question.name,
                type: DNSRecordType.A,
                TTL: this.config.cacheTTL,
                data: ipAddr,
              },
            ]
          } else {
            // Fallback: return gateway IP for ENS names
            // In production, this would route to an IPFS/ENS gateway
            response.Answer = [
              {
                name: question.name,
                type: DNSRecordType.A,
                TTL: this.config.cacheTTL,
                data: '127.0.0.1', // Local gateway
              },
            ]
          }
        } else {
          response.Status = DNSResponseCode.NXDOMAIN
        }
      } else if (question.type === DNSRecordType.TXT) {
        // Get contenthash for TXT records (dnslink format)
        const contenthash = await readContract(client, {
          address: resolverAddress,
          abi: ENS_RESOLVER_ABI,
          functionName: 'contenthash',
          args: [node],
        }).catch(() => null)

        if (contenthash && contenthash !== '0x') {
          // Decode contenthash - ENS uses multicodec format
          const cid = this.decodeContenthash(contenthash)
          if (cid) {
            response.Answer = [
              {
                name: question.name,
                type: DNSRecordType.TXT,
                TTL: this.config.cacheTTL,
                data: `"dnslink=/ipfs/${cid}"`,
              },
            ]
          }
        }

        // Also check for url text record
        if (!response.Answer) {
          const url = await readContract(client, {
            address: resolverAddress,
            abi: ENS_RESOLVER_ABI,
            functionName: 'text',
            args: [node, 'url'],
          }).catch(() => null)

          if (url) {
            response.Answer = [
              {
                name: question.name,
                type: DNSRecordType.TXT,
                TTL: this.config.cacheTTL,
                data: `"url=${url}"`,
              },
            ]
          }
        }
      } else if (question.type === DNSRecordType.AAAA) {
        // Check for IPv6 address in text record
        const ipv6Addr = await readContract(client, {
          address: resolverAddress,
          abi: ENS_RESOLVER_ABI,
          functionName: 'text',
          args: [node, 'ip6.addr'],
        }).catch(() => null)

        if (ipv6Addr) {
          response.Answer = [
            {
              name: question.name,
              type: DNSRecordType.AAAA,
              TTL: this.config.cacheTTL,
              data: ipv6Addr,
            },
          ]
        }
      }

      return response
    } catch (error) {
      console.error('[DoH] ENS resolution error:', error)
      response.Status = DNSResponseCode.SERVFAIL
      return response
    }
  }

  /**
   * Validate IPv4 address format
   */
  private isValidIPv4(ip: string): boolean {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    return parts.every((part) => {
      const num = Number.parseInt(part, 10)
      return num >= 0 && num <= 255 && String(num) === part
    })
  }

  /**
   * Decode ENS contenthash to IPFS CID
   * Supports IPFS (0xe3) and IPNS (0xe5) codecs
   */
  private decodeContenthash(contenthash: string): string | null {
    if (!contenthash || contenthash === '0x' || contenthash.length < 10) {
      return null
    }

    // Remove 0x prefix
    const hex = contenthash.slice(2)

    // Check multicodec prefix
    // 0xe3 = IPFS, 0xe5 = IPNS (using varint encoding)
    if (hex.startsWith('e301')) {
      // IPFS with CIDv1 (dag-pb)
      // The CID is encoded after the codec prefix
      const cidHex = hex.slice(4)
      return this.hexToBase32(cidHex)
    } else if (hex.startsWith('e501')) {
      // IPNS
      const cidHex = hex.slice(4)
      return this.hexToBase32(cidHex)
    }

    // Return raw hex as fallback
    return contenthash
  }

  /**
   * Convert hex to base32 (simplified - returns hex for now)
   * Full implementation would use multibase encoding
   */
  private hexToBase32(hex: string): string {
    // For simplicity, return the hex - a full implementation would
    // decode to bytes and re-encode as base32/base58
    return hex
  }

  /**
   * Resolve via upstream DoH servers
   */
  private async resolveUpstream(question: DNSQuestion): Promise<DoHResponse> {
    const params = new URLSearchParams({
      name: question.name,
      type: String(question.type),
    })

    // Try each upstream server in order
    for (const upstream of this.config.upstreamServers) {
      const response = await fetch(`${upstream}?${params}`, {
        headers: { Accept: 'application/dns-json' },
      })

      if (response.ok) {
        return (await response.json()) as DoHResponse
      }
    }

    // All upstreams failed
    return {
      Status: DNSResponseCode.SERVFAIL,
      TC: false,
      RD: true,
      RA: false,
      AD: false,
      CD: false,
      Question: [{ name: question.name, type: question.type }],
    }
  }

  /**
   * Extract TLD from domain name
   */
  private getTLD(name: string): string {
    const parts = name.replace(/\.$/, '').split('.')
    return parts[parts.length - 1].toLowerCase()
  }

  /**
   * Parse DNS wire format message
   */
  private parseDNSMessage(data: Uint8Array): DNSMessage {
    const view = new DataView(data.buffer)
    let offset = 0

    const id = view.getUint16(offset)
    offset += 2

    const flags = view.getUint16(offset)
    offset += 2

    const qdcount = view.getUint16(offset)
    offset += 2
    // Skip answer, nameserver, and additional record counts (required for header parsing)
    offset += 6 // Skip ancount (2) + nscount (2) + arcount (2)

    const questions: DNSQuestion[] = []
    for (let i = 0; i < qdcount; i++) {
      const { name, newOffset } = this.readName(data, offset)
      offset = newOffset
      const qtype = view.getUint16(offset) as DNSRecordType
      offset += 2
      const qclass = view.getUint16(offset) as DNSClass
      offset += 2
      questions.push({ name, type: qtype, class: qclass })
    }

    return {
      id,
      flags: {
        qr: (flags & 0x8000) !== 0,
        opcode: (flags >> 11) & 0xf,
        aa: (flags & 0x0400) !== 0,
        tc: (flags & 0x0200) !== 0,
        rd: (flags & 0x0100) !== 0,
        ra: (flags & 0x0080) !== 0,
        rcode: (flags & 0x000f) as DNSResponseCode,
      },
      questions,
      answers: [], // Not parsing answers for queries
      authority: [],
      additional: [],
    }
  }

  /**
   * Read a domain name from DNS wire format
   */
  private readName(
    data: Uint8Array,
    offset: number,
  ): { name: string; newOffset: number } {
    const labels: string[] = []
    let currentOffset = offset

    while (true) {
      const length = data[currentOffset]

      if (length === 0) {
        currentOffset++
        break
      }

      // Compression pointer
      if ((length & 0xc0) === 0xc0) {
        const pointer = ((length & 0x3f) << 8) | data[currentOffset + 1]
        const { name } = this.readName(data, pointer)
        labels.push(name)
        currentOffset += 2
        return { name: labels.join('.'), newOffset: currentOffset }
      }

      const label = new TextDecoder().decode(
        data.slice(currentOffset + 1, currentOffset + 1 + length),
      )
      labels.push(label)
      currentOffset += 1 + length
    }

    return { name: labels.join('.'), newOffset: currentOffset }
  }

  /**
   * Encode DoH response to DNS wire format
   */
  private encodeDNSResponse(
    queryId: number,
    response: DoHResponse,
  ): Uint8Array {
    const parts: Uint8Array[] = []

    // Header
    const header = new Uint8Array(12)
    const headerView = new DataView(header.buffer)
    headerView.setUint16(0, queryId)

    let flags = 0x8000 // QR = 1 (response)
    if (response.RD) flags |= 0x0100
    if (response.RA) flags |= 0x0080
    if (response.AD) flags |= 0x0020
    if (response.CD) flags |= 0x0010
    flags |= response.Status & 0x000f
    headerView.setUint16(2, flags)

    headerView.setUint16(4, response.Question.length)
    headerView.setUint16(6, response.Answer?.length ?? 0)
    headerView.setUint16(8, response.Authority?.length ?? 0)
    headerView.setUint16(10, 0) // Additional

    parts.push(header)

    // Questions
    for (const q of response.Question) {
      parts.push(this.encodeName(q.name))
      const qtype = new Uint8Array(4)
      const qtypeView = new DataView(qtype.buffer)
      qtypeView.setUint16(0, q.type)
      qtypeView.setUint16(2, DNSClass.IN)
      parts.push(qtype)
    }

    // Answers
    for (const a of response.Answer ?? []) {
      parts.push(this.encodeName(a.name))
      const rr = new Uint8Array(10)
      const rrView = new DataView(rr.buffer)
      rrView.setUint16(0, a.type)
      rrView.setUint16(2, DNSClass.IN)
      rrView.setUint32(4, a.TTL)

      const rdata = this.encodeRData(a.type, a.data)
      rrView.setUint16(8, rdata.length)
      parts.push(rr)
      parts.push(rdata)
    }

    // Concatenate all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Encode a domain name to wire format
   */
  private encodeName(name: string): Uint8Array {
    const labels = name.replace(/\.$/, '').split('.')
    const parts: Uint8Array[] = []

    for (const label of labels) {
      const encoded = new TextEncoder().encode(label)
      parts.push(new Uint8Array([encoded.length]))
      parts.push(encoded)
    }
    parts.push(new Uint8Array([0])) // Null terminator

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Encode RDATA based on record type
   */
  private encodeRData(type: DNSRecordType, data: string): Uint8Array {
    switch (type) {
      case DNSRecordType.A: {
        // IPv4 address
        const parts = data.split('.').map((p) => parseInt(p, 10))
        return new Uint8Array(parts)
      }
      case DNSRecordType.AAAA: {
        // IPv6 address
        const result = new Uint8Array(16)
        const parts = data.split(':')
        for (let i = 0; i < parts.length; i++) {
          const val = parseInt(parts[i], 16)
          result[i * 2] = (val >> 8) & 0xff
          result[i * 2 + 1] = val & 0xff
        }
        return result
      }
      case DNSRecordType.TXT: {
        // TXT record - length-prefixed string
        const encoded = new TextEncoder().encode(data)
        const result = new Uint8Array(encoded.length + 1)
        result[0] = encoded.length
        result.set(encoded, 1)
        return result
      }
      case DNSRecordType.CNAME:
      case DNSRecordType.NS: {
        return this.encodeName(data)
      }
      default: {
        return new TextEncoder().encode(data)
      }
    }
  }

  /**
   * Decode base64url to Uint8Array
   */
  private base64UrlDecode(str: string): Uint8Array {
    // Add padding if needed
    const padding = '='.repeat((4 - (str.length % 4)) % 4)
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  /**
   * Get Elysia app for mounting
   */
  getApp() {
    return this.app
  }

  /**
   * Start standalone server
   */
  async start(): Promise<void> {
    this.app.listen(this.config.port)
    console.log(`[DoH] Server running on port ${this.config.port}`)
  }
}

export function createDoHServer(
  config: Partial<DoHServerConfig> = {},
): DoHServer {
  return new DoHServer(config)
}

/**
 * JNS (Jeju Name Service) Resolver
 *
 * Resolves .jns domains to content hashes via on-chain lookups,
 * then returns appropriate DNS records pointing to edge nodes.
 *
 * Integrates with:
 * - JNSRegistry: Find resolver for a name
 * - JNSResolver: Get contenthash, addr, text records
 * - CDNRegistry: Get available edge nodes
 * - ModerationRegistry: Check if domain is banned
 */

import { LRUCache } from 'lru-cache'
import {
  type Address,
  createPublicClient,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  stringToBytes,
} from 'viem'
import { localhost } from 'viem/chains'
import {
  type DNSConfig,
  DNSRecordType,
  type JNSDomainModeration,
  type JNSResolutionResult,
} from './types'

// Contract ABIs
const JNS_REGISTRY_ABI = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function owner(bytes32 node) view returns (address)',
  'function ttl(bytes32 node) view returns (uint64)',
])

const JNS_RESOLVER_ABI = parseAbi([
  'function contenthash(bytes32 node) view returns (bytes)',
  'function text(bytes32 node, string key) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
])

const MODERATION_REGISTRY_ABI = parseAbi([
  'function isBanned(address subject) view returns (bool)',
  'function getBanReason(address subject) view returns (string)',
])

// CDN Registry ABI - using full JSON format since parseAbi doesn't support tuple[] syntax
const CDN_REGISTRY_ABI = [
  {
    inputs: [{ name: 'region', type: 'uint8' }],
    name: 'getActiveNodes',
    outputs: [
      {
        components: [
          { name: 'nodeId', type: 'bytes32' },
          { name: 'provider', type: 'address' },
          { name: 'endpoint', type: 'string' },
          { name: 'status', type: 'uint8' },
          { name: 'stake', type: 'uint256' },
        ],
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// Content hash protocol prefixes (EIP-1577)
const CONTENT_HASH_PREFIXES = {
  IPFS_CIDV0: '0xe3010170',
  IPFS_CIDV1: '0xe3010172',
  IPNS: '0xe5010172',
  SWARM: '0xe40101fa',
  ARWEAVE: '0x90b2c605', // Custom prefix for Arweave
} as const

interface ResolverCache {
  result: JNSResolutionResult | null
  expiresAt: number
}

interface ModerationCache {
  status: JNSDomainModeration
  expiresAt: number
}

interface EdgeNode {
  nodeId: string
  provider: Address
  endpoint: string
  ipv4?: string
  ipv6?: string
  region: number
  healthy: boolean
}

export class JNSResolver {
  private config: DNSConfig
  private publicClient: PublicClient
  private resolverCache: LRUCache<string, ResolverCache>
  private moderationCache: LRUCache<string, ModerationCache>
  private edgeNodes: EdgeNode[] = []
  private lastEdgeNodeRefresh = 0
  private readonly EDGE_NODE_REFRESH_INTERVAL = 60000 // 1 minute

  constructor(config: DNSConfig) {
    this.config = config

    this.publicClient = createPublicClient({
      chain: localhost, // Will be overridden by transport
      transport: http(config.rpcUrl),
    }) as PublicClient

    this.resolverCache = new LRUCache<string, ResolverCache>({
      max: 10000,
      ttl: config.cacheTTL * 1000,
    })

    this.moderationCache = new LRUCache<string, ModerationCache>({
      max: 5000,
      ttl: 60000, // 1 minute cache for moderation status
    })
  }

  /**
   * Resolve a .jns domain name
   */
  async resolve(name: string): Promise<JNSResolutionResult | null> {
    const normalizedName = this.normalizeName(name)

    // Check cache
    const cached = this.resolverCache.get(normalizedName)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result
    }

    // Check moderation status first
    const moderation = await this.checkModeration(normalizedName)
    if (moderation.isBanned) {
      if (this.config.verbose) {
        console.log(
          `[JNS] Domain banned: ${normalizedName} - ${moderation.reason}`,
        )
      }
      return null
    }

    // Compute namehash
    const node = this.namehash(normalizedName) as `0x${string}`

    // Get resolver address from registry
    const resolverAddress = await this.getResolver(node)
    if (!resolverAddress) {
      this.cacheResult(normalizedName, null)
      return null
    }

    // Get content hash from resolver
    const contentHash = await this.getContentHash(resolverAddress, node)
    if (!contentHash) {
      this.cacheResult(normalizedName, null)
      return null
    }

    // Get TTL from registry (or use default)
    const ttl = await this.getTTL(node)

    // Get best edge node IP
    const edgeNode = await this.getBestEdgeNode()

    const result: JNSResolutionResult = {
      name: normalizedName,
      protocol: contentHash.protocol,
      hash: contentHash.hash,
      edgeNodeIP:
        edgeNode.ipv4 ?? this.config.edgeNodeIPs.ipv4[0] ?? '127.0.0.1',
      edgeNodeIPv6: edgeNode.ipv6 ?? this.config.edgeNodeIPs.ipv6[0],
      ttl,
      resolvedAt: Date.now(),
    }

    this.cacheResult(normalizedName, result)
    return result
  }

  /**
   * Check if a domain is banned via moderation registry
   */
  async checkModeration(name: string): Promise<JNSDomainModeration> {
    const cached = this.moderationCache.get(name)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.status
    }

    // Default: not banned (moderation contract may not be deployed)
    const defaultStatus: JNSDomainModeration = {
      name,
      isBanned: false,
      appealable: true,
    }

    // Skip moderation check if registry not configured
    const moderationAddress = process.env.MODERATION_REGISTRY_ADDRESS as
      | Address
      | undefined
    if (
      !moderationAddress ||
      moderationAddress === '0x0000000000000000000000000000000000000000'
    ) {
      this.moderationCache.set(name, {
        status: defaultStatus,
        expiresAt: Date.now() + 60000,
      })
      return defaultStatus
    }

    // Derive a subject address from the domain name for moderation lookup
    // In production, this would check the domain owner's address
    const subjectHash = keccak256(stringToBytes(name))
    const subjectAddress = `0x${subjectHash.slice(-40)}` as Address

    const isBanned = await this.publicClient
      .readContract({
        address: moderationAddress,
        abi: MODERATION_REGISTRY_ABI,
        functionName: 'isBanned',
        args: [subjectAddress],
      })
      .catch(() => false)

    let reason: string | undefined
    if (isBanned) {
      reason = await this.publicClient
        .readContract({
          address: moderationAddress,
          abi: MODERATION_REGISTRY_ABI,
          functionName: 'getBanReason',
          args: [subjectAddress],
        })
        .catch(() => 'Violation of terms of service')
    }

    const status: JNSDomainModeration = {
      name,
      isBanned,
      bannedAt: isBanned ? Date.now() : undefined,
      reason,
      appealable: true,
    }

    this.moderationCache.set(name, {
      status,
      expiresAt: Date.now() + 60000,
    })

    return status
  }

  /**
   * Get resolver address for a node
   */
  private async getResolver(node: `0x${string}`): Promise<Address | null> {
    const resolverAddress = await this.publicClient
      .readContract({
        address: this.config.jnsRegistryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      })
      .catch(() => null)

    if (
      !resolverAddress ||
      resolverAddress === '0x0000000000000000000000000000000000000000'
    ) {
      // Use default resolver if none set
      if (
        this.config.jnsResolverAddress !==
        '0x0000000000000000000000000000000000000000'
      ) {
        return this.config.jnsResolverAddress
      }
      return null
    }

    return resolverAddress
  }

  /**
   * Get content hash from resolver
   */
  private async getContentHash(
    resolverAddress: Address,
    node: `0x${string}`,
  ): Promise<{ protocol: 'ipfs' | 'ipns' | 'arweave'; hash: string } | null> {
    const contenthashBytes = await this.publicClient
      .readContract({
        address: resolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      })
      .catch(() => null)

    if (!contenthashBytes || contenthashBytes === '0x') {
      return null
    }

    return this.decodeContentHash(contenthashBytes)
  }

  /**
   * Get TTL for a node from registry
   */
  private async getTTL(node: `0x${string}`): Promise<number> {
    const ttl = await this.publicClient
      .readContract({
        address: this.config.jnsRegistryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'ttl',
        args: [node],
      })
      .catch(() => BigInt(this.config.cacheTTL))

    return Number(ttl) || this.config.cacheTTL
  }

  /**
   * Decode content hash bytes to protocol + hash
   */
  private decodeContentHash(
    bytes: `0x${string}`,
  ): { protocol: 'ipfs' | 'ipns' | 'arweave'; hash: string } | null {
    if (!bytes || bytes.length < 10) {
      return null
    }

    const codec = bytes.slice(0, 10).toLowerCase()

    // IPFS CIDv0 or CIDv1
    if (
      codec.startsWith(CONTENT_HASH_PREFIXES.IPFS_CIDV0.toLowerCase()) ||
      codec.startsWith(CONTENT_HASH_PREFIXES.IPFS_CIDV1.toLowerCase())
    ) {
      const data = bytes.slice(10)
      const hash = this.hexToBase58(data)
      return { protocol: 'ipfs', hash }
    }

    // IPNS
    if (codec.startsWith(CONTENT_HASH_PREFIXES.IPNS.toLowerCase())) {
      const data = bytes.slice(10)
      const hash = this.hexToBase58(data)
      return { protocol: 'ipns', hash }
    }

    // Arweave
    if (codec.startsWith(CONTENT_HASH_PREFIXES.ARWEAVE.toLowerCase())) {
      const data = bytes.slice(10)
      // Arweave uses base64url encoding
      const hash = Buffer.from(data.slice(2), 'hex').toString('base64url')
      return { protocol: 'arweave', hash }
    }

    return null
  }

  /**
   * Get best edge node for serving content
   */
  private async getBestEdgeNode(): Promise<EdgeNode> {
    // Refresh edge nodes if stale
    if (
      Date.now() - this.lastEdgeNodeRefresh >
      this.EDGE_NODE_REFRESH_INTERVAL
    ) {
      await this.refreshEdgeNodes()
    }

    // Return first healthy node or default
    const healthyNode = this.edgeNodes.find((n) => n.healthy)
    if (healthyNode) {
      return healthyNode
    }

    // Default fallback
    return {
      nodeId: 'default',
      provider: '0x0000000000000000000000000000000000000000' as Address,
      endpoint: 'localhost',
      ipv4: this.config.edgeNodeIPs.ipv4[0],
      ipv6: this.config.edgeNodeIPs.ipv6[0],
      region: 0,
      healthy: true,
    }
  }

  /**
   * Refresh edge node list from CDN registry
   */
  private async refreshEdgeNodes(): Promise<void> {
    this.lastEdgeNodeRefresh = Date.now()

    const cdnRegistryAddress = process.env.CDN_REGISTRY_ADDRESS as
      | Address
      | undefined
    if (
      !cdnRegistryAddress ||
      cdnRegistryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      // Use configured IPs as fallback
      this.edgeNodes = this.config.edgeNodeIPs.ipv4.map((ip, i) => ({
        nodeId: `static-${i}`,
        provider: '0x0000000000000000000000000000000000000000' as Address,
        endpoint: ip,
        ipv4: ip,
        ipv6: this.config.edgeNodeIPs.ipv6[i],
        region: 0,
        healthy: true,
      }))
      return
    }

    // Query CDN registry for active nodes
    const nodes = await this.publicClient
      .readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getActiveNodes',
        args: [0], // Global region
      })
      .catch(() => [])

    if (Array.isArray(nodes) && nodes.length > 0) {
      this.edgeNodes = nodes.map((node) => {
        // Parse endpoint to extract IP
        const endpoint = String(node.endpoint || '')
        const ipMatch = endpoint.match(/(\d+\.\d+\.\d+\.\d+)/)

        return {
          nodeId: String(node.nodeId),
          provider: node.provider as Address,
          endpoint,
          ipv4: ipMatch?.[1] ?? this.config.edgeNodeIPs.ipv4[0],
          region: Number(node.status || 0),
          healthy: Number(node.status || 0) === 1,
        }
      })
    }
  }

  /**
   * Compute namehash for JNS name (ENS-compatible)
   */
  private namehash(name: string): string {
    let node =
      '0x0000000000000000000000000000000000000000000000000000000000000000'

    if (name) {
      const labels = name.split('.').reverse()
      for (const label of labels) {
        const labelHash = keccak256(stringToBytes(label))
        const combined = Buffer.concat([
          Buffer.from(node.slice(2), 'hex'),
          Buffer.from(labelHash.slice(2), 'hex'),
        ])
        node = keccak256(`0x${combined.toString('hex')}`)
      }
    }

    return node
  }

  /**
   * Normalize a JNS name
   */
  private normalizeName(name: string): string {
    let normalized = name.toLowerCase().trim()

    // Remove trailing dot if present
    if (normalized.endsWith('.')) {
      normalized = normalized.slice(0, -1)
    }

    // Add .jns suffix if not present
    if (!normalized.endsWith(this.config.jnsSuffix)) {
      normalized = `${normalized}${this.config.jnsSuffix}`
    }

    return normalized
  }

  /**
   * Cache a resolution result
   */
  private cacheResult(name: string, result: JNSResolutionResult | null): void {
    this.resolverCache.set(name, {
      result,
      expiresAt: Date.now() + this.config.cacheTTL * 1000,
    })
  }

  /**
   * Convert hex string to base58 (for IPFS CIDs)
   */
  private hexToBase58(hex: string): string {
    const ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    const bytes = Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex')

    let num = BigInt(`0x${bytes.toString('hex')}`)
    let result = ''

    while (num > 0n) {
      const remainder = Number(num % 58n)
      num = num / 58n
      result = ALPHABET[remainder] + result
    }

    // Handle leading zeros
    for (const byte of bytes) {
      if (byte === 0) {
        result = `1${result}`
      } else {
        break
      }
    }

    return result
  }

  /**
   * Create DNS A record for a JNS resolution
   */
  createARecord(result: JNSResolutionResult): {
    name: string
    type: number
    class: number
    ttl: number
    data: string
  } {
    return {
      name: result.name,
      type: DNSRecordType.A,
      class: 1, // IN (Internet)
      ttl: result.ttl,
      data: result.edgeNodeIP,
    }
  }

  /**
   * Create DNS AAAA record for a JNS resolution
   */
  createAAAARecord(result: JNSResolutionResult): {
    name: string
    type: number
    class: number
    ttl: number
    data: string
  } | null {
    if (!result.edgeNodeIPv6) {
      return null
    }

    return {
      name: result.name,
      type: DNSRecordType.AAAA,
      class: 1,
      ttl: result.ttl,
      data: result.edgeNodeIPv6,
    }
  }

  /**
   * Create DNS TXT record with content hash
   */
  createTXTRecord(result: JNSResolutionResult): {
    name: string
    type: number
    class: number
    ttl: number
    data: string
  } {
    return {
      name: result.name,
      type: DNSRecordType.TXT,
      class: 1,
      ttl: result.ttl,
      data: `contenthash=${result.protocol}://${result.hash}`,
    }
  }

  /**
   * Get resolver statistics
   */
  getStats(): { cacheSize: number; edgeNodes: number } {
    return {
      cacheSize: this.resolverCache.size,
      edgeNodes: this.edgeNodes.length,
    }
  }

  /**
   * Clear resolver cache
   */
  clearCache(): void {
    this.resolverCache.clear()
    this.moderationCache.clear()
  }
}

// Factory function
let jnsResolver: JNSResolver | null = null

export function getJNSResolver(config?: DNSConfig): JNSResolver {
  if (!jnsResolver && config) {
    jnsResolver = new JNSResolver(config)
  }
  if (!jnsResolver) {
    throw new Error('JNSResolver not initialized. Call with config first.')
  }
  return jnsResolver
}

export function initializeJNSResolver(config: DNSConfig): JNSResolver {
  jnsResolver = new JNSResolver(config)
  return jnsResolver
}

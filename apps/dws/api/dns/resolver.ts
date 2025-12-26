/**
 * JNS Resolver
 *
 * Comprehensive resolver for Jeju Name Service with multi-path resolution.
 */

import type { Address, Hex } from 'viem'
import { createPublicClient, http, namehash } from 'viem'

export interface JNSRecord {
  name: string
  node: Hex
  owner: Address | null
  resolver: Address | null
  ttl: number
  address: Address | null
  contentHash: string | null
  texts: Record<string, string>
  appRecord: {
    appContract: Address
    appId: Hex
    agentId: bigint
  } | null
  resolvedAt: number
}

interface ResolverConfig {
  rpcUrl: string
  registryAddress: Address
  resolverAddress: Address
  cacheTtl?: number
}

const JNS_REGISTRY_ABI = [
  {
    name: 'owner',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'resolver',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'ttl',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    name: 'recordExists',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    name: 'addr',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'contenthash',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    name: 'text',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'getAppRecord',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [
      { name: 'appContract', type: 'address' },
      { name: 'appId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

const STANDARD_TEXT_KEYS = [
  'url',
  'description',
  'avatar',
  'email',
  'app.endpoint',
  'app.a2a',
  'app.mcp',
]

export class JNSResolver {
  private config: ResolverConfig
  private client
  private cache: Map<string, { record: JNSRecord; expiresAt: number }> =
    new Map()
  private defaultTtl = 300

  constructor(config: ResolverConfig) {
    this.config = config
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    })
    this.defaultTtl = config.cacheTtl ?? 300
  }

  /**
   * Resolve a JNS name to a full record
   */
  async resolve(name: string): Promise<JNSRecord | null> {
    const normalizedName = this.normalizeName(name)
    const node = namehash(normalizedName) as Hex

    // Check cache
    const cached = this.cache.get(normalizedName)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.record
    }

    // Check existence
    const exists = await this.client
      .readContract({
        address: this.config.registryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'recordExists',
        args: [node],
      })
      .catch(() => false)

    if (!exists) return null

    // Get registry data
    const [owner, resolverAddr, ttl] = await Promise.all([
      this.client
        .readContract({
          address: this.config.registryAddress,
          abi: JNS_REGISTRY_ABI,
          functionName: 'owner',
          args: [node],
        })
        .catch(() => null),
      this.client
        .readContract({
          address: this.config.registryAddress,
          abi: JNS_REGISTRY_ABI,
          functionName: 'resolver',
          args: [node],
        })
        .catch(() => null),
      this.client
        .readContract({
          address: this.config.registryAddress,
          abi: JNS_REGISTRY_ABI,
          functionName: 'ttl',
          args: [node],
        })
        .catch(() => BigInt(this.defaultTtl)),
    ])

    const resolver = (resolverAddr || this.config.resolverAddress) as Address

    // Get resolver data
    const [address, contentHashBytes, appRecord] = await Promise.all([
      this.client
        .readContract({
          address: resolver,
          abi: JNS_RESOLVER_ABI,
          functionName: 'addr',
          args: [node],
        })
        .catch(() => null),
      this.client
        .readContract({
          address: resolver,
          abi: JNS_RESOLVER_ABI,
          functionName: 'contenthash',
          args: [node],
        })
        .catch(() => null),
      this.client
        .readContract({
          address: resolver,
          abi: JNS_RESOLVER_ABI,
          functionName: 'getAppRecord',
          args: [node],
        })
        .catch(() => null),
    ])

    // Get text records
    const texts: Record<string, string> = {}
    await Promise.all(
      STANDARD_TEXT_KEYS.map(async (key) => {
        const value = await this.client
          .readContract({
            address: resolver,
            abi: JNS_RESOLVER_ABI,
            functionName: 'text',
            args: [node, key],
          })
          .catch(() => '')
        if (value) texts[key] = value
      }),
    )

    const record: JNSRecord = {
      name: normalizedName,
      node,
      owner:
        owner && owner !== '0x0000000000000000000000000000000000000000'
          ? owner
          : null,
      resolver:
        resolverAddr &&
        resolverAddr !== '0x0000000000000000000000000000000000000000'
          ? resolverAddr
          : null,
      ttl: Number(ttl),
      address:
        address && address !== '0x0000000000000000000000000000000000000000'
          ? address
          : null,
      contentHash: contentHashBytes
        ? this.decodeContentHash(contentHashBytes as Hex)
        : null,
      texts,
      appRecord:
        appRecord &&
        appRecord[0] !== '0x0000000000000000000000000000000000000000'
          ? {
              appContract: appRecord[0],
              appId: appRecord[1],
              agentId: appRecord[2],
            }
          : null,
      resolvedAt: Date.now(),
    }

    // Cache
    this.cache.set(normalizedName, {
      record,
      expiresAt: Date.now() + record.ttl * 1000,
    })

    return record
  }

  /**
   * Quick resolution for address only
   */
  async resolveAddress(name: string): Promise<Address | null> {
    const record = await this.resolve(name)
    return record?.address ?? null
  }

  /**
   * Quick resolution for content hash only
   */
  async resolveContentHash(name: string): Promise<string | null> {
    const record = await this.resolve(name)
    return record?.contentHash ?? null
  }

  /**
   * Get specific text record
   */
  async getText(name: string, key: string): Promise<string | null> {
    const record = await this.resolve(name)
    if (!record) return null

    // Check if already resolved
    if (record.texts[key] !== undefined) {
      return record.texts[key]
    }

    // Query directly for non-standard keys
    const node = namehash(this.normalizeName(name))
    const resolver = record.resolver ?? this.config.resolverAddress

    return this.client
      .readContract({
        address: resolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, key],
      })
      .catch(() => null)
  }

  /**
   * Check if a name is available
   */
  async isAvailable(name: string): Promise<boolean> {
    const node = namehash(this.normalizeName(name))
    const exists = await this.client
      .readContract({
        address: this.config.registryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'recordExists',
        args: [node],
      })
      .catch(() => false)
    return !exists
  }

  private normalizeName(name: string): string {
    let normalized = name.replace(/\.$/, '').toLowerCase()
    if (!normalized.endsWith('.jeju') && !normalized.includes('.')) {
      normalized = `${normalized}.jeju`
    }
    return normalized
  }

  private decodeContentHash(bytes: Hex): string | null {
    if (!bytes || bytes === '0x' || bytes.length < 6) return null

    if (bytes.startsWith('0xe3010170') || bytes.startsWith('0xe5010172')) {
      return `ipfs://${bytes.slice(10)}`
    }
    if (bytes.startsWith('0xe4010170')) {
      return `bzz://${bytes.slice(10)}`
    }
    if (bytes.startsWith('0x1220')) {
      return `ipfs://${bytes.slice(2)}`
    }
    return null
  }

  clearCache(): void {
    this.cache.clear()
  }
}

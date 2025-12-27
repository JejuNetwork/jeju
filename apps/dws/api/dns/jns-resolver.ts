/**
 * JNS (Jeju Name Service) Resolver
 *
 * On-chain resolution for .jeju domains:
 * - Resolves names to content hashes (IPFS, Arweave)
 * - Resolves names to worker endpoints
 * - Resolves names to addresses
 * - Supports wildcard subdomains
 */

import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  stringToBytes,
} from 'viem'
import type { JNSResolution } from './types'

export interface JNSResolverConfig {
  rpcUrl: string
  registryAddress: Address
  resolverAddress?: Address
  chainId?: number
  cacheTTL?: number
}

// JNS Registry ABI
const JNS_REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'owner',
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
] as const

// JNS Resolver ABI
const JNS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    name: 'addr',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
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
    name: 'name',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const

interface CacheEntry {
  resolution: JNSResolution
  expiresAt: number
}

export class JNSResolver {
  private config: JNSResolverConfig
  private client: PublicClient
  private cache = new Map<string, CacheEntry>()
  private defaultTTL = 300

  constructor(config: JNSResolverConfig) {
    this.config = config
    this.defaultTTL = config.cacheTTL ?? 300
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    })
  }

  /**
   * Resolve a JNS name
   */
  async resolve(name: string): Promise<JNSResolution | null> {
    // Normalize name
    const normalizedName = `${name.toLowerCase().replace(/\.jeju$/, '')}.jeju`

    // Check cache
    const cached = this.cache.get(normalizedName)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.resolution
    }

    const node = this.namehash(normalizedName)

    // Get resolver address from registry
    let resolverAddress: Address
    try {
      resolverAddress = await this.client.readContract({
        address: this.config.registryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      })
    } catch {
      return null
    }

    if (
      !resolverAddress ||
      resolverAddress === '0x0000000000000000000000000000000000000000'
    ) {
      // Try wildcard resolution
      return this.resolveWildcard(normalizedName)
    }

    // Get owner
    const owner = await this.client.readContract({
      address: this.config.registryAddress,
      abi: JNS_REGISTRY_ABI,
      functionName: 'owner',
      args: [node],
    })

    // Get TTL
    let ttl: bigint
    try {
      ttl = await this.client.readContract({
        address: this.config.registryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'ttl',
        args: [node],
      })
    } catch {
      ttl = BigInt(this.defaultTTL)
    }

    // Resolve all records
    const resolution = await this.resolveAllRecords(
      normalizedName,
      node,
      owner,
      resolverAddress,
      Number(ttl),
    )

    // Cache the resolution
    this.cache.set(normalizedName, {
      resolution,
      expiresAt: Date.now() + Number(ttl) * 1000,
    })

    return resolution
  }

  /**
   * Resolve all records from a resolver
   */
  private async resolveAllRecords(
    name: string,
    node: Hex,
    owner: Address,
    resolver: Address,
    ttl: number,
  ): Promise<JNSResolution> {
    const resolution: JNSResolution = {
      name,
      node,
      owner,
      resolver,
      records: {
        addresses: {},
        text: {},
      },
      ttl,
      resolvedAt: Date.now(),
    }

    // Get contenthash
    try {
      const contenthash = await this.client.readContract({
        address: resolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      })
      if (contenthash && contenthash !== '0x') {
        resolution.records.contenthash = contenthash as Hex
        const decoded = this.decodeContenthash(contenthash as Hex)
        if (decoded) {
          if (decoded.protocol === 'ipfs') {
            resolution.records.ipfsHash = decoded.hash
          } else if (decoded.protocol === 'arweave') {
            resolution.records.arweaveHash = decoded.hash
          }
        }
      }
    } catch {
      // No contenthash
    }

    // Get ETH address
    try {
      const addr = await this.client.readContract({
        address: resolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'addr',
        args: [node],
      })
      if (addr && addr !== '0x0000000000000000000000000000000000000000') {
        resolution.records.addresses.eth = addr
      }
    } catch {
      // No address
    }

    // Get common text records
    const textKeys = [
      'dws.worker',
      'dws.endpoint',
      'url',
      'email',
      'description',
      'avatar',
      'com.github',
      'com.twitter',
    ]

    for (const key of textKeys) {
      try {
        const value = await this.client.readContract({
          address: resolver,
          abi: JNS_RESOLVER_ABI,
          functionName: 'text',
          args: [node, key],
        })
        if (value && value !== '') {
          resolution.records.text[key] = value
          if (key === 'dws.worker' || key === 'dws.endpoint') {
            resolution.records.workerEndpoint = value
          }
        }
      } catch {
        // No text record for this key
      }
    }

    return resolution
  }

  /**
   * Attempt wildcard resolution for subdomains
   */
  private async resolveWildcard(name: string): Promise<JNSResolution | null> {
    const parts = name.split('.')

    // Try progressively shorter wildcards
    // e.g., for "sub.app.jeju", try "*.app.jeju" then "*.jeju"
    for (let i = 1; i < parts.length; i++) {
      const wildcardName = `*.${parts.slice(i).join('.')}`
      const node = this.namehash(wildcardName)

      let resolverAddress: Address
      try {
        resolverAddress = await this.client.readContract({
          address: this.config.registryAddress,
          abi: JNS_REGISTRY_ABI,
          functionName: 'resolver',
          args: [node],
        })
      } catch {
        continue
      }

      if (
        resolverAddress &&
        resolverAddress !== '0x0000000000000000000000000000000000000000'
      ) {
        const owner = await this.client.readContract({
          address: this.config.registryAddress,
          abi: JNS_REGISTRY_ABI,
          functionName: 'owner',
          args: [node],
        })

        const resolution = await this.resolveAllRecords(
          name, // Return original name, not wildcard
          node,
          owner,
          resolverAddress,
          this.defaultTTL,
        )

        return resolution
      }
    }

    return null
  }

  /**
   * Calculate namehash for a domain
   */
  private namehash(name: string): Hex {
    const labels = name.toLowerCase().replace(/\.$/, '').split('.').reverse()
    let node: Hex = `0x${'0'.repeat(64)}` as Hex

    for (const label of labels) {
      const labelHash = keccak256(stringToBytes(label))
      node = keccak256(`${node}${labelHash.slice(2)}` as Hex) as Hex
    }

    return node
  }

  /**
   * Decode contenthash to protocol and hash
   */
  private decodeContenthash(
    hash: Hex,
  ): { protocol: string; hash: string } | null {
    // EIP-1577 contenthash encoding
    // e3 = IPFS namespace
    // e5 = Swarm namespace
    // e2 = Skynet namespace (rare)

    if (hash.startsWith('0xe3')) {
      // IPFS
      const ipfsData = hash.slice(4)

      // Check for CIDv1 prefix (01 70 = dag-pb, 01 55 = raw)
      if (ipfsData.startsWith('0170') || ipfsData.startsWith('0155')) {
        const cidBytes = this.hexToBytes(ipfsData)
        return {
          protocol: 'ipfs',
          hash: this.bytesToBase58(cidBytes),
        }
      }

      // CIDv0 (just the multihash)
      const multihash = this.hexToBytes(ipfsData)
      return {
        protocol: 'ipfs',
        hash: this.bytesToBase58(multihash),
      }
    }

    if (hash.startsWith('0xe5')) {
      // Arweave (using Swarm namespace for now)
      return {
        protocol: 'arweave',
        hash: hash.slice(4),
      }
    }

    return null
  }

  /**
   * Convert hex string to bytes
   */
  private hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(cleanHex.length / 2)
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16)
    }
    return bytes
  }

  /**
   * Convert bytes to Base58 (for IPFS CIDs)
   */
  private bytesToBase58(bytes: Uint8Array): string {
    const ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    let leadingZeros = 0
    for (const byte of bytes) {
      if (byte === 0) leadingZeros++
      else break
    }

    const digits: number[] = [0]
    for (const byte of bytes) {
      let carry = byte
      for (let i = 0; i < digits.length; i++) {
        const n = digits[i] * 256 + carry
        digits[i] = n % 58
        carry = Math.floor(n / 58)
      }
      while (carry > 0) {
        digits.push(carry % 58)
        carry = Math.floor(carry / 58)
      }
    }

    let result = ''
    for (let i = 0; i < leadingZeros; i++) {
      result += '1'
    }
    for (let i = digits.length - 1; i >= 0; i--) {
      result += ALPHABET[digits[i]]
    }

    return result
  }

  /**
   * Reverse resolve: find name for an address
   */
  async reverseResolve(address: Address): Promise<string | null> {
    // Construct reverse node: addr.reverse
    const reverseNode = keccak256(
      stringToBytes(`${address.slice(2).toLowerCase()}.addr.reverse`),
    )

    try {
      const resolverAddress = await this.client.readContract({
        address: this.config.registryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [reverseNode],
      })

      if (
        !resolverAddress ||
        resolverAddress === '0x0000000000000000000000000000000000000000'
      ) {
        return null
      }

      const name = await this.client.readContract({
        address: resolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'name',
        args: [reverseNode],
      })

      return name || null
    } catch {
      return null
    }
  }

  /**
   * Get text record
   */
  async getText(name: string, key: string): Promise<string | null> {
    const resolution = await this.resolve(name)
    if (!resolution) return null
    return resolution.records.text[key] ?? null
  }

  /**
   * Get contenthash
   */
  async getContenthash(
    name: string,
  ): Promise<{ protocol: string; hash: string } | null> {
    const resolution = await this.resolve(name)
    if (!resolution?.records.contenthash) return null
    return this.decodeContenthash(resolution.records.contenthash)
  }

  /**
   * Get worker endpoint
   */
  async getWorkerEndpoint(name: string): Promise<string | null> {
    const resolution = await this.resolve(name)
    return resolution?.records.workerEndpoint ?? null
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}

export function createJNSResolver(config: JNSResolverConfig): JNSResolver {
  return new JNSResolver(config)
}

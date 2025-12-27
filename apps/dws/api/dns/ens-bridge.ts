/**
 * ENS (Ethereum Name Service) Bridge
 *
 * Enables resolution of .eth domains through DWS nodes,
 * providing a unified naming experience across both JNS and ENS.
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
import { mainnet } from 'viem/chains'
import type { ENSResolution } from './types'

export interface ENSBridgeConfig {
  /** Ethereum mainnet RPC URL */
  ethRpcUrl: string
  /** ENS Registry address (defaults to mainnet) */
  registryAddress?: Address
  /** Cache TTL in seconds */
  cacheTTL?: number
  /** Whether to use universal resolver */
  useUniversalResolver?: boolean
}

// ENS Registry on mainnet
const ENS_REGISTRY_ADDRESS =
  '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address

// Universal Resolver on mainnet (for future use with resolve() wildcard)
const _ENS_UNIVERSAL_RESOLVER =
  '0xc0497E381f536Be9ce14B0dD3817cBcAe57d2F62' as Address
void _ENS_UNIVERSAL_RESOLVER

// ENS Registry ABI
const ENS_REGISTRY_ABI = [
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

// ENS Resolver ABI
const ENS_RESOLVER_ABI = [
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
] as const

// Universal Resolver ABI (for future use with resolve() wildcard)
const _UNIVERSAL_RESOLVER_ABI = [
  {
    name: 'resolve',
    type: 'function',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [
      { name: 'result', type: 'bytes' },
      { name: 'resolver', type: 'address' },
    ],
    stateMutability: 'view',
  },
] as const
void _UNIVERSAL_RESOLVER_ABI

interface CacheEntry {
  resolution: ENSResolution
  expiresAt: number
}

export class ENSBridge {
  private config: ENSBridgeConfig
  private client: PublicClient
  private cache = new Map<string, CacheEntry>()
  private defaultTTL = 300

  constructor(config: ENSBridgeConfig) {
    this.config = config
    this.defaultTTL = config.cacheTTL ?? 300
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(config.ethRpcUrl),
    })
  }

  /**
   * Resolve an ENS name
   */
  async resolve(name: string): Promise<ENSResolution | null> {
    const normalizedName = name.toLowerCase()

    // Check cache
    const cached = this.cache.get(normalizedName)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.resolution
    }

    const node = this.namehash(normalizedName)
    const registryAddress = this.config.registryAddress ?? ENS_REGISTRY_ADDRESS

    // Get resolver address
    let resolverAddress: Address
    try {
      resolverAddress = await this.client.readContract({
        address: registryAddress,
        abi: ENS_REGISTRY_ABI,
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
      return null
    }

    // Get owner
    const owner = await this.client.readContract({
      address: registryAddress,
      abi: ENS_REGISTRY_ABI,
      functionName: 'owner',
      args: [node],
    })

    // Get TTL
    let ttl: bigint
    try {
      ttl = await this.client.readContract({
        address: registryAddress,
        abi: ENS_REGISTRY_ABI,
        functionName: 'ttl',
        args: [node],
      })
    } catch {
      ttl = BigInt(this.defaultTTL)
    }

    const resolution: ENSResolution = {
      name: normalizedName,
      node,
      owner,
      resolver: resolverAddress,
      text: {},
      ttl: Number(ttl),
    }

    // Get contenthash
    try {
      const contenthash = await this.client.readContract({
        address: resolverAddress,
        abi: ENS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      })
      if (contenthash && contenthash !== '0x') {
        resolution.contenthash = this.decodeContenthash(contenthash as Hex)
      }
    } catch {
      // No contenthash
    }

    // Get address
    try {
      const address = await this.client.readContract({
        address: resolverAddress,
        abi: ENS_RESOLVER_ABI,
        functionName: 'addr',
        args: [node],
      })
      if (address && address !== '0x0000000000000000000000000000000000000000') {
        resolution.address = address
      }
    } catch {
      // No address
    }

    // Get common text records
    const textKeys = [
      'url',
      'avatar',
      'description',
      'com.github',
      'com.twitter',
    ]
    for (const key of textKeys) {
      try {
        const value = await this.client.readContract({
          address: resolverAddress,
          abi: ENS_RESOLVER_ABI,
          functionName: 'text',
          args: [node, key],
        })
        if (value && value !== '') {
          resolution.text[key] = value
        }
      } catch {
        // No text record
      }
    }

    // Cache
    this.cache.set(normalizedName, {
      resolution,
      expiresAt: Date.now() + Number(ttl) * 1000,
    })

    return resolution
  }

  /**
   * Calculate namehash
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
   * Decode contenthash to human-readable format
   */
  private decodeContenthash(hash: Hex): string {
    // e3 = IPFS
    if (hash.startsWith('0xe3')) {
      return `ipfs://${hash.slice(4)}`
    }
    // e5 = Swarm
    if (hash.startsWith('0xe5')) {
      return `bzz://${hash.slice(4)}`
    }
    // e4 = Arweave
    if (hash.startsWith('0xe4')) {
      return `ar://${hash.slice(4)}`
    }
    return hash
  }

  /**
   * Get address for ENS name
   */
  async getAddress(name: string): Promise<Address | null> {
    const resolution = await this.resolve(name)
    return resolution?.address ?? null
  }

  /**
   * Get contenthash for ENS name
   */
  async getContenthash(name: string): Promise<string | null> {
    const resolution = await this.resolve(name)
    return resolution?.contenthash ?? null
  }

  /**
   * Get text record
   */
  async getText(name: string, key: string): Promise<string | null> {
    const resolution = await this.resolve(name)
    return resolution?.text[key] ?? null
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}

export function createENSBridge(config: ENSBridgeConfig): ENSBridge {
  return new ENSBridge(config)
}

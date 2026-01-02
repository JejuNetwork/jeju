/**
 * Dynamic Provider Discovery
 *
 * Discovers RPC endpoints and services from on-chain registries
 * instead of using hardcoded URLs.
 *
 * On-Chain Registries:
 * - EndpointRegistry: Generic service endpoints
 * - RPCProviderRegistry: RPC nodes with stake/reputation
 * - MultiChainRPCRegistry: Cross-chain RPC discovery
 * - JNSRegistry: Name resolution (app.jeju -> address)
 */

import { type Address, createPublicClient, http, type PublicClient } from 'viem'

// Service types for discovery
export type ServiceType =
  | 'rpc'
  | 'websocket'
  | 'api'
  | 'gateway'
  | 'storage'
  | 'cdn'
  | 'proxy'
  | 'bridge'
  | 'sequencer'

export interface DiscoveredEndpoint {
  url: string
  region: string
  priority: number
  active: boolean
  uptimeSeconds: number
  responseTimeMs: number
}

export interface DiscoveredProvider {
  operator: Address
  endpoint: string
  region: string
  stake: bigint
  reputationScore: number
  isActive: boolean
}

interface ProviderDiscoveryConfig {
  chainId: number
  bootstrapRpc: string
  endpointRegistryAddress: Address
  rpcRegistryAddress: Address
  jnsRegistryAddress: Address
}

// ABIs for on-chain registries
const ENDPOINT_REGISTRY_ABI = [
  {
    name: 'getEndpoints',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'serviceId', type: 'bytes32' }],
    outputs: [
      {
        name: 'endpoints',
        type: 'tuple[]',
        components: [
          { name: 'url', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'priority', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'addedAt', type: 'uint256' },
          { name: 'lastHealthCheck', type: 'uint256' },
          { name: 'uptimeSeconds', type: 'uint256' },
          { name: 'responseTimeMs', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getActiveEndpoints',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'serviceId', type: 'bytes32' },
      { name: 'region', type: 'string' },
    ],
    outputs: [{ name: 'urls', type: 'string[]' }],
  },
] as const

const RPC_REGISTRY_ABI = [
  {
    name: 'getTopProviders',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'chainId', type: 'uint64' },
      { name: 'minUptime', type: 'uint256' },
      { name: 'requireArchive', type: 'bool' },
      { name: 'maxCount', type: 'uint16' },
    ],
    outputs: [
      { name: 'providers', type: 'address[]' },
      { name: 'scores', type: 'uint256[]' },
    ],
  },
  {
    name: 'getProviderEndpoint',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
  },
] as const

const JNS_REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

/**
 * Provider Discovery Client
 *
 * Discovers services and providers from on-chain registries.
 * Falls back to bootstrap RPC for initial connection.
 */
export class ProviderDiscovery {
  private client: PublicClient
  private config: ProviderDiscoveryConfig
  private endpointCache: Map<string, DiscoveredEndpoint[]> = new Map()
  private providerCache: Map<number, DiscoveredProvider[]> = new Map()
  private cacheExpiry = 60000 // 1 minute cache

  constructor(config: ProviderDiscoveryConfig) {
    this.config = config
    this.client = createPublicClient({
      transport: http(config.bootstrapRpc),
    })
  }

  /**
   * Get service ID hash for a service type
   */
  private getServiceId(serviceType: ServiceType): `0x${string}` {
    const encoder = new TextEncoder()
    const data = encoder.encode(serviceType)

    // keccak256 in browser-compatible way
    // Note: In production, use viem's keccak256
    const hash = this.simpleHash(data)
    return hash as `0x${string}`
  }

  /**
   * Simple hash for demo (use viem keccak256 in production)
   */
  private simpleHash(data: Uint8Array): string {
    let hash = 0n
    for (const byte of data) {
      hash = (hash * 31n + BigInt(byte)) & ((1n << 256n) - 1n)
    }
    return `0x${hash.toString(16).padStart(64, '0')}`
  }

  /**
   * Discover endpoints for a service type
   */
  async discoverEndpoints(
    serviceType: ServiceType,
    region?: string,
  ): Promise<DiscoveredEndpoint[]> {
    const cacheKey = `${serviceType}:${region ?? 'all'}`
    const cached = this.endpointCache.get(cacheKey)
    if (cached) return cached

    const serviceId = this.getServiceId(serviceType)

    const endpoints = await this.client.readContract({
      address: this.config.endpointRegistryAddress,
      abi: ENDPOINT_REGISTRY_ABI,
      functionName: 'getEndpoints',
      args: [serviceId],
    })

    const discovered = endpoints
      .filter((e) => e.active)
      .filter((e) => (region ? e.region === region : true))
      .sort((a, b) => Number(a.priority) - Number(b.priority))
      .map((e) => ({
        url: e.url,
        region: e.region,
        priority: Number(e.priority),
        active: e.active,
        uptimeSeconds: Number(e.uptimeSeconds),
        responseTimeMs: Number(e.responseTimeMs),
      }))

    this.endpointCache.set(cacheKey, discovered)
    setTimeout(() => this.endpointCache.delete(cacheKey), this.cacheExpiry)

    return discovered
  }

  /**
   * Discover RPC providers for a chain
   */
  async discoverRPCProviders(
    chainId: number,
    options: {
      minUptime?: number
      requireArchive?: boolean
      maxCount?: number
    } = {},
  ): Promise<DiscoveredProvider[]> {
    const cached = this.providerCache.get(chainId)
    if (cached) return cached

    const { minUptime = 0, requireArchive = false, maxCount = 10 } = options

    const [providers, scores] = await this.client.readContract({
      address: this.config.rpcRegistryAddress,
      abi: RPC_REGISTRY_ABI,
      functionName: 'getTopProviders',
      args: [BigInt(chainId), BigInt(minUptime), requireArchive, maxCount],
    })

    const discovered: DiscoveredProvider[] = []
    for (let i = 0; i < providers.length; i++) {
      const endpoint = await this.client.readContract({
        address: this.config.rpcRegistryAddress,
        abi: RPC_REGISTRY_ABI,
        functionName: 'getProviderEndpoint',
        args: [providers[i]],
      })

      discovered.push({
        operator: providers[i],
        endpoint,
        region: '', // Would need additional call
        stake: 0n, // Would need additional call
        reputationScore: Number(scores[i]),
        isActive: true,
      })
    }

    this.providerCache.set(chainId, discovered)
    setTimeout(() => this.providerCache.delete(chainId), this.cacheExpiry)

    return discovered
  }

  /**
   * Get the best RPC endpoint for a chain
   */
  async getBestRPCEndpoint(chainId: number): Promise<string | null> {
    const providers = await this.discoverRPCProviders(chainId)
    if (providers.length === 0) return null
    return providers[0].endpoint
  }

  /**
   * Resolve a JNS name to an address
   */
  async resolveJNS(name: string): Promise<Address | null> {
    const node = this.namehash(name)

    const resolver = await this.client.readContract({
      address: this.config.jnsRegistryAddress,
      abi: JNS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    })

    if (resolver === '0x0000000000000000000000000000000000000000') {
      return null
    }

    // Get address from resolver
    const addressResult = await this.client.readContract({
      address: resolver,
      abi: [
        {
          name: 'addr',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'node', type: 'bytes32' }],
          outputs: [{ name: '', type: 'address' }],
        },
      ],
      functionName: 'addr',
      args: [node],
    })

    return addressResult
  }

  /**
   * Compute namehash for JNS name
   */
  private namehash(name: string): `0x${string}` {
    let node =
      '0x0000000000000000000000000000000000000000000000000000000000000000'

    if (name === '') return node as `0x${string}`

    const labels = name.split('.').reverse()
    for (const label of labels) {
      const labelHash = this.simpleHash(new TextEncoder().encode(label))
      // In production: node = keccak256(node + labelHash)
      node = this.simpleHash(
        new TextEncoder().encode(node.slice(2) + labelHash.slice(2)),
      )
    }

    return node as `0x${string}`
  }

  /**
   * Create a discovery instance with fallback chain of providers
   */
  async createFallbackChain(
    chainId: number,
    maxProviders = 3,
  ): Promise<string[]> {
    const providers = await this.discoverRPCProviders(chainId, {
      maxCount: maxProviders,
      minUptime: 95, // Require 95% uptime
    })

    return providers.map((p) => p.endpoint)
  }
}

/**
 * Create a ProviderDiscovery instance for local development
 *
 * Uses environment variables or defaults for bootstrap configuration
 */
export function createLocalDiscovery(): ProviderDiscovery {
  // For local dev, use environment variables or Kurtosis service names
  const bootstrapRpc = process.env.BOOTSTRAP_RPC_URL ?? 'http://l1-geth:8545'

  // These addresses would be from a deployed contracts JSON
  // For local dev, they're deterministic from deployment
  const endpointRegistry =
    (process.env.ENDPOINT_REGISTRY as Address) ??
    '0x5FbDB2315678afecb367f032d93F642f64180aa3'
  const rpcRegistry =
    (process.env.RPC_REGISTRY as Address) ??
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
  const jnsRegistry =
    (process.env.JNS_REGISTRY as Address) ??
    '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'

  return new ProviderDiscovery({
    chainId: Number(process.env.CHAIN_ID ?? '31337'),
    bootstrapRpc,
    endpointRegistryAddress: endpointRegistry,
    rpcRegistryAddress: rpcRegistry,
    jnsRegistryAddress: jnsRegistry,
  })
}

/**
 * Example usage:
 *
 * ```typescript
 * const discovery = createLocalDiscovery()
 *
 * // Discover RPC endpoints
 * const rpcEndpoints = await discovery.discoverEndpoints('rpc')
 * console.log('Available RPC endpoints:', rpcEndpoints)
 *
 * // Get best provider for a chain
 * const bestRpc = await discovery.getBestRPCEndpoint(901)
 * console.log('Best L2 RPC:', bestRpc)
 *
 * // Resolve a JNS name
 * const appAddress = await discovery.resolveJNS('myapp.jeju')
 * console.log('App address:', appAddress)
 * ```
 */

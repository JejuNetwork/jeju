/**
 * CDN Module - Content Delivery Network
 *
 * Provides access to:
 * - CDN provider registration
 * - Edge node management
 * - Site configuration
 * - Cache invalidation
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseEther } from 'viem'
import { requireContract } from '../config'
import { parseIdFromLogs } from '../shared/api'
import type { BaseWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const CDNProviderType = {
  FULL: 0,
  EDGE_ONLY: 1,
  ORIGIN_ONLY: 2,
} as const
export type CDNProviderType =
  (typeof CDNProviderType)[keyof typeof CDNProviderType]

export const CDNRegion = {
  GLOBAL: 0,
  NORTH_AMERICA: 1,
  EUROPE: 2,
  ASIA_PACIFIC: 3,
  SOUTH_AMERICA: 4,
  AFRICA: 5,
  MIDDLE_EAST: 6,
} as const
export type CDNRegion = (typeof CDNRegion)[keyof typeof CDNRegion]

export interface CDNProvider {
  providerAddress: Address
  name: string
  endpoint: string
  providerType: CDNProviderType
  stake: bigint
  agentId: bigint
  isActive: boolean
  registeredAt: bigint
}

export interface EdgeNode {
  nodeId: Hex
  operator: Address
  endpoint: string
  region: CDNRegion
  stakedAmount: bigint
  registeredAt: bigint
  lastHeartbeat: bigint
  isActive: boolean
  requestsServed: bigint
  bandwidthServed: bigint
}

export interface Site {
  siteId: Hex
  owner: Address
  origin: string
  domains: string[]
  isActive: boolean
  createdAt: bigint
  cacheTTL: bigint
  enableCompression: boolean
}

export interface RegisterProviderParams {
  name: string
  endpoint: string
  providerType: CDNProviderType
  stake: bigint
}

export interface RegisterNodeParams {
  endpoint: string
  region: CDNRegion
  stake: bigint
}

export interface CreateSiteParams {
  origin: string
  domains: string[]
  cacheTTL?: bigint
  enableCompression?: boolean
}

export interface CDNModule {
  // Provider Management
  registerProvider(params: RegisterProviderParams): Promise<Hex>
  getProvider(address: Address): Promise<CDNProvider | null>
  listProviders(): Promise<CDNProvider[]>
  updateProviderEndpoint(endpoint: string): Promise<Hex>
  deactivateProvider(): Promise<Hex>

  // Edge Node Management
  registerNode(
    params: RegisterNodeParams,
  ): Promise<{ nodeId: Hex; txHash: Hex }>
  getNode(nodeId: Hex): Promise<EdgeNode | null>
  listNodes(): Promise<EdgeNode[]>
  listNodesByRegion(region: CDNRegion): Promise<EdgeNode[]>
  updateNodeEndpoint(nodeId: Hex, endpoint: string): Promise<Hex>
  heartbeat(nodeId: Hex): Promise<Hex>
  deactivateNode(nodeId: Hex): Promise<Hex>

  // Site Management
  createSite(params: CreateSiteParams): Promise<{ siteId: Hex; txHash: Hex }>
  getSite(siteId: Hex): Promise<Site | null>
  listMySites(): Promise<Site[]>
  updateSite(siteId: Hex, updates: Partial<CreateSiteParams>): Promise<Hex>
  deleteSite(siteId: Hex): Promise<Hex>

  // Cache Operations
  invalidateCache(siteId: Hex, paths: string[]): Promise<Hex>
  purgeAllCache(siteId: Hex): Promise<Hex>

  // Metrics
  getNodeMetrics(
    nodeId: Hex,
  ): Promise<{ requestsServed: bigint; bandwidthServed: bigint }>
  getSiteMetrics(
    siteId: Hex,
  ): Promise<{ requests: bigint; bandwidth: bigint; cacheHitRate: number }>

  // Constants
  readonly MIN_NODE_STAKE: bigint
  readonly MIN_PROVIDER_STAKE: bigint
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const CDN_REGISTRY_ABI = [
  // Provider functions
  {
    name: 'registerProvider',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'providerType', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    name: 'getProvider',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'providerAddress', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'providerType', type: 'uint8' },
          { name: 'stake', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getProviderCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getProviderAtIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'updateProviderEndpoint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'endpoint', type: 'string' }],
    outputs: [],
  },
  {
    name: 'deactivateProvider',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  // Node functions
  {
    name: 'registerEdgeNode',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'uint8' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getNode',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'bytes32' },
          { name: 'operator', type: 'address' },
          { name: 'endpoint', type: 'string' },
          { name: 'region', type: 'uint8' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastHeartbeat', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'requestsServed', type: 'uint256' },
          { name: 'bandwidthServed', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getNodeCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getNodeAtIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getNodesByRegion',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'region', type: 'uint8' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'updateNodeEndpoint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'endpoint', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'deactivateNode',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'heartbeat',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
  },
  // Site functions
  {
    name: 'createSite',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'origin', type: 'string' },
      { name: 'domains', type: 'string[]' },
      { name: 'cacheTTL', type: 'uint256' },
      { name: 'enableCompression', type: 'bool' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getSite',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'siteId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'siteId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'origin', type: 'string' },
          { name: 'domains', type: 'string[]' },
          { name: 'isActive', type: 'bool' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'cacheTTL', type: 'uint256' },
          { name: 'enableCompression', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getSitesByOwner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'updateSite',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'siteId', type: 'bytes32' },
      { name: 'origin', type: 'string' },
      { name: 'domains', type: 'string[]' },
      { name: 'cacheTTL', type: 'uint256' },
      { name: 'enableCompression', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'deleteSite',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'siteId', type: 'bytes32' }],
    outputs: [],
  },
  // Cache functions
  {
    name: 'invalidateCache',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'siteId', type: 'bytes32' },
      { name: 'paths', type: 'string[]' },
    ],
    outputs: [],
  },
  {
    name: 'purgeAllCache',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'siteId', type: 'bytes32' }],
    outputs: [],
  },
  // Metrics functions
  {
    name: 'getNodeMetrics',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      { name: 'requestsServed', type: 'uint256' },
      { name: 'bandwidthServed', type: 'uint256' },
    ],
  },
  {
    name: 'getSiteMetrics',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'siteId', type: 'bytes32' }],
    outputs: [
      { name: 'requests', type: 'uint256' },
      { name: 'bandwidth', type: 'uint256' },
      { name: 'cacheHits', type: 'uint256' },
      { name: 'cacheMisses', type: 'uint256' },
    ],
  },
  // Constants
  {
    name: 'minNodeStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createCDNModule(
  wallet: BaseWallet,
  network: NetworkType,
): CDNModule {
  const cdnRegistryAddress = requireContract('cdn', 'CDNRegistry', network)

  const MIN_NODE_STAKE = parseEther('0.001')
  const MIN_PROVIDER_STAKE = parseEther('0.1')

  return {
    MIN_NODE_STAKE,
    MIN_PROVIDER_STAKE,

    async registerProvider(params) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'registerProvider',
        args: [params.name, params.endpoint, params.providerType],
      })
      return wallet.sendTransaction({
        to: cdnRegistryAddress,
        data,
        value: params.stake,
      })
    },

    async getProvider(address) {
      const result = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getProvider',
        args: [address],
      })

      if (
        result.providerAddress === '0x0000000000000000000000000000000000000000'
      ) {
        return null
      }

      return result as CDNProvider
    },

    async listProviders() {
      const count = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getProviderCount',
        args: [],
      })

      const providers: CDNProvider[] = []
      for (let i = 0n; i < count; i++) {
        const providerAddr = await wallet.publicClient.readContract({
          address: cdnRegistryAddress,
          abi: CDN_REGISTRY_ABI,
          functionName: 'getProviderAtIndex',
          args: [i],
        })

        const provider = await this.getProvider(providerAddr)
        if (provider) {
          providers.push(provider)
        }
      }

      return providers
    },

    async updateProviderEndpoint(endpoint) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'updateProviderEndpoint',
        args: [endpoint],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async deactivateProvider() {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'deactivateProvider',
        args: [],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async registerNode(params) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'registerEdgeNode',
        args: [params.endpoint, params.region],
      })

      const txHash = await wallet.sendTransaction({
        to: cdnRegistryAddress,
        data,
        value: params.stake,
      })

      // Parse nodeId from EdgeNodeRegistered event
      const nodeId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'EdgeNodeRegistered(bytes32,address,string,uint8)',
        'nodeId',
      )

      return { nodeId, txHash }
    },

    async getNode(nodeId) {
      const result = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getNode',
        args: [nodeId],
      })

      if (result.operator === '0x0000000000000000000000000000000000000000') {
        return null
      }

      return result as EdgeNode
    },

    async listNodes() {
      const count = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getNodeCount',
        args: [],
      })

      const nodes: EdgeNode[] = []
      for (let i = 0n; i < count; i++) {
        const nodeId = await wallet.publicClient.readContract({
          address: cdnRegistryAddress,
          abi: CDN_REGISTRY_ABI,
          functionName: 'getNodeAtIndex',
          args: [i],
        })

        const node = await this.getNode(nodeId)
        if (node) {
          nodes.push(node)
        }
      }

      return nodes
    },

    async listNodesByRegion(region) {
      const nodeIds = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getNodesByRegion',
        args: [region],
      })

      const nodes: EdgeNode[] = []
      for (const nodeId of nodeIds) {
        const node = await this.getNode(nodeId)
        if (node) {
          nodes.push(node)
        }
      }

      return nodes
    },

    async updateNodeEndpoint(nodeId, endpoint) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'updateNodeEndpoint',
        args: [nodeId, endpoint],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async heartbeat(nodeId) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'heartbeat',
        args: [nodeId],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async deactivateNode(nodeId) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'deactivateNode',
        args: [nodeId],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async createSite(params) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'createSite',
        args: [
          params.origin,
          params.domains,
          params.cacheTTL ?? 3600n,
          params.enableCompression ?? true,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: cdnRegistryAddress,
        data,
      })

      // Parse siteId from SiteCreated event
      const siteId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'SiteCreated(bytes32,address,string)',
        'siteId',
      )

      return { siteId, txHash }
    },

    async getSite(siteId) {
      const result = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getSite',
        args: [siteId],
      })

      if (result.owner === '0x0000000000000000000000000000000000000000') {
        return null
      }

      return result as Site
    },

    async listMySites() {
      const siteIds = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getSitesByOwner',
        args: [wallet.address],
      })

      const sites: Site[] = []
      for (const siteId of siteIds) {
        const site = await this.getSite(siteId)
        if (site) {
          sites.push(site)
        }
      }

      return sites
    },

    async updateSite(siteId, updates) {
      // Get current site to merge with updates
      const currentSite = await this.getSite(siteId)
      if (!currentSite) {
        throw new Error(`Site ${siteId} not found`)
      }

      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'updateSite',
        args: [
          siteId,
          updates.origin ?? currentSite.origin,
          updates.domains ?? currentSite.domains,
          updates.cacheTTL ?? currentSite.cacheTTL,
          updates.enableCompression ?? currentSite.enableCompression,
        ],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async deleteSite(siteId) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'deleteSite',
        args: [siteId],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async invalidateCache(siteId, paths) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'invalidateCache',
        args: [siteId, paths],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async purgeAllCache(siteId) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'purgeAllCache',
        args: [siteId],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async getNodeMetrics(nodeId) {
      const result = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getNodeMetrics',
        args: [nodeId],
      })

      return {
        requestsServed: result[0],
        bandwidthServed: result[1],
      }
    },

    async getSiteMetrics(siteId) {
      const result = await wallet.publicClient.readContract({
        address: cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getSiteMetrics',
        args: [siteId],
      })

      const totalRequests = result[2] + result[3] // cacheHits + cacheMisses
      const cacheHitRate =
        totalRequests > 0n ? Number(result[2]) / Number(totalRequests) : 0

      return {
        requests: result[0],
        bandwidth: result[1],
        cacheHitRate,
      }
    },
  }
}

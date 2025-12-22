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
import type { JejuWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum CDNProviderType {
  FULL = 0,
  EDGE_ONLY = 1,
  ORIGIN_ONLY = 2,
}

export enum CDNRegion {
  GLOBAL = 0,
  NORTH_AMERICA = 1,
  EUROPE = 2,
  ASIA_PACIFIC = 3,
  SOUTH_AMERICA = 4,
  AFRICA = 5,
  MIDDLE_EAST = 6,
}

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
  {
    name: 'heartbeat',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
  },
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
  wallet: JejuWallet,
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

    async getProvider(_address) {
      // Would read from contract
      return null
    },

    async listProviders() {
      return []
    },

    async updateProviderEndpoint(_endpoint) {
      throw new Error('Not implemented')
    },

    async deactivateProvider() {
      throw new Error('Not implemented')
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

      return { nodeId: `0x${'0'.repeat(64)}` as Hex, txHash }
    },

    async getNode(_nodeId) {
      return null
    },

    async listNodes() {
      return []
    },

    async listNodesByRegion(_region) {
      return []
    },

    async updateNodeEndpoint(_nodeId, _endpoint) {
      throw new Error('Not implemented')
    },

    async heartbeat(nodeId) {
      const data = encodeFunctionData({
        abi: CDN_REGISTRY_ABI,
        functionName: 'heartbeat',
        args: [nodeId],
      })
      return wallet.sendTransaction({ to: cdnRegistryAddress, data })
    },

    async deactivateNode(_nodeId) {
      throw new Error('Not implemented')
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

      return { siteId: `0x${'0'.repeat(64)}` as Hex, txHash }
    },

    async getSite(_siteId) {
      return null
    },

    async listMySites() {
      return []
    },

    async updateSite(_siteId, _updates) {
      throw new Error('Not implemented')
    },

    async deleteSite(_siteId) {
      throw new Error('Not implemented')
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

    async getNodeMetrics(_nodeId) {
      return { requestsServed: 0n, bandwidthServed: 0n }
    },

    async getSiteMetrics(_siteId) {
      return { requests: 0n, bandwidth: 0n, cacheHitRate: 0 }
    },
  }
}

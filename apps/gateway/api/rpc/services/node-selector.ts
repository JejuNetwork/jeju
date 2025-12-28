/**
 * Decentralized RPC Node Selector
 *
 * Selects RPC nodes from the MultiChainRPCRegistry based on:
 * - Reputation scores (uptime, success rate, latency)
 * - Geographic proximity
 * - Chain support
 * - Archive/WebSocket requirements
 *
 * Uses weighted random selection to:
 * - Distribute load across nodes
 * - Give preference to higher-reputation nodes
 * - Avoid overloading single nodes
 */

import {
  type Address,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
} from 'viem'
import { JEJU_CHAIN_ID, RPC_URLS } from '../../../lib/config/networks'

// Contract ABI fragments for MultiChainRPCRegistry
const MULTI_CHAIN_RPC_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getQualifiedProviders',
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
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNode',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'operator', type: 'address' },
          { name: 'region', type: 'string' },
          { name: 'stake', type: 'uint256' },
          { name: 'jejuStake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'isFrozen', type: 'bool' },
          { name: 'totalRequests', type: 'uint256' },
          { name: 'totalComputeUnits', type: 'uint256' },
          { name: 'totalErrors', type: 'uint256' },
          { name: 'lastSeen', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getChainEndpoint',
    inputs: [
      { name: 'node', type: 'address' },
      { name: 'chainId', type: 'uint64' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint64' },
          { name: 'endpoint', type: 'string' },
          { name: 'isActive', type: 'bool' },
          { name: 'isArchive', type: 'bool' },
          { name: 'isWebSocket', type: 'bool' },
          { name: 'blockHeight', type: 'uint64' },
          { name: 'lastUpdated', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nodePerformance',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [
      { name: 'uptimeScore', type: 'uint256' },
      { name: 'successRate', type: 'uint256' },
      { name: 'avgLatencyMs', type: 'uint256' },
      { name: 'lastUpdated', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

// Get Jeju RPC URL
const JEJU_RPC_URL = RPC_URLS[JEJU_CHAIN_ID as keyof typeof RPC_URLS]

// Types for node selection
interface NodeSelectionCriteria {
  chainId: number
  minUptime: number
  maxLatencyMs?: number
  requireArchive: boolean
  requireWebSocket: boolean
  preferRegion?: string
  excludeNodes: Address[]
  maxNodes: number
}

interface SelectedNode {
  address: Address
  endpoint: string
  reputationScore: number
  region: string
  latencyMs?: number
}

interface NodeWithScore {
  address: Address
  endpoint: string
  region: string
  score: bigint
  latencyMs: number
}

// Cache for node data
interface NodeCache {
  nodes: Map<number, NodeWithScore[]>
  lastUpdated: Map<number, number>
}

const cache: NodeCache = {
  nodes: new Map(),
  lastUpdated: new Map(),
}

const CACHE_TTL_MS = 60_000 // 1 minute cache

export class DecentralizedNodeSelector {
  private registryAddress: Address
  private client: ReturnType<typeof createPublicClient>
  private enabled: boolean

  constructor(registryAddress: Address, rpcUrl?: string) {
    this.registryAddress = registryAddress
    this.client = createPublicClient({
      transport: http(rpcUrl ?? JEJU_RPC_URL),
    })
    this.enabled =
      registryAddress !== '0x0000000000000000000000000000000000000000'
  }

  /**
   * Select nodes for a given chain based on criteria
   */
  async selectNodes(criteria: NodeSelectionCriteria): Promise<SelectedNode[]> {
    if (!this.enabled) {
      return []
    }

    const { chainId, minUptime, requireArchive, maxNodes } = criteria

    // Check cache
    const cached = this.getCachedNodes(chainId)
    if (cached.length > 0) {
      return this.filterAndRank(cached, criteria)
    }

    // Fetch from contract
    const nodesWithDetails = await this.fetchQualifiedProviders(
      chainId,
      minUptime,
      requireArchive,
      maxNodes,
    )

    // Cache results
    cache.nodes.set(chainId, nodesWithDetails)
    cache.lastUpdated.set(chainId, Date.now())

    return this.filterAndRank(nodesWithDetails, criteria)
  }

  /**
   * Fetch qualified providers from contract with proper ABI encoding/decoding
   */
  private async fetchQualifiedProviders(
    chainId: number,
    minUptime: number,
    requireArchive: boolean,
    maxNodes: number,
  ): Promise<NodeWithScore[]> {
    // Encode the function call
    const callData = encodeFunctionData({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getQualifiedProviders',
      args: [BigInt(chainId), BigInt(minUptime), requireArchive, maxNodes],
    })

    // Make the call
    const response = await fetch(this.client.transport.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: this.registryAddress, data: callData }, 'latest'],
        id: 1,
      }),
    })

    const result = (await response.json()) as {
      result?: string
      error?: { message: string }
    }

    if (result.error) {
      console.error('[NodeSelector] Contract call failed:', result.error)
      return []
    }

    if (!result.result || result.result === '0x') {
      return []
    }

    // Decode the response
    const decoded = decodeFunctionResult({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getQualifiedProviders',
      data: result.result as `0x${string}`,
    }) as [Address[], bigint[]]

    const [providers, scores] = decoded

    if (!providers || providers.length === 0) {
      return []
    }

    // Fetch node details for each provider
    const nodesWithDetails: NodeWithScore[] = []

    for (let i = 0; i < providers.length; i++) {
      const providerAddress = providers[i]
      const score = scores[i]

      // Get endpoint for this chain
      const endpoint = await this.getEndpointForChain(providerAddress, chainId)
      if (!endpoint) continue

      // Get node info for region
      const nodeInfo = await this.getNodeInfo(providerAddress)
      if (!nodeInfo) continue

      nodesWithDetails.push({
        address: providerAddress,
        endpoint,
        region: nodeInfo.region,
        score,
        latencyMs: 0, // Will be populated by live measurements
      })
    }

    return nodesWithDetails
  }

  /**
   * Get the RPC endpoint for a node on a specific chain
   */
  private async getEndpointForChain(
    node: Address,
    chainId: number,
  ): Promise<string | null> {
    const callData = encodeFunctionData({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getChainEndpoint',
      args: [node, BigInt(chainId)],
    })

    const response = await fetch(this.client.transport.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: this.registryAddress, data: callData }, 'latest'],
        id: 1,
      }),
    })

    const result = (await response.json()) as {
      result?: string
      error?: { message: string }
    }

    if (result.error || !result.result || result.result === '0x') {
      return null
    }

    const decoded = decodeFunctionResult({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getChainEndpoint',
      data: result.result as `0x${string}`,
    }) as {
      chainId: bigint
      endpoint: string
      isActive: boolean
      isArchive: boolean
      isWebSocket: boolean
      blockHeight: bigint
      lastUpdated: bigint
    }

    if (!decoded.isActive || !decoded.endpoint) {
      return null
    }

    return decoded.endpoint
  }

  /**
   * Get node info (region, etc)
   */
  private async getNodeInfo(node: Address): Promise<{ region: string } | null> {
    const callData = encodeFunctionData({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getNode',
      args: [node],
    })

    const response = await fetch(this.client.transport.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: this.registryAddress, data: callData }, 'latest'],
        id: 1,
      }),
    })

    const result = (await response.json()) as {
      result?: string
      error?: { message: string }
    }

    if (result.error || !result.result || result.result === '0x') {
      return null
    }

    const decoded = decodeFunctionResult({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getNode',
      data: result.result as `0x${string}`,
    }) as {
      operator: Address
      region: string
      stake: bigint
      jejuStake: bigint
      registeredAt: bigint
      agentId: bigint
      isActive: boolean
      isFrozen: boolean
      totalRequests: bigint
      totalComputeUnits: bigint
      totalErrors: bigint
      lastSeen: bigint
    }

    if (!decoded.isActive || decoded.isFrozen) {
      return null
    }

    return { region: decoded.region }
  }

  /**
   * Select a single best node using weighted random selection
   */
  async selectBestNode(
    criteria: NodeSelectionCriteria,
  ): Promise<SelectedNode | null> {
    const nodes = await this.selectNodes(criteria)
    if (nodes.length === 0) return null

    // Weighted random selection based on reputation score
    const totalWeight = nodes.reduce((sum, n) => sum + n.reputationScore, 0)
    const random = Math.random() * totalWeight

    let cumulative = 0
    for (const node of nodes) {
      cumulative += node.reputationScore
      if (random <= cumulative) {
        return node
      }
    }

    return nodes[0]
  }

  /**
   * Get all available endpoints for a chain (for fallback)
   */
  async getEndpointsForChain(chainId: number): Promise<string[]> {
    const nodes = await this.selectNodes({
      chainId,
      minUptime: 5000, // 50% minimum
      requireArchive: false,
      requireWebSocket: false,
      maxNodes: 20,
      excludeNodes: [],
    })

    return nodes.map((n) => n.endpoint)
  }

  /**
   * Report node latency (for adaptive selection)
   */
  reportLatency(
    chainId: number,
    nodeAddress: Address,
    latencyMs: number,
  ): void {
    const nodes = cache.nodes.get(chainId)
    if (!nodes) return

    const node = nodes.find(
      (n) => n.address.toLowerCase() === nodeAddress.toLowerCase(),
    )
    if (node) {
      // Exponential moving average
      node.latencyMs =
        node.latencyMs === 0
          ? latencyMs
          : node.latencyMs * 0.7 + latencyMs * 0.3
    }
  }

  /**
   * Report node failure (for adaptive selection)
   */
  reportFailure(chainId: number, nodeAddress: Address): void {
    const nodes = cache.nodes.get(chainId)
    if (!nodes) return

    // Reduce score temporarily
    const node = nodes.find(
      (n) => n.address.toLowerCase() === nodeAddress.toLowerCase(),
    )
    if (node) {
      node.score = (node.score * BigInt(80)) / BigInt(100) // 20% penalty
    }
  }

  /**
   * Invalidate cache for a chain
   */
  invalidateCache(chainId?: number): void {
    if (chainId !== undefined) {
      cache.nodes.delete(chainId)
      cache.lastUpdated.delete(chainId)
    } else {
      cache.nodes.clear()
      cache.lastUpdated.clear()
    }
  }

  /**
   * Enable/disable decentralized selection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  // Private helpers

  private getCachedNodes(chainId: number): NodeWithScore[] {
    const lastUpdated = cache.lastUpdated.get(chainId) ?? 0
    if (Date.now() - lastUpdated > CACHE_TTL_MS) {
      return []
    }
    return cache.nodes.get(chainId) ?? []
  }

  private filterAndRank(
    nodes: NodeWithScore[],
    criteria: NodeSelectionCriteria,
  ): SelectedNode[] {
    let filtered = nodes

    // Exclude specified nodes
    if (criteria.excludeNodes.length > 0) {
      const excludeSet = new Set(
        criteria.excludeNodes.map((a) => a.toLowerCase()),
      )
      filtered = filtered.filter(
        (n) => !excludeSet.has(n.address.toLowerCase()),
      )
    }

    // Filter by region if specified
    if (criteria.preferRegion) {
      const preferredRegion = criteria.preferRegion.toLowerCase()
      const inRegion = filtered.filter((n) =>
        n.region.toLowerCase().includes(preferredRegion),
      )
      if (inRegion.length > 0) {
        // Boost scores for preferred region
        filtered = filtered.map((n) => ({
          ...n,
          score: n.region.toLowerCase().includes(preferredRegion)
            ? (n.score * BigInt(150)) / BigInt(100)
            : n.score,
        }))
      }
    }

    // Filter by max latency
    if (criteria.maxLatencyMs !== undefined) {
      const maxLatencyMs = criteria.maxLatencyMs
      filtered = filtered.filter(
        (n) => n.latencyMs === 0 || n.latencyMs <= maxLatencyMs,
      )
    }

    // Sort by score (descending)
    filtered.sort((a, b) =>
      b.score > a.score ? 1 : b.score < a.score ? -1 : 0,
    )

    // Limit results
    const limited = filtered.slice(0, criteria.maxNodes)

    // Convert to SelectedNode format
    return limited.map((n) => ({
      address: n.address,
      endpoint: n.endpoint,
      reputationScore: Number(n.score),
      region: n.region,
      latencyMs: n.latencyMs || undefined,
    }))
  }
}

// Singleton instance
let selectorInstance: DecentralizedNodeSelector | null = null

export function getNodeSelector(): DecentralizedNodeSelector {
  if (!selectorInstance) {
    // Get registry address from config
    const registryAddress =
      (process.env.MULTI_CHAIN_RPC_REGISTRY as Address) ??
      '0x0000000000000000000000000000000000000000'
    selectorInstance = new DecentralizedNodeSelector(registryAddress)
  }
  return selectorInstance
}

export function initNodeSelector(
  registryAddress: Address,
  rpcUrl?: string,
): DecentralizedNodeSelector {
  selectorInstance = new DecentralizedNodeSelector(registryAddress, rpcUrl)
  return selectorInstance
}

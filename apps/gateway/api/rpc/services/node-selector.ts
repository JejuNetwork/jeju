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

import type { Address } from 'viem'
import { RPC_URLS, JEJU_CHAIN_ID } from '../../../lib/config/networks'

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

interface ContractEndpoint {
  chainId: bigint
  endpoint: string
  isActive: boolean
  isArchive: boolean
  isWebSocket: boolean
  blockHeight: bigint
  lastUpdated: bigint
}

interface ContractNode {
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

// Cache for node data
interface NodeCache {
  nodes: Map<number, NodeWithScore[]> // chainId -> nodes
  lastUpdated: Map<number, number>
}

const cache: NodeCache = {
  nodes: new Map(),
  lastUpdated: new Map(),
}

const CACHE_TTL_MS = 60_000 // 1 minute cache

export class DecentralizedNodeSelector {
  private registryAddress: Address
  private rpcUrl: string
  private enabled: boolean

  constructor(registryAddress: Address, rpcUrl?: string) {
    this.registryAddress = registryAddress
    this.rpcUrl = rpcUrl ?? JEJU_RPC_URL
    this.enabled = true
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

    // Fetch from contract using direct RPC call
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
   * Fetch qualified providers from contract
   */
  private async fetchQualifiedProviders(
    chainId: number,
    minUptime: number,
    requireArchive: boolean,
    maxNodes: number,
  ): Promise<NodeWithScore[]> {
    // Call contract using JSON-RPC
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: this.registryAddress,
            data: this.encodeGetQualifiedProviders(
              chainId,
              minUptime,
              requireArchive,
              maxNodes,
            ),
          },
          'latest',
        ],
        id: 1,
      }),
    })

    const result = (await response.json()) as { result?: string; error?: { message: string } }
    if (result.error) {
      console.error('[NodeSelector] Contract call failed:', result.error)
      return []
    }

    if (!result.result || result.result === '0x') {
      return []
    }

    // Decode response (simplified - actual decoding would parse ABI)
    // For now, return empty and let fallback to static endpoints
    return []
  }

  /**
   * Encode getQualifiedProviders call
   */
  private encodeGetQualifiedProviders(
    chainId: number,
    minUptime: number,
    requireArchive: boolean,
    maxCount: number,
  ): string {
    // Function selector: keccak256("getQualifiedProviders(uint64,uint256,bool,uint16)")
    const selector = '0x8b7afe2e'
    const chainIdHex = chainId.toString(16).padStart(64, '0')
    const minUptimeHex = minUptime.toString(16).padStart(64, '0')
    const requireArchiveHex = requireArchive ? '1'.padStart(64, '0') : '0'.padStart(64, '0')
    const maxCountHex = maxCount.toString(16).padStart(64, '0')

    return `${selector}${chainIdHex}${minUptimeHex}${requireArchiveHex}${maxCountHex}`
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
  reportLatency(chainId: number, nodeAddress: Address, latencyMs: number): void {
    const nodes = cache.nodes.get(chainId)
    if (!nodes) return

    const node = nodes.find(
      (n) => n.address.toLowerCase() === nodeAddress.toLowerCase(),
    )
    if (node) {
      // Exponential moving average
      node.latencyMs = node.latencyMs === 0 ? latencyMs : node.latencyMs * 0.7 + latencyMs * 0.3
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
      const excludeSet = new Set(criteria.excludeNodes.map((a) => a.toLowerCase()))
      filtered = filtered.filter(
        (n) => !excludeSet.has(n.address.toLowerCase()),
      )
    }

    // Filter by region if specified
    if (criteria.preferRegion) {
      const preferredRegion = criteria.preferRegion.toLowerCase()
      const inRegion = filtered.filter(
        (n) => n.region.toLowerCase().includes(preferredRegion),
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
      filtered = filtered.filter(
        (n) => n.latencyMs === 0 || n.latencyMs <= criteria.maxLatencyMs!,
      )
    }

    // Sort by score (descending)
    filtered.sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0))

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

import { type Address, decodeFunctionResult, encodeFunctionData } from 'viem'
import { RPC_URLS, JEJU_CHAIN_ID } from '../../../lib/config/networks'

const REGISTRY_ABI = [
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
] as const

const JEJU_RPC_URL = RPC_URLS[JEJU_CHAIN_ID as keyof typeof RPC_URLS]
const CACHE_TTL_MS = 60_000

interface NodeSelectionCriteria {
  chainId: number
  minUptime: number
  maxLatencyMs?: number
  requireArchive: boolean
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

interface CachedNode {
  address: Address
  endpoint: string
  region: string
  score: bigint
  latencyMs: number
}

const nodeCache = new Map<number, CachedNode[]>()
const cacheTimestamps = new Map<number, number>()

async function callRegistry<T>(
  registryAddress: Address,
  rpcUrl: string,
  functionName: 'getQualifiedProviders' | 'getNode' | 'getChainEndpoint',
  args: readonly unknown[],
): Promise<T | null> {
  const callData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName,
    args: args as never,
  })

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: registryAddress, data: callData }, 'latest'],
      id: 1,
    }),
  })

  const result = (await response.json()) as { result?: string; error?: { message: string } }
  if (result.error || !result.result || result.result === '0x') return null

  return decodeFunctionResult({
    abi: REGISTRY_ABI,
    functionName,
    data: result.result as `0x${string}`,
  }) as T
}

export class DecentralizedNodeSelector {
  private registryAddress: Address
  private rpcUrl: string
  private enabled: boolean

  constructor(registryAddress: Address, rpcUrl?: string) {
    this.registryAddress = registryAddress
    this.rpcUrl = rpcUrl ?? JEJU_RPC_URL
    this.enabled = registryAddress !== '0x0000000000000000000000000000000000000000'
  }

  async selectNodes(criteria: NodeSelectionCriteria): Promise<SelectedNode[]> {
    if (!this.enabled) return []

    const { chainId, minUptime, requireArchive, maxNodes } = criteria
    const lastUpdated = cacheTimestamps.get(chainId) ?? 0

    if (Date.now() - lastUpdated < CACHE_TTL_MS) {
      const cached = nodeCache.get(chainId)
      if (cached?.length) return this.filterAndRank(cached, criteria)
    }

    const nodes = await this.fetchProviders(chainId, minUptime, requireArchive, maxNodes)
    nodeCache.set(chainId, nodes)
    cacheTimestamps.set(chainId, Date.now())

    return this.filterAndRank(nodes, criteria)
  }

  private async fetchProviders(
    chainId: number,
    minUptime: number,
    requireArchive: boolean,
    maxNodes: number,
  ): Promise<CachedNode[]> {
    const result = await callRegistry<[Address[], bigint[]]>(
      this.registryAddress,
      this.rpcUrl,
      'getQualifiedProviders',
      [BigInt(chainId), BigInt(minUptime), requireArchive, maxNodes],
    )

    if (!result) return []
    const [providers, scores] = result
    if (!providers?.length) return []

    const nodes: CachedNode[] = []
    for (let i = 0; i < providers.length; i++) {
      const address = providers[i]
      const [endpoint, region] = await Promise.all([
        this.getEndpoint(address, chainId),
        this.getNodeRegion(address),
      ])

      if (endpoint && region) {
        nodes.push({ address, endpoint, region, score: scores[i], latencyMs: 0 })
      }
    }

    return nodes
  }

  private async getEndpoint(node: Address, chainId: number): Promise<string | null> {
    type Result = { endpoint: string; isActive: boolean }
    const result = await callRegistry<Result>(
      this.registryAddress,
      this.rpcUrl,
      'getChainEndpoint',
      [node, BigInt(chainId)],
    )
    return result?.isActive && result.endpoint ? result.endpoint : null
  }

  private async getNodeRegion(node: Address): Promise<string | null> {
    type Result = { region: string; isActive: boolean; isFrozen: boolean }
    const result = await callRegistry<Result>(
      this.registryAddress,
      this.rpcUrl,
      'getNode',
      [node],
    )
    return result?.isActive && !result.isFrozen ? result.region : null
  }

  async selectBestNode(criteria: NodeSelectionCriteria): Promise<SelectedNode | null> {
    const nodes = await this.selectNodes(criteria)
    if (!nodes.length) return null

    const totalWeight = nodes.reduce((sum, n) => sum + n.reputationScore, 0)
    const random = Math.random() * totalWeight

    let cumulative = 0
    for (const node of nodes) {
      cumulative += node.reputationScore
      if (random <= cumulative) return node
    }
    return nodes[0]
  }

  async getEndpointsForChain(chainId: number): Promise<string[]> {
    const nodes = await this.selectNodes({
      chainId,
      minUptime: 5000,
      requireArchive: false,
      maxNodes: 20,
      excludeNodes: [],
    })
    return nodes.map((n) => n.endpoint)
  }

  reportLatency(chainId: number, nodeAddress: Address, latencyMs: number): void {
    const node = nodeCache.get(chainId)?.find((n) => n.address.toLowerCase() === nodeAddress.toLowerCase())
    if (node) {
      node.latencyMs = node.latencyMs === 0 ? latencyMs : node.latencyMs * 0.7 + latencyMs * 0.3
    }
  }

  reportFailure(chainId: number, nodeAddress: Address): void {
    const node = nodeCache.get(chainId)?.find((n) => n.address.toLowerCase() === nodeAddress.toLowerCase())
    if (node) {
      node.score = (node.score * BigInt(80)) / BigInt(100)
    }
  }

  invalidateCache(chainId?: number): void {
    if (chainId !== undefined) {
      nodeCache.delete(chainId)
      cacheTimestamps.delete(chainId)
    } else {
      nodeCache.clear()
      cacheTimestamps.clear()
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  private filterAndRank(nodes: CachedNode[], criteria: NodeSelectionCriteria): SelectedNode[] {
    let filtered = nodes

    if (criteria.excludeNodes.length) {
      const excludeSet = new Set(criteria.excludeNodes.map((a) => a.toLowerCase()))
      filtered = filtered.filter((n) => !excludeSet.has(n.address.toLowerCase()))
    }

    if (criteria.preferRegion) {
      const region = criteria.preferRegion.toLowerCase()
      filtered = filtered.map((n) => ({
        ...n,
        score: n.region.toLowerCase().includes(region) ? (n.score * BigInt(150)) / BigInt(100) : n.score,
      }))
    }

    if (criteria.maxLatencyMs !== undefined) {
      filtered = filtered.filter((n) => n.latencyMs === 0 || n.latencyMs <= criteria.maxLatencyMs!)
    }

    filtered.sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0))

    return filtered.slice(0, criteria.maxNodes).map((n) => ({
      address: n.address,
      endpoint: n.endpoint,
      reputationScore: Number(n.score),
      region: n.region,
      latencyMs: n.latencyMs || undefined,
    }))
  }
}

let selectorInstance: DecentralizedNodeSelector | null = null

export function getNodeSelector(): DecentralizedNodeSelector {
  if (!selectorInstance) {
    const registryAddress =
      (typeof process !== 'undefined' ? (process.env.MULTI_CHAIN_RPC_REGISTRY as Address | undefined) : undefined) ??
      '0x0000000000000000000000000000000000000000'
    selectorInstance = new DecentralizedNodeSelector(registryAddress)
  }
  return selectorInstance
}

export function initNodeSelector(registryAddress: Address, rpcUrl?: string): DecentralizedNodeSelector {
  selectorInstance = new DecentralizedNodeSelector(registryAddress, rpcUrl)
  return selectorInstance
}

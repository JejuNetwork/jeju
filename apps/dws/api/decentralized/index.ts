/**
 * DWS Bootstrap
 *
 * Enables operation:
 * - Frontend served from IPFS/CDN
 * - Node discovery via ERC-8004 IdentityRegistry (same registry for all agents/nodes)
 * - P2P coordination between DWS nodes
 * - Self-hosting of DWS code through DWS
 *
 * DWS nodes register as agents in the IdentityRegistry with:
 * - Tags: "dws", "dws-storage", "dws-compute", "dws-cdn", "dws-git", "dws-pkg"
 * - Metadata: "dwsEndpoint" = node HTTP endpoint
 * - A2A Endpoint: same as dwsEndpoint
 */

import { validateOrNull } from '@jejunetwork/types'
import { type Address, createPublicClient, http } from 'viem'
import { z } from 'zod'
import type { BackendManager } from '../storage/backends'

const CountResponseSchema = z.object({ count: z.number().optional() })

// ERC-8004 IdentityRegistry ABI - Unified agent/node registry

// ERC-8004 IdentityRegistry ABI - simplified for read operations
const IDENTITY_REGISTRY_ABI = [
  // Registration (not used directly, but included for reference)
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'tokenURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  // Metadata
  {
    name: 'getMetadata',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: 'value', type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    name: 'getA2AEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
  },
  // Tags
  {
    name: 'getAgentTags',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'tags', type: 'string[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  // Agent info
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isBanned', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'totalAgents',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'count', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
    stateMutability: 'view',
  },
] as const

// Types

// DWS node types - correspond to tags in IdentityRegistry
export type DWSNodeType = 'storage' | 'compute' | 'cdn' | 'git' | 'pkg' | 'full'

// DWS-specific tag prefix
const DWS_TAG_PREFIX = 'dws-'
const DWS_BASE_TAG = 'dws'

// Metadata keys for DWS nodes
const DWS_ENDPOINT_KEY = 'dwsEndpoint'
// Reserved for future metadata
void 'dwsNodeType'
void 'dwsVersion'

export interface DWSNode {
  agentId: bigint
  owner: Address
  endpoint: string
  nodeTypes: DWSNodeType[]
  stake: bigint
  isBanned: boolean
  lastSeen?: number
  latency?: number
}

/** Contract return type for getAgent */
interface AgentContractResult {
  agentId: bigint
  owner: Address
  tier: number
  stakedAmount: bigint
  isBanned: boolean
}

export interface Config {
  rpcUrl: string
  identityRegistryAddress: Address // ERC-8004 IdentityRegistry
  frontendCid?: string
  selfAgentId?: bigint
}

// Decentralized Node Discovery (via ERC-8004 IdentityRegistry)

export class NodeDiscovery {
  private publicClient
  private registryAddress: Address
  private nodeCache: Map<string, DWSNode> = new Map()
  private cacheExpiry = 60000 // 1 minute
  private lastCacheUpdate = 0

  constructor(config: Config) {
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    })
    this.registryAddress = config.identityRegistryAddress
  }

  /**
   * Get active DWS nodes by type
   * Queries agents with tag "dws-{nodeType}" or "dws" for all nodes
   */
  async getActiveNodes(nodeType: DWSNodeType): Promise<DWSNode[]> {
    const now = Date.now()
    if (now - this.lastCacheUpdate < this.cacheExpiry) {
      return Array.from(this.nodeCache.values()).filter(
        (n) => n.nodeTypes.includes(nodeType) || n.nodeTypes.includes('full'),
      )
    }

    // Query by DWS tag
    const tag =
      nodeType === 'full' ? DWS_BASE_TAG : `${DWS_TAG_PREFIX}${nodeType}`
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [tag],
    })
    const agentIds = Array.isArray(result)
      ? result.filter((id): id is bigint => typeof id === 'bigint')
      : []

    const nodes: DWSNode[] = []
    for (const agentId of agentIds) {
      const node = await this.getNode(agentId)
      if (node && !node.isBanned) {
        nodes.push(node)
        this.nodeCache.set(agentId.toString(), node)
      }
    }

    this.lastCacheUpdate = now
    return nodes
  }

  /**
   * Get a specific DWS node by agent ID
   */
  async getNode(agentId: bigint): Promise<DWSNode | null> {
    const cacheKey = agentId.toString()
    const cached = this.nodeCache.get(cacheKey)
    if (cached && Date.now() - (cached.lastSeen ?? 0) < this.cacheExpiry) {
      return cached
    }

    // Get agent info
    const agentResult = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [agentId],
    })

    // Validate the agent result structure
    if (
      !agentResult ||
      typeof agentResult !== 'object' ||
      !('owner' in agentResult) ||
      typeof agentResult.owner !== 'string'
    ) {
      return null
    }

    const agent = agentResult as AgentContractResult

    if (agent.owner === '0x0000000000000000000000000000000000000000') {
      return null
    }

    // Get endpoint from A2A endpoint or dwsEndpoint metadata
    const endpointResult = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getA2AEndpoint',
      args: [agentId],
    })
    let endpoint = typeof endpointResult === 'string' ? endpointResult : ''

    if (!endpoint) {
      const metadataResult = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getMetadata',
        args: [agentId, DWS_ENDPOINT_KEY],
      })
      const endpointBytes =
        typeof metadataResult === 'string' ? metadataResult : ''
      if (
        endpointBytes &&
        endpointBytes !== '0x' &&
        endpointBytes.startsWith('0x')
      ) {
        endpoint = Buffer.from(endpointBytes.slice(2), 'hex').toString()
      }
    }

    if (!endpoint) {
      return null // No endpoint = not a valid DWS node
    }

    // Get node types from tags
    const tagsResult = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentTags',
      args: [agentId],
    })
    const tags = Array.isArray(tagsResult)
      ? tagsResult.filter((t): t is string => typeof t === 'string')
      : []

    const nodeTypes: DWSNodeType[] = []
    for (const tag of tags) {
      if (tag === DWS_BASE_TAG) {
        nodeTypes.push('full')
      } else if (tag.startsWith(DWS_TAG_PREFIX)) {
        const type = tag.slice(DWS_TAG_PREFIX.length)
        if (['storage', 'compute', 'cdn', 'git', 'pkg'].includes(type)) {
          nodeTypes.push(type as DWSNodeType)
        }
      }
    }

    const node: DWSNode = {
      agentId,
      owner: agent.owner,
      endpoint,
      nodeTypes,
      stake: agent.stakedAmount,
      isBanned: agent.isBanned,
      lastSeen: Date.now(),
    }

    this.nodeCache.set(cacheKey, node)
    return node
  }

  /**
   * Find the best (lowest latency) node for a given type
   */
  async findBestNode(nodeType: DWSNodeType): Promise<DWSNode | null> {
    const nodes = await this.getActiveNodes(nodeType)
    if (nodes.length === 0) return null

    // Ping nodes to find best latency
    const withLatency = await Promise.all(
      nodes.map(async (node) => {
        const start = Date.now()
        const healthy = await this.pingNode(node.endpoint)
        return {
          ...node,
          latency: healthy ? Date.now() - start : Infinity,
        }
      }),
    )

    // Sort by latency, return best
    withLatency.sort(
      (a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity),
    )
    return withLatency[0] ?? null
  }

  private async pingNode(endpoint: string): Promise<boolean> {
    const response = await fetch(`${endpoint}/health`).catch((err: Error) => {
      console.debug(
        `[NodeDiscovery] Node ${endpoint} unreachable: ${err.message}`,
      )
      return null
    })
    return response?.ok ?? false
  }

  /**
   * Get count of all DWS nodes (agents with "dws" tag)
   */
  async getNodeCount(): Promise<number> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [DWS_BASE_TAG],
    })
    const agentIds = Array.isArray(result) ? result : []
    return agentIds.length
  }
}

// Decentralized Frontend Loader

export class Frontend {
  private backendManager: BackendManager
  private frontendCid: string | null = null
  private cachedAssets: Map<string, { content: Buffer; contentType: string }> =
    new Map()

  constructor(backendManager: BackendManager) {
    this.backendManager = backendManager
  }

  async setFrontendCid(cid: string): Promise<void> {
    this.frontendCid = cid
    this.cachedAssets.clear()
    console.log(`[DWS] Frontend CID set to: ${cid}`)
  }

  async getFrontendCid(): Promise<string | null> {
    return this.frontendCid
  }

  async serveAsset(path: string): Promise<Response | null> {
    if (!this.frontendCid) {
      return null
    }

    // Normalize path
    const assetPath =
      path === '/' || path === '' ? 'index.html' : path.replace(/^\//, '')
    const cacheKey = `${this.frontendCid}/${assetPath}`

    // Check cache
    const cached = this.cachedAssets.get(cacheKey)
    if (cached) {
      return new Response(new Uint8Array(cached.content), {
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-DWS-Source': 'ipfs',
          'X-DWS-CID': this.frontendCid,
        },
      })
    }

    // Fetch from IPFS
    const assetCid = `${this.frontendCid}/${assetPath}`
    const result = await this.backendManager
      .download(assetCid)
      .catch((err: Error) => {
        console.debug(
          `[DWS Frontend] Asset not found: ${assetPath} - ${err.message}`,
        )
        return null
      })

    if (!result) {
      // Try index.html for SPA routing
      if (!assetPath.includes('.')) {
        return this.serveAsset('index.html')
      }
      return null
    }

    const contentType = this.getContentType(assetPath)
    this.cachedAssets.set(cacheKey, { content: result.content, contentType })

    return new Response(new Uint8Array(result.content), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-DWS-Source': 'ipfs',
        'X-DWS-CID': this.frontendCid,
      },
    })
  }

  private getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const types: Record<string, string> = {
      html: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'application/javascript; charset=utf-8',
      json: 'application/json; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      eot: 'application/vnd.ms-fontobject',
    }
    return types[ext ?? ''] ?? 'application/octet-stream'
  }
}

// P2P Coordination

export class P2PCoordinator {
  private discovery: NodeDiscovery
  private selfEndpoint: string
  private peers: Map<string, { node: DWSNode; lastPing: number }> = new Map()
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null

  constructor(discovery: NodeDiscovery, selfEndpoint: string) {
    this.discovery = discovery
    this.selfEndpoint = selfEndpoint
  }

  async start(): Promise<void> {
    console.log('[DWS P2P] Starting peer coordination...')
    await this.discoverPeers()

    // Heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat().catch(console.error)
    }, 30000)
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  async discoverPeers(): Promise<void> {
    // Discover all DWS nodes (full nodes)
    const nodes = await this.discovery.getActiveNodes('full')

    for (const node of nodes) {
      if (node.endpoint === this.selfEndpoint) continue

      const healthy = await this.pingPeer(node)
      if (healthy) {
        this.peers.set(node.agentId.toString(), { node, lastPing: Date.now() })
      }
    }

    console.log(`[DWS P2P] Discovered ${this.peers.size} active peers`)
  }

  private async pingPeer(node: DWSNode): Promise<boolean> {
    const response = await fetch(`${node.endpoint}/health`)
    return response.ok
  }

  private async heartbeat(): Promise<void> {
    const now = Date.now()
    const staleThreshold = 120000 // 2 minutes

    for (const [agentId, peer] of this.peers) {
      if (now - peer.lastPing > staleThreshold) {
        const healthy = await this.pingPeer(peer.node)
        if (healthy) {
          peer.lastPing = now
        } else {
          this.peers.delete(agentId)
          console.log(`[DWS P2P] Peer ${agentId} went offline`)
        }
      }
    }

    // Discover new peers periodically
    if (this.peers.size < 5) {
      await this.discoverPeers()
    }
  }

  getPeers(): DWSNode[] {
    return Array.from(this.peers.values()).map((p) => p.node)
  }

  async broadcastToAll<T>(
    path: string,
    data: T,
  ): Promise<Map<string, Response>> {
    const results = new Map<string, Response>()

    await Promise.all(
      Array.from(this.peers.values()).map(async ({ node }) => {
        const response = await fetch(`${node.endpoint}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })

        results.set(node.agentId.toString(), response)
      }),
    )

    return results
  }
}

// Distributed Rate Limiter

export class DistributedRateLimiter {
  private p2p: P2PCoordinator
  private localCounts: Map<string, { count: number; resetAt: number }> =
    new Map()
  private windowMs = 60000
  private maxRequests = 1000

  constructor(p2p: P2PCoordinator, windowMs = 60000, maxRequests = 1000) {
    this.p2p = p2p
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  async checkLimit(
    clientKey: string,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now()

    // Get local count
    let entry = this.localCounts.get(clientKey)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs }
      this.localCounts.set(clientKey, entry)
    }

    // Get counts from peers (best effort, async)
    const peerCounts = await this.getPeerCounts(clientKey)
    const totalCount = entry.count + peerCounts

    entry.count++

    const allowed = totalCount < this.maxRequests
    const remaining = Math.max(0, this.maxRequests - totalCount - 1)

    return { allowed, remaining, resetAt: entry.resetAt }
  }

  private async getPeerCounts(clientKey: string): Promise<number> {
    // Query peers for their counts (with timeout)
    const peers = this.p2p.getPeers()
    if (peers.length === 0) return 0

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 100) // 100ms timeout

    let totalPeerCount = 0
    await Promise.all(
      peers.slice(0, 3).map(async (peer) => {
        // Only query 3 peers max
        const response = await fetch(
          `${peer.endpoint}/_internal/ratelimit/${clientKey}`,
          {
            signal: controller.signal,
          },
        )

        if (response.ok) {
          const data = validateOrNull(
            CountResponseSchema,
            await response.json(),
          )
          totalPeerCount += data?.count ?? 0
        }
      }),
    )

    clearTimeout(timeout)
    return totalPeerCount
  }

  getLocalCount(clientKey: string): number {
    return this.localCounts.get(clientKey)?.count ?? 0
  }
}

// Export factory

export function createDecentralizedServices(
  config: Config,
  backendManager: BackendManager,
) {
  const discovery = new NodeDiscovery(config)
  const frontend = new Frontend(backendManager)

  if (config.frontendCid) {
    frontend.setFrontendCid(config.frontendCid)
  }

  return {
    discovery,
    frontend,
    createP2P: (selfEndpoint: string) =>
      new P2PCoordinator(discovery, selfEndpoint),
    createRateLimiter: (p2p: P2PCoordinator) => new DistributedRateLimiter(p2p),
  }
}

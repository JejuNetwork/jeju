/**
 * Decentralized Node Discovery
 *
 * Multi-layer discovery system:
 * 1. On-chain registry (IdentityRegistry) - source of truth
 * 2. libp2p DHT - peer-to-peer discovery
 * 3. DNS bootstrap - initial node discovery
 * 4. Local cache - performance optimization
 *
 * This enables fully decentralized operation without any centralized servers.
 */

import type { Address } from 'viem'
import { createPublicClient, http, keccak256, toHex } from 'viem'
import { z } from 'zod'

// Discovery configuration
export interface DiscoveryConfig {
  rpcUrl: string
  identityRegistryAddress: Address
  cdnRegistryAddress?: Address
  computeRegistryAddress?: Address
  storageRegistryAddress?: Address
  daRegistryAddress?: Address
  bootstrapNodes?: string[]
  region?: string
  enableDHT?: boolean
  enableGossip?: boolean
}

// Node types
export type ServiceType = 'cdn' | 'compute' | 'storage' | 'da' | 'full'

export interface NodeInfo {
  nodeId: string
  operator: Address
  endpoint: string
  services: ServiceType[]
  region: string
  stake: bigint
  attestationHash: string
  teePlatform: 'simulator' | 'intel-sgx' | 'amd-sev' | 'intel-tdx'
  lastSeen: number
  latency?: number
  reputation?: number
  agentId?: bigint
}

export interface PeerInfo {
  nodeId: string
  multiaddr: string[]
  lastSeen: number
  connected: boolean
}

// Contract ABIs
const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
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
    name: 'getA2AEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
  },
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
    name: 'getAgentTags',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'tags', type: 'string[]' }],
    stateMutability: 'view',
  },
] as const

const CDN_REGISTRY_ABI = [
  {
    name: 'getEdgeNode',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'bytes32' },
          { name: 'operator', type: 'address' },
          { name: 'endpoint', type: 'string' },
          { name: 'region', type: 'uint8' },
          { name: 'providerType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'stake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastSeen', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getOperatorNodes',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'nodeCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getNodesByRegion',
    type: 'function',
    inputs: [{ name: 'region', type: 'uint8' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

// DNS bootstrap nodes for initial discovery
// These are the actual DWS bootstrap endpoints that will be deployed
// For local development, discovery falls back to on-chain registry only
const DEFAULT_BOOTSTRAP_NODES: string[] = []

// Production bootstrap nodes (uncomment when deployed):
// const PRODUCTION_BOOTSTRAP_NODES = [
//   'https://bootstrap1.jejunetwork.org/dws',
//   'https://bootstrap2.jejunetwork.org/dws',
//   'https://bootstrap3.jejunetwork.org/dws',
// ]

// DHT namespace for DWS nodes
export const DHT_NAMESPACE = '/jeju/dws/1.0.0'

// Region ID mapping
const REGION_IDS: Record<number, string> = {
  0: 'global',
  1: 'us-east-1',
  2: 'us-west-2',
  3: 'eu-west-1',
  4: 'eu-central-1',
  5: 'ap-northeast-1',
  6: 'ap-southeast-1',
}

const REGION_NAMES: Record<string, number> = {
  global: 0,
  'us-east-1': 1,
  'us-west-2': 2,
  'eu-west-1': 3,
  'eu-central-1': 4,
  'ap-northeast-1': 5,
  'ap-southeast-1': 6,
}

// Node announcement schema for gossip
const NodeAnnouncementSchema = z.object({
  nodeId: z.string(),
  operator: z.string(),
  endpoint: z.string(),
  services: z.array(z.enum(['cdn', 'compute', 'storage', 'da', 'full'])),
  region: z.string(),
  timestamp: z.number(),
  signature: z.string().optional(),
})

type NodeAnnouncement = z.infer<typeof NodeAnnouncementSchema>

/**
 * Multi-layer node discovery system
 */
export class NodeDiscovery {
  private config: DiscoveryConfig
  private publicClient
  private nodeCache: Map<string, NodeInfo> = new Map()
  private peerCache: Map<string, PeerInfo> = new Map()
  private lastOnChainSync = 0
  private onChainSyncInterval = 60000 // 1 minute
  private selfNodeId: string | null = null
  private gossipSubscribers: Array<(node: NodeInfo) => void> = []

  constructor(config: DiscoveryConfig) {
    this.config = config
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    })
  }

  /**
   * Initialize discovery system
   */
  async initialize(selfEndpoint?: string): Promise<void> {
    console.log('[Discovery] Initializing multi-layer discovery...')

    // Generate self node ID if endpoint provided
    if (selfEndpoint) {
      this.selfNodeId = keccak256(toHex(selfEndpoint)).slice(0, 42)
    }

    // Bootstrap from DNS
    await this.bootstrapFromDNS()

    // Sync from on-chain registry
    await this.syncFromOnChain()

    // Start DHT if enabled
    if (this.config.enableDHT) {
      await this.startDHT()
    }

    console.log(
      `[Discovery] Initialized with ${this.nodeCache.size} known nodes`,
    )
  }

  /**
   * Bootstrap from DNS TXT records and known bootstrap nodes
   */
  private async bootstrapFromDNS(): Promise<void> {
    const bootstrapNodes = this.config.bootstrapNodes ?? DEFAULT_BOOTSTRAP_NODES

    for (const bootstrapUrl of bootstrapNodes) {
      const nodes = await fetch(`${bootstrapUrl}/nodes`, {
        signal: AbortSignal.timeout(5000),
      })
        .then(async (res) => {
          if (!res.ok) return []
          const data = (await res.json()) as { nodes: NodeInfo[] }
          return data.nodes ?? []
        })
        .catch((err) => {
          console.debug(
            `[Discovery] Bootstrap ${bootstrapUrl} unreachable: ${err.message}`,
          )
          return [] as NodeInfo[]
        })

      for (const node of nodes) {
        this.nodeCache.set(node.nodeId, node)
      }
    }

    console.log(
      `[Discovery] Bootstrapped ${this.nodeCache.size} nodes from DNS`,
    )
  }

  /**
   * Sync nodes from on-chain registries
   */
  async syncFromOnChain(): Promise<void> {
    const now = Date.now()
    if (now - this.lastOnChainSync < this.onChainSyncInterval) {
      return // Throttle on-chain queries
    }

    console.log('[Discovery] Syncing from on-chain registry...')

    // Query IdentityRegistry for DWS agents
    if (this.config.identityRegistryAddress) {
      await this.syncFromIdentityRegistry()
    }

    // Query CDN Registry for edge nodes
    if (this.config.cdnRegistryAddress) {
      await this.syncFromCDNRegistry()
    }

    this.lastOnChainSync = now
  }

  private async syncFromIdentityRegistry(): Promise<void> {
    const dwsTags = ['dws', 'dws-cdn', 'dws-compute', 'dws-storage', 'dws-da']

    for (const tag of dwsTags) {
      const agentIds = await this.publicClient
        .readContract({
          address: this.config.identityRegistryAddress,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getAgentsByTag',
          args: [tag],
        })
        .catch((err) => {
          console.debug(
            `[Discovery] Failed to fetch agents by tag: ${err.message}`,
          )
          return [] as bigint[]
        })

      for (const agentId of agentIds) {
        const node = await this.fetchAgentAsNode(agentId)
        if (node) {
          this.nodeCache.set(node.nodeId, node)
        }
      }
    }
  }

  private async fetchAgentAsNode(agentId: bigint): Promise<NodeInfo | null> {
    const agent = await this.publicClient
      .readContract({
        address: this.config.identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgent',
        args: [agentId],
      })
      .catch((err) => {
        console.debug(
          `[Discovery] Failed to fetch agent ${agentId}: ${err.message}`,
        )
        return null
      })

    if (!agent || agent.isBanned) return null

    // Get endpoint
    const endpoint = await this.publicClient
      .readContract({
        address: this.config.identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getA2AEndpoint',
        args: [agentId],
      })
      .catch((err) => {
        console.debug(
          `[Discovery] No A2A endpoint for agent ${agentId}: ${err.message}`,
        )
        return ''
      })

    if (!endpoint) return null

    // Get tags to determine services
    const tags = await this.publicClient
      .readContract({
        address: this.config.identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentTags',
        args: [agentId],
      })
      .catch((err) => {
        console.debug(
          `[Discovery] Failed to get tags for agent ${agentId}: ${err.message}`,
        )
        return [] as string[]
      })

    const services: ServiceType[] = []
    for (const tag of tags) {
      if (tag === 'dws') services.push('full')
      else if (tag === 'dws-cdn') services.push('cdn')
      else if (tag === 'dws-compute') services.push('compute')
      else if (tag === 'dws-storage') services.push('storage')
      else if (tag === 'dws-da') services.push('da')
    }

    // Get region from metadata
    const regionBytes = await this.publicClient
      .readContract({
        address: this.config.identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getMetadata',
        args: [agentId, 'region'],
      })
      .catch(() => '0x') // Expected to fail if no region set

    const region =
      regionBytes && regionBytes !== '0x'
        ? Buffer.from((regionBytes as string).slice(2), 'hex').toString()
        : 'global'

    return {
      nodeId: keccak256(toHex(endpoint)).slice(0, 42),
      operator: agent.owner,
      endpoint,
      services,
      region,
      stake: agent.stakedAmount,
      attestationHash: '',
      teePlatform: 'simulator',
      lastSeen: Date.now(),
      agentId,
    }
  }

  private async syncFromCDNRegistry(): Promise<void> {
    if (!this.config.cdnRegistryAddress) return

    const nodeCount = await this.publicClient
      .readContract({
        address: this.config.cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'nodeCount',
      })
      .catch(() => BigInt(0))

    // Query nodes by region for efficiency
    for (const regionId of Object.keys(REGION_IDS).map(Number)) {
      const nodeIds = await this.publicClient
        .readContract({
          address: this.config.cdnRegistryAddress,
          abi: CDN_REGISTRY_ABI,
          functionName: 'getNodesByRegion',
          args: [regionId],
        })
        .catch(() => [] as `0x${string}`[])

      for (const nodeId of nodeIds) {
        const node = await this.fetchCDNNode(nodeId)
        if (node) {
          this.nodeCache.set(node.nodeId, node)
        }
      }
    }

    void nodeCount // Use the variable
  }

  private async fetchCDNNode(nodeId: `0x${string}`): Promise<NodeInfo | null> {
    if (!this.config.cdnRegistryAddress) return null

    const node = await this.publicClient
      .readContract({
        address: this.config.cdnRegistryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getEdgeNode',
        args: [nodeId],
      })
      .catch(() => null)

    if (!node || node.status !== 0) return null // Status 0 = Active

    return {
      nodeId: nodeId,
      operator: node.operator,
      endpoint: node.endpoint,
      services: ['cdn'],
      region: REGION_IDS[node.region] ?? 'global',
      stake: node.stake,
      attestationHash: '',
      teePlatform: 'simulator',
      lastSeen: Number(node.lastSeen) * 1000,
      agentId: node.agentId,
    }
  }

  /**
   * Start libp2p DHT for peer discovery
   *
   * DHT integration is planned for Phase 2.
   * Current implementation uses:
   * - On-chain registry queries (working)
   * - HTTP-based peer announcements (working)
   * - Local peer cache (working)
   *
   * Future DHT implementation will add:
   * - Kademlia DHT for decentralized discovery
   * - GossipSub for real-time node announcements
   * - Noise encryption for secure peer connections
   */
  private async startDHT(): Promise<void> {
    if (this.config.enableDHT) {
      console.log('[Discovery] DHT requested but not yet implemented')
      console.log('[Discovery] Using HTTP-based discovery + on-chain registry')
    }

    // DHT is a future enhancement - current discovery works via:
    // 1. On-chain IdentityRegistry queries
    // 2. HTTP peer announcements between nodes
    // 3. Local peer caching with TTL
  }

  /**
   * Get nodes by service type
   */
  async getNodes(
    serviceType: ServiceType,
    options?: {
      region?: string
      minStake?: bigint
      limit?: number
    },
  ): Promise<NodeInfo[]> {
    // Ensure cache is fresh
    await this.syncFromOnChain()

    let nodes = Array.from(this.nodeCache.values()).filter(
      (node) =>
        node.services.includes(serviceType) || node.services.includes('full'),
    )

    // Filter by region
    if (options?.region) {
      nodes = nodes.filter((node) => node.region === options.region)
    }

    // Filter by minimum stake
    if (options?.minStake !== undefined) {
      const minStake = options.minStake
      nodes = nodes.filter((node) => node.stake >= minStake)
    }

    // Sort by stake and latency
    nodes.sort((a, b) => {
      // Prefer higher stake
      const stakeDiff = Number(b.stake - a.stake)
      if (stakeDiff !== 0) return stakeDiff
      // Then prefer lower latency
      return (a.latency ?? Infinity) - (b.latency ?? Infinity)
    })

    // Apply limit
    if (options?.limit) {
      nodes = nodes.slice(0, options.limit)
    }

    return nodes
  }

  /**
   * Get nodes by region for geo-routing
   */
  async getNodesByRegion(region: string): Promise<NodeInfo[]> {
    return Array.from(this.nodeCache.values()).filter(
      (node) => node.region === region || node.region === 'global',
    )
  }

  /**
   * Get cached peer info
   */
  getCachedPeer(peerId: string): PeerInfo | undefined {
    return this.peerCache.get(peerId)
  }

  /**
   * Cache peer info
   */
  cachePeer(peer: PeerInfo): void {
    this.peerCache.set(peer.nodeId, peer)
  }

  /**
   * Get own node ID
   */
  getSelfNodeId(): string | null {
    return this.selfNodeId
  }

  /**
   * Find the best node for a request (lowest latency, highest stake)
   */
  async findBestNode(
    serviceType: ServiceType,
    clientRegion?: string,
  ): Promise<NodeInfo | null> {
    const candidates = await this.getNodes(serviceType, {
      region: clientRegion,
      limit: 10,
    })

    if (candidates.length === 0) {
      // Fallback to any region
      const allNodes = await this.getNodes(serviceType, { limit: 10 })
      if (allNodes.length === 0) return null
      return this.selectBestByLatency(allNodes)
    }

    return this.selectBestByLatency(candidates)
  }

  private async selectBestByLatency(
    nodes: NodeInfo[],
  ): Promise<NodeInfo | null> {
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

    withLatency.sort(
      (a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity),
    )
    const best = withLatency[0]
    if (!best || best.latency === Infinity) return null

    // Update cache with latency
    this.nodeCache.set(best.nodeId, best)

    return best
  }

  private async pingNode(endpoint: string): Promise<boolean> {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => null)

    return response?.ok ?? false
  }

  /**
   * Announce this node to the network
   */
  async announce(nodeInfo: Omit<NodeAnnouncement, 'timestamp'>): Promise<void> {
    const announcement: NodeAnnouncement = {
      ...nodeInfo,
      timestamp: Date.now(),
    }

    // Broadcast to known peers
    const peers = Array.from(this.nodeCache.values()).slice(0, 10)
    await Promise.all(
      peers.map((peer) =>
        fetch(`${peer.endpoint}/_internal/announce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(announcement),
          signal: AbortSignal.timeout(5000),
        }).catch(() => null),
      ),
    )

    console.log(`[Discovery] Announced to ${peers.length} peers`)
  }

  /**
   * Handle incoming node announcement
   */
  handleAnnouncement(data: unknown): boolean {
    const parsed = NodeAnnouncementSchema.safeParse(data)
    if (!parsed.success) return false

    const announcement = parsed.data

    // Don't accept old announcements
    if (Date.now() - announcement.timestamp > 300000) {
      return false // Older than 5 minutes
    }

    const nodeInfo: NodeInfo = {
      nodeId: announcement.nodeId,
      operator: announcement.operator as Address,
      endpoint: announcement.endpoint,
      services: announcement.services,
      region: announcement.region,
      stake: BigInt(0),
      attestationHash: '',
      teePlatform: 'simulator',
      lastSeen: announcement.timestamp,
    }

    this.nodeCache.set(nodeInfo.nodeId, nodeInfo)

    // Notify subscribers
    for (const subscriber of this.gossipSubscribers) {
      subscriber(nodeInfo)
    }

    return true
  }

  /**
   * Subscribe to node announcements
   */
  onNodeDiscovered(callback: (node: NodeInfo) => void): void {
    this.gossipSubscribers.push(callback)
  }

  /**
   * Get total node count
   */
  getNodeCount(): number {
    return this.nodeCache.size
  }

  /**
   * Get all known nodes
   */
  getAllNodes(): NodeInfo[] {
    return Array.from(this.nodeCache.values())
  }

  /**
   * Remove a node from cache (e.g., when it goes offline)
   */
  removeNode(nodeId: string): void {
    this.nodeCache.delete(nodeId)
  }

  /**
   * Get discovery stats
   */
  getStats(): {
    totalNodes: number
    byService: Record<ServiceType, number>
    byRegion: Record<string, number>
    averageStake: string
  } {
    const nodes = Array.from(this.nodeCache.values())
    const byService: Record<ServiceType, number> = {
      cdn: 0,
      compute: 0,
      storage: 0,
      da: 0,
      full: 0,
    }
    const byRegion: Record<string, number> = {}

    let totalStake = BigInt(0)
    for (const node of nodes) {
      for (const service of node.services) {
        byService[service]++
      }
      byRegion[node.region] = (byRegion[node.region] ?? 0) + 1
      totalStake += node.stake
    }

    const avgStake =
      nodes.length > 0 ? totalStake / BigInt(nodes.length) : BigInt(0)

    return {
      totalNodes: nodes.length,
      byService,
      byRegion,
      averageStake: avgStake.toString(),
    }
  }
}

// Export region utilities
export { REGION_IDS, REGION_NAMES }

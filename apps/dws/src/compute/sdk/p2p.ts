/**
 * P2P Layer for Distributed Training
 *
 * Provides peer-to-peer communication for training nodes.
 * Uses HTTP-based gossip for development and can integrate with Iroh for production.
 *
 * Architecture:
 * - NodeDiscovery: Find peers via ERC-8004 IdentityRegistry
 * - GossipNetwork: Message broadcasting to peers
 * - BlobStore: Data sharing (datasets, gradients, checkpoints)
 *
 * In development: Uses HTTP endpoints registered in IdentityRegistry
 * In production: Can use Iroh for lower-latency gossip and blob transfer
 */

import type { Address, Chain, Hex } from 'viem'
import { createPublicClient, http, keccak256, toBytes } from 'viem'

// ============================================================================
// Chain Inference
// ============================================================================

function inferChainFromRpcUrl(rpcUrl: string): Chain {
  if (
    rpcUrl.includes('localhost') ||
    rpcUrl.includes('127.0.0.1') ||
    rpcUrl.includes(':9545') ||
    rpcUrl.includes(':8545')
  ) {
    return {
      id: 1337,
      name: 'Local Network',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }
  }
  if (rpcUrl.includes('testnet')) {
    return {
      id: 420691,
      name: 'Network Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }
  }
  return {
    id: 42069,
    name: 'Network',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }
}

// ============================================================================
// Types
// ============================================================================

export interface P2PConfig {
  rpcUrl: string
  identityRegistryAddress: Address
  selfEndpoint: string
  selfAgentId?: bigint
}

export interface PeerNode {
  agentId: bigint
  endpoint: string
  publicKey: Hex
  lastSeen: number
  latency: number
  capabilities: string[]
}

export interface GossipMessage {
  type: 'witness' | 'gradient' | 'checkpoint' | 'heartbeat' | 'round_data'
  runId: Hex
  sender: Address
  timestamp: number
  payload: Uint8Array
  signature: Hex
}

export interface BlobReference {
  hash: Hex
  size: number
  providers: string[]
}

// ============================================================================
// Identity Registry ABI (ERC-8004)
// ============================================================================

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
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
] as const

// ============================================================================
// Peer Discovery
// ============================================================================

export class PeerDiscovery {
  private publicClient: ReturnType<typeof createPublicClient>
  private registryAddress: Address
  private peerCache: Map<string, PeerNode> = new Map()
  private cacheExpiry = 30000 // 30 seconds
  private lastRefresh = 0

  constructor(rpcUrl: string, registryAddress: Address) {
    const chain = inferChainFromRpcUrl(rpcUrl)
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    this.registryAddress = registryAddress
  }

  private async read<T>(
    functionName: string,
    args: readonly (string | bigint)[] = [],
  ): Promise<T> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI as never,
      functionName,
      args,
    } as never) as Promise<T>
  }

  async discoverTrainingNodes(): Promise<PeerNode[]> {
    const now = Date.now()
    if (now - this.lastRefresh < this.cacheExpiry && this.peerCache.size > 0) {
      return Array.from(this.peerCache.values())
    }

    // Find all agents tagged as training nodes
    const agentIds = await this.read<bigint[]>('getAgentsByTag', [
      'dws-training',
    ])

    const peers: PeerNode[] = []
    for (const agentId of agentIds) {
      const peer = await this.getPeerInfo(agentId)
      if (peer) {
        peers.push(peer)
        this.peerCache.set(agentId.toString(), peer)
      }
    }

    this.lastRefresh = now
    return peers
  }

  async getPeerInfo(agentId: bigint): Promise<PeerNode | null> {
    const cached = this.peerCache.get(agentId.toString())
    if (cached && Date.now() - cached.lastSeen < this.cacheExpiry) {
      return cached
    }

    const agent = await this.read<{
      agentId: bigint
      owner: Address
      isBanned: boolean
    }>('getAgent', [agentId])

    if (agent.isBanned) return null

    const endpoint = await this.read<string>('getA2AEndpoint', [agentId])

    if (!endpoint) return null

    // Get public key from metadata
    const pubKeyBytes = await this.read<Hex>('getMetadata', [
      agentId,
      'p2pPublicKey',
    ])

    const publicKey = pubKeyBytes || ('0x' as Hex)

    // Ping to measure latency
    const start = Date.now()
    const healthy = await this.pingPeer(endpoint)
    const latency = healthy ? Date.now() - start : Infinity

    if (!healthy) return null

    return {
      agentId,
      endpoint,
      publicKey,
      lastSeen: Date.now(),
      latency,
      capabilities: ['training', 'witness'],
    }
  }

  private async pingPeer(endpoint: string): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${endpoint}/health`, {
      signal: controller.signal,
    })
      .catch(() => null)
      .finally(() => clearTimeout(timeout))

    return response?.ok ?? false
  }

  async findFastestPeers(count: number): Promise<PeerNode[]> {
    const peers = await this.discoverTrainingNodes()
    return peers.sort((a, b) => a.latency - b.latency).slice(0, count)
  }
}

// ============================================================================
// Gossip Network
// ============================================================================

export class GossipNetwork {
  private discovery: PeerDiscovery
  private selfEndpoint: string
  private messageHandlers: Map<string, (msg: GossipMessage) => Promise<void>> =
    new Map()
  private seenMessages: Set<string> = new Set()
  private maxSeenMessages = 10000
  private fanout = 8 // Number of peers to gossip to

  constructor(discovery: PeerDiscovery, selfEndpoint: string) {
    this.discovery = discovery
    this.selfEndpoint = selfEndpoint
  }

  onMessage(
    type: GossipMessage['type'],
    handler: (msg: GossipMessage) => Promise<void>,
  ): void {
    this.messageHandlers.set(type, handler)
  }

  async broadcast(message: Omit<GossipMessage, 'timestamp'>): Promise<void> {
    const fullMessage: GossipMessage = {
      ...message,
      timestamp: Date.now(),
    }

    const messageId = this.getMessageId(fullMessage)
    if (this.seenMessages.has(messageId)) return

    this.seenMessages.add(messageId)
    this.pruneSeenMessages()

    // Get fastest peers to gossip to
    const peers = await this.discovery.findFastestPeers(this.fanout)

    await Promise.all(
      peers.map(async (peer) => {
        if (peer.endpoint === this.selfEndpoint) return

        await fetch(`${peer.endpoint}/training/gossip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: fullMessage.type,
            runId: fullMessage.runId,
            sender: fullMessage.sender,
            timestamp: fullMessage.timestamp,
            payload: Buffer.from(fullMessage.payload).toString('base64'),
            signature: fullMessage.signature,
          }),
        }).catch((err) => {
          console.warn(
            `[P2P] Failed to gossip to ${peer.endpoint}: ${err.message}`,
          )
        })
      }),
    )
  }

  async handleIncoming(raw: {
    type: string
    runId: Hex
    sender: Address
    timestamp: number
    payload: string
    signature: Hex
  }): Promise<void> {
    const message: GossipMessage = {
      type: raw.type as GossipMessage['type'],
      runId: raw.runId,
      sender: raw.sender,
      timestamp: raw.timestamp,
      payload: new Uint8Array(Buffer.from(raw.payload, 'base64')),
      signature: raw.signature,
    }

    const messageId = this.getMessageId(message)
    if (this.seenMessages.has(messageId)) return

    this.seenMessages.add(messageId)
    this.pruneSeenMessages()

    // Handle locally
    const handler = this.messageHandlers.get(message.type)
    if (handler) {
      await handler(message)
    }

    // Re-broadcast to other peers
    const peers = await this.discovery.findFastestPeers(this.fanout / 2)
    await Promise.all(
      peers.map(async (peer) => {
        if (peer.endpoint === this.selfEndpoint) return

        await fetch(`${peer.endpoint}/training/gossip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(raw),
        }).catch((err) => {
          console.warn(
            `[P2P] Failed to re-broadcast to ${peer.endpoint}: ${err.message}`,
          )
        })
      }),
    )
  }

  private getMessageId(msg: GossipMessage): string {
    return keccak256(
      toBytes(`${msg.runId}:${msg.sender}:${msg.timestamp}:${msg.type}`),
    ).slice(2, 18)
  }

  private pruneSeenMessages(): void {
    if (this.seenMessages.size > this.maxSeenMessages) {
      const toDelete = this.seenMessages.size - this.maxSeenMessages / 2
      const iterator = this.seenMessages.values()
      for (let i = 0; i < toDelete; i++) {
        const value = iterator.next().value
        if (value) this.seenMessages.delete(value)
      }
    }
  }
}

// ============================================================================
// Blob Store (Data Sharing)
// ============================================================================

export class BlobStore {
  private discovery: PeerDiscovery
  private selfEndpoint: string
  private localBlobs: Map<string, Uint8Array> = new Map()
  private maxLocalSize = 1024 * 1024 * 1024 // 1GB
  private currentSize = 0

  constructor(discovery: PeerDiscovery, selfEndpoint: string) {
    this.discovery = discovery
    this.selfEndpoint = selfEndpoint
  }

  async store(data: Uint8Array): Promise<BlobReference> {
    const hash = keccak256(data) as Hex

    // Store locally
    this.evictIfNeeded(data.length)
    this.localBlobs.set(hash, data)
    this.currentSize += data.length

    return {
      hash,
      size: data.length,
      providers: [this.selfEndpoint],
    }
  }

  async fetch(ref: BlobReference): Promise<Uint8Array> {
    // Check local cache
    const local = this.localBlobs.get(ref.hash)
    if (local) return local

    // Try known providers
    for (const provider of ref.providers) {
      const data = await this.fetchFromPeer(provider, ref.hash)
      if (data) {
        // Cache locally
        this.evictIfNeeded(data.length)
        this.localBlobs.set(ref.hash, data)
        this.currentSize += data.length
        return data
      }
    }

    // Try all known peers
    const peers = await this.discovery.discoverTrainingNodes()
    for (const peer of peers) {
      const data = await this.fetchFromPeer(peer.endpoint, ref.hash)
      if (data) {
        this.evictIfNeeded(data.length)
        this.localBlobs.set(ref.hash, data)
        this.currentSize += data.length
        return data
      }
    }

    throw new Error(`Blob not found: ${ref.hash}`)
  }

  private async fetchFromPeer(
    endpoint: string,
    hash: Hex,
  ): Promise<Uint8Array | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(`${endpoint}/training/blob/${hash}`, {
      signal: controller.signal,
    })
      .catch(() => null)
      .finally(() => clearTimeout(timeout))

    if (!response?.ok) return null

    return new Uint8Array(await response.arrayBuffer())
  }

  serveBlob(hash: Hex): Uint8Array | null {
    return this.localBlobs.get(hash) ?? null
  }

  private evictIfNeeded(newSize: number): void {
    while (
      this.currentSize + newSize > this.maxLocalSize &&
      this.localBlobs.size > 0
    ) {
      const oldest = this.localBlobs.keys().next().value
      if (!oldest) break

      const blob = this.localBlobs.get(oldest)
      if (blob) {
        this.currentSize -= blob.length
        this.localBlobs.delete(oldest)
      }
    }
  }

  getStats(): { blobCount: number; totalSize: number } {
    return {
      blobCount: this.localBlobs.size,
      totalSize: this.currentSize,
    }
  }
}

// ============================================================================
// P2P Training Network
// ============================================================================

export class P2PTrainingNetwork {
  private discovery: PeerDiscovery
  private gossip: GossipNetwork
  private blobs: BlobStore

  constructor(config: P2PConfig) {
    this.discovery = new PeerDiscovery(
      config.rpcUrl,
      config.identityRegistryAddress,
    )
    this.gossip = new GossipNetwork(this.discovery, config.selfEndpoint)
    this.blobs = new BlobStore(this.discovery, config.selfEndpoint)
  }

  async start(): Promise<void> {
    // Initial peer discovery
    const peers = await this.discovery.discoverTrainingNodes()
    console.log(`[P2P] Discovered ${peers.length} training nodes`)
  }

  async broadcastWitness(
    runId: Hex,
    sender: Address,
    witnessData: Uint8Array,
    signature: Hex,
  ): Promise<void> {
    await this.gossip.broadcast({
      type: 'witness',
      runId,
      sender,
      payload: witnessData,
      signature,
    })
  }

  async broadcastGradients(
    runId: Hex,
    sender: Address,
    gradients: Uint8Array,
    signature: Hex,
  ): Promise<BlobReference> {
    // Store blob first
    const ref = await this.blobs.store(gradients)

    // Broadcast reference
    await this.gossip.broadcast({
      type: 'gradient',
      runId,
      sender,
      payload: new TextEncoder().encode(JSON.stringify(ref)),
      signature,
    })

    return ref
  }

  async broadcastCheckpoint(
    runId: Hex,
    sender: Address,
    checkpoint: Uint8Array,
    signature: Hex,
  ): Promise<BlobReference> {
    const ref = await this.blobs.store(checkpoint)

    await this.gossip.broadcast({
      type: 'checkpoint',
      runId,
      sender,
      payload: new TextEncoder().encode(JSON.stringify(ref)),
      signature,
    })

    return ref
  }

  onWitness(
    handler: (runId: Hex, sender: Address, data: Uint8Array) => Promise<void>,
  ): void {
    this.gossip.onMessage('witness', async (msg) => {
      await handler(msg.runId, msg.sender, msg.payload)
    })
  }

  onGradients(
    handler: (runId: Hex, sender: Address, ref: BlobReference) => Promise<void>,
  ): void {
    this.gossip.onMessage('gradient', async (msg) => {
      const ref = JSON.parse(
        new TextDecoder().decode(msg.payload),
      ) as BlobReference
      await handler(msg.runId, msg.sender, ref)
    })
  }

  onCheckpoint(
    handler: (runId: Hex, sender: Address, ref: BlobReference) => Promise<void>,
  ): void {
    this.gossip.onMessage('checkpoint', async (msg) => {
      const ref = JSON.parse(
        new TextDecoder().decode(msg.payload),
      ) as BlobReference
      await handler(msg.runId, msg.sender, ref)
    })
  }

  async fetchBlob(ref: BlobReference): Promise<Uint8Array> {
    return this.blobs.fetch(ref)
  }

  serveBlob(hash: Hex): Uint8Array | null {
    return this.blobs.serveBlob(hash)
  }

  async handleGossip(raw: {
    type: string
    runId: Hex
    sender: Address
    timestamp: number
    payload: string
    signature: Hex
  }): Promise<void> {
    await this.gossip.handleIncoming(raw)
  }

  async getPeers(): Promise<PeerNode[]> {
    return this.discovery.discoverTrainingNodes()
  }

  getStats(): { peers: number; blobs: { count: number; size: number } } {
    const blobStats = this.blobs.getStats()
    return {
      peers: 0, // Will be populated on next discovery
      blobs: { count: blobStats.blobCount, size: blobStats.totalSize },
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createP2PNetwork(config: P2PConfig): P2PTrainingNetwork {
  return new P2PTrainingNetwork(config)
}

/**
 * Bootstrap Manager
 *
 * Manages bootstrap peers for initial network connectivity.
 * Supports multiple bootstrap sources:
 * - Hardcoded bootstrap peers
 * - DNS-based discovery
 * - On-chain registry
 * - IPFS peer exchange
 */

import type { Address } from 'viem'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

// ============================================================================
// Types
// ============================================================================

export interface BootstrapConfig {
  hardcodedPeers: string[]
  dnsSeeds: string[]
  registryAddress?: Address
  rpcUrl?: string
  maxBootstrapPeers: number
  refreshInterval: number
}

interface BootstrapPeer {
  multiaddr: string
  source: 'hardcoded' | 'dns' | 'registry' | 'exchange'
  lastSeen: number
  healthy: boolean
  latency: number
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BOOTSTRAP_PEERS = [
  '/dns4/boot1.jeju.network/tcp/4001/p2p/QmBootstrap1a',
  '/dns4/boot2.jeju.network/tcp/4001/p2p/QmBootstrap2b',
  '/dns4/boot3.jeju.network/tcp/4001/p2p/QmBootstrap3c',
  '/dns4/boot-us.jeju.network/tcp/4001/p2p/QmBootstrapUS',
  '/dns4/boot-eu.jeju.network/tcp/4001/p2p/QmBootstrapEU',
  '/dns4/boot-asia.jeju.network/tcp/4001/p2p/QmBootstrapASIA',
]

const DEFAULT_DNS_SEEDS = [
  '_dnsaddr.bootstrap.jeju.network',
  '_dnsaddr.peers.jeju.network',
]

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentsByType',
    type: 'function',
    inputs: [
      { name: 'agentType', type: 'bytes32' },
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'metadataURI', type: 'string' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

// ============================================================================
// Bootstrap Manager Implementation
// ============================================================================

export class BootstrapManager {
  private config: BootstrapConfig
  private peers: Map<string, BootstrapPeer> = new Map()
  private refreshInterval: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(config: Partial<BootstrapConfig>) {
    this.config = {
      hardcodedPeers: config.hardcodedPeers ?? DEFAULT_BOOTSTRAP_PEERS,
      dnsSeeds: config.dnsSeeds ?? DEFAULT_DNS_SEEDS,
      registryAddress: config.registryAddress,
      rpcUrl: config.rpcUrl,
      maxBootstrapPeers: config.maxBootstrapPeers ?? 50,
      refreshInterval: config.refreshInterval ?? 300000, // 5 minutes
    }

    // Initialize with hardcoded peers
    for (const addr of this.config.hardcodedPeers) {
      this.peers.set(addr, {
        multiaddr: addr,
        source: 'hardcoded',
        lastSeen: Date.now(),
        healthy: true,
        latency: 0,
      })
    }
  }

  /**
   * Start the bootstrap manager
   */
  async start(): Promise<void> {
    if (this.running) return

    console.log(`[Bootstrap] Starting manager...`)
    this.running = true

    // Initial discovery
    await this.refresh()

    // Start periodic refresh
    this.refreshInterval = setInterval(() => {
      this.refresh().catch(console.error)
    }, this.config.refreshInterval)

    console.log(`[Bootstrap] Manager started with ${this.peers.size} peers`)
  }

  /**
   * Stop the bootstrap manager
   */
  async stop(): Promise<void> {
    if (!this.running) return

    console.log(`[Bootstrap] Stopping manager...`)
    this.running = false

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }

    console.log(`[Bootstrap] Manager stopped`)
  }

  /**
   * Refresh bootstrap peers from all sources
   */
  async refresh(): Promise<void> {
    console.log(`[Bootstrap] Refreshing peers...`)

    await Promise.allSettled([
      this.discoverFromDns(),
      this.discoverFromRegistry(),
      this.healthCheck(),
    ])

    // Prune unhealthy peers (keep hardcoded)
    for (const [addr, peer] of this.peers) {
      if (!peer.healthy && peer.source !== 'hardcoded') {
        this.peers.delete(addr)
      }
    }

    // Prune if over limit
    if (this.peers.size > this.config.maxBootstrapPeers) {
      this.pruneExcess()
    }

    console.log(
      `[Bootstrap] Refresh complete, ${this.peers.size} peers available`,
    )
  }

  /**
   * Discover peers from DNS TXT records
   */
  private async discoverFromDns(): Promise<void> {
    for (const seed of this.config.dnsSeeds) {
      const peers = await this.resolveDnsAddr(seed)

      for (const addr of peers) {
        if (!this.peers.has(addr)) {
          this.peers.set(addr, {
            multiaddr: addr,
            source: 'dns',
            lastSeen: Date.now(),
            healthy: true,
            latency: 0,
          })
        }
      }
    }
  }

  /**
   * Resolve DNS multiaddr records
   */
  private async resolveDnsAddr(domain: string): Promise<string[]> {
    const results: string[] = []

    // DNS resolution via DOH (DNS over HTTPS) for cross-platform support
    const dohEndpoint = 'https://cloudflare-dns.com/dns-query'

    const response = await fetch(`${dohEndpoint}?name=${domain}&type=TXT`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (response?.ok) {
      const data = (await response.json()) as {
        Answer?: Array<{ data: string }>
      }

      for (const answer of data.Answer ?? []) {
        // Parse dnsaddr format
        const match = answer.data.match(/dnsaddr=([^\s"]+)/)
        if (match) {
          results.push(match[1])
        }
      }
    }

    return results
  }

  /**
   * Discover peers from on-chain registry
   */
  private async discoverFromRegistry(): Promise<void> {
    if (!this.config.registryAddress || !this.config.rpcUrl) {
      return
    }

    const client = createPublicClient({
      chain: mainnet,
      transport: http(this.config.rpcUrl),
    })

    const DWS_NODE_TYPE = `0x${Buffer.from('dws-node').toString('hex').padEnd(64, '0')}`

    const agents = await client
      .readContract({
        address: this.config.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentsByType',
        args: [DWS_NODE_TYPE as `0x${string}`, BigInt(0), BigInt(100)],
      })
      .catch(
        () =>
          [] as readonly {
            id: bigint
            owner: `0x${string}`
            metadataURI: string
            status: number
          }[],
      )

    for (const agent of agents) {
      // Active agents only
      if (agent.status !== 1) continue

      // Fetch metadata to get multiaddr
      const metadata = await this.fetchAgentMetadata(agent.metadataURI)
      if (metadata?.multiaddr) {
        const addr = metadata.multiaddr as string
        if (!this.peers.has(addr)) {
          this.peers.set(addr, {
            multiaddr: addr,
            source: 'registry',
            lastSeen: Date.now(),
            healthy: true,
            latency: 0,
          })
        }
      }
    }
  }

  /**
   * Fetch agent metadata from IPFS/HTTP
   */
  private async fetchAgentMetadata(
    uri: string,
  ): Promise<Record<string, unknown> | null> {
    let url = uri

    // Handle IPFS URIs
    if (uri.startsWith('ipfs://')) {
      const cid = uri.replace('ipfs://', '')
      url = `https://ipfs.io/ipfs/${cid}`
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (response?.ok) {
      return response.json() as Promise<Record<string, unknown>>
    }

    return null
  }

  /**
   * Health check all peers
   */
  private async healthCheck(): Promise<void> {
    const checks = Array.from(this.peers.entries()).map(
      async ([addr, peer]) => {
        const healthy = await this.pingPeer(addr)
        peer.healthy = healthy
        peer.lastSeen = healthy ? Date.now() : peer.lastSeen
      },
    )

    await Promise.allSettled(checks)
  }

  /**
   * Ping a peer to check health
   */
  private async pingPeer(multiaddr: string): Promise<boolean> {
    const httpAddr = this.multiAddrToHttp(multiaddr)
    if (!httpAddr) return false

    const start = Date.now()
    const response = await fetch(`${httpAddr}/p2p/ping`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (response?.ok) {
      const peer = this.peers.get(multiaddr)
      if (peer) {
        peer.latency = Date.now() - start
      }
      return true
    }

    return false
  }

  /**
   * Convert multiaddr to HTTP URL
   */
  private multiAddrToHttp(multiaddr: string): string | null {
    const dnsMatch = multiaddr.match(/\/dns4\/([^/]+)\/tcp\/(\d+)/)
    if (dnsMatch) {
      return `http://${dnsMatch[1]}:${dnsMatch[2]}`
    }

    const ipMatch = multiaddr.match(/\/ip4\/([^/]+)\/tcp\/(\d+)/)
    if (ipMatch) {
      return `http://${ipMatch[1]}:${ipMatch[2]}`
    }

    return null
  }

  /**
   * Prune excess peers (keep best by latency)
   */
  private pruneExcess(): void {
    const sorted = Array.from(this.peers.entries())
      .filter(([, p]) => p.source !== 'hardcoded')
      .sort((a, b) => {
        // Prefer healthy, then lower latency
        if (a[1].healthy !== b[1].healthy) {
          return a[1].healthy ? -1 : 1
        }
        return a[1].latency - b[1].latency
      })

    const toRemove = sorted.slice(
      this.config.maxBootstrapPeers - this.config.hardcodedPeers.length,
    )

    for (const [addr] of toRemove) {
      this.peers.delete(addr)
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get all bootstrap peers
   */
  getBootstrapPeers(): string[] {
    return Array.from(this.peers.entries())
      .filter(([, p]) => p.healthy)
      .sort((a, b) => a[1].latency - b[1].latency)
      .map(([addr]) => addr)
  }

  /**
   * Get bootstrap peers by region (extracted from DNS name)
   */
  getBootstrapPeersByRegion(region: string): string[] {
    const regionLower = region.toLowerCase()

    return Array.from(this.peers.entries())
      .filter(([addr, p]) => {
        if (!p.healthy) return false
        return addr.includes(regionLower) || addr.includes('global')
      })
      .map(([addr]) => addr)
  }

  /**
   * Add a peer from exchange
   */
  addExchangePeer(multiaddr: string): void {
    if (this.peers.has(multiaddr)) return

    this.peers.set(multiaddr, {
      multiaddr,
      source: 'exchange',
      lastSeen: Date.now(),
      healthy: true,
      latency: 0,
    })
  }

  /**
   * Get peer count
   */
  getPeerCount(): number {
    return this.peers.size
  }

  /**
   * Get healthy peer count
   */
  getHealthyPeerCount(): number {
    return Array.from(this.peers.values()).filter((p) => p.healthy).length
  }

  /**
   * Get peer stats
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {
      total: 0,
      healthy: 0,
      hardcoded: 0,
      dns: 0,
      registry: 0,
      exchange: 0,
    }

    for (const peer of this.peers.values()) {
      stats.total++
      if (peer.healthy) stats.healthy++
      stats[peer.source]++
    }

    return stats
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createBootstrapManager(
  config: Partial<BootstrapConfig>,
): BootstrapManager {
  return new BootstrapManager(config)
}

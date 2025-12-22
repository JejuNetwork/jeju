/**
 * Multi-RPC Failover with Latency Routing
 *
 * Manages multiple RPC endpoints per chain with:
 * - Health checks and latency tracking
 * - Automatic failover on errors
 * - Load balancing based on latency
 */

import { type Chain, createPublicClient, http, type PublicClient } from 'viem'
import { arbitrum, base, bsc, mainnet, optimism } from 'viem/chains'

interface RPCEndpoint {
  url: string
  latencyMs: number
  successRate: number
  lastCheck: number
  failures: number
  isHealthy: boolean
}

interface ChainRPCConfig {
  chain: Chain
  endpoints: RPCEndpoint[]
  activeIndex: number
  client: PublicClient
}

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  56: bsc,
}

const DEFAULT_ENDPOINTS: Record<number, string[]> = {
  1: [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
    'https://ethereum.publicnode.com',
  ],
  8453: [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://base.publicnode.com',
  ],
  42161: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.llamarpc.com',
    'https://arbitrum-one.publicnode.com',
  ],
  10: [
    'https://mainnet.optimism.io',
    'https://optimism.llamarpc.com',
    'https://optimism.publicnode.com',
  ],
  56: [
    'https://bsc-dataseed.binance.org',
    'https://bsc.llamarpc.com',
    'https://bsc.publicnode.com',
  ],
}

export class RPCManager {
  private configs: Map<number, ChainRPCConfig> = new Map()
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(customEndpoints?: Record<number, string[]>) {
    const endpoints = { ...DEFAULT_ENDPOINTS, ...customEndpoints }

    for (const [chainIdStr, urls] of Object.entries(endpoints)) {
      const chainId = Number(chainIdStr)
      const chain = CHAINS[chainId]
      if (!chain) continue

      const rpcEndpoints: RPCEndpoint[] = urls.map((url) => ({
        url,
        latencyMs: 1000,
        successRate: 1,
        lastCheck: 0,
        failures: 0,
        isHealthy: true,
      }))

      const client = createPublicClient({
        chain,
        transport: http(rpcEndpoints[0].url),
      })

      this.configs.set(chainId, {
        chain,
        endpoints: rpcEndpoints,
        activeIndex: 0,
        client,
      })
    }
  }

  async start(): Promise<void> {
    console.log('🔌 Starting RPC Manager with latency routing...')
    await this.checkAllEndpoints()
    this.healthCheckInterval = setInterval(
      () => this.checkAllEndpoints(),
      30000,
    )
    console.log(`✓ Managing ${this.configs.size} chains`)
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  getClient(chainId: number): PublicClient {
    const config = this.configs.get(chainId)
    if (!config) throw new Error(`No RPC config for chain ${chainId}`)
    return config.client
  }

  async call<T>(
    chainId: number,
    fn: (client: PublicClient) => Promise<T>,
  ): Promise<T> {
    const config = this.configs.get(chainId)
    if (!config) throw new Error(`No RPC config for chain ${chainId}`)

    const startTime = Date.now()

    for (let attempt = 0; attempt < config.endpoints.length; attempt++) {
      const endpoint = config.endpoints[config.activeIndex]

      try {
        const result = await fn(config.client)
        endpoint.latencyMs = (endpoint.latencyMs + (Date.now() - startTime)) / 2
        endpoint.successRate = Math.min(1, endpoint.successRate + 0.01)
        endpoint.failures = 0
        return result
      } catch (_error) {
        endpoint.failures++
        endpoint.successRate = Math.max(0, endpoint.successRate - 0.1)

        if (endpoint.failures >= 3) {
          endpoint.isHealthy = false
          this.switchToNextEndpoint(chainId)
        }
      }
    }

    throw new Error(`All RPC endpoints failed for chain ${chainId}`)
  }

  private switchToNextEndpoint(chainId: number): void {
    const config = this.configs.get(chainId)
    if (!config) return

    // Find healthiest endpoint with lowest latency
    const healthyEndpoints = config.endpoints
      .map((e, i) => ({ endpoint: e, index: i }))
      .filter((e) => e.endpoint.isHealthy)
      .sort((a, b) => a.endpoint.latencyMs - b.endpoint.latencyMs)

    if (healthyEndpoints.length === 0) {
      // Reset all endpoints if none healthy
      config.endpoints.forEach((e) => {
        e.isHealthy = true
        e.failures = 0
      })
      config.activeIndex = 0
    } else {
      config.activeIndex = healthyEndpoints[0].index
    }

    // Recreate client with new endpoint
    config.client = createPublicClient({
      chain: config.chain,
      transport: http(config.endpoints[config.activeIndex].url),
    })

    console.log(
      `Switched chain ${chainId} to ${config.endpoints[config.activeIndex].url}`,
    )
  }

  private async checkAllEndpoints(): Promise<void> {
    for (const [_chainId, config] of this.configs) {
      for (const endpoint of config.endpoints) {
        const startTime = Date.now()
        const client = createPublicClient({
          chain: config.chain,
          transport: http(endpoint.url),
        })

        try {
          await client.getBlockNumber()
          endpoint.latencyMs = Date.now() - startTime
          endpoint.isHealthy = true
          endpoint.lastCheck = Date.now()
        } catch {
          endpoint.isHealthy = false
        }
      }

      // Switch to best endpoint
      const best = config.endpoints
        .filter((e) => e.isHealthy)
        .sort((a, b) => a.latencyMs - b.latencyMs)[0]

      if (best && config.endpoints[config.activeIndex] !== best) {
        const bestIndex = config.endpoints.indexOf(best)
        config.activeIndex = bestIndex
        config.client = createPublicClient({
          chain: config.chain,
          transport: http(best.url),
        })
      }
    }
  }

  getStatus(): Record<
    number,
    { active: string; latency: number; healthy: number }
  > {
    const status: Record<
      number,
      { active: string; latency: number; healthy: number }
    > = {}

    for (const [chainId, config] of this.configs) {
      const active = config.endpoints[config.activeIndex]
      status[chainId] = {
        active: active.url,
        latency: active.latencyMs,
        healthy: config.endpoints.filter((e) => e.isHealthy).length,
      }
    }

    return status
  }
}

export function createRPCManager(
  endpoints?: Record<number, string[]>,
): RPCManager {
  return new RPCManager(endpoints)
}

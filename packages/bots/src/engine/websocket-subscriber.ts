/**
 * WebSocket Block Subscriber
 *
 * Low-latency block subscription using WebSocket connections.
 * Replaces HTTP polling for 50-100ms latency reduction.
 */

import { EventEmitter } from 'node:events'
import {
  type Block,
  type Chain,
  createPublicClient,
  http,
  type PublicClient,
  webSocket,
} from 'viem'
import { arbitrum, base, bsc, mainnet, optimism } from 'viem/chains'
import type WebSocket from 'ws'

// ============ Types ============

interface BlockSubscription {
  chainId: number
  client: PublicClient
  ws: WebSocket | null
  unsubscribe: (() => void) | null
  lastBlockNumber: bigint
  lastBlockTime: number
  reconnectAttempts: number
  isConnected: boolean
}

interface BlockEvent {
  chainId: number
  blockNumber: bigint
  timestamp: number
  baseFeePerGas: bigint | null
  gasUsed: bigint
  gasLimit: bigint
  hash: string
  parentHash: string
  latencyMs: number
}

interface SubscriberConfig {
  chains: number[]
  rpcUrls: Record<number, { http: string; ws?: string }>
  maxReconnectAttempts: number
  reconnectDelayMs: number
  onBlock: (event: BlockEvent) => void
  onError?: (chainId: number, error: Error) => void
  onReconnect?: (chainId: number, attempt: number) => void
}

// ============ Constants ============

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  56: bsc,
}

const DEFAULT_WS_URLS: Record<number, string> = {
  1: 'wss://eth-mainnet.g.alchemy.com/v2/demo',
  8453: 'wss://base-mainnet.g.alchemy.com/v2/demo',
  42161: 'wss://arb-mainnet.g.alchemy.com/v2/demo',
  10: 'wss://opt-mainnet.g.alchemy.com/v2/demo',
  56: 'wss://bsc-mainnet.nodereal.io/ws/v1/demo',
}

// ============ WebSocket Subscriber ============

export class WebSocketBlockSubscriber extends EventEmitter {
  private subscriptions: Map<number, BlockSubscription> = new Map()
  private config: SubscriberConfig
  private running = false

  constructor(config: SubscriberConfig) {
    super()
    this.config = config
  }

  /**
   * Start all subscriptions
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    console.log('🔌 Starting WebSocket block subscriptions...')

    const startPromises = this.config.chains.map((chainId) =>
      this.startChain(chainId),
    )
    await Promise.all(startPromises)

    console.log(`✓ Subscribed to ${this.subscriptions.size} chains`)
  }

  /**
   * Stop all subscriptions
   */
  async stop(): Promise<void> {
    this.running = false

    for (const [chainId, sub] of this.subscriptions) {
      try {
        if (sub.unsubscribe) {
          sub.unsubscribe()
        }
        if (sub.ws) {
          sub.ws.close()
        }
      } catch (error) {
        console.warn(`Error stopping subscription for chain ${chainId}:`, error)
      }
    }

    this.subscriptions.clear()
    console.log('✓ All subscriptions stopped')
  }

  /**
   * Get subscription status
   */
  getStatus(): Record<
    number,
    { connected: boolean; lastBlock: bigint; latency: number }
  > {
    const status: Record<
      number,
      { connected: boolean; lastBlock: bigint; latency: number }
    > = {}

    for (const [chainId, sub] of this.subscriptions) {
      status[chainId] = {
        connected: sub.isConnected,
        lastBlock: sub.lastBlockNumber,
        latency: Date.now() - sub.lastBlockTime,
      }
    }

    return status
  }

  /**
   * Start subscription for a single chain
   */
  private async startChain(chainId: number): Promise<void> {
    const chain = CHAINS[chainId]
    if (!chain) {
      console.warn(`Unknown chain ${chainId}`)
      return
    }

    const urls = this.config.rpcUrls[chainId]
    const wsUrl = urls?.ws ?? DEFAULT_WS_URLS[chainId]
    const httpUrl = urls?.http ?? `https://rpc.ankr.com/eth`

    // Create client with WebSocket transport if available
    let client: PublicClient

    if (wsUrl) {
      try {
        client = createPublicClient({
          chain,
          transport: webSocket(wsUrl, {
            reconnect: true,
            retryCount: this.config.maxReconnectAttempts,
            retryDelay: this.config.reconnectDelayMs,
          }),
        })
      } catch {
        // Fall back to HTTP
        client = createPublicClient({
          chain,
          transport: http(httpUrl),
        })
      }
    } else {
      client = createPublicClient({
        chain,
        transport: http(httpUrl),
      })
    }

    const subscription: BlockSubscription = {
      chainId,
      client,
      ws: null,
      unsubscribe: null,
      lastBlockNumber: 0n,
      lastBlockTime: Date.now(),
      reconnectAttempts: 0,
      isConnected: false,
    }

    this.subscriptions.set(chainId, subscription)

    // Start watching blocks
    await this.watchBlocks(subscription)
  }

  /**
   * Watch blocks using subscription
   */
  private async watchBlocks(subscription: BlockSubscription): Promise<void> {
    const { chainId, client } = subscription

    try {
      // Use watchBlocks for WebSocket subscriptions
      const unwatch = client.watchBlocks({
        onBlock: (block: Block) => {
          const now = Date.now()
          const latencyMs =
            subscription.lastBlockTime > 0
              ? now - subscription.lastBlockTime
              : 0

          subscription.lastBlockNumber = block.number ?? 0n
          subscription.lastBlockTime = now
          subscription.isConnected = true
          subscription.reconnectAttempts = 0

          const event: BlockEvent = {
            chainId,
            blockNumber: block.number ?? 0n,
            timestamp: Number(block.timestamp) * 1000,
            baseFeePerGas: block.baseFeePerGas ?? null,
            gasUsed: block.gasUsed,
            gasLimit: block.gasLimit,
            hash: block.hash ?? '',
            parentHash: block.parentHash,
            latencyMs,
          }

          this.config.onBlock(event)
          this.emit('block', event)
        },
        onError: (error: Error) => {
          subscription.isConnected = false
          this.config.onError?.(chainId, error)
          this.emit('error', { chainId, error })

          // Attempt reconnection
          this.handleReconnect(subscription)
        },
      })

      subscription.unsubscribe = unwatch
      subscription.isConnected = true

      console.log(`  ✓ Chain ${chainId}: WebSocket connected`)
    } catch (_error) {
      console.warn(
        `  ✗ Chain ${chainId}: WebSocket failed, falling back to polling`,
      )

      // Fall back to polling
      this.startPolling(subscription)
    }
  }

  /**
   * Fallback to HTTP polling
   */
  private startPolling(subscription: BlockSubscription): void {
    const { chainId, client } = subscription
    const pollInterval = CHAINS[chainId]?.id === 42161 ? 250 : 2000 // Arbitrum is faster

    const poll = async () => {
      if (!this.running) return

      try {
        const block = await client.getBlock()
        const now = Date.now()

        if (block.number !== subscription.lastBlockNumber) {
          const latencyMs =
            subscription.lastBlockTime > 0
              ? now - subscription.lastBlockTime
              : pollInterval

          subscription.lastBlockNumber = block.number ?? 0n
          subscription.lastBlockTime = now
          subscription.isConnected = true

          const event: BlockEvent = {
            chainId,
            blockNumber: block.number ?? 0n,
            timestamp: Number(block.timestamp) * 1000,
            baseFeePerGas: block.baseFeePerGas ?? null,
            gasUsed: block.gasUsed,
            gasLimit: block.gasLimit,
            hash: block.hash ?? '',
            parentHash: block.parentHash,
            latencyMs,
          }

          this.config.onBlock(event)
          this.emit('block', event)
        }
      } catch (error) {
        subscription.isConnected = false
        this.config.onError?.(chainId, error as Error)
      }

      setTimeout(poll, pollInterval)
    }

    poll()
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(subscription: BlockSubscription): void {
    if (!this.running) return
    if (subscription.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(
        `Chain ${subscription.chainId}: Max reconnect attempts reached, falling back to polling`,
      )
      this.startPolling(subscription)
      return
    }

    subscription.reconnectAttempts++
    const delay =
      this.config.reconnectDelayMs * 2 ** (subscription.reconnectAttempts - 1)

    this.config.onReconnect?.(
      subscription.chainId,
      subscription.reconnectAttempts,
    )
    console.log(
      `Chain ${subscription.chainId}: Reconnecting in ${delay}ms (attempt ${subscription.reconnectAttempts})`,
    )

    setTimeout(() => {
      this.watchBlocks(subscription)
    }, delay)
  }
}

// ============ Factory Function ============

export function createBlockSubscriber(
  config: Partial<SubscriberConfig> & { onBlock: (event: BlockEvent) => void },
): WebSocketBlockSubscriber {
  return new WebSocketBlockSubscriber({
    chains: config.chains ?? [1, 8453, 42161, 10, 56],
    rpcUrls: config.rpcUrls ?? {},
    maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
    reconnectDelayMs: config.reconnectDelayMs ?? 1000,
    onBlock: config.onBlock,
    onError: config.onError,
    onReconnect: config.onReconnect,
  })
}

export type { BlockEvent, SubscriberConfig }

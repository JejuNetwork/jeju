/**
 * Mempool Streaming & Monitoring
 *
 * Real-time monitoring of pending transactions to:
 * 1. Detect sandwich opportunities (non-Jeju users)
 * 2. Protect Jeju transactions from MEV
 * 3. Frontrun profitable DEX swaps
 */

import { EventEmitter } from 'node:events'
import type { Address, Hash, Hex } from 'viem'

// Mempool data providers
export const MEMPOOL_PROVIDERS = {
  alchemy: {
    mainnet: 'wss://eth-mainnet.g.alchemy.com/v2/',
    arbitrum: 'wss://arb-mainnet.g.alchemy.com/v2/',
  },
  bloxroute: {
    mainnet: 'wss://virginia.eth.blxrbdn.com/ws',
    bsc: 'wss://virginia.bsc.blxrbdn.com/ws',
  },
  chainbound: {
    mainnet: 'wss://fiber.chainbound.io/api/v1',
  },
}

// Common DEX router addresses
export const DEX_ROUTERS: Record<number, Address[]> = {
  1: [
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
    '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
    '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B', // Uniswap Universal Router
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap SwapRouter02
    '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', // SushiSwap
    '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', // 0x Exchange
    '0x1111111254EEB25477B68fb85Ed929f73A960582', // 1inch V5
  ],
  42161: [
    '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
    '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap SwapRouter02
  ],
  8453: [
    '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3 SwapRouter02
    '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Aerodrome
  ],
}

// Swap function selectors
export const SWAP_SELECTORS = {
  // Uniswap V2
  swapExactTokensForTokens: '0x38ed1739',
  swapTokensForExactTokens: '0x8803dbee',
  swapExactETHForTokens: '0x7ff36ab5',
  swapTokensForExactETH: '0x4a25d94a',
  swapExactTokensForETH: '0x18cbafe5',
  swapETHForExactTokens: '0xfb3bdb41',

  // Uniswap V3
  exactInputSingle: '0x414bf389',
  exactInput: '0xc04b8d59',
  exactOutputSingle: '0xdb3e2198',
  exactOutput: '0xf28c0498',

  // Universal Router
  execute: '0x3593564c',

  // 1inch
  swap: '0x12aa3caf',
  uniswapV3Swap: '0xe449022e',
}

export interface PendingTx {
  hash: Hash
  from: Address
  to: Address
  data: Hex
  value: bigint
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  nonce: number
  chainId: number
  receivedAt: number
}

export interface SwapIntent {
  tx: PendingTx
  chainId: number
  router: Address
  selector: string
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  amountOutMin: bigint
  deadline: number
  path: Address[]
}

export interface MempoolConfig {
  chains: number[]
  alchemyApiKey?: string
  bloxrouteAuthHeader?: string
  chainboundApiKey?: string
  minSwapValueUsd?: number
  filterJejuTxs?: boolean
}

export class MempoolMonitor extends EventEmitter {
  private config: Required<MempoolConfig>
  private subscriptions: Map<number, WebSocket> = new Map()
  private pendingTxs: Map<Hash, PendingTx> = new Map()
  private processedHashes: Set<Hash> = new Set()
  private running = false

  // Jeju contract addresses (to filter out)
  private jejuContracts: Set<string> = new Set()

  constructor(config: MempoolConfig) {
    super()
    this.config = {
      alchemyApiKey: '',
      bloxrouteAuthHeader: '',
      chainboundApiKey: '',
      minSwapValueUsd: 1000,
      filterJejuTxs: true,
      ...config,
    }
  }

  /**
   * Add Jeju contract addresses to filter
   */
  addJejuContracts(addresses: Address[]): void {
    for (const addr of addresses) {
      this.jejuContracts.add(addr.toLowerCase())
    }
  }

  /**
   * Start monitoring mempool
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    console.log('Starting mempool monitor...')

    for (const chainId of this.config.chains) {
      await this.subscribeToChain(chainId)
    }

    // Cleanup old pending txs periodically
    setInterval(() => this.cleanupOldTxs(), 60000)
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.running = false

    for (const [chainId, ws] of this.subscriptions) {
      ws.close()
      console.log(`   Closed mempool subscription for chain ${chainId}`)
    }

    this.subscriptions.clear()
    this.pendingTxs.clear()
  }

  /**
   * Subscribe to pending transactions on a chain
   */
  private async subscribeToChain(chainId: number): Promise<void> {
    // Use Alchemy for mainnet and L2s
    if (this.config.alchemyApiKey && chainId === 1) {
      const wsUrl = `${MEMPOOL_PROVIDERS.alchemy.mainnet}${this.config.alchemyApiKey}`

      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log(`   Connected to Alchemy mempool (chain ${chainId})`)

        // Subscribe to pending transactions
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_subscribe',
            params: [
              'alchemy_pendingTransactions',
              {
                toAddress: DEX_ROUTERS[chainId] || [],
                hashesOnly: false,
              },
            ],
          }),
        )
      }

      ws.onmessage = (event) => {
        this.handlePendingTx(chainId, JSON.parse(event.data as string))
      }

      ws.onerror = (error) => {
        console.error(`Mempool WS error (chain ${chainId}):`, error)
      }

      ws.onclose = () => {
        console.log(`   Mempool connection closed (chain ${chainId})`)
        // Reconnect after delay
        if (this.running) {
          setTimeout(() => this.subscribeToChain(chainId), 5000)
        }
      }

      this.subscriptions.set(chainId, ws)
    }
  }

  /**
   * Handle incoming pending transaction
   */
  private handlePendingTx(
    chainId: number,
    message: {
      params?: {
        result?: {
          hash: string
          from: string
          to: string
          input: string
          value: string
          gasPrice?: string
          maxFeePerGas?: string
          maxPriorityFeePerGas?: string
          nonce: string
        }
      }
    },
  ): void {
    const tx = message.params?.result
    if (!tx) return

    // Skip if already processed
    if (this.processedHashes.has(tx.hash as Hash)) return
    this.processedHashes.add(tx.hash as Hash)

    // Filter out Jeju transactions
    if (this.config.filterJejuTxs) {
      if (this.jejuContracts.has(tx.to?.toLowerCase() || '')) {
        return
      }
      if (this.jejuContracts.has(tx.from?.toLowerCase() || '')) {
        return
      }
    }

    // Parse as swap if it's to a known DEX router
    const routers = DEX_ROUTERS[chainId] || []
    if (!routers.some((r) => r.toLowerCase() === tx.to?.toLowerCase())) {
      return
    }

    const pendingTx: PendingTx = {
      hash: tx.hash as Hash,
      from: tx.from as Address,
      to: tx.to as Address,
      data: tx.input as Hex,
      value: BigInt(tx.value || '0'),
      gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
      maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas
        ? BigInt(tx.maxPriorityFeePerGas)
        : undefined,
      nonce: parseInt(tx.nonce, 16),
      chainId,
      receivedAt: Date.now(),
    }

    this.pendingTxs.set(pendingTx.hash, pendingTx)

    // Parse swap and emit if valid
    const swapIntent = this.parseSwapIntent(pendingTx)
    if (swapIntent) {
      this.emit('swap', swapIntent)
    }
  }

  /**
   * Parse a pending transaction as a swap intent
   */
  private parseSwapIntent(tx: PendingTx): SwapIntent | null {
    const selector = tx.data.slice(0, 10)

    // Check if it's a known swap selector
    const isSwap = Object.values(SWAP_SELECTORS).includes(selector)
    if (!isSwap) return null

    // Decode based on selector
    // This is simplified - real implementation would use proper ABI decoding
    try {
      // For Uniswap V2 swapExactTokensForTokens
      if (selector === SWAP_SELECTORS.swapExactTokensForTokens) {
        const amountIn = BigInt(`0x${tx.data.slice(10, 74)}`)
        const amountOutMin = BigInt(`0x${tx.data.slice(74, 138)}`)

        // Path offset at position 3 (bytes 138-202)
        // Path length and addresses would need proper decoding

        return {
          tx,
          chainId: tx.chainId,
          router: tx.to,
          selector,
          tokenIn: '0x0000000000000000000000000000000000000000' as Address, // Would decode from path
          tokenOut: '0x0000000000000000000000000000000000000000' as Address,
          amountIn,
          amountOutMin,
          deadline: 0,
          path: [],
        }
      }

      // For Uniswap V3 exactInputSingle
      if (selector === SWAP_SELECTORS.exactInputSingle) {
        // Struct: tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96
        const tokenIn = `0x${tx.data.slice(34, 74)}` as Address
        const tokenOut = `0x${tx.data.slice(98, 138)}` as Address
        const amountIn = BigInt(`0x${tx.data.slice(202, 266)}`)
        const amountOutMin = BigInt(`0x${tx.data.slice(266, 330)}`)

        return {
          tx,
          chainId: tx.chainId,
          router: tx.to,
          selector,
          tokenIn,
          tokenOut,
          amountIn,
          amountOutMin,
          deadline: 0,
          path: [tokenIn, tokenOut],
        }
      }
    } catch {
      // Failed to parse, skip
      return null
    }

    return null
  }

  /**
   * Cleanup old pending transactions
   */
  private cleanupOldTxs(): void {
    const now = Date.now()
    const maxAge = 60000 // 1 minute

    for (const [hash, tx] of this.pendingTxs) {
      if (now - tx.receivedAt > maxAge) {
        this.pendingTxs.delete(hash)
      }
    }

    // Also cleanup processed hashes (keep last 10k)
    if (this.processedHashes.size > 10000) {
      const hashes = Array.from(this.processedHashes)
      this.processedHashes = new Set(hashes.slice(-5000))
    }
  }

  /**
   * Get pending transaction by hash
   */
  getPendingTx(hash: Hash): PendingTx | undefined {
    return this.pendingTxs.get(hash)
  }

  /**
   * Get all pending swap transactions
   */
  getPendingSwaps(): SwapIntent[] {
    const swaps: SwapIntent[] = []

    for (const tx of this.pendingTxs.values()) {
      const swap = this.parseSwapIntent(tx)
      if (swap) swaps.push(swap)
    }

    return swaps
  }

  /**
   * Get stats
   */
  getStats(): {
    pendingTxs: number
    processedHashes: number
    activeSubscriptions: number
  } {
    return {
      pendingTxs: this.pendingTxs.size,
      processedHashes: this.processedHashes.size,
      activeSubscriptions: this.subscriptions.size,
    }
  }
}

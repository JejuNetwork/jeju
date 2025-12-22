/**
 * Intent Solver (Cowswap, UniswapX)
 *
 * Solves user intents for profit by finding optimal execution paths.
 * Implements actual API integration with Cowswap and UniswapX.
 */

import { EventEmitter } from 'node:events'
import { type PublicClient, type Address, parseAbi, encodeFunctionData } from 'viem'

export interface IntentSolverConfig {
  chainId: number
  protocols: ('cowswap' | 'uniswapx')[]
  minProfitBps: number
  solverAddress: Address
  privateKey: string
}

interface CowswapOrder {
  uid: string
  sellToken: Address
  buyToken: Address
  sellAmount: string
  buyAmount: string
  validTo: number
  appData: string
  feeAmount: string
  kind: 'sell' | 'buy'
  partiallyFillable: boolean
  receiver: Address
  owner: Address
}

interface UniswapXOrder {
  orderHash: string
  chainId: number
  swapper: Address
  input: { token: Address; amount: string }
  outputs: Array<{ token: Address; amount: string; recipient: Address }>
  deadline: number
}

interface Intent {
  id: string
  protocol: 'cowswap' | 'uniswapx'
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minAmountOut: bigint
  deadline: bigint
  user: Address
  rawOrder: CowswapOrder | UniswapXOrder
}

interface Solution {
  intent: Intent
  path: Address[]
  amountOut: bigint
  profit: bigint
  gasEstimate: bigint
}

// API endpoints
const COWSWAP_API: Record<number, string> = {
  1: 'https://api.cow.fi/mainnet/api/v1',
  100: 'https://api.cow.fi/xdai/api/v1',
  42161: 'https://api.cow.fi/arbitrum_one/api/v1',
}

const UNISWAPX_API = 'https://api.uniswap.org/v2'

// ABIs for quoting
const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
])

export class IntentSolver extends EventEmitter {
  private config: IntentSolverConfig
  private client: PublicClient
  private running = false
  private pendingIntents: Map<string, Intent> = new Map()
  private solvedCount = 0
  private profitTotal = 0n

  constructor(config: IntentSolverConfig, client: PublicClient) {
    super()
    this.config = config
    this.client = client
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log(`🎯 Intent Solver: ${this.config.protocols.join(', ')} on chain ${this.config.chainId}`)
    this.pollIntents()
  }

  stop(): void {
    this.running = false
  }

  private async pollIntents(): Promise<void> {
    while (this.running) {
      for (const protocol of this.config.protocols) {
        const intents = await this.fetchIntents(protocol)

        for (const intent of intents) {
          // Skip if already processing
          if (this.pendingIntents.has(intent.id)) continue

          this.pendingIntents.set(intent.id, intent)

          const solution = await this.solve(intent)
          if (solution && solution.profit > 0n) {
            const profitBps = Number(solution.profit * 10000n / solution.intent.amountIn)
            if (profitBps >= this.config.minProfitBps) {
              await this.submitSolution(solution)
            }
          }

          this.pendingIntents.delete(intent.id)
        }
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  private async fetchIntents(protocol: 'cowswap' | 'uniswapx'): Promise<Intent[]> {
    if (protocol === 'cowswap') {
      return this.fetchCowswapOrders()
    } else {
      return this.fetchUniswapXOrders()
    }
  }

  private async fetchCowswapOrders(): Promise<Intent[]> {
    const apiUrl = COWSWAP_API[this.config.chainId]
    if (!apiUrl) return []

    try {
      // Fetch open orders from Cowswap API
      const response = await fetch(`${apiUrl}/orders?status=open&limit=50`)
      if (!response.ok) return []

      const orders = await response.json() as CowswapOrder[]

      return orders.map((order) => ({
        id: order.uid,
        protocol: 'cowswap' as const,
        tokenIn: order.sellToken as Address,
        tokenOut: order.buyToken as Address,
        amountIn: BigInt(order.sellAmount),
        minAmountOut: BigInt(order.buyAmount),
        deadline: BigInt(order.validTo),
        user: order.owner as Address,
        rawOrder: order,
      }))
    } catch (error) {
      console.warn('Failed to fetch Cowswap orders:', error)
      return []
    }
  }

  private async fetchUniswapXOrders(): Promise<Intent[]> {
    try {
      // UniswapX Dutch auction orders
      const response = await fetch(`${UNISWAPX_API}/orders?chainId=${this.config.chainId}&status=open&limit=50`, {
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) return []

      const data = await response.json() as { orders: UniswapXOrder[] }

      return data.orders.map((order) => ({
        id: order.orderHash,
        protocol: 'uniswapx' as const,
        tokenIn: order.input.token as Address,
        tokenOut: order.outputs[0]?.token as Address,
        amountIn: BigInt(order.input.amount),
        minAmountOut: BigInt(order.outputs[0]?.amount ?? '0'),
        deadline: BigInt(order.deadline),
        user: order.swapper as Address,
        rawOrder: order,
      }))
    } catch (error) {
      console.warn('Failed to fetch UniswapX orders:', error)
      return []
    }
  }

  private async solve(intent: Intent): Promise<Solution | null> {
    // Check if order is still valid
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (intent.deadline < now) return null

    // Get quote from multiple sources and find best execution
    const quotes = await this.getQuotes(intent)
    if (quotes.length === 0) return null

    // Find best quote that beats minAmountOut
    const bestQuote = quotes.reduce((best, q) => (q.amountOut > best.amountOut ? q : best))

    if (bestQuote.amountOut <= intent.minAmountOut) {
      return null // Can't beat user's minimum
    }

    // Calculate profit (difference between what we can get and what user wants)
    const profit = bestQuote.amountOut - intent.minAmountOut

    // Estimate gas cost
    const gasEstimate = 250000n // Typical solver execution

    return {
      intent,
      path: bestQuote.path,
      amountOut: bestQuote.amountOut,
      profit,
      gasEstimate,
    }
  }

  private async getQuotes(intent: Intent): Promise<Array<{ path: Address[]; amountOut: bigint }>> {
    const quotes: Array<{ path: Address[]; amountOut: bigint }> = []

    // Direct path
    const directQuote = await this.getDirectQuote(intent.tokenIn, intent.tokenOut, intent.amountIn)
    if (directQuote > 0n) {
      quotes.push({ path: [intent.tokenIn, intent.tokenOut], amountOut: directQuote })
    }

    // Common intermediaries (WETH, USDC)
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address

    for (const mid of [WETH, USDC]) {
      if (mid === intent.tokenIn || mid === intent.tokenOut) continue

      const hopQuote = await this.getMultiHopQuote(intent.tokenIn, mid, intent.tokenOut, intent.amountIn)
      if (hopQuote > 0n) {
        quotes.push({ path: [intent.tokenIn, mid, intent.tokenOut], amountOut: hopQuote })
      }
    }

    return quotes
  }

  private async getDirectQuote(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
    // Try multiple fee tiers
    const feeTiers = [500, 3000, 10000]
    const quoterV3 = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' as Address

    for (const fee of feeTiers) {
      try {
        const result = await this.client.simulateContract({
          address: quoterV3,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [tokenIn, tokenOut, fee, amountIn, 0n],
        })
        return result.result
      } catch {
        continue
      }
    }
    return 0n
  }

  private async getMultiHopQuote(
    tokenIn: Address,
    tokenMid: Address,
    tokenOut: Address,
    amountIn: bigint
  ): Promise<bigint> {
    // Get first hop quote
    const midAmount = await this.getDirectQuote(tokenIn, tokenMid, amountIn)
    if (midAmount === 0n) return 0n

    // Get second hop quote
    return this.getDirectQuote(tokenMid, tokenOut, midAmount)
  }

  private async submitSolution(solution: Solution): Promise<void> {
    console.log(`✓ Found solution for ${solution.intent.id}`)
    console.log(`  Profit: ${Number(solution.profit) / 1e18} tokens`)
    console.log(`  Path: ${solution.path.join(' -> ')}`)

    this.solvedCount++
    this.profitTotal += solution.profit
    this.emit('solved', solution)

    // In production, would submit to Cowswap/UniswapX solver network
    // This requires:
    // 1. Signing the solution with solver private key
    // 2. Submitting to the protocol's settlement contract
    // 3. Waiting for batch auction to settle
  }

  getStats(): { pending: number; solved: number; totalProfit: bigint } {
    return {
      pending: this.pendingIntents.size,
      solved: this.solvedCount,
      totalProfit: this.profitTotal,
    }
  }
}

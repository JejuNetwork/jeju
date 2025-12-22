/**
 * Backrun Strategy
 *
 * Captures arbitrage opportunities created by large swaps:
 * 1. Monitor for large trades that move prices
 * 2. Calculate arbitrage opportunity after price impact
 * 3. Submit backrun transaction in same block
 *
 * Lower risk than sandwich since we're not frontrunning.
 */

import { EventEmitter } from 'node:events'
import {
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
  parseAbi,
  encodeFunctionData,
} from 'viem'

export interface BackrunConfig {
  chainId: number
  minProfitUsd: number
  maxGasPrice: bigint
  targetDexes: Address[]
  arbContractAddress: Address
}

interface TradeEvent {
  pool: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  amountOut: bigint
  txHash: Hash
  blockNumber: bigint
}

interface BackrunOpportunity {
  sourcePool: Address
  targetPool: Address
  tokenIn: Address
  tokenMid: Address
  tokenOut: Address
  expectedProfit: bigint
  gasEstimate: bigint
}

const UNISWAP_V2_PAIR_ABI = parseAbi([
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])

const ARB_CONTRACT_ABI = parseAbi([
  'function executeArbitrage(address[] path, uint256 amountIn, uint256 minProfit) returns (uint256 profit)',
])

export class BackrunStrategy extends EventEmitter {
  private config: BackrunConfig
  private client: PublicClient
  private wallet: WalletClient
  private running = false
  private recentTrades: TradeEvent[] = []
  private lastBlockProcessed = 0n

  constructor(
    config: BackrunConfig,
    client: PublicClient,
    wallet: WalletClient
  ) {
    super()
    this.config = config
    this.client = client
    this.wallet = wallet
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log(`🔙 Backrun: monitoring ${this.config.targetDexes.length} DEXes`)

    // Watch for swap events
    this.watchSwaps()
  }

  stop(): void {
    this.running = false
  }

  private watchSwaps(): void {
    // Watch all target pools for swaps
    for (const pool of this.config.targetDexes) {
      this.client.watchContractEvent({
        address: pool,
        abi: UNISWAP_V2_PAIR_ABI,
        eventName: 'Swap',
        onLogs: (logs) => {
          for (const log of logs) {
            this.onSwap(pool, log)
          }
        },
      })
    }
  }

  private async onSwap(pool: Address, log: { args: Record<string, bigint | Address>; transactionHash: Hash; blockNumber: bigint }): Promise<void> {
    if (!this.running) return

    const { amount0In, amount1In, amount0Out, amount1Out } = log.args as {
      amount0In: bigint
      amount1In: bigint
      amount0Out: bigint
      amount1Out: bigint
    }

    // Get pool tokens
    const [token0, token1] = await Promise.all([
      this.client.readContract({ address: pool, abi: UNISWAP_V2_PAIR_ABI, functionName: 'token0' }),
      this.client.readContract({ address: pool, abi: UNISWAP_V2_PAIR_ABI, functionName: 'token1' }),
    ])

    const isToken0In = amount0In > 0n
    const tokenIn = isToken0In ? token0 : token1
    const tokenOut = isToken0In ? token1 : token0
    const amountIn = isToken0In ? amount0In : amount1In
    const amountOut = isToken0In ? amount1Out : amount0Out

    // Record trade
    const trade: TradeEvent = {
      pool,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    }

    this.recentTrades.push(trade)
    if (this.recentTrades.length > 100) {
      this.recentTrades.shift()
    }

    // Check for backrun opportunity
    const opportunity = await this.findOpportunity(trade)
    if (opportunity) {
      await this.execute(opportunity)
    }
  }

  private async findOpportunity(trade: TradeEvent): Promise<BackrunOpportunity | null> {
    // Find pools with the opposite token pair
    for (const targetPool of this.config.targetDexes) {
      if (targetPool === trade.pool) continue

      try {
        const [token0, token1, reserves] = await Promise.all([
          this.client.readContract({ address: targetPool, abi: UNISWAP_V2_PAIR_ABI, functionName: 'token0' }),
          this.client.readContract({ address: targetPool, abi: UNISWAP_V2_PAIR_ABI, functionName: 'token1' }),
          this.client.readContract({ address: targetPool, abi: UNISWAP_V2_PAIR_ABI, functionName: 'getReserves' }),
        ])

        // Check if this pool has the tokens we need
        if (
          (token0 === trade.tokenOut && token1 === trade.tokenIn) ||
          (token1 === trade.tokenOut && token0 === trade.tokenIn)
        ) {
          // Calculate potential profit
          const [reserve0, reserve1] = reserves
          const isForward = token0 === trade.tokenOut

          // Get source pool reserves
          const sourceReserves = await this.client.readContract({
            address: trade.pool,
            abi: UNISWAP_V2_PAIR_ABI,
            functionName: 'getReserves',
          })

          // Calculate price difference
          const sourcePrice = isForward
            ? Number(sourceReserves[0]) / Number(sourceReserves[1])
            : Number(sourceReserves[1]) / Number(sourceReserves[0])

          const targetPrice = isForward
            ? Number(reserve0) / Number(reserve1)
            : Number(reserve1) / Number(reserve0)

          const priceDiff = Math.abs(sourcePrice - targetPrice) / sourcePrice

          if (priceDiff > 0.001) { // 0.1% minimum spread
            // Estimate optimal trade size
            const optimalAmount = this.calculateOptimalAmount(
              sourceReserves[0],
              sourceReserves[1],
              reserve0,
              reserve1
            )

            const expectedProfit = optimalAmount * BigInt(Math.floor(priceDiff * 10000)) / 10000n

            if (Number(expectedProfit) / 1e18 * 3500 > this.config.minProfitUsd) {
              return {
                sourcePool: trade.pool,
                targetPool,
                tokenIn: trade.tokenIn,
                tokenMid: trade.tokenOut,
                tokenOut: trade.tokenIn,
                expectedProfit,
                gasEstimate: 300000n,
              }
            }
          }
        }
      } catch {
        // Pool might not exist or be incompatible
        continue
      }
    }

    return null
  }

  private calculateOptimalAmount(
    sourceR0: bigint,
    sourceR1: bigint,
    targetR0: bigint,
    targetR1: bigint
  ): bigint {
    // Simplified optimal amount calculation
    // In production, would use more sophisticated optimization
    const totalLiquidity = sourceR0 + targetR0
    return totalLiquidity / 1000n // 0.1% of liquidity
  }

  private async execute(opportunity: BackrunOpportunity): Promise<void> {
    const [account] = await this.wallet.getAddresses()

    const path = [opportunity.tokenIn, opportunity.tokenMid, opportunity.tokenOut]

    const callData = encodeFunctionData({
      abi: ARB_CONTRACT_ABI,
      functionName: 'executeArbitrage',
      args: [path, opportunity.expectedProfit / 10n, opportunity.expectedProfit / 2n],
    })

    console.log(`🔙 Backrun opportunity: ${Number(opportunity.expectedProfit) / 1e18} ETH profit`)

    this.emit('backrun-executed', {
      sourcePool: opportunity.sourcePool,
      targetPool: opportunity.targetPool,
      expectedProfit: opportunity.expectedProfit,
    })
  }

  getStats(): { recentTrades: number } {
    return {
      recentTrades: this.recentTrades.length,
    }
  }
}


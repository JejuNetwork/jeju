/**
 * JIT (Just-In-Time) Liquidity Strategy
 *
 * Provides concentrated liquidity exactly when large swaps occur:
 * 1. Monitor mempool for large pending swaps
 * 2. Add liquidity in tight range before swap executes
 * 3. Collect fees from the swap
 * 4. Remove liquidity immediately after
 *
 * Best on L2s where gas is cheap and blocks are fast.
 */

import { EventEmitter } from '@jejunetwork/shared'
import {
  type Address,
  encodeFunctionData,
  type Hash,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'

export interface JITConfig {
  chainId: number
  minSwapSizeUsd: number
  maxPositionSizeUsd: number
  minProfitBps: number
  poolFee: number // Uniswap V3 fee tier (500, 3000, 10000)
  tickSpacing: number
  gasLimit: bigint
}

interface PendingSwap {
  hash: Hash
  pool: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  estimatedAmountOut: bigint
  sender: Address
  gasPrice: bigint
}

interface JITPosition {
  tokenId: bigint
  liquidity: bigint
  tickLower: number
  tickUpper: number
  addedAt: number
}

const UNISWAP_V3_POOL_ABI = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
])

const NFT_POSITION_MANAGER_ABI = parseAbi([
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) returns (uint256 amount0, uint256 amount1)',
  'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)',
])

const _NFT_POSITION_MANAGER: Address =
  '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'

export class JITLiquidityStrategy extends EventEmitter {
  private config: JITConfig
  private client: PublicClient
  private wallet: WalletClient
  private running = false
  private positions: Map<Address, JITPosition> = new Map()
  private pendingSwaps: Map<Hash, PendingSwap> = new Map()

  constructor(config: JITConfig, client: PublicClient, wallet: WalletClient) {
    super()
    this.config = config
    this.client = client
    this.wallet = wallet
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log(
      `🎯 JIT Liquidity: monitoring for swaps > $${this.config.minSwapSizeUsd}`,
    )
  }

  stop(): void {
    this.running = false
  }

  /**
   * Called when a large swap is detected in mempool
   */
  async onPendingSwap(swap: PendingSwap): Promise<void> {
    if (!this.running) return

    // Calculate optimal JIT position
    const opportunity = await this.analyzeOpportunity(swap)
    if (!opportunity.profitable) {
      return
    }

    console.log(
      `JIT opportunity: ${opportunity.expectedProfitBps}bps on ${swap.hash}`,
    )

    // Execute JIT: add liquidity -> swap executes -> remove liquidity
    await this.executeJIT(swap, opportunity)
  }

  private async analyzeOpportunity(swap: PendingSwap): Promise<{
    profitable: boolean
    expectedProfitBps: number
    tickLower: number
    tickUpper: number
    liquidity: bigint
  }> {
    // Get current pool state
    const slot0 = await this.client.readContract({
      address: swap.pool,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'slot0',
    })

    const currentTick = slot0[1]

    // Calculate tick range around current price
    const tickSpacing = this.config.tickSpacing
    const tickLower =
      Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing
    const tickUpper =
      Math.ceil(currentTick / tickSpacing) * tickSpacing + tickSpacing

    // Estimate fee revenue from swap
    const swapSizeUsd = (Number(swap.amountIn) / 1e18) * 3500 // Simplified
    const feeRevenue = swapSizeUsd * (this.config.poolFee / 1e6)

    // Estimate gas cost
    const gasCostUsd =
      ((Number(swap.gasPrice) * Number(this.config.gasLimit)) / 1e18) * 3500

    // Calculate profit
    const expectedProfitBps =
      ((feeRevenue - gasCostUsd * 2) / swapSizeUsd) * 10000

    return {
      profitable: expectedProfitBps > this.config.minProfitBps,
      expectedProfitBps,
      tickLower,
      tickUpper,
      liquidity: swap.amountIn, // Simplified
    }
  }

  private async executeJIT(
    swap: PendingSwap,
    opportunity: { tickLower: number; tickUpper: number; liquidity: bigint },
  ): Promise<void> {
    const [account] = await this.wallet.getAddresses()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60)

    // 1. Add liquidity (must be included BEFORE the swap)
    const _mintData = encodeFunctionData({
      abi: NFT_POSITION_MANAGER_ABI,
      functionName: 'mint',
      args: [
        {
          token0: swap.tokenIn < swap.tokenOut ? swap.tokenIn : swap.tokenOut,
          token1: swap.tokenIn < swap.tokenOut ? swap.tokenOut : swap.tokenIn,
          fee: this.config.poolFee,
          tickLower: opportunity.tickLower,
          tickUpper: opportunity.tickUpper,
          amount0Desired: opportunity.liquidity,
          amount1Desired: opportunity.liquidity,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account,
          deadline,
        },
      ],
    })

    // Submit as bundle with higher priority than the swap
    // In production, would use Flashbots bundle

    this.emit('jit-executed', {
      swap: swap.hash,
      tickRange: [opportunity.tickLower, opportunity.tickUpper],
    })
  }

  getStats(): { positions: number; pendingSwaps: number } {
    return {
      positions: this.positions.size,
      pendingSwaps: this.pendingSwaps.size,
    }
  }
}

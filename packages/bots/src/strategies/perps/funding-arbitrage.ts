/**
 * Funding Rate Arbitrage Bot
 *
 * Delta-neutral strategy: captures funding payments by pairing
 * spot and perp positions in opposite directions.
 */

import type { EVMChainId } from '@jejunetwork/types'
import {
  type Address,
  formatUnits,
  type PublicClient,
  parseAbi,
  parseUnits,
  type WalletClient,
} from 'viem'
import type { OracleAggregator } from '../../oracles'
import { NonceManager, sleep } from '../../shared'

export interface FundingArbConfig {
  chainId: EVMChainId
  perpMarketAddress: Address
  spotDexAddress: Address
  markets: MarketConfig[]
  minFundingRate: number
  maxPositionSize: bigint
  targetLeverage: number
  minProfit: number
  gasLimit: bigint
  checkIntervalMs: number
}

interface MarketConfig {
  marketId: string
  symbol: string
  baseAsset: Address
  quoteAsset: Address
  spotPool: Address
}

type Direction = 'long_perp_short_spot' | 'short_perp_long_spot'

interface Position {
  perpPositionId: `0x${string}`
  perpSize: bigint
  spotSize: bigint
  direction: Direction
  entryFundingRate: number
}

interface Opportunity {
  marketId: string
  fundingRate: number
  expectedProfit: number
  direction: Direction
  size: bigint
}

// Contract ABIs
const PERP_MARKET_ABI = parseAbi([
  'function fundingData(bytes32 marketId) view returns (int256 fundingRate, int256 fundingIndex, uint256 lastFundingTime, uint256 nextFundingTime)',
  'function openPosition(bytes32 marketId, address marginToken, uint256 marginAmount, uint256 size, uint8 side, uint256 leverage) returns (bytes32 positionId, uint256 executionPrice, uint256 fee, int256 realizedPnl, int256 fundingPaid)',
  'function closePosition(bytes32 positionId) returns (bytes32 positionId, uint256 executionPrice, uint256 fee, int256 realizedPnl, int256 fundingPaid)',
])

const DEX_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
])

const PERP_FEE = 0.0005
const SPOT_FEE = 0.003
const MAX_SLIPPAGE_BPS = 100 // 1% max slippage protection

export class FundingArbitrageBot {
  private readonly config: FundingArbConfig
  private readonly oracle: OracleAggregator
  private readonly publicClient: PublicClient
  private readonly walletClient: WalletClient
  private readonly nonceManager: NonceManager
  private running = false
  private positions = new Map<string, Position>()

  constructor(
    config: FundingArbConfig,
    oracle: OracleAggregator,
    publicClient: PublicClient,
    walletClient: WalletClient,
  ) {
    this.config = config
    this.oracle = oracle
    this.publicClient = publicClient
    this.walletClient = walletClient

    // Initialize nonce manager for transaction ordering
    this.nonceManager = new NonceManager(async () => {
      const [address] = await walletClient.getAddresses()
      return BigInt(await publicClient.getTransactionCount({ address }))
    })
  }

  async start(): Promise<void> {
    this.running = true
    console.log(
      `Funding Arb Bot: monitoring ${this.config.markets.length} markets, min rate ${this.config.minFundingRate * 100}%`,
    )

    while (this.running) {
      await this.tick()
      await sleep(this.config.checkIntervalMs)
    }
  }

  stop(): void {
    this.running = false
  }

  private async tick(): Promise<void> {
    for (const market of this.config.markets) {
      const opp = await this.evaluate(market)
      if (opp) {
        console.log(
          `[${market.symbol}] Funding ${(opp.fundingRate * 100).toFixed(4)}%, profit ${(opp.expectedProfit * 100).toFixed(4)}%`,
        )
        await this.execute(opp, market)
      }
    }
    await this.managePositions()
  }

  private async evaluate(market: MarketConfig): Promise<Opportunity | null> {
    if (this.positions.has(market.marketId)) return null

    const fundingData = await this.getFundingRate(market.marketId)
    if (!fundingData) return null

    const { rate } = fundingData
    if (Math.abs(rate) < this.config.minFundingRate) return null

    const expectedProfit = Math.abs(rate) - (PERP_FEE + SPOT_FEE)
    if (expectedProfit < this.config.minProfit) return null

    const perpPrice = await this.getPrice(market.symbol.split('-')[0])
    return {
      marketId: market.marketId,
      fundingRate: rate,
      expectedProfit,
      direction: rate > 0 ? 'short_perp_long_spot' : 'long_perp_short_spot',
      size: this.calcSize(perpPrice),
    }
  }

  private async execute(opp: Opportunity, market: MarketConfig): Promise<void> {
    const isShortPerp = opp.direction === 'short_perp_long_spot'
    const perpSide = isShortPerp ? 1 : 0 // 0 = Long, 1 = Short

    console.log(
      `Opening ${opp.direction} in ${market.symbol}: ${formatUnits(opp.size, 18)}`,
    )

    const [account] = await this.walletClient.getAddresses()
    const marginAmount = opp.size / BigInt(this.config.targetLeverage)

    // Acquire nonce for perp transaction
    const { nonce: perpNonce, release: releasePerpNonce } =
      await this.nonceManager.acquire()

    // 1. Open perp position
    let perpTxHash: `0x${string}`
    try {
      perpTxHash = await this.walletClient.writeContract({
        account,
        chain: null,
        address: this.config.perpMarketAddress,
        abi: PERP_MARKET_ABI,
        functionName: 'openPosition',
        args: [
          market.marketId as `0x${string}`,
          market.quoteAsset,
          marginAmount,
          opp.size,
          perpSide,
          BigInt(this.config.targetLeverage),
        ],
        nonce: Number(perpNonce),
      })
    } catch (error) {
      releasePerpNonce(false)
      throw error
    }

    const perpReceipt = await this.publicClient.waitForTransactionReceipt({
      hash: perpTxHash,
    })
    releasePerpNonce(perpReceipt.status === 'success')

    if (perpReceipt.status !== 'success') {
      console.error(`Failed to open perp position for ${market.symbol}`)
      return
    }

    // Extract position ID from receipt logs
    const firstLog = perpReceipt.logs[0]
    if (!firstLog || !firstLog.topics[1]) {
      throw new Error(
        'Failed to extract position ID from perp transaction receipt',
      )
    }
    const perpPositionId = firstLog.topics[1] as `0x${string}`

    // 2. Execute spot trade (buy if short perp, sell if long perp)
    const spotPath = isShortPerp
      ? [market.quoteAsset, market.baseAsset] // Buy base with quote
      : [market.baseAsset, market.quoteAsset] // Sell base for quote

    // Calculate minimum output with slippage protection
    // Use the entry price to estimate expected output, then apply slippage tolerance
    const expectedOutput = opp.size // 1:1 for delta-neutral
    const minOutputWithSlippage =
      (expectedOutput * (10000n - BigInt(MAX_SLIPPAGE_BPS))) / 10000n

    // Acquire nonce for spot transaction
    const { nonce: spotNonce, release: releaseSpotNonce } =
      await this.nonceManager.acquire()

    let spotTxHash: `0x${string}`
    try {
      spotTxHash = await this.walletClient.writeContract({
        account,
        chain: null,
        address: this.config.spotDexAddress,
        abi: DEX_ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [
          opp.size,
          minOutputWithSlippage, // Slippage protection against MEV
          spotPath,
          account,
          BigInt(Math.floor(Date.now() / 1000) + 300), // 5 minute deadline (reduced from 1 hour)
        ],
        nonce: Number(spotNonce),
      })
    } catch (error) {
      releaseSpotNonce(false)
      // Close perp position on spot trade failure
      await this.closePerpPosition(perpPositionId)
      throw error
    }

    const spotReceipt = await this.publicClient.waitForTransactionReceipt({
      hash: spotTxHash,
    })
    releaseSpotNonce(spotReceipt.status === 'success')

    if (spotReceipt.status !== 'success') {
      console.error(
        `Failed to execute spot trade for ${market.symbol}, closing perp`,
      )
      await this.closePerpPosition(perpPositionId)
      return
    }

    // Track position
    this.positions.set(market.marketId, {
      perpPositionId,
      perpSize: opp.size,
      spotSize: opp.size,
      direction: opp.direction,
      entryFundingRate: opp.fundingRate,
    })

    console.log(
      `Opened funding arb: perp ${perpPositionId}, direction ${opp.direction}`,
    )
  }

  private async managePositions(): Promise<void> {
    for (const [marketId, pos] of this.positions) {
      const fundingData = await this.getFundingRate(marketId)
      if (!fundingData) continue

      const { rate } = fundingData
      const shouldExit =
        (pos.direction === 'short_perp_long_spot' &&
          rate < -this.config.minFundingRate) ||
        (pos.direction === 'long_perp_short_spot' &&
          rate > this.config.minFundingRate)

      if (shouldExit) {
        console.log(
          `Closing ${marketId}: funding reversed from ${pos.entryFundingRate} to ${rate}`,
        )
        await this.closePosition(marketId, pos)
      }
    }
  }

  private async closePosition(marketId: string, pos: Position): Promise<void> {
    const market = this.config.markets.find((m) => m.marketId === marketId)
    if (!market) return

    const [account] = await this.walletClient.getAddresses()

    // 1. Close perp position
    await this.closePerpPosition(pos.perpPositionId)

    // 2. Close spot position (reverse the trade)
    const spotPath =
      pos.direction === 'short_perp_long_spot'
        ? [market.baseAsset, market.quoteAsset] // Sell base we bought
        : [market.quoteAsset, market.baseAsset] // Buy back base we sold

    // Calculate minimum output with slippage protection
    const minOutputWithSlippage =
      (pos.spotSize * (10000n - BigInt(MAX_SLIPPAGE_BPS))) / 10000n

    await this.walletClient.writeContract({
      account,
      chain: null,
      address: this.config.spotDexAddress,
      abi: DEX_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        pos.spotSize,
        minOutputWithSlippage, // Slippage protection against MEV
        spotPath,
        account,
        BigInt(Math.floor(Date.now() / 1000) + 300), // 5 minute deadline (reduced from 1 hour)
      ],
    })

    this.positions.delete(marketId)
    console.log(`Closed funding arb position in ${marketId}`)
  }

  private async closePerpPosition(positionId: `0x${string}`): Promise<void> {
    const [account] = await this.walletClient.getAddresses()

    const txHash = await this.walletClient.writeContract({
      account,
      chain: null,
      address: this.config.perpMarketAddress,
      abi: PERP_MARKET_ABI,
      functionName: 'closePosition',
      args: [positionId],
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })
  }

  private async getFundingRate(
    marketId: string,
  ): Promise<{ rate: number; nextFundingTime: number } | null> {
    const result = await this.publicClient.readContract({
      address: this.config.perpMarketAddress,
      abi: PERP_MARKET_ABI,
      functionName: 'fundingData',
      args: [marketId as `0x${string}`],
    })

    const [fundingRate, , , nextFundingTime] = result

    // fundingRate is in 1e6 precision (0.01% = 10000)
    const rate = Number(fundingRate) / 1e8

    return {
      rate,
      nextFundingTime: Number(nextFundingTime) * 1000,
    }
  }

  private async getPrice(symbol: string): Promise<number> {
    const p = await this.oracle.getPrice(symbol, this.config.chainId)
    return Number(p.price) / 1e8
  }

  private calcSize(price: number): bigint {
    const maxUsd = Number(formatUnits(this.config.maxPositionSize, 18))
    return parseUnits(
      (maxUsd / price / this.config.targetLeverage).toString(),
      18,
    )
  }

  getStats(): {
    activePositions: number
    markets: string[]
    positions: { marketId: string; direction: Direction; size: string }[]
  } {
    return {
      activePositions: this.positions.size,
      markets: [...this.positions.keys()],
      positions: [...this.positions.entries()].map(([id, p]) => ({
        marketId: id,
        direction: p.direction,
        size: formatUnits(p.perpSize, 18),
      })),
    }
  }
}

/**
 * Liquidation Bot
 *
 * Monitors positions from indexer and executes profitable liquidations on-chain.
 */

import type { EVMChainId } from '@jejunetwork/types'
import { expectValid } from '@jejunetwork/types'
import {
  type Address,
  formatUnits,
  type PublicClient,
  parseAbi,
  parseUnits,
  type WalletClient,
} from 'viem'
import type { OracleAggregator } from '../../oracles'
import { IndexerPositionsResponseSchema } from '../../schemas'
import { sleep } from '../../shared'

export interface LiquidationBotConfig {
  chainId: EVMChainId
  perpMarketAddress: Address
  insuranceFundAddress: Address
  indexerUrl: string
  markets: string[]
  minProfitUsd: number
  maxGasPrice: bigint
  batchSize: number
  checkIntervalMs: number
  priorityFeeBps: number
}

interface Position {
  positionId: `0x${string}`
  trader: Address
  marketId: string
  side: 'long' | 'short'
  size: bigint
  margin: bigint
  entryPrice: bigint
  liquidationPrice: bigint
  lastUpdateTime: number
}

interface LiquidationOpp {
  position: Position
  reward: bigint
  gasCost: bigint
  profit: bigint
}

// Contract ABIs
const PERP_MARKET_ABI = parseAbi([
  'function liquidate(bytes32 positionId) returns (uint256 reward)',
  'function isLiquidatable(bytes32 positionId) view returns (bool canLiquidate, uint256 healthFactor)',
  'function positions(bytes32 positionId) view returns (bytes32 positionId, address trader, bytes32 marketId, uint8 side, uint8 marginType, uint256 size, uint256 margin, address marginToken, uint256 entryPrice, int256 entryFundingIndex, uint256 lastUpdateTime, bool isOpen)',
])

export class LiquidationBot {
  private readonly config: LiquidationBotConfig
  private readonly publicClient: PublicClient
  private readonly walletClient: WalletClient
  private running = false
  private positionCache = new Map<string, Position>()
  private stats = { executed: 0, rewards: 0n, failed: 0 }
  private lastIndexerSync = 0
  private readonly SYNC_INTERVAL = 60000 // Sync positions every minute

  constructor(
    config: LiquidationBotConfig,
    _oracle: OracleAggregator,
    publicClient: PublicClient,
    walletClient: WalletClient,
  ) {
    this.config = config
    this.publicClient = publicClient
    this.walletClient = walletClient
  }

  async start(): Promise<void> {
    this.running = true
    console.log(
      `Liquidation Bot: ${this.config.markets.length} markets, min profit $${this.config.minProfitUsd}`,
    )

    // Initial position sync
    await this.syncPositionsFromIndexer()

    while (this.running) {
      // Periodic sync
      if (Date.now() - this.lastIndexerSync > this.SYNC_INTERVAL) {
        await this.syncPositionsFromIndexer()
      }

      await this.tick()
      await sleep(this.config.checkIntervalMs)
    }
  }

  stop(): void {
    this.running = false
  }

  private async syncPositionsFromIndexer(): Promise<void> {
    const query = `
      query GetOpenPositions($markets: [String!]!, $limit: Int!) {
        positions(
          where: {
            marketId_in: $markets,
            isOpen_eq: true
          }
          limit: $limit
          orderBy: margin_ASC
        ) {
          positionId
          trader
          marketId
          side
          size
          margin
          entryPrice
          liquidationPrice
          lastUpdateTime
        }
      }
    `

    const response = await fetch(this.config.indexerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { markets: this.config.markets, limit: 1000 },
      }),
    })

    if (!response.ok) {
      throw new Error(`Indexer request failed: ${response.status}`)
    }

    const json = expectValid(
      IndexerPositionsResponseSchema,
      await response.json(),
      'indexer positions response',
    )

    if (json.errors && json.errors.length > 0) {
      throw new Error(`Indexer error: ${json.errors[0].message}`)
    }

    if (!json.data || !json.data.positions) {
      throw new Error('Indexer returned no position data')
    }

    // Update cache
    this.positionCache.clear()
    for (const p of json.data.positions) {
      this.positionCache.set(p.positionId, {
        positionId: p.positionId as `0x${string}`,
        trader: p.trader as Address,
        marketId: p.marketId,
        side: p.side === '0' ? 'long' : 'short', // '0' = long, '1' = short
        size: BigInt(p.size),
        margin: BigInt(p.margin),
        entryPrice: BigInt(p.entryPrice),
        liquidationPrice: BigInt(p.liquidationPrice),
        lastUpdateTime: p.lastUpdateTime,
      })
    }

    this.lastIndexerSync = Date.now()
  }

  private async tick(): Promise<void> {
    const opportunities: LiquidationOpp[] = []
    const positions = [...this.positionCache.values()]

    // Check positions in batches
    for (let i = 0; i < positions.length; i += this.config.batchSize) {
      const batch = positions.slice(i, i + this.config.batchSize)
      const results = await Promise.all(batch.map((p) => this.checkPosition(p)))
      opportunities.push(
        ...results.filter((o): o is LiquidationOpp => o !== null),
      )
    }

    // Sort by profit descending
    opportunities.sort((a, b) => Number(b.profit - a.profit))
    const minProfit = parseUnits(this.config.minProfitUsd.toString(), 18)

    // Execute profitable liquidations
    for (const opp of opportunities) {
      if (opp.profit > minProfit) {
        await this.liquidate(opp)
      }
    }
  }

  private async checkPosition(pos: Position): Promise<LiquidationOpp | null> {
    // First, check on-chain if position is liquidatable
    const [canLiquidate] = await this.publicClient.readContract({
      address: this.config.perpMarketAddress,
      abi: PERP_MARKET_ABI,
      functionName: 'isLiquidatable',
      args: [pos.positionId],
    })

    if (!canLiquidate) return null

    // Calculate expected reward (0.25% of notional)
    const notional = (pos.size * pos.entryPrice) / parseUnits('1', 18)
    const reward = (notional * 25n) / 10000n

    // Estimate gas cost
    const gasPrice = await this.publicClient.getGasPrice()
    const gasCost = 300000n * gasPrice // Estimated gas for liquidation
    const profit = reward - gasCost

    return profit > 0n ? { position: pos, reward, gasCost, profit } : null
  }

  private async liquidate(opp: LiquidationOpp): Promise<void> {
    const { position: pos, reward, profit } = opp
    console.log(
      `Liquidating ${pos.positionId.slice(0, 10)}... reward $${formatUnits(reward, 18)}, profit $${formatUnits(profit, 18)}`,
    )

    const gasPrice = await this.publicClient.getGasPrice()
    const priorityPrice =
      gasPrice + (gasPrice * BigInt(this.config.priorityFeeBps)) / 10000n

    if (priorityPrice > this.config.maxGasPrice) {
      console.log('  Skip: gas too high')
      return
    }

    const [account] = await this.walletClient.getAddresses()

    let estimatedGas: bigint
    try {
      estimatedGas = await this.publicClient.estimateGas({
        account,
        to: this.config.perpMarketAddress,
        data: '0x' as `0x${string}`,
      })
      estimatedGas = (estimatedGas * 130n) / 100n
    } catch {
      estimatedGas = 400000n
    }

    const gasLimit = estimatedGas < 600000n ? estimatedGas : 600000n

    const hash = await this.walletClient.writeContract({
      account,
      chain: null,
      address: this.config.perpMarketAddress,
      abi: PERP_MARKET_ABI,
      functionName: 'liquidate',
      args: [pos.positionId],
      gas: gasLimit,
      maxFeePerGas: priorityPrice,
      maxPriorityFeePerGas: priorityPrice - gasPrice,
    })

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      this.stats.executed++
      this.stats.rewards += reward
      this.positionCache.delete(pos.positionId)
      console.log(`  Success: tx ${hash}`)
    } else {
      this.stats.failed++
      console.log(`  Failed: tx ${hash}`)
    }
  }

  getStats(): {
    executed: number
    rewards: string
    failed: number
    monitored: number
    lastSync: string
  } {
    return {
      executed: this.stats.executed,
      rewards: formatUnits(this.stats.rewards, 18),
      failed: this.stats.failed,
      monitored: this.positionCache.size,
      lastSync: new Date(this.lastIndexerSync).toISOString(),
    }
  }
}

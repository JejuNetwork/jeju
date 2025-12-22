/**
 * Oracle Update Arbitrage (Chainlink)
 *
 * Captures arbitrage when oracle prices update:
 * 1. Monitor Chainlink oracle update transactions
 * 2. Predict new price from pending update
 * 3. Trade on DEXes before price catches up
 *
 * Works because DEX prices lag oracle updates by 1-2 blocks.
 */

import { EventEmitter } from 'node:events'
import {
  type Address,
  type Hash,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'

export interface OracleArbConfig {
  chainId: number
  minProfitBps: number
  maxGasPrice: bigint
  oracleAddresses: Address[]
  dexRouters: Address[]
  arbContract: Address
}

interface OracleUpdate {
  oracle: Address
  oldPrice: bigint
  newPrice: bigint
  txHash: Hash
  blockNumber: bigint
  asset: string
}

interface OracleArbOpportunity {
  oracle: Address
  asset: string
  priceDelta: number
  direction: 'long' | 'short'
  expectedProfitBps: number
  router: Address
  path: Address[]
}

const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function description() view returns (string)',
  'function decimals() view returns (uint8)',
])

// Major Chainlink price feeds
const _CHAINLINK_FEEDS: Record<number, Record<string, Address>> = {
  1: {
    'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
  },
  8453: {
    'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    'BTC/USD': '0x64c911996D3c6aC71E9b8d46c0f8DA0e0fB8Ea85',
  },
  42161: {
    'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    'BTC/USD': '0x6ce185860a4963106506C203335A2910F85C2C91',
  },
}

export class OracleArbStrategy extends EventEmitter {
  private config: OracleArbConfig
  private client: PublicClient
  private running = false
  private lastPrices: Map<Address, bigint> = new Map()
  private recentUpdates: OracleUpdate[] = []

  constructor(
    config: OracleArbConfig,
    client: PublicClient,
    _wallet: WalletClient,
  ) {
    super()
    this.config = config
    this.client = client
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    console.log(
      `📊 Oracle Arb: monitoring ${this.config.oracleAddresses.length} Chainlink feeds`,
    )

    // Initialize last prices
    await this.initializePrices()

    // Watch for oracle updates
    this.watchOracles()
  }

  stop(): void {
    this.running = false
  }

  private async initializePrices(): Promise<void> {
    for (const oracle of this.config.oracleAddresses) {
      try {
        const roundData = await this.client.readContract({
          address: oracle,
          abi: CHAINLINK_AGGREGATOR_ABI,
          functionName: 'latestRoundData',
        })

        this.lastPrices.set(oracle, roundData[1])
      } catch {
        console.warn(`Failed to initialize price for oracle ${oracle}`)
      }
    }
  }

  private watchOracles(): void {
    for (const oracle of this.config.oracleAddresses) {
      this.client.watchContractEvent({
        address: oracle,
        abi: CHAINLINK_AGGREGATOR_ABI,
        eventName: 'AnswerUpdated',
        onLogs: (logs) => {
          for (const log of logs) {
            this.onOracleUpdate(oracle, log)
          }
        },
      })
    }
  }

  private async onOracleUpdate(
    oracle: Address,
    log: {
      args: Record<string, bigint>
      transactionHash: Hash
      blockNumber: bigint
    },
  ): Promise<void> {
    if (!this.running) return

    const { current: newPrice } = log.args as { current: bigint }
    const oldPrice = this.lastPrices.get(oracle) ?? newPrice

    // Calculate price change
    const priceDelta = Number(newPrice - oldPrice) / Number(oldPrice)

    // Get asset name
    let asset = 'UNKNOWN'
    try {
      asset = await this.client.readContract({
        address: oracle,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'description',
      })
    } catch {
      // Ignore
    }

    const update: OracleUpdate = {
      oracle,
      oldPrice,
      newPrice,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      asset,
    }

    this.lastPrices.set(oracle, newPrice)
    this.recentUpdates.push(update)
    if (this.recentUpdates.length > 100) {
      this.recentUpdates.shift()
    }

    console.log(`📊 Oracle update: ${asset} ${(priceDelta * 100).toFixed(2)}%`)

    // Check if price move is significant enough
    if (Math.abs(priceDelta) < 0.001) return // 0.1% minimum

    // Find arbitrage opportunity
    const opportunity = await this.findOpportunity(update, priceDelta)
    if (opportunity) {
      await this.execute(opportunity)
    }
  }

  private async findOpportunity(
    update: OracleUpdate,
    priceDelta: number,
  ): Promise<OracleArbOpportunity | null> {
    // Determine direction
    const direction = priceDelta > 0 ? 'long' : 'short'

    // DEX prices typically lag oracle by 0.1-0.5%
    // If oracle moved 1%, DEX might still be at old price
    const expectedLag = Math.abs(priceDelta) * 0.3 // Assume 30% of move is capturable

    if (expectedLag * 10000 < this.config.minProfitBps) {
      return null
    }

    // Find best router (simplified - would check actual prices)
    const router = this.config.dexRouters[0]

    // Build path based on asset
    // In production, would map oracle to actual tokens
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    const path = direction === 'long' ? [USDC, WETH] : [WETH, USDC]

    return {
      oracle: update.oracle,
      asset: update.asset,
      priceDelta,
      direction,
      expectedProfitBps: Math.floor(expectedLag * 10000),
      router,
      path: path as Address[],
    }
  }

  private async execute(opportunity: OracleArbOpportunity): Promise<void> {
    console.log(
      `📊 Oracle arb: ${opportunity.direction} ${opportunity.asset}, ${opportunity.expectedProfitBps}bps expected`,
    )

    // In production, would execute the trade
    // Would need to be fast - within same block as oracle update

    this.emit('oracle-arb-executed', opportunity)
  }

  getStats(): { recentUpdates: number; trackedOracles: number } {
    return {
      recentUpdates: this.recentUpdates.length,
      trackedOracles: this.config.oracleAddresses.length,
    }
  }
}

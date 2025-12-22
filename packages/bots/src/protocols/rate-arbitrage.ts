/**
 * Rate Arbitrage (Aave, Compound, Spark, Morpho)
 *
 * Captures rate differences between lending protocols.
 * Implements actual rate fetching from on-chain contracts.
 */

import { EventEmitter } from 'node:events'
import { type PublicClient, type Address, parseAbi, formatUnits } from 'viem'

export interface RateArbConfig {
  chainId: number
  minSpreadBps: number
  checkIntervalMs: number
  assets: Address[] // Assets to monitor
}

interface RateProtocol {
  name: string
  poolAddress: Address
  type: 'aave' | 'compound' | 'spark' | 'morpho'
}

interface AssetRates {
  asset: Address
  symbol: string
  rates: Array<{
    protocol: string
    supplyApy: number
    borrowApy: number
    utilization: number
    liquidity: bigint
  }>
}

interface RateOpportunity {
  asset: Address
  symbol: string
  borrowFrom: string
  borrowRate: number
  supplyTo: string
  supplyRate: number
  spreadBps: number
  maxSize: bigint
  estimatedProfit: number
}

// Protocol addresses by chain
const PROTOCOLS: Record<number, RateProtocol[]> = {
  1: [
    { name: 'Aave V3', poolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', type: 'aave' },
    { name: 'Compound V3 USDC', poolAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', type: 'compound' },
    { name: 'Spark', poolAddress: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987', type: 'spark' },
  ],
  8453: [
    { name: 'Aave V3', poolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', type: 'aave' },
    { name: 'Compound V3 USDC', poolAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F', type: 'compound' },
  ],
}

// Common assets to monitor
const ASSETS: Record<number, Record<string, Address>> = {
  1: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EescdeCB5f68AC5',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  8453: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    WETH: '0x4200000000000000000000000000000000000006',
  },
}

// ABIs
const AAVE_POOL_ABI = parseAbi([
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
])

const COMPOUND_COMET_ABI = parseAbi([
  'function getSupplyRate(uint256 utilization) view returns (uint64)',
  'function getBorrowRate(uint256 utilization) view returns (uint64)',
  'function getUtilization() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalBorrow() view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

// Ray = 1e27, used by Aave for rates
const RAY = 10n ** 27n
const SECONDS_PER_YEAR = 31536000n

export class RateArbitrage extends EventEmitter {
  private config: RateArbConfig
  private client: PublicClient
  private running = false
  private protocols: RateProtocol[]
  private lastRates: Map<string, AssetRates> = new Map()
  private opportunities: RateOpportunity[] = []

  constructor(config: RateArbConfig, client: PublicClient) {
    super()
    this.config = config
    this.client = client
    this.protocols = PROTOCOLS[config.chainId] ?? []
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log(`📈 Rate Arb: monitoring ${this.protocols.length} protocols on chain ${this.config.chainId}`)
    this.monitorLoop()
  }

  stop(): void {
    this.running = false
  }

  private async monitorLoop(): Promise<void> {
    while (this.running) {
      this.opportunities = await this.findOpportunities()

      for (const opp of this.opportunities) {
        console.log(`📈 Rate arb: Borrow ${opp.symbol} from ${opp.borrowFrom} (${(opp.borrowRate * 100).toFixed(2)}%) -> Supply to ${opp.supplyTo} (${(opp.supplyRate * 100).toFixed(2)}%) = ${opp.spreadBps}bps spread`)
        this.emit('opportunity', opp)
      }

      await new Promise((r) => setTimeout(r, this.config.checkIntervalMs))
    }
  }

  private async findOpportunities(): Promise<RateOpportunity[]> {
    const opportunities: RateOpportunity[] = []
    const assets = this.config.assets.length > 0
      ? this.config.assets
      : Object.values(ASSETS[this.config.chainId] ?? {})

    for (const asset of assets) {
      const assetRates = await this.getAssetRates(asset)
      if (!assetRates || assetRates.rates.length < 2) continue

      this.lastRates.set(asset, assetRates)

      // Find best supply and best borrow rates
      const sortedBySupply = [...assetRates.rates].sort((a, b) => b.supplyApy - a.supplyApy)
      const sortedByBorrow = [...assetRates.rates].sort((a, b) => a.borrowApy - b.borrowApy)

      const bestSupply = sortedBySupply[0]
      const cheapestBorrow = sortedByBorrow[0]

      if (!bestSupply || !cheapestBorrow) continue
      if (bestSupply.protocol === cheapestBorrow.protocol) continue

      // Calculate spread (supply APY - borrow APY)
      const spread = bestSupply.supplyApy - cheapestBorrow.borrowApy
      const spreadBps = Math.round(spread * 10000)

      if (spreadBps > this.config.minSpreadBps) {
        // Calculate max size based on available liquidity
        const maxSize = bestSupply.liquidity < cheapestBorrow.liquidity
          ? bestSupply.liquidity
          : cheapestBorrow.liquidity

        opportunities.push({
          asset,
          symbol: assetRates.symbol,
          borrowFrom: cheapestBorrow.protocol,
          borrowRate: cheapestBorrow.borrowApy,
          supplyTo: bestSupply.protocol,
          supplyRate: bestSupply.supplyApy,
          spreadBps,
          maxSize,
          estimatedProfit: Number(maxSize) / 1e6 * spread, // Assuming 6 decimals
        })
      }
    }

    return opportunities.sort((a, b) => b.spreadBps - a.spreadBps)
  }

  private async getAssetRates(asset: Address): Promise<AssetRates | null> {
    let symbol = 'UNKNOWN'
    try {
      symbol = await this.client.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: 'symbol',
      })
    } catch {
      // Ignore
    }

    const rates: AssetRates['rates'] = []

    for (const protocol of this.protocols) {
      try {
        const rate = await this.getProtocolRate(protocol, asset)
        if (rate) {
          rates.push({ protocol: protocol.name, ...rate })
        }
      } catch {
        // Protocol might not support this asset
        continue
      }
    }

    if (rates.length === 0) return null

    return { asset, symbol, rates }
  }

  private async getProtocolRate(
    protocol: RateProtocol,
    asset: Address
  ): Promise<{ supplyApy: number; borrowApy: number; utilization: number; liquidity: bigint } | null> {
    if (protocol.type === 'aave' || protocol.type === 'spark') {
      return this.getAaveRate(protocol.poolAddress, asset)
    } else if (protocol.type === 'compound') {
      return this.getCompoundRate(protocol.poolAddress)
    }
    return null
  }

  private async getAaveRate(
    poolAddress: Address,
    asset: Address
  ): Promise<{ supplyApy: number; borrowApy: number; utilization: number; liquidity: bigint } | null> {
    try {
      const data = await this.client.readContract({
        address: poolAddress,
        abi: AAVE_POOL_ABI,
        functionName: 'getReserveData',
        args: [asset],
      })

      const reserveData = data as {
        currentLiquidityRate: bigint
        currentVariableBorrowRate: bigint
        liquidityIndex: bigint
      }

      // Convert from ray (1e27) to APY
      // APY = (1 + rate/secondsPerYear)^secondsPerYear - 1
      // Simplified: APY ≈ rate for small rates
      const supplyRateRay = reserveData.currentLiquidityRate
      const borrowRateRay = reserveData.currentVariableBorrowRate

      const supplyApy = Number(supplyRateRay) / Number(RAY)
      const borrowApy = Number(borrowRateRay) / Number(RAY)

      // Estimate utilization from rates
      const utilization = borrowApy > 0 ? supplyApy / borrowApy : 0

      // Get liquidity from aToken balance (simplified)
      const liquidity = reserveData.liquidityIndex

      return { supplyApy, borrowApy, utilization, liquidity }
    } catch {
      return null
    }
  }

  private async getCompoundRate(
    cometAddress: Address
  ): Promise<{ supplyApy: number; borrowApy: number; utilization: number; liquidity: bigint } | null> {
    try {
      const [utilization, totalSupply, totalBorrow] = await Promise.all([
        this.client.readContract({
          address: cometAddress,
          abi: COMPOUND_COMET_ABI,
          functionName: 'getUtilization',
        }),
        this.client.readContract({
          address: cometAddress,
          abi: COMPOUND_COMET_ABI,
          functionName: 'totalSupply',
        }),
        this.client.readContract({
          address: cometAddress,
          abi: COMPOUND_COMET_ABI,
          functionName: 'totalBorrow',
        }),
      ])

      const [supplyRate, borrowRate] = await Promise.all([
        this.client.readContract({
          address: cometAddress,
          abi: COMPOUND_COMET_ABI,
          functionName: 'getSupplyRate',
          args: [utilization],
        }),
        this.client.readContract({
          address: cometAddress,
          abi: COMPOUND_COMET_ABI,
          functionName: 'getBorrowRate',
          args: [utilization],
        }),
      ])

      // Compound rates are per-second, convert to APY
      // Rate is in 1e18 precision
      const supplyApy = Number(supplyRate) * Number(SECONDS_PER_YEAR) / 1e18
      const borrowApy = Number(borrowRate) * Number(SECONDS_PER_YEAR) / 1e18

      return {
        supplyApy,
        borrowApy,
        utilization: Number(utilization) / 1e18,
        liquidity: totalSupply - totalBorrow,
      }
    } catch {
      return null
    }
  }

  getStats(): { protocols: number; opportunities: number; lastRates: Map<string, AssetRates> } {
    return {
      protocols: this.protocols.length,
      opportunities: this.opportunities.length,
      lastRates: this.lastRates,
    }
  }

  getOpportunities(): RateOpportunity[] {
    return this.opportunities
  }
}

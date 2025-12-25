/**
 * Morpho Protocol Integration
 *
 * Morpho Blue is a permissionless lending protocol with isolated markets.
 * Each market has: loan token, collateral token, oracle, IRM, LLTV
 *
 * Opportunities:
 * - Rate arbitrage between Morpho and Aave/Compound
 * - Liquidations with lower competition than Aave
 * - Supply/borrow optimization
 */

import { EventEmitter } from '@jejunetwork/shared'
import {
  type Address,
  type PublicClient,
  type WalletClient,
  parseAbi,
  formatUnits,
} from 'viem'

export interface MorphoConfig {
  chainId: number
  morphoBlue: Address
  markets: MorphoMarket[]
  minSupplyApy: number
  minBorrowSavings: number
  minLiquidationProfitUsd: number
  subgraphUrl: string
  ethPriceUsd: number
  checkIntervalMs: number
}

interface MorphoMarket {
  id: `0x${string}`
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
  loanTokenDecimals: number
  collateralTokenDecimals: number
}

interface MarketState {
  totalSupplyAssets: bigint
  totalSupplyShares: bigint
  totalBorrowAssets: bigint
  totalBorrowShares: bigint
  lastUpdate: bigint
  fee: bigint
}

interface Position {
  supplyShares: bigint
  borrowShares: bigint
  collateral: bigint
}

interface LiquidatablePosition {
  market: MorphoMarket
  borrower: Address
  borrowShares: bigint
  collateral: bigint
  debtValue: bigint
  collateralValue: bigint
  ltv: number
  seizable: bigint
  repayAmount: bigint
  profit: bigint
  profitUsd: number
}

const MORPHO_BLUE_ABI = parseAbi([
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function supply(bytes32 id, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)',
  'function borrow(bytes32 id, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)',
  'function repay(bytes32 id, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)',
  'function withdraw(bytes32 id, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)',
  'function liquidate(bytes32 id, address borrower, uint256 seizedAssets, uint256 repaidShares, bytes data) returns (uint256, uint256)',
])

const MORPHO_IRM_ABI = parseAbi([
  'function borrowRate(bytes32 id, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)',
])

const ORACLE_ABI = parseAbi([
  'function price() view returns (uint256)',
])

const AAVE_POOL_ABI = parseAbi([
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
])

// Subgraph query for Morpho Blue positions
const MORPHO_POSITIONS_QUERY = `
  query GetPositions($marketId: String!, $minBorrow: BigInt!) {
    positions(
      first: 100
      where: { 
        market: $marketId
        borrowShares_gt: $minBorrow
      }
      orderBy: borrowShares
      orderDirection: desc
    ) {
      id
      user
      supplyShares
      borrowShares
      collateral
    }
  }
`

// Aave V3 pool addresses
const AAVE_V3_POOL: Record<number, Address> = {
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
}

export class MorphoIntegration extends EventEmitter {
  private config: MorphoConfig
  private client: PublicClient
  private wallet: WalletClient
  private running = false
  private marketStates: Map<string, MarketState> = new Map()
  private watchedBorrowers: Map<string, Set<Address>> = new Map()
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private stats = { checks: 0, liquidations: 0, rateArbs: 0 }

  constructor(
    config: MorphoConfig,
    client: PublicClient,
    wallet: WalletClient,
  ) {
    super()
    this.config = config
    this.client = client
    this.wallet = wallet
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    console.log(`🔷 Morpho: monitoring ${this.config.markets.length} markets`)

    await this.updateMarketStates()

    // Start monitoring loop
    this.checkInterval = setInterval(
      () => this.checkAll(),
      this.config.checkIntervalMs
    )
  }

  stop(): void {
    this.running = false
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  private async checkAll(): Promise<void> {
    this.stats.checks++
    await this.updateMarketStates()

    // Check for liquidations
    const liquidations = await this.findLiquidations()
    for (const liq of liquidations) {
      this.emit('liquidation-opportunity', liq)
    }

    // Check for rate arbitrage
    const rateArbs = await this.findRateArbitrage()
    for (const arb of rateArbs) {
      this.emit('rate-arbitrage', arb)
    }
  }

  async getMarketState(marketId: `0x${string}`): Promise<MarketState> {
    const result = await this.client.readContract({
      address: this.config.morphoBlue,
      abi: MORPHO_BLUE_ABI,
      functionName: 'market',
      args: [marketId],
    })

    return {
      totalSupplyAssets: result[0],
      totalSupplyShares: result[1],
      totalBorrowAssets: result[2],
      totalBorrowShares: result[3],
      lastUpdate: result[4],
      fee: result[5],
    }
  }

  async getPosition(marketId: `0x${string}`, user: Address): Promise<Position> {
    const result = await this.client.readContract({
      address: this.config.morphoBlue,
      abi: MORPHO_BLUE_ABI,
      functionName: 'position',
      args: [marketId, user],
    })

    return {
      supplyShares: result[0],
      borrowShares: result[1],
      collateral: result[2],
    }
  }

  /**
   * Get borrow rate from IRM contract
   */
  async getBorrowRate(market: MorphoMarket): Promise<number> {
    const state = this.marketStates.get(market.id)
    if (!state) return 0

    try {
      const rate = await this.client.readContract({
        address: market.irm,
        abi: MORPHO_IRM_ABI,
        functionName: 'borrowRate',
        args: [
          market.id,
          {
            totalSupplyAssets: state.totalSupplyAssets as bigint & { readonly brand: unique symbol },
            totalSupplyShares: state.totalSupplyShares as bigint & { readonly brand: unique symbol },
            totalBorrowAssets: state.totalBorrowAssets as bigint & { readonly brand: unique symbol },
            totalBorrowShares: state.totalBorrowShares as bigint & { readonly brand: unique symbol },
            lastUpdate: state.lastUpdate as bigint & { readonly brand: unique symbol },
            fee: state.fee as bigint & { readonly brand: unique symbol },
          },
        ],
      })

      // Rate is per-second in 1e18, convert to APY
      const ratePerSecond = Number(rate) / 1e18
      const secondsPerYear = 365.25 * 24 * 3600
      return ratePerSecond * secondsPerYear
    } catch {
      // Fallback to utilization-based estimate
      return this.estimateBorrowRate(state)
    }
  }

  /**
   * Estimate borrow rate from utilization
   */
  private estimateBorrowRate(state: MarketState): number {
    if (state.totalSupplyAssets === 0n) return 0

    const utilization = Number(state.totalBorrowAssets) / Number(state.totalSupplyAssets)

    // Morpho Blue typically uses adaptive curve IRM
    // Base: 1%, target utilization: 90%, max: 100%
    if (utilization < 0.9) {
      return 0.01 + (0.03 * utilization / 0.9)
    } else {
      return 0.04 + (0.96 * (utilization - 0.9) / 0.1)
    }
  }

  /**
   * Calculate supply APY
   */
  calculateSupplyApy(market: MorphoMarket, state: MarketState): number {
    if (state.totalSupplyAssets === 0n) return 0

    const utilization = Number(state.totalBorrowAssets) / Number(state.totalSupplyAssets)
    const borrowRate = this.estimateBorrowRate(state)
    const fee = Number(state.fee) / 1e18

    return borrowRate * utilization * (1 - fee)
  }

  /**
   * Get oracle price for a market
   */
  async getOraclePrice(market: MorphoMarket): Promise<bigint> {
    try {
      return await this.client.readContract({
        address: market.oracle,
        abi: ORACLE_ABI,
        functionName: 'price',
      })
    } catch {
      return 0n
    }
  }

  /**
   * Find rate arbitrage opportunities between Morpho and Aave
   */
  async findRateArbitrage(): Promise<Array<{
    market: MorphoMarket
    morphoSupplyApy: number
    morphoBorrowApy: number
    aaveSupplyApy: number
    aaveBorrowApy: number
    supplySpread: number
    borrowSpread: number
  }>> {
    const opportunities = []
    const aavePool = AAVE_V3_POOL[this.config.chainId]

    for (const market of this.config.markets) {
      const state = this.marketStates.get(market.id)
      if (!state) continue

      const morphoSupplyApy = this.calculateSupplyApy(market, state)
      const morphoBorrowApy = await this.getBorrowRate(market)

      // Get Aave rates for the same asset
      let aaveSupplyApy = 0
      let aaveBorrowApy = 0

      if (aavePool) {
        try {
          const aaveData = await this.client.readContract({
            address: aavePool,
            abi: AAVE_POOL_ABI,
            functionName: 'getReserveData',
            args: [market.loanToken],
          })

          // Rates are in Ray (1e27)
          aaveSupplyApy = Number(aaveData.currentLiquidityRate) / 1e27
          aaveBorrowApy = Number(aaveData.currentVariableBorrowRate) / 1e27
        } catch {
          // Token might not be on Aave
        }
      }

      const supplySpread = morphoSupplyApy - aaveSupplyApy
      const borrowSpread = aaveBorrowApy - morphoBorrowApy

      if (supplySpread > this.config.minSupplyApy || borrowSpread > this.config.minBorrowSavings) {
        this.stats.rateArbs++
        opportunities.push({
          market,
          morphoSupplyApy,
          morphoBorrowApy,
          aaveSupplyApy,
          aaveBorrowApy,
          supplySpread,
          borrowSpread,
        })
      }
    }

    return opportunities
  }

  /**
   * Find liquidatable positions using subgraph + on-chain verification
   */
  async findLiquidations(): Promise<LiquidatablePosition[]> {
    const liquidatable: LiquidatablePosition[] = []

    for (const market of this.config.markets) {
      // Get borrowers from subgraph
      const borrowers = await this.fetchBorrowersFromSubgraph(market)

      // Also check any borrowers we're watching
      const watched = this.watchedBorrowers.get(market.id) ?? new Set()
      for (const borrower of watched) {
        if (!borrowers.includes(borrower)) {
          borrowers.push(borrower)
        }
      }

      // Check each borrower's health
      const oraclePrice = await this.getOraclePrice(market)
      const state = this.marketStates.get(market.id)

      if (!state || oraclePrice === 0n) continue

      for (const borrower of borrowers) {
        const position = await this.getPosition(market.id, borrower)

        if (position.borrowShares === 0n) {
          watched.delete(borrower)
          continue
        }

        // Calculate debt value
        // debtAssets = borrowShares * totalBorrowAssets / totalBorrowShares
        const debtAssets = state.totalBorrowShares > 0n
          ? (position.borrowShares * state.totalBorrowAssets) / state.totalBorrowShares
          : 0n

        // Calculate collateral value in loan token terms
        // collateralValue = collateral * oraclePrice / 1e36 (oracle price is 1e36 scaled)
        const collateralValue = (position.collateral * oraclePrice) / BigInt(1e36)

        // Calculate LTV
        const ltv = debtAssets > 0n ? Number(debtAssets) / Number(collateralValue) : 0

        // Compare to LLTV (liquidation threshold)
        const lltv = Number(market.lltv) / 1e18

        if (ltv > lltv) {
          // Position is liquidatable
          // Morpho allows liquidating up to close factor (usually 100% for bad debt)
          const maxRepay = debtAssets
          const seizableColl = (maxRepay * BigInt(1e36)) / oraclePrice

          // Liquidation incentive is typically 5-15%
          const liquidationIncentive = 0.05
          const profitColl = (seizableColl * BigInt(Math.floor(liquidationIncentive * 1e18))) / BigInt(1e18)
          const profitUsd = Number(profitColl) / (10 ** market.collateralTokenDecimals) * this.config.ethPriceUsd

          if (profitUsd >= this.config.minLiquidationProfitUsd) {
            this.stats.liquidations++
            liquidatable.push({
              market,
              borrower,
              borrowShares: position.borrowShares,
              collateral: position.collateral,
              debtValue: debtAssets,
              collateralValue,
              ltv,
              seizable: seizableColl,
              repayAmount: maxRepay,
              profit: profitColl,
              profitUsd,
            })
          }
        } else if (ltv > lltv * 0.9) {
          // Position is close to liquidation, watch it
          watched.add(borrower)
        }
      }

      this.watchedBorrowers.set(market.id, watched)
    }

    return liquidatable.sort((a, b) => b.profitUsd - a.profitUsd)
  }

  private async fetchBorrowersFromSubgraph(market: MorphoMarket): Promise<Address[]> {
    if (!this.config.subgraphUrl) return []

    try {
      const response = await fetch(this.config.subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: MORPHO_POSITIONS_QUERY,
          variables: {
            marketId: market.id,
            minBorrow: '0',
          },
        }),
      })

      const data = await response.json() as {
        data?: { positions: Array<{ user: string }> }
      }

      return data.data?.positions.map(p => p.user as Address) ?? []
    } catch {
      return []
    }
  }

  private async updateMarketStates(): Promise<void> {
    for (const market of this.config.markets) {
      try {
        const state = await this.getMarketState(market.id)
        this.marketStates.set(market.id, state)
      } catch (error) {
        console.warn(`Failed to update state for market ${market.id}`)
      }
    }
  }

  getStats(): {
    markets: number
    watchedBorrowers: number
    checks: number
    liquidationsFound: number
    rateArbsFound: number
  } {
    let totalWatched = 0
    for (const borrowers of this.watchedBorrowers.values()) {
      totalWatched += borrowers.size
    }

    return {
      markets: this.config.markets.length,
      watchedBorrowers: totalWatched,
      checks: this.stats.checks,
      liquidationsFound: this.stats.liquidations,
      rateArbsFound: this.stats.rateArbs,
    }
  }
}

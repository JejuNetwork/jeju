/**
 * MEV Competition Simulation
 *
 * Simulates realistic MEV competition scenarios:
 * - Searcher competition modeling
 * - Builder/block proposer simulation
 * - Priority gas auctions (PGA)
 * - Bundle ordering optimization
 * - Latency impact analysis
 * - Historical MEV extraction analysis
 */

// ============ Types ============

export interface MEVSearcher {
  id: string
  name: string
  successRate: number // 0-1
  avgProfitBps: number
  avgGasPriceMultiplier: number
  latencyMs: number
  strategies: MEVStrategy[]
  weeklyVolume: bigint
}

export interface MEVStrategy {
  type: 'arbitrage' | 'sandwich' | 'liquidation' | 'backrun' | 'jit-liquidity'
  successRate: number
  avgProfitUsd: number
  avgGasUsed: bigint
  competitionLevel: 'low' | 'medium' | 'high' | 'extreme'
}

export interface BlockBuilder {
  id: string
  name: string
  marketShare: number // 0-1
  avgBlockValue: bigint
  bundleAcceptanceRate: number
  minTipGwei: number
}

export interface MEVOpportunityWindow {
  type: MEVStrategy['type']
  profitUsd: number
  gasRequired: bigint
  blockDeadline: bigint
  competingSearchers: number
  winProbability: number
  expectedValue: number
}

export interface CompetitionSimResult {
  totalOpportunities: number
  opportunitiesWon: number
  winRate: number
  totalProfit: number
  totalGasCost: number
  netProfit: number
  profitByStrategy: Record<string, number>
  competitionAnalysis: CompetitionAnalysis
  builderStats: BuilderStats
  latencyImpact: LatencyImpact
}

export interface CompetitionAnalysis {
  avgCompetitors: number
  avgWinMargin: number // How much more we paid than 2nd place
  lostToLatency: number // Opportunities lost due to latency
  lostToPrice: number // Lost because competitor bid higher
}

export interface BuilderStats {
  builderPreferences: Record<string, number>
  bundleInclusionRate: number
  avgBlockPosition: number
  revertedTransactions: number
}

export interface LatencyImpact {
  avgLatencyMs: number
  latencyPercentile95: number
  missedOpportunities: number
  optimalLatencyGain: number // Profit increase with 0 latency
}

// ============ Constants ============

// Known top MEV searchers (anonymized/generalized profiles)
const _KNOWN_SEARCHERS: MEVSearcher[] = [
  {
    id: 'alpha',
    name: 'Top Searcher Alpha',
    successRate: 0.45,
    avgProfitBps: 35,
    avgGasPriceMultiplier: 1.5,
    latencyMs: 10,
    strategies: [
      {
        type: 'arbitrage',
        successRate: 0.5,
        avgProfitUsd: 500,
        avgGasUsed: 400000n,
        competitionLevel: 'extreme',
      },
      {
        type: 'sandwich',
        successRate: 0.3,
        avgProfitUsd: 200,
        avgGasUsed: 350000n,
        competitionLevel: 'high',
      },
      {
        type: 'liquidation',
        successRate: 0.6,
        avgProfitUsd: 1000,
        avgGasUsed: 500000n,
        competitionLevel: 'high',
      },
    ],
    weeklyVolume: 5000000n,
  },
  {
    id: 'beta',
    name: 'Top Searcher Beta',
    successRate: 0.35,
    avgProfitBps: 30,
    avgGasPriceMultiplier: 1.3,
    latencyMs: 15,
    strategies: [
      {
        type: 'arbitrage',
        successRate: 0.4,
        avgProfitUsd: 400,
        avgGasUsed: 380000n,
        competitionLevel: 'extreme',
      },
      {
        type: 'backrun',
        successRate: 0.5,
        avgProfitUsd: 150,
        avgGasUsed: 200000n,
        competitionLevel: 'medium',
      },
    ],
    weeklyVolume: 3000000n,
  },
  {
    id: 'gamma',
    name: 'Mid-tier Searcher Gamma',
    successRate: 0.25,
    avgProfitBps: 25,
    avgGasPriceMultiplier: 1.2,
    latencyMs: 25,
    strategies: [
      {
        type: 'arbitrage',
        successRate: 0.3,
        avgProfitUsd: 300,
        avgGasUsed: 400000n,
        competitionLevel: 'high',
      },
      {
        type: 'jit-liquidity',
        successRate: 0.4,
        avgProfitUsd: 100,
        avgGasUsed: 300000n,
        competitionLevel: 'low',
      },
    ],
    weeklyVolume: 1000000n,
  },
]

// Major block builders
const BLOCK_BUILDERS: BlockBuilder[] = [
  {
    id: 'flashbots',
    name: 'Flashbots',
    marketShare: 0.25,
    avgBlockValue: 50000000000000000n, // 0.05 ETH
    bundleAcceptanceRate: 0.85,
    minTipGwei: 1,
  },
  {
    id: 'builder0x69',
    name: 'builder0x69',
    marketShare: 0.2,
    avgBlockValue: 45000000000000000n,
    bundleAcceptanceRate: 0.8,
    minTipGwei: 2,
  },
  {
    id: 'beaverbuild',
    name: 'beaverbuild',
    marketShare: 0.15,
    avgBlockValue: 40000000000000000n,
    bundleAcceptanceRate: 0.75,
    minTipGwei: 1,
  },
  {
    id: 'rsync',
    name: 'rsync-builder',
    marketShare: 0.1,
    avgBlockValue: 35000000000000000n,
    bundleAcceptanceRate: 0.7,
    minTipGwei: 2,
  },
]

// ============ MEV Competition Simulator ============

export class MEVCompetitionSimulator {
  private ourSearcher: MEVSearcher
  private builders: BlockBuilder[]

  constructor(
    ourConfig: Partial<MEVSearcher> = {},
    _useRealCompetitors: boolean = true,
  ) {
    // Configure our searcher profile
    this.ourSearcher = {
      id: 'us',
      name: 'Our Bot',
      successRate: 0.2,
      avgProfitBps: 20,
      avgGasPriceMultiplier: 1.1,
      latencyMs: 50, // Assume 50ms latency
      strategies: [
        {
          type: 'arbitrage',
          successRate: 0.25,
          avgProfitUsd: 250,
          avgGasUsed: 400000n,
          competitionLevel: 'high',
        },
        {
          type: 'liquidation',
          successRate: 0.3,
          avgProfitUsd: 500,
          avgGasUsed: 500000n,
          competitionLevel: 'medium',
        },
      ],
      weeklyVolume: 0n,
      ...ourConfig,
    }

    this.builders = BLOCK_BUILDERS
  }

  /**
   * Run full competition simulation
   */
  async runSimulation(config: {
    blocks: number
    opportunitiesPerBlock: number
    gasPriceGwei: number
    ethPriceUsd: number
  }): Promise<CompetitionSimResult> {
    console.log('\n🏁 MEV Competition Simulation')
    console.log('='.repeat(60))
    console.log(
      `Simulating ${config.blocks} blocks with ~${config.opportunitiesPerBlock} opportunities each`,
    )

    const opportunities: MEVOpportunityWindow[] = []
    const results: Array<{
      won: boolean
      profit: number
      gasCost: number
      strategy: string
      lostReason?: 'latency' | 'price' | 'builder'
    }> = []

    // Generate opportunities for each block
    for (let block = 0; block < config.blocks; block++) {
      const blockOpps = this.generateBlockOpportunities(
        config.opportunitiesPerBlock,
        config.gasPriceGwei,
        config.ethPriceUsd,
      )

      for (const opp of blockOpps) {
        opportunities.push(opp)

        // Simulate competition for this opportunity
        const result = this.simulateCompetition(opp, config)
        results.push(result)
      }
    }

    // Aggregate results
    const won = results.filter((r) => r.won)
    const lost = results.filter((r) => !r.won)

    const totalProfit = won.reduce((sum, r) => sum + r.profit, 0)
    const totalGasCost = won.reduce((sum, r) => sum + r.gasCost, 0)

    const profitByStrategy: Record<string, number> = {}
    for (const r of won) {
      profitByStrategy[r.strategy] =
        (profitByStrategy[r.strategy] ?? 0) + r.profit
    }

    const lostToLatency = lost.filter((r) => r.lostReason === 'latency').length
    const lostToPrice = lost.filter((r) => r.lostReason === 'price').length

    const result: CompetitionSimResult = {
      totalOpportunities: opportunities.length,
      opportunitiesWon: won.length,
      winRate: won.length / opportunities.length,
      totalProfit,
      totalGasCost,
      netProfit: totalProfit - totalGasCost,
      profitByStrategy,
      competitionAnalysis: {
        avgCompetitors:
          opportunities.reduce((sum, o) => sum + o.competingSearchers, 0) /
          opportunities.length,
        avgWinMargin: 0.15, // Would calculate from actual bid data
        lostToLatency,
        lostToPrice,
      },
      builderStats: this.calculateBuilderStats(won.length),
      latencyImpact: this.calculateLatencyImpact(results, opportunities),
    }

    this.printResults(result)
    return result
  }

  /**
   * Analyze historical MEV data to calibrate simulation
   */
  async calibrateFromHistorical(
    mevData: Array<{
      txHash: string
      type: string
      profitUsd: number
      gasUsed: bigint
      gasPrice: bigint
      successful: boolean
      competitorCount: number
    }>,
  ): Promise<void> {
    console.log('\n📊 Calibrating from historical MEV data...')
    console.log(`   Analyzing ${mevData.length} transactions`)

    // Calculate real-world success rates
    const byType: Record<
      string,
      { success: number; total: number; avgProfit: number }
    > = {}

    for (const tx of mevData) {
      if (!byType[tx.type]) {
        byType[tx.type] = { success: 0, total: 0, avgProfit: 0 }
      }

      byType[tx.type].total++
      if (tx.successful) {
        byType[tx.type].success++
        byType[tx.type].avgProfit += tx.profitUsd
      }
    }

    // Update our searcher profile based on historical data
    for (const strategy of this.ourSearcher.strategies) {
      const historical = byType[strategy.type]
      if (historical && historical.total > 10) {
        strategy.successRate = historical.success / historical.total
        strategy.avgProfitUsd = historical.avgProfit / historical.success
        console.log(
          `   Updated ${strategy.type}: ${(strategy.successRate * 100).toFixed(1)}% success, $${strategy.avgProfitUsd.toFixed(0)} avg profit`,
        )
      }
    }
  }

  /**
   * Simulate priority gas auction dynamics
   */
  simulatePGA(
    opportunityValue: number,
    _baseFeeGwei: number,
    competitors: number,
  ): {
    optimalTipGwei: number
    winProbability: number
    expectedProfit: number
  } {
    // Model: Each competitor bids a fraction of opportunity value
    // Higher bids = higher win probability but lower profit

    // Nash equilibrium approximation for n-player all-pay auction
    const n = competitors + 1 // Including us
    const equilibriumBidFraction = (n - 1) / n

    // Our bid should be slightly above equilibrium to win
    const ourBidFraction = Math.min(equilibriumBidFraction * 1.1, 0.95)
    const tipValue = opportunityValue * ourBidFraction

    // Convert to gwei (assuming 500k gas)
    const gasUsed = 500000
    const tipGwei = tipValue / (gasUsed * 1e-9)

    // Win probability based on bid position
    const winProb = ourBidFraction ** (1 / n)

    // Expected profit = win_prob * (value - tip) - lose_prob * 0
    const expectedProfit = winProb * (opportunityValue - tipValue)

    return {
      optimalTipGwei: tipGwei,
      winProbability: winProb,
      expectedProfit,
    }
  }

  /**
   * Analyze builder preferences and optimize bundle submission
   */
  analyzeBuilderPreferences(): {
    recommendations: Array<{
      builder: string
      submitProbability: number
      reason: string
    }>
    optimalSubmissionOrder: string[]
  } {
    const recommendations: Array<{
      builder: string
      submitProbability: number
      reason: string
    }> = []

    // Score each builder
    const scores = this.builders.map((builder) => {
      const score =
        builder.marketShare * 0.4 +
        builder.bundleAcceptanceRate * 0.4 +
        (1 - builder.minTipGwei / 10) * 0.2

      return {
        builder,
        score,
      }
    })

    scores.sort((a, b) => b.score - a.score)

    for (const { builder, score } of scores) {
      recommendations.push({
        builder: builder.name,
        submitProbability: score,
        reason: `${(builder.marketShare * 100).toFixed(0)}% market share, ${(builder.bundleAcceptanceRate * 100).toFixed(0)}% acceptance rate`,
      })
    }

    return {
      recommendations,
      optimalSubmissionOrder: scores.map((s) => s.builder.id),
    }
  }

  // ============ Private Methods ============

  private generateBlockOpportunities(
    count: number,
    gasPriceGwei: number,
    ethPriceUsd: number,
  ): MEVOpportunityWindow[] {
    const opportunities: MEVOpportunityWindow[] = []

    const types: MEVStrategy['type'][] = [
      'arbitrage',
      'sandwich',
      'liquidation',
      'backrun',
      'jit-liquidity',
    ]
    const typeDistribution = [0.4, 0.25, 0.15, 0.15, 0.05] // Probability weights

    for (let i = 0; i < count; i++) {
      // Select opportunity type
      const rand = Math.random()
      let cumulative = 0
      let selectedType: MEVStrategy['type'] = 'arbitrage'

      for (let j = 0; j < types.length; j++) {
        cumulative += typeDistribution[j]
        if (rand < cumulative) {
          selectedType = types[j]
          break
        }
      }

      // Generate opportunity parameters
      const profitUsd = this.generateProfitDistribution(selectedType)
      const gasRequired = this.getTypicalGas(selectedType)
      const competitors = this.getCompetitorCount(selectedType)

      // Calculate win probability based on our capabilities
      const ourStrategy = this.ourSearcher.strategies.find(
        (s) => s.type === selectedType,
      )
      const baseWinProb = ourStrategy?.successRate ?? 0.1
      const winProb = baseWinProb / (1 + competitors * 0.2)

      const gasCostUsd = Number(gasRequired) * gasPriceGwei * 1e-9 * ethPriceUsd
      const expectedValue = winProb * (profitUsd - gasCostUsd)

      opportunities.push({
        type: selectedType,
        profitUsd,
        gasRequired,
        blockDeadline: BigInt(Date.now() + 12000), // Next block
        competingSearchers: competitors,
        winProbability: winProb,
        expectedValue,
      })
    }

    return opportunities
  }

  private generateProfitDistribution(type: MEVStrategy['type']): number {
    // Log-normal distribution for MEV profits
    const params: Record<string, { mu: number; sigma: number }> = {
      arbitrage: { mu: 5.5, sigma: 1.2 }, // ~$250 median
      sandwich: { mu: 4.8, sigma: 1.0 }, // ~$120 median
      liquidation: { mu: 6.5, sigma: 1.5 }, // ~$650 median
      backrun: { mu: 4.5, sigma: 0.8 }, // ~$90 median
      'jit-liquidity': { mu: 4.0, sigma: 0.6 }, // ~$55 median
    }

    const { mu, sigma } = params[type] ?? params.arbitrage
    const normal = this.randomNormal()
    return Math.exp(mu + sigma * normal)
  }

  private getTypicalGas(type: MEVStrategy['type']): bigint {
    const gasMap: Record<string, bigint> = {
      arbitrage: 400000n,
      sandwich: 600000n, // 2 transactions
      liquidation: 500000n,
      backrun: 200000n,
      'jit-liquidity': 300000n,
    }
    return gasMap[type] ?? 400000n
  }

  private getCompetitorCount(type: MEVStrategy['type']): number {
    const competition: Record<string, [number, number]> = {
      arbitrage: [3, 8],
      sandwich: [2, 5],
      liquidation: [2, 6],
      backrun: [1, 4],
      'jit-liquidity': [1, 3],
    }
    const [min, max] = competition[type] ?? [2, 5]
    return min + Math.floor(Math.random() * (max - min + 1))
  }

  private simulateCompetition(
    opp: MEVOpportunityWindow,
    config: { gasPriceGwei: number; ethPriceUsd: number },
  ): {
    won: boolean
    profit: number
    gasCost: number
    strategy: string
    lostReason?: 'latency' | 'price' | 'builder'
  } {
    const gasCost =
      Number(opp.gasRequired) * config.gasPriceGwei * 1e-9 * config.ethPriceUsd

    // Check if opportunity is even profitable for us
    if (opp.profitUsd < gasCost * 1.2) {
      return {
        won: false,
        profit: 0,
        gasCost: 0,
        strategy: opp.type,
        lostReason: 'price',
      }
    }

    // Simulate competition outcome
    const roll = Math.random()

    // Latency check: If we're slower than competitors, we might miss
    // Less aggressive penalty - 10% of opportunities lost per 100ms latency
    const latencyPenalty = this.ourSearcher.latencyMs / 500
    if (roll < latencyPenalty) {
      return {
        won: false,
        profit: 0,
        gasCost: 0,
        strategy: opp.type,
        lostReason: 'latency',
      }
    }

    // Main competition roll - adjusted for niche strategies
    // JIT liquidity and backrun have lower competition
    const competitionMultiplier =
      opp.type === 'jit-liquidity'
        ? 2
        : opp.type === 'backrun'
          ? 1.5
          : opp.type === 'liquidation'
            ? 1.3
            : 1

    const adjustedWinProb = Math.min(
      opp.winProbability * competitionMultiplier,
      0.6,
    )

    if (roll < adjustedWinProb) {
      return {
        won: true,
        profit: opp.profitUsd,
        gasCost,
        strategy: opp.type,
      }
    }

    return {
      won: false,
      profit: 0,
      gasCost: 0,
      strategy: opp.type,
      lostReason: 'price',
    }
  }

  private calculateBuilderStats(wonCount: number): BuilderStats {
    const preferences: Record<string, number> = {}

    for (const builder of this.builders) {
      // Distribute wins based on market share
      preferences[builder.name] = Math.round(wonCount * builder.marketShare)
    }

    return {
      builderPreferences: preferences,
      bundleInclusionRate: 0.75, // Estimated
      avgBlockPosition: 5, // Middle of block on average
      revertedTransactions: Math.round(wonCount * 0.02), // 2% revert rate
    }
  }

  private calculateLatencyImpact(
    results: Array<{ won: boolean; lostReason?: string }>,
    opportunities: MEVOpportunityWindow[],
  ): LatencyImpact {
    const lostToLatency = results.filter(
      (r) => r.lostReason === 'latency',
    ).length

    // Calculate potential gain with zero latency
    const latencyLossValue = opportunities
      .filter((_, i) => results[i].lostReason === 'latency')
      .reduce((sum, o) => sum + o.profitUsd, 0)

    return {
      avgLatencyMs: this.ourSearcher.latencyMs,
      latencyPercentile95: this.ourSearcher.latencyMs * 2,
      missedOpportunities: lostToLatency,
      optimalLatencyGain: latencyLossValue,
    }
  }

  private randomNormal(): number {
    const u1 = Math.random()
    const u2 = Math.random()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  private printResults(result: CompetitionSimResult): void {
    console.log(`\n${'─'.repeat(60)}`)
    console.log('COMPETITION SIMULATION RESULTS')
    console.log('─'.repeat(60))

    console.log(`\nOpportunities: ${result.totalOpportunities}`)
    console.log(
      `Won: ${result.opportunitiesWon} (${(result.winRate * 100).toFixed(1)}%)`,
    )
    console.log(`Net Profit: $${result.netProfit.toFixed(2)}`)
    console.log(`Total Profit: $${result.totalProfit.toFixed(2)}`)
    console.log(`Gas Costs: $${result.totalGasCost.toFixed(2)}`)

    console.log('\nProfit by Strategy:')
    for (const [strategy, profit] of Object.entries(result.profitByStrategy)) {
      console.log(`  ${strategy}: $${profit.toFixed(2)}`)
    }

    console.log('\nCompetition Analysis:')
    console.log(
      `  Avg Competitors: ${result.competitionAnalysis.avgCompetitors.toFixed(1)}`,
    )
    console.log(
      `  Lost to Latency: ${result.competitionAnalysis.lostToLatency}`,
    )
    console.log(`  Lost to Price: ${result.competitionAnalysis.lostToPrice}`)

    console.log('\nLatency Impact:')
    console.log(`  Our Latency: ${result.latencyImpact.avgLatencyMs}ms`)
    console.log(
      `  Missed Opportunities: ${result.latencyImpact.missedOpportunities}`,
    )
    console.log(
      `  Zero-Latency Gain: $${result.latencyImpact.optimalLatencyGain.toFixed(2)}`,
    )

    console.log('\nBuilder Preferences:')
    for (const [builder, count] of Object.entries(
      result.builderStats.builderPreferences,
    )) {
      console.log(`  ${builder}: ${count} wins`)
    }
    console.log(
      `  Bundle Inclusion Rate: ${(result.builderStats.bundleInclusionRate * 100).toFixed(0)}%`,
    )
    console.log(
      `  Reverted Transactions: ${result.builderStats.revertedTransactions}`,
    )
  }
}

// ============ Exports ============

export function runMEVCompetitionSim(config: {
  blocks: number
  opportunitiesPerBlock: number
  gasPriceGwei: number
  ethPriceUsd: number
  ourLatencyMs?: number
  ourSuccessRate?: number
}): Promise<CompetitionSimResult> {
  const simulator = new MEVCompetitionSimulator({
    latencyMs: config.ourLatencyMs ?? 50,
    successRate: config.ourSuccessRate ?? 0.2,
  })

  return simulator.runSimulation({
    blocks: config.blocks,
    opportunitiesPerBlock: config.opportunitiesPerBlock,
    gasPriceGwei: config.gasPriceGwei,
    ethPriceUsd: config.ethPriceUsd,
  })
}

#!/usr/bin/env bun
/**
 * CRITICAL ASSESSMENT OF BACKTEST RESULTS
 *
 * This analysis identifies overly bullish assumptions, missing costs,
 * and realistic adjustments needed for production deployment.
 */

// ============ ISSUE CATEGORIES ============

interface CriticalIssue {
  category:
    | 'missing_cost'
    | 'unrealistic_assumption'
    | 'market_condition'
    | 'competition'
    | 'execution_risk'
  severity: 'critical' | 'high' | 'medium' | 'low'
  issue: string
  currentAssumption: string
  realisticValue: string
  profitImpactPercent: number
  fix: string
}

interface FeeBreakdown {
  name: string
  type: 'percentage' | 'fixed' | 'variable'
  amount: number
  perTrade: boolean
  notes: string
}

interface RealisticProjection {
  originalMonthlyProfit: number
  adjustedMonthlyProfit: number
  reductionPercent: number
  confidenceLevel: 'low' | 'medium' | 'high'
  breakEvenCapital: number
  timeToProfit: string
}

// ============ CRITICAL ISSUES ============

const CRITICAL_ISSUES: CriticalIssue[] = [
  // === MISSING COSTS ===
  {
    category: 'missing_cost',
    severity: 'critical',
    issue: 'DEX Swap Fees Not Fully Accounted',
    currentAssumption: 'Only 30bps fee on one leg',
    realisticValue:
      '60bps total (30bps buy + 30bps sell), plus 5bps for V3 concentrated liquidity positions',
    profitImpactPercent: -25,
    fix: 'Double-count fees for round-trip trades: buy DEX fee + sell DEX fee + potential V3 concentration fees',
  },
  {
    category: 'missing_cost',
    severity: 'critical',
    issue: 'Flash Loan Fees Missing',
    currentAssumption: 'Flash loans are free',
    realisticValue:
      'Aave: 9bps (0.09%), Balancer: 0%, dYdX: 0%, Uniswap V3: pool-dependent',
    profitImpactPercent: -8,
    fix: 'Add 5-9bps flash loan fee for Aave-based strategies',
  },
  {
    category: 'missing_cost',
    severity: 'high',
    issue: 'Priority Fee / MEV Tip Underestimated',
    currentAssumption: '10% of base fee',
    realisticValue: '100-500% of base fee during competitive MEV opportunities',
    profitImpactPercent: -15,
    fix: 'Model priority fee as function of opportunity size: min($0.50, 2x expected profit)',
  },
  {
    category: 'missing_cost',
    severity: 'high',
    issue: 'L2 Blob/Calldata Costs Missing',
    currentAssumption: 'Only execution gas counted',
    realisticValue:
      'L1 data availability costs: +$0.10-$0.50 per tx on Base/Optimism',
    profitImpactPercent: -10,
    fix: 'Add L1 data fee: calldata_bytes * l1_gas_price * 16 / compression_ratio',
  },
  {
    category: 'missing_cost',
    severity: 'medium',
    issue: 'Token Approval Costs',
    currentAssumption: 'Not counted',
    realisticValue: '~46,000 gas per new token approval (~$0.50-$5 on mainnet)',
    profitImpactPercent: -2,
    fix: 'Amortize approval costs over expected trade count per token pair',
  },
  {
    category: 'missing_cost',
    severity: 'medium',
    issue: 'Failed Transaction Costs',
    currentAssumption: '0% failure rate',
    realisticValue:
      '5-15% of txs fail (reverts, slippage, competition) - still pay gas',
    profitImpactPercent: -8,
    fix: 'Add expectedGasCost * failureRate to each trade',
  },
  {
    category: 'missing_cost',
    severity: 'medium',
    issue: 'RPC/Node Infrastructure Costs',
    currentAssumption: 'Free public RPCs',
    realisticValue: '$200-2000/month for low-latency private nodes per chain',
    profitImpactPercent: -3,
    fix: 'Add $500/month infrastructure overhead minimum',
  },

  // === UNREALISTIC ASSUMPTIONS ===
  {
    category: 'unrealistic_assumption',
    severity: 'critical',
    issue: 'Win Rate of 100% is Impossible',
    currentAssumption: 'All executed trades are profitable',
    realisticValue:
      'Realistic win rate: 40-60% for competitive arb, 70-80% for less competitive',
    profitImpactPercent: -35,
    fix: 'Apply realistic win rate: profitableTrades = executedTrades * 0.55',
  },
  {
    category: 'unrealistic_assumption',
    severity: 'critical',
    issue: 'Slippage Model Too Optimistic',
    currentAssumption: '30% of spread lost to slippage',
    realisticValue:
      '50-70% of spread lost due to: other bots, block timing, price movement',
    profitImpactPercent: -20,
    fix: 'Use slippageLoss = spreadBps * 0.6 (60% of detected spread is lost)',
  },
  {
    category: 'unrealistic_assumption',
    severity: 'critical',
    issue: 'Opportunity Detection Latency Not Modeled',
    currentAssumption: 'Instant detection of all opportunities',
    realisticValue:
      '50-200ms detection latency means missing 30-50% of opportunities',
    profitImpactPercent: -40,
    fix: 'Apply latency filter: actualOpportunities = detectedOpportunities * 0.6',
  },
  {
    category: 'unrealistic_assumption',
    severity: 'high',
    issue: 'Simulated Data vs Real Data',
    currentAssumption: 'Synthetic opportunity generation',
    realisticValue:
      'Real market has clustered opportunities, fat tails, correlation',
    profitImpactPercent: -25,
    fix: 'Validate with actual historical DEX data from subgraphs/archives',
  },
  {
    category: 'unrealistic_assumption',
    severity: 'high',
    issue: 'Gas Price Stability',
    currentAssumption: 'Static/average gas prices',
    realisticValue:
      'Gas spikes 2-10x during high volatility (when arb opportunities exist)',
    profitImpactPercent: -15,
    fix: 'Model gas as f(opportunity_value): high arb = high gas = negative correlation',
  },
  {
    category: 'unrealistic_assumption',
    severity: 'medium',
    issue: 'Cross-Chain Bridge Speed',
    currentAssumption: 'Instant bridging',
    realisticValue:
      '1-15 minutes bridge time = price can move, opportunity gone',
    profitImpactPercent: -5,
    fix: 'Add time decay: crossChainValue *= exp(-bridgeTime * priceVolatility)',
  },

  // === COMPETITION ===
  {
    category: 'competition',
    severity: 'critical',
    issue: 'MEV Searcher Competition Not Modeled',
    currentAssumption: 'Bot operates in isolation',
    realisticValue:
      '10-50 sophisticated searchers per chain, 100ms latency matters',
    profitImpactPercent: -50,
    fix: 'Apply competition factor: P(win) = 1 / (1 + numCompetitors * latencyPenalty)',
  },
  {
    category: 'competition',
    severity: 'high',
    issue: 'Private Orderflow/Bundles',
    currentAssumption: 'All opportunities visible in mempool',
    realisticValue:
      '60-80% of Ethereum MEV goes through private channels (Flashbots, MEV-Share)',
    profitImpactPercent: -30,
    fix: 'Reduce mainnet opportunities by 70%, focus on L2s with public mempools',
  },
  {
    category: 'competition',
    severity: 'high',
    issue: 'Block Builder Relationships',
    currentAssumption: 'Fair block inclusion',
    realisticValue:
      'Top builders have exclusive searcher relationships, priority inclusion',
    profitImpactPercent: -20,
    fix: 'Budget for builder tips: 10-50% of profit shared with builders',
  },
  {
    category: 'competition',
    severity: 'medium',
    issue: 'L2 Sequencer Advantage',
    currentAssumption: 'Fair ordering on L2s',
    realisticValue:
      'L2 sequencers can front-run or have preferred ordering deals',
    profitImpactPercent: -15,
    fix: 'Discount L2 opportunities by 15% for sequencer extraction',
  },

  // === EXECUTION RISKS ===
  {
    category: 'execution_risk',
    severity: 'high',
    issue: 'Reorg Risk on Fast Chains',
    currentAssumption: 'Trades are final immediately',
    realisticValue: '1-2 block reorgs common on BSC, occasional on Arbitrum',
    profitImpactPercent: -5,
    fix: 'Wait for 2+ confirmations, reduce expected value by reorg probability',
  },
  {
    category: 'execution_risk',
    severity: 'medium',
    issue: 'Smart Contract Bugs/Exploits',
    currentAssumption: 'All contracts work as expected',
    realisticValue: 'Pool exploits, oracle manipulation, reentrancy attacks',
    profitImpactPercent: -3,
    fix: 'Exclude pools < $1M TVL, require multiple oracle sources',
  },
  {
    category: 'execution_risk',
    severity: 'medium',
    issue: 'Liquidity Fragmentation',
    currentAssumption: 'All liquidity is accessible',
    realisticValue:
      'V3 concentrated liquidity can be out of range, empty ticks',
    profitImpactPercent: -10,
    fix: 'Check tick liquidity before trade, fallback to V2 if V3 shallow',
  },

  // === MARKET CONDITIONS ===
  {
    category: 'market_condition',
    severity: 'high',
    issue: 'Bear Market Reduces Volume',
    currentAssumption: 'Consistent daily volume',
    realisticValue:
      'Bear markets: 50-80% volume reduction = fewer opportunities',
    profitImpactPercent: -40,
    fix: 'Scale opportunities with 30-day average volume vs historical peak',
  },
  {
    category: 'market_condition',
    severity: 'medium',
    issue: 'Spread Compression Over Time',
    currentAssumption: 'Static spread distribution',
    realisticValue: 'Competition compresses spreads 10-20% yearly',
    profitImpactPercent: -10,
    fix: 'Apply time decay: spreadBps *= (0.9 ^ yearsSince2024)',
  },
  {
    category: 'market_condition',
    severity: 'low',
    issue: 'Regulatory Risk',
    currentAssumption: 'No regulatory changes',
    realisticValue: 'MEV regulation, DeFi restrictions possible',
    profitImpactPercent: -5,
    fix: 'Build compliant architecture, prepare for jurisdiction changes',
  },
]

// ============ COMPLETE FEE BREAKDOWN ============

const ALL_FEES: FeeBreakdown[] = [
  // Trading Fees
  {
    name: 'Uniswap V2 Swap Fee',
    type: 'percentage',
    amount: 0.3,
    perTrade: true,
    notes: 'Per swap leg, so 60bps round-trip',
  },
  {
    name: 'Uniswap V3 Swap Fee (0.05%)',
    type: 'percentage',
    amount: 0.05,
    perTrade: true,
    notes: 'Stable pairs',
  },
  {
    name: 'Uniswap V3 Swap Fee (0.30%)',
    type: 'percentage',
    amount: 0.3,
    perTrade: true,
    notes: 'Standard pairs',
  },
  {
    name: 'Uniswap V3 Swap Fee (1.00%)',
    type: 'percentage',
    amount: 1.0,
    perTrade: true,
    notes: 'Exotic pairs',
  },
  {
    name: 'Curve Swap Fee',
    type: 'percentage',
    amount: 0.04,
    perTrade: true,
    notes: '4bps for stables',
  },
  {
    name: 'Balancer Swap Fee',
    type: 'percentage',
    amount: 0.3,
    perTrade: true,
    notes: 'Variable by pool',
  },
  {
    name: 'SushiSwap Fee',
    type: 'percentage',
    amount: 0.3,
    perTrade: true,
    notes: 'Same as Uni V2',
  },
  {
    name: 'Aerodrome Fee',
    type: 'percentage',
    amount: 0.3,
    perTrade: true,
    notes: 'Base chain',
  },
  {
    name: 'PancakeSwap Fee',
    type: 'percentage',
    amount: 0.25,
    perTrade: true,
    notes: 'BSC',
  },

  // Flash Loan Fees
  {
    name: 'Aave V3 Flash Loan',
    type: 'percentage',
    amount: 0.09,
    perTrade: true,
    notes: '9bps, 0% for whitelisted',
  },
  {
    name: 'Balancer Flash Loan',
    type: 'percentage',
    amount: 0.0,
    perTrade: true,
    notes: 'Free',
  },
  {
    name: 'Uniswap V3 Flash Swap',
    type: 'percentage',
    amount: 0.3,
    perTrade: true,
    notes: 'Same as regular swap fee',
  },

  // Gas Costs (USD estimates at $3000 ETH)
  {
    name: 'Simple Swap Gas (Mainnet)',
    type: 'fixed',
    amount: 15.0,
    perTrade: true,
    notes: '150k gas @ 30 gwei',
  },
  {
    name: 'Multi-hop Swap Gas (Mainnet)',
    type: 'fixed',
    amount: 30.0,
    perTrade: true,
    notes: '300k gas',
  },
  {
    name: 'Flash Loan + Swap (Mainnet)',
    type: 'fixed',
    amount: 40.0,
    perTrade: true,
    notes: '400k gas',
  },
  {
    name: 'Simple Swap Gas (L2)',
    type: 'fixed',
    amount: 0.05,
    perTrade: true,
    notes: 'Base/Optimism',
  },
  {
    name: 'Simple Swap Gas (Arbitrum)',
    type: 'fixed',
    amount: 0.1,
    perTrade: true,
    notes: 'Slightly higher L2 fees',
  },
  {
    name: 'L1 Data Cost (L2 txs)',
    type: 'variable',
    amount: 0.2,
    perTrade: true,
    notes: 'Calldata posted to L1',
  },
  {
    name: 'Priority Fee (Competitive)',
    type: 'variable',
    amount: 5.0,
    perTrade: true,
    notes: 'MEV tips, varies widely',
  },
  {
    name: 'Failed Transaction',
    type: 'fixed',
    amount: 5.0,
    perTrade: false,
    notes: '10% of trades fail',
  },

  // Bridge Costs
  {
    name: 'Stargate Bridge',
    type: 'percentage',
    amount: 0.06,
    perTrade: true,
    notes: '6bps + $2 fixed',
  },
  {
    name: 'Across Bridge',
    type: 'percentage',
    amount: 0.04,
    perTrade: true,
    notes: '4bps + $1 fixed',
  },
  {
    name: 'Hop Bridge',
    type: 'percentage',
    amount: 0.05,
    perTrade: true,
    notes: '5bps + $1.50 fixed',
  },
  {
    name: 'Wormhole Bridge',
    type: 'percentage',
    amount: 0.1,
    perTrade: true,
    notes: '10bps + $5 fixed',
  },

  // Operational Costs (Monthly)
  {
    name: 'Private RPC Node (per chain)',
    type: 'fixed',
    amount: 200.0,
    perTrade: false,
    notes: 'Alchemy/QuickNode',
  },
  {
    name: 'Low-latency Node (Mainnet)',
    type: 'fixed',
    amount: 1000.0,
    perTrade: false,
    notes: 'Bloxroute, Fiber',
  },
  {
    name: 'Server Infrastructure',
    type: 'fixed',
    amount: 300.0,
    perTrade: false,
    notes: 'Cloud compute',
  },
  {
    name: 'Monitoring/Alerts',
    type: 'fixed',
    amount: 100.0,
    perTrade: false,
    notes: 'Grafana, PagerDuty',
  },

  // Hidden Costs
  {
    name: 'Slippage (avg)',
    type: 'percentage',
    amount: 0.5,
    perTrade: true,
    notes: '50bps typical slippage',
  },
  {
    name: 'MEV Extraction (by others)',
    type: 'percentage',
    amount: 0.2,
    perTrade: true,
    notes: 'Sandwich, frontrun',
  },
  {
    name: 'Price Movement',
    type: 'percentage',
    amount: 0.1,
    perTrade: true,
    notes: 'Between detection and execution',
  },
  {
    name: 'Builder Tips',
    type: 'percentage',
    amount: 0.1,
    perTrade: true,
    notes: '10-50% of profit to builders',
  },
]

// ============ REALISTIC CALCULATIONS ============

function calculateRealisticProjection(): RealisticProjection {
  // Original backtest numbers
  const originalMonthlyProfit = 292703
  const originalDailyOpportunities = 600
  const _originalWinRate = 1.0
  const originalAvgProfit = 28 // $28 avg per trade

  // Apply corrections
  let adjustedOpportunities = originalDailyOpportunities

  // 1. Latency filter: miss 40% of opportunities
  adjustedOpportunities *= 0.6
  console.log(
    `After latency filter: ${adjustedOpportunities.toFixed(0)} opportunities/day`,
  )

  // 2. Competition filter: lose 50% to faster bots
  adjustedOpportunities *= 0.5
  console.log(
    `After competition filter: ${adjustedOpportunities.toFixed(0)} opportunities/day`,
  )

  // 3. Apply realistic win rate
  const realisticWinRate = 0.55
  const winningTrades = adjustedOpportunities * realisticWinRate
  console.log(`Winning trades: ${winningTrades.toFixed(0)}/day`)

  // 4. Reduce profit per trade
  let adjustedProfitPerTrade = originalAvgProfit

  // Double-count DEX fees: -60bps total
  adjustedProfitPerTrade *= 0.85
  // Flash loan fees: -9bps
  adjustedProfitPerTrade *= 0.95
  // Higher slippage: -20%
  adjustedProfitPerTrade *= 0.8
  // MEV extraction: -15%
  adjustedProfitPerTrade *= 0.85
  // Priority fees: -10%
  adjustedProfitPerTrade *= 0.9
  // Failed tx costs: -8%
  adjustedProfitPerTrade *= 0.92

  console.log(
    `Adjusted profit per trade: $${adjustedProfitPerTrade.toFixed(2)}`,
  )

  // 5. Calculate adjusted monthly
  const adjustedDailyProfit = winningTrades * adjustedProfitPerTrade
  const adjustedMonthlyProfit = adjustedDailyProfit * 30

  // 6. Subtract fixed costs
  const monthlyInfraCosts = 1500 // Nodes, servers, monitoring
  const finalMonthlyProfit = adjustedMonthlyProfit - monthlyInfraCosts

  // 7. Calculate reduction
  const reductionPercent =
    ((originalMonthlyProfit - finalMonthlyProfit) / originalMonthlyProfit) * 100

  // 8. Break-even capital (assuming 1% monthly return is acceptable)
  const breakEvenCapital = finalMonthlyProfit / 0.01

  return {
    originalMonthlyProfit,
    adjustedMonthlyProfit: finalMonthlyProfit,
    reductionPercent,
    confidenceLevel: 'medium',
    breakEvenCapital,
    timeToProfit:
      finalMonthlyProfit > 0
        ? '1-3 months with proper infrastructure'
        : 'Not profitable',
  }
}

// ============ MAIN REPORT ============

async function main() {
  console.log('')
  console.log(
    '╔══════════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║              CRITICAL ASSESSMENT OF BACKTEST RESULTS                ║',
  )
  console.log(
    '║                    ⚠️  REALITY CHECK ⚠️                              ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════════════╝',
  )
  console.log('')

  // === CRITICAL ISSUES ===
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  CRITICAL ISSUES (will significantly reduce profitability)')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')

  const criticalIssues = CRITICAL_ISSUES.filter(
    (i) => i.severity === 'critical',
  )
  let totalCriticalImpact = 0

  for (const issue of criticalIssues) {
    console.log(`  ❌ ${issue.issue}`)
    console.log(`     Current: ${issue.currentAssumption}`)
    console.log(`     Reality: ${issue.realisticValue}`)
    console.log(`     Impact: ${issue.profitImpactPercent}% on profits`)
    console.log(`     Fix: ${issue.fix}`)
    console.log('')
    totalCriticalImpact += issue.profitImpactPercent
  }

  console.log(`  📉 TOTAL CRITICAL IMPACT: ${totalCriticalImpact}%`)
  console.log('')

  // === HIGH SEVERITY ISSUES ===
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  HIGH SEVERITY ISSUES')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')

  const highIssues = CRITICAL_ISSUES.filter((i) => i.severity === 'high')
  let totalHighImpact = 0

  for (const issue of highIssues) {
    console.log(`  ⚠️  ${issue.issue}: ${issue.profitImpactPercent}%`)
    totalHighImpact += issue.profitImpactPercent
  }
  console.log(`\n  📉 TOTAL HIGH SEVERITY IMPACT: ${totalHighImpact}%`)
  console.log('')

  // === COMPLETE FEE BREAKDOWN ===
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  COMPLETE FEE BREAKDOWN')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')

  console.log('  PER-TRADE FEES (for a $10,000 trade):')
  console.log(
    '  ┌─────────────────────────────────┬──────────────┬────────────────┐',
  )
  console.log(
    '  │ Fee                             │ Amount       │ Total ($10K)   │',
  )
  console.log(
    '  ├─────────────────────────────────┼──────────────┼────────────────┤',
  )

  let totalPercentageFees = 0
  let totalFixedFees = 0

  for (const fee of ALL_FEES.filter((f) => f.perTrade)) {
    let amountStr: string
    let totalAmount: number

    if (fee.type === 'percentage') {
      amountStr = `${(fee.amount).toFixed(2)}%`
      totalAmount = 10000 * (fee.amount / 100)
      totalPercentageFees += fee.amount
    } else {
      amountStr = `$${fee.amount.toFixed(2)}`
      totalAmount = fee.amount
      totalFixedFees += fee.amount
    }

    console.log(
      `  │ ${fee.name.padEnd(31)} │ ${amountStr.padStart(12)} │ $${totalAmount.toFixed(2).padStart(13)} │`,
    )
  }
  console.log(
    '  └─────────────────────────────────┴──────────────┴────────────────┘',
  )
  console.log('')
  console.log(`  Total percentage fees: ${totalPercentageFees.toFixed(2)}%`)
  console.log(
    `  For $10,000 trade: $${((10000 * totalPercentageFees) / 100 + totalFixedFees).toFixed(2)} in fees`,
  )
  console.log('')

  console.log('  MONTHLY OPERATIONAL COSTS:')
  console.log('  ┌─────────────────────────────────┬────────────────┐')
  console.log('  │ Cost                            │ Amount/Month   │')
  console.log('  ├─────────────────────────────────┼────────────────┤')

  let totalMonthlyCosts = 0
  for (const fee of ALL_FEES.filter((f) => !f.perTrade && f.amount > 50)) {
    console.log(
      `  │ ${fee.name.padEnd(31)} │ $${fee.amount.toFixed(0).padStart(13)} │`,
    )
    totalMonthlyCosts += fee.amount
  }
  console.log('  ├─────────────────────────────────┼────────────────┤')
  console.log(
    `  │ ${'TOTAL'.padEnd(31)} │ $${totalMonthlyCosts.toFixed(0).padStart(13)} │`,
  )
  console.log('  └─────────────────────────────────┴────────────────┘')
  console.log('')

  // === REALISTIC PROJECTION ===
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  REALISTIC PROFIT PROJECTION')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')

  const projection = calculateRealisticProjection()

  console.log(
    `  Original Backtest Projection:    $${projection.originalMonthlyProfit.toLocaleString()}/month`,
  )
  console.log(
    `  Adjusted Realistic Projection:   $${projection.adjustedMonthlyProfit.toLocaleString()}/month`,
  )
  console.log(
    `  Reduction:                       ${projection.reductionPercent.toFixed(1)}%`,
  )
  console.log(
    `  Confidence Level:                ${projection.confidenceLevel}`,
  )
  console.log('')

  if (projection.adjustedMonthlyProfit > 0) {
    console.log(`  ✓ Strategy is likely profitable after adjustments`)
    console.log(
      `  ✓ Break-even capital: ~$${projection.breakEvenCapital.toLocaleString()}`,
    )
    console.log(`  ✓ ${projection.timeToProfit}`)
  } else {
    console.log(`  ✗ Strategy may not be profitable with realistic assumptions`)
    console.log(`  ✗ Consider focusing on fewer chains, optimizing latency`)
  }
  console.log('')

  // === RECOMMENDATIONS ===
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  RECOMMENDATIONS FOR REALISTIC PROFITABILITY')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')

  const recommendations = [
    '1. FOCUS ON L2s: Arbitrum, Base, Optimism have lower gas and less competition',
    '2. USE PRIVATE MEMPOOLS: Flashbots Protect, MEV Blocker reduce extraction',
    '3. OPTIMIZE LATENCY: Colocate with RPC nodes, use WebSocket subscriptions',
    '4. START SMALL: Test with $1K-$5K per trade before scaling',
    '5. AVOID MAINNET UNLESS: You have sub-100ms latency and builder relationships',
    '6. TRACK ALL COSTS: Failed txs, approvals, priority fees, infrastructure',
    '7. VALIDATE WITH REAL DATA: Use Dune/Flipside for actual DEX arb history',
    '8. BUILD SIMULATION: Paper trade for 2 weeks before real capital',
    '9. DIVERSIFY STRATEGIES: Combine arb, liquidations, yield to smooth returns',
    '10. EXPECT 10-20% OF BACKTEST: Real-world is 5-10x harder than simulation',
  ]

  for (const rec of recommendations) {
    console.log(`  ${rec}`)
  }
  console.log('')

  // === FINAL VERDICT ===
  console.log(
    '╔══════════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                           FINAL VERDICT                              ║',
  )
  console.log(
    '╠══════════════════════════════════════════════════════════════════════╣',
  )
  console.log(
    '║  Original projection: $292K/month is HIGHLY UNREALISTIC              ║',
  )
  console.log(
    '║  Realistic projection: $15K-40K/month with proper infrastructure    ║',
  )
  console.log(
    '║  Best case scenario: $5K-15K/month in first 3 months                ║',
  )
  console.log(
    '║                                                                      ║',
  )
  console.log(
    '║  Key insight: Most MEV/arb bots lose money or break even            ║',
  )
  console.log(
    '║  Success requires: Low latency, capital efficiency, constant work   ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════════════╝',
  )
  console.log('')
}

if (import.meta.main) {
  main().catch(console.error)
}

export {
  CRITICAL_ISSUES,
  ALL_FEES,
  calculateRealisticProjection,
  type CriticalIssue,
  type FeeBreakdown,
}

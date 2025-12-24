#!/usr/bin/env bun
/**
 * IMPROVEMENT ANALYSIS
 *
 * Identifies gaps, optimizations, and profit opportunities
 * based on current implementation and market conditions.
 */
interface Improvement {
  category:
    | 'missing_strategy'
    | 'optimization'
    | 'infrastructure'
    | 'risk_reduction'
    | 'new_revenue'
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  estimatedImpact: string
  implementationEffort: string
  potentialProfit: string
  currentState: string
  requiredChanges: string[]
}

interface MissingProtocol {
  name: string
  type: string
  chain: string
  tvl: string
  opportunity: string
}

interface LatencyOptimization {
  component: string
  currentLatency: string
  targetLatency: string
  improvement: string
  implementation: string
}
const IMPROVEMENTS: Improvement[] = [
  {
    category: 'missing_strategy',
    priority: 'critical',
    title: 'JIT (Just-In-Time) Liquidity',
    description:
      'Provide liquidity right before large swaps to capture fees, remove after',
    estimatedImpact: '+50-100% to L2 profits',
    implementationEffort: '2-3 weeks',
    potentialProfit: '$500-2000/month on Arbitrum alone',
    currentState: 'Not implemented',
    requiredChanges: [
      'Monitor pending txs for large swaps (>$50K)',
      'Calculate optimal liquidity position',
      'Add liquidity 1 block before, remove after',
      'Requires low latency (<20ms) to be effective',
    ],
  },
  {
    category: 'missing_strategy',
    priority: 'critical',
    title: 'Atomic Liquidation Bundles',
    description:
      'Bundle multiple liquidations + arb in single tx for efficiency',
    estimatedImpact: '+30% liquidation profit',
    implementationEffort: '1-2 weeks',
    potentialProfit: '$200-800/month',
    currentState: 'Liquidations are single-tx only',
    requiredChanges: [
      'Implement batch liquidation contract',
      'Add arb path finding after liquidation',
      'Use Flashbots bundles for atomic execution',
    ],
  },
  {
    category: 'missing_strategy',
    priority: 'high',
    title: 'Backrun Strategy',
    description: 'Backrun large trades to capture price impact reversion',
    estimatedImpact: '+20-40% opportunity capture',
    implementationEffort: '1-2 weeks',
    potentialProfit: '$300-1000/month',
    currentState: 'Only sandwich implemented (which is unethical)',
    requiredChanges: [
      'Monitor mempool for large trades',
      'Calculate optimal backrun size',
      'Submit transaction immediately after target',
      'Requires mempool access and low latency',
    ],
  },
  {
    category: 'missing_strategy',
    priority: 'high',
    title: 'Oracle Update Arbitrage',
    description: 'Arb between old and new oracle prices during update window',
    estimatedImpact: '+10-20% to arb profits',
    implementationEffort: '1 week',
    potentialProfit: '$100-500/month',
    currentState: 'Not implemented',
    requiredChanges: [
      'Monitor Chainlink price updates',
      'Detect when DEX price differs from new oracle',
      'Execute arb before others update',
      'Requires Chainlink round monitoring',
    ],
  },
  {
    category: 'missing_strategy',
    priority: 'high',
    title: 'Uniswap V4 Hooks',
    description: 'Custom hooks for automated arb and MEV extraction',
    estimatedImpact: 'First-mover advantage on V4',
    implementationEffort: '3-4 weeks',
    potentialProfit: 'TBD - V4 launching soon',
    currentState: 'Not implemented',
    requiredChanges: [
      'Implement hook contracts',
      'Add V4 pool monitoring',
      'Integrate with existing arb logic',
    ],
  },
  {
    category: 'missing_strategy',
    priority: 'medium',
    title: 'LRT Arbitrage (Liquid Restaking)',
    description: 'Arb between LRT tokens and their underlying ETH value',
    estimatedImpact: 'New revenue stream',
    implementationEffort: '1-2 weeks',
    potentialProfit: '$100-300/month',
    currentState: 'Not monitoring LRT protocols',
    requiredChanges: [
      'Add EigenLayer, Renzo, Kelp integrations',
      'Monitor withdrawal queue opportunities',
      'Track discount/premium to NAV',
    ],
  },
  {
    category: 'missing_strategy',
    priority: 'medium',
    title: 'Intent Protocol Arb (Cowswap, UniswapX)',
    description: 'Fill intents where solver can capture spread',
    estimatedImpact: '+15-25% to intent revenue',
    implementationEffort: '2-3 weeks',
    potentialProfit: '$200-600/month',
    currentState: 'OIF solver exists but limited',
    requiredChanges: [
      'Add Cowswap order flow',
      'Integrate UniswapX',
      'Add 1inch Fusion',
      'Optimize quote latency',
    ],
  },

  {
    category: 'infrastructure',
    priority: 'critical',
    title: 'WebSocket Block Subscription',
    description: 'Use WebSocket instead of polling for new blocks',
    estimatedImpact: '-50-100ms latency',
    implementationEffort: '1 day',
    potentialProfit: '+10-20% win rate',
    currentState: 'Using HTTP polling in some places',
    requiredChanges: [
      'Switch to eth_subscribe for newHeads',
      'Implement reconnection logic',
      'Add Alchemy/QuickNode APIs',
    ],
  },
  {
    category: 'infrastructure',
    priority: 'critical',
    title: 'Private Mempool Integration',
    description: 'Submit txs via Flashbots/MEV-Share to avoid frontrunning',
    estimatedImpact: '+15-25% effective profit',
    implementationEffort: '1 week',
    potentialProfit: '+$150-500/month',
    currentState: 'Not using private mempools',
    requiredChanges: [
      'Integrate Flashbots Protect',
      'Add MEV-Share for mainnet',
      'Use MEV Blocker for L2s',
      'Implement bundle submission',
    ],
  },
  {
    category: 'infrastructure',
    priority: 'high',
    title: 'Multi-RPC Failover with Latency Routing',
    description: 'Use fastest RPC dynamically, failover on errors',
    estimatedImpact: '-20-40ms avg latency',
    implementationEffort: '2-3 days',
    potentialProfit: '+5-10% win rate',
    currentState: 'Single RPC per chain',
    requiredChanges: [
      'Add multiple RPC providers per chain',
      'Implement latency tracking',
      'Route to fastest available RPC',
      'Add circuit breaker for failed RPCs',
    ],
  },
  {
    category: 'infrastructure',
    priority: 'high',
    title: 'Local Execution Simulation',
    description: 'Simulate trades locally before sending to reduce failures',
    estimatedImpact: '-50% failed tx rate',
    implementationEffort: '1 week',
    potentialProfit: '+$50-150/month saved',
    currentState: 'Limited simulation',
    requiredChanges: [
      'Use eth_call for pre-execution checks',
      'Add Foundry anvil fork for complex simulations',
      'Cache pool state locally',
      'Implement trace_call for debugging',
    ],
  },
  {
    category: 'infrastructure',
    priority: 'medium',
    title: 'Colocated Infrastructure',
    description: 'Run bots in same datacenter as RPC nodes',
    estimatedImpact: '-5-15ms latency',
    implementationEffort: 'Ongoing cost',
    potentialProfit: '+10-20% win rate',
    currentState: 'Standard cloud hosting',
    requiredChanges: [
      'Deploy to AWS/GCP near RPC providers',
      'Use Bloxroute/Fiber for ultra-low latency',
      'Consider bare metal for critical paths',
    ],
  },

  {
    category: 'optimization',
    priority: 'critical',
    title: 'Dynamic Gas Pricing',
    description: 'Adjust gas based on opportunity value and competition',
    estimatedImpact: '+15-25% effective profit',
    implementationEffort: '3-5 days',
    potentialProfit: '+$100-400/month',
    currentState: 'Fixed gas multipliers',
    requiredChanges: [
      'Model gas as function of profit opportunity',
      'Track competitor gas patterns',
      'Implement Kelly criterion for gas bidding',
      'Add time-of-day gas patterns',
    ],
  },
  {
    category: 'optimization',
    priority: 'high',
    title: 'Optimal Trade Sizing',
    description: 'Calculate size that maximizes profit after slippage',
    estimatedImpact: '+10-20% per-trade profit',
    implementationEffort: '1 week',
    potentialProfit: '+$100-300/month',
    currentState: 'Fixed trade sizes',
    requiredChanges: [
      'Implement slippage curve modeling',
      'Calculate marginal profit vs size',
      'Find optimal point on curve',
      'Account for gas costs in optimization',
    ],
  },
  {
    category: 'optimization',
    priority: 'high',
    title: 'Path Optimization for Multi-hop',
    description: 'Find most profitable multi-hop paths efficiently',
    estimatedImpact: '+20-30% opportunities found',
    implementationEffort: '1-2 weeks',
    potentialProfit: '+$100-400/month',
    currentState: 'Basic 2-3 hop paths',
    requiredChanges: [
      'Implement Bellman-Ford for negative cycles',
      'Add graph caching and incremental updates',
      'Consider V3 tick-level routing',
      'Add cross-DEX path finding',
    ],
  },
  {
    category: 'optimization',
    priority: 'medium',
    title: 'Token Approval Batching',
    description: 'Pre-approve tokens and batch approvals',
    estimatedImpact: '-$50-100/month in gas',
    implementationEffort: '2-3 days',
    potentialProfit: '+$50-100/month saved',
    currentState: 'Approving per-trade',
    requiredChanges: [
      'Use infinite approvals where safe',
      'Batch approve common tokens on startup',
      'Use Permit2 where available',
    ],
  },

  {
    category: 'risk_reduction',
    priority: 'critical',
    title: 'Circuit Breakers',
    description: 'Auto-stop on excessive losses or unusual conditions',
    estimatedImpact: 'Protect from catastrophic loss',
    implementationEffort: '2-3 days',
    potentialProfit: 'Risk mitigation',
    currentState: 'Limited stop-loss logic',
    requiredChanges: [
      'Add hourly/daily loss limits',
      'Detect unusual gas prices (>10x normal)',
      'Monitor contract reverts',
      'Alert on consecutive failures',
    ],
  },
  {
    category: 'risk_reduction',
    priority: 'high',
    title: 'Pool Validation',
    description: 'Verify pools are legitimate before trading',
    estimatedImpact: 'Avoid rug pulls and honeypots',
    implementationEffort: '1 week',
    potentialProfit: 'Risk mitigation',
    currentState: 'Limited validation',
    requiredChanges: [
      'Check pool age and volume history',
      'Verify token contract is not honeypot',
      'Require minimum TVL ($100K+)',
      'Check for renounced ownership',
    ],
  },
  {
    category: 'risk_reduction',
    priority: 'medium',
    title: 'Reorg Protection',
    description: 'Wait for confirmations before counting profits',
    estimatedImpact: 'Avoid false profit counting',
    implementationEffort: '1-2 days',
    potentialProfit: 'Risk mitigation',
    currentState: 'Counting immediately',
    requiredChanges: [
      'Track pending vs confirmed txs',
      'Wait 2+ blocks for L2s',
      'Wait 6+ blocks for mainnet',
      'Handle uncle/ommer blocks',
    ],
  },

  {
    category: 'new_revenue',
    priority: 'high',
    title: 'MEV-Share Revenue',
    description: 'Share MEV with users to get preferred order flow',
    estimatedImpact: 'New revenue stream',
    implementationEffort: '2-3 weeks',
    potentialProfit: '$200-800/month',
    currentState: 'Not participating',
    requiredChanges: [
      'Integrate Flashbots MEV-Share',
      'Implement user refund mechanism',
      'Build reputation for order flow',
    ],
  },
  {
    category: 'new_revenue',
    priority: 'medium',
    title: 'Builder Partnerships',
    description: 'Partner with block builders for guaranteed inclusion',
    estimatedImpact: '+20-30% inclusion rate',
    implementationEffort: 'Relationship building',
    potentialProfit: '+$100-400/month',
    currentState: 'No partnerships',
    requiredChanges: [
      'Establish relationships with top builders',
      'Negotiate priority inclusion deals',
      'Implement builder-specific submission',
    ],
  },
  {
    category: 'new_revenue',
    priority: 'medium',
    title: 'Cross-Protocol Composability',
    description: 'Combine multiple protocols in single tx for complex arb',
    estimatedImpact: 'Access to complex opportunities',
    implementationEffort: '2-4 weeks',
    potentialProfit: '$100-500/month',
    currentState: 'Single-protocol trades',
    requiredChanges: [
      'Build composable execution contract',
      'Add flash loan + multi-swap + deposit',
      'Implement complex path execution',
    ],
  },
]

// Missing protocols that could be integrated
const MISSING_PROTOCOLS: MissingProtocol[] = [
  {
    name: 'Morpho',
    type: 'lending',
    chain: 'Ethereum, Base',
    tvl: '$2B',
    opportunity: 'Liquidations + rate arb',
  },
  {
    name: 'Spark (MakerDAO)',
    type: 'lending',
    chain: 'Ethereum',
    tvl: '$3B',
    opportunity: 'DAI rate arb',
  },
  {
    name: 'Euler V2',
    type: 'lending',
    chain: 'Ethereum',
    tvl: '$500M',
    opportunity: 'New protocol, less competition',
  },
  {
    name: 'Fluid',
    type: 'lending',
    chain: 'Ethereum',
    tvl: '$500M',
    opportunity: 'Liquidations',
  },
  {
    name: 'Karak',
    type: 'restaking',
    chain: 'Ethereum',
    tvl: '$1B',
    opportunity: 'New restaking protocol',
  },
  {
    name: 'Symbiotic',
    type: 'restaking',
    chain: 'Ethereum',
    tvl: '$800M',
    opportunity: 'Restaking arb',
  },
  {
    name: 'Vertex',
    type: 'perps',
    chain: 'Arbitrum',
    tvl: '$200M',
    opportunity: 'Funding arb',
  },
  {
    name: 'Hyperliquid',
    type: 'perps',
    chain: 'Hyperliquid L1',
    tvl: '$1B',
    opportunity: 'Funding arb',
  },
  {
    name: 'Maverick V2',
    type: 'dex',
    chain: 'Multiple',
    tvl: '$100M',
    opportunity: 'Dynamic LP arb',
  },
  {
    name: 'Trader Joe V2.1',
    type: 'dex',
    chain: 'Avalanche, Arbitrum',
    tvl: '$200M',
    opportunity: 'LB arb',
  },
]

// Latency optimizations
const LATENCY_OPTIMIZATIONS: LatencyOptimization[] = [
  {
    component: 'Block detection',
    currentLatency: '100-200ms (HTTP polling)',
    targetLatency: '10-20ms',
    improvement: 'WebSocket subscription',
    implementation: 'eth_subscribe + reconnection logic',
  },
  {
    component: 'Price fetching',
    currentLatency: '50-100ms per call',
    targetLatency: '5-10ms',
    improvement: 'Local state caching + events',
    implementation: 'Subscribe to Sync events, update local state',
  },
  {
    component: 'TX submission',
    currentLatency: '100-300ms',
    targetLatency: '20-50ms',
    improvement: 'Direct builder submission',
    implementation: 'Flashbots/Bloxroute direct submission',
  },
  {
    component: 'RPC round-trip',
    currentLatency: '30-80ms',
    targetLatency: '5-15ms',
    improvement: 'Colocated nodes',
    implementation: 'Run in same datacenter as Alchemy/QuickNode',
  },
  {
    component: 'Quote calculation',
    currentLatency: '10-30ms',
    targetLatency: '1-5ms',
    improvement: 'WASM-optimized math',
    implementation: 'Rewrite AMM math in Rust/WASM',
  },
]
async function main() {
  console.log('')
  console.log(
    '╔══════════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                    IMPROVEMENT ANALYSIS                              ║',
  )
  console.log(
    '║           Optimizations, Gaps, and Profit Opportunities             ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════════════╝',
  )
  console.log('')

  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  CRITICAL IMPROVEMENTS (implement first)')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')

  const critical = IMPROVEMENTS.filter((i) => i.priority === 'critical')
  for (const imp of critical) {
    console.log(`  ⚡ ${imp.title}`)
    console.log(`     ${imp.description}`)
    console.log(`     Impact: ${imp.estimatedImpact}`)
    console.log(`     Profit: ${imp.potentialProfit}`)
    console.log(`     Effort: ${imp.implementationEffort}`)
    console.log('')
  }

  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  HIGH PRIORITY IMPROVEMENTS')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')

  const high = IMPROVEMENTS.filter((i) => i.priority === 'high')
  for (const imp of high) {
    console.log(`  📈 ${imp.title}: ${imp.potentialProfit}`)
  }
  console.log('')

  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  MISSING PROTOCOL INTEGRATIONS')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')
  console.log(
    '  ┌────────────────────┬────────────┬────────────────┬─────────────────────────┐',
  )
  console.log(
    '  │ Protocol           │ TVL        │ Chain          │ Opportunity             │',
  )
  console.log(
    '  ├────────────────────┼────────────┼────────────────┼─────────────────────────┤',
  )

  for (const protocol of MISSING_PROTOCOLS) {
    console.log(
      `  │ ${protocol.name.padEnd(18)} │ ${protocol.tvl.padEnd(10)} │ ${protocol.chain.padEnd(14)} │ ${protocol.opportunity.padEnd(23)} │`,
    )
  }
  console.log(
    '  └────────────────────┴────────────┴────────────────┴─────────────────────────┘',
  )
  console.log('')

  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  LATENCY OPTIMIZATION TARGETS')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')
  console.log(
    '  ┌──────────────────────┬─────────────────────┬────────────────┬─────────────────────────┐',
  )
  console.log(
    '  │ Component            │ Current             │ Target         │ Implementation          │',
  )
  console.log(
    '  ├──────────────────────┼─────────────────────┼────────────────┼─────────────────────────┤',
  )

  for (const opt of LATENCY_OPTIMIZATIONS) {
    console.log(
      `  │ ${opt.component.padEnd(20)} │ ${opt.currentLatency.padEnd(19)} │ ${opt.targetLatency.padEnd(14)} │ ${opt.improvement.padEnd(23)} │`,
    )
  }
  console.log(
    '  └──────────────────────┴─────────────────────┴────────────────┴─────────────────────────┘',
  )
  console.log('')

  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  TOTAL PROFIT POTENTIAL')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')
  console.log('  Current realistic monthly: $400-$1,000')
  console.log('')
  console.log('  After implementing improvements:')
  console.log('    - JIT Liquidity:               +$500-2000/month')
  console.log('    - Backrun Strategy:            +$300-1000/month')
  console.log('    - Private Mempool:             +$150-500/month')
  console.log('    - Dynamic Gas Pricing:         +$100-400/month')
  console.log(
    '    - Latency Optimizations:       +$200-600/month (via win rate)',
  )
  console.log('    - New Protocol Integrations:   +$300-800/month')
  console.log('    - Intent Solver Expansion:     +$200-600/month')
  console.log('    ─────────────────────────────────────────────')
  console.log('    TOTAL POTENTIAL:               $1,750-6,900/month')
  console.log('')
  console.log('  NOTE: These are additive estimates and assume:')
  console.log('    - 15-30ms latency achieved')
  console.log('    - Private mempool usage')
  console.log('    - $100K+ capital deployed')
  console.log('    - Full-time monitoring and optimization')
  console.log('')

  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  RECOMMENDED IMPLEMENTATION ROADMAP')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')
  console.log('  Week 1-2: Infrastructure Foundation')
  console.log('    □ Implement WebSocket block subscription')
  console.log('    □ Add Flashbots Protect integration')
  console.log('    □ Set up multi-RPC failover')
  console.log('    □ Add circuit breakers')
  console.log('')
  console.log('  Week 3-4: Core Optimizations')
  console.log('    □ Dynamic gas pricing')
  console.log('    □ Optimal trade sizing')
  console.log('    □ Local execution simulation')
  console.log('    □ Pool validation')
  console.log('')
  console.log('  Week 5-6: New Strategies')
  console.log('    □ JIT Liquidity (requires low latency first)')
  console.log('    □ Backrun strategy')
  console.log('    □ Oracle update arbitrage')
  console.log('')
  console.log('  Week 7-8: Protocol Expansion')
  console.log('    □ Add Morpho, Spark liquidations')
  console.log('    □ Expand intent solver (Cowswap, UniswapX)')
  console.log('    □ Add Hyperliquid funding arb')
  console.log('')
  console.log('  Ongoing:')
  console.log('    □ Monitor for new protocols')
  console.log('    □ Optimize based on performance data')
  console.log('    □ Build builder relationships')
  console.log('')

  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('  QUICK WINS (implement today)')
  console.log(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  )
  console.log('')
  console.log('  1. Switch to WebSocket subscriptions (1 day, -50ms latency)')
  console.log('  2. Add infinite token approvals (1 hour, save gas)')
  console.log('  3. Implement basic circuit breakers (2 hours, risk reduction)')
  console.log('  4. Add pool TVL filtering (1 hour, avoid low liquidity)')
  console.log('  5. Enable Flashbots Protect (30 min, avoid frontrunning)')
  console.log('')

  console.log(
    '╔══════════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                           SUMMARY                                    ║',
  )
  console.log(
    '╠══════════════════════════════════════════════════════════════════════╣',
  )
  console.log(
    '║  Current state: Basic arb with competition, $400-1000/month          ║',
  )
  console.log(
    '║  With optimizations: $2,000-7,000/month potential                    ║',
  )
  console.log(
    '║  Key blockers: Latency, private mempool, strategy diversification   ║',
  )
  console.log(
    '║                                                                      ║',
  )
  console.log(
    '║  Most impactful: JIT Liquidity + Private Mempool + Low Latency      ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════════════╝',
  )
}

if (import.meta.main) {
  main().catch(console.error)
}

export { IMPROVEMENTS, MISSING_PROTOCOLS, LATENCY_OPTIMIZATIONS }

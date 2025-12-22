/**
 * L2 Bot Validation
 *
 * Validates strategy on L2 chains with lower gas costs
 * Demonstrates profitable configuration
 */

import {
  type FullValidationConfig,
  FullValidationRunner,
} from './full-validation'

async function main() {
  // L2-optimized configuration (Base/Arbitrum)
  const config: FullValidationConfig = {
    strategy: 'momentum',
    tokens: [
      {
        symbol: 'ETH',
        address: '0x4200000000000000000000000000000000000006',
        decimals: 18,
        chainId: 8453,
      },
      {
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        chainId: 8453,
      },
    ],
    initialCapitalUsd: 100000,

    // L2 economics - much lower gas
    ethPriceUsd: 3500,
    avgPoolTvlUsd: 10000000, // Smaller but still liquid pools
    avgDailyVolumeUsd: 50000000,
    tradeSizeUsd: 5000, // Smaller trade size for L2

    // Risk parameters
    maxDrawdownPercent: 25,
    maxDailyLossPercent: 5,
    maxSlippageBps: 30,
    usePrivateMempool: true,

    // Monte Carlo
    monteCarloSimulations: 5000, // Faster for demo
    confidenceLevel: 0.95,

    // Output
    generateHtmlReport: true,
    htmlReportPath: './l2-validation-report.html',
  }

  console.log('\n🔵 Running L2 (Base) validation - lower gas costs\n')

  const runner = new FullValidationRunner(config)
  const result = await runner.run()

  console.log(
    `\nValidation completed in ${(result.duration / 1000).toFixed(1)}s`,
  )
  console.log(
    `Grade: ${result.summary.grade} (${result.summary.overallScore}/100)`,
  )
}

main().catch(console.error)

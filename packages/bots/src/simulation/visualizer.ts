/**
 * Visualization & Reporting Module
 *
 * Generates:
 * - ASCII charts for terminal output
 * - HTML reports with SVG charts
 * - Performance dashboards
 * - Risk metrics visualizations
 *
 * Note: This module is serverless-compatible. HTML reports are returned as strings.
 * Use JejuStorageClient or your storage service to persist reports.
 */

import type { BacktestResult, PortfolioSnapshot } from '../types'
import type { CompetitionSimResult } from './mev-competition'
import type { MonteCarloResult, ValidationResult } from './monte-carlo'
import type { StressTestResult } from './stress-tests'
export interface ChartConfig {
  width: number
  height: number
  showAxis: boolean
  colors?: string[]
}

export interface ReportConfig {
  title: string
  outputPath: string
  includeCharts: boolean
  includeStats: boolean
  includeMonteCarlo: boolean
  includeWalkForward: boolean
}
function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  if (Math.abs(n) < 0.01) return n.toExponential(2)
  return n.toFixed(2)
}

/**
 * Draw ASCII line chart
 */
function asciiLineChart(
  data: number[],
  config: { width?: number; height?: number; title?: string } = {},
): string {
  const width = config.width ?? 60
  const height = config.height ?? 15
  const title = config.title ?? ''

  if (data.length === 0) return 'No data to display'

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  // Create grid
  const grid: string[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(' '))

  // Plot data points
  for (let x = 0; x < width; x++) {
    const dataIdx = Math.floor((x * data.length) / width)
    const value = data[dataIdx]
    const y = Math.floor(((value - min) / range) * (height - 1))
    const chartY = height - 1 - y
    grid[chartY][x] = '█'

    // Fill below for area effect
    for (let fillY = chartY + 1; fillY < height; fillY++) {
      grid[fillY][x] = '░'
    }
  }

  // Build output
  const lines: string[] = []
  if (title) {
    lines.push(`╔${'═'.repeat(width + 2)}╗`)
    lines.push(`║ ${title.padEnd(width)} ║`)
    lines.push(`╠${'═'.repeat(width + 2)}╣`)
  } else {
    lines.push(`┌${'─'.repeat(width)}┐`)
  }

  // Y-axis labels
  for (let y = 0; y < height; y++) {
    const value = max - (y / (height - 1)) * range
    const label = formatNumber(value).padStart(8)
    lines.push(`${label} │${grid[y].join('')}│`)
  }

  lines.push(`${''.padStart(9)}└${'─'.repeat(width)}┘`)
  lines.push(
    `${''.padStart(10)}0${''.padStart(Math.floor(width / 2) - 1)}${data.length}`,
  )

  return lines.join('\n')
}

/**
 * Draw ASCII bar chart
 */
function asciiBarChart(
  data: Array<{ label: string; value: number }>,
  config: { width?: number; maxLabelWidth?: number } = {},
): string {
  const width = config.width ?? 50
  const maxLabelWidth = config.maxLabelWidth ?? 15

  if (data.length === 0) return 'No data to display'

  const max = Math.max(...data.map((d) => Math.abs(d.value)))
  const lines: string[] = []

  for (const item of data) {
    const label = item.label.slice(0, maxLabelWidth).padEnd(maxLabelWidth)
    const barWidth = Math.floor((Math.abs(item.value) / max) * width)
    const isNegative = item.value < 0

    const bar = isNegative
      ? '█'.repeat(barWidth).padStart(width)
      : '█'.repeat(barWidth)

    const valueStr = formatNumber(item.value)
    lines.push(`${label} │${bar}│ ${valueStr}`)
  }

  return lines.join('\n')
}

/**
 * Draw ASCII histogram
 */
function asciiHistogram(
  data: number[],
  bins: number = 20,
  config: { width?: number; height?: number } = {},
): string {
  const width = config.width ?? 60
  const height = config.height ?? 10

  if (data.length === 0) return 'No data to display'

  const min = Math.min(...data)
  const max = Math.max(...data)
  const binWidth = (max - min) / bins

  // Count values in each bin
  const counts = Array(bins).fill(0)
  for (const value of data) {
    const binIdx = Math.min(bins - 1, Math.floor((value - min) / binWidth))
    counts[binIdx]++
  }

  const maxCount = Math.max(...counts)
  const lines: string[] = []

  // Draw histogram
  for (let y = height - 1; y >= 0; y--) {
    const threshold = (y / (height - 1)) * maxCount
    let row = ''
    for (let x = 0; x < bins; x++) {
      const chartBarWidth = Math.floor(width / bins)
      if (counts[x] >= threshold) {
        row += '█'.repeat(chartBarWidth)
      } else {
        row += ' '.repeat(chartBarWidth)
      }
    }
    lines.push(`│${row}│`)
  }

  lines.push(`└${'─'.repeat(width)}┘`)
  lines.push(
    ` ${formatNumber(min).padStart(10)}${''.padStart(width - 20)}${formatNumber(max).padStart(10)}`,
  )

  return lines.join('\n')
}

/**
 * Draw ASCII sparkline (compact inline chart)
 */
function asciiSparkline(data: number[]): string {
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  if (data.length === 0) return ''

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  return data
    .map((v) => {
      const idx = Math.floor(((v - min) / range) * (chars.length - 1))
      return chars[idx]
    })
    .join('')
}

/**
 * Draw ASCII table
 */
function asciiTable(
  headers: string[],
  rows: string[][],
  config: { columnWidth?: number } = {},
): string {
  const colWidth = config.columnWidth ?? 15
  const lines: string[] = []

  // Header
  const headerRow = headers
    .map((h) => h.padEnd(colWidth).slice(0, colWidth))
    .join('│')
  lines.push(
    `${`┌${'─'.repeat(colWidth)}${`┬${'─'.repeat(colWidth)}`}`.repeat(
      headers.length - 1,
    )}─┐`,
  )
  lines.push(`│${headerRow}│`)
  lines.push(
    `${`├${'─'.repeat(colWidth)}${`┼${'─'.repeat(colWidth)}`}`.repeat(
      headers.length - 1,
    )}─┤`,
  )

  // Data rows
  for (const row of rows) {
    const dataRow = row
      .map((c) => c.padEnd(colWidth).slice(0, colWidth))
      .join('│')
    lines.push(`│${dataRow}│`)
  }

  lines.push(
    `${`└${'─'.repeat(colWidth)}${`┴${'─'.repeat(colWidth)}`}`.repeat(
      headers.length - 1,
    )}─┘`,
  )

  return lines.join('\n')
}

/** Namespace for backward compatibility */
export const ASCIICharts = {
  lineChart: asciiLineChart,
  barChart: asciiBarChart,
  histogram: asciiHistogram,
  sparkline: asciiSparkline,
  table: asciiTable,
  formatNumber,
}
function calculateDrawdownSeries(values: number[]): number[] {
  const drawdowns: number[] = []
  let peak = values[0]

  for (const value of values) {
    if (value > peak) peak = value
    drawdowns.push((peak - value) / peak)
  }

  return drawdowns
}

export namespace TerminalReport {
  /**
   * Print comprehensive backtest report
   */
  export function printBacktestReport(result: BacktestResult): void {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('  BACKTEST REPORT')
    console.log('═'.repeat(70))

    // Key Metrics
    console.log('\n📊 KEY METRICS')
    console.log('─'.repeat(40))
    console.log(`  Total Return:     ${(result.totalReturn * 100).toFixed(2)}%`)
    console.log(`  Sharpe Ratio:     ${result.sharpeRatio.toFixed(3)}`)
    console.log(`  Max Drawdown:     ${(result.maxDrawdown * 100).toFixed(2)}%`)
    console.log(`  Win Rate:         ${(result.winRate * 100).toFixed(1)}%`)
    console.log(`  Total Trades:     ${result.totalTrades}`)
    console.log(`  Total Fees:       $${result.totalFees.toFixed(2)}`)

    // Equity Curve
    if (result.snapshots.length > 0) {
      console.log('\n📈 EQUITY CURVE')
      const values = result.snapshots.map((s: PortfolioSnapshot) => s.valueUsd)
      console.log(
        ASCIICharts.lineChart(values, {
          width: 60,
          height: 12,
          title: 'Portfolio Value (USD)',
        }),
      )
    }

    // Drawdown Chart
    console.log('\n📉 DRAWDOWN')
    const drawdowns = calculateDrawdownSeries(
      result.snapshots.map((s: PortfolioSnapshot) => s.valueUsd),
    )
    console.log(
      ASCIICharts.lineChart(
        drawdowns.map((d) => -d * 100),
        { width: 60, height: 8, title: 'Drawdown (%)' },
      ),
    )
  }

  /**
   * Print Monte Carlo report
   */
  export function printMonteCarloReport(result: MonteCarloResult): void {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('  MONTE CARLO ANALYSIS')
    console.log('═'.repeat(70))

    console.log(`\n  Simulations: ${result.simulations.toLocaleString()}`)

    // Return Distribution
    console.log('\n📊 RETURN DISTRIBUTION')
    console.log('─'.repeat(40))
    console.log(`  Mean Return:      ${(result.meanReturn * 100).toFixed(2)}%`)
    console.log(
      `  Median Return:    ${(result.medianReturn * 100).toFixed(2)}%`,
    )
    console.log(`  Std Dev:          ${(result.stdDev * 100).toFixed(2)}%`)
    console.log(`  Skewness:         ${result.skewness.toFixed(3)}`)
    console.log(`  Kurtosis:         ${result.kurtosis.toFixed(3)}`)

    // Risk Metrics
    console.log('\n⚠️  RISK METRICS')
    console.log('─'.repeat(40))
    console.log(`  VaR (95%):        ${(result.var95 * 100).toFixed(2)}%`)
    console.log(`  CVaR (95%):       ${(result.cvar95 * 100).toFixed(2)}%`)
    console.log(
      `  P(Profit):        ${(result.probabilityOfProfit * 100).toFixed(1)}%`,
    )
    console.log(
      `  P(Ruin):          ${(result.probabilityOfRuin * 100).toFixed(1)}%`,
    )
    console.log(`  Kelly Fraction:   ${(result.kelly * 100).toFixed(1)}%`)

    // Confidence Intervals
    console.log('\n📐 95% CONFIDENCE INTERVALS')
    console.log('─'.repeat(40))
    console.log(
      `  Sharpe Ratio:     [${result.sharpeRatio.ci95[0].toFixed(2)}, ${result.sharpeRatio.ci95[1].toFixed(2)}]`,
    )
    console.log(
      `  Max Drawdown:     [${(result.maxDrawdown.ci95[0] * 100).toFixed(1)}%, ${(result.maxDrawdown.ci95[1] * 100).toFixed(1)}%]`,
    )
    console.log(
      `  Win Rate:         [${(result.winRate.ci95[0] * 100).toFixed(1)}%, ${(result.winRate.ci95[1] * 100).toFixed(1)}%]`,
    )

    // Distribution Histogram
    console.log('\n📊 RETURN DISTRIBUTION HISTOGRAM')
    console.log(
      ASCIICharts.histogram(
        result.distribution.map((r) => r * 100),
        25,
        { width: 50, height: 8 },
      ),
    )
  }

  /**
   * Print validation report
   */
  export function printValidationReport(result: ValidationResult): void {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('  VALIDATION REPORT')
    console.log('═'.repeat(70))

    // In-Sample vs Out-of-Sample
    console.log('\n📊 IN-SAMPLE vs OUT-OF-SAMPLE')
    console.log(
      ASCIICharts.table(
        ['Metric', 'In-Sample', 'Out-of-Sample', 'Change'],
        [
          [
            'Total Return',
            `${(result.inSample.totalReturn * 100).toFixed(1)}%`,
            `${(result.outOfSample.totalReturn * 100).toFixed(1)}%`,
            `${(((result.outOfSample.totalReturn - result.inSample.totalReturn) / Math.abs(result.inSample.totalReturn)) * 100).toFixed(0)}%`,
          ],
          [
            'Sharpe Ratio',
            result.inSample.sharpeRatio.toFixed(2),
            result.outOfSample.sharpeRatio.toFixed(2),
            `${-result.degradation.toFixed(0)}%`,
          ],
          [
            'Max Drawdown',
            `${(result.inSample.maxDrawdown * 100).toFixed(1)}%`,
            `${(result.outOfSample.maxDrawdown * 100).toFixed(1)}%`,
            '',
          ],
          [
            'Win Rate',
            `${(result.inSample.winRate * 100).toFixed(1)}%`,
            `${(result.outOfSample.winRate * 100).toFixed(1)}%`,
            '',
          ],
          [
            'Profit Factor',
            result.inSample.profitFactor.toFixed(2),
            result.outOfSample.profitFactor.toFixed(2),
            '',
          ],
        ],
      ),
    )

    // Overfit Assessment
    console.log('\n🔍 OVERFIT ASSESSMENT')
    console.log('─'.repeat(40))
    console.log(
      `  Overfit Score:    ${(result.overfitScore * 100).toFixed(0)}% ${result.overfit ? '⚠️ HIGH' : '✅ OK'}`,
    )
    console.log(`  Degradation:      ${result.degradation.toFixed(1)}%`)

    // Statistical Tests
    console.log('\n📐 STATISTICAL TESTS')
    console.log('─'.repeat(40))
    for (const test of result.statisticalTests) {
      const status = test.significant ? '❌' : '✅'
      console.log(`  ${status} ${test.name}`)
      console.log(
        `     p-value: ${test.pValue.toFixed(4)} | ${test.interpretation}`,
      )
    }

    // Recommendations
    if (result.recommendations.length > 0) {
      console.log('\n💡 RECOMMENDATIONS')
      console.log('─'.repeat(40))
      for (const rec of result.recommendations) {
        console.log(`  • ${rec}`)
      }
    }
  }

  /**
   * Print stress test report
   */
  export function printStressTestReport(results: StressTestResult[]): void {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('  STRESS TEST REPORT')
    console.log('═'.repeat(70))

    // Summary bar chart
    const chartData = results.map((r) => ({
      label: r.scenario.name.slice(0, 15),
      value: r.survivalMetrics.capitalPreserved - 100,
    }))
    console.log('\n📊 CAPITAL CHANGE BY SCENARIO')
    console.log(ASCIICharts.barChart(chartData))

    // Details table
    console.log('\n📋 SCENARIO DETAILS')
    console.log(
      ASCIICharts.table(
        ['Scenario', 'Return', 'Max DD', 'Survived', 'Recovery'],
        results.map((r) => [
          r.scenario.name.slice(0, 12),
          `${(r.backtest.totalReturn * 100).toFixed(1)}%`,
          `${(r.backtest.maxDrawdown * 100).toFixed(1)}%`,
          r.survivalMetrics.survived ? '✅' : '❌',
          `${r.survivalMetrics.recoveryDays.toFixed(0)}d`,
        ]),
      ),
    )
  }

  /**
   * Print MEV competition report
   */
  export function printMEVReport(result: CompetitionSimResult): void {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('  MEV COMPETITION ANALYSIS')
    console.log('═'.repeat(70))

    console.log('\n📊 PERFORMANCE')
    console.log('─'.repeat(40))
    console.log(`  Win Rate:         ${(result.winRate * 100).toFixed(2)}%`)
    console.log(`  Net Profit:       $${result.netProfit.toFixed(2)}`)
    console.log(`  Total Profit:     $${result.totalProfit.toFixed(2)}`)
    console.log(`  Gas Costs:        $${result.totalGasCost.toFixed(2)}`)

    // Profit by strategy
    console.log('\n📈 PROFIT BY STRATEGY')
    const stratData = Object.entries(result.profitByStrategy).map(
      ([label, value]) => ({ label, value }),
    )
    console.log(ASCIICharts.barChart(stratData))

    // Competition analysis
    console.log('\n🏁 COMPETITION METRICS')
    console.log('─'.repeat(40))
    console.log(
      `  Avg Competitors:  ${result.competitionAnalysis.avgCompetitors.toFixed(1)}`,
    )
    console.log(
      `  Lost to Latency:  ${result.competitionAnalysis.lostToLatency}`,
    )
    console.log(`  Lost to Price:    ${result.competitionAnalysis.lostToPrice}`)

    // Latency impact
    console.log('\n⏱️  LATENCY IMPACT')
    console.log('─'.repeat(40))
    console.log(`  Our Latency:      ${result.latencyImpact.avgLatencyMs}ms`)
    console.log(
      `  Missed Opps:      ${result.latencyImpact.missedOpportunities}`,
    )
    console.log(
      `  Potential Gain:   $${result.latencyImpact.optimalLatencyGain.toFixed(2)} (with 0 latency)`,
    )
  }
}
function generateSVGLineChart(
  data: number[],
  config: { width: number; height: number; color: string },
): string {
  if (data.length === 0) return '<p>No data</p>'

  const { width, height, color } = config
  const padding = 40
  const chartWidth = width - 2 * padding
  const chartHeight = height - 2 * padding

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * chartWidth
      const y = padding + (1 - (v - min) / range) * chartHeight
      return `${x},${y}`
    })
    .join(' ')

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${color};stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:${color};stop-opacity:0" />
        </linearGradient>
      </defs>

      <!-- Grid lines -->
      ${[0, 0.25, 0.5, 0.75, 1]
        .map((p) => {
          const y = padding + p * chartHeight
          return `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="#30363d" stroke-dasharray="4"/>
        <text x="${padding - 5}" y="${y + 4}" text-anchor="end" font-size="10">${((1 - p) * range + min).toFixed(0)}</text>`
        })
        .join('')}

      <!-- Area fill -->
      <polygon points="${padding},${padding + chartHeight} ${points} ${width - padding},${padding + chartHeight}" fill="url(#gradient)" />

      <!-- Line -->
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" />
    </svg>`
}

function generateSVGHistogram(data: number[], bins: number = 25): string {
  if (data.length === 0) return '<p>No data</p>'

  const width = 600
  const height = 200
  const padding = 40
  const chartWidth = width - 2 * padding
  const chartHeight = height - 2 * padding

  const min = Math.min(...data)
  const max = Math.max(...data)
  const binWidth = (max - min) / bins

  const counts = Array(bins).fill(0)
  for (const value of data) {
    const binIdx = Math.min(bins - 1, Math.floor((value - min) / binWidth))
    counts[binIdx]++
  }

  const maxCount = Math.max(...counts)
  const barWidth = chartWidth / bins

  const bars = counts
    .map((count, i) => {
      const x = padding + i * barWidth
      const barHeight = (count / maxCount) * chartHeight
      const y = padding + chartHeight - barHeight
      const color = min + (i + 0.5) * binWidth < 0 ? '#f85149' : '#3fb950'
      return `<rect x="${x}" y="${y}" width="${barWidth - 1}" height="${barHeight}" fill="${color}" opacity="0.7"/>`
    })
    .join('')

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${bars}
      <line x1="${padding}" y1="${padding + chartHeight}" x2="${width - padding}" y2="${padding + chartHeight}" stroke="#c9d1d9"/>
      <text x="${padding}" y="${height - 5}" font-size="10">${min.toFixed(1)}%</text>
      <text x="${width - padding}" y="${height - 5}" text-anchor="end" font-size="10">${max.toFixed(1)}%</text>
    </svg>`
}

function generateBacktestSection(result: BacktestResult): string {
  const returnClass = result.totalReturn >= 0 ? 'positive' : 'negative'
  const sharpeClass =
    result.sharpeRatio >= 1
      ? 'positive'
      : result.sharpeRatio >= 0
        ? 'neutral'
        : 'negative'

  // Generate SVG equity curve
  const equityCurve = generateSVGLineChart(
    result.snapshots.map((s: PortfolioSnapshot) => s.valueUsd),
    {
      width: 800,
      height: 200,
      color: result.totalReturn >= 0 ? '#3fb950' : '#f85149',
    },
  )

  return `
    <div class="card">
      <h2>📈 Backtest Results</h2>

      <div class="grid grid-4">
        <div class="stat">
          <div class="stat-value ${returnClass}">${(result.totalReturn * 100).toFixed(2)}%</div>
          <div class="stat-label">Total Return</div>
        </div>
        <div class="stat">
          <div class="stat-value ${sharpeClass}">${result.sharpeRatio.toFixed(2)}</div>
          <div class="stat-label">Sharpe Ratio</div>
        </div>
        <div class="stat">
          <div class="stat-value negative">${(result.maxDrawdown * 100).toFixed(2)}%</div>
          <div class="stat-label">Max Drawdown</div>
        </div>
        <div class="stat">
          <div class="stat-value">${(result.winRate * 100).toFixed(1)}%</div>
          <div class="stat-label">Win Rate</div>
        </div>
      </div>

      <div class="chart-container">
        <h3 style="margin-bottom: 1rem;">Equity Curve</h3>
        ${equityCurve}
      </div>

      <div class="grid grid-2">
        <div>
          <h3>Performance</h3>
          <table>
            <tr><td>Total Trades</td><td>${result.totalTrades}</td></tr>
            <tr><td>Total Fees</td><td>$${result.totalFees.toFixed(2)}</td></tr>
            <tr><td>Avg Trade Size</td><td>$${result.snapshots.length > 0 ? (result.snapshots[0].valueUsd / result.totalTrades).toFixed(0) : 0}</td></tr>
          </table>
        </div>
      </div>
    </div>`
}

function generateMonteCarloSection(result: MonteCarloResult): string {
  const histogram = generateSVGHistogram(
    result.distribution.map((r) => r * 100),
  )

  return `
    <div class="card">
      <h2>🎲 Monte Carlo Analysis</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1rem;">
        ${result.simulations.toLocaleString()} simulations performed
      </p>

      <div class="grid grid-4">
        <div class="stat">
          <div class="stat-value">${(result.probabilityOfProfit * 100).toFixed(1)}%</div>
          <div class="stat-label">Probability of Profit</div>
        </div>
        <div class="stat">
          <div class="stat-value negative">${(result.var95 * 100).toFixed(2)}%</div>
          <div class="stat-label">Value at Risk (95%)</div>
        </div>
        <div class="stat">
          <div class="stat-value negative">${(result.cvar95 * 100).toFixed(2)}%</div>
          <div class="stat-label">CVaR (95%)</div>
        </div>
        <div class="stat">
          <div class="stat-value">${(result.kelly * 100).toFixed(1)}%</div>
          <div class="stat-label">Kelly Fraction</div>
        </div>
      </div>

      <div class="chart-container">
        <h3 style="margin-bottom: 1rem;">Return Distribution</h3>
        ${histogram}
      </div>

      <h3 style="margin-top: 1.5rem;">95% Confidence Intervals</h3>
      <table>
        <tr>
          <th>Metric</th>
          <th>Mean</th>
          <th>Lower Bound</th>
          <th>Upper Bound</th>
        </tr>
        <tr>
          <td>Sharpe Ratio</td>
          <td>${result.sharpeRatio.mean.toFixed(3)}</td>
          <td>${result.sharpeRatio.ci95[0].toFixed(3)}</td>
          <td>${result.sharpeRatio.ci95[1].toFixed(3)}</td>
        </tr>
        <tr>
          <td>Max Drawdown</td>
          <td>${(result.maxDrawdown.mean * 100).toFixed(1)}%</td>
          <td>${(result.maxDrawdown.ci95[0] * 100).toFixed(1)}%</td>
          <td>${(result.maxDrawdown.ci95[1] * 100).toFixed(1)}%</td>
        </tr>
        <tr>
          <td>Win Rate</td>
          <td>${(result.winRate.mean * 100).toFixed(1)}%</td>
          <td>${(result.winRate.ci95[0] * 100).toFixed(1)}%</td>
          <td>${(result.winRate.ci95[1] * 100).toFixed(1)}%</td>
        </tr>
      </table>
    </div>`
}

function generateValidationSection(result: ValidationResult): string {
  const overfitBadge = result.overfit
    ? '<span class="badge badge-danger">HIGH RISK</span>'
    : '<span class="badge badge-success">LOW RISK</span>'

  return `
    <div class="card">
      <h2>🔍 Validation Analysis</h2>

      <div style="margin-bottom: 1.5rem;">
        <span style="margin-right: 1rem;">Overfit Risk:</span>
        ${overfitBadge}
        <span style="margin-left: 1rem; color: var(--text-secondary);">
          Score: ${(result.overfitScore * 100).toFixed(0)}%
        </span>
      </div>

      <h3>In-Sample vs Out-of-Sample</h3>
      <table>
        <tr>
          <th>Metric</th>
          <th>In-Sample</th>
          <th>Out-of-Sample</th>
          <th>Degradation</th>
        </tr>
        <tr>
          <td>Total Return</td>
          <td>${(result.inSample.totalReturn * 100).toFixed(2)}%</td>
          <td>${(result.outOfSample.totalReturn * 100).toFixed(2)}%</td>
          <td class="${result.outOfSample.totalReturn < result.inSample.totalReturn ? 'negative' : 'positive'}">
            ${result.inSample.totalReturn !== 0 ? ((result.outOfSample.totalReturn / result.inSample.totalReturn - 1) * 100).toFixed(0) : 0}%
          </td>
        </tr>
        <tr>
          <td>Sharpe Ratio</td>
          <td>${result.inSample.sharpeRatio.toFixed(3)}</td>
          <td>${result.outOfSample.sharpeRatio.toFixed(3)}</td>
          <td class="negative">${result.degradation.toFixed(0)}%</td>
        </tr>
        <tr>
          <td>Max Drawdown</td>
          <td>${(result.inSample.maxDrawdown * 100).toFixed(2)}%</td>
          <td>${(result.outOfSample.maxDrawdown * 100).toFixed(2)}%</td>
          <td></td>
        </tr>
      </table>

      <h3 style="margin-top: 1.5rem;">Statistical Tests</h3>
      <table>
        <tr>
          <th>Test</th>
          <th>p-value</th>
          <th>Result</th>
          <th>Interpretation</th>
        </tr>
        ${result.statisticalTests
          .map(
            (test) => `
        <tr>
          <td>${test.name}</td>
          <td>${test.pValue.toFixed(4)}</td>
          <td>${test.significant ? '<span class="badge badge-warning">SIGNIFICANT</span>' : '<span class="badge badge-success">OK</span>'}</td>
          <td style="font-size: 0.875rem;">${test.interpretation}</td>
        </tr>
        `,
          )
          .join('')}
      </table>

      ${
        result.recommendations.length > 0
          ? `
      <h3 style="margin-top: 1.5rem;">Recommendations</h3>
      <ul style="list-style: disc; padding-left: 1.5rem;">
        ${result.recommendations.map((rec) => `<li>${rec}</li>`).join('')}
      </ul>
      `
          : ''
      }
    </div>`
}

function generateStressTestSection(results: StressTestResult[]): string {
  const survived = results.filter((r) => r.survivalMetrics.survived).length
  const total = results.length

  return `
    <div class="card">
      <h2>🔥 Stress Test Results</h2>

      <div style="margin-bottom: 1.5rem;">
        <span style="font-size: 1.5rem; font-weight: 600;">
          ${survived}/${total}
        </span>
        <span style="color: var(--text-secondary);"> scenarios survived</span>

        <div class="progress-bar" style="width: 200px; display: inline-block; margin-left: 1rem; vertical-align: middle;">
          <div class="progress-fill" style="width: ${(survived / total) * 100}%; background: ${survived / total >= 0.75 ? 'var(--accent-green)' : 'var(--accent-red)'}"></div>
        </div>
      </div>

      <table>
        <tr>
          <th>Scenario</th>
          <th>Period</th>
          <th>Return</th>
          <th>Max DD</th>
          <th>Capital</th>
          <th>Recovery</th>
          <th>Status</th>
        </tr>
        ${results
          .map(
            (r) => `
        <tr>
          <td>${r.scenario.name}</td>
          <td style="font-size: 0.875rem;">${r.scenario.startDate.toLocaleDateString()} - ${r.scenario.endDate.toLocaleDateString()}</td>
          <td class="${r.backtest.totalReturn >= 0 ? 'positive' : 'negative'}">${(r.backtest.totalReturn * 100).toFixed(1)}%</td>
          <td class="negative">${(r.backtest.maxDrawdown * 100).toFixed(1)}%</td>
          <td>${r.survivalMetrics.capitalPreserved.toFixed(1)}%</td>
          <td>${r.survivalMetrics.recoveryDays.toFixed(0)} days</td>
          <td>${r.survivalMetrics.survived ? '<span class="badge badge-success">SURVIVED</span>' : '<span class="badge badge-danger">FAILED</span>'}</td>
        </tr>
        `,
          )
          .join('')}
      </table>
    </div>`
}

function generateMEVSection(result: CompetitionSimResult): string {
  return `
    <div class="card">
      <h2>🏁 MEV Competition Analysis</h2>

      <div class="grid grid-4">
        <div class="stat">
          <div class="stat-value">${(result.winRate * 100).toFixed(2)}%</div>
          <div class="stat-label">Win Rate</div>
        </div>
        <div class="stat">
          <div class="stat-value positive">$${result.netProfit.toFixed(0)}</div>
          <div class="stat-label">Net Profit</div>
        </div>
        <div class="stat">
          <div class="stat-value negative">$${result.totalGasCost.toFixed(0)}</div>
          <div class="stat-label">Gas Costs</div>
        </div>
        <div class="stat">
          <div class="stat-value">${result.latencyImpact.avgLatencyMs}ms</div>
          <div class="stat-label">Latency</div>
        </div>
      </div>

      <h3 style="margin-top: 1.5rem;">Profit by Strategy</h3>
      <table>
        <tr>
          <th>Strategy</th>
          <th>Profit</th>
          <th>Share</th>
        </tr>
        ${Object.entries(result.profitByStrategy)
          .sort((a, b) => b[1] - a[1])
          .map(
            ([strategy, profit]) => `
        <tr>
          <td>${strategy}</td>
          <td class="positive">$${profit.toFixed(2)}</td>
          <td>${((profit / result.totalProfit) * 100).toFixed(1)}%</td>
        </tr>
        `,
          )
          .join('')}
      </table>

      <h3 style="margin-top: 1.5rem;">Competition Metrics</h3>
      <div class="grid grid-3">
        <div>
          <strong>Avg Competitors:</strong> ${result.competitionAnalysis.avgCompetitors.toFixed(1)}
        </div>
        <div>
          <strong>Lost to Latency:</strong> ${result.competitionAnalysis.lostToLatency}
        </div>
        <div>
          <strong>Lost to Price:</strong> ${result.competitionAnalysis.lostToPrice}
        </div>
      </div>
    </div>`
}

export namespace HTMLReportGenerator {
  /**
   * Generate comprehensive HTML report
   */
  export function generate(
    config: ReportConfig,
    data: {
      backtest?: BacktestResult
      monteCarlo?: MonteCarloResult
      validation?: ValidationResult
      stressTests?: StressTestResult[]
      mevSim?: CompetitionSimResult
    },
  ): string {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.title}</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --accent-green: #3fb950;
      --accent-red: #f85149;
      --accent-blue: #58a6ff;
      --accent-yellow: #d29922;
      --border: #30363d;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem;
    }

    .container { max-width: 1400px; margin: 0 auto; }

    h1 {
      font-size: 2rem;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }

    h2 {
      font-size: 1.25rem;
      margin: 2rem 0 1rem;
      color: var(--text-primary);
    }

    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .grid { display: grid; gap: 1.5rem; }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }

    @media (max-width: 768px) {
      .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
    }

    .stat {
      text-align: center;
      padding: 1rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 600;
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-top: 0.5rem;
    }

    .positive { color: var(--accent-green); }
    .negative { color: var(--accent-red); }
    .neutral { color: var(--accent-blue); }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }

    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    th {
      background: var(--bg-tertiary);
      font-weight: 600;
    }

    .chart-container {
      background: var(--bg-tertiary);
      border-radius: 4px;
      padding: 1rem;
      margin: 1rem 0;
    }

    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .badge-success { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    .badge-danger { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }
    .badge-warning { background: rgba(210, 153, 34, 0.2); color: var(--accent-yellow); }

    .progress-bar {
      background: var(--bg-tertiary);
      border-radius: 4px;
      height: 8px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }

    svg text { fill: var(--text-primary); font-family: inherit; }
    svg .axis line, svg .axis path { stroke: var(--border); }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 ${config.title}</h1>
    <p style="color: var(--text-secondary); margin-bottom: 2rem;">
      Generated: ${new Date().toISOString()}
    </p>

    ${data.backtest ? generateBacktestSection(data.backtest) : ''}
    ${data.monteCarlo ? generateMonteCarloSection(data.monteCarlo) : ''}
    ${data.validation ? generateValidationSection(data.validation) : ''}
    ${data.stressTests ? generateStressTestSection(data.stressTests) : ''}
    ${data.mevSim ? generateMEVSection(data.mevSim) : ''}
  </div>
</body>
</html>`

    return html
  }

  /**
   * Get report as a blob for storage upload
   * @param html - The HTML content to convert
   * @returns Blob suitable for storage upload
   */
  export function toBlob(html: string): Blob {
    return new Blob([html], { type: 'text/html' })
  }

  /**
   * Get report as Buffer for storage upload
   * @param html - The HTML content to convert
   * @returns Buffer suitable for storage upload
   */
  export function toBuffer(html: string): Buffer {
    return Buffer.from(html, 'utf-8')
  }
}

/**
 * Load Test Analyzer
 *
 * Analyzes load test results to identify bottlenecks, weak points, and areas for improvement.
 */

import type {
  BottleneckAnalysis,
  CombinedLoadTestResult,
  LoadTestResult,
} from './types'

export function analyzeResults(
  results: LoadTestResult[],
  network: 'localnet' | 'testnet' | 'mainnet',
  scenario: string,
): CombinedLoadTestResult {
  const bottlenecks: BottleneckAnalysis[] = []

  for (const result of results) {
    // Analyze each result for bottlenecks
    const appBottlenecks = analyzeAppResult(result)
    bottlenecks.push(...appBottlenecks)
  }

  // Sort bottlenecks by severity
  const severityOrder = { critical: 0, warning: 1, info: 2 }
  bottlenecks.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  )

  // Generate recommendations
  const recommendations = generateRecommendations(bottlenecks)

  return {
    timestamp: new Date(),
    network,
    scenario,
    apps: results,
    overallHealthy:
      bottlenecks.filter((b) => b.severity === 'critical').length === 0,
    bottlenecks,
    recommendations,
  }
}

function analyzeAppResult(result: LoadTestResult): BottleneckAnalysis[] {
  const bottlenecks: BottleneckAnalysis[] = []

  // Check overall error rate
  if (result.errorRate > 0.1) {
    bottlenecks.push({
      app: result.app,
      severity: 'critical',
      category: 'errors',
      message: `High error rate: ${(result.errorRate * 100).toFixed(1)}%`,
      metric: 'errorRate',
      value: result.errorRate,
      threshold: 0.1,
      recommendation:
        'Investigate error logs, check service dependencies, verify database connections',
    })
  } else if (result.errorRate > 0.05) {
    bottlenecks.push({
      app: result.app,
      severity: 'warning',
      category: 'errors',
      message: `Elevated error rate: ${(result.errorRate * 100).toFixed(1)}%`,
      metric: 'errorRate',
      value: result.errorRate,
      threshold: 0.05,
      recommendation:
        'Review error patterns, add retry logic for transient failures',
    })
  }

  // Check P99 latency
  if (result.latency.p99 > 5000) {
    bottlenecks.push({
      app: result.app,
      severity: 'critical',
      category: 'latency',
      message: `Very high P99 latency: ${result.latency.p99.toFixed(0)}ms`,
      metric: 'p99Latency',
      value: result.latency.p99,
      threshold: 5000,
      recommendation:
        'Profile slow endpoints, check database queries, add caching',
    })
  } else if (result.latency.p99 > 2000) {
    bottlenecks.push({
      app: result.app,
      severity: 'warning',
      category: 'latency',
      message: `High P99 latency: ${result.latency.p99.toFixed(0)}ms`,
      metric: 'p99Latency',
      value: result.latency.p99,
      threshold: 2000,
      recommendation: 'Optimize database queries, consider connection pooling',
    })
  }

  // Check throughput
  if (result.rps < 10) {
    bottlenecks.push({
      app: result.app,
      severity: 'critical',
      category: 'throughput',
      message: `Very low throughput: ${result.rps.toFixed(0)} RPS`,
      metric: 'rps',
      value: result.rps,
      threshold: 10,
      recommendation:
        'Check for blocking operations, add horizontal scaling, optimize hot paths',
    })
  } else if (result.rps < 30) {
    bottlenecks.push({
      app: result.app,
      severity: 'warning',
      category: 'throughput',
      message: `Low throughput: ${result.rps.toFixed(0)} RPS`,
      metric: 'rps',
      value: result.rps,
      threshold: 30,
      recommendation:
        'Consider async processing, batch operations where possible',
    })
  }

  // Check for latency variance (stability)
  const latencyVariance = result.latency.max - result.latency.min
  if (result.latency.min > 0 && latencyVariance > result.latency.avg * 10) {
    bottlenecks.push({
      app: result.app,
      severity: 'warning',
      category: 'stability',
      message: `High latency variance: ${latencyVariance.toFixed(0)}ms spread`,
      metric: 'latencyVariance',
      value: latencyVariance,
      threshold: result.latency.avg * 10,
      recommendation:
        'Investigate GC pauses, connection pool exhaustion, or resource contention',
    })
  }

  // Check specific endpoint issues
  for (const endpoint of result.endpointStats) {
    if (endpoint.errorRate > 0.2) {
      bottlenecks.push({
        app: result.app,
        severity: 'critical',
        category: 'errors',
        endpoint: endpoint.endpoint,
        message: `Endpoint ${endpoint.endpoint} has ${(endpoint.errorRate * 100).toFixed(1)}% error rate`,
        metric: 'endpointErrorRate',
        value: endpoint.errorRate,
        threshold: 0.2,
        recommendation: `Review ${endpoint.endpoint} implementation and error handling`,
      })
    }

    if (endpoint.p99 > 3000) {
      bottlenecks.push({
        app: result.app,
        severity: 'warning',
        category: 'latency',
        endpoint: endpoint.endpoint,
        message: `Endpoint ${endpoint.endpoint} is slow: P99 ${endpoint.p99.toFixed(0)}ms`,
        metric: 'endpointP99',
        value: endpoint.p99,
        threshold: 3000,
        recommendation: `Optimize ${endpoint.endpoint} - check for N+1 queries or missing indexes`,
      })
    }
  }

  // Check threshold failures
  for (const failure of result.failures) {
    const severity = failure.threshold.includes('error')
      ? 'critical'
      : 'warning'
    bottlenecks.push({
      app: result.app,
      severity,
      category: failure.threshold.includes('Latency')
        ? 'latency'
        : failure.threshold.includes('Rps')
          ? 'throughput'
          : 'errors',
      message: failure.message,
      metric: failure.threshold,
      value: failure.actual,
      threshold: failure.expected,
      recommendation: `Investigate ${failure.threshold} - target is ${failure.expected}, actual is ${failure.actual}`,
    })
  }

  return bottlenecks
}

function generateRecommendations(bottlenecks: BottleneckAnalysis[]): string[] {
  const recommendations: string[] = []
  const seen = new Set<string>()

  // Group by category
  const byCategory = new Map<string, BottleneckAnalysis[]>()
  for (const b of bottlenecks) {
    const existing = byCategory.get(b.category) ?? []
    existing.push(b)
    byCategory.set(b.category, existing)
  }

  // High-priority: Critical issues
  const criticals = bottlenecks.filter((b) => b.severity === 'critical')
  if (criticals.length > 0) {
    const apps = [...new Set(criticals.map((b) => b.app))].join(', ')
    recommendations.push(
      `CRITICAL: Address issues in ${apps} before production deployment`,
    )
  }

  // Latency issues
  const latencyIssues = byCategory.get('latency') ?? []
  if (latencyIssues.length > 0) {
    for (const issue of latencyIssues) {
      if (!seen.has(issue.recommendation)) {
        recommendations.push(issue.recommendation)
        seen.add(issue.recommendation)
      }
    }
  }

  // Error issues
  const errorIssues = byCategory.get('errors') ?? []
  if (errorIssues.length > 0) {
    for (const issue of errorIssues) {
      if (!seen.has(issue.recommendation)) {
        recommendations.push(issue.recommendation)
        seen.add(issue.recommendation)
      }
    }
  }

  // Throughput issues
  const throughputIssues = byCategory.get('throughput') ?? []
  if (throughputIssues.length > 0) {
    for (const issue of throughputIssues) {
      if (!seen.has(issue.recommendation)) {
        recommendations.push(issue.recommendation)
        seen.add(issue.recommendation)
      }
    }
  }

  // Stability issues
  const stabilityIssues = byCategory.get('stability') ?? []
  if (stabilityIssues.length > 0) {
    recommendations.push(
      'Consider adding circuit breakers and timeouts to prevent cascade failures',
    )
  }

  // General recommendations
  if (bottlenecks.length === 0) {
    recommendations.push('All services performing within thresholds')
    recommendations.push(
      'Consider running stress tests to find breaking points',
    )
  }

  return recommendations
}

export function printResults(result: CombinedLoadTestResult): void {
  console.log(`\n${'═'.repeat(70)}`)
  console.log('  LOAD TEST RESULTS')
  console.log('═'.repeat(70))
  console.log(`  Network: ${result.network}`)
  console.log(`  Scenario: ${result.scenario}`)
  console.log(`  Timestamp: ${result.timestamp.toISOString()}`)
  console.log('═'.repeat(70))

  // Print per-app summary
  console.log('\n📊 APP SUMMARY')
  console.log('─'.repeat(70))

  for (const app of result.apps) {
    const status = app.thresholdsPassed ? '✅' : '❌'
    console.log(`\n${status} ${app.app}`)
    console.log(
      `   Requests: ${app.totalRequests} | RPS: ${app.rps.toFixed(1)}`,
    )
    console.log(
      `   Latency P50/P95/P99: ${app.latency.p50.toFixed(0)}/${app.latency.p95.toFixed(0)}/${app.latency.p99.toFixed(0)}ms`,
    )
    console.log(
      `   Errors: ${app.errorCount} (${(app.errorRate * 100).toFixed(2)}%)`,
    )

    if (app.failures.length > 0) {
      for (const f of app.failures) {
        console.log(`   ⚠️  ${f.message}`)
      }
    }
  }

  // Print bottlenecks
  if (result.bottlenecks.length > 0) {
    console.log('\n\n🔍 BOTTLENECKS IDENTIFIED')
    console.log('─'.repeat(70))

    const criticals = result.bottlenecks.filter(
      (b) => b.severity === 'critical',
    )
    const warnings = result.bottlenecks.filter((b) => b.severity === 'warning')
    const infos = result.bottlenecks.filter((b) => b.severity === 'info')

    if (criticals.length > 0) {
      console.log('\n🚨 CRITICAL:')
      for (const b of criticals) {
        console.log(`   [${b.app}] ${b.message}`)
        console.log(`      → ${b.recommendation}`)
      }
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:')
      for (const b of warnings) {
        console.log(`   [${b.app}] ${b.message}`)
        console.log(`      → ${b.recommendation}`)
      }
    }

    if (infos.length > 0) {
      console.log('\nℹ️  INFO:')
      for (const b of infos) {
        console.log(`   [${b.app}] ${b.message}`)
      }
    }
  }

  // Print recommendations
  console.log('\n\n💡 RECOMMENDATIONS')
  console.log('─'.repeat(70))
  for (const rec of result.recommendations) {
    console.log(`   • ${rec}`)
  }

  // Overall status
  console.log(`\n${'═'.repeat(70)}`)
  if (result.overallHealthy) {
    console.log('  ✅ OVERALL STATUS: HEALTHY')
  } else {
    console.log('  ❌ OVERALL STATUS: NEEDS ATTENTION')
  }
  console.log(`${'═'.repeat(70)}\n`)
}

export function generateReport(result: CombinedLoadTestResult): string {
  const lines: string[] = []

  lines.push('# Load Test Report')
  lines.push('')
  lines.push(`**Network:** ${result.network}`)
  lines.push(`**Scenario:** ${result.scenario}`)
  lines.push(`**Timestamp:** ${result.timestamp.toISOString()}`)
  lines.push(
    `**Status:** ${result.overallHealthy ? '✅ Healthy' : '❌ Needs Attention'}`,
  )
  lines.push('')

  lines.push('## Summary')
  lines.push('')
  lines.push('| App | RPS | P99 | Errors | Status |')
  lines.push('|-----|-----|-----|--------|--------|')

  for (const app of result.apps) {
    const status = app.thresholdsPassed ? '✅' : '❌'
    lines.push(
      `| ${app.app} | ${app.rps.toFixed(1)} | ${app.latency.p99.toFixed(0)}ms | ${(app.errorRate * 100).toFixed(2)}% | ${status} |`,
    )
  }

  if (result.bottlenecks.length > 0) {
    lines.push('')
    lines.push('## Bottlenecks')
    lines.push('')

    const criticals = result.bottlenecks.filter(
      (b) => b.severity === 'critical',
    )
    if (criticals.length > 0) {
      lines.push('### Critical')
      for (const b of criticals) {
        lines.push(`- **[${b.app}]** ${b.message}`)
        lines.push(`  - Recommendation: ${b.recommendation}`)
      }
    }

    const warnings = result.bottlenecks.filter((b) => b.severity === 'warning')
    if (warnings.length > 0) {
      lines.push('')
      lines.push('### Warnings')
      for (const b of warnings) {
        lines.push(`- **[${b.app}]** ${b.message}`)
        lines.push(`  - Recommendation: ${b.recommendation}`)
      }
    }
  }

  lines.push('')
  lines.push('## Recommendations')
  lines.push('')
  for (const rec of result.recommendations) {
    lines.push(`- ${rec}`)
  }

  return lines.join('\n')
}

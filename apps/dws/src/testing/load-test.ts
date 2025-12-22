/**
 * Load Testing Framework
 * Performance and stress testing for DWS services
 */

export interface LoadTestConfig {
  target: string // Base URL
  duration: number // Test duration in seconds
  rps: number // Target requests per second
  concurrency: number // Concurrent connections
  warmup?: number // Warmup period in seconds
  timeout?: number // Request timeout in ms
  headers?: Record<string, string>
  scenarios?: LoadTestScenario[]
}

// JSON serializable body type for load test scenarios
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface LoadTestScenario {
  name: string
  weight: number // Probability weight (0-100)
  method: string
  path: string
  body?: JsonValue
  headers?: Record<string, string>
  validate?: (response: Response) => boolean
}

export interface LoadTestResult {
  duration: number
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  avgLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  maxLatencyMs: number
  minLatencyMs: number
  requestsPerSecond: number
  bytesReceived: number
  bytesSent: number
  errorsByCode: Record<number, number>
  scenarioResults: Record<string, ScenarioResult>
}

export interface ScenarioResult {
  requests: number
  successes: number
  failures: number
  avgLatencyMs: number
  errorRate: number
}

interface RequestResult {
  success: boolean
  statusCode: number
  latencyMs: number
  bytesReceived: number
  bytesSent: number
  scenario: string
  error?: string
}

/**
 * Run load test
 */
export async function runLoadTest(
  config: LoadTestConfig,
): Promise<LoadTestResult> {
  const results: RequestResult[] = []

  const scenarios = config.scenarios ?? [
    { name: 'default', weight: 100, method: 'GET', path: '/health' },
  ]

  // Normalize weights
  const totalWeight = scenarios.reduce((sum, s) => sum + s.weight, 0)
  const normalizedScenarios = scenarios.map((s) => ({
    ...s,
    weight: s.weight / totalWeight,
  }))

  console.log(`[LoadTest] Starting test against ${config.target}`)
  console.log(
    `[LoadTest] Duration: ${config.duration}s, RPS: ${config.rps}, Concurrency: ${config.concurrency}`,
  )

  // Warmup
  if (config.warmup) {
    console.log(`[LoadTest] Warming up for ${config.warmup}s...`)
    await runRequests(config, normalizedScenarios, config.warmup * 1000, [])
  }

  // Run main test
  console.log(`[LoadTest] Running main test...`)
  await runRequests(
    config,
    normalizedScenarios,
    config.duration * 1000,
    results,
  )

  // Calculate results
  return calculateResults(results, config.duration)
}

async function runRequests(
  config: LoadTestConfig,
  scenarios: LoadTestScenario[],
  durationMs: number,
  results: RequestResult[],
): Promise<void> {
  const endTime = Date.now() + durationMs
  const interval = 1000 / config.rps
  const pending: Promise<void>[] = []

  while (Date.now() < endTime) {
    const startBatch = Date.now()

    // Limit concurrent requests
    while (pending.length >= config.concurrency) {
      await Promise.race(pending)
      // Remove completed promises
      const stillPending = pending.filter((p) => {
        let resolved = false
        p.then(() => {
          resolved = true
        }).catch(() => {
          resolved = true
        })
        return !resolved
      })
      pending.length = 0
      pending.push(...stillPending)
    }

    // Select scenario based on weight
    const scenario = selectScenario(scenarios)

    // Start request
    const requestPromise = executeRequest(config, scenario).then((result) => {
      results.push(result)
    })

    pending.push(requestPromise)

    // Pace requests
    const elapsed = Date.now() - startBatch
    if (elapsed < interval) {
      await new Promise((r) => setTimeout(r, interval - elapsed))
    }
  }

  // Wait for remaining requests
  await Promise.allSettled(pending)
}

function selectScenario(scenarios: LoadTestScenario[]): LoadTestScenario {
  const random = Math.random()
  let cumulative = 0

  for (const scenario of scenarios) {
    cumulative += scenario.weight
    if (random <= cumulative) {
      return scenario
    }
  }

  return scenarios[scenarios.length - 1]
}

async function executeRequest(
  config: LoadTestConfig,
  scenario: LoadTestScenario,
): Promise<RequestResult> {
  const url = `${config.target}${scenario.path}`
  const startTime = Date.now()
  let bytesReceived = 0
  let bytesSent = 0

  const body = scenario.body ? JSON.stringify(scenario.body) : undefined
  if (body) bytesSent = body.length

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.timeout ?? 30000,
    )

    const response = await fetch(url, {
      method: scenario.method,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
        ...scenario.headers,
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const responseBody = await response.text()
    bytesReceived = responseBody.length

    const success =
      response.ok && (!scenario.validate || scenario.validate(response))

    return {
      success,
      statusCode: response.status,
      latencyMs: Date.now() - startTime,
      bytesReceived,
      bytesSent,
      scenario: scenario.name,
    }
  } catch (error) {
    return {
      success: false,
      statusCode: 0,
      latencyMs: Date.now() - startTime,
      bytesReceived: 0,
      bytesSent,
      scenario: scenario.name,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

function calculateResults(
  results: RequestResult[],
  durationSeconds: number,
): LoadTestResult {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b)
  const successfulRequests = results.filter((r) => r.success).length
  const failedRequests = results.length - successfulRequests

  const errorsByCode: Record<number, number> = {}
  for (const result of results) {
    if (!result.success) {
      errorsByCode[result.statusCode] =
        (errorsByCode[result.statusCode] ?? 0) + 1
    }
  }

  const scenarioResults: Record<string, ScenarioResult> = {}
  const scenarioGroups = new Map<string, RequestResult[]>()

  for (const result of results) {
    const group = scenarioGroups.get(result.scenario) ?? []
    group.push(result)
    scenarioGroups.set(result.scenario, group)
  }

  for (const [name, group] of scenarioGroups) {
    const successes = group.filter((r) => r.success).length
    scenarioResults[name] = {
      requests: group.length,
      successes,
      failures: group.length - successes,
      avgLatencyMs:
        group.reduce((sum, r) => sum + r.latencyMs, 0) / group.length,
      errorRate: (group.length - successes) / group.length,
    }
  }

  return {
    duration: durationSeconds,
    totalRequests: results.length,
    successfulRequests,
    failedRequests,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
    p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)] ?? 0,
    maxLatencyMs: latencies[latencies.length - 1] ?? 0,
    minLatencyMs: latencies[0] ?? 0,
    requestsPerSecond: results.length / durationSeconds,
    bytesReceived: results.reduce((sum, r) => sum + r.bytesReceived, 0),
    bytesSent: results.reduce((sum, r) => sum + r.bytesSent, 0),
    errorsByCode,
    scenarioResults,
  }
}

/**
 * Print results
 */
export function printResults(result: LoadTestResult): void {
  console.log('\n========================================')
  console.log('         LOAD TEST RESULTS')
  console.log('========================================\n')

  console.log('Summary:')
  console.log(`  Duration:           ${result.duration}s`)
  console.log(`  Total Requests:     ${result.totalRequests}`)
  console.log(`  Successful:         ${result.successfulRequests}`)
  console.log(`  Failed:             ${result.failedRequests}`)
  console.log(`  Requests/sec:       ${result.requestsPerSecond.toFixed(2)}`)
  console.log(
    `  Success Rate:       ${((result.successfulRequests / result.totalRequests) * 100).toFixed(2)}%`,
  )

  console.log('\nLatency (ms):')
  console.log(`  Min:                ${result.minLatencyMs.toFixed(2)}`)
  console.log(`  Avg:                ${result.avgLatencyMs.toFixed(2)}`)
  console.log(`  P50:                ${result.p50LatencyMs.toFixed(2)}`)
  console.log(`  P95:                ${result.p95LatencyMs.toFixed(2)}`)
  console.log(`  P99:                ${result.p99LatencyMs.toFixed(2)}`)
  console.log(`  Max:                ${result.maxLatencyMs.toFixed(2)}`)

  console.log('\nData Transfer:')
  console.log(`  Bytes Sent:         ${formatBytes(result.bytesSent)}`)
  console.log(`  Bytes Received:     ${formatBytes(result.bytesReceived)}`)

  if (Object.keys(result.errorsByCode).length > 0) {
    console.log('\nErrors by Status Code:')
    for (const [code, count] of Object.entries(result.errorsByCode)) {
      console.log(`  ${code}:              ${count}`)
    }
  }

  if (Object.keys(result.scenarioResults).length > 1) {
    console.log('\nBy Scenario:')
    for (const [name, sr] of Object.entries(result.scenarioResults)) {
      console.log(`  ${name}:`)
      console.log(`    Requests:         ${sr.requests}`)
      console.log(
        `    Success Rate:     ${((1 - sr.errorRate) * 100).toFixed(2)}%`,
      )
      console.log(`    Avg Latency:      ${sr.avgLatencyMs.toFixed(2)}ms`)
    }
  }

  console.log('\n========================================\n')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Quick health check
 */
export async function healthCheck(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

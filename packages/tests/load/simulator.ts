/**
 * Load Test Simulator
 *
 * Core engine for running load tests against APIs.
 * Uses concurrent workers to simulate user load.
 */

import type {
  AppLoadTestConfig,
  EndpointStats,
  ErrorSummary,
  LoadTestEndpoint,
  LoadTestResult,
  LoadTestScenario,
  RequestResult,
  ThresholdFailure,
} from './types'

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

// Use reduce instead of spread to avoid stack overflow on large arrays
function safeMin(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((min, val) => (val < min ? val : min), arr[0])
}

function safeMax(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((max, val) => (val > max ? val : max), arr[0])
}

function safeSum(arr: number[]): number {
  return arr.reduce((sum, val) => sum + val, 0)
}

function selectEndpoint(endpoints: LoadTestEndpoint[]): LoadTestEndpoint {
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0)
  let random = Math.random() * totalWeight
  for (const endpoint of endpoints) {
    random -= endpoint.weight
    if (random <= 0) return endpoint
  }
  return endpoints[endpoints.length - 1]
}

export class LoadTestSimulator {
  private baseUrl: string
  private results: RequestResult[] = []
  private isRunning = false
  private startTime: Date = new Date()

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async checkHealth(healthEndpoint: string): Promise<boolean> {
    const url = `${this.baseUrl}${healthEndpoint}`
    const response = await fetch(url).catch(() => null)
    return response?.ok ?? false
  }

  async runTest(
    config: AppLoadTestConfig,
    scenario: LoadTestScenario,
    network: 'localnet' | 'testnet' | 'mainnet',
  ): Promise<LoadTestResult> {
    this.results = []
    this.isRunning = true
    this.startTime = new Date()

    console.log(`\n📊 [${config.name}] Starting load test`)
    console.log(`   Scenario: ${scenario.name}`)
    console.log(`   Users: ${scenario.concurrentUsers}`)
    console.log(`   Duration: ${scenario.durationSeconds}s`)
    console.log(`   Target: ${this.baseUrl}`)

    const endTime = Date.now() + scenario.durationSeconds * 1000
    const workers: Promise<void>[] = []

    // Create worker promises for each concurrent user
    for (let i = 0; i < scenario.concurrentUsers; i++) {
      const worker = this.simulateUser(config, scenario, endTime, i)
      workers.push(worker)

      // Ramp-up: stagger worker starts
      if (scenario.rampUpSeconds > 0) {
        const delayMs =
          (scenario.rampUpSeconds * 1000) / scenario.concurrentUsers
        await this.sleep(delayMs)
      }
    }

    // Wait for all workers to complete
    await Promise.all(workers)

    this.isRunning = false
    const testEndTime = new Date()

    return this.calculateResults(
      config,
      scenario,
      network,
      this.startTime,
      testEndTime,
    )
  }

  stop(): void {
    this.isRunning = false
  }

  private async simulateUser(
    config: AppLoadTestConfig,
    scenario: LoadTestScenario,
    endTime: number,
    _userId: number,
  ): Promise<void> {
    while (this.isRunning && Date.now() < endTime) {
      const endpoint = selectEndpoint(config.endpoints)
      await this.makeRequest(endpoint)

      if (scenario.thinkTimeMs > 0) {
        await this.sleep(scenario.thinkTimeMs)
      }
    }
  }

  private async makeRequest(endpoint: LoadTestEndpoint): Promise<void> {
    const url = `${this.baseUrl}${endpoint.path}`
    const start = performance.now()

    const result: RequestResult = {
      endpoint: endpoint.path,
      method: endpoint.method,
      status: 0,
      latency: 0,
      success: false,
      timestamp: Date.now(),
    }

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      endpoint.timeout ?? 30000,
    )

    const response = await fetch(url, {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        ...endpoint.headers,
      },
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
      signal: controller.signal,
    }).catch((error: Error) => {
      result.error = error.name === 'AbortError' ? 'Timeout' : error.message
      return null
    })

    clearTimeout(timeout)
    result.latency = performance.now() - start

    if (response) {
      result.status = response.status
      const expectedStatuses = endpoint.expectedStatus ?? [200, 201, 204]
      result.success = expectedStatuses.includes(response.status)
      if (!result.success) {
        result.error = `HTTP ${response.status}`
      }
    }

    this.results.push(result)
  }

  private calculateResults(
    config: AppLoadTestConfig,
    scenario: LoadTestScenario,
    network: 'localnet' | 'testnet' | 'mainnet',
    startTime: Date,
    endTime: Date,
  ): LoadTestResult {
    const durationSeconds = (endTime.getTime() - startTime.getTime()) / 1000
    const allLatencies = this.results.map((r) => r.latency)
    const successCount = this.results.filter((r) => r.success).length
    const errorCount = this.results.length - successCount

    // Calculate per-endpoint stats
    const endpointMap = new Map<string, RequestResult[]>()
    for (const result of this.results) {
      const key = `${result.method} ${result.endpoint}`
      const existing = endpointMap.get(key) ?? []
      existing.push(result)
      endpointMap.set(key, existing)
    }

    const endpointStats: EndpointStats[] = []
    for (const [key, results] of endpointMap) {
      const spaceIndex = key.indexOf(' ')
      const method = spaceIndex > 0 ? key.slice(0, spaceIndex) : key
      const endpoint = spaceIndex > 0 ? key.slice(spaceIndex + 1) : '/'
      const latencies = results.map((r) => r.latency)
      const successes = results.filter((r) => r.success).length

      endpointStats.push({
        endpoint,
        method,
        totalRequests: results.length,
        successCount: successes,
        errorCount: results.length - successes,
        latencies,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        min: safeMin(latencies),
        max: safeMax(latencies),
        avg: latencies.length > 0 ? safeSum(latencies) / latencies.length : 0,
        errorRate: (results.length - successes) / results.length,
        rps: results.length / durationSeconds,
      })
    }

    // Calculate error summary
    const errorMap = new Map<string, { count: number; examples: string[] }>()
    for (const result of this.results) {
      if (!result.success && result.error) {
        const existing = errorMap.get(result.error) ?? { count: 0, examples: [] }
        existing.count++
        if (existing.examples.length < 3) {
          existing.examples.push(`${result.method} ${result.endpoint}`)
        }
        errorMap.set(result.error, existing)
      }
    }

    const errors: ErrorSummary[] = []
    for (const [type, data] of errorMap) {
      errors.push({
        type,
        count: data.count,
        percentage: (data.count / this.results.length) * 100,
        examples: data.examples,
      })
    }

    // Check thresholds
    const failures: ThresholdFailure[] = []
    const latencyP50 = percentile(allLatencies, 50)
    const latencyP95 = percentile(allLatencies, 95)
    const latencyP99 = percentile(allLatencies, 99)
    const errorRate = errorCount / this.results.length
    const rps = this.results.length / durationSeconds

    if (latencyP50 > config.thresholds.p50Latency) {
      failures.push({
        threshold: 'p50Latency',
        expected: config.thresholds.p50Latency,
        actual: latencyP50,
        message: `P50 latency ${latencyP50.toFixed(0)}ms exceeds threshold ${config.thresholds.p50Latency}ms`,
      })
    }
    if (latencyP95 > config.thresholds.p95Latency) {
      failures.push({
        threshold: 'p95Latency',
        expected: config.thresholds.p95Latency,
        actual: latencyP95,
        message: `P95 latency ${latencyP95.toFixed(0)}ms exceeds threshold ${config.thresholds.p95Latency}ms`,
      })
    }
    if (latencyP99 > config.thresholds.p99Latency) {
      failures.push({
        threshold: 'p99Latency',
        expected: config.thresholds.p99Latency,
        actual: latencyP99,
        message: `P99 latency ${latencyP99.toFixed(0)}ms exceeds threshold ${config.thresholds.p99Latency}ms`,
      })
    }
    if (errorRate > config.thresholds.errorRate) {
      failures.push({
        threshold: 'errorRate',
        expected: config.thresholds.errorRate,
        actual: errorRate,
        message: `Error rate ${(errorRate * 100).toFixed(2)}% exceeds threshold ${config.thresholds.errorRate * 100}%`,
      })
    }
    if (rps < config.thresholds.minRps) {
      failures.push({
        threshold: 'minRps',
        expected: config.thresholds.minRps,
        actual: rps,
        message: `RPS ${rps.toFixed(0)} below threshold ${config.thresholds.minRps}`,
      })
    }

    return {
      app: config.name,
      scenario: scenario.name,
      network,
      startTime,
      endTime,
      durationSeconds,
      totalRequests: this.results.length,
      successCount,
      errorCount,
      errorRate,
      rps,
      latency: {
        p50: latencyP50,
        p95: latencyP95,
        p99: latencyP99,
        min: safeMin(allLatencies),
        max: safeMax(allLatencies),
        avg: allLatencies.length > 0 ? safeSum(allLatencies) / allLatencies.length : 0,
      },
      endpointStats,
      thresholdsPassed: failures.length === 0,
      failures,
      errors,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const SCENARIOS: Record<string, LoadTestScenario> = {
  SMOKE: {
    name: 'smoke',
    description: 'Quick smoke test - minimal load',
    concurrentUsers: 5,
    durationSeconds: 10,
    rampUpSeconds: 2,
    thinkTimeMs: 500,
  },
  LIGHT: {
    name: 'light',
    description: 'Light load - baseline performance',
    concurrentUsers: 20,
    durationSeconds: 30,
    rampUpSeconds: 5,
    thinkTimeMs: 200,
  },
  NORMAL: {
    name: 'normal',
    description: 'Normal load - typical production traffic',
    concurrentUsers: 50,
    durationSeconds: 60,
    rampUpSeconds: 10,
    thinkTimeMs: 100,
  },
  HEAVY: {
    name: 'heavy',
    description: 'Heavy load - peak traffic simulation',
    concurrentUsers: 100,
    durationSeconds: 120,
    rampUpSeconds: 20,
    thinkTimeMs: 50,
    maxRps: 500,
  },
  STRESS: {
    name: 'stress',
    description: 'Stress test - find breaking point',
    concurrentUsers: 200,
    durationSeconds: 60,
    rampUpSeconds: 10,
    thinkTimeMs: 0,
    maxRps: 1000,
  },
  SOAK: {
    name: 'soak',
    description: 'Soak test - extended duration for memory leaks',
    concurrentUsers: 30,
    durationSeconds: 600,
    rampUpSeconds: 30,
    thinkTimeMs: 200,
  },
  EXTREME: {
    name: 'extreme',
    description: 'Extreme load - find absolute limit',
    concurrentUsers: 500,
    durationSeconds: 30,
    rampUpSeconds: 5,
    thinkTimeMs: 0,
  },
  BURST: {
    name: 'burst',
    description: 'Burst load - sudden traffic spike simulation',
    concurrentUsers: 300,
    durationSeconds: 15,
    rampUpSeconds: 1,
    thinkTimeMs: 0,
  },
}


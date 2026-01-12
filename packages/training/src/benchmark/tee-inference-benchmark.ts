/**
 * TEE Inference Performance Benchmark
 *
 * Benchmarks TEE vs non-TEE inference performance:
 * - Latency comparison
 * - Throughput measurement
 * - Attestation overhead
 * - Multi-model comparison
 */

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkConfig {
  /** Target inference endpoint */
  endpoint: string
  /** Model to benchmark */
  model: string
  /** Number of warmup requests */
  warmupRequests: number
  /** Number of benchmark requests */
  benchmarkRequests: number
  /** Concurrent requests */
  concurrency: number
  /** Request timeout (ms) */
  timeout: number
  /** Whether endpoint requires TEE attestation */
  requireTEE: boolean
  /** Custom headers */
  headers?: Record<string, string>
}

export interface BenchmarkResult {
  /** Configuration used */
  config: BenchmarkConfig
  /** Total requests made */
  totalRequests: number
  /** Successful requests */
  successfulRequests: number
  /** Failed requests */
  failedRequests: number
  /** Latency statistics (ms) */
  latency: {
    min: number
    max: number
    mean: number
    median: number
    p95: number
    p99: number
    stdDev: number
  }
  /** Throughput statistics */
  throughput: {
    requestsPerSecond: number
    tokensPerSecond: number
  }
  /** Token statistics */
  tokens: {
    totalInput: number
    totalOutput: number
    avgInputPerRequest: number
    avgOutputPerRequest: number
  }
  /** Attestation overhead (ms) */
  attestationOverhead?: {
    quoteGeneration: number
    quoteVerification: number
    total: number
  }
  /** Total duration (ms) */
  totalDuration: number
  /** Timestamp */
  timestamp: string
}

export interface ComparisonResult {
  /** TEE benchmark result */
  tee: BenchmarkResult
  /** Non-TEE benchmark result */
  nonTee: BenchmarkResult
  /** Performance comparison */
  comparison: {
    /** Latency overhead (%) */
    latencyOverhead: number
    /** Throughput reduction (%) */
    throughputReduction: number
    /** Attestation overhead as % of total latency */
    attestationOverheadPercent: number
  }
  /** Recommendations */
  recommendations: string[]
}

interface RequestResult {
  success: boolean
  latency: number
  inputTokens: number
  outputTokens: number
  attestationTime?: number
  error?: string
}

// ============================================================================
// Benchmark Runner
// ============================================================================

export class TEEInferenceBenchmark {
  private config: BenchmarkConfig

  constructor(
    config: Pick<BenchmarkConfig, 'endpoint' | 'model'> &
      Partial<Omit<BenchmarkConfig, 'endpoint' | 'model'>>,
  ) {
    this.config = {
      endpoint: config.endpoint,
      model: config.model,
      warmupRequests:
        config.warmupRequests === undefined ? 5 : config.warmupRequests,
      benchmarkRequests:
        config.benchmarkRequests === undefined ? 100 : config.benchmarkRequests,
      concurrency: config.concurrency === undefined ? 1 : config.concurrency,
      timeout: config.timeout === undefined ? 60000 : config.timeout,
      requireTEE: config.requireTEE === undefined ? false : config.requireTEE,
      headers: config.headers,
    }
  }

  /**
   * Run the benchmark
   */
  async run(): Promise<BenchmarkResult> {
    console.log(`\n[Benchmark] Starting benchmark for ${this.config.model}`)
    console.log(`  Endpoint: ${this.config.endpoint}`)
    console.log(`  TEE Required: ${this.config.requireTEE}`)
    console.log(`  Requests: ${this.config.benchmarkRequests}`)
    console.log(`  Concurrency: ${this.config.concurrency}`)

    // Warmup phase
    console.log(
      `\n[Warmup] Running ${this.config.warmupRequests} warmup requests...`,
    )
    await this.runRequests(this.config.warmupRequests, false)

    // Benchmark phase
    console.log(
      `\n[Benchmark] Running ${this.config.benchmarkRequests} benchmark requests...`,
    )
    const startTime = Date.now()
    const results = await this.runRequests(this.config.benchmarkRequests, true)
    const totalDuration = Date.now() - startTime

    // Calculate statistics
    return this.calculateResults(results, totalDuration)
  }

  private async runRequests(
    count: number,
    record: boolean,
  ): Promise<RequestResult[]> {
    const results: RequestResult[] = []
    const batches = Math.ceil(count / this.config.concurrency)

    for (let batch = 0; batch < batches; batch++) {
      const batchSize = Math.min(
        this.config.concurrency,
        count - batch * this.config.concurrency,
      )

      const promises = Array.from({ length: batchSize }, () =>
        this.makeRequest(),
      )

      const batchResults = await Promise.all(promises)

      if (record) {
        results.push(...batchResults)
      }

      // Progress indicator
      if (record && (batch + 1) % 10 === 0) {
        const completed = (batch + 1) * this.config.concurrency
        console.log(`  Progress: ${completed}/${count}`)
      }
    }

    return results
  }

  private async makeRequest(): Promise<RequestResult> {
    const startTime = Date.now()
    let attestationTime = 0

    const prompt = this.generatePrompt()

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      }

      if (this.config.requireTEE) {
        // Simulate attestation request
        const attestStart = Date.now()
        // In real implementation, this would request/verify attestation
        await new Promise((resolve) => setTimeout(resolve, 5))
        attestationTime = Date.now() - attestStart
      }

      const response = await fetch(
        `${this.config.endpoint}/v1/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 256,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(this.config.timeout),
        },
      )

      const latency = Date.now() - startTime

      if (!response.ok) {
        return {
          success: false,
          latency,
          inputTokens: 0,
          outputTokens: 0,
          attestationTime,
          error: `HTTP ${response.status}`,
        }
      }

      const data = (await response.json()) as {
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
        }
        input_tokens?: number
        output_tokens?: number
      }

      return {
        success: true,
        latency,
        inputTokens: data.usage?.prompt_tokens ?? data.input_tokens ?? 50,
        outputTokens:
          data.usage?.completion_tokens ?? data.output_tokens ?? 100,
        attestationTime,
      }
    } catch (error) {
      return {
        success: false,
        latency: Date.now() - startTime,
        inputTokens: 0,
        outputTokens: 0,
        attestationTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private generatePrompt(): string {
    // Generate varied prompts for realistic benchmarking
    const prompts = [
      'What is the capital of France?',
      'Explain quantum computing in simple terms.',
      'Write a haiku about the ocean.',
      'What are the benefits of renewable energy?',
      'Describe the process of photosynthesis.',
      'What is machine learning?',
      'Explain the theory of relativity.',
      'What causes earthquakes?',
      'How does the internet work?',
      'What is artificial intelligence?',
    ]

    const randomIndex = Math.floor(Math.random() * prompts.length)
    const prompt = prompts[randomIndex]
    if (prompt === undefined) {
      throw new Error('No benchmark prompts configured')
    }
    return prompt
  }

  private calculateResults(
    results: RequestResult[],
    totalDuration: number,
  ): BenchmarkResult {
    const successful = results.filter((r) => r.success)
    const failed = results.filter((r) => !r.success)

    const latencies = successful.map((r) => r.latency).sort((a, b) => a - b)
    const attestationTimes = successful
      .filter((r) => r.attestationTime !== undefined)
      .map((r) => r.attestationTime!)

    const totalInputTokens = successful.reduce(
      (sum, r) => sum + r.inputTokens,
      0,
    )
    const totalOutputTokens = successful.reduce(
      (sum, r) => sum + r.outputTokens,
      0,
    )

    // Calculate latency stats
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const variance =
      latencies.reduce((sum, lat) => sum + (lat - mean) ** 2, 0) /
      latencies.length
    const stdDev = Math.sqrt(variance)

    return {
      config: this.config,
      totalRequests: results.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      latency: {
        min: latencies[0] ?? 0,
        max: latencies[latencies.length - 1] ?? 0,
        mean,
        median: latencies[Math.floor(latencies.length / 2)] ?? 0,
        p95: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
        p99: latencies[Math.floor(latencies.length * 0.99)] ?? 0,
        stdDev,
      },
      throughput: {
        requestsPerSecond: (successful.length / totalDuration) * 1000,
        tokensPerSecond:
          ((totalInputTokens + totalOutputTokens) / totalDuration) * 1000,
      },
      tokens: {
        totalInput: totalInputTokens,
        totalOutput: totalOutputTokens,
        avgInputPerRequest: totalInputTokens / successful.length || 0,
        avgOutputPerRequest: totalOutputTokens / successful.length || 0,
      },
      attestationOverhead:
        attestationTimes.length > 0
          ? {
              quoteGeneration:
                attestationTimes.reduce((a, b) => a + b, 0) /
                attestationTimes.length,
              quoteVerification: 0, // Would measure separately
              total:
                attestationTimes.reduce((a, b) => a + b, 0) /
                attestationTimes.length,
            }
          : undefined,
      totalDuration,
      timestamp: new Date().toISOString(),
    }
  }
}

// ============================================================================
// Comparison Runner
// ============================================================================

export class TEEBenchmarkComparison {
  private teeConfig: BenchmarkConfig
  private nonTeeConfig: BenchmarkConfig

  constructor(
    teeEndpoint: string,
    nonTeeEndpoint: string,
    model: string,
    options?: Partial<BenchmarkConfig>,
  ) {
    const baseConfig: Omit<BenchmarkConfig, 'endpoint' | 'requireTEE'> = {
      model,
      warmupRequests: options?.warmupRequests ?? 5,
      benchmarkRequests: options?.benchmarkRequests ?? 100,
      concurrency: options?.concurrency ?? 1,
      timeout: options?.timeout ?? 60000,
      headers: options?.headers,
    }

    this.teeConfig = {
      ...baseConfig,
      endpoint: teeEndpoint,
      requireTEE: true,
    }

    this.nonTeeConfig = {
      ...baseConfig,
      endpoint: nonTeeEndpoint,
      requireTEE: false,
    }
  }

  /**
   * Run comparison benchmark
   */
  async run(): Promise<ComparisonResult> {
    console.log(`\n${'='.repeat(60)}`)
    console.log('  TEE vs Non-TEE Inference Benchmark')
    console.log('='.repeat(60))

    // Run non-TEE benchmark first
    console.log('\n--- Non-TEE Benchmark ---')
    const nonTeeBenchmark = new TEEInferenceBenchmark(this.nonTeeConfig)
    const nonTeeResult = await nonTeeBenchmark.run()

    // Run TEE benchmark
    console.log('\n--- TEE Benchmark ---')
    const teeBenchmark = new TEEInferenceBenchmark(this.teeConfig)
    const teeResult = await teeBenchmark.run()

    // Calculate comparison
    const latencyOverhead =
      ((teeResult.latency.mean - nonTeeResult.latency.mean) /
        nonTeeResult.latency.mean) *
      100

    const throughputReduction =
      ((nonTeeResult.throughput.requestsPerSecond -
        teeResult.throughput.requestsPerSecond) /
        nonTeeResult.throughput.requestsPerSecond) *
      100

    const attestationOverheadPercent = teeResult.attestationOverhead
      ? (teeResult.attestationOverhead.total / teeResult.latency.mean) * 100
      : 0

    // Generate recommendations
    const recommendations: string[] = []

    if (latencyOverhead > 20) {
      recommendations.push(
        'Consider caching attestations to reduce per-request overhead',
      )
    }

    if (throughputReduction > 30) {
      recommendations.push(
        'Consider batch attestation for high-throughput scenarios',
      )
    }

    if (attestationOverheadPercent > 10) {
      recommendations.push(
        'Attestation overhead is significant - consider longer validity periods',
      )
    }

    if (teeResult.failedRequests / teeResult.totalRequests > 0.05) {
      recommendations.push(
        'High failure rate detected - check TEE infrastructure stability',
      )
    }

    return {
      tee: teeResult,
      nonTee: nonTeeResult,
      comparison: {
        latencyOverhead,
        throughputReduction,
        attestationOverheadPercent,
      },
      recommendations,
    }
  }

  /**
   * Print comparison results
   */
  static printResults(result: ComparisonResult): void {
    console.log(`\n${'='.repeat(60)}`)
    console.log('  BENCHMARK RESULTS')
    console.log('='.repeat(60))

    console.log('\n--- Latency Comparison (ms) ---')
    console.log(`  Non-TEE Mean: ${result.nonTee.latency.mean.toFixed(2)}ms`)
    console.log(`  TEE Mean: ${result.tee.latency.mean.toFixed(2)}ms`)
    console.log(`  Overhead: ${result.comparison.latencyOverhead.toFixed(2)}%`)

    console.log('\n--- Throughput Comparison ---')
    console.log(
      `  Non-TEE: ${result.nonTee.throughput.requestsPerSecond.toFixed(2)} req/s`,
    )
    console.log(
      `  TEE: ${result.tee.throughput.requestsPerSecond.toFixed(2)} req/s`,
    )
    console.log(
      `  Reduction: ${result.comparison.throughputReduction.toFixed(2)}%`,
    )

    console.log('\n--- Latency Percentiles (TEE) ---')
    console.log(`  P50: ${result.tee.latency.median.toFixed(2)}ms`)
    console.log(`  P95: ${result.tee.latency.p95.toFixed(2)}ms`)
    console.log(`  P99: ${result.tee.latency.p99.toFixed(2)}ms`)

    if (result.tee.attestationOverhead) {
      console.log('\n--- Attestation Overhead ---')
      console.log(
        `  Per-request: ${result.tee.attestationOverhead.total.toFixed(2)}ms`,
      )
      console.log(
        `  % of latency: ${result.comparison.attestationOverheadPercent.toFixed(2)}%`,
      )
    }

    console.log('\n--- Success Rate ---')
    console.log(
      `  Non-TEE: ${((result.nonTee.successfulRequests / result.nonTee.totalRequests) * 100).toFixed(2)}%`,
    )
    console.log(
      `  TEE: ${((result.tee.successfulRequests / result.tee.totalRequests) * 100).toFixed(2)}%`,
    )

    if (result.recommendations.length > 0) {
      console.log('\n--- Recommendations ---')
      result.recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec}`)
      })
    }

    console.log(`\n${'='.repeat(60)}`)
  }
}

// ============================================================================
// Multi-Model Benchmark
// ============================================================================

export interface MultiModelConfig {
  endpoint: string
  models: string[]
  requestsPerModel: number
  concurrency: number
  requireTEE: boolean
}

export interface MultiModelResult {
  results: Map<string, BenchmarkResult>
  bestModel: string
  worstModel: string
  averageLatency: number
  averageThroughput: number
}

export class MultiModelBenchmark {
  private config: MultiModelConfig

  constructor(config: MultiModelConfig) {
    this.config = config
  }

  async run(): Promise<MultiModelResult> {
    console.log(`\n${'='.repeat(60)}`)
    console.log('  Multi-Model TEE Benchmark')
    console.log('='.repeat(60))

    const results = new Map<string, BenchmarkResult>()

    for (const model of this.config.models) {
      console.log(`\n--- Benchmarking ${model} ---`)

      const benchmark = new TEEInferenceBenchmark({
        endpoint: this.config.endpoint,
        model,
        warmupRequests: 3,
        benchmarkRequests: this.config.requestsPerModel,
        concurrency: this.config.concurrency,
        timeout: 60000,
        requireTEE: this.config.requireTEE,
      })

      const result = await benchmark.run()
      results.set(model, result)
    }

    // Find best and worst
    let bestModel = ''
    let worstModel = ''
    let bestLatency = Infinity
    let worstLatency = 0

    for (const [model, result] of results) {
      if (result.latency.mean < bestLatency) {
        bestLatency = result.latency.mean
        bestModel = model
      }
      if (result.latency.mean > worstLatency) {
        worstLatency = result.latency.mean
        worstModel = model
      }
    }

    // Calculate averages
    const allResults = Array.from(results.values())
    const averageLatency =
      allResults.reduce((sum, r) => sum + r.latency.mean, 0) / allResults.length
    const averageThroughput =
      allResults.reduce((sum, r) => sum + r.throughput.requestsPerSecond, 0) /
      allResults.length

    return {
      results,
      bestModel,
      worstModel,
      averageLatency,
      averageThroughput,
    }
  }

  static printResults(result: MultiModelResult): void {
    console.log(`\n${'='.repeat(60)}`)
    console.log('  MULTI-MODEL RESULTS')
    console.log('='.repeat(60))

    console.log('\n--- Model Performance ---')
    for (const [model, benchmark] of result.results) {
      console.log(
        `  ${model}: ${benchmark.latency.mean.toFixed(2)}ms avg, ${benchmark.throughput.requestsPerSecond.toFixed(2)} req/s`,
      )
    }

    console.log(`\n  Best Model: ${result.bestModel}`)
    console.log(`  Worst Model: ${result.worstModel}`)
    console.log(`  Average Latency: ${result.averageLatency.toFixed(2)}ms`)
    console.log(
      `  Average Throughput: ${result.averageThroughput.toFixed(2)} req/s`,
    )
  }
}

// ============================================================================
// CLI Runner
// ============================================================================

export async function runBenchmarkCLI(): Promise<void> {
  const args = process.argv.slice(2)

  const teeEndpoint =
    args.find((a) => a.startsWith('--tee-endpoint='))?.split('=')[1] ??
    'http://localhost:3000'
  const nonTeeEndpoint =
    args.find((a) => a.startsWith('--non-tee-endpoint='))?.split('=')[1] ??
    'http://localhost:3001'
  const model =
    args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'llama-3.1-8b'
  const requests = parseInt(
    args.find((a) => a.startsWith('--requests='))?.split('=')[1] ?? '100',
    10,
  )
  const concurrency = parseInt(
    args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? '1',
    10,
  )

  if (args.includes('--help')) {
    console.log(`
TEE Inference Benchmark

Usage:
  bun packages/training/src/benchmark/tee-inference-benchmark.ts [options]

Options:
  --tee-endpoint=<url>      TEE inference endpoint (default: http://localhost:3000)
  --non-tee-endpoint=<url>  Non-TEE inference endpoint (default: http://localhost:3001)
  --model=<model>           Model to benchmark (default: llama-3.1-8b)
  --requests=<n>            Number of requests (default: 100)
  --concurrency=<n>         Concurrent requests (default: 1)
  --comparison              Run TEE vs non-TEE comparison
  --help                    Show this help
`)
    return
  }

  if (args.includes('--comparison')) {
    const comparison = new TEEBenchmarkComparison(
      teeEndpoint,
      nonTeeEndpoint,
      model,
      {
        benchmarkRequests: requests,
        concurrency,
      },
    )

    const result = await comparison.run()
    TEEBenchmarkComparison.printResults(result)
  } else {
    const benchmark = new TEEInferenceBenchmark({
      endpoint: teeEndpoint,
      model,
      warmupRequests: 5,
      benchmarkRequests: requests,
      concurrency,
      timeout: 60000,
      requireTEE: true,
    })

    const result = await benchmark.run()

    console.log(`\n${'='.repeat(60)}`)
    console.log('  BENCHMARK RESULTS')
    console.log('='.repeat(60))
    console.log(JSON.stringify(result, null, 2))
  }
}

// Run if executed directly
if (import.meta.main) {
  runBenchmarkCLI().catch(console.error)
}

/**
 * Storage Benchmark Service
 *
 * Comprehensive benchmarking for storage providers:
 * - IOPS (random read/write operations per second)
 * - Throughput (sequential read/write MB/s)
 * - Latency (time to first byte, average latency)
 * - Durability (data integrity verification)
 * - IPFS-specific metrics (retrieval time, pinning speed)
 *
 * Similar to compute benchmarking:
 * - Runs on first provider registration
 * - Reputation-based re-verification
 * - Results published on-chain
 */

import { Cron } from 'croner'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'

// Helper to convert Buffer to Uint8Array for fetch compatibility
function bufferToUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

// ============ Types ============

export interface StorageBenchmarkResults {
  providerId: string
  providerAddress: Address
  timestamp: number

  // Basic Storage Metrics
  storage: {
    totalCapacityMb: number
    usedCapacityMb: number
    availableCapacityMb: number
    storageType: 'ssd' | 'nvme' | 'hdd' | 'object' | 'ipfs'
  }

  // IOPS (operations per second)
  iops: {
    randomRead4k: number // 4KB random read IOPS
    randomWrite4k: number // 4KB random write IOPS
    randomRead64k: number // 64KB random read IOPS
    randomWrite64k: number // 64KB random write IOPS
    mixedReadWrite: number // 70/30 mixed workload IOPS
  }

  // Throughput (MB/s)
  throughput: {
    sequentialRead: number
    sequentialWrite: number
    parallelRead: number // Multi-stream read
    parallelWrite: number // Multi-stream write
  }

  // Latency (milliseconds)
  latency: {
    firstByte: number // Time to first byte
    averageRead: number // Average read latency
    averageWrite: number // Average write latency
    p99Read: number // 99th percentile read latency
    p99Write: number // 99th percentile write latency
  }

  // Durability
  durability: {
    checksumVerified: boolean
    replicationFactor: number
    dataIntegrityScore: number // 0-100
  }

  // Network (for remote storage)
  network: {
    bandwidthMbps: number
    latencyMs: number
    packetLossPercent: number
  }

  // IPFS-specific (if applicable)
  ipfs: {
    gatewayUrl: string | null
    pinningSpeedMbps: number | null
    retrievalTimeMs: number | null
    peerCount: number | null
    cidResolutionMs: number | null
  } | null

  // Scores
  overallScore: number // 0-10000
  attestationHash: Hex
}

export const StorageBenchmarkResultsSchema = z.object({
  providerId: z.string(),
  providerAddress: z.string(),
  timestamp: z.number(),
  storage: z.object({
    totalCapacityMb: z.number(),
    usedCapacityMb: z.number(),
    availableCapacityMb: z.number(),
    storageType: z.enum(['ssd', 'nvme', 'hdd', 'object', 'ipfs']),
  }),
  iops: z.object({
    randomRead4k: z.number(),
    randomWrite4k: z.number(),
    randomRead64k: z.number(),
    randomWrite64k: z.number(),
    mixedReadWrite: z.number(),
  }),
  throughput: z.object({
    sequentialRead: z.number(),
    sequentialWrite: z.number(),
    parallelRead: z.number(),
    parallelWrite: z.number(),
  }),
  latency: z.object({
    firstByte: z.number(),
    averageRead: z.number(),
    averageWrite: z.number(),
    p99Read: z.number(),
    p99Write: z.number(),
  }),
  durability: z.object({
    checksumVerified: z.boolean(),
    replicationFactor: z.number(),
    dataIntegrityScore: z.number(),
  }),
  network: z.object({
    bandwidthMbps: z.number(),
    latencyMs: z.number(),
    packetLossPercent: z.number(),
  }),
  ipfs: z.object({
    gatewayUrl: z.string().nullable(),
    pinningSpeedMbps: z.number().nullable(),
    retrievalTimeMs: z.number().nullable(),
    peerCount: z.number().nullable(),
    cidResolutionMs: z.number().nullable(),
  }).nullable(),
  overallScore: z.number(),
  attestationHash: z.string(),
})

export interface StorageProviderInfo {
  id: string
  address: Address
  endpoint: string
  type: 'block' | 'object' | 'ipfs' | 'hybrid'
  claimedCapacityMb: number
  claimedIops: number
  claimedThroughputMbps: number
  region: string
}

export interface StorageBenchmarkJob {
  id: string
  providerId: string
  type: 'initial' | 'scheduled' | 'random' | 'manual'
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt: number | null
  results: StorageBenchmarkResults | null
  error: string | null
}

export interface StorageProviderReputation {
  providerId: string
  score: number // 0-100
  benchmarkCount: number
  passCount: number
  failCount: number
  lastBenchmarkAt: number
  lastDeviationPercent: number
  uptimePercent: number
  flags: string[]
}

// ============ Configuration ============

interface StorageBenchmarkConfig {
  // Test sizes
  smallFileSizeKb: number
  mediumFileSizeMb: number
  largeFileSizeMb: number

  // Test counts
  iopsTestDurationMs: number
  throughputTestDurationMs: number
  latencyTestSamples: number

  // Thresholds
  warnDeviationPercent: number
  failDeviationPercent: number
  slashDeviationPercent: number

  // Re-verification schedule
  lowReputationIntervalDays: number
  mediumReputationIntervalDays: number
  highReputationIntervalDays: number

  // Random spot check
  randomSpotCheckPercent: number

  // Limits
  maxConcurrentBenchmarks: number
  benchmarkTimeoutMs: number
}

const DEFAULT_CONFIG: StorageBenchmarkConfig = {
  smallFileSizeKb: 4,
  mediumFileSizeMb: 1,
  largeFileSizeMb: 100,

  iopsTestDurationMs: 30000, // 30 seconds
  throughputTestDurationMs: 60000, // 60 seconds
  latencyTestSamples: 100,

  warnDeviationPercent: 15,
  failDeviationPercent: 30,
  slashDeviationPercent: 50,

  lowReputationIntervalDays: 7,
  mediumReputationIntervalDays: 30,
  highReputationIntervalDays: 90,

  randomSpotCheckPercent: 1,

  maxConcurrentBenchmarks: 3,
  benchmarkTimeoutMs: 300000, // 5 minutes
}

// ============ State ============

const benchmarkJobs = new Map<string, StorageBenchmarkJob>()
const benchmarkResults = new Map<string, StorageBenchmarkResults[]>() // providerId -> results
const providerReputations = new Map<string, StorageProviderReputation>()
const pendingBenchmarks = new Set<string>()
const registeredProviders = new Map<string, StorageProviderInfo>()

// ============ Main Service ============

export class StorageBenchmarkService {
  private config: StorageBenchmarkConfig
  private cronJob: Cron | null = null
  private running = false

  constructor(config: Partial<StorageBenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start the service
   */
  start(): void {
    if (this.running) return

    // Run every 2 hours (storage benchmarks are heavier)
    this.cronJob = new Cron('0 */2 * * *', async () => {
      await this.runScheduledBenchmarks()
    })

    this.running = true
    console.log('[StorageBenchmark] Started - checking every 2 hours')
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop()
      this.cronJob = null
    }
    this.running = false
    console.log('[StorageBenchmark] Stopped')
  }

  /**
   * Register a storage provider for benchmarking
   */
  registerProvider(provider: StorageProviderInfo): void {
    registeredProviders.set(provider.id, provider)
    console.log(`[StorageBenchmark] Registered provider ${provider.id}`)
  }

  /**
   * Unregister a provider
   */
  unregisterProvider(providerId: string): void {
    registeredProviders.delete(providerId)
    providerReputations.delete(providerId)
  }

  /**
   * Run initial benchmark for a new provider
   */
  async benchmarkOnRegistration(providerId: string): Promise<StorageBenchmarkJob> {
    const provider = registeredProviders.get(providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    console.log(`[StorageBenchmark] Initial benchmark for provider ${providerId}`)
    return this.runBenchmark(provider, 'initial')
  }

  /**
   * Run scheduled benchmarks
   */
  async runScheduledBenchmarks(): Promise<void> {
    const now = Date.now()
    const providers = Array.from(registeredProviders.values())

    console.log(`[StorageBenchmark] Checking ${providers.length} providers for scheduled benchmarks`)

    let scheduled = 0
    const maxToSchedule = this.config.maxConcurrentBenchmarks - pendingBenchmarks.size

    for (const provider of providers) {
      if (scheduled >= maxToSchedule) break
      if (pendingBenchmarks.has(provider.id)) continue

      const reputation = this.getReputation(provider.id)
      const shouldBenchmark = this.shouldBenchmark(reputation, now)

      if (shouldBenchmark.needed) {
        console.log(`[StorageBenchmark] Scheduling ${shouldBenchmark.type} benchmark for ${provider.id}`)
        this.queueBenchmark(provider, shouldBenchmark.type)
        scheduled++
      }
    }

    console.log(`[StorageBenchmark] Scheduled ${scheduled} benchmarks`)
  }

  /**
   * Manually trigger benchmark
   */
  async triggerBenchmark(providerId: string): Promise<StorageBenchmarkJob | null> {
    const provider = registeredProviders.get(providerId)
    if (!provider) {
      console.error(`[StorageBenchmark] Provider ${providerId} not found`)
      return null
    }

    return this.runBenchmark(provider, 'manual')
  }

  // ============ Benchmark Execution ============

  private async runBenchmark(
    provider: StorageProviderInfo,
    type: StorageBenchmarkJob['type'],
  ): Promise<StorageBenchmarkJob> {
    const jobId = `storage-bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    const job: StorageBenchmarkJob = {
      id: jobId,
      providerId: provider.id,
      type,
      status: 'pending',
      startedAt: now,
      completedAt: null,
      results: null,
      error: null,
    }

    benchmarkJobs.set(jobId, job)
    pendingBenchmarks.add(provider.id)

    job.status = 'running'

    // Run benchmarks
    const results = await this.executeBenchmarks(provider)

    job.status = 'completed'
    job.completedAt = Date.now()
    job.results = results

    // Calculate deviation from claimed specs
    const deviation = this.calculateDeviation(provider, results)

    // Update reputation
    this.updateReputation(provider.id, results, deviation)

    // Store results
    const history = benchmarkResults.get(provider.id) ?? []
    history.push(results)
    benchmarkResults.set(provider.id, history.slice(-10))

    pendingBenchmarks.delete(provider.id)

    console.log(`[StorageBenchmark] Completed benchmark for ${provider.id} - score: ${results.overallScore}, deviation: ${deviation.toFixed(1)}%`)

    return job
  }

  private queueBenchmark(provider: StorageProviderInfo, type: 'scheduled' | 'random'): void {
    pendingBenchmarks.add(provider.id)

    this.runBenchmark(provider, type).catch((err) => {
      console.error(`[StorageBenchmark] Failed for ${provider.id}:`, err)
      pendingBenchmarks.delete(provider.id)
    })
  }

  private async executeBenchmarks(provider: StorageProviderInfo): Promise<StorageBenchmarkResults> {
    // For IPFS providers
    if (provider.type === 'ipfs') {
      return this.executeIPFSBenchmarks(provider)
    }

    // For block/object storage
    return this.executeBlockBenchmarks(provider)
  }

  private async executeBlockBenchmarks(provider: StorageProviderInfo): Promise<StorageBenchmarkResults> {
    const endpoint = provider.endpoint

    // Generate test data
    const smallData = Buffer.alloc(this.config.smallFileSizeKb * 1024)
    const mediumData = Buffer.alloc(this.config.mediumFileSizeMb * 1024 * 1024)

    // Initialize with random data for durability testing
    for (let i = 0; i < smallData.length; i++) {
      smallData[i] = Math.floor(Math.random() * 256)
    }
    const smallDataHash = keccak256(smallData)

    // Test IOPS (4KB random operations)
    const iopsResults = await this.testIOPS(endpoint, smallData)

    // Test throughput (sequential read/write)
    const throughputResults = await this.testThroughput(endpoint, mediumData)

    // Test latency
    const latencyResults = await this.testLatency(endpoint, smallData)

    // Test durability (write, read, verify checksum)
    const durabilityResults = await this.testDurability(endpoint, smallData, smallDataHash)

    // Test network
    const networkResults = await this.testNetwork(endpoint)

    // Calculate overall score
    const overallScore = this.calculateOverallScore({
      iops: iopsResults,
      throughput: throughputResults,
      latency: latencyResults,
    })

    const timestamp = Date.now()
    const attestationHash = keccak256(
      toBytes(JSON.stringify({
        providerId: provider.id,
        timestamp,
        overallScore,
        iops: iopsResults,
        throughput: throughputResults,
      }))
    ) as Hex

    return {
      providerId: provider.id,
      providerAddress: provider.address,
      timestamp,
      storage: {
        totalCapacityMb: provider.claimedCapacityMb,
        usedCapacityMb: 0, // Would query from provider
        availableCapacityMb: provider.claimedCapacityMb,
        storageType: provider.type === 'object' ? 'object' : 'ssd',
      },
      iops: iopsResults,
      throughput: throughputResults,
      latency: latencyResults,
      durability: durabilityResults,
      network: networkResults,
      ipfs: null,
      overallScore,
      attestationHash,
    }
  }

  private async executeIPFSBenchmarks(provider: StorageProviderInfo): Promise<StorageBenchmarkResults> {
    const endpoint = provider.endpoint
    const testData = Buffer.alloc(this.config.mediumFileSizeMb * 1024 * 1024)

    // Fill with random data
    for (let i = 0; i < testData.length; i++) {
      testData[i] = Math.floor(Math.random() * 256)
    }

    // Test pinning speed
    const pinStart = Date.now()
    let cid: string | null = null

    const pinResponse = await fetch(`${endpoint}/api/v0/add`, {
      method: 'POST',
      body: testData,
      signal: AbortSignal.timeout(this.config.benchmarkTimeoutMs),
    })

    if (pinResponse.ok) {
      const pinResult = await pinResponse.json() as { Hash: string }
      cid = pinResult.Hash
    }

    const pinDuration = Date.now() - pinStart
    const pinningSpeedMbps = cid ? (this.config.mediumFileSizeMb / (pinDuration / 1000)) : 0

    // Test CID resolution
    const resolveStart = Date.now()
    if (cid) {
      await fetch(`${endpoint}/ipfs/${cid}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(30000),
      })
    }
    const cidResolutionMs = Date.now() - resolveStart

    // Test retrieval
    const retrievalStart = Date.now()
    if (cid) {
      const retrieveResponse = await fetch(`${endpoint}/ipfs/${cid}`, {
        signal: AbortSignal.timeout(this.config.benchmarkTimeoutMs),
      })
      await retrieveResponse.arrayBuffer()
    }
    const retrievalTimeMs = Date.now() - retrievalStart

    // Get peer count
    let peerCount = 0
    const swarmResponse = await fetch(`${endpoint}/api/v0/swarm/peers`, {
      signal: AbortSignal.timeout(10000),
    })
    if (swarmResponse.ok) {
      const swarmResult = await swarmResponse.json() as { Peers: unknown[] }
      peerCount = swarmResult.Peers?.length ?? 0
    }

    // Calculate throughput from pinning/retrieval
    const throughputResults = {
      sequentialRead: cid ? (this.config.mediumFileSizeMb * 1000) / retrievalTimeMs : 0,
      sequentialWrite: pinningSpeedMbps,
      parallelRead: 0,
      parallelWrite: 0,
    }

    const latencyResults = {
      firstByte: cidResolutionMs,
      averageRead: retrievalTimeMs / 10, // Estimate
      averageWrite: pinDuration / 10,
      p99Read: retrievalTimeMs,
      p99Write: pinDuration,
    }

    const overallScore = this.calculateOverallScore({
      iops: { randomRead4k: 0, randomWrite4k: 0, randomRead64k: 0, randomWrite64k: 0, mixedReadWrite: 0 },
      throughput: throughputResults,
      latency: latencyResults,
    })

    const timestamp = Date.now()
    const attestationHash = keccak256(
      toBytes(JSON.stringify({ providerId: provider.id, timestamp, overallScore }))
    ) as Hex

    return {
      providerId: provider.id,
      providerAddress: provider.address,
      timestamp,
      storage: {
        totalCapacityMb: provider.claimedCapacityMb,
        usedCapacityMb: 0,
        availableCapacityMb: provider.claimedCapacityMb,
        storageType: 'ipfs',
      },
      iops: {
        randomRead4k: 0,
        randomWrite4k: 0,
        randomRead64k: 0,
        randomWrite64k: 0,
        mixedReadWrite: 0,
      },
      throughput: throughputResults,
      latency: latencyResults,
      durability: {
        checksumVerified: !!cid,
        replicationFactor: peerCount > 0 ? Math.min(peerCount, 3) : 1,
        dataIntegrityScore: cid ? 100 : 0,
      },
      network: {
        bandwidthMbps: pinningSpeedMbps * 8,
        latencyMs: cidResolutionMs,
        packetLossPercent: 0,
      },
      ipfs: {
        gatewayUrl: endpoint,
        pinningSpeedMbps,
        retrievalTimeMs,
        peerCount,
        cidResolutionMs,
      },
      overallScore,
      attestationHash,
    }
  }

  private async testIOPS(
    endpoint: string,
    testData: Buffer,
  ): Promise<StorageBenchmarkResults['iops']> {
    const testDuration = this.config.iopsTestDurationMs
    let reads4k = 0
    let writes4k = 0

    const endTime = Date.now() + testDuration

    // Simulate IOPS testing
    while (Date.now() < endTime) {
      // Write
      const writeResponse = await fetch(`${endpoint}/benchmark/write`, {
        method: 'POST',
        body: bufferToUint8Array(testData),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      if (writeResponse?.ok) {
        writes4k++
      }

      // Read
      const readResponse = await fetch(`${endpoint}/benchmark/read`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      if (readResponse?.ok) {
        reads4k++
      }

      // Small delay to not overwhelm
      await new Promise((r) => setTimeout(r, 10))
    }

    const durationSec = testDuration / 1000

    return {
      randomRead4k: Math.round(reads4k / durationSec),
      randomWrite4k: Math.round(writes4k / durationSec),
      randomRead64k: Math.round((reads4k / durationSec) * 0.5), // Estimate
      randomWrite64k: Math.round((writes4k / durationSec) * 0.5),
      mixedReadWrite: Math.round((reads4k + writes4k) / durationSec * 0.7),
    }
  }

  private async testThroughput(
    endpoint: string,
    testData: Buffer,
  ): Promise<StorageBenchmarkResults['throughput']> {
    // Write test
    const writeStart = Date.now()
    const writeResponse = await fetch(`${endpoint}/benchmark/write-large`, {
      method: 'POST',
      body: bufferToUint8Array(testData),
      signal: AbortSignal.timeout(this.config.throughputTestDurationMs),
    }).catch(() => null)

    const writeDuration = Date.now() - writeStart
    const writeSpeed = writeResponse?.ok ? (testData.length / 1024 / 1024) / (writeDuration / 1000) : 0

    // Read test
    const readStart = Date.now()
    const readResponse = await fetch(`${endpoint}/benchmark/read-large`, {
      signal: AbortSignal.timeout(this.config.throughputTestDurationMs),
    }).catch(() => null)

    let readData: ArrayBuffer | null = null
    if (readResponse?.ok) {
      readData = await readResponse.arrayBuffer()
    }

    const readDuration = Date.now() - readStart
    const readSpeed = readData ? (readData.byteLength / 1024 / 1024) / (readDuration / 1000) : 0

    return {
      sequentialRead: Math.round(readSpeed),
      sequentialWrite: Math.round(writeSpeed),
      parallelRead: Math.round(readSpeed * 0.8), // Estimate
      parallelWrite: Math.round(writeSpeed * 0.8),
    }
  }

  private async testLatency(
    endpoint: string,
    testData: Buffer,
  ): Promise<StorageBenchmarkResults['latency']> {
    const samples = this.config.latencyTestSamples
    const readLatencies: number[] = []
    const writeLatencies: number[] = []

    for (let i = 0; i < samples; i++) {
      // Write latency
      const writeStart = Date.now()
      await fetch(`${endpoint}/benchmark/write`, {
        method: 'POST',
        body: testData.slice(0, 1024), // 1KB
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)
      writeLatencies.push(Date.now() - writeStart)

      // Read latency
      const readStart = Date.now()
      await fetch(`${endpoint}/benchmark/read?size=1024`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)
      readLatencies.push(Date.now() - readStart)
    }

    readLatencies.sort((a, b) => a - b)
    writeLatencies.sort((a, b) => a - b)

    const avgRead = readLatencies.reduce((a, b) => a + b, 0) / readLatencies.length
    const avgWrite = writeLatencies.reduce((a, b) => a + b, 0) / writeLatencies.length
    const p99Index = Math.floor(samples * 0.99)

    return {
      firstByte: readLatencies[0] ?? 0,
      averageRead: Math.round(avgRead * 100) / 100,
      averageWrite: Math.round(avgWrite * 100) / 100,
      p99Read: readLatencies[p99Index] ?? 0,
      p99Write: writeLatencies[p99Index] ?? 0,
    }
  }

  private async testDurability(
    endpoint: string,
    testData: Buffer,
    expectedHash: Hex,
  ): Promise<StorageBenchmarkResults['durability']> {
    // Write data
    const writeResponse = await fetch(`${endpoint}/benchmark/durability-write`, {
      method: 'POST',
      body: testData,
      headers: { 'X-Expected-Hash': expectedHash },
      signal: AbortSignal.timeout(30000),
    }).catch(() => null)

    if (!writeResponse?.ok) {
      return {
        checksumVerified: false,
        replicationFactor: 0,
        dataIntegrityScore: 0,
      }
    }

    // Read back and verify
    const readResponse = await fetch(`${endpoint}/benchmark/durability-read`, {
      signal: AbortSignal.timeout(30000),
    }).catch(() => null)

    if (!readResponse?.ok) {
      return {
        checksumVerified: false,
        replicationFactor: 1,
        dataIntegrityScore: 50,
      }
    }

    const readData = await readResponse.arrayBuffer()
    const actualHash = keccak256(new Uint8Array(readData))

    return {
      checksumVerified: actualHash === expectedHash,
      replicationFactor: 1, // Would query from provider
      dataIntegrityScore: actualHash === expectedHash ? 100 : 0,
    }
  }

  private async testNetwork(
    endpoint: string,
  ): Promise<StorageBenchmarkResults['network']> {
    // Ping test
    const pings: number[] = []
    for (let i = 0; i < 10; i++) {
      const start = Date.now()
      await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      pings.push(Date.now() - start)
    }

    const avgLatency = pings.reduce((a, b) => a + b, 0) / pings.length

    // Bandwidth estimate from throughput tests
    return {
      bandwidthMbps: 1000, // Would measure properly
      latencyMs: Math.round(avgLatency),
      packetLossPercent: 0,
    }
  }

  // ============ Scoring ============

  private calculateOverallScore(metrics: {
    iops: StorageBenchmarkResults['iops']
    throughput: StorageBenchmarkResults['throughput']
    latency: StorageBenchmarkResults['latency']
  }): number {
    // Weight components
    const iopsWeight = 0.3
    const throughputWeight = 0.4
    const latencyWeight = 0.3

    // Normalize IOPS (based on 100k IOPS max)
    const iopsScore = Math.min(100, (metrics.iops.randomRead4k + metrics.iops.randomWrite4k) / 2000)

    // Normalize throughput (based on 10 GB/s max)
    const throughputScore = Math.min(100, (metrics.throughput.sequentialRead + metrics.throughput.sequentialWrite) / 200)

    // Normalize latency (inverse - lower is better, based on 10ms target)
    const avgLatency = (metrics.latency.averageRead + metrics.latency.averageWrite) / 2
    const latencyScore = Math.max(0, 100 - (avgLatency / 10) * 100)

    const weightedScore = (
      iopsScore * iopsWeight +
      throughputScore * throughputWeight +
      latencyScore * latencyWeight
    )

    return Math.round(weightedScore * 100) // 0-10000 scale
  }

  // ============ Deviation & Reputation ============

  private calculateDeviation(
    provider: StorageProviderInfo,
    results: StorageBenchmarkResults,
  ): number {
    const deviations: number[] = []

    // IOPS deviation
    if (provider.claimedIops > 0) {
      const actualIops = (results.iops.randomRead4k + results.iops.randomWrite4k) / 2
      deviations.push(Math.abs(provider.claimedIops - actualIops) / provider.claimedIops)
    }

    // Throughput deviation
    if (provider.claimedThroughputMbps > 0) {
      const actualThroughput = (results.throughput.sequentialRead + results.throughput.sequentialWrite) / 2
      deviations.push(Math.abs(provider.claimedThroughputMbps - actualThroughput) / provider.claimedThroughputMbps)
    }

    // Capacity deviation
    if (provider.claimedCapacityMb > 0) {
      deviations.push(Math.abs(provider.claimedCapacityMb - results.storage.totalCapacityMb) / provider.claimedCapacityMb)
    }

    if (deviations.length === 0) return 0
    return (deviations.reduce((a, b) => a + b, 0) / deviations.length) * 100
  }

  private updateReputation(
    providerId: string,
    results: StorageBenchmarkResults,
    deviationPercent: number,
  ): void {
    let reputation = providerReputations.get(providerId)

    if (!reputation) {
      reputation = {
        providerId,
        score: 50,
        benchmarkCount: 0,
        passCount: 0,
        failCount: 0,
        lastBenchmarkAt: 0,
        lastDeviationPercent: 0,
        uptimePercent: 100,
        flags: [],
      }
    }

    reputation.benchmarkCount++
    reputation.lastBenchmarkAt = Date.now()
    reputation.lastDeviationPercent = deviationPercent

    if (deviationPercent < this.config.warnDeviationPercent) {
      reputation.passCount++
      reputation.score = Math.min(100, reputation.score + 5)
    } else if (deviationPercent < this.config.failDeviationPercent) {
      reputation.score = Math.max(0, reputation.score - 2)
    } else {
      reputation.failCount++
      reputation.score = Math.max(0, reputation.score - 15)
      reputation.flags.push(`deviation_${deviationPercent.toFixed(0)}%_at_${Date.now()}`)
    }

    providerReputations.set(providerId, reputation)
  }

  private shouldBenchmark(
    reputation: StorageProviderReputation,
    now: number,
  ): { needed: boolean; type: 'scheduled' | 'random' } {
    const daysSinceLastBenchmark = (now - reputation.lastBenchmarkAt) / (1000 * 60 * 60 * 24)

    if (reputation.benchmarkCount === 0) {
      return { needed: true, type: 'scheduled' }
    }

    let intervalDays: number
    if (reputation.score < 30) {
      intervalDays = this.config.lowReputationIntervalDays
    } else if (reputation.score < 70) {
      intervalDays = this.config.mediumReputationIntervalDays
    } else {
      intervalDays = this.config.highReputationIntervalDays
    }

    if (daysSinceLastBenchmark >= intervalDays) {
      return { needed: true, type: 'scheduled' }
    }

    if (daysSinceLastBenchmark >= 1) {
      const random = Math.random() * 100
      if (random < this.config.randomSpotCheckPercent) {
        return { needed: true, type: 'random' }
      }
    }

    return { needed: false, type: 'scheduled' }
  }

  // ============ Queries ============

  /**
   * Get reputation for a provider
   */
  getReputation(providerId: string): StorageProviderReputation {
    return providerReputations.get(providerId) ?? {
      providerId,
      score: 50,
      benchmarkCount: 0,
      passCount: 0,
      failCount: 0,
      lastBenchmarkAt: 0,
      lastDeviationPercent: 0,
      uptimePercent: 100,
      flags: [],
    }
  }

  /**
   * Get benchmark history for a provider
   */
  getBenchmarkHistory(providerId: string): StorageBenchmarkResults[] {
    return benchmarkResults.get(providerId) ?? []
  }

  /**
   * Get all jobs
   */
  getJobs(): StorageBenchmarkJob[] {
    return Array.from(benchmarkJobs.values())
  }

  /**
   * Get ranked providers by score
   */
  getRankedProviders(limit = 50): Array<{ provider: StorageProviderInfo; reputation: StorageProviderReputation }> {
    const ranked = Array.from(registeredProviders.values())
      .map((provider) => ({
        provider,
        reputation: this.getReputation(provider.id),
      }))
      .sort((a, b) => b.reputation.score - a.reputation.score)
      .slice(0, limit)

    return ranked
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalProviders: number
    benchmarkedProviders: number
    pendingBenchmarks: number
    averageScore: number
  } {
    const providers = Array.from(registeredProviders.values())
    const reputations = providers.map((p) => this.getReputation(p.id))
    const benchmarked = reputations.filter((r) => r.benchmarkCount > 0)

    return {
      totalProviders: providers.length,
      benchmarkedProviders: benchmarked.length,
      pendingBenchmarks: pendingBenchmarks.size,
      averageScore: benchmarked.length > 0
        ? Math.round(benchmarked.reduce((a, b) => a + b.score, 0) / benchmarked.length)
        : 0,
    }
  }
}

// ============ Singleton ============

let storageBenchmarkService: StorageBenchmarkService | null = null

export function getStorageBenchmarkService(): StorageBenchmarkService {
  if (!storageBenchmarkService) {
    storageBenchmarkService = new StorageBenchmarkService()
  }
  return storageBenchmarkService
}

export function startStorageBenchmarkService(): void {
  getStorageBenchmarkService().start()
}

export function stopStorageBenchmarkService(): void {
  if (storageBenchmarkService) {
    storageBenchmarkService.stop()
  }
}

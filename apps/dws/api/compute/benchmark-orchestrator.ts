/**
 * Benchmark Orchestrator
 *
 * Coordinates benchmarking across the DWS network:
 * - Initial benchmark on first machine activation
 * - Random re-verification (reputation-linked frequency)
 * - On-chain result storage via ComputeBenchmarkRegistry
 * - Cost-efficient scheduling to avoid wasting resources
 *
 * Architecture:
 *
 * 1. Machine activates → Initial benchmark runs
 * 2. Benchmark container deployed to machine
 * 3. Results collected and verified against claimed specs
 * 4. Results published to on-chain registry
 * 5. Deviation triggers review/slashing
 *
 * Reputation-Based Frequency:
 * - New machines: Always benchmark on first activation
 * - Low reputation (<30): Verify every 7 days
 * - Medium reputation (30-70): Verify every 30 days
 * - High reputation (>70): Verify every 90 days
 * - Random spot checks: 1% of all machines daily
 */

import { Cron } from 'croner'
import type { Hex } from 'viem'
import { z } from 'zod'

import type {
  MachineAllocation,
  MachinePromise,
  MachineSpecs,
} from '../infrastructure/machine-provisioner'
import { getMachineProvisioner } from '../infrastructure/machine-provisioner'
import type { BenchmarkRegistryClient } from './benchmark-registry-client'

// ============ Types ============

export interface BenchmarkJob {
  id: string
  machineId: string
  type: 'initial' | 'scheduled' | 'random' | 'manual'
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt: number | null
  results: BenchmarkResults | null
  error: string | null
}

export interface BenchmarkResults {
  // CPU
  cpuSingleCore: number // Score 0-10000
  cpuMultiCore: number
  cpuCores: number
  cpuModel: string
  cpuFrequencyMhz: number

  // Memory
  memoryMb: number
  memoryBandwidthMbps: number
  memoryLatencyNs: number

  // Storage
  storageMb: number
  storageType: 'ssd' | 'nvme' | 'hdd'
  sequentialReadMbps: number
  sequentialWriteMbps: number
  randomReadIops: number
  randomWriteIops: number

  // Network
  networkBandwidthMbps: number
  networkLatencyMs: number

  // GPU (optional)
  gpuDetected: boolean
  gpuModel: string | null
  gpuMemoryMb: number | null
  gpuFp32Tflops: number | null
  gpuInferenceScore: number | null

  // TEE (optional)
  teeDetected: boolean
  teePlatform: string | null
  teeAttestationHash: Hex | null
  teeAttestationValid: boolean

  // Overall
  overallScore: number // 0-10000
  attestationHash: Hex
  timestamp: number
}

// Hex string validation regex - 0x followed by hex chars
const HEX_REGEX = /^0x[a-fA-F0-9]+$/

export const BenchmarkResultsSchema = z.object({
  cpuSingleCore: z.number().min(0).max(10000),
  cpuMultiCore: z.number().min(0).max(10000),
  cpuCores: z.number().min(1),
  cpuModel: z.string(),
  cpuFrequencyMhz: z.number().min(0),
  memoryMb: z.number().min(0),
  memoryBandwidthMbps: z.number().min(0),
  memoryLatencyNs: z.number().min(0),
  storageMb: z.number().min(0),
  storageType: z.enum(['ssd', 'nvme', 'hdd']),
  sequentialReadMbps: z.number().min(0),
  sequentialWriteMbps: z.number().min(0),
  randomReadIops: z.number().min(0),
  randomWriteIops: z.number().min(0),
  networkBandwidthMbps: z.number().min(0),
  networkLatencyMs: z.number().min(0),
  gpuDetected: z.boolean(),
  gpuModel: z.string().nullable(),
  gpuMemoryMb: z.number().nullable(),
  gpuFp32Tflops: z.number().nullable(),
  gpuInferenceScore: z.number().nullable(),
  teeDetected: z.boolean(),
  teePlatform: z.string().nullable(),
  teeAttestationHash: z
    .string()
    .regex(HEX_REGEX, 'Must be a valid hex string')
    .nullable(),
  teeAttestationValid: z.boolean(),
  overallScore: z.number().min(0).max(10000),
  attestationHash: z.string().regex(HEX_REGEX, 'Must be a valid hex string'),
  timestamp: z.number(),
})

export interface MachineReputation {
  machineId: string
  score: number // 0-100
  benchmarkCount: number
  passCount: number
  failCount: number
  lastBenchmarkAt: number
  lastDeviationPercent: number
  flags: string[]
}

interface BenchmarkOrchestratorConfig {
  // Benchmark container image
  benchmarkImage: string
  benchmarkTimeout: number

  // Deviation thresholds
  warnDeviationPercent: number // Warn if deviation > this
  failDeviationPercent: number // Fail if deviation > this
  slashDeviationPercent: number // Slash if deviation > this

  // Re-verification schedule (days)
  lowReputationIntervalDays: number
  mediumReputationIntervalDays: number
  highReputationIntervalDays: number

  // Random spot check percentage (0-100)
  randomSpotCheckPercent: number

  // Cost controls
  maxConcurrentBenchmarks: number
  benchmarkCooldownMs: number
}

const DEFAULT_CONFIG: BenchmarkOrchestratorConfig = {
  benchmarkImage: 'ghcr.io/jejunetwork/benchmark:latest',
  benchmarkTimeout: 300000, // 5 minutes

  warnDeviationPercent: 10,
  failDeviationPercent: 25,
  slashDeviationPercent: 50,

  lowReputationIntervalDays: 7,
  mediumReputationIntervalDays: 30,
  highReputationIntervalDays: 90,

  randomSpotCheckPercent: 1, // 1% daily

  maxConcurrentBenchmarks: 5,
  benchmarkCooldownMs: 60000, // 1 minute between benchmarks per machine
}

// ============ State ============

// In-memory state (would be EQLite in production)
const benchmarkJobs = new Map<string, BenchmarkJob>()
const machineReputations = new Map<string, MachineReputation>()
const benchmarkHistory = new Map<string, BenchmarkResults[]>() // machineId -> results
const pendingBenchmarks = new Set<string>() // machineIds currently being benchmarked

// ============ Main Orchestrator ============

export class BenchmarkOrchestrator {
  private config: BenchmarkOrchestratorConfig
  private cronJob: Cron | null = null
  private running = false
  private registryClient: BenchmarkRegistryClient | null = null

  constructor(config: Partial<BenchmarkOrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Set the on-chain registry client for publishing results
   */
  setRegistryClient(client: BenchmarkRegistryClient): void {
    this.registryClient = client
  }

  /**
   * Start the orchestrator cron job
   */
  start(): void {
    if (this.running) return

    // Run every hour to check for machines needing benchmarks
    this.cronJob = new Cron('0 * * * *', async () => {
      await this.runScheduledBenchmarks()
    })

    this.running = true
    console.log(
      '[BenchmarkOrchestrator] Started - checking hourly for machines needing benchmarks',
    )
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop()
      this.cronJob = null
    }
    this.running = false
    console.log('[BenchmarkOrchestrator] Stopped')
  }

  /**
   * Benchmark a machine on first activation
   * Called by MachineProvisioner when a machine is first allocated
   */
  async benchmarkOnActivation(
    machineId: string,
    allocation: MachineAllocation,
    claimedSpecs: MachineSpecs,
  ): Promise<BenchmarkJob> {
    console.log(
      `[BenchmarkOrchestrator] Initial benchmark for machine ${machineId}`,
    )

    return this.runBenchmark(machineId, 'initial', allocation, claimedSpecs)
  }

  /**
   * Run scheduled benchmarks based on reputation
   */
  async runScheduledBenchmarks(): Promise<void> {
    const provisioner = getMachineProvisioner()
    const now = Date.now()
    const machines = provisioner.listAvailableMachines()

    console.log(
      `[BenchmarkOrchestrator] Checking ${machines.length} machines for scheduled benchmarks`,
    )

    let scheduled = 0
    const maxToSchedule =
      this.config.maxConcurrentBenchmarks - pendingBenchmarks.size

    for (const machine of machines) {
      if (scheduled >= maxToSchedule) break
      if (pendingBenchmarks.has(machine.id)) continue

      const reputation = this.getReputation(machine.id)
      const shouldBenchmark = this.shouldBenchmark(reputation, now)

      if (shouldBenchmark.needed) {
        console.log(
          `[BenchmarkOrchestrator] Scheduling ${shouldBenchmark.type} benchmark for ${machine.id}`,
        )

        // We need to allocate the machine to benchmark it
        // The provisioner pays for this - it's cost of being listed
        this.queueBenchmark(machine, shouldBenchmark.type)
        scheduled++
      }
    }

    console.log(`[BenchmarkOrchestrator] Scheduled ${scheduled} benchmarks`)
  }

  /**
   * Determine if a machine needs benchmarking
   */
  private shouldBenchmark(
    reputation: MachineReputation,
    now: number,
  ): { needed: boolean; type: 'scheduled' | 'random' } {
    const daysSinceLastBenchmark =
      (now - reputation.lastBenchmarkAt) / (1000 * 60 * 60 * 24)

    // Never benchmarked
    if (reputation.benchmarkCount === 0) {
      return { needed: true, type: 'scheduled' }
    }

    // Check reputation-based interval
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

    // Random spot check (only once per day max)
    if (daysSinceLastBenchmark >= 1) {
      const random = Math.random() * 100
      if (random < this.config.randomSpotCheckPercent) {
        return { needed: true, type: 'random' }
      }
    }

    return { needed: false, type: 'scheduled' }
  }

  /**
   * Queue a benchmark for a machine
   */
  private async queueBenchmark(
    machine: MachinePromise,
    type: 'scheduled' | 'random',
  ): Promise<void> {
    pendingBenchmarks.add(machine.id)

    // In production, this would allocate the machine and run the benchmark
    // For now, we simulate the benchmark
    const jobId = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const job: BenchmarkJob = {
      id: jobId,
      machineId: machine.id,
      type,
      status: 'pending',
      startedAt: Date.now(),
      completedAt: null,
      results: null,
      error: null,
    }

    benchmarkJobs.set(jobId, job)

    // Run async
    this.executeBenchmark(job, machine).catch((err) => {
      console.error(`[BenchmarkOrchestrator] Benchmark ${jobId} failed:`, err)
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      job.completedAt = Date.now()
      pendingBenchmarks.delete(machine.id)
    })
  }

  /**
   * Execute a benchmark on a machine
   */
  private async executeBenchmark(
    job: BenchmarkJob,
    machine: MachinePromise,
  ): Promise<void> {
    job.status = 'running'

    // Deploy benchmark container to the machine's activation endpoint
    const benchmarkEndpoint = `${machine.activationEndpoint}/v1/benchmark`

    const response = await fetch(benchmarkEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        image: this.config.benchmarkImage,
        timeout: this.config.benchmarkTimeout,
      }),
      signal: AbortSignal.timeout(this.config.benchmarkTimeout),
    })

    if (!response.ok) {
      throw new Error(`Benchmark request failed: ${response.status}`)
    }

    const rawResults: unknown = await response.json()
    const parsedResults = BenchmarkResultsSchema.parse(rawResults)

    // Transform parsed results - Zod validates hex format, safe to cast
    const results = this.transformParsedResults(parsedResults)

    // Calculate deviation from claimed specs
    const deviation = this.calculateDeviation(machine.specs, results)

    // Update job
    job.status = 'completed'
    job.completedAt = Date.now()
    job.results = results

    // Update reputation
    this.updateReputation(machine.id, results, deviation)

    // Store results
    const history = benchmarkHistory.get(machine.id) ?? []
    history.push(results)
    benchmarkHistory.set(machine.id, history.slice(-10)) // Keep last 10

    // Check deviation thresholds
    if (deviation > this.config.slashDeviationPercent) {
      console.warn(
        `[BenchmarkOrchestrator] SLASH: Machine ${machine.id} deviation ${deviation.toFixed(1)}% exceeds threshold`,
      )
      // Would trigger on-chain slashing here
    } else if (deviation > this.config.failDeviationPercent) {
      console.warn(
        `[BenchmarkOrchestrator] FAIL: Machine ${machine.id} deviation ${deviation.toFixed(1)}%`,
      )
    } else if (deviation > this.config.warnDeviationPercent) {
      console.warn(
        `[BenchmarkOrchestrator] WARN: Machine ${machine.id} deviation ${deviation.toFixed(1)}%`,
      )
    }

    pendingBenchmarks.delete(machine.id)
    console.log(
      `[BenchmarkOrchestrator] Completed benchmark for ${machine.id} - score: ${results.overallScore}, deviation: ${deviation.toFixed(1)}%`,
    )

    // Publish results on-chain
    if (this.registryClient) {
      await this.publishToChain(results as BenchmarkResults, deviation)
    }
  }

  /**
   * Publish benchmark results to on-chain registry
   */
  private async publishToChain(
    results: BenchmarkResults,
    deviation: number,
  ): Promise<void> {
    if (!this.registryClient) return

    console.log(`[BenchmarkOrchestrator] Publishing results on-chain...`)

    const txHash = await this.registryClient.submitBenchmark(results)
    console.log(
      `[BenchmarkOrchestrator] Published benchmark on-chain: ${txHash}`,
    )

    // If deviation is low, auto-verify (self-reported becomes verified)
    if (deviation < this.config.warnDeviationPercent) {
      // Results are consistent with claimed specs - could auto-verify
      // For now, leave as self-reported and let authorized verifiers confirm
    }
  }

  /**
   * Run a benchmark (internal)
   */
  private async runBenchmark(
    machineId: string,
    type: BenchmarkJob['type'],
    allocation: MachineAllocation,
    claimedSpecs: MachineSpecs,
  ): Promise<BenchmarkJob> {
    const jobId = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const job: BenchmarkJob = {
      id: jobId,
      machineId,
      type,
      status: 'pending',
      startedAt: Date.now(),
      completedAt: null,
      results: null,
      error: null,
    }

    benchmarkJobs.set(jobId, job)
    pendingBenchmarks.add(machineId)

    // Deploy benchmark container to the allocated machine
    if (!allocation.endpoint) {
      job.status = 'failed'
      job.error = 'Machine not yet active'
      job.completedAt = Date.now()
      pendingBenchmarks.delete(machineId)
      return job
    }

    job.status = 'running'

    const benchmarkEndpoint = `${allocation.endpoint}/v1/benchmark`

    const response = await fetch(benchmarkEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        image: this.config.benchmarkImage,
        timeout: this.config.benchmarkTimeout,
      }),
      signal: AbortSignal.timeout(this.config.benchmarkTimeout),
    })

    if (!response.ok) {
      job.status = 'failed'
      job.error = `Benchmark request failed: ${response.status}`
      job.completedAt = Date.now()
      pendingBenchmarks.delete(machineId)
      return job
    }

    const rawResults: unknown = await response.json()
    const parsedResults = BenchmarkResultsSchema.parse(rawResults)

    // Transform parsed results - Zod validates hex format, safe to cast
    const results = this.transformParsedResults(parsedResults)

    // Calculate deviation
    const deviation = this.calculateDeviation(claimedSpecs, results)

    // Update job
    job.status = 'completed'
    job.completedAt = Date.now()
    job.results = results

    // Update reputation
    this.updateReputation(machineId, results, deviation)

    // Store results
    const history = benchmarkHistory.get(machineId) ?? []
    history.push(results)
    benchmarkHistory.set(machineId, history.slice(-10))

    pendingBenchmarks.delete(machineId)
    return job
  }

  /**
   * Transform Zod-parsed results to typed BenchmarkResults
   * Zod validates hex format, so cast is safe
   */
  private transformParsedResults(
    parsed: z.infer<typeof BenchmarkResultsSchema>,
  ): BenchmarkResults {
    return {
      cpuSingleCore: parsed.cpuSingleCore,
      cpuMultiCore: parsed.cpuMultiCore,
      cpuCores: parsed.cpuCores,
      cpuModel: parsed.cpuModel,
      cpuFrequencyMhz: parsed.cpuFrequencyMhz,
      memoryMb: parsed.memoryMb,
      memoryBandwidthMbps: parsed.memoryBandwidthMbps,
      memoryLatencyNs: parsed.memoryLatencyNs,
      storageMb: parsed.storageMb,
      storageType: parsed.storageType,
      sequentialReadMbps: parsed.sequentialReadMbps,
      sequentialWriteMbps: parsed.sequentialWriteMbps,
      randomReadIops: parsed.randomReadIops,
      randomWriteIops: parsed.randomWriteIops,
      networkBandwidthMbps: parsed.networkBandwidthMbps,
      networkLatencyMs: parsed.networkLatencyMs,
      gpuDetected: parsed.gpuDetected,
      gpuModel: parsed.gpuModel,
      gpuMemoryMb: parsed.gpuMemoryMb,
      gpuFp32Tflops: parsed.gpuFp32Tflops,
      gpuInferenceScore: parsed.gpuInferenceScore,
      teeDetected: parsed.teeDetected,
      teePlatform: parsed.teePlatform,
      teeAttestationHash: parsed.teeAttestationHash as Hex | null,
      teeAttestationValid: parsed.teeAttestationValid,
      overallScore: parsed.overallScore,
      attestationHash: parsed.attestationHash as Hex,
      timestamp: parsed.timestamp,
    }
  }

  /**
   * Calculate deviation between claimed specs and actual benchmark results
   */
  private calculateDeviation(
    claimed: MachineSpecs,
    actual: BenchmarkResults,
  ): number {
    const deviations: number[] = []

    // CPU cores
    if (claimed.cpuCores > 0) {
      const cpuDeviation =
        Math.abs(claimed.cpuCores - actual.cpuCores) / claimed.cpuCores
      deviations.push(cpuDeviation)
    }

    // Memory
    if (claimed.memoryMb > 0) {
      const memDeviation =
        Math.abs(claimed.memoryMb - actual.memoryMb) / claimed.memoryMb
      deviations.push(memDeviation)
    }

    // Storage
    if (claimed.storageMb > 0) {
      const storageDeviation =
        Math.abs(claimed.storageMb - actual.storageMb) / claimed.storageMb
      deviations.push(storageDeviation)
    }

    // Network bandwidth
    if (claimed.networkBandwidthMbps > 0) {
      const netDeviation =
        Math.abs(claimed.networkBandwidthMbps - actual.networkBandwidthMbps) /
        claimed.networkBandwidthMbps
      deviations.push(netDeviation)
    }

    // GPU (if claimed)
    if (claimed.gpuCount > 0 && claimed.gpuType) {
      if (!actual.gpuDetected) {
        deviations.push(1.0) // 100% deviation - GPU missing
      } else if (claimed.gpuMemoryMb > 0 && actual.gpuMemoryMb) {
        const gpuMemDeviation =
          Math.abs(claimed.gpuMemoryMb - actual.gpuMemoryMb) /
          claimed.gpuMemoryMb
        deviations.push(gpuMemDeviation)
      }
    }

    // TEE (if claimed) - check if provider claimed TEE support
    if (claimed.teePlatform) {
      if (!actual.teeDetected) {
        deviations.push(1.0) // 100% deviation - TEE claimed but not detected
      } else if (!actual.teeAttestationValid) {
        deviations.push(0.5) // 50% deviation - TEE detected but attestation invalid
      } else if (actual.teePlatform !== claimed.teePlatform) {
        deviations.push(0.3) // 30% deviation - TEE platform mismatch
      }
    }

    // Average deviation as percentage
    if (deviations.length === 0) return 0
    return (deviations.reduce((a, b) => a + b, 0) / deviations.length) * 100
  }

  /**
   * Update machine reputation based on benchmark results
   */
  private updateReputation(
    machineId: string,
    _results: BenchmarkResults,
    deviationPercent: number,
  ): void {
    let reputation = machineReputations.get(machineId)

    if (!reputation) {
      reputation = {
        machineId,
        score: 50, // Start neutral
        benchmarkCount: 0,
        passCount: 0,
        failCount: 0,
        lastBenchmarkAt: 0,
        lastDeviationPercent: 0,
        flags: [],
      }
    }

    reputation.benchmarkCount++
    reputation.lastBenchmarkAt = Date.now()
    reputation.lastDeviationPercent = deviationPercent

    // Adjust score based on deviation
    if (deviationPercent < this.config.warnDeviationPercent) {
      // Good result - increase reputation
      reputation.passCount++
      reputation.score = Math.min(100, reputation.score + 5)
    } else if (deviationPercent < this.config.failDeviationPercent) {
      // Warning - small decrease
      reputation.score = Math.max(0, reputation.score - 2)
    } else {
      // Fail - significant decrease
      reputation.failCount++
      reputation.score = Math.max(0, reputation.score - 15)
      reputation.flags.push(
        `deviation_${deviationPercent.toFixed(0)}%_at_${Date.now()}`,
      )
    }

    machineReputations.set(machineId, reputation)
  }

  /**
   * Get machine reputation
   */
  getReputation(machineId: string): MachineReputation {
    return (
      machineReputations.get(machineId) ?? {
        machineId,
        score: 50,
        benchmarkCount: 0,
        passCount: 0,
        failCount: 0,
        lastBenchmarkAt: 0,
        lastDeviationPercent: 0,
        flags: [],
      }
    )
  }

  /**
   * Get benchmark history for a machine
   */
  getBenchmarkHistory(machineId: string): BenchmarkResults[] {
    return benchmarkHistory.get(machineId) ?? []
  }

  /**
   * Get all benchmark jobs
   */
  getJobs(): BenchmarkJob[] {
    return Array.from(benchmarkJobs.values())
  }

  /**
   * Get pending benchmark count
   */
  getPendingCount(): number {
    return pendingBenchmarks.size
  }

  /**
   * Manually trigger benchmark for a machine
   */
  async triggerBenchmark(machineId: string): Promise<BenchmarkJob | null> {
    const provisioner = getMachineProvisioner()
    const machine = provisioner.getMachine(machineId)

    if (!machine) {
      console.error(`[BenchmarkOrchestrator] Machine ${machineId} not found`)
      return null
    }

    await this.queueBenchmark(machine, 'scheduled')

    // Return the most recent job for this machine
    const jobs = Array.from(benchmarkJobs.values())
      .filter((j) => j.machineId === machineId)
      .sort((a, b) => b.startedAt - a.startedAt)

    return jobs[0] ?? null
  }
}

// ============ Singleton ============

let orchestrator: BenchmarkOrchestrator | null = null

export function getBenchmarkOrchestrator(): BenchmarkOrchestrator {
  if (!orchestrator) {
    orchestrator = new BenchmarkOrchestrator()
  }
  return orchestrator
}

export function startBenchmarkOrchestrator(): void {
  getBenchmarkOrchestrator().start()
}

export function stopBenchmarkOrchestrator(): void {
  if (orchestrator) {
    orchestrator.stop()
  }
}

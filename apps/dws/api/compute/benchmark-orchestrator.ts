/**
 * Benchmark Orchestrator - Coordinates compute benchmarking with reputation-linked frequency
 *
 * Frequency: New=always, Low(<30)=7d, Medium(30-70)=30d, High(>70)=90d, Random=1%/day
 */

import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import { Cron } from 'croner'
import type { Hex } from 'viem'
import { z } from 'zod'

import type {
  MachineAllocation,
  MachinePromise,
  MachineSpecs,
} from '../infrastructure/machine-provisioner'
import { getMachineProvisioner } from '../infrastructure/machine-provisioner'
import { getPoCNodeVerifier, type PoCNodeVerifier } from '../infrastructure/poc-node-verifier'
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
  region: string // Geographic region (e.g., "us-east-1", "eu-west-1")
  ipv6Supported: boolean

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

  // Proof-of-Cloud (cloud alliance verification)
  pocVerified: boolean
  pocLevel: 1 | 2 | 3 | null
  pocCloudProvider: string | null
  pocRegion: string | null
  pocHardwareIdHash: Hex | null
  pocReputationDelta: number

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
  region: z.string(),
  ipv6Supported: z.boolean(),
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
  // PoC fields (may not be present in older benchmark responses)
  pocVerified: z.boolean().optional().default(false),
  pocLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]).optional().default(null),
  pocCloudProvider: z.string().nullable().optional().default(null),
  pocRegion: z.string().nullable().optional().default(null),
  pocHardwareIdHash: z.string().regex(HEX_REGEX, 'Must be a valid hex string').nullable().optional().default(null),
  pocReputationDelta: z.number().optional().default(0),
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

// ============ EQLite State Storage ============

const BENCHMARK_DB_ID = process.env.EQLITE_DATABASE_ID ?? 'dws-benchmarks'

let eqliteClient: EQLiteClient | null = null
let tablesInitialized = false

// Pending benchmarks tracked in-memory (ephemeral per-process state)
const pendingBenchmarks = new Set<string>()

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite({
      databaseId: BENCHMARK_DB_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })
  }
  return eqliteClient
}

async function ensureBenchmarkTables(): Promise<void> {
  if (tablesInitialized) return

  const client = await getEQLiteClient()

  await client.exec(
    `CREATE TABLE IF NOT EXISTS benchmark_jobs (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      results TEXT,
      error TEXT
    )`,
    [],
    BENCHMARK_DB_ID,
  )

  await client.exec(
    `CREATE TABLE IF NOT EXISTS machine_reputations (
      machine_id TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      benchmark_count INTEGER NOT NULL,
      pass_count INTEGER NOT NULL,
      fail_count INTEGER NOT NULL,
      last_benchmark_at INTEGER NOT NULL,
      last_deviation_percent REAL NOT NULL,
      flags TEXT NOT NULL
    )`,
    [],
    BENCHMARK_DB_ID,
  )

  await client.exec(
    `CREATE TABLE IF NOT EXISTS benchmark_history (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      results TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    [],
    BENCHMARK_DB_ID,
  )

  await client.exec(
    `CREATE INDEX IF NOT EXISTS idx_jobs_machine ON benchmark_jobs(machine_id)`,
    [],
    BENCHMARK_DB_ID,
  )
  await client.exec(
    `CREATE INDEX IF NOT EXISTS idx_history_machine ON benchmark_history(machine_id)`,
    [],
    BENCHMARK_DB_ID,
  )

  tablesInitialized = true
}

// Row types
interface BenchmarkJobRow {
  id: string
  machine_id: string
  type: string
  status: string
  started_at: number
  completed_at: number | null
  results: string | null
  error: string | null
}

interface MachineReputationRow {
  machine_id: string
  score: number
  benchmark_count: number
  pass_count: number
  fail_count: number
  last_benchmark_at: number
  last_deviation_percent: number
  flags: string
}

interface BenchmarkHistoryRow {
  id: string
  machine_id: string
  results: string
  created_at: number
}

// State operations
const benchmarkState = {
  async saveJob(job: BenchmarkJob): Promise<void> {
    await ensureBenchmarkTables()
    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO benchmark_jobs (id, machine_id, type, status, started_at, completed_at, results, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         completed_at = excluded.completed_at,
         results = excluded.results,
         error = excluded.error`,
      [
        job.id,
        job.machineId,
        job.type,
        job.status,
        job.startedAt,
        job.completedAt,
        job.results ? JSON.stringify(job.results) : null,
        job.error,
      ],
      BENCHMARK_DB_ID,
    )
  },

  async getJob(id: string): Promise<BenchmarkJob | null> {
    await ensureBenchmarkTables()
    const client = await getEQLiteClient()
    const result = await client.query<BenchmarkJobRow>(
      `SELECT * FROM benchmark_jobs WHERE id = ?`,
      [id],
      BENCHMARK_DB_ID,
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id,
      machineId: row.machine_id,
      type: row.type as BenchmarkJob['type'],
      status: row.status as BenchmarkJob['status'],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      results: row.results ? JSON.parse(row.results) : null,
      error: row.error,
    }
  },

  async getAllJobs(): Promise<BenchmarkJob[]> {
    await ensureBenchmarkTables()
    const client = await getEQLiteClient()
    const result = await client.query<BenchmarkJobRow>(
      `SELECT * FROM benchmark_jobs ORDER BY started_at DESC`,
      [],
      BENCHMARK_DB_ID,
    )
    return result.rows.map((row) => ({
      id: row.id,
      machineId: row.machine_id,
      type: row.type as BenchmarkJob['type'],
      status: row.status as BenchmarkJob['status'],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      results: row.results ? JSON.parse(row.results) : null,
      error: row.error,
    }))
  },

  async saveReputation(reputation: MachineReputation): Promise<void> {
    await ensureBenchmarkTables()
    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO machine_reputations (machine_id, score, benchmark_count, pass_count, fail_count, last_benchmark_at, last_deviation_percent, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(machine_id) DO UPDATE SET
         score = excluded.score,
         benchmark_count = excluded.benchmark_count,
         pass_count = excluded.pass_count,
         fail_count = excluded.fail_count,
         last_benchmark_at = excluded.last_benchmark_at,
         last_deviation_percent = excluded.last_deviation_percent,
         flags = excluded.flags`,
      [
        reputation.machineId,
        reputation.score,
        reputation.benchmarkCount,
        reputation.passCount,
        reputation.failCount,
        reputation.lastBenchmarkAt,
        reputation.lastDeviationPercent,
        JSON.stringify(reputation.flags),
      ],
      BENCHMARK_DB_ID,
    )
  },

  async getReputation(machineId: string): Promise<MachineReputation | null> {
    await ensureBenchmarkTables()
    const client = await getEQLiteClient()
    const result = await client.query<MachineReputationRow>(
      `SELECT * FROM machine_reputations WHERE machine_id = ?`,
      [machineId],
      BENCHMARK_DB_ID,
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      machineId: row.machine_id,
      score: row.score,
      benchmarkCount: row.benchmark_count,
      passCount: row.pass_count,
      failCount: row.fail_count,
      lastBenchmarkAt: row.last_benchmark_at,
      lastDeviationPercent: row.last_deviation_percent,
      flags: JSON.parse(row.flags),
    }
  },

  async addHistory(
    machineId: string,
    results: BenchmarkResults,
  ): Promise<void> {
    await ensureBenchmarkTables()
    const client = await getEQLiteClient()
    const id = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await client.exec(
      `INSERT INTO benchmark_history (id, machine_id, results, created_at) VALUES (?, ?, ?, ?)`,
      [id, machineId, JSON.stringify(results), Date.now()],
      BENCHMARK_DB_ID,
    )
    // Keep only last 10 results per machine
    await client.exec(
      `DELETE FROM benchmark_history WHERE machine_id = ? AND id NOT IN (
        SELECT id FROM benchmark_history WHERE machine_id = ? ORDER BY created_at DESC LIMIT 10
      )`,
      [machineId, machineId],
      BENCHMARK_DB_ID,
    )
  },

  async getHistory(machineId: string): Promise<BenchmarkResults[]> {
    await ensureBenchmarkTables()
    const client = await getEQLiteClient()
    const result = await client.query<BenchmarkHistoryRow>(
      `SELECT * FROM benchmark_history WHERE machine_id = ? ORDER BY created_at DESC LIMIT 10`,
      [machineId],
      BENCHMARK_DB_ID,
    )
    return result.rows.map((row) => JSON.parse(row.results))
  },
}

// ============ Main Orchestrator ============

export class BenchmarkOrchestrator {
  private config: BenchmarkOrchestratorConfig
  private cronJob: Cron | null = null
  private running = false
  private registryClient: BenchmarkRegistryClient | null = null
  private pocVerifier: PoCNodeVerifier | null = null

  constructor(config: Partial<BenchmarkOrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize PoC verifier for cloud alliance checks
    try {
      this.pocVerifier = getPoCNodeVerifier()
      console.log('[BenchmarkOrchestrator] PoC verifier initialized for cloud alliance checks')
    } catch (err) {
      console.warn('[BenchmarkOrchestrator] PoC verifier not available:', err)
    }
  }

  /**
   * Set the on-chain registry client for publishing results
   */
  setRegistryClient(client: BenchmarkRegistryClient): void {
    this.registryClient = client
  }

  /**
   * Set a custom PoC verifier (for testing or custom configurations)
   */
  setPoCVerifier(verifier: PoCNodeVerifier): void {
    this.pocVerifier = verifier
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
    agentId?: bigint,
  ): Promise<BenchmarkJob> {
    console.log(
      `[BenchmarkOrchestrator] Initial benchmark for machine ${machineId}`,
    )

    return this.runBenchmark(machineId, 'initial', allocation, claimedSpecs, agentId)
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

      const reputation = await this.getReputation(machine.id)
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

    await benchmarkState.saveJob(job)

    // Run async
    this.executeBenchmark(job, machine).catch(async (err) => {
      console.error(`[BenchmarkOrchestrator] Benchmark ${jobId} failed:`, err)
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      job.completedAt = Date.now()
      await benchmarkState.saveJob(job)
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
    let results = this.transformParsedResults(parsedResults)

    // Run PoC verification if TEE is detected and we have an attestation
    if (results.teeDetected && results.teeAttestationHash) {
      if (!this.pocVerifier) {
        console.warn(`[BenchmarkOrchestrator] PoC skipped for ${machine.id}: verifier not initialized`)
      } else if (!machine.agentId) {
        console.warn(`[BenchmarkOrchestrator] PoC skipped for ${machine.id}: missing agentId`)
      } else {
        console.log(`[BenchmarkOrchestrator] Running PoC verification for machine ${machine.id} (agent ${machine.agentId})`)
        results = await this.runPoCVerification(machine.agentId, results)
      }
    }

    // Calculate deviation from claimed specs
    const deviation = this.calculateDeviation(machine.specs, results)

    // Update job
    job.status = 'completed'
    job.completedAt = Date.now()
    job.results = results
    await benchmarkState.saveJob(job)

    // Update reputation
    await this.updateReputation(machine.id, results, deviation)

    // Store results
    await benchmarkState.addHistory(machine.id, results)

    // Check deviation thresholds and take action
    if (deviation > this.config.slashDeviationPercent) {
      console.error(
        `[BenchmarkOrchestrator] SLASH: Machine ${machine.id} deviation ${deviation.toFixed(1)}% exceeds threshold`,
      )
      // Flag for slashing via dispute mechanism
      if (this.registryClient) {
        await this.registryClient
          .disputeBenchmark(
            machine.operator,
            `Benchmark deviation ${deviation.toFixed(1)}% exceeds ${this.config.slashDeviationPercent}% threshold`,
          )
          .catch((err) => {
            console.error(
              `[BenchmarkOrchestrator] Failed to submit dispute:`,
              err,
            )
          })
      }
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
   * Run Proof-of-Cloud verification against the cloud alliance registry.
   */
  private async runPoCVerification(agentId: bigint, results: BenchmarkResults): Promise<BenchmarkResults> {
    if (!this.pocVerifier || !results.teeAttestationHash) {
      return results
    }

    const pocResult = await this.pocVerifier.verifyNode(agentId, results.teeAttestationHash)

    console.log(`[BenchmarkOrchestrator] PoC: agent=${agentId} verified=${pocResult.verified} level=${pocResult.level} delta=${pocResult.reputationDelta}`)

    return {
      ...results,
      pocVerified: pocResult.verified,
      pocLevel: pocResult.level,
      pocCloudProvider: pocResult.cloudProvider,
      pocRegion: pocResult.region,
      pocHardwareIdHash: pocResult.hardwareIdHash,
      pocReputationDelta: pocResult.reputationDelta,
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
    agentId?: bigint,
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

    await benchmarkState.saveJob(job)
    pendingBenchmarks.add(machineId)

    if (!allocation.endpoint) {
      job.status = 'failed'
      job.error = 'Machine not yet active'
      job.completedAt = Date.now()
      await benchmarkState.saveJob(job)
      pendingBenchmarks.delete(machineId)
      return job
    }

    job.status = 'running'
    await benchmarkState.saveJob(job)

    const response = await fetch(`${allocation.endpoint}/v1/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, image: this.config.benchmarkImage, timeout: this.config.benchmarkTimeout }),
      signal: AbortSignal.timeout(this.config.benchmarkTimeout),
    })

    if (!response.ok) {
      job.status = 'failed'
      job.error = `Benchmark request failed: ${response.status}`
      job.completedAt = Date.now()
      await benchmarkState.saveJob(job)
      pendingBenchmarks.delete(machineId)
      return job
    }

    const rawResults: unknown = await response.json()
    const parsedResults = BenchmarkResultsSchema.parse(rawResults)
    let results = this.transformParsedResults(parsedResults)

    // Run PoC verification if TEE detected with attestation and we have an agentId
    if (results.teeDetected && results.teeAttestationHash && this.pocVerifier && agentId) {
      results = await this.runPoCVerification(agentId, results)
    }

    const deviation = this.calculateDeviation(claimedSpecs, results)

    job.status = 'completed'
    job.completedAt = Date.now()
    job.results = results
    await benchmarkState.saveJob(job)

    // Update reputation
    await this.updateReputation(machineId, results, deviation)

    // Store results
    await benchmarkState.addHistory(machineId, results)

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
      region: parsed.region,
      ipv6Supported: parsed.ipv6Supported,
      gpuDetected: parsed.gpuDetected,
      gpuModel: parsed.gpuModel,
      gpuMemoryMb: parsed.gpuMemoryMb,
      gpuFp32Tflops: parsed.gpuFp32Tflops,
      gpuInferenceScore: parsed.gpuInferenceScore,
      teeDetected: parsed.teeDetected,
      teePlatform: parsed.teePlatform,
      teeAttestationHash: parsed.teeAttestationHash as Hex | null,
      teeAttestationValid: parsed.teeAttestationValid,
      // Initialize PoC fields with defaults (will be updated by runPoCVerification)
      pocVerified: parsed.pocVerified ?? false,
      pocLevel: parsed.pocLevel ?? null,
      pocCloudProvider: parsed.pocCloudProvider ?? null,
      pocRegion: parsed.pocRegion ?? null,
      pocHardwareIdHash: (parsed.pocHardwareIdHash as Hex | null) ?? null,
      pocReputationDelta: parsed.pocReputationDelta ?? 0,
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
  private async updateReputation(
    machineId: string,
    results: BenchmarkResults,
    deviationPercent: number,
  ): Promise<void> {
    let reputation = await benchmarkState.getReputation(machineId)

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

    // Apply PoC reputation delta (cloud alliance bonus/penalty)
    if (results.pocReputationDelta !== 0) {
      reputation.score = Math.max(0, Math.min(100, reputation.score + results.pocReputationDelta))
      if (results.pocVerified) {
        reputation.flags.push(`poc_verified_level${results.pocLevel}_at_${Date.now()}`)
      } else if (results.pocReputationDelta < 0) {
        reputation.flags.push(`poc_failed_at_${Date.now()}`)
      }
      console.log(
        `[BenchmarkOrchestrator] Applied PoC reputation delta ${results.pocReputationDelta} to ${machineId}, ` +
        `new score: ${reputation.score}`,
      )
    }

    await benchmarkState.saveReputation(reputation)
  }

  /**
   * Get machine reputation
   */
  async getReputation(machineId: string): Promise<MachineReputation> {
    const reputation = await benchmarkState.getReputation(machineId)
    return (
      reputation ?? {
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
  async getBenchmarkHistory(machineId: string): Promise<BenchmarkResults[]> {
    return benchmarkState.getHistory(machineId)
  }

  /**
   * Get all benchmark jobs
   */
  async getJobs(): Promise<BenchmarkJob[]> {
    return benchmarkState.getAllJobs()
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
    const allJobs = await benchmarkState.getAllJobs()
    const jobs = allJobs
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

/**
 * Cron Executor Service
 *
 * Executes worker cron jobs by:
 * 1. Loading due schedules from dwsWorkerCronState
 * 2. Acquiring distributed locks to prevent duplicate execution
 * 3. Making HTTP requests to worker cron endpoints
 * 4. Recording execution results
 *
 * This integrates with the SQLit-persisted cron state rather than
 * the in-memory CronScheduler class.
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import {
  type DWSWorker,
  dwsWorkerCronState,
  dwsWorkerState,
  type WorkerCronSchedule,
} from '../state'

/** Configuration for the cron executor */
interface CronExecutorConfig {
  /** Base URL for making HTTP requests to workers */
  workerBaseUrl: string
  /** Interval between tick checks in milliseconds (default: 30000 = 30s) */
  tickIntervalMs: number
  /** Maximum concurrent cron executions (default: 10) */
  maxConcurrent: number
  /** Lock TTL in seconds (default: 300 = 5 minutes) */
  lockTtlSeconds: number
  /** Pod identifier for distributed locking */
  podId: string
}

/** Result of a cron execution */
export interface CronExecutionResult {
  scheduleId: string
  workerId: string
  name: string
  success: boolean
  statusCode?: number
  durationMs: number
  error?: string
}

/**
 * Distributed Cron Executor
 *
 * Uses cache-based distributed locks to ensure only one pod
 * executes each cron job when multiple DWS pods are running.
 */
export class CronExecutor {
  private config: CronExecutorConfig
  private cache: CacheClient
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private running = false
  private activeCronCount = 0
  private executionHistory: CronExecutionResult[] = []
  private readonly maxHistorySize = 100

  constructor(config: Partial<CronExecutorConfig> = {}) {
    const network = getCurrentNetwork()

    this.config = {
      workerBaseUrl:
        config.workerBaseUrl ?? `http://localhost:${process.env.PORT ?? 4030}`,
      tickIntervalMs: config.tickIntervalMs ?? 30000,
      maxConcurrent: config.maxConcurrent ?? 10,
      lockTtlSeconds: config.lockTtlSeconds ?? 300,
      podId:
        config.podId ?? process.env.POD_NAME ?? `dws-${network}-${process.pid}`,
    }

    this.cache = getCacheClient('dws-cron')
    console.log(`[CronExecutor] Initialized for pod ${this.config.podId}`)
  }

  /**
   * Start the cron executor
   */
  start(): void {
    if (this.running) {
      console.log('[CronExecutor] Already running')
      return
    }

    this.running = true
    console.log(
      `[CronExecutor] Starting with ${this.config.tickIntervalMs}ms tick interval`,
    )

    // Run initial tick
    this.tick().catch((error) => {
      console.error('[CronExecutor] Initial tick failed:', error)
    })

    // Start tick interval
    this.tickInterval = setInterval(() => {
      this.tick().catch((error) => {
        console.error('[CronExecutor] Tick failed:', error)
      })
    }, this.config.tickIntervalMs)
  }

  /**
   * Stop the cron executor
   */
  stop(): void {
    if (!this.running) return

    this.running = false
    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }
    console.log('[CronExecutor] Stopped')
  }

  /**
   * Tick - check for due crons and execute them
   */
  private async tick(): Promise<void> {
    if (!this.running) return

    // Check concurrency limit
    if (this.activeCronCount >= this.config.maxConcurrent) {
      console.log(
        `[CronExecutor] At max concurrency (${this.activeCronCount}/${this.config.maxConcurrent}), skipping tick`,
      )
      return
    }

    const now = Date.now()

    // Get due cron schedules
    const dueCrons = await dwsWorkerCronState.listDue(now)

    if (dueCrons.length === 0) {
      return // Nothing to do
    }

    console.log(`[CronExecutor] Found ${dueCrons.length} due cron(s)`)

    // Execute each due cron (up to concurrency limit)
    for (const cron of dueCrons) {
      if (this.activeCronCount >= this.config.maxConcurrent) {
        break
      }

      // Execute in background (don't await)
      this.executeCron(cron).catch((error) => {
        console.error(
          `[CronExecutor] Error executing cron ${cron.name}:`,
          error,
        )
      })
    }
  }

  /**
   * Execute a single cron job
   */
  private async executeCron(cron: WorkerCronSchedule): Promise<void> {
    const lockKey = `cron-lock:${cron.id}`

    // Try to acquire distributed lock
    const lockAcquired = await this.acquireLock(lockKey)
    if (!lockAcquired) {
      // Another pod is handling this cron
      return
    }

    this.activeCronCount++
    const startTime = Date.now()

    try {
      // Get worker info
      const worker = await dwsWorkerState.get(cron.workerId)
      if (!worker) {
        console.error(
          `[CronExecutor] Worker ${cron.workerId} not found for cron ${cron.name}`,
        )
        await dwsWorkerCronState.recordExecution(
          cron.workerId,
          cron.name,
          false,
          'Worker not found',
        )
        return
      }

      console.log(
        `[CronExecutor] Executing ${cron.name} (${cron.schedule}) → ${cron.endpoint}`,
      )

      // Make HTTP request to the cron endpoint
      const result = await this.invokeCronEndpoint(worker, cron)

      // Record execution result
      await dwsWorkerCronState.recordExecution(
        cron.workerId,
        cron.name,
        result.success,
        result.error,
      )

      // Add to history
      this.addToHistory(result)

      const durationMs = Date.now() - startTime
      if (result.success) {
        console.log(
          `[CronExecutor] Completed ${cron.name} in ${durationMs}ms (status: ${result.statusCode})`,
        )
      } else {
        console.error(
          `[CronExecutor] Failed ${cron.name} after ${durationMs}ms: ${result.error}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const durationMs = Date.now() - startTime

      await dwsWorkerCronState.recordExecution(
        cron.workerId,
        cron.name,
        false,
        message,
      )

      this.addToHistory({
        scheduleId: cron.id,
        workerId: cron.workerId,
        name: cron.name,
        success: false,
        durationMs,
        error: message,
      })

      console.error(`[CronExecutor] Exception in ${cron.name}: ${message}`)
    } finally {
      this.activeCronCount--
      await this.releaseLock(lockKey)
    }
  }

  /**
   * Invoke the cron endpoint on the worker via HTTP
   */
  private async invokeCronEndpoint(
    worker: DWSWorker,
    cron: WorkerCronSchedule,
  ): Promise<CronExecutionResult> {
    const startTime = Date.now()

    // Get CRON_SECRET from worker's env
    const cronSecret = worker.env.CRON_SECRET ?? 'development'

    // Build the URL - workers are invoked via DWS HTTP proxy
    const url = `${this.config.workerBaseUrl}/workers/${worker.id}/http${cron.endpoint}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, cron.timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': cronSecret,
          'x-cron-name': cron.name,
          'x-cron-schedule': cron.schedule,
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const durationMs = Date.now() - startTime
      const success = response.ok

      let error: string | undefined
      if (!success) {
        const body = await response
          .text()
          .catch(() => 'Failed to read response body')
        error = `HTTP ${response.status}: ${body.slice(0, 200)}`
      }

      return {
        scheduleId: cron.id,
        workerId: cron.workerId,
        name: cron.name,
        success,
        statusCode: response.status,
        durationMs,
        error,
      }
    } catch (error) {
      clearTimeout(timeoutId)

      const durationMs = Date.now() - startTime
      let message: string

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          message = `Timeout after ${cron.timeoutMs}ms`
        } else {
          message = error.message
        }
      } else {
        message = String(error)
      }

      return {
        scheduleId: cron.id,
        workerId: cron.workerId,
        name: cron.name,
        success: false,
        durationMs,
        error: message,
      }
    }
  }

  /**
   * Acquire a distributed lock using cache
   */
  private async acquireLock(key: string): Promise<boolean> {
    const lockValue = `${this.config.podId}:${Date.now()}`

    // Use SETNX-style operation via get+set
    const existing = await this.cache.get(key)
    if (existing) {
      // Lock already held
      return false
    }

    // Set lock with TTL
    await this.cache.set(key, lockValue, this.config.lockTtlSeconds)

    // Verify we got the lock (race condition check)
    const value = await this.cache.get(key)
    return value === lockValue
  }

  /**
   * Release a distributed lock
   */
  private async releaseLock(key: string): Promise<void> {
    await this.cache.delete(key)
  }

  /**
   * Add execution result to history
   */
  private addToHistory(result: CronExecutionResult): void {
    this.executionHistory.push(result)
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift()
    }
  }

  /**
   * Get recent execution history
   */
  getHistory(): CronExecutionResult[] {
    return [...this.executionHistory]
  }

  /**
   * Get executor statistics
   */
  async getStats(): Promise<{
    running: boolean
    podId: string
    activeCrons: number
    maxConcurrent: number
    tickIntervalMs: number
    recentExecutions: number
    successRate: number
    cronStats: {
      total: number
      enabled: number
      totalRuns: number
      successfulRuns: number
      failedRuns: number
    }
  }> {
    const cronStats = await dwsWorkerCronState.getStats()

    const recentSuccess = this.executionHistory.filter((r) => r.success).length
    const successRate =
      this.executionHistory.length > 0
        ? recentSuccess / this.executionHistory.length
        : 1

    return {
      running: this.running,
      podId: this.config.podId,
      activeCrons: this.activeCronCount,
      maxConcurrent: this.config.maxConcurrent,
      tickIntervalMs: this.config.tickIntervalMs,
      recentExecutions: this.executionHistory.length,
      successRate,
      cronStats,
    }
  }

  /**
   * Manually trigger a cron job (for testing/admin)
   */
  async triggerManually(
    workerId: string,
    cronName: string,
  ): Promise<CronExecutionResult> {
    const cron = await dwsWorkerCronState.get(workerId, cronName)
    if (!cron) {
      throw new Error(`Cron not found: ${workerId}:${cronName}`)
    }

    const worker = await dwsWorkerState.get(workerId)
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`)
    }

    console.log(`[CronExecutor] Manually triggering ${cron.name}`)

    const result = await this.invokeCronEndpoint(worker, cron)

    // Record execution (but don't update next_run_at for manual triggers)
    // We still want to track the execution in stats
    await dwsWorkerCronState.recordExecution(
      workerId,
      cronName,
      result.success,
      result.error,
    )

    this.addToHistory(result)

    return result
  }
}

// ============================================================================
// Singleton
// ============================================================================

let cronExecutor: CronExecutor | null = null

/**
 * Get or create the cron executor singleton
 */
export function getCronExecutor(
  config?: Partial<CronExecutorConfig>,
): CronExecutor {
  if (!cronExecutor) {
    cronExecutor = new CronExecutor(config)
  }
  return cronExecutor
}

/**
 * Start the cron executor (called during DWS startup)
 */
export function startCronExecutor(
  config?: Partial<CronExecutorConfig>,
): CronExecutor {
  const executor = getCronExecutor(config)
  executor.start()
  return executor
}

/**
 * Stop the cron executor (called during DWS shutdown)
 */
export function stopCronExecutor(): void {
  if (cronExecutor) {
    cronExecutor.stop()
    cronExecutor = null
  }
}

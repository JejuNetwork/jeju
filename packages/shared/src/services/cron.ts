/**
 * Cron Service - Scheduled Tasks Integration using croner library
 *
 * Provides scheduled task management via the compute network.
 * Local execution uses croner for timing, remote service for coordination.
 */

import { Cron } from 'croner'
import type { Address } from 'viem'
import { z } from 'zod'
import { CronJobSchema, CronListResponseSchema } from '../schemas'

const CronConfigSchema = z.object({
  endpoint: z.string().url(),
  webhookBase: z.string().url().optional(),
})

export type CronConfig = z.infer<typeof CronConfigSchema>

export interface CronService {
  register(job: CronJobConfig): Promise<CronJob>
  cancel(jobId: string): Promise<boolean>
  list(owner?: Address): Promise<CronJob[]>
  get(jobId: string): Promise<CronJob | null>
  trigger(jobId: string): Promise<void>
  isHealthy(): Promise<boolean>
}

export interface CronJobConfig {
  name: string
  type: 'cron' | 'once' | 'interval'
  expression?: string // Cron expression for 'cron' type
  triggerTime?: number // Unix timestamp for 'once' type
  intervalMs?: number // Milliseconds for 'interval' type
  webhook: string
  metadata?: Record<string, unknown>
  owner?: Address
}

export interface CronJob {
  id: string
  name: string
  type: 'cron' | 'once' | 'interval'
  expression?: string
  webhook: string
  enabled: boolean
  lastRun?: number
  nextRun: number
  executionCount: number
  metadata?: Record<string, unknown>
}

interface LocalCronJob extends CronJob {
  cronInstance?: Cron
  timeoutId?: ReturnType<typeof setTimeout>
}

// Max number of local jobs to prevent memory exhaustion
const MAX_LOCAL_JOBS = 10000

class CronServiceImpl implements CronService {
  private endpoint: string
  private localJobs = new Map<string, LocalCronJob>()

  constructor(config: CronConfig) {
    const validated = CronConfigSchema.parse(config)
    this.endpoint = validated.endpoint
  }

  /**
   * Clean up old completed one-time jobs and enforce max job limit
   */
  private enforceJobLimits(): void {
    if (this.localJobs.size < MAX_LOCAL_JOBS) return

    const jobEntries = Array.from(this.localJobs.entries())

    // First, remove any 'once' jobs that have already executed
    for (const [id, job] of jobEntries) {
      if (job.type === 'once' && job.lastRun !== null) {
        // Stop any timeouts
        if (job.timeoutId) {
          clearTimeout(job.timeoutId)
        }
        this.localJobs.delete(id)
      }
    }

    // If still over limit, remove oldest jobs by creation time (based on id timestamp)
    if (this.localJobs.size >= MAX_LOCAL_JOBS) {
      const remainingEntries = Array.from(this.localJobs.entries()).sort(
        (a, b) => {
          // Extract timestamp from job id format: "cron-{timestamp}-{random}"
          const tsA = parseInt(a[0].split('-')[1] || '0', 10)
          const tsB = parseInt(b[0].split('-')[1] || '0', 10)
          return tsA - tsB
        },
      )

      // Remove oldest 10%
      const toRemove = Math.ceil(remainingEntries.length * 0.1)
      for (let i = 0; i < toRemove; i++) {
        const [id, job] = remainingEntries[i]
        if (job.cronInstance) job.cronInstance.stop()
        if (job.timeoutId) clearTimeout(job.timeoutId)
        this.localJobs.delete(id)
      }
    }
  }

  async register(job: CronJobConfig): Promise<CronJob> {
    // Enforce job limits to prevent memory exhaustion
    this.enforceJobLimits()

    const id = `cron-${crypto.randomUUID()}`

    const cronJob: LocalCronJob = {
      id,
      name: job.name,
      type: job.type,
      expression: job.expression,
      webhook: job.webhook,
      enabled: true,
      lastRun: undefined,
      nextRun: this.calculateNextRun(job),
      executionCount: 0,
      metadata: job.metadata,
    }

    // Register with remote service
    await this.remoteRegister(cronJob)

    // Set up local execution
    this.setupLocalExecution(cronJob, job)

    // Store locally for execution management
    this.localJobs.set(id, cronJob)

    return this.toPublicJob(cronJob)
  }

  private setupLocalExecution(
    cronJob: LocalCronJob,
    config: CronJobConfig,
  ): void {
    const executeJob = async () => {
      cronJob.lastRun = Date.now()
      cronJob.executionCount++
      cronJob.nextRun = this.calculateNextRun(config)

      // Call webhook
      await fetch(cronJob.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: cronJob.id, triggeredAt: Date.now() }),
      }).catch((err) =>
        console.error(`[Cron] Webhook failed for ${cronJob.id}:`, err),
      )
    }

    switch (config.type) {
      case 'cron':
        if (config.expression) {
          cronJob.cronInstance = new Cron(config.expression, executeJob)
          const nextDate = cronJob.cronInstance.nextRun()
          cronJob.nextRun = nextDate ? nextDate.getTime() : Date.now() + 60000
        }
        break

      case 'once':
        if (config.triggerTime) {
          const delay = Math.max(0, config.triggerTime - Date.now())
          cronJob.timeoutId = setTimeout(executeJob, delay)
        }
        break

      case 'interval':
        if (config.intervalMs) {
          // Use croner with interval-like pattern for better control
          const runInterval = async () => {
            await executeJob()
            if (cronJob.enabled && config.intervalMs) {
              cronJob.timeoutId = setTimeout(runInterval, config.intervalMs)
            }
          }
          cronJob.timeoutId = setTimeout(runInterval, config.intervalMs)
        }
        break
    }
  }

  async cancel(jobId: string): Promise<boolean> {
    // Cancel on remote service
    await this.remoteCancel(jobId)

    const job = this.localJobs.get(jobId)
    if (job) {
      // Stop local execution
      if (job.cronInstance) {
        job.cronInstance.stop()
      }
      if (job.timeoutId) {
        clearTimeout(job.timeoutId)
      }
    }

    const had = this.localJobs.has(jobId)
    this.localJobs.delete(jobId)
    return had
  }

  async list(owner?: Address): Promise<CronJob[]> {
    const jobs = await this.remoteList(owner)
    if (!jobs) {
      throw new Error('Failed to list jobs from cron service')
    }
    return jobs
  }

  async get(jobId: string): Promise<CronJob | null> {
    return this.remoteGet(jobId)
  }

  async trigger(jobId: string): Promise<void> {
    const job = this.localJobs.get(jobId)
    if (!job) throw new Error('Job not found')

    // Call webhook
    await fetch(job.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, triggeredAt: Date.now() }),
    })

    // Update job state
    job.lastRun = Date.now()
    job.executionCount++
  }

  async isHealthy(): Promise<boolean> {
    return this.checkHealth()
  }

  private toPublicJob(job: LocalCronJob): CronJob {
    const {
      cronInstance: _cronInstance,
      timeoutId: _timeoutId,
      ...publicJob
    } = job
    return publicJob
  }

  private calculateNextRun(job: Partial<CronJobConfig>): number {
    const now = Date.now()

    switch (job.type) {
      case 'once':
        if (job.triggerTime === undefined) {
          throw new Error('triggerTime is required for once job type')
        }
        return job.triggerTime

      case 'interval':
        if (job.intervalMs === undefined) {
          throw new Error('intervalMs is required for interval job type')
        }
        return now + job.intervalMs

      case 'cron':
        if (job.expression) {
          // Use croner to calculate next run
          const cron = new Cron(job.expression)
          const nextDate = cron.nextRun()
          cron.stop() // Stop since we just needed the calculation
          return nextDate ? nextDate.getTime() : now + 60000
        }
        return now + 60000

      default:
        throw new Error(`Unknown job type: ${job.type}`)
    }
  }

  private async remoteRegister(job: CronJob): Promise<void> {
    await fetch(`${this.endpoint}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(5000),
    })
  }

  private async remoteCancel(jobId: string): Promise<void> {
    await fetch(`${this.endpoint}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: jobId }),
      signal: AbortSignal.timeout(5000),
    })
  }

  private async remoteList(owner?: Address): Promise<CronJob[] | null> {
    const url = owner
      ? `${this.endpoint}/list?owner=${owner}`
      : `${this.endpoint}/list`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cron list failed: ${response.status}`)
    }
    const parseResult = CronListResponseSchema.safeParse(await response.json())
    if (!parseResult.success) {
      throw new Error(
        `Invalid cron list response: ${parseResult.error.message}`,
      )
    }
    return parseResult.data.jobs
  }

  private async remoteGet(jobId: string): Promise<CronJob | null> {
    const response = await fetch(`${this.endpoint}/get/${jobId}`, {
      signal: AbortSignal.timeout(5000),
    })

    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Cron get failed: ${response.status}`)
    }
    const parseResult = CronJobSchema.safeParse(await response.json())
    if (!parseResult.success) {
      throw new Error(`Invalid cron job response: ${parseResult.error.message}`)
    }
    return parseResult.data
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  }
}

let instance: CronService | null = null

export function createCronService(config: CronConfig): CronService {
  if (!instance) {
    instance = new CronServiceImpl(config)
  }
  return instance
}

export function getCronServiceFromEnv(): CronService {
  const endpoint = process.env.CRON_ENDPOINT
  if (!endpoint) {
    throw new Error('CRON_ENDPOINT environment variable is required')
  }
  return createCronService({ endpoint })
}

export function resetCronService(): void {
  instance = null
}

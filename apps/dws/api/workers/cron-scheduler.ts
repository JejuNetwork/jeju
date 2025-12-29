import { createHash } from 'node:crypto'
import type { Address } from 'viem'
import { z } from 'zod'

export type ScheduleStatus = 'active' | 'paused' | 'disabled' | 'error'

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled'

export interface CronSchedule {
  scheduleId: string
  workerId: string
  name: string
  cronExpression: string
  timezone: string
  status: ScheduleStatus

  // Configuration
  timeout: number // ms
  retries: number
  retryDelay: number // ms

  // Metadata
  owner: Address
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  nextRunAt?: number

  // Stats
  totalRuns: number
  successfulRuns: number
  failedRuns: number
}

export interface CronExecution {
  executionId: string
  scheduleId: string
  workerId: string
  status: ExecutionStatus

  // Timing
  scheduledAt: number
  startedAt?: number
  completedAt?: number

  // Result
  output?: string
  error?: string
  exitCode?: number

  // Retries
  attempt: number
  maxAttempts: number
}

export interface ParsedCronExpression {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

// ============================================================================
// Schemas
// ============================================================================

export const CronScheduleSchema = z.object({
  workerId: z.string(),
  name: z.string().min(1).max(100),
  cronExpression: z
    .string()
    .regex(
      /^(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)$/,
    ),
  timezone: z.string().default('UTC'),
  timeout: z.number().min(1000).max(900000).default(30000), // 1s - 15min
  retries: z.number().min(0).max(5).default(2),
  retryDelay: z.number().min(1000).max(300000).default(5000),
})

// ============================================================================
// Cron Expression Parser
// ============================================================================

export function parseCronExpression(expression: string): ParsedCronExpression {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error('Invalid cron expression: expected 5 fields')
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  }
}

function parseField(field: string, min: number, max: number): number[] {
  const values: number[] = []

  // Handle '*'
  if (field === '*') {
    for (let i = min; i <= max; i++) values.push(i)
    return values
  }

  // Handle step values '*/n'
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10)
    for (let i = min; i <= max; i += step) values.push(i)
    return values
  }

  // Handle comma-separated values
  const parts = field.split(',')

  for (const part of parts) {
    // Handle ranges 'a-b'
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((n) => parseInt(n, 10))
      for (let i = start; i <= end; i++) values.push(i)
    }
    // Handle step in range 'a-b/n'
    else if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      const [start, end] = range.includes('-')
        ? range.split('-').map((n) => parseInt(n, 10))
        : [parseInt(range, 10), max]
      for (let i = start; i <= end; i += step) values.push(i)
    }
    // Handle single value
    else {
      values.push(parseInt(part, 10))
    }
  }

  return values.filter((v) => v >= min && v <= max)
}

/**
 * Calculate the next run time for a cron expression
 */
export function getNextRunTime(
  expression: string,
  after = new Date(),
  timezone = 'UTC',
): Date {
  const parsed = parseCronExpression(expression)

  // Create date in target timezone
  const date = new Date(after.toLocaleString('en-US', { timeZone: timezone }))
  date.setSeconds(0)
  date.setMilliseconds(0)
  date.setMinutes(date.getMinutes() + 1) // Start from next minute

  // Find next matching time (limit iterations)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (
      parsed.month.includes(date.getMonth() + 1) &&
      parsed.dayOfMonth.includes(date.getDate()) &&
      parsed.dayOfWeek.includes(date.getDay()) &&
      parsed.hour.includes(date.getHours()) &&
      parsed.minute.includes(date.getMinutes())
    ) {
      return date
    }

    date.setMinutes(date.getMinutes() + 1)
  }

  throw new Error('Could not find next run time within a year')
}

/**
 * Check if a cron expression matches a specific time
 */
export function matchesCron(
  expression: string,
  date = new Date(),
  timezone = 'UTC',
): boolean {
  const parsed = parseCronExpression(expression)

  // Convert to target timezone
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }))

  return (
    parsed.minute.includes(tzDate.getMinutes()) &&
    parsed.hour.includes(tzDate.getHours()) &&
    parsed.dayOfMonth.includes(tzDate.getDate()) &&
    parsed.month.includes(tzDate.getMonth() + 1) &&
    parsed.dayOfWeek.includes(tzDate.getDay())
  )
}

// ============================================================================
// Cron Scheduler
// ============================================================================

export class CronScheduler {
  private schedules = new Map<string, CronSchedule>()
  private executions = new Map<string, CronExecution>()
  private executionsBySchedule = new Map<string, string[]>()
  private schedulerInterval: ReturnType<typeof setInterval> | null = null

  private workerInvoker: (
    workerId: string,
    event: CronEvent,
  ) => Promise<WorkerResult>

  constructor(
    workerInvoker: (
      workerId: string,
      event: CronEvent,
    ) => Promise<WorkerResult>,
  ) {
    this.workerInvoker = workerInvoker
  }

  // =========================================================================
  // Schedule Management
  // =========================================================================

  createSchedule(
    owner: Address,
    params: z.infer<typeof CronScheduleSchema>,
  ): CronSchedule {
    // Validate cron expression
    parseCronExpression(params.cronExpression)

    const scheduleId = createHash('sha256')
      .update(`${params.workerId}-${params.name}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const nextRunAt = getNextRunTime(
      params.cronExpression,
      new Date(),
      params.timezone,
    ).getTime()

    const schedule: CronSchedule = {
      scheduleId,
      workerId: params.workerId,
      name: params.name,
      cronExpression: params.cronExpression,
      timezone: params.timezone,
      status: 'active',
      timeout: params.timeout,
      retries: params.retries,
      retryDelay: params.retryDelay,
      owner,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextRunAt,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
    }

    this.schedules.set(scheduleId, schedule)
    this.executionsBySchedule.set(scheduleId, [])

    console.log(
      `[Cron] Created schedule ${scheduleId}: ${params.cronExpression} (next: ${new Date(nextRunAt).toISOString()})`,
    )

    return schedule
  }

  updateSchedule(
    scheduleId: string,
    owner: Address,
    updates: Partial<z.infer<typeof CronScheduleSchema>>,
  ): CronSchedule {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`)
    if (schedule.owner !== owner) throw new Error('Not authorized')

    if (updates.cronExpression) {
      parseCronExpression(updates.cronExpression)
      schedule.cronExpression = updates.cronExpression
      schedule.nextRunAt = getNextRunTime(
        updates.cronExpression,
        new Date(),
        updates.timezone ?? schedule.timezone,
      ).getTime()
    }

    if (updates.name) schedule.name = updates.name
    if (updates.timezone) schedule.timezone = updates.timezone
    if (updates.timeout) schedule.timeout = updates.timeout
    if (updates.retries !== undefined) schedule.retries = updates.retries
    if (updates.retryDelay) schedule.retryDelay = updates.retryDelay

    schedule.updatedAt = Date.now()

    return schedule
  }

  pauseSchedule(scheduleId: string, owner: Address): void {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`)
    if (schedule.owner !== owner) throw new Error('Not authorized')

    schedule.status = 'paused'
    schedule.updatedAt = Date.now()
  }

  resumeSchedule(scheduleId: string, owner: Address): void {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`)
    if (schedule.owner !== owner) throw new Error('Not authorized')

    schedule.status = 'active'
    schedule.nextRunAt = getNextRunTime(
      schedule.cronExpression,
      new Date(),
      schedule.timezone,
    ).getTime()
    schedule.updatedAt = Date.now()
  }

  deleteSchedule(scheduleId: string, owner: Address): void {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`)
    if (schedule.owner !== owner) throw new Error('Not authorized')

    this.schedules.delete(scheduleId)
    this.executionsBySchedule.delete(scheduleId)

    console.log(`[Cron] Deleted schedule ${scheduleId}`)
  }

  // =========================================================================
  // Execution
  // =========================================================================

  async triggerManually(
    scheduleId: string,
    owner: Address,
  ): Promise<CronExecution> {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`)
    if (schedule.owner !== owner) throw new Error('Not authorized')

    return this.executeSchedule(schedule)
  }

  private async executeSchedule(
    schedule: CronSchedule,
  ): Promise<CronExecution> {
    const executionId = createHash('sha256')
      .update(`${schedule.scheduleId}-${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16)

    const execution: CronExecution = {
      executionId,
      scheduleId: schedule.scheduleId,
      workerId: schedule.workerId,
      status: 'pending',
      scheduledAt: Date.now(),
      attempt: 1,
      maxAttempts: schedule.retries + 1,
    }

    this.executions.set(executionId, execution)

    const scheduleExecutions =
      this.executionsBySchedule.get(schedule.scheduleId) ?? []
    scheduleExecutions.push(executionId)
    // Keep only last 100 executions
    if (scheduleExecutions.length > 100) {
      const old = scheduleExecutions.shift()
      if (old) this.executions.delete(old)
    }
    this.executionsBySchedule.set(schedule.scheduleId, scheduleExecutions)

    await this.runExecution(execution, schedule)

    return execution
  }

  private async runExecution(
    execution: CronExecution,
    schedule: CronSchedule,
  ): Promise<void> {
    execution.status = 'running'
    execution.startedAt = Date.now()

    console.log(
      `[Cron] Running ${schedule.name} (attempt ${execution.attempt}/${execution.maxAttempts})`,
    )

    const event: CronEvent = {
      type: 'cron',
      scheduleId: schedule.scheduleId,
      scheduleName: schedule.name,
      cronExpression: schedule.cronExpression,
      executionId: execution.executionId,
      attempt: execution.attempt,
      scheduledAt: execution.scheduledAt,
    }

    try {
      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Execution timeout')),
          schedule.timeout,
        )
      })

      // Invoke worker
      const result = await Promise.race([
        this.workerInvoker(schedule.workerId, event),
        timeoutPromise,
      ])

      execution.status = 'success'
      execution.output = result.output
      execution.exitCode = result.exitCode
      execution.completedAt = Date.now()

      schedule.totalRuns++
      schedule.successfulRuns++
      schedule.lastRunAt = execution.completedAt

      console.log(
        `[Cron] Completed ${schedule.name} in ${execution.completedAt - (execution.startedAt ?? execution.completedAt)}ms`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Check for timeout
      if (message === 'Execution timeout') {
        execution.status = 'timeout'
        execution.error = 'Execution timed out'
      } else {
        execution.status = 'failed'
        execution.error = message
      }

      execution.completedAt = Date.now()

      console.error(
        `[Cron] Failed ${schedule.name} (attempt ${execution.attempt}):`,
        message,
      )

      // Retry if attempts remaining
      if (execution.attempt < execution.maxAttempts) {
        execution.attempt++
        setTimeout(() => {
          this.runExecution(execution, schedule).catch(console.error)
        }, schedule.retryDelay)
        return
      }

      schedule.totalRuns++
      schedule.failedRuns++
      schedule.lastRunAt = execution.completedAt

      // Mark schedule as error if too many failures
      const recentExecutions = this.getScheduleExecutions(schedule.scheduleId)
        .slice(-5)
        .filter((e) => e.status === 'failed' || e.status === 'timeout')

      if (recentExecutions.length >= 5) {
        schedule.status = 'error'
        console.error(
          `[Cron] Schedule ${schedule.name} disabled after 5 consecutive failures`,
        )
      }
    }

    // Update next run time
    if (schedule.status === 'active') {
      schedule.nextRunAt = getNextRunTime(
        schedule.cronExpression,
        new Date(),
        schedule.timezone,
      ).getTime()
    }
  }

  // =========================================================================
  // Scheduler Loop
  // =========================================================================

  start(): void {
    if (this.schedulerInterval) return

    console.log('[Cron] Scheduler started')

    // Check every minute
    this.schedulerInterval = setInterval(() => {
      this.tick().catch(console.error)
    }, 60 * 1000)

    // Run initial tick
    this.tick().catch(console.error)
  }

  stop(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval)
      this.schedulerInterval = null
      console.log('[Cron] Scheduler stopped')
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now()

    for (const schedule of this.schedules.values()) {
      if (schedule.status !== 'active') continue
      if (!schedule.nextRunAt || schedule.nextRunAt > now) continue

      // Run schedule
      this.executeSchedule(schedule).catch((error) => {
        console.error(`[Cron] Error executing ${schedule.name}:`, error)
      })
    }
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getSchedule(scheduleId: string): CronSchedule | undefined {
    return this.schedules.get(scheduleId)
  }

  getSchedulesByWorker(workerId: string): CronSchedule[] {
    return Array.from(this.schedules.values()).filter(
      (s) => s.workerId === workerId,
    )
  }

  getSchedulesByOwner(owner: Address): CronSchedule[] {
    return Array.from(this.schedules.values()).filter((s) => s.owner === owner)
  }

  getExecution(executionId: string): CronExecution | undefined {
    return this.executions.get(executionId)
  }

  getScheduleExecutions(scheduleId: string): CronExecution[] {
    const ids = this.executionsBySchedule.get(scheduleId) ?? []
    return ids
      .map((id) => this.executions.get(id))
      .filter((e): e is CronExecution => e !== undefined)
  }

  listSchedules(): CronSchedule[] {
    return Array.from(this.schedules.values())
  }

  getStats(): {
    totalSchedules: number
    activeSchedules: number
    totalExecutions: number
  } {
    return {
      totalSchedules: this.schedules.size,
      activeSchedules: Array.from(this.schedules.values()).filter(
        (s) => s.status === 'active',
      ).length,
      totalExecutions: this.executions.size,
    }
  }
}

// ============================================================================
// Types for Worker Integration
// ============================================================================

export interface CronEvent {
  type: 'cron'
  scheduleId: string
  scheduleName: string
  cronExpression: string
  executionId: string
  attempt: number
  scheduledAt: number
}

export interface WorkerResult {
  output?: string
  exitCode: number
}

// ============================================================================
// Factory
// ============================================================================

let cronScheduler: CronScheduler | null = null

export function getCronScheduler(
  workerInvoker: (workerId: string, event: CronEvent) => Promise<WorkerResult>,
): CronScheduler {
  if (!cronScheduler) {
    cronScheduler = new CronScheduler(workerInvoker)
    cronScheduler.start()
  }
  return cronScheduler
}

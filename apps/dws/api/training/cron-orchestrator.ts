/**
 * Training Cron Orchestrator
 *
 * Manages scheduled training-related cron jobs for Jeju apps:
 * - Crucible: Agent ticks, trajectory collection, blue/red team operations
 * - DWS: Batch processing, RULER scoring, dataset creation
 *
 * Triggers are defined in app manifests and executed via HTTP endpoints.
 */

import { getDWSUrl, getServiceUrl } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { Cron } from 'croner'
import {
  createBatchProcessor,
  type DatasetReference,
  type TrajectoryBatchProcessor,
} from './batch-processor'

/**
 * App cron trigger configuration
 */
export interface AppCronTrigger {
  /** Unique trigger ID */
  triggerId: string
  /** App name (crucible, dws) */
  appName: string
  /** Cron name from app manifest */
  cronName: string
  /** Cron schedule (e.g., every 5 minutes) */
  schedule: string
  /** API endpoint to call */
  endpoint: string
  /** Timeout in milliseconds */
  timeoutMs: number
  /** Whether trigger is enabled */
  enabled: boolean
  /** Auth token for the endpoint */
  authToken?: string
}

/**
 * Cron execution result
 */
interface CronExecutionResult {
  triggerId: string
  appName: string
  cronName: string
  success: boolean
  durationMs: number
  response?: Record<string, unknown>
  error?: string
  executedAt: Date
}

/**
 * Pending trajectory batch for processing
 */
interface PendingBatch {
  appName: string
  batchCid: string
  trajectoryCount: number
  addedAt: Date
}

/**
 * Training cron orchestrator
 */
export class TrainingCronOrchestrator {
  private triggers = new Map<string, AppCronTrigger>()
  private cronInstances = new Map<string, Cron>()
  private executionHistory: CronExecutionResult[] = []
  private maxHistorySize = 100
  private pendingBatches: PendingBatch[] = []
  private batchProcessor: TrajectoryBatchProcessor
  private onDatasetCreated?: (dataset: DatasetReference) => Promise<void>

  constructor(config?: {
    onDatasetCreated?: (dataset: DatasetReference) => Promise<void>
  }) {
    this.onDatasetCreated = config?.onDatasetCreated
    this.batchProcessor = createBatchProcessor({
      onDatasetCreated: async (dataset) => {
        logger.info('[CronOrchestrator] Dataset created', {
          datasetId: dataset.datasetId,
          appName: dataset.appName,
          archetype: dataset.archetype,
          permanentCid: dataset.permanentCid,
        })
        if (this.onDatasetCreated) {
          await this.onDatasetCreated(dataset)
        }
      },
    })
  }

  /**
   * Register a cron trigger for an app
   */
  registerTrigger(trigger: AppCronTrigger): void {
    // Stop existing cron if any
    const existing = this.cronInstances.get(trigger.triggerId)
    if (existing) {
      existing.stop()
    }

    this.triggers.set(trigger.triggerId, trigger)

    if (trigger.enabled) {
      this.startTrigger(trigger)
    }

    logger.info('[CronOrchestrator] Trigger registered', {
      triggerId: trigger.triggerId,
      appName: trigger.appName,
      cronName: trigger.cronName,
      schedule: trigger.schedule,
      enabled: trigger.enabled,
    })
  }

  /**
   * Register triggers from app manifest
   */
  registerFromManifest(
    appName: string,
    manifest: {
      cron?: Array<{
        name: string
        schedule: string
        endpoint: string
        timeout?: number
      }>
    },
    appBaseUrl: string,
    authToken?: string,
  ): void {
    if (!manifest.cron) return

    for (const cron of manifest.cron) {
      const triggerId = `${appName}-${cron.name}`
      this.registerTrigger({
        triggerId,
        appName,
        cronName: cron.name,
        schedule: cron.schedule,
        endpoint: `${appBaseUrl}${cron.endpoint}`,
        timeoutMs: cron.timeout ?? 30000,
        enabled: true,
        authToken,
      })
    }
  }

  /**
   * Start a cron trigger
   */
  private startTrigger(trigger: AppCronTrigger): void {
    const cronInstance = new Cron(trigger.schedule, async () => {
      await this.executeTrigger(trigger)
    })

    this.cronInstances.set(trigger.triggerId, cronInstance)
  }

  /**
   * Execute a cron trigger
   */
  async executeTrigger(trigger: AppCronTrigger): Promise<CronExecutionResult> {
    const startTime = Date.now()
    const result: CronExecutionResult = {
      triggerId: trigger.triggerId,
      appName: trigger.appName,
      cronName: trigger.cronName,
      success: false,
      durationMs: 0,
      executedAt: new Date(),
    }

    logger.info('[CronOrchestrator] Executing trigger', {
      triggerId: trigger.triggerId,
      appName: trigger.appName,
      cronName: trigger.cronName,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), trigger.timeoutMs)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (trigger.authToken) {
      headers.Authorization = `Bearer ${trigger.authToken}`
    }

    const response = await fetch(trigger.endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    result.durationMs = Date.now() - startTime

    if (!response.ok) {
      result.error = `HTTP ${response.status}: ${await response.text()}`
      logger.error('[CronOrchestrator] Trigger failed', {
        triggerId: trigger.triggerId,
        error: result.error,
      })
    } else {
      result.success = true
      result.response = (await response.json()) as Record<string, unknown>

      // Check for trajectory batch in response
      if (result.response.storageCid && result.response.trajectoryCount) {
        this.pendingBatches.push({
          appName: trigger.appName,
          batchCid: result.response.storageCid as string,
          trajectoryCount: result.response.trajectoryCount as number,
          addedAt: new Date(),
        })
      }

      logger.info('[CronOrchestrator] Trigger completed', {
        triggerId: trigger.triggerId,
        durationMs: result.durationMs,
        hasResponse: !!result.response,
      })
    }

    // Add to history
    this.executionHistory.push(result)
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift()
    }

    return result
  }

  /**
   * Process pending trajectory batches with RULER scoring
   */
  async processPendingBatches(): Promise<{
    processed: number
    datasets: DatasetReference[]
  }> {
    if (this.pendingBatches.length === 0) {
      return { processed: 0, datasets: [] }
    }

    logger.info('[CronOrchestrator] Processing pending batches', {
      count: this.pendingBatches.length,
    })

    // Group batches by app
    const byApp = new Map<string, PendingBatch[]>()
    for (const batch of this.pendingBatches) {
      const existing = byApp.get(batch.appName) ?? []
      existing.push(batch)
      byApp.set(batch.appName, existing)
    }

    const allDatasets: DatasetReference[] = []

    for (const [appName, batches] of byApp) {
      const batchCids = batches.map((b) => b.batchCid)
      const datasets = await this.batchProcessor.processBatches(
        batchCids,
        appName,
      )
      allDatasets.push(...datasets)
    }

    const processedCount = this.pendingBatches.length
    this.pendingBatches = []

    return { processed: processedCount, datasets: allDatasets }
  }

  /**
   * Add a batch to pending processing queue
   */
  addPendingBatch(
    appName: string,
    batchCid: string,
    trajectoryCount: number,
  ): void {
    this.pendingBatches.push({
      appName,
      batchCid,
      trajectoryCount,
      addedAt: new Date(),
    })
  }

  /**
   * Enable a trigger
   */
  enableTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId)
    if (trigger) {
      trigger.enabled = true
      if (!this.cronInstances.has(triggerId)) {
        this.startTrigger(trigger)
      }
    }
  }

  /**
   * Disable a trigger
   */
  disableTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId)
    if (trigger) {
      trigger.enabled = false
      const cron = this.cronInstances.get(triggerId)
      if (cron) {
        cron.stop()
        this.cronInstances.delete(triggerId)
      }
    }
  }

  /**
   * Get trigger status
   */
  getTriggerStatus(triggerId: string): {
    trigger: AppCronTrigger
    nextRun: Date | null
    lastExecution: CronExecutionResult | null
  } | null {
    const trigger = this.triggers.get(triggerId)
    if (!trigger) return null

    const cron = this.cronInstances.get(triggerId)
    const nextRun = cron?.nextRun() ?? null

    const lastExecution =
      this.executionHistory
        .filter((e) => e.triggerId === triggerId)
        .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())[0] ??
      null

    return { trigger, nextRun, lastExecution }
  }

  /**
   * List all triggers
   */
  listTriggers(): Array<{
    trigger: AppCronTrigger
    nextRun: Date | null
  }> {
    return Array.from(this.triggers.values()).map((trigger) => {
      const cron = this.cronInstances.get(trigger.triggerId)
      return {
        trigger,
        nextRun: cron?.nextRun() ?? null,
      }
    })
  }

  /**
   * Get execution history
   */
  getExecutionHistory(appName?: string, limit = 20): CronExecutionResult[] {
    let history = this.executionHistory
    if (appName) {
      history = history.filter((e) => e.appName === appName)
    }
    return history
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
      .slice(0, limit)
  }

  /**
   * Get pending batches info
   */
  getPendingBatchesInfo(): {
    count: number
    totalTrajectories: number
    byApp: Record<string, number>
  } {
    const byApp: Record<string, number> = {}
    let totalTrajectories = 0

    for (const batch of this.pendingBatches) {
      byApp[batch.appName] = (byApp[batch.appName] ?? 0) + 1
      totalTrajectories += batch.trajectoryCount
    }

    return {
      count: this.pendingBatches.length,
      totalTrajectories,
      byApp,
    }
  }

  /**
   * Start all enabled triggers
   */
  start(): void {
    for (const trigger of this.triggers.values()) {
      if (trigger.enabled && !this.cronInstances.has(trigger.triggerId)) {
        this.startTrigger(trigger)
      }
    }
    logger.info('[CronOrchestrator] Started', {
      triggerCount: this.triggers.size,
    })
  }

  /**
   * Stop all triggers
   */
  stop(): void {
    for (const cron of this.cronInstances.values()) {
      cron.stop()
    }
    this.cronInstances.clear()
    logger.info('[CronOrchestrator] Stopped')
  }
}

// Singleton instance
let orchestratorInstance: TrainingCronOrchestrator | null = null

/**
 * Get the singleton cron orchestrator
 */
export function getTrainingCronOrchestrator(config?: {
  onDatasetCreated?: (dataset: DatasetReference) => Promise<void>
}): TrainingCronOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new TrainingCronOrchestrator(config)
  }
  return orchestratorInstance
}

/**
 * Reset the singleton (for testing)
 */
export function resetTrainingCronOrchestrator(): void {
  if (orchestratorInstance) {
    orchestratorInstance.stop()
    orchestratorInstance = null
  }
}

/**
 * Initialize the orchestrator with default app triggers
 */
export async function initializeTrainingOrchestrator(
  cronSecret?: string,
): Promise<TrainingCronOrchestrator> {
  const orchestrator = getTrainingCronOrchestrator()

  // Service URLs from environment
  const crucibleUrl = process.env.CRUCIBLE_API_URL ?? getServiceUrl('compute', 'nodeApi') ?? 'http://localhost:4021'
  const dwsUrl = process.env.DWS_API_URL ?? getDWSUrl()

  // Register Crucible triggers
  orchestrator.registerFromManifest(
    'crucible',
    {
      cron: [
        {
          name: 'agent-tick',
          schedule: '*/2 * * * *', // Every 2 minutes
          endpoint: '/api/cron/agent-tick',
          timeout: 60000,
        },
        {
          name: 'flush-trajectories',
          schedule: '*/10 * * * *', // Every 10 minutes
          endpoint: '/api/cron/flush-trajectories',
          timeout: 30000,
        },
      ],
    },
    crucibleUrl,
    cronSecret,
  )

  // Register DWS batch processing trigger
  orchestrator.registerTrigger({
    triggerId: 'dws-batch-process',
    appName: 'dws',
    cronName: 'batch-process',
    schedule: '0 * * * *', // Every hour
    endpoint: `${dwsUrl}/api/training/process-batches`,
    timeoutMs: 300000, // 5 minutes for batch processing
    enabled: true,
    authToken: cronSecret,
  })

  orchestrator.start()

  logger.info('[CronOrchestrator] Initialized with default triggers')

  return orchestrator
}

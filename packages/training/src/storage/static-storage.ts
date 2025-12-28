/**
 * Static Storage for Trajectories
 *
 * Buffers trajectories in memory, flushes as JSONL.gz to DWS/IPFS when
 * buffer size or age threshold is reached. Returns CID for DB reference.
 */

import { gzipSync } from 'node:zlib'
import { getServiceUrl } from '@jejunetwork/config'
import { generateSnowflakeId, logger } from '@jejunetwork/shared'
import { z } from 'zod'
import type {
  LLMCallLogRecord,
  TrajectoryRecord,
  TrajectoryStorage,
} from '../recording/trajectory-recorder'
import { DWSUploadResponseSchema, TrajectoryBatchHeaderSchema } from './types'

export interface StaticStorageConfig {
  /** Application name (crucible, factory, dws) */
  appName: string
  maxBufferSize: number
  maxBufferAgeMs: number
  storageEndpoint: string
  usePermanentStorage: boolean
  onBatchFlushed?: (batch: TrajectoryBatchReference) => Promise<void>
}

export interface TrajectoryBatchReference {
  batchId: string
  appName: string
  archetype: string | null
  storageCid: string
  storageProvider: 'ipfs' | 'arweave'
  trajectoryCount: number
  totalSteps: number
  totalReward: number
  timeWindowStart: Date
  timeWindowEnd: Date
  createdAt: Date
  compressedSizeBytes: number
  uncompressedSizeBytes: number
  trajectoryIds: string[]
}

/**
 * JSONL record format for trajectory storage
 */
export interface TrajectoryJSONLRecord {
  id: string
  trajectoryId: string
  agentId: string
  archetype: string | null
  appName: string
  startTime: string
  endTime: string
  durationMs: number
  windowId: string
  scenarioId: string
  steps: TrajectoryRecord['steps']
  rewardComponents: TrajectoryRecord['rewardComponents']
  metrics: TrajectoryRecord['metrics']
  metadata: TrajectoryRecord['metadata']
  totalReward: number
}

/**
 * LLM call JSONL record format
 */
export interface LLMCallJSONLRecord {
  id: string
  trajectoryId: string
  stepId: string
  callId: string
  timestamp: string
  latencyMs: number | null
  model: string
  purpose: string
  actionType: string | null
  systemPrompt: string
  userPrompt: string
  messages: Array<{ role: string; content: string }>
  response: string
  reasoning: string | null
  temperature: number
  maxTokens: number
  metadata: Record<string, string | undefined>
}

// ============================================================================
// Zod Schemas for JSONL Record Validation
// ============================================================================

const MessageSchema = z.object({
  role: z.string(),
  content: z.string(),
})

export const LLMCallJSONLRecordSchema = z.object({
  id: z.string(),
  trajectoryId: z.string(),
  stepId: z.string(),
  callId: z.string(),
  timestamp: z.string(),
  latencyMs: z.number().nullable(),
  model: z.string(),
  purpose: z.string(),
  actionType: z.string().nullable(),
  systemPrompt: z.string(),
  userPrompt: z.string(),
  messages: z.array(MessageSchema),
  response: z.string(),
  reasoning: z.string().nullable(),
  temperature: z.number(),
  maxTokens: z.number(),
  metadata: z.record(z.string(), z.string().optional()),
})

// Type alias for inferred schema type
export type LLMCallJSONLRecordSchemaType = z.infer<
  typeof LLMCallJSONLRecordSchema
>

const StepSchema = z.object({
  stepId: z.string().optional(),
  stepNumber: z.number().int().nonnegative(),
  timestamp: z.number(),
  environmentState: z.record(z.string(), z.unknown()).optional(),
  observation: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).nullable().optional(),
  reward: z.number().optional(),
  done: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const RewardComponentSchema = z.object({
  name: z.string(),
  value: z.number(),
  weight: z.number().optional(),
})

// Schema for validation only - parsed results are cast to the interface type
const TrajectoryJSONLRecordSchemaInternal = z.object({
  id: z.string(),
  trajectoryId: z.string(),
  agentId: z.string(),
  archetype: z.string().nullable(),
  appName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  durationMs: z.number(),
  windowId: z.string(),
  scenarioId: z.string(),
  steps: z.array(StepSchema),
  rewardComponents: z.array(RewardComponentSchema),
  metrics: z.record(z.string(), z.number()),
  metadata: z.record(z.string(), z.unknown()),
  totalReward: z.number(),
})

const BaseRecordSchema = z.object({
  _type: z.enum(['header', 'trajectory', 'llm_call']),
})

/**
 * Buffered trajectory waiting to be flushed
 */
interface BufferedTrajectory {
  record: TrajectoryRecord
  llmCalls: LLMCallLogRecord[]
  bufferedAt: number
}

/**
 * Static storage implementation for trajectory batching
 */
export class StaticTrajectoryStorage implements TrajectoryStorage {
  private config: StaticStorageConfig
  private buffer: BufferedTrajectory[] = []
  private bufferStartTime: number | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing = false

  constructor(config: Partial<StaticStorageConfig> = {}) {
    this.config = {
      appName: config.appName ?? 'unknown',
      maxBufferSize: config.maxBufferSize ?? 100,
      maxBufferAgeMs: config.maxBufferAgeMs ?? 5 * 60 * 1000, // 5 minutes default
      storageEndpoint: config.storageEndpoint ?? getServiceUrl('storage'),
      usePermanentStorage: config.usePermanentStorage ?? false,
      onBatchFlushed: config.onBatchFlushed,
    }
  }

  async saveTrajectory(record: TrajectoryRecord): Promise<void> {
    const buffered: BufferedTrajectory = {
      record,
      llmCalls: [],
      bufferedAt: Date.now(),
    }

    this.buffer.push(buffered)

    if (this.bufferStartTime === null) {
      this.bufferStartTime = Date.now()
      this.scheduleFlush()
    }

    // Check if we should flush based on count
    if (this.buffer.length >= this.config.maxBufferSize) {
      await this.flush()
    }

    logger.debug('[StaticStorage] Trajectory buffered', {
      trajectoryId: record.trajectoryId,
      bufferSize: this.buffer.length,
      appName: this.config.appName,
    })
  }

  async saveLLMCallLogs(logs: LLMCallLogRecord[]): Promise<void> {
    // Associate LLM calls with their trajectory in the buffer
    for (const log of logs) {
      const buffered = this.buffer.find(
        (b) => b.record.trajectoryId === log.trajectoryId,
      )
      if (buffered) {
        buffered.llmCalls.push(log)
      }
    }
  }

  async generateId(): Promise<string> {
    return generateSnowflakeId()
  }

  /**
   * Force flush the current buffer
   */
  async flush(): Promise<TrajectoryBatchReference | null> {
    if (this.flushing || this.buffer.length === 0) {
      return null
    }

    this.flushing = true
    this.clearFlushTimer()

    const toFlush = [...this.buffer]
    this.buffer = []
    this.bufferStartTime = null

    logger.info('[StaticStorage] Flushing trajectory batch', {
      count: toFlush.length,
      appName: this.config.appName,
    })

    const batchRef = await this.writeBatch(toFlush)

    if (this.config.onBatchFlushed) {
      await this.config.onBatchFlushed(batchRef)
    }

    this.flushing = false

    // Schedule next flush if buffer has new items
    if (this.buffer.length > 0 && this.bufferStartTime === null) {
      this.bufferStartTime = Date.now()
      this.scheduleFlush()
    }

    return batchRef
  }

  /**
   * Get current buffer stats
   */
  getBufferStats(): {
    count: number
    ageMs: number | null
    oldestTrajectoryId: string | null
  } {
    return {
      count: this.buffer.length,
      ageMs: this.bufferStartTime ? Date.now() - this.bufferStartTime : null,
      oldestTrajectoryId: this.buffer[0]?.record.trajectoryId ?? null,
    }
  }

  /**
   * Shutdown and flush any remaining data
   */
  async shutdown(): Promise<void> {
    this.clearFlushTimer()
    if (this.buffer.length > 0) {
      await this.flush()
    }
  }

  private scheduleFlush(): void {
    this.clearFlushTimer()
    this.flushTimer = setTimeout(async () => {
      await this.flush()
    }, this.config.maxBufferAgeMs)
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  private async writeBatch(
    items: BufferedTrajectory[],
  ): Promise<TrajectoryBatchReference> {
    const batchId = await generateSnowflakeId()

    // Build JSONL content for trajectories
    const trajectoryLines: string[] = []
    const llmCallLines: string[] = []
    let totalSteps = 0
    let totalReward = 0
    const trajectoryIds: string[] = []
    const archetypes = new Set<string | null>()

    let timeWindowStart: Date | null = null
    let timeWindowEnd: Date | null = null

    for (const item of items) {
      const { record, llmCalls } = item

      trajectoryIds.push(record.trajectoryId)
      archetypes.add(record.archetype)
      totalSteps += record.steps.length
      totalReward += record.totalReward

      // Track time window
      const startTime = record.startTime
      const endTime = record.endTime
      if (!timeWindowStart || startTime < timeWindowStart) {
        timeWindowStart = startTime
      }
      if (!timeWindowEnd || endTime > timeWindowEnd) {
        timeWindowEnd = endTime
      }

      // Convert to JSONL record
      const jsonlRecord: TrajectoryJSONLRecord = {
        id: record.id,
        trajectoryId: record.trajectoryId,
        agentId: record.agentId,
        archetype: record.archetype,
        appName: this.config.appName,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs: record.durationMs,
        windowId: record.windowId,
        scenarioId: record.scenarioId,
        steps: record.steps,
        rewardComponents: record.rewardComponents,
        metrics: record.metrics,
        metadata: record.metadata,
        totalReward: record.totalReward,
      }

      trajectoryLines.push(JSON.stringify(jsonlRecord))

      // Convert LLM calls to JSONL
      for (const call of llmCalls) {
        const llmRecord: LLMCallJSONLRecord = {
          id: call.id,
          trajectoryId: call.trajectoryId,
          stepId: call.stepId,
          callId: call.callId,
          timestamp: call.timestamp.toISOString(),
          latencyMs: call.latencyMs,
          model: call.model,
          purpose: call.purpose,
          actionType: call.actionType,
          systemPrompt: call.systemPrompt,
          userPrompt: call.userPrompt,
          messages: call.messages,
          response: call.response,
          reasoning: call.reasoning,
          temperature: call.temperature,
          maxTokens: call.maxTokens,
          metadata: call.metadata,
        }
        llmCallLines.push(JSON.stringify(llmRecord))
      }
    }

    // Create combined JSONL content
    const jsonlContent = [
      `{"_type":"header","batchId":"${batchId}","appName":"${this.config.appName}","trajectoryCount":${items.length},"timestamp":"${new Date().toISOString()}"}`,
      ...trajectoryLines.map(
        (line) => `{"_type":"trajectory",${line.slice(1)}`,
      ),
      ...llmCallLines.map((line) => `{"_type":"llm_call",${line.slice(1)}`),
    ].join('\n')

    const uncompressedSize = Buffer.byteLength(jsonlContent, 'utf8')

    // Compress with gzip
    const compressed = gzipSync(Buffer.from(jsonlContent, 'utf8'), {
      level: 9,
    })

    // Upload to DWS storage
    const uploadResult = await this.uploadToDWS(
      compressed,
      `trajectories-${batchId}.jsonl.gz`,
    )

    // Determine primary archetype (most common, or null if mixed)
    const archetypeArray = Array.from(archetypes).filter(
      (a): a is string => a !== null && a !== undefined,
    )
    const primaryArchetype =
      archetypeArray.length === 1 ? (archetypeArray[0] ?? null) : null

    const batchRef: TrajectoryBatchReference = {
      batchId,
      appName: this.config.appName,
      archetype: primaryArchetype,
      storageCid: uploadResult.cid,
      storageProvider: uploadResult.provider,
      trajectoryCount: items.length,
      totalSteps,
      totalReward,
      timeWindowStart: timeWindowStart ?? new Date(),
      timeWindowEnd: timeWindowEnd ?? new Date(),
      createdAt: new Date(),
      compressedSizeBytes: compressed.length,
      uncompressedSizeBytes: uncompressedSize,
      trajectoryIds,
    }

    logger.info('[StaticStorage] Batch written to DWS', {
      batchId,
      cid: uploadResult.cid,
      trajectoryCount: items.length,
      totalSteps,
      compressedSize: compressed.length,
      uncompressedSize,
      compressionRatio: (uncompressedSize / compressed.length).toFixed(2),
    })

    return batchRef
  }

  private async uploadToDWS(
    data: Buffer,
    filename: string,
  ): Promise<{ cid: string; provider: 'ipfs' | 'arweave' }> {
    const maxRetries = 3
    const baseDelayMs = 1000

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const formData = new FormData()
      formData.append('file', new Blob([new Uint8Array(data)]), filename)
      formData.append(
        'provider',
        this.config.usePermanentStorage ? 'arweave' : 'ipfs',
      )
      formData.append('replication', '3')
      formData.append(
        'metadata',
        JSON.stringify({
          type: 'trajectory-batch',
          appName: this.config.appName,
          contentType: 'application/gzip',
        }),
      )

      let response: Response
      try {
        response = await fetch(
          `${this.config.storageEndpoint}/storage/upload`,
          {
            method: 'POST',
            body: formData,
          },
        )
      } catch (fetchError) {
        // Network error - retry with backoff
        if (attempt < maxRetries) {
          const delay = baseDelayMs * 2 ** (attempt - 1)
          logger.warn('[StaticStorage] Upload fetch failed, retrying', {
            attempt,
            maxRetries,
            delayMs: delay,
            error:
              fetchError instanceof Error
                ? fetchError.message
                : String(fetchError),
          })
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        throw new Error(
          `DWS upload failed after ${maxRetries} attempts: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
        )
      }

      if (!response.ok) {
        const text = await response.text()
        // Retry on 5xx errors or rate limiting
        if (
          (response.status >= 500 || response.status === 429) &&
          attempt < maxRetries
        ) {
          const delay = baseDelayMs * 2 ** (attempt - 1)
          logger.warn('[StaticStorage] Upload failed with retryable error', {
            attempt,
            maxRetries,
            status: response.status,
            delayMs: delay,
          })
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        throw new Error(`DWS upload failed: ${response.status} - ${text}`)
      }

      const responseData: unknown = await response.json()
      const result = DWSUploadResponseSchema.parse(responseData)

      const provider = this.config.usePermanentStorage ? 'arweave' : 'ipfs'

      logger.debug('[StaticStorage] Upload succeeded', {
        cid: result.cid,
        provider,
        attempt,
      })

      return {
        cid: result.cid,
        provider,
      }
    }

    // Should never reach here, but TypeScript needs this
    throw new Error(`DWS upload failed after ${maxRetries} attempts`)
  }
}

/**
 * Download and decompress a trajectory batch from DWS
 */
export async function downloadTrajectoryBatch(
  cid: string,
  storageEndpoint?: string,
): Promise<{
  header: {
    batchId: string
    appName: string
    trajectoryCount: number
    timestamp: string
  }
  trajectories: TrajectoryJSONLRecord[]
  llmCalls: LLMCallJSONLRecordSchemaType[]
}> {
  const { gunzipSync } = await import('node:zlib')
  const endpoint = storageEndpoint ?? getServiceUrl('storage')

  const response = await fetch(`${endpoint}/storage/download/${cid}`)
  if (!response.ok) {
    throw new Error(`Failed to download batch: ${response.status}`)
  }

  const compressed = Buffer.from(await response.arrayBuffer())
  const decompressed = gunzipSync(compressed)
  const jsonlContent = decompressed.toString('utf8')

  const lines = jsonlContent.split('\n').filter((line) => line.trim())

  let header: z.infer<typeof TrajectoryBatchHeaderSchema> | null = null
  const trajectories: TrajectoryJSONLRecord[] = []
  const llmCalls: LLMCallJSONLRecordSchemaType[] = []

  for (const line of lines) {
    const parsed: unknown = JSON.parse(line)
    const baseResult = BaseRecordSchema.safeParse(parsed)
    if (!baseResult.success) {
      logger.warn('[StaticStorage] Invalid JSONL record, skipping', {
        error: baseResult.error.message,
      })
      continue
    }

    const recordType = baseResult.data._type

    if (recordType === 'header') {
      const headerResult = TrajectoryBatchHeaderSchema.safeParse(parsed)
      if (headerResult.success) {
        header = headerResult.data
      }
    } else if (recordType === 'trajectory') {
      const trajResult = TrajectoryJSONLRecordSchemaInternal.safeParse(parsed)
      if (trajResult.success) {
        // The schema validates the structure, but TrajectoryRecord['steps'] has specific types
        // that the generic Zod schema can't express. We validate the shape and cast.
        trajectories.push(trajResult.data as unknown as TrajectoryJSONLRecord)
      } else {
        logger.warn('[StaticStorage] Invalid trajectory record', {
          error: trajResult.error.message,
        })
      }
    } else if (recordType === 'llm_call') {
      const llmResult = LLMCallJSONLRecordSchema.safeParse(parsed)
      if (llmResult.success) {
        llmCalls.push(llmResult.data)
      } else {
        logger.warn('[StaticStorage] Invalid LLM call record', {
          error: llmResult.error.message,
        })
      }
    }
  }

  if (!header) {
    throw new Error('Invalid batch: missing header')
  }

  return {
    header: {
      batchId: header.batchId,
      appName: header.appName,
      trajectoryCount: header.trajectoryCount,
      timestamp: header.timestamp,
    },
    trajectories,
    llmCalls,
  }
}

/**
 * Create a static storage instance for an app
 */
export function createStaticTrajectoryStorage(
  appName: string,
  config?: Partial<Omit<StaticStorageConfig, 'appName'>>,
): StaticTrajectoryStorage {
  return new StaticTrajectoryStorage({
    ...config,
    appName,
  })
}

// Singleton instances per app
const storageInstances = new Map<string, StaticTrajectoryStorage>()

/**
 * Get or create a static storage instance for an app
 */
export function getStaticTrajectoryStorage(
  appName: string,
  config?: Partial<Omit<StaticStorageConfig, 'appName'>>,
): StaticTrajectoryStorage {
  let instance = storageInstances.get(appName)
  if (!instance) {
    instance = createStaticTrajectoryStorage(appName, config)
    storageInstances.set(appName, instance)
  }
  return instance
}

/**
 * Shutdown all storage instances
 */
export async function shutdownAllStaticStorage(): Promise<void> {
  const shutdownPromises = Array.from(storageInstances.values()).map(
    (instance) => instance.shutdown(),
  )
  await Promise.all(shutdownPromises)
  storageInstances.clear()
}

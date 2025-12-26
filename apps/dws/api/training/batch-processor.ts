/**
 * DWS Trajectory Batch Processor
 *
 * Downloads JSONL.gz batches from IPFS, groups by archetype,
 * scores with RULER, and uploads to Arweave for permanent storage.
 */

import { gunzipSync, gzipSync } from 'node:zlib'
import { getServicesConfig } from '@jejunetwork/config'
import { generateSnowflakeId, logger } from '@jejunetwork/shared'
import type {
  ArchetypeScore,
  ScoringTrajectoryRecord,
} from '@jejunetwork/training'
import {
  ArchetypeScoringService,
  downloadTrajectoryBatch,
} from '@jejunetwork/training'
import { z } from 'zod'

/**
 * Zod schema for raw trajectory data validation
 */
const RawTrajectorySchema = z.object({
  trajectoryId: z.string(),
  agentId: z.string(),
  archetype: z.string().nullable().optional(),
  scenarioId: z.string().optional(),
  totalReward: z.number(),
  steps: z.array(
    z.object({
      stepNumber: z.number(),
      timestamp: z.number(),
      action: z
        .object({
          timestamp: z.number(),
          actionType: z.string(),
          parameters: z.record(z.string(), z.unknown()).optional(),
          success: z.boolean(),
        })
        .nullable()
        .optional(),
      reward: z.number().optional(),
    }),
  ),
})

/**
 * Zod schema for LLM call data validation
 */
const LLMCallSchema = z.object({
  stepId: z.string().optional(),
  model: z.string(),
  systemPrompt: z.string(),
  userPrompt: z.string(),
  response: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
})

type ValidatedTrajectory = z.infer<typeof RawTrajectorySchema>
type ValidatedLLMCall = z.infer<typeof LLMCallSchema>

export interface BatchProcessorConfig {
  storageEndpoint: string
  inferenceEndpoint: string
  rulerModelId: string
  maxTrajectoriesPerBatch: number
  minTrajectoriesForRuler: number
  onDatasetCreated?: (dataset: DatasetReference) => Promise<void>
}

export interface DatasetReference {
  datasetId: string
  appName: string
  archetype: string
  sourceBatchCids: string[]
  permanentCid: string
  storageProvider: 'arweave'
  trajectoryCount: number
  totalSteps: number
  averageScore: number
  scoreDistribution: {
    min: number
    max: number
    median: number
    stdDev: number
  }
  createdAt: Date
  processedAt: Date
  rulerModelId: string
  rulerVersion: string
}

/**
 * Scored trajectory for dataset export
 */
interface ScoredTrajectory {
  trajectoryId: string
  agentId: string
  archetype: string
  score: number
  reasoning: string
  steps: Array<{
    stepNumber: number
    timestamp: number
    action: {
      actionType: string
      parameters?: Record<string, unknown>
      success: boolean
    } | null
    reward: number
    llmCalls: Array<{
      model: string
      systemPrompt: string
      userPrompt: string
      response: string
      temperature: number
      maxTokens: number
    }>
  }>
  metrics: {
    totalReward: number
    episodeLength: number
    finalPnL?: number
    actionSuccessRate: number
  }
}

/**
 * LLM caller for DWS inference
 */
function createDWSInferenceCaller(
  endpoint: string,
  modelId: string,
): {
  callLLM: (opts: {
    prompt: string
    system: string
    temperature: number
    maxTokens: number
  }) => Promise<string>
} {
  return {
    async callLLM(opts: {
      prompt: string
      system: string
      temperature: number
      maxTokens: number
    }): Promise<string> {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.prompt },
          ],
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`DWS inference failed: ${response.status} - ${error}`)
      }

      const result = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
      }

      const content = result.choices[0]?.message?.content
      if (!content) {
        throw new Error('No content in inference response')
      }

      return content
    },
  }
}

/**
 * Batch processor for trajectory scoring and dataset creation
 */
export class TrajectoryBatchProcessor {
  private config: BatchProcessorConfig
  private scoringService: ArchetypeScoringService

  constructor(config: Partial<BatchProcessorConfig> = {}) {
    const servicesConfig = getServicesConfig()
    const defaultStorageEndpoint = servicesConfig.storage.api
    const defaultInferenceEndpoint =
      process.env.DWS_INFERENCE_URL ?? servicesConfig.dws.compute

    this.config = {
      storageEndpoint: config.storageEndpoint ?? defaultStorageEndpoint,
      inferenceEndpoint: config.inferenceEndpoint ?? defaultInferenceEndpoint,
      rulerModelId: config.rulerModelId ?? 'deepseek-r1-distill-llama-70b',
      maxTrajectoriesPerBatch: config.maxTrajectoriesPerBatch ?? 100,
      minTrajectoriesForRuler: config.minTrajectoriesForRuler ?? 2,
      onDatasetCreated: config.onDatasetCreated,
    }

    const llmCaller = createDWSInferenceCaller(
      this.config.inferenceEndpoint,
      this.config.rulerModelId,
    )
    this.scoringService = new ArchetypeScoringService(llmCaller)
  }

  /**
   * Process multiple trajectory batch CIDs
   */
  async processBatches(
    batchCids: string[],
    appName: string,
  ): Promise<DatasetReference[]> {
    logger.info('[BatchProcessor] Starting batch processing', {
      batchCount: batchCids.length,
      appName,
    })

    // Download and merge all batches
    const allTrajectories: Array<{
      raw: Record<string, unknown>
      llmCalls: Array<Record<string, unknown>>
      sourceCid: string
    }> = []

    for (const cid of batchCids) {
      const batch = await downloadTrajectoryBatch(
        cid,
        this.config.storageEndpoint,
      )

      for (const traj of batch.trajectories) {
        const trajLlmCalls = batch.llmCalls.filter(
          (c) => c.trajectoryId === traj.trajectoryId,
        )
        allTrajectories.push({
          raw: traj as unknown as Record<string, unknown>,
          llmCalls: trajLlmCalls as unknown as Array<Record<string, unknown>>,
          sourceCid: cid,
        })
      }

      logger.debug('[BatchProcessor] Downloaded batch', {
        cid,
        trajectoryCount: batch.trajectories.length,
      })
    }

    logger.info('[BatchProcessor] Merged trajectories', {
      totalCount: allTrajectories.length,
    })

    // Group by archetype
    const byArchetype = new Map<string, typeof allTrajectories>()
    for (const traj of allTrajectories) {
      const archetype = (traj.raw.archetype as string) ?? 'default'
      const existing = byArchetype.get(archetype) ?? []
      existing.push(traj)
      byArchetype.set(archetype, existing)
    }

    // Process each archetype group
    const datasets: DatasetReference[] = []

    for (const [archetype, trajectories] of byArchetype) {
      if (trajectories.length < this.config.minTrajectoriesForRuler) {
        logger.warn(
          '[BatchProcessor] Skipping archetype - insufficient trajectories',
          {
            archetype,
            count: trajectories.length,
            minimum: this.config.minTrajectoriesForRuler,
          },
        )
        continue
      }

      const dataset = await this.processArchetypeGroup(
        archetype,
        trajectories,
        appName,
        batchCids,
      )

      if (dataset) {
        datasets.push(dataset)
        if (this.config.onDatasetCreated) {
          await this.config.onDatasetCreated(dataset)
        }
      }
    }

    logger.info('[BatchProcessor] Batch processing complete', {
      datasetsCreated: datasets.length,
      archetypesProcessed: byArchetype.size,
    })

    return datasets
  }

  /**
   * Process a group of trajectories for a single archetype
   */
  private async processArchetypeGroup(
    archetype: string,
    trajectories: Array<{
      raw: Record<string, unknown>
      llmCalls: Array<Record<string, unknown>>
      sourceCid: string
    }>,
    appName: string,
    sourceBatchCids: string[],
  ): Promise<DatasetReference | null> {
    logger.info('[BatchProcessor] Processing archetype group', {
      archetype,
      trajectoryCount: trajectories.length,
    })

    // Validate and filter trajectories
    const validatedTrajectories: Array<{
      data: ValidatedTrajectory
      llmCalls: ValidatedLLMCall[]
      sourceCid: string
    }> = []

    for (const t of trajectories) {
      const trajResult = RawTrajectorySchema.safeParse(t.raw)
      if (!trajResult.success) {
        logger.warn('[BatchProcessor] Invalid trajectory data, skipping', {
          trajectoryId: String(t.raw.trajectoryId ?? 'unknown'),
          error: trajResult.error.message,
        })
        continue
      }

      // Validate LLM calls
      const validLlmCalls: ValidatedLLMCall[] = []
      for (const call of t.llmCalls) {
        const callResult = LLMCallSchema.safeParse(call)
        if (callResult.success) {
          validLlmCalls.push(callResult.data)
        }
      }

      validatedTrajectories.push({
        data: trajResult.data,
        llmCalls: validLlmCalls,
        sourceCid: t.sourceCid,
      })
    }

    if (validatedTrajectories.length === 0) {
      logger.warn('[BatchProcessor] No valid trajectories after validation', {
        archetype,
        originalCount: trajectories.length,
      })
      return null
    }

    // Convert to scoring records using validated data
    const scoringRecords: ScoringTrajectoryRecord[] = validatedTrajectories.map(
      (t) => ({
        trajectoryId: t.data.trajectoryId,
        agentId: t.data.agentId,
        stepsJson: JSON.stringify(t.data.steps),
        archetype,
        scenarioId: t.data.scenarioId,
        finalPnL: t.data.totalReward,
        episodeLength: t.data.steps.length,
        totalReward: t.data.totalReward,
      }),
    )

    // Score using RULER
    let scores: ArchetypeScore[]

    if (scoringRecords.length >= this.config.minTrajectoriesForRuler) {
      // Use RULER comparison for better relative scoring
      scores = await this.scoringService.scoreTrajectoryGroup(scoringRecords, {
        archetype,
        saveToDatabase: false,
      })
    } else {
      // Fall back to individual scoring
      scores = await this.scoringService.scoreTrajectoriesParallel(
        scoringRecords,
        { archetype, saveToDatabase: false },
        5,
      )
    }

    if (scores.length === 0) {
      logger.warn('[BatchProcessor] No scores generated for archetype', {
        archetype,
      })
      return null
    }

    // Build scored trajectories using validated data
    const scoredTrajectories: ScoredTrajectory[] = []
    const scoreMap = new Map(scores.map((s) => [s.trajectoryId, s]))

    for (const vt of validatedTrajectories) {
      const score = scoreMap.get(vt.data.trajectoryId)
      if (!score) continue

      const steps = vt.data.steps.map((step) => {
        const stepLlmCalls = vt.llmCalls
          .filter(
            (c) =>
              c.stepId === `${vt.data.trajectoryId}-step-${step.stepNumber}`,
          )
          .map((c) => ({
            model: c.model,
            systemPrompt: c.systemPrompt,
            userPrompt: c.userPrompt,
            response: c.response,
            temperature: c.temperature,
            maxTokens: c.maxTokens,
          }))

        return {
          stepNumber: step.stepNumber,
          timestamp: step.timestamp,
          action: step.action ?? null,
          reward: step.reward ?? 0,
          llmCalls: stepLlmCalls,
        }
      })

      const successfulActions = steps.filter((s) => s.action?.success).length
      const totalActions = steps.filter((s) => s.action).length

      scoredTrajectories.push({
        trajectoryId: vt.data.trajectoryId,
        agentId: vt.data.agentId,
        archetype,
        score: score.score,
        reasoning: score.reasoning,
        steps,
        metrics: {
          totalReward: vt.data.totalReward,
          episodeLength: steps.length,
          finalPnL: vt.data.totalReward,
          actionSuccessRate:
            totalActions > 0 ? successfulActions / totalActions : 0,
        },
      })
    }

    // Calculate score statistics
    const scoreValues = scoredTrajectories.map((t) => t.score)
    const sortedScores = [...scoreValues].sort((a, b) => a - b)
    const mean = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
    const variance =
      scoreValues.reduce((sum, s) => sum + (s - mean) ** 2, 0) /
      scoreValues.length

    const scoreDistribution = {
      min: Math.min(...scoreValues),
      max: Math.max(...scoreValues),
      median: sortedScores[Math.floor(sortedScores.length / 2)] ?? 0,
      stdDev: Math.sqrt(variance),
    }

    // Upload to permanent storage
    const datasetId = await generateSnowflakeId()
    const permanentCid = await this.uploadToArweave(
      datasetId,
      appName,
      archetype,
      scoredTrajectories,
    )

    const dataset: DatasetReference = {
      datasetId,
      appName,
      archetype,
      sourceBatchCids,
      permanentCid,
      storageProvider: 'arweave',
      trajectoryCount: scoredTrajectories.length,
      totalSteps: scoredTrajectories.reduce(
        (sum, t) => sum + t.steps.length,
        0,
      ),
      averageScore: mean,
      scoreDistribution,
      createdAt: new Date(),
      processedAt: new Date(),
      rulerModelId: this.config.rulerModelId,
      rulerVersion: '1.0.0',
    }

    logger.info('[BatchProcessor] Created dataset', {
      datasetId,
      archetype,
      permanentCid,
      trajectoryCount: scoredTrajectories.length,
      averageScore: mean.toFixed(3),
    })

    return dataset
  }

  /**
   * Upload scored dataset to Arweave for permanent storage
   */
  private async uploadToArweave(
    datasetId: string,
    appName: string,
    archetype: string,
    trajectories: ScoredTrajectory[],
  ): Promise<string> {
    // Create JSONL content
    const jsonlLines = [
      JSON.stringify({
        _type: 'header',
        datasetId,
        appName,
        archetype,
        trajectoryCount: trajectories.length,
        rulerModelId: this.config.rulerModelId,
        timestamp: new Date().toISOString(),
      }),
      ...trajectories.map((t) =>
        JSON.stringify({ _type: 'scored_trajectory', ...t }),
      ),
    ]

    const jsonlContent = jsonlLines.join('\n')
    const compressed = gzipSync(Buffer.from(jsonlContent, 'utf8'), { level: 9 })

    // Upload to Arweave via DWS storage
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([compressed]),
      `dataset-${datasetId}.jsonl.gz`,
    )
    formData.append('provider', 'arweave')
    formData.append(
      'metadata',
      JSON.stringify({
        type: 'training-dataset',
        datasetId,
        appName,
        archetype,
        contentType: 'application/gzip',
        trajectoryCount: trajectories.length,
      }),
    )

    const response = await fetch(
      `${this.config.storageEndpoint}/api/v1/upload`,
      {
        method: 'POST',
        body: formData,
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Arweave upload failed: ${response.status} - ${error}`)
    }

    const result = (await response.json()) as { cid: string }
    return result.cid
  }
}

/**
 * Download a scored dataset from permanent storage
 */
export async function downloadScoredDataset(
  cid: string,
  storageEndpoint?: string,
): Promise<{
  header: {
    datasetId: string
    appName: string
    archetype: string
    trajectoryCount: number
    rulerModelId: string
    timestamp: string
  }
  trajectories: ScoredTrajectory[]
}> {
  const defaultEndpoint = getServicesConfig().storage.api
  const endpoint = storageEndpoint ?? defaultEndpoint

  const response = await fetch(`${endpoint}/storage/download/${cid}`)
  if (!response.ok) {
    throw new Error(`Failed to download dataset: ${response.status}`)
  }

  const compressed = Buffer.from(await response.arrayBuffer())
  const decompressed = gunzipSync(compressed)
  const jsonlContent = decompressed.toString('utf8')

  const lines = jsonlContent.split('\n').filter((line) => line.trim())

  let header: {
    datasetId: string
    appName: string
    archetype: string
    trajectoryCount: number
    rulerModelId: string
    timestamp: string
  } | null = null
  const trajectories: ScoredTrajectory[] = []

  for (const line of lines) {
    const record = JSON.parse(line) as { _type: string } & Record<
      string,
      unknown
    >

    if (record._type === 'header') {
      header = {
        datasetId: record.datasetId as string,
        appName: record.appName as string,
        archetype: record.archetype as string,
        trajectoryCount: record.trajectoryCount as number,
        rulerModelId: record.rulerModelId as string,
        timestamp: record.timestamp as string,
      }
    } else if (record._type === 'scored_trajectory') {
      const { _type: _, ...rest } = record
      trajectories.push(rest as unknown as ScoredTrajectory)
    }
  }

  if (!header) {
    throw new Error('Invalid dataset: missing header')
  }

  return { header, trajectories }
}

/**
 * Create a batch processor instance
 */
export function createBatchProcessor(
  config?: Partial<BatchProcessorConfig>,
): TrajectoryBatchProcessor {
  return new TrajectoryBatchProcessor(config)
}

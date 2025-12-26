/**
 * Trajectory Batch Registry
 * 
 * Receives batch registration from apps (Crucible, Babylon) and stores
 * references in the database for later processing.
 */

import { logger } from '@jejunetwork/shared'
import {
  type TrajectoryBatchReference,
  TrainingDbPersistence,
  type TrainingDbClient,
} from '@jejunetwork/training'
import { Elysia, t } from 'elysia'

// In-memory queue for batches pending DB write (for resilience)
const pendingBatches: TrajectoryBatchReference[] = []
let dbPersistence: TrainingDbPersistence | null = null

/**
 * Initialize the batch registry with a database client
 */
export function initBatchRegistry(dbClient: TrainingDbClient): void {
  dbPersistence = new TrainingDbPersistence(dbClient)
  logger.info('[BatchRegistry] Initialized with database client')
}

/**
 * Register a new trajectory batch
 */
export async function registerBatch(batch: TrajectoryBatchReference): Promise<void> {
  if (!dbPersistence) {
    logger.warn('[BatchRegistry] No database client, queuing batch', {
      batchId: batch.batchId,
    })
    pendingBatches.push(batch)
    return
  }

  await dbPersistence.saveBatchReference(batch)
  logger.info('[BatchRegistry] Batch registered', {
    batchId: batch.batchId,
    cid: batch.storageCid,
    app: batch.appName,
  })
}

/**
 * Flush any pending batches to database
 */
export async function flushPendingBatches(): Promise<number> {
  if (!dbPersistence || pendingBatches.length === 0) {
    return 0
  }

  let flushed = 0
  while (pendingBatches.length > 0) {
    const batch = pendingBatches.shift()
    if (batch) {
      await dbPersistence.saveBatchReference(batch)
      flushed++
    }
  }

  logger.info('[BatchRegistry] Flushed pending batches', { count: flushed })
  return flushed
}

/**
 * Get unprocessed batches for an app
 */
export async function getUnprocessedBatches(
  appName: string,
  limit = 100,
): Promise<TrajectoryBatchReference[]> {
  if (!dbPersistence) {
    return []
  }
  return dbPersistence.getUnprocessedBatches(appName, limit)
}

/**
 * Elysia routes for batch registration
 */
export const batchRegistryRoutes = new Elysia({ prefix: '/api/training' })
  .post(
    '/register-batch',
    async ({ body }) => {
      const batch: TrajectoryBatchReference = {
        batchId: body.batchId,
        appName: body.appName,
        archetype: body.archetype ?? null,
        storageCid: body.storageCid,
        storageProvider: body.storageProvider as 'ipfs' | 'arweave',
        trajectoryCount: body.trajectoryCount,
        totalSteps: body.totalSteps,
        totalReward: body.totalReward,
        timeWindowStart: new Date(body.timeWindowStart),
        timeWindowEnd: new Date(body.timeWindowEnd),
        createdAt: new Date(body.createdAt),
        compressedSizeBytes: body.compressedSizeBytes,
        uncompressedSizeBytes: body.uncompressedSizeBytes,
        trajectoryIds: body.trajectoryIds,
      }

      await registerBatch(batch)

      return { success: true, batchId: batch.batchId }
    },
    {
      body: t.Object({
        batchId: t.String(),
        appName: t.String(),
        archetype: t.Optional(t.Union([t.String(), t.Null()])),
        storageCid: t.String(),
        storageProvider: t.String(),
        trajectoryCount: t.Number(),
        totalSteps: t.Number(),
        totalReward: t.Number(),
        timeWindowStart: t.String(),
        timeWindowEnd: t.String(),
        createdAt: t.String(),
        compressedSizeBytes: t.Number(),
        uncompressedSizeBytes: t.Number(),
        trajectoryIds: t.Array(t.String()),
      }),
    },
  )
  .get('/unprocessed/:appName', async ({ params }) => {
    const batches = await getUnprocessedBatches(params.appName)
    return {
      appName: params.appName,
      count: batches.length,
      batches: batches.map((b) => ({
        batchId: b.batchId,
        storageCid: b.storageCid,
        trajectoryCount: b.trajectoryCount,
        createdAt: b.createdAt.toISOString(),
      })),
    }
  })
  .get('/pending-count', () => ({
    pendingBatches: pendingBatches.length,
    dbInitialized: dbPersistence !== null,
  }))

/**
 * Database persistence for trajectory batches and datasets
 */

import { logger } from '@jejunetwork/shared'
import type { DatasetReference } from './types'
import { StringArraySchema } from './types'
import type { TrajectoryBatchReference } from './static-storage'

export interface TrainingDbClient {
  exec(sql: string, params?: (string | number | null)[]): Promise<{ rowsAffected: number }>
  query<T>(sql: string, params?: (string | number | null)[]): Promise<{ rows: T[] }>
}

export class TrainingDbPersistence {
  constructor(private db: TrainingDbClient) {}

  async saveBatchReference(batch: TrajectoryBatchReference): Promise<void> {
    const sql = `
      INSERT INTO trajectory_batches (
        batch_id, app_name, archetype, storage_cid, storage_provider,
        trajectory_count, total_steps, total_reward,
        time_window_start, time_window_end, created_at,
        compressed_size_bytes, uncompressed_size_bytes, trajectory_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    await this.db.exec(sql, [
      batch.batchId,
      batch.appName,
      batch.archetype,
      batch.storageCid,
      batch.storageProvider,
      batch.trajectoryCount,
      batch.totalSteps,
      batch.totalReward,
      batch.timeWindowStart.toISOString(),
      batch.timeWindowEnd.toISOString(),
      batch.createdAt.toISOString(),
      batch.compressedSizeBytes,
      batch.uncompressedSizeBytes,
      JSON.stringify(batch.trajectoryIds),
    ])

    logger.info('[TrainingDb] Saved batch reference', {
      batchId: batch.batchId,
      cid: batch.storageCid,
    })
  }

  async saveDatasetReference(dataset: DatasetReference): Promise<void> {
    const sql = `
      INSERT INTO scored_datasets (
        dataset_id, app_name, archetype, source_batch_cids, permanent_cid,
        storage_provider, trajectory_count, total_steps,
        average_score, score_min, score_max, score_median, score_std_dev,
        created_at, processed_at, ruler_model_id, ruler_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    await this.db.exec(sql, [
      dataset.datasetId,
      dataset.appName,
      dataset.archetype,
      JSON.stringify(dataset.sourceBatchCids),
      dataset.permanentCid,
      dataset.storageProvider,
      dataset.trajectoryCount,
      dataset.totalSteps,
      dataset.averageScore,
      dataset.scoreDistribution.min,
      dataset.scoreDistribution.max,
      dataset.scoreDistribution.median,
      dataset.scoreDistribution.stdDev,
      dataset.createdAt.toISOString(),
      dataset.processedAt.toISOString(),
      dataset.rulerModelId,
      dataset.rulerVersion,
    ])

    logger.info('[TrainingDb] Saved dataset reference', {
      datasetId: dataset.datasetId,
      cid: dataset.permanentCid,
    })
  }

  async markBatchProcessed(batchId: string, datasetId: string): Promise<void> {
    const sql = `
      UPDATE trajectory_batches
      SET processed_at = ?, dataset_id = ?
      WHERE batch_id = ?
    `

    await this.db.exec(sql, [new Date().toISOString(), datasetId, batchId])
  }

  async getUnprocessedBatches(
    appName: string,
    limit = 100,
  ): Promise<TrajectoryBatchReference[]> {
    const sql = `
      SELECT * FROM trajectory_batches
      WHERE app_name = ? AND processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    `

    const result = await this.db.query<{
      batch_id: string
      app_name: string
      archetype: string | null
      storage_cid: string
      storage_provider: 'ipfs' | 'arweave'
      trajectory_count: number
      total_steps: number
      total_reward: number
      time_window_start: string
      time_window_end: string
      created_at: string
      compressed_size_bytes: number
      uncompressed_size_bytes: number
      trajectory_ids: string
    }>(sql, [appName, limit])

    return result.rows.map((row) => {
      const parsed: unknown = JSON.parse(row.trajectory_ids)
      const trajectoryIds = StringArraySchema.parse(parsed)
      return {
        batchId: row.batch_id,
        appName: row.app_name,
        archetype: row.archetype,
        storageCid: row.storage_cid,
        storageProvider: row.storage_provider,
        trajectoryCount: row.trajectory_count,
        totalSteps: row.total_steps,
        totalReward: row.total_reward,
        timeWindowStart: new Date(row.time_window_start),
        timeWindowEnd: new Date(row.time_window_end),
        createdAt: new Date(row.created_at),
        compressedSizeBytes: row.compressed_size_bytes,
        uncompressedSizeBytes: row.uncompressed_size_bytes,
        trajectoryIds,
      }
    })
  }

  async getDatasetsByArchetype(
    appName: string,
    archetype: string,
    limit = 10,
  ): Promise<DatasetReference[]> {
    const sql = `
      SELECT * FROM scored_datasets
      WHERE app_name = ? AND archetype = ?
      ORDER BY created_at DESC
      LIMIT ?
    `

    const result = await this.db.query<{
      dataset_id: string
      app_name: string
      archetype: string
      source_batch_cids: string
      permanent_cid: string
      storage_provider: 'arweave'
      trajectory_count: number
      total_steps: number
      average_score: number
      score_min: number
      score_max: number
      score_median: number
      score_std_dev: number
      created_at: string
      processed_at: string
      ruler_model_id: string
      ruler_version: string
    }>(sql, [appName, archetype, limit])

    return result.rows.map((row) => {
      const parsed: unknown = JSON.parse(row.source_batch_cids)
      const sourceBatchCids = StringArraySchema.parse(parsed)
      return {
        datasetId: row.dataset_id,
        appName: row.app_name,
        archetype: row.archetype,
        sourceBatchCids,
        permanentCid: row.permanent_cid,
        storageProvider: row.storage_provider,
        trajectoryCount: row.trajectory_count,
        totalSteps: row.total_steps,
        averageScore: row.average_score,
        scoreDistribution: {
          min: row.score_min,
          max: row.score_max,
          median: row.score_median,
          stdDev: row.score_std_dev,
        },
        createdAt: new Date(row.created_at),
        processedAt: new Date(row.processed_at),
        rulerModelId: row.ruler_model_id,
        rulerVersion: row.ruler_version,
      }
    })
  }
}

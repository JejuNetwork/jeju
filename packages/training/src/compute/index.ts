/**
 * Compute Training Module
 *
 * Integrates training with Jeju's decentralized compute marketplace.
 * Provides clients for:
 * - DWS distributed training with Atropos/Psyche
 * - Decentralized training coordination
 * - LLM-as-judge scoring
 * - Cross-chain reward distribution
 */

export type { DWSJobStatus, JudgeResult } from '../schemas'
export {
  createDWSClient,
  type DWSClientConfig,
  DWSTrainingClient,
  getDefaultDWSConfig,
  isDWSAvailable,
  type RolloutData,
} from './dws-client'

export type {
  TrainingJobRequest,
  TrainingJobResult,
  TrainingJobStatus,
} from './types'

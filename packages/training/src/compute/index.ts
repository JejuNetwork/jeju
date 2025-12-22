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

export {
  createDWSClient,
  type DWSClientConfig,
  type DWSJobStatus,
  DWSTrainingClient,
  getDefaultDWSConfig,
  isDWSAvailable,
  type JudgeResult,
  type RolloutData,
} from './dws-client'

export type {
  TrainingJobRequest,
  TrainingJobResult,
  TrainingJobStatus,
} from './types'

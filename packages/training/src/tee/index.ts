/**
 * TEE Training Module
 *
 * Provides TEE-secured training workers for:
 * - Data preparation
 * - LLM judging
 * - RL training
 * - Model benchmarking
 */

export {
  createTrainingWorker,
  TrainingWorker,
} from './training-worker'

export {
  isArrayOf,
  isCIDResponse,
  isGenericObject,
  isJudgingScoreResponse,
  isScoredTrainingData,
  isSimulationResultResponse,
  isTEEInitResponse,
  isTEEProvider,
  isTrainingComputeResponse,
} from './type-guards'

export {
  type BenchmarkResult,
  type DataPrepResult,
  type JudgingResult,
  type JudgingScoreResponse,
  type SimulationResultResponse,
  type TEEInitResponse,
  type TEEProvider,
  type TrainingComputeResponse,
  type TrainingResult,
  type WorkerAttestation,
  type WorkerConfig,
  WorkerStatus,
  WorkerType,
} from './types'

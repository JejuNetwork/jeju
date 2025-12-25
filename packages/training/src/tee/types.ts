/**
 * TEE Types for Training Infrastructure
 */

import type { Address, Hex } from 'viem'

/**
 * TEE provider types
 */
export type TEEProvider = 'phala' | 'intel-sgx' | 'intel-tdx' | 'amd-sev' | 'simulated'

/**
 * Worker types
 */
export enum WorkerType {
  DATA_PREP = 'DATA_PREP',
  JUDGING = 'JUDGING',
  TRAINING = 'TRAINING',
  BENCHMARK = 'BENCHMARK',
}

/**
 * Worker status
 */
export enum WorkerStatus {
  IDLE = 'IDLE',
  INITIALIZING = 'INITIALIZING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Worker configuration
 */
export interface WorkerConfig {
  /** Worker type */
  type: WorkerType
  /** Unique worker ID */
  workerId: string
  /** Code hash for attestation */
  codeHash: Hex
  /** Chain ID */
  chainId: string
  /** Training orchestrator address */
  trainingOrchestratorAddress: Address
  /** Model registry address */
  modelRegistryAddress: Address
  /** Storage endpoint */
  storageEndpoint: string
  /** GPU configuration */
  gpu?: {
    type: 'nvidia' | 'amd'
    memory: number // GB
    cudaVersion?: string
  }
  /** TEE provider type */
  teeProvider?: TEEProvider
  /** Whether to require attestation verification */
  requireAttestation?: boolean
}

/**
 * Worker attestation
 */
export interface WorkerAttestation {
  workerId: string
  workerType: WorkerType
  codeHash: Hex
  operatorAddress: Address
  timestamp: number
  quote: Hex
  signature: Hex
}

/**
 * Data preparation result
 */
export interface DataPrepResult {
  preparedDataCid: string
  trajectoryCount: number
  stepCount: number
  attestation: Hex
}

/**
 * LLM judging result
 */
export interface JudgingResult {
  scoredDataCid: string
  trajectoryCount: number
  averageScore: number
  scoreDistribution: { min: number; max: number; median: number }
  attestation: Hex
}

/**
 * Training result
 */
export interface TrainingResult {
  outputModelCid: string
  finalLoss: number
  epochs: number
  attestation: Hex
}

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  score: number // Basis points (e.g., 7500 = 75%)
  samples: number
  metrics: {
    pnlMean: number
    pnlStdDev: number
    winRate: number
    sharpeRatio: number
    maxDrawdown: number
  }
  attestation: Hex
}

/**
 * TEE initialization response
 */
export interface TEEInitResponse {
  operatorAddress: Address
  attestationQuote?: Hex
}

/**
 * Judging score response
 */
export interface JudgingScoreResponse {
  trajectoryId: string
  score: number
  breakdown: Record<string, number>
}

/**
 * Training compute response
 */
export interface TrainingComputeResponse {
  trainedModel: Record<string, unknown>
  finalLoss: number
  epochs: number
}

/**
 * Simulation result response
 */
export interface SimulationResultResponse {
  pnl: number
  trades: number
}

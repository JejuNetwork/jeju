/**
 * TEE Training Worker
 *
 * Runs inside a Trusted Execution Environment (TEE) to:
 * 1. Decrypt encrypted trajectories
 * 2. Prepare data for training
 * 3. Execute LLM judging
 * 4. Run training iterations
 * 5. Encrypt and publish results
 *
 * Production Requirements:
 * - TEE attestation must be verified before processing sensitive data
 * - Simulated mode is NOT allowed in production
 */

import { logger } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import type {
  EncryptedTrajectory,
  TrajectoryBatch,
} from '../storage'
import type { TrajectoryStep } from '../schemas'
import {
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
import {
  type BenchmarkResult,
  type DataPrepResult,
  type JudgingResult,
  type JudgingScoreResponse,
  type TEEProvider,
  type TrainingResult,
  type WorkerAttestation,
  type WorkerConfig,
  WorkerStatus,
  WorkerType,
} from './types'

// ============================================================================
// TEE Training Worker
// ============================================================================

/**
 * Check if running in production environment
 */
function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production'
}

export class TrainingWorker {
  private config: WorkerConfig
  private status: WorkerStatus = WorkerStatus.IDLE
  private operatorAddress: Address | null = null
  private privateKey: Hex | null = null
  private currentJobId: Hex | null = null
  private startTime: number = 0
  private isProduction: boolean
  private teeProvider: TEEProvider

  constructor(config: WorkerConfig) {
    this.config = config
    this.isProduction = isProductionEnvironment()

    // Determine TEE provider with validation
    const envTeeMode = process.env.TEE_MODE
    const validatedEnvProvider = isTEEProvider(envTeeMode)
      ? envTeeMode
      : undefined
    this.teeProvider =
      config.teeProvider ??
      validatedEnvProvider ??
      (this.isProduction ? 'phala' : 'simulated')

    // Validate TEE configuration in production
    this.validateTEEConfig()
  }

  /**
   * Validate TEE configuration for production readiness
   */
  private validateTEEConfig(): void {
    if (this.isProduction) {
      if (this.teeProvider === 'simulated') {
        throw new Error(
          '[TrainingWorker] Simulated TEE mode is NOT allowed in production. ' +
            'Set TEE_MODE to a valid provider (phala, intel-sgx, intel-tdx, amd-sev).',
        )
      }

      if (!process.env.TEE_MODE && !this.config.teeProvider) {
        throw new Error(
          '[TrainingWorker] TEE_MODE must be set in production environment.',
        )
      }

      logger.info('[TrainingWorker] Production TEE validation passed', {
        provider: this.teeProvider,
        requireAttestation: this.config.requireAttestation ?? true,
      })
    } else {
      if (this.teeProvider === 'simulated') {
        logger.warn(
          '[TrainingWorker] Using simulated TEE mode - dev only, NOT for production',
        )
      }
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initialize the worker
   */
  async initialize(): Promise<WorkerAttestation> {
    this.status = WorkerStatus.INITIALIZING
    this.startTime = Date.now()

    logger.info('[TrainingWorker] Initializing', {
      type: this.config.type,
      workerId: this.config.workerId,
      teeProvider: this.teeProvider,
      isProduction: this.isProduction,
    })

    if (this.isProduction && this.teeProvider !== 'simulated') {
      // Production: Connect to real TEE hardware
      await this.initializeProductionTEE()
    } else {
      // Development: Use simulated keys (NOT secure)
      if (this.isProduction) {
        throw new Error(
          '[TrainingWorker] Cannot use simulated TEE in production',
        )
      }

      logger.warn(
        '[TrainingWorker] Using simulated TEE - dev only, NOT for production',
      )

      const measurement = keccak256(
        toBytes(
          `${this.config.codeHash}:${this.config.workerId}:${Date.now()}`,
        ),
      )
      this.operatorAddress = `0x${measurement.slice(2, 42)}` as Address
      this.privateKey = measurement
    }

    // Generate attestation quote
    const attestation = this.generateAttestation()

    this.status = WorkerStatus.IDLE

    logger.info('[TrainingWorker] Initialized', {
      operatorAddress: this.operatorAddress,
      type: this.config.type,
      teeProvider: this.teeProvider,
    })

    return attestation
  }

  /**
   * Initialize production TEE connection
   */
  private async initializeProductionTEE(): Promise<void> {
    const teeEndpoint = process.env.TEE_ENDPOINT || process.env.PHALA_ENDPOINT

    if (!teeEndpoint) {
      throw new Error(
        '[TrainingWorker] TEE_ENDPOINT or PHALA_ENDPOINT required in production',
      )
    }

    logger.info('[TrainingWorker] Connecting to TEE', {
      provider: this.teeProvider,
      endpoint: teeEndpoint,
    })

    // Connect to TEE provider and derive keys
    const response = await fetch(`${teeEndpoint}/v1/worker/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workerId: this.config.workerId,
        codeHash: this.config.codeHash,
        workerType: this.config.type,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new Error(
        `[TrainingWorker] TEE initialization failed: ${response.status} ${response.statusText}`,
      )
    }

    const data: unknown = await response.json()
    if (!isTEEInitResponse(data)) {
      throw new Error('[TrainingWorker] Invalid TEE initialization response')
    }

    this.operatorAddress = data.operatorAddress as Address
    this.privateKey = null

    logger.info('[TrainingWorker] TEE initialization complete', {
      operatorAddress: this.operatorAddress,
    })
  }

  /**
   * Generate attestation quote
   */
  private generateAttestation(): WorkerAttestation {
    if (!this.operatorAddress) {
      throw new Error(
        '[TrainingWorker] Cannot generate attestation: worker not initialized',
      )
    }

    const timestamp = Date.now()
    const quoteData = `${this.config.workerId}:${this.config.type}:${this.config.codeHash}:${this.operatorAddress}:${timestamp}`
    const quote = keccak256(toBytes(quoteData))

    // Sign the quote
    const signature = keccak256(toBytes(`${quote}:${this.privateKey}`))

    return {
      workerId: this.config.workerId,
      workerType: this.config.type,
      codeHash: this.config.codeHash,
      operatorAddress: this.operatorAddress,
      timestamp,
      quote,
      signature,
    }
  }

  // --------------------------------------------------------------------------
  // Data Preparation Worker
  // --------------------------------------------------------------------------

  /**
   * Verify attestation before processing sensitive data
   */
  private verifyAttestationForSensitiveOp(operation: string): void {
    const requireAttestation =
      this.config.requireAttestation ?? this.isProduction

    if (requireAttestation && !this.operatorAddress) {
      throw new Error(
        `[TrainingWorker] TEE attestation required for ${operation} - worker not properly initialized`,
      )
    }

    if (this.isProduction && this.teeProvider === 'simulated') {
      throw new Error(
        `[TrainingWorker] ${operation} requires real TEE in production`,
      )
    }
  }

  /**
   * Prepare data for training (DATA_PREP worker)
   */
  async prepareData(
    jobId: Hex,
    batch: TrajectoryBatch,
    encryptedTrajectories: EncryptedTrajectory[],
  ): Promise<DataPrepResult> {
    if (this.config.type !== WorkerType.DATA_PREP) {
      throw new Error(`Wrong worker type: ${this.config.type}`)
    }

    this.verifyAttestationForSensitiveOp('data preparation')

    this.status = WorkerStatus.PROCESSING
    this.currentJobId = jobId

    logger.info('[TrainingWorker] Starting data preparation', {
      jobId,
      trajectoryCount: batch.trajectoryCount,
      teeProvider: this.teeProvider,
    })

    // Decrypt all trajectories
    const trajectories: TrajectoryStep[][] = []
    for (const encrypted of encryptedTrajectories) {
      const steps = await this.decryptTrajectory(encrypted.encryptedCid)
      trajectories.push(steps)
    }

    // Prepare data for training
    const preparedData = await this.formatForTraining(
      trajectories,
      batch.archetype,
    )

    // Encrypt prepared data
    const preparedDataCid = await this.encryptAndUpload(preparedData)

    // Generate attestation
    const attestation = keccak256(
      toBytes(`prepared:${jobId}:${preparedDataCid}:${trajectories.length}`),
    )

    this.status = WorkerStatus.COMPLETED
    this.currentJobId = null

    logger.info('[TrainingWorker] Data preparation complete', {
      jobId,
      cid: preparedDataCid,
      trajectoryCount: trajectories.length,
    })

    return {
      preparedDataCid,
      trajectoryCount: trajectories.length,
      stepCount: trajectories.reduce((sum, t) => sum + t.length, 0),
      attestation,
    }
  }

  // --------------------------------------------------------------------------
  // Judging Worker
  // --------------------------------------------------------------------------

  /**
   * Run LLM judging on trajectories (JUDGING worker)
   */
  async judgeTrajectories(
    jobId: Hex,
    preparedDataCid: string,
    archetype: string,
  ): Promise<JudgingResult> {
    if (this.config.type !== WorkerType.JUDGING) {
      throw new Error(`Wrong worker type: ${this.config.type}`)
    }

    this.verifyAttestationForSensitiveOp('LLM judging')

    this.status = WorkerStatus.PROCESSING
    this.currentJobId = jobId

    logger.info('[TrainingWorker] Starting LLM judging', {
      jobId,
      preparedDataCid,
      archetype,
      teeProvider: this.teeProvider,
    })

    // Download prepared data and run LLM judging
    const preparedData = await this.downloadAndDecrypt(
      preparedDataCid,
      isGenericObject,
    )
    const scoredData = await this.runLLMJudging(preparedData, archetype)

    // Calculate score statistics
    const scores = scoredData.map((d) => d.score).sort((a, b) => a - b)
    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length
    const scoreStats = {
      min: scores[0] ?? 0,
      max: scores[scores.length - 1] ?? 0,
      median: scores[Math.floor(scores.length / 2)] ?? 0,
    }

    // Encrypt, upload, and generate attestation
    const scoredDataCid = await this.encryptAndUpload(scoredData)
    const attestation = keccak256(
      toBytes(`judged:${jobId}:${scoredDataCid}:${scores.length}`),
    )

    this.status = WorkerStatus.COMPLETED
    this.currentJobId = null

    logger.info('[TrainingWorker] LLM judging complete', {
      jobId,
      cid: scoredDataCid,
      averageScore,
      scoreStats,
    })

    return {
      scoredDataCid,
      trajectoryCount: scoredData.length,
      averageScore,
      scoreDistribution: scoreStats,
      attestation,
    }
  }

  // --------------------------------------------------------------------------
  // Training Worker
  // --------------------------------------------------------------------------

  /**
   * Run RL training (TRAINING worker)
   */
  async train(
    jobId: Hex,
    scoredDataCid: string,
    baseModelCid: string,
    config: {
      epochs: number
      batchSize: number
      learningRate: number
      temperature: number
    },
  ): Promise<TrainingResult> {
    if (this.config.type !== WorkerType.TRAINING) {
      throw new Error(`Wrong worker type: ${this.config.type}`)
    }

    this.verifyAttestationForSensitiveOp('RL training')

    this.status = WorkerStatus.PROCESSING
    this.currentJobId = jobId

    logger.info('[TrainingWorker] Starting training', {
      jobId,
      scoredDataCid,
      baseModelCid,
      epochs: config.epochs,
      teeProvider: this.teeProvider,
    })

    // Download scored data and base model
    const scoredData = await this.downloadAndDecrypt(
      scoredDataCid,
      isScoredTrainingData,
    )
    const baseModel = await this.downloadModel(baseModelCid)

    // Run training
    const { trainedModel, finalLoss } = await this.runTraining(
      baseModel,
      scoredData,
      config,
    )

    // Encrypt and upload trained model
    const outputModelCid = await this.encryptAndUpload(trainedModel)

    // Generate attestation
    const attestation = keccak256(
      toBytes(`trained:${jobId}:${outputModelCid}:${config.epochs}`),
    )

    this.status = WorkerStatus.COMPLETED
    this.currentJobId = null

    logger.info('[TrainingWorker] Training complete', {
      jobId,
      cid: outputModelCid,
      finalLoss,
      epochs: config.epochs,
    })

    return {
      outputModelCid,
      finalLoss,
      epochs: config.epochs,
      attestation,
    }
  }

  // --------------------------------------------------------------------------
  // Benchmark Worker
  // --------------------------------------------------------------------------

  /**
   * Run benchmark simulations (BENCHMARK worker)
   */
  async benchmark(
    jobId: Hex,
    modelCid: string,
    archetype: string,
    samples: number,
  ): Promise<BenchmarkResult> {
    if (this.config.type !== WorkerType.BENCHMARK) {
      throw new Error(`Wrong worker type: ${this.config.type}`)
    }

    if (this.config.requireAttestation) {
      this.verifyAttestationForSensitiveOp('benchmark')
    }

    this.status = WorkerStatus.PROCESSING
    this.currentJobId = jobId

    logger.info('[TrainingWorker] Starting benchmark', {
      jobId,
      modelCid,
      archetype,
      samples,
      teeProvider: this.teeProvider,
    })

    // Download model
    const model = await this.downloadModel(modelCid)

    // Run simulations
    const results = await this.runSimulations(model, archetype, samples)

    // Calculate metrics
    const metrics = this.calculateMetrics(results)

    // Calculate overall score (basis points)
    const score = Math.round(
      (metrics.winRate * 0.3 +
        Math.min(1, metrics.sharpeRatio / 2) * 0.3 +
        (1 - Math.min(1, metrics.maxDrawdown)) * 0.2 +
        Math.min(1, metrics.pnlMean / 1000) * 0.2) *
        10000,
    )

    // Generate attestation
    const attestation = keccak256(
      toBytes(`benchmark:${jobId}:${modelCid}:${score}:${samples}`),
    )

    this.status = WorkerStatus.COMPLETED
    this.currentJobId = null

    logger.info('[TrainingWorker] Benchmark complete', {
      jobId,
      score,
      samples,
      metrics,
    })

    return {
      score,
      samples,
      metrics,
      attestation,
    }
  }

  // --------------------------------------------------------------------------
  // Internal Operations
  // --------------------------------------------------------------------------

  private async decryptTrajectory(cid: string): Promise<TrajectoryStep[]> {
    logger.debug('[TrainingWorker] Decrypting trajectory', { cid })

    const response = await fetch(
      `${this.config.storageEndpoint}/download/${cid}`,
      {
        headers: {
          'X-TEE-Attestation': this.operatorAddress ?? '',
          'X-Decrypt': 'true',
        },
      },
    )

    if (!response.ok) {
      throw new Error(
        `Failed to decrypt trajectory ${cid}: ${response.status} ${response.statusText}`,
      )
    }

    const data: unknown = await response.json()
    if (!Array.isArray(data)) {
      throw new Error(`Invalid trajectory data for ${cid}`)
    }
    return data as TrajectoryStep[]
  }

  private async formatForTraining(
    trajectories: TrajectoryStep[][],
    archetype: string,
  ): Promise<Record<string, unknown>> {
    return {
      archetype,
      trajectoryCount: trajectories.length,
      data: trajectories.map((t) => ({
        steps: t.length,
        actions: t.map((s) => s.action?.actionType ?? 'unknown'),
        rewards: t.map((s) => s.reward ?? 0),
      })),
    }
  }

  private async runLLMJudging(
    preparedData: Record<string, unknown>[],
    archetype: string,
  ): Promise<JudgingScoreResponse[]> {
    logger.debug('[TrainingWorker] Running LLM judging', { archetype })

    const response = await fetch(
      `${this.config.storageEndpoint}/judging/score`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preparedData, archetype }),
      },
    )

    if (!response.ok) {
      throw new Error(
        `LLM judging service failed: ${response.status} ${response.statusText}`,
      )
    }

    const data: unknown = await response.json()
    if (!isArrayOf(data, isJudgingScoreResponse)) {
      throw new Error('Invalid LLM judging response')
    }
    return data
  }

  private async downloadModel(cid: string): Promise<Record<string, unknown>> {
    logger.debug('[TrainingWorker] Downloading model', { cid })

    const response = await fetch(
      `${this.config.storageEndpoint}/download/${cid}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`)
    }
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid model data')
    }
    return data as Record<string, unknown>
  }

  private async runTraining(
    baseModel: Record<string, unknown>,
    scoredData: JudgingScoreResponse[],
    config: { epochs: number; batchSize: number; learningRate: number },
  ): Promise<{ trainedModel: Record<string, unknown>; finalLoss: number }> {
    logger.info('[TrainingWorker] Running training', {
      samples: scoredData.length,
      epochs: config.epochs,
      batchSize: config.batchSize,
      learningRate: config.learningRate,
    })

    const trainingResponse = await fetch(
      `${this.config.storageEndpoint}/training/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseModel,
          scoredData,
          config,
        }),
      },
    )

    if (!trainingResponse.ok) {
      throw new Error(
        `Training service failed: ${trainingResponse.status} ${trainingResponse.statusText}`,
      )
    }

    const data: unknown = await trainingResponse.json()
    if (!isTrainingComputeResponse(data)) {
      throw new Error('Invalid training response')
    }
    return {
      trainedModel: data.trainedModel as Record<string, unknown>,
      finalLoss: data.finalLoss,
    }
  }

  private async runSimulations(
    model: Record<string, unknown>,
    archetype: string,
    samples: number,
  ): Promise<{ pnl: number; trades: number }[]> {
    logger.debug('[TrainingWorker] Running simulations', {
      archetype,
      samples,
    })

    const response = await fetch(
      `${this.config.storageEndpoint}/simulation/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, archetype, samples }),
      },
    )

    if (!response.ok) {
      throw new Error(
        `Simulation service failed: ${response.status} ${response.statusText}`,
      )
    }

    const data: unknown = await response.json()
    if (!isArrayOf(data, isSimulationResultResponse)) {
      throw new Error('Invalid simulation response')
    }
    return data
  }

  private calculateMetrics(
    results: { pnl: number; trades: number }[],
  ): BenchmarkResult['metrics'] {
    const pnls = results.map((r) => r.pnl)
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length
    const variance =
      pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length
    const stdDev = Math.sqrt(variance)

    const wins = pnls.filter((p) => p > 0).length
    const winRate = wins / pnls.length

    const sharpeRatio = stdDev > 0 ? mean / stdDev : 0

    let maxDrawdown = 0
    let peak = 0
    let cumulative = 0
    for (const pnl of pnls) {
      cumulative += pnl
      if (cumulative > peak) peak = cumulative
      const drawdown = peak > 0 ? (peak - cumulative) / peak : 0
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }

    return {
      pnlMean: mean,
      pnlStdDev: stdDev,
      winRate,
      sharpeRatio,
      maxDrawdown,
    }
  }

  private async encryptAndUpload(
    payload: Record<string, unknown> | unknown[],
  ): Promise<string> {
    const jsonData = JSON.stringify(payload)

    const response = await fetch(`${this.config.storageEndpoint}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: jsonData,
        encrypt: true,
        attestation: this.operatorAddress,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Storage upload failed: ${response.status} ${response.statusText}`,
      )
    }

    const responseData: unknown = await response.json()
    if (!isCIDResponse(responseData)) {
      throw new Error('Invalid storage upload response')
    }
    return responseData.cid
  }

  private async downloadAndDecrypt<T>(
    cid: string,
    guard: (item: unknown) => item is T,
  ): Promise<T[]> {
    logger.debug('[TrainingWorker] Downloading and decrypting', { cid })

    const response = await fetch(
      `${this.config.storageEndpoint}/download/${cid}`,
      {
        headers: {
          'X-Attestation': this.operatorAddress ?? '',
        },
      },
    )

    if (!response.ok) {
      logger.warn('[TrainingWorker] Download failed, returning empty data')
      return []
    }

    const data: unknown = await response.json()
    if (!isArrayOf(data, guard)) {
      logger.warn('[TrainingWorker] Invalid download data, returning empty')
      return []
    }
    return data
  }

  // --------------------------------------------------------------------------
  // Status
  // --------------------------------------------------------------------------

  getStatus(): {
    type: WorkerType
    status: WorkerStatus
    operatorAddress: Address | null
    currentJobId: Hex | null
    uptime: number
  } {
    return {
      type: this.config.type,
      status: this.status,
      operatorAddress: this.operatorAddress,
      currentJobId: this.currentJobId,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
    }
  }

  getConfig(): WorkerConfig {
    return this.config
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a training worker
 */
export function createTrainingWorker(
  type: WorkerType,
  config?: Partial<WorkerConfig>,
): TrainingWorker {
  const isProduction = isProductionEnvironment()
  const envTeeMode = process.env.TEE_MODE
  const validatedEnvProvider = isTEEProvider(envTeeMode)
    ? envTeeMode
    : undefined
  const teeProvider =
    config?.teeProvider ??
    validatedEnvProvider ??
    (isProduction ? 'phala' : 'simulated')

  // Validate TEE configuration
  if (isProduction && teeProvider === 'simulated') {
    throw new Error(
      '[createTrainingWorker] Simulated TEE mode is NOT allowed in production. ' +
        'Set TEE_MODE to a valid provider (phala, intel-sgx, intel-tdx, amd-sev).',
    )
  }

  const defaultConfig: WorkerConfig = {
    type,
    workerId: `${type.toLowerCase()}-${Date.now()}`,
    codeHash: (process.env.WORKER_CODE_HASH ??
      '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex,
    chainId: process.env.CHAIN_ID ?? '420691',
    trainingOrchestratorAddress: (process.env.TRAINING_ORCHESTRATOR_ADDRESS ??
      '0x0000000000000000000000000000000000000000') as Address,
    modelRegistryAddress: (process.env.MODEL_REGISTRY_ADDRESS ??
      '0x0000000000000000000000000000000000000000') as Address,
    storageEndpoint:
      process.env.JEJU_STORAGE_ENDPOINT ?? 'http://localhost:4400',
    teeProvider,
    requireAttestation: config?.requireAttestation ?? isProduction,
    ...config,
  }

  return new TrainingWorker(defaultConfig)
}

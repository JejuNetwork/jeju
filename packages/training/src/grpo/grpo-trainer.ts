/**
 * GRPO trainer with Atropos API integration.
 */

import {
  getAtroposLocalUrl,
  getModelName,
  getRunGroup,
  getRunProject,
  getTrainingEndpoint,
  getTrainingSteps,
  getVllmRestartInterval,
} from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { type Subprocess, spawn } from 'bun'
import { z } from 'zod'
import { BatchResponseSchema } from '../schemas'

const TrainingStepResponseSchema = z.object({
  loss: z.number(),
  pos_logp: z.number(),
  neg_logp: z.number(),
  grad_norm: z.number(),
})

export interface TrainingConfig {
  modelName: string
  learningRate: number
  trainingSteps: number
  batchSize: number
  seqLen: number
  gradientAccumulationSteps: number
  device: 'cuda' | 'cpu'
  savePath: string
  vllmRestartInterval: number
  vllmPort: number
  runProject?: string
  runGroup?: string
  atroposUrl: string
}

export interface BatchData {
  tokens: number[][]
  masks: number[][]
  scores: number[]
  advantages?: number[][]
  overrides?: Array<Record<string, string | number | boolean>>
  generation_params?: Record<string, string | number | boolean>
  group_overrides?: Record<string, string | number | boolean>
}

export interface TrainingMetrics {
  loss: number
  posLogp: number
  negLogp: number
  logp: number
  gradNorm: number
  learningRate: number
}

export interface TrainerStatus {
  running: boolean
  currentStep: number
  totalSteps: number
  lastMetrics?: TrainingMetrics
  checkpointPath?: string
}

// Constants

const DEFAULT_CONFIG: TrainingConfig = {
  modelName: 'microsoft/phi-2',
  learningRate: 1e-5,
  trainingSteps: 10,
  batchSize: 2,
  seqLen: 2048,
  gradientAccumulationSteps: 16,
  device: 'cuda',
  savePath: 'trained_model_checkpoints',
  vllmRestartInterval: 5,
  vllmPort: 9001,
  atroposUrl: 'http://localhost:8000',
}

// Utility Functions

function padToGoodOffset(
  data: { batch: BatchData[] },
  batchSize: number,
): {
  tokenBatches: number[][][]
  labelBatches: number[][][]
  advantageBatches: number[][]
  temperatureBatches: number[][]
} {
  const goodMultiple = 64

  let maxTokenLen = 0
  for (const item of data.batch) {
    for (const tokens of item.tokens) {
      if (tokens.length > maxTokenLen) {
        maxTokenLen = tokens.length
      }
    }
  }

  if ((maxTokenLen - 1) % goodMultiple !== 0) {
    maxTokenLen = Math.ceil((maxTokenLen - 1) / goodMultiple) * goodMultiple + 1
  }

  const inputIds: number[][] = []
  const labels: number[][] = []
  const advantages: number[] = []
  const temperatures: number[] = []

  for (const item of data.batch) {
    const scores = [...item.scores]
    if (scores.length > 1) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length
      const std = Math.sqrt(
        scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length,
      )
      for (let i = 0; i < scores.length; i++) {
        const currentScore = scores[i]
        if (currentScore !== undefined) {
          scores[i] = (currentScore - mean) / Math.max(std, 1e-8)
        }
      }
    }

    if (item.overrides) {
      for (let i = 0; i < item.overrides.length; i++) {
        if (item.overrides[i].set_advantage_to_zero) {
          scores[i] = 0
        }
      }
    }

    for (let i = 0; i < item.tokens.length; i++) {
      const tokens = item.tokens[i]
      const masks = item.masks[i]
      if (!tokens || !masks) continue

      const paddedTokens = new Array(maxTokenLen).fill(0)
      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j]
        if (token !== undefined) paddedTokens[j] = token
      }

      const paddedMasks = new Array(maxTokenLen).fill(-100)
      for (let j = 0; j < masks.length; j++) {
        const mask = masks[j]
        if (mask !== undefined) paddedMasks[j] = mask
      }

      inputIds.push(paddedTokens.slice(0, -1))
      labels.push(paddedMasks.slice(1))
      advantages.push(scores[i] ?? 0)

      let t = 1.0
      const override = item.overrides?.[i]
      if (override?.temperature !== undefined) {
        t = Number(override.temperature)
      } else if (item.generation_params?.temperature !== undefined) {
        t = Number(item.generation_params.temperature)
      } else if (item.group_overrides?.temperature !== undefined) {
        t = Number(item.group_overrides.temperature)
      }
      temperatures.push(t)
    }
  }

  const tokenBatches: number[][][] = []
  const labelBatches: number[][][] = []
  const advantageBatches: number[][] = []
  const temperatureBatches: number[][] = []

  for (let i = 0; i < Math.floor(inputIds.length / batchSize); i++) {
    tokenBatches.push(inputIds.slice(i * batchSize, (i + 1) * batchSize))
    labelBatches.push(labels.slice(i * batchSize, (i + 1) * batchSize))
    advantageBatches.push(advantages.slice(i * batchSize, (i + 1) * batchSize))
    temperatureBatches.push(
      temperatures.slice(i * batchSize, (i + 1) * batchSize),
    )
  }

  return { tokenBatches, labelBatches, advantageBatches, temperatureBatches }
}

// GRPO Trainer

export class GRPOTrainer {
  protected config: TrainingConfig
  protected vllmProcess: Subprocess | null = null
  protected status: TrainerStatus = {
    running: false,
    currentStep: 0,
    totalSteps: 0,
  }

  constructor(config: Partial<TrainingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.status.totalSteps = this.config.trainingSteps
  }

  getConfig(): TrainingConfig {
    return { ...this.config }
  }

  getStatus(): TrainerStatus {
    return { ...this.status }
  }

  protected set currentStep(step: number) {
    this.status.currentStep = step
  }

  async registerWithAtropos(): Promise<void> {
    const response = await fetch(`${this.config.atroposUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_group: this.config.runGroup ?? 'jeju-training',
        run_project: this.config.runProject ?? 'rlaif',
        batch_size:
          this.config.batchSize * this.config.gradientAccumulationSteps,
        max_token_len: this.config.seqLen,
        starting_step: 0,
        checkpoint_dir: this.config.savePath,
        save_checkpoint_interval: this.config.trainingSteps,
        num_steps: this.config.trainingSteps,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to register with Atropos: ${response.status}`)
    }

    console.log('[GRPO] Registered with Atropos')
  }

  async getBatch(): Promise<{ batch: BatchData[] } | null> {
    const response = await fetch(`${this.config.atroposUrl}/batch`)
    if (!response.ok) {
      throw new Error(`Failed to get batch: ${response.status}`)
    }

    const data = expectValid(
      BatchResponseSchema,
      await response.json(),
      'Atropos batch response',
    )
    if (!data.batch) {
      return null
    }

    return { batch: data.batch }
  }

  async startVllm(modelPath?: string): Promise<void> {
    if (this.vllmProcess) {
      await this.stopVllm()
    }

    const model = modelPath ?? this.config.modelName

    console.log(`[GRPO] Starting vLLM server for model: ${model}`)

    this.vllmProcess = spawn(
      [
        'python',
        '-m',
        'vllm.entrypoints.openai.api_server',
        '--model',
        model,
        '--port',
        String(this.config.vllmPort),
        '--dtype',
        'auto',
        '--gpu-memory-utilization',
        '0.45',
        '--disable-log-requests',
        ...(modelPath ? ['--served-model-name', this.config.modelName] : []),
      ],
      {
        stdout: 'inherit',
        stderr: 'inherit',
      },
    )

    await this.waitForVllm()
    console.log('[GRPO] vLLM server ready')
  }

  private async waitForVllm(timeoutMs = 120000): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(
        `http://localhost:${this.config.vllmPort}/health`,
      ).catch(() => null)

      if (response?.ok) {
        return
      }

      await new Promise((r) => setTimeout(r, 1000))
    }

    throw new Error('vLLM server failed to start')
  }

  async stopVllm(): Promise<void> {
    if (this.vllmProcess) {
      console.log('[GRPO] Stopping vLLM server')
      this.vllmProcess.kill()
      await this.vllmProcess.exited
      this.vllmProcess = null
    }
  }

  /**
   * Save checkpoint metadata marker.
   *
   * NOTE: This only saves metadata about the checkpoint step.
   * Actual model weights are saved by the Python trainer via vLLM.
   * The Python trainer should be configured to save to the same checkpointPath.
   */
  async saveCheckpointMarker(step: number): Promise<string> {
    const checkpointPath = `${this.config.savePath}/step_${step}`
    console.log(`[GRPO] Saving checkpoint marker to ${checkpointPath}`)

    await Bun.write(
      `${checkpointPath}/checkpoint_marker.json`,
      JSON.stringify({
        step,
        modelName: this.config.modelName,
        timestamp: Date.now(),
        note: 'Model weights saved by Python trainer',
      }),
    )

    return checkpointPath
  }

  /**
   * Execute a training step by sending batch to Python trainer.
   * Returns real metrics from the training process.
   */
  async trainStep(
    batches: ReturnType<typeof padToGoodOffset>,
  ): Promise<TrainingMetrics> {
    // Send training batch to Python process via HTTP or subprocess
    const trainingEndpoint = getTrainingEndpoint()

    let totalLoss = 0
    let totalPosLogp = 0
    let totalNegLogp = 0
    let totalPos = 0
    let totalNeg = 0
    let gradNorm = 0

    for (let i = 0; i < batches.tokenBatches.length; i++) {
      const tokenBatch = batches.tokenBatches[i]
      const labelBatch = batches.labelBatches[i]
      const advantages = batches.advantageBatches[i]
      const temperatures = batches.temperatureBatches[i]

      if (!tokenBatch || !labelBatch || !advantages) continue

      const response = await fetch(trainingEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_ids: tokenBatch,
          labels: labelBatch,
          advantages,
          temperatures,
          learning_rate: this.config.learningRate,
          accumulation_step: i,
          total_steps: batches.tokenBatches.length,
        }),
      })

      if (!response.ok) {
        throw new Error(
          `Training endpoint returned ${response.status}: ${response.statusText}`,
        )
      }

      const rawResponse = await response.json()
      const parseResult = TrainingStepResponseSchema.safeParse(rawResponse)

      if (!parseResult.success) {
        throw new Error(
          `Invalid training response format: ${parseResult.error.message}`,
        )
      }

      const metrics = parseResult.data
      totalLoss += metrics.loss / this.config.gradientAccumulationSteps
      gradNorm = Math.max(gradNorm, metrics.grad_norm)

      for (const adv of advantages) {
        if (adv > 0) {
          totalPosLogp += metrics.pos_logp
          totalPos++
        } else {
          totalNegLogp += metrics.neg_logp
          totalNeg++
        }
      }
    }

    return {
      loss: totalLoss,
      posLogp: totalPos > 0 ? totalPosLogp / totalPos : 0,
      negLogp: totalNeg > 0 ? totalNegLogp / totalNeg : 0,
      logp: (totalPosLogp + totalNegLogp) / Math.max(totalPos + totalNeg, 1),
      gradNorm,
      learningRate: this.config.learningRate,
    }
  }

  async train(): Promise<void> {
    console.log(
      `[GRPO] Starting training for ${this.config.trainingSteps} steps`,
    )
    console.log(`[GRPO] Model: ${this.config.modelName}`)
    console.log(`[GRPO] Device: ${this.config.device}`)

    await Bun.write(`${this.config.savePath}/.gitkeep`, '')

    await this.registerWithAtropos()
    await this.startVllm()

    const pendingBatches: ReturnType<typeof padToGoodOffset>[] = []

    for (let step = 0; step < this.config.trainingSteps; step++) {
      console.log(`\n[GRPO] Step ${step + 1}/${this.config.trainingSteps}`)

      if (
        (step + 1) % this.config.vllmRestartInterval === 0 ||
        step === this.config.trainingSteps - 1
      ) {
        await this.stopVllm()
      }

      if (pendingBatches.length === 0) {
        while (true) {
          const data = await this.getBatch()
          if (data) {
            const processed = padToGoodOffset(data, this.config.batchSize)
            pendingBatches.push(processed)
            break
          }
          await new Promise((r) => setTimeout(r, 1000))
        }
      }

      const batches = pendingBatches.shift()
      if (!batches) {
        console.log('[GRPO] No batches available')
        continue
      }

      const metrics = await this.trainStep(batches)
      console.log(`[GRPO] Loss: ${metrics.loss.toFixed(4)}`)
      console.log(`[GRPO] Grad Norm: ${metrics.gradNorm.toFixed(4)}`)
      console.log(`[GRPO] Pos LogP: ${metrics.posLogp.toFixed(4)}`)
      console.log(`[GRPO] Neg LogP: ${metrics.negLogp.toFixed(4)}`)

      if (
        (step + 1) % this.config.vllmRestartInterval === 0 ||
        step === this.config.trainingSteps - 1
      ) {
        const checkpointPath = await this.saveCheckpointMarker(step + 1)
        await this.startVllm(checkpointPath)
      }

      this.currentStep = step + 1
    }

    await this.stopVllm()

    const finalPath = `${this.config.savePath}/final_model`
    await Bun.write(
      `${finalPath}/model.json`,
      JSON.stringify({
        modelName: this.config.modelName,
        trainingSteps: this.config.trainingSteps,
        timestamp: Date.now(),
      }),
    )

    console.log('\n[GRPO] Training complete')
    console.log(`[GRPO] Final model saved to ${finalPath}`)
  }
}

// Distributed GRPO Trainer with Psyche Integration

export class DistributedGRPOTrainer extends GRPOTrainer {
  private psycheClient: import('../psyche/psyche-client').PsycheClient | null =
    null
  private bridge:
    | import('../psyche/cross-chain-bridge').CrossChainTrainingBridge
    | null = null
  private runId: string | null = null

  async setPsycheClient(
    client: import('../psyche/psyche-client').PsycheClient,
  ): Promise<void> {
    this.psycheClient = client
  }

  async setBridge(
    bridge: import('../psyche/cross-chain-bridge').CrossChainTrainingBridge,
  ): Promise<void> {
    this.bridge = bridge
  }

  async createDistributedRun(runId: string): Promise<void> {
    if (!this.psycheClient) {
      throw new Error('Psyche client required for distributed training')
    }

    this.runId = runId

    await this.psycheClient.createRun(
      runId,
      {
        name: `GRPO Training ${runId}`,
        description: 'Distributed GRPO training run',
        modelHubRepo: 'jeju/grpo-model',
        datasetHubRepo: 'jeju/training-data',
      },
      {
        maxClients: 32,
        minClients: 1,
        epochLengthMs: 60000,
        warmupEpochs: 1,
        checkpointIntervalEpochs: 5,
        learningRate: 1e-5,
        batchSize: 32,
        gradientAccumulationSteps: 4,
        maxSeqLength: 2048,
      },
      {
        hubRepo: 'jeju/grpo-model',
        revision: 'main',
        sha256: '',
      },
    )

    console.log(`[DistributedGRPO] Created run ${runId} on Psyche network`)

    if (this.bridge) {
      await this.bridge.trackRun(runId)
    }
  }

  async reportProgress(_epoch: number, _step: number): Promise<void> {
    if (!this.bridge || !this.runId) {
      return
    }

    const solanaState = this.psycheClient
      ? await this.psycheClient.getRunState(this.runId)
      : null

    if (solanaState) {
      await this.bridge.bridgeProgress(this.runId, solanaState)
    }
  }

  async submitCheckpointToBridge(
    epoch: number,
    checkpointCid: string,
    merkleRoot: string,
  ): Promise<void> {
    if (!this.bridge || !this.runId) {
      return
    }

    await this.bridge.submitCheckpoint(this.runId, {
      cid: checkpointCid,
      epoch,
      merkleRoot: `0x${merkleRoot.padEnd(64, '0')}` as `0x${string}`,
      modelHash: `0x${'0'.repeat(64)}` as `0x${string}`,
    })
  }
}

// Factory Functions

export function createGRPOTrainer(
  config?: Partial<TrainingConfig>,
): GRPOTrainer {
  return new GRPOTrainer(config)
}

export function createDistributedGRPOTrainer(
  config?: Partial<TrainingConfig>,
): DistributedGRPOTrainer {
  return new DistributedGRPOTrainer(config)
}

// CLI Entry Point

if (import.meta.main) {
  const config: Partial<TrainingConfig> = {
    modelName: getModelName(),
    trainingSteps: getTrainingSteps(),
    vllmRestartInterval: getVllmRestartInterval(),
    runProject: getRunProject(),
    runGroup: getRunGroup(),
    atroposUrl: getAtroposLocalUrl(),
  }

  const trainer = createGRPOTrainer(config)
  trainer.train().catch(console.error)
}

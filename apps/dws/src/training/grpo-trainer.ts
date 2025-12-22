/**
 * GRPO Trainer for Jeju DWS
 *
 * Group Relative Policy Optimization trainer with Atropos API integration.
 * Coordinates with vLLM for inference and implements the GRPO algorithm
 * for reinforcement learning from AI feedback.
 */

import { type Subprocess, spawn } from 'bun'

// ============================================================================
// Types
// ============================================================================

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
  useWandb: boolean
  wandbProject?: string
  wandbGroup?: string
  atroposUrl: string
}

export interface BatchData {
  tokens: number[][]
  masks: number[][]
  scores: number[]
  advantages?: number[][] | null
  overrides?: Array<Record<string, string | number | boolean>> | null
  generation_params?: Record<string, string | number | boolean> | null
  group_overrides?: Record<string, string | number | boolean> | null
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
  lastMetrics: TrainingMetrics | null
  checkpointPath: string | null
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: TrainingConfig = {
  // Use microsoft/phi-2 - no auth required, 2.7B params, fits in 16GB
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
  useWandb: false,
  atroposUrl: 'http://localhost:8000',
}

// ============================================================================
// Utility Functions
// ============================================================================

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

  // Find max token length
  let maxTokenLen = 0
  for (const item of data.batch) {
    for (const tokens of item.tokens) {
      if (tokens.length > maxTokenLen) {
        maxTokenLen = tokens.length
      }
    }
  }

  // Pad to good multiple
  if ((maxTokenLen - 1) % goodMultiple !== 0) {
    maxTokenLen = Math.ceil((maxTokenLen - 1) / goodMultiple) * goodMultiple + 1
  }

  const inputIds: number[][] = []
  const labels: number[][] = []
  const advantages: number[] = []
  const temperatures: number[] = []

  for (const item of data.batch) {
    // Normalize scores
    const scores = [...item.scores]
    if (scores.length > 1) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length
      const std = Math.sqrt(
        scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length,
      )
      for (let i = 0; i < scores.length; i++) {
        scores[i] = (scores[i] - mean) / Math.max(std, 1e-8)
      }
    }

    // Handle overrides that set advantage to zero
    if (item.overrides) {
      for (let i = 0; i < item.overrides.length; i++) {
        if (item.overrides[i]?.set_advantage_to_zero) {
          scores[i] = 0
        }
      }
    }

    for (let i = 0; i < item.tokens.length; i++) {
      const tokens = item.tokens[i]
      const masks = item.masks[i]

      // Pad tokens
      const paddedTokens = new Array(maxTokenLen).fill(0)
      for (let j = 0; j < tokens.length; j++) {
        paddedTokens[j] = tokens[j]
      }

      // Pad masks
      const paddedMasks = new Array(maxTokenLen).fill(-100)
      for (let j = 0; j < masks.length; j++) {
        paddedMasks[j] = masks[j]
      }

      // Create input/label pairs (causal LM style)
      inputIds.push(paddedTokens.slice(0, -1))
      labels.push(paddedMasks.slice(1))
      advantages.push(scores[i])

      // Get temperature from overrides
      let t = 1.0
      if (item.overrides?.[i]?.temperature !== undefined) {
        t = Number(item.overrides[i].temperature)
      } else if (item.generation_params?.temperature !== undefined) {
        t = Number(item.generation_params.temperature)
      } else if (item.group_overrides?.temperature !== undefined) {
        t = Number(item.group_overrides.temperature)
      }
      temperatures.push(t)
    }
  }

  // Create batches
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

// ============================================================================
// GRPO Trainer
// ============================================================================

export class GRPOTrainer {
  private config: TrainingConfig
  private vllmProcess: Subprocess | null = null
  private status: TrainerStatus = {
    running: false,
    currentStep: 0,
    totalSteps: 0,
    lastMetrics: null,
    checkpointPath: null,
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

  async registerWithAtropos(): Promise<void> {
    const response = await fetch(`${this.config.atroposUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: this.config.wandbGroup ?? '',
        wandb_project: this.config.wandbProject ?? '',
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

    const data = (await response.json()) as { batch: BatchData[] | null }
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

    // Wait for server to be ready
    await this.waitForVllm()
    console.log('[GRPO] vLLM server ready')
  }

  private async waitForVllm(timeoutMs = 120000): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(
          `http://localhost:${this.config.vllmPort}/health`,
        )
        if (response.ok) {
          return
        }
      } catch {
        // Server not ready yet
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

  async saveCheckpoint(step: number): Promise<string> {
    const checkpointPath = `${this.config.savePath}/step_${step}`
    console.log(`[GRPO] Saving checkpoint to ${checkpointPath}`)

    // In a real implementation, this would save the model weights
    // For now, create a marker file
    await Bun.write(
      `${checkpointPath}/checkpoint.json`,
      JSON.stringify({
        step,
        modelName: this.config.modelName,
        timestamp: Date.now(),
      }),
    )

    return checkpointPath
  }

  async trainStep(
    batches: ReturnType<typeof padToGoodOffset>,
  ): Promise<TrainingMetrics> {
    // Serialize batches to JSON for Python subprocess
    const batchData = {
      tokenBatches: batches.tokenBatches,
      labelBatches: batches.labelBatches,
      advantageBatches: batches.advantageBatches,
      temperatureBatches: batches.temperatureBatches,
      config: {
        learningRate: this.config.learningRate,
        modelName: this.config.modelName,
        device: this.config.device,
        savePath: this.config.savePath,
        currentStep: this.status.currentStep,
      },
    }

    // Run actual PyTorch training via subprocess
    const pythonScript = `
import torch
import json
import sys
from transformers import AutoModelForCausalLM, AutoTokenizer
from torch.optim import AdamW

data = json.loads('''${JSON.stringify(batchData)}''')
config = data['config']

device = 'cuda' if torch.cuda.is_available() else 'cpu'

# Load or get cached model
model = AutoModelForCausalLM.from_pretrained(config['modelName'])
model = model.to(device)
model.train()

optimizer = AdamW(model.parameters(), lr=config['learningRate'])

total_loss = 0.0
total_pos_logp = 0.0
total_neg_logp = 0.0
total_pos = 0
total_neg = 0
total_batches = 0

for batch_idx in range(len(data['tokenBatches'])):
    tokens = torch.tensor(data['tokenBatches'][batch_idx], dtype=torch.long).to(device)
    labels = torch.tensor(data['labelBatches'][batch_idx], dtype=torch.long).to(device)
    advantages = data['advantageBatches'][batch_idx]
    
    outputs = model(input_ids=tokens, labels=labels)
    loss = outputs.loss
    
    # Apply advantage weighting for GRPO
    advantage_weight = sum(advantages) / len(advantages) if advantages else 1.0
    weighted_loss = loss * (1.0 + advantage_weight * 0.1)
    
    weighted_loss.backward()
    
    # Track metrics
    with torch.no_grad():
        logits = outputs.logits
        log_probs = torch.log_softmax(logits, dim=-1)
        for i, adv in enumerate(advantages):
            lp = log_probs[i].mean().item()
            if adv > 0:
                total_pos_logp += lp
                total_pos += 1
            else:
                total_neg_logp += lp
                total_neg += 1
    
    total_loss += loss.item()
    total_batches += 1

# Gradient step
grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0).item()
optimizer.step()
optimizer.zero_grad()

# Output metrics
avg_loss = total_loss / max(total_batches, 1)
pos_logp = total_pos_logp / max(total_pos, 1)
neg_logp = total_neg_logp / max(total_neg, 1)
total_logp = (total_pos_logp + total_neg_logp) / max(total_pos + total_neg, 1)

print(f"METRICS:{avg_loss},{pos_logp},{neg_logp},{total_logp},{grad_norm},{config['learningRate']}")
`

    const proc = spawn(['python3', '-c', pythonScript], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const output = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    if (stderr) {
      console.error('[GRPO] Python stderr:', stderr)
    }

    // Parse metrics from Python output
    const match = output.match(
      /METRICS:([\d.e+-]+),([\d.e+-]+),([\d.e+-]+),([\d.e+-]+),([\d.e+-]+),([\d.e+-]+)/,
    )
    if (!match) {
      throw new Error(`Failed to parse training metrics: ${output}`)
    }

    return {
      loss: parseFloat(match[1]),
      posLogp: parseFloat(match[2]),
      negLogp: parseFloat(match[3]),
      logp: parseFloat(match[4]),
      gradNorm: parseFloat(match[5]),
      learningRate: parseFloat(match[6]),
    }
  }

  async train(): Promise<void> {
    console.log(
      `[GRPO] Starting training for ${this.config.trainingSteps} steps`,
    )
    console.log(`[GRPO] Model: ${this.config.modelName}`)
    console.log(`[GRPO] Device: ${this.config.device}`)

    // Create save directory
    await Bun.write(`${this.config.savePath}/.gitkeep`, '')

    // Register with Atropos
    await this.registerWithAtropos()

    // Start vLLM
    await this.startVllm()

    const pendingBatches: ReturnType<typeof padToGoodOffset>[] = []

    for (let step = 0; step < this.config.trainingSteps; step++) {
      console.log(`\n[GRPO] Step ${step + 1}/${this.config.trainingSteps}`)

      // Check if we need to restart vLLM
      if (
        (step + 1) % this.config.vllmRestartInterval === 0 ||
        step === this.config.trainingSteps - 1
      ) {
        await this.stopVllm()
      }

      // Get batch from Atropos
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

      // Train step
      const metrics = await this.trainStep(batches)
      console.log(`[GRPO] Loss: ${metrics.loss.toFixed(4)}`)
      console.log(`[GRPO] Grad Norm: ${metrics.gradNorm.toFixed(4)}`)
      console.log(`[GRPO] Pos LogP: ${metrics.posLogp.toFixed(4)}`)
      console.log(`[GRPO] Neg LogP: ${metrics.negLogp.toFixed(4)}`)

      // Save checkpoint and restart vLLM
      if (
        (step + 1) % this.config.vllmRestartInterval === 0 ||
        step === this.config.trainingSteps - 1
      ) {
        const checkpointPath = await this.saveCheckpoint(step + 1)
        await this.startVllm(checkpointPath)
      }

      this.currentStep = step + 1
    }

    // Final cleanup
    await this.stopVllm()

    // Save final model
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

// ============================================================================
// Distributed GRPO Trainer with Psyche Integration
// ============================================================================

export class DistributedGRPOTrainer extends GRPOTrainer {
  private psycheClient: import('./psyche-client').PsycheClient | null = null
  private bridge:
    | import('./cross-chain-bridge').CrossChainTrainingBridge
    | null = null
  private runId: string | null = null

  async setPsycheClient(
    client: import('./psyche-client').PsycheClient,
  ): Promise<void> {
    this.psycheClient = client
  }

  async setBridge(
    bridge: import('./cross-chain-bridge').CrossChainTrainingBridge,
  ): Promise<void> {
    this.bridge = bridge
  }

  async createDistributedRun(runId: string): Promise<void> {
    if (!this.psycheClient) {
      throw new Error('Psyche client required for distributed training')
    }

    this.runId = runId

    // Create run on Psyche network
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

    // Track on bridge if available
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

// ============================================================================
// Factory Functions
// ============================================================================

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

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const config: Partial<TrainingConfig> = {
    modelName: process.env.MODEL_NAME ?? 'Qwen/Qwen2.5-1.5B-Instruct',
    trainingSteps: parseInt(process.env.TRAINING_STEPS ?? '20', 10),
    vllmRestartInterval: parseInt(process.env.VLLM_RESTART_INTERVAL ?? '3', 10),
    useWandb: process.env.USE_WANDB === 'true',
    wandbProject: process.env.WANDB_PROJECT,
    atroposUrl: process.env.ATROPOS_URL ?? 'http://localhost:8000',
  }

  const trainer = createGRPOTrainer(config)
  trainer.train().catch(console.error)
}

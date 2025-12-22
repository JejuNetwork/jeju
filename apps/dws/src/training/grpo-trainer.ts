/**
 * GRPO Trainer for Jeju DWS
 * 
 * Group Relative Policy Optimization trainer with Atropos API integration.
 * Coordinates with Python trainer subprocess for real gradient computation.
 * No simulation - all training is done through the Python backend.
 */

import { spawn, type Subprocess } from 'bun';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface TrainingConfig {
  modelName: string;
  learningRate: number;
  trainingSteps: number;
  batchSize: number;
  seqLen: number;
  gradientAccumulationSteps: number;
  device: 'cuda' | 'cpu';
  savePath: string;
  vllmRestartInterval: number;
  vllmPort: number;
  useWandb: boolean;
  wandbProject?: string;
  wandbGroup?: string;
  atroposUrl: string;
  groupSize: number;
}

export interface BatchData {
  tokens: number[][];
  masks: number[][];
  scores: number[];
  advantages?: number[][] | null;
  overrides?: Array<Record<string, string | number | boolean>> | null;
  generation_params?: Record<string, string | number | boolean> | null;
  group_overrides?: Record<string, string | number | boolean> | null;
}

export interface TrainingMetrics {
  loss: number;
  policyLoss: number;
  entropy: number;
  gradNorm: number;
  posLogProb: number;
  negLogProb: number;
  learningRate: number;
  step: number;
}

export interface TrainerStatus {
  running: boolean;
  currentStep: number;
  totalSteps: number;
  lastMetrics: TrainingMetrics | null;
  checkpointPath: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: TrainingConfig = {
  modelName: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
  learningRate: 5e-6,
  trainingSteps: 20,
  batchSize: 1,
  seqLen: 512,
  gradientAccumulationSteps: 4,
  device: 'cuda',
  savePath: './training_checkpoints',
  vllmRestartInterval: 10,
  vllmPort: 9001,
  useWandb: false,
  atroposUrl: 'http://localhost:8000',
  groupSize: 8,
};

// ============================================================================
// GRPO Trainer - Python Backend Integration
// ============================================================================

export class GRPOTrainer {
  private config: TrainingConfig;
  private pythonProcess: Subprocess | null = null;
  private status: TrainerStatus = {
    running: false,
    currentStep: 0,
    totalSteps: 0,
    lastMetrics: null,
    checkpointPath: null,
  };
  private metricsBuffer: TrainingMetrics[] = [];
  private onMetrics?: (metrics: TrainingMetrics) => void;
  private onComplete?: (checkpointPath: string) => void;

  constructor(config: Partial<TrainingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status.totalSteps = this.config.trainingSteps;
  }

  getStatus(): TrainerStatus {
    return { ...this.status };
  }

  getConfig(): TrainingConfig {
    return { ...this.config };
  }

  onTrainingMetrics(callback: (metrics: TrainingMetrics) => void): void {
    this.onMetrics = callback;
  }

  onTrainingComplete(callback: (checkpointPath: string) => void): void {
    this.onComplete = callback;
  }

  async registerWithAtropos(): Promise<void> {
    const response = await fetch(`${this.config.atroposUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: this.config.wandbGroup ?? 'jeju-grpo',
        wandb_project: this.config.wandbProject ?? 'jeju-training',
        batch_size: this.config.batchSize * this.config.gradientAccumulationSteps,
        max_token_len: this.config.seqLen,
        starting_step: 0,
        checkpoint_dir: this.config.savePath,
        save_checkpoint_interval: this.config.vllmRestartInterval,
        num_steps: this.config.trainingSteps,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register with Atropos: ${response.status}`);
    }

    console.log('[GRPO] Registered with Atropos');
  }

  async getBatch(): Promise<{ batch: BatchData[] } | null> {
    const response = await fetch(`${this.config.atroposUrl}/batch`);
    if (!response.ok) {
      throw new Error(`Failed to get batch: ${response.status}`);
    }

    const data = await response.json() as { batch: BatchData[] | null };
    if (!data.batch) {
      return null;
    }

    return { batch: data.batch };
  }

  /**
   * Start the Python GRPO trainer subprocess
   * This runs actual PyTorch training with real gradients
   */
  async startTraining(): Promise<void> {
    if (this.pythonProcess) {
      throw new Error('Training already in progress');
    }

    this.status.running = true;
    this.status.currentStep = 0;

    const scriptPath = join(import.meta.dir, 'grpo_train.py');

    console.log(`[GRPO] Starting Python trainer: ${scriptPath}`);
    console.log(`[GRPO] Model: ${this.config.modelName}`);
    console.log(`[GRPO] Steps: ${this.config.trainingSteps}`);
    console.log(`[GRPO] Atropos: ${this.config.atroposUrl}`);

    this.pythonProcess = spawn([
      'python',
      scriptPath,
      '--model', this.config.modelName,
      '--steps', String(this.config.trainingSteps),
      '--lr', String(this.config.learningRate),
      '--batch-size', String(this.config.batchSize),
      '--save-path', this.config.savePath,
      '--atropos-url', this.config.atroposUrl,
      '--vllm-port', String(this.config.vllmPort),
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: import.meta.dir,
    });

    // Stream stdout and parse metrics
    this.streamOutput(this.pythonProcess);

    // Wait for process to complete
    const exitCode = await this.pythonProcess.exited;
    
    this.status.running = false;
    this.pythonProcess = null;

    if (exitCode === 0) {
      const checkpointPath = `${this.config.savePath}/step_${this.config.trainingSteps}`;
      this.status.checkpointPath = checkpointPath;
      console.log(`[GRPO] Training complete. Checkpoint: ${checkpointPath}`);
      this.onComplete?.(checkpointPath);
    } else {
      throw new Error(`Python trainer exited with code ${exitCode}`);
    }
  }

  private async streamOutput(process: Subprocess): Promise<void> {
    const stdout = process.stdout;
    const stderr = process.stderr;

    if (stdout && typeof stdout !== 'number') {
      const reader = stdout.getReader();
      const decoder = new TextDecoder();
      
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value);
          console.log(text);
          
          // Parse metrics from output
          this.parseMetrics(text);
        }
      })();
    }

    if (stderr && typeof stderr !== 'number') {
      const reader = stderr.getReader();
      const decoder = new TextDecoder();
      
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          console.error(decoder.decode(value));
        }
      })();
    }
  }

  private parseMetrics(output: string): void {
    // Parse step number
    const stepMatch = output.match(/--- Step (\d+)\/(\d+) ---/);
    if (stepMatch) {
      this.status.currentStep = parseInt(stepMatch[1], 10);
    }

    // Parse loss metrics
    const lossMatch = output.match(/\[GRPO\] Loss: ([\d.-]+)/);
    const gradMatch = output.match(/Grad Norm: ([\d.]+)/);
    const posLogPMatch = output.match(/Pos LogP: ([\d.-]+)/);
    const negLogPMatch = output.match(/Neg LogP: ([\d.-]+)/);

    if (lossMatch) {
      const metrics: TrainingMetrics = {
        loss: parseFloat(lossMatch[1]),
        policyLoss: parseFloat(lossMatch[1]),
        entropy: 0,
        gradNorm: gradMatch ? parseFloat(gradMatch[1]) : 0,
        posLogProb: posLogPMatch ? parseFloat(posLogPMatch[1]) : 0,
        negLogProb: negLogPMatch ? parseFloat(negLogPMatch[1]) : 0,
        learningRate: this.config.learningRate,
        step: this.status.currentStep,
      };

      this.status.lastMetrics = metrics;
      this.metricsBuffer.push(metrics);
      this.onMetrics?.(metrics);
    }
  }

  async stopTraining(): Promise<void> {
    if (this.pythonProcess) {
      console.log('[GRPO] Stopping training...');
      this.pythonProcess.kill();
      await this.pythonProcess.exited;
      this.pythonProcess = null;
      this.status.running = false;
    }
  }

  getMetricsHistory(): TrainingMetrics[] {
    return [...this.metricsBuffer];
  }

  async getCheckpoint(): Promise<string | null> {
    return this.status.checkpointPath;
  }
}

// ============================================================================
// Distributed GRPO Trainer with Psyche Integration
// ============================================================================

export class DistributedGRPOTrainer extends GRPOTrainer {
  private psycheClient: import('./psyche-client').PsycheClient | null = null;
  private bridge: import('./cross-chain-bridge').CrossChainTrainingBridge | null = null;
  private runId: string | null = null;

  async setPsycheClient(
    client: import('./psyche-client').PsycheClient
  ): Promise<void> {
    this.psycheClient = client;
  }

  async setBridge(
    bridge: import('./cross-chain-bridge').CrossChainTrainingBridge
  ): Promise<void> {
    this.bridge = bridge;
  }

  async createDistributedRun(runId: string): Promise<void> {
    if (!this.psycheClient) {
      throw new Error('Psyche client required for distributed training');
    }

    this.runId = runId;
    const config = this.getConfig();

    // Create run on Psyche network
    await this.psycheClient.createRun(
      runId,
      {
        name: `GRPO Training ${runId}`,
        description: 'Distributed GRPO training run via Jeju DWS',
        modelHubRepo: `jeju/${config.modelName.split('/').pop()}`,
        datasetHubRepo: 'jeju/training-data',
      },
      {
        maxClients: 32,
        minClients: 1,
        epochLengthMs: 60000,
        warmupEpochs: 1,
        checkpointIntervalEpochs: 5,
        learningRate: config.learningRate,
        batchSize: config.batchSize,
        gradientAccumulationSteps: config.gradientAccumulationSteps,
        maxSeqLength: config.seqLen,
      },
      {
        hubRepo: `jeju/${config.modelName.split('/').pop()}`,
        revision: 'main',
        sha256: '',
      }
    );

    console.log(`[DistributedGRPO] Created run ${runId} on Psyche network`);

    // Track on bridge if available
    if (this.bridge) {
      await this.bridge.trackRun(runId);
    }

    // Set up metrics callback to report progress
    this.onTrainingMetrics(async () => {
      await this.reportProgress();
    });
  }

  private async reportProgress(): Promise<void> {
    if (!this.bridge || !this.runId || !this.psycheClient) {
      return;
    }

    const solanaState = await this.psycheClient.getRunState(this.runId);
    if (solanaState) {
      await this.bridge.bridgeProgress(this.runId, solanaState);
    }
  }

  async submitCheckpointToBridge(
    epoch: number,
    checkpointCid: string,
    merkleRoot: string
  ): Promise<void> {
    if (!this.bridge || !this.runId) {
      return;
    }

    await this.bridge.submitCheckpoint(this.runId, {
      cid: checkpointCid,
      epoch,
      merkleRoot: `0x${merkleRoot.padEnd(64, '0')}` as `0x${string}`,
      modelHash: `0x${'0'.repeat(64)}` as `0x${string}`,
    });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createGRPOTrainer(config?: Partial<TrainingConfig>): GRPOTrainer {
  return new GRPOTrainer(config);
}

export function createDistributedGRPOTrainer(
  config?: Partial<TrainingConfig>
): DistributedGRPOTrainer {
  return new DistributedGRPOTrainer(config);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const config: Partial<TrainingConfig> = {
    modelName: process.env.MODEL_NAME ?? 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    trainingSteps: parseInt(process.env.TRAINING_STEPS ?? '20', 10),
    vllmRestartInterval: parseInt(process.env.VLLM_RESTART_INTERVAL ?? '10', 10),
    useWandb: process.env.USE_WANDB === 'true',
    wandbProject: process.env.WANDB_PROJECT,
    atroposUrl: process.env.ATROPOS_URL ?? 'http://localhost:8000',
  };

  const trainer = createGRPOTrainer(config);
  
  trainer.onTrainingMetrics((metrics) => {
    console.log(`Step ${metrics.step}: loss=${metrics.loss.toFixed(4)}`);
  });

  trainer.onTrainingComplete((path) => {
    console.log(`Training complete. Model saved to: ${path}`);
  });

  await trainer.registerWithAtropos();
  await trainer.startTraining();
}

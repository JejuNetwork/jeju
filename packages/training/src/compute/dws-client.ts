/**
 * Jeju DWS Training Client
 *
 * Connects training to Jeju's DWS distributed training infrastructure.
 * Provides a unified interface for submitting training jobs, tracking progress,
 * and integrating with the decentralized training network.
 */

import type { Address, Hex } from 'viem';
import type {
  TrainingJobRequest,
  TrainingJobResult,
  TrainingJobStatus,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface DWSClientConfig {
  /** DWS Training API endpoint */
  dwsApiUrl: string;
  /** Atropos server endpoint (optional, will be started on-demand) */
  atroposUrl?: string;
  /** Solana RPC for Psyche integration */
  solanaRpcUrl?: string;
  /** EVM RPC for cross-chain bridge */
  evmRpcUrl?: string;
  /** EVM private key for signing */
  evmPrivateKey?: Hex;
  /** Bridge contract address */
  bridgeAddress?: Address;
  /** LLM judge endpoint for rollout scoring */
  llmJudgeUrl?: string;
  /** Model to use for LLM-as-judge */
  llmJudgeModel?: string;
  /** Polling interval for job status checks */
  pollingIntervalMs?: number;
}

export interface RolloutData {
  trajectoryId: string;
  steps: Array<{
    observation: Record<string, unknown>;
    action: { type: string; parameters: Record<string, unknown> };
    reward: number;
    done: boolean;
  }>;
  totalReward: number;
  metadata: Record<string, unknown>;
}

export interface JudgeResult {
  trajectoryId: string;
  score: number;
  reasoning: string;
  confidence: number;
}

export interface DWSJobStatus {
  jobId: string;
  status: TrainingJobStatus;
  progress: {
    step: number;
    totalSteps: number;
    epoch: number;
  };
  metrics?: {
    loss: number;
    learningRate: number;
    gradientNorm: number;
  };
  allocations: Array<{
    nodeId: string;
    gpuType: string;
    status: string;
  }>;
}

// ============================================================================
// DWS Client
// ============================================================================

export class DWSTrainingClient {
  private config: DWSClientConfig;
  private activeJobs: Map<string, DWSJobStatus> = new Map();
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: DWSClientConfig) {
    this.config = {
      pollingIntervalMs: 5000,
      ...config,
    };
  }

  async submitTrainingJob(request: TrainingJobRequest): Promise<string> {
    console.log('[DWS] Submitting training job', {
      batchId: request.batchId,
      baseModel: request.baseModel,
    });

    const response = await fetch(`${this.config.dwsApiUrl}/training/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environmentId: 'jeju-training',
        modelCid: request.baseModel,
        datasetCid: request.datasetCID,
        config: {
          epochs: Math.ceil(request.trainingSteps / 100),
          batchSize: request.batchSize,
          learningRate: request.learningRate,
          maxSeqLength: 2048,
          gradientAccumulationSteps: 4,
        },
        priority: 'normal',
        nodeCount: 1,
        gpuType: 'NVIDIA RTX 5090',
        memoryGb: 16,
        callbackUrl: request.callbackUrl,
        metadata: {
          archetype: request.archetype,
          rubricHash: request.rubricHash,
          batchId: request.batchId,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DWS job submission failed: ${error}`);
    }

    const result = (await response.json()) as { jobId: string };

    this.startPolling(result.jobId);

    console.log('[DWS] Training job submitted', { jobId: result.jobId });
    return result.jobId;
  }

  async getJobStatus(jobId: string): Promise<DWSJobStatus | null> {
    const response = await fetch(
      `${this.config.dwsApiUrl}/training/jobs/${jobId}`
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to get job status: ${response.statusText}`);
    }

    const status = (await response.json()) as DWSJobStatus;
    this.activeJobs.set(jobId, status);
    return status;
  }

  async getJobAllocations(
    jobId: string
  ): Promise<Array<{ nodeId: string; gpuType: string; status: string }>> {
    const response = await fetch(
      `${this.config.dwsApiUrl}/training/jobs/${jobId}/allocations`
    );

    if (!response.ok) {
      return [];
    }

    const result = (await response.json()) as {
      allocations: Array<{ nodeId: string; gpuType: string; status: string }>;
    };
    return result.allocations;
  }

  async waitForJob(
    jobId: string,
    timeoutMs = 3600000
  ): Promise<TrainingJobResult> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const status = await this.getJobStatus(jobId);

      if (status?.status === 'completed') {
        this.stopPolling(jobId);
        return {
          jobId,
          status: 'completed',
          durationSeconds: Math.floor((Date.now() - start) / 1000),
        };
      }

      if (status?.status === 'failed') {
        this.stopPolling(jobId);
        return {
          jobId,
          status: 'failed',
          error: 'Training job failed',
          durationSeconds: Math.floor((Date.now() - start) / 1000),
        };
      }

      await new Promise((r) => setTimeout(r, this.config.pollingIntervalMs));
    }

    return {
      jobId,
      status: 'failed',
      error: 'Timeout waiting for job completion',
      durationSeconds: Math.floor((Date.now() - start) / 1000),
    };
  }

  async judgeRollouts(rollouts: RolloutData[]): Promise<JudgeResult[]> {
    const bundles = rollouts.map((r) => ({
      runId: r.trajectoryId,
      epoch: 0,
      rollouts: [
        {
          trajectoryId: r.trajectoryId,
          agentId: (r.metadata.agentId as string) ?? 'jeju-agent',
          steps: r.steps,
          totalReward: r.totalReward,
          environment: 'jeju-training',
        },
      ],
    }));

    const response = await fetch(`${this.config.dwsApiUrl}/training/judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundles }),
    });

    if (!response.ok) {
      throw new Error(`LLM judging failed: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      results: Array<{
        bundleId: string;
        score: number;
        reasoning: string;
        confidence: number;
      }>;
    };

    return result.results.map((r, i) => {
      const rollout = rollouts[i];
      if (!rollout) {
        throw new Error(`Missing rollout at index ${i}`);
      }
      return {
        trajectoryId: rollout.trajectoryId,
        score: r.score,
        reasoning: r.reasoning,
        confidence: r.confidence,
      };
    });
  }

  async startAtroposServer(
    jobId: string,
    port?: number
  ): Promise<{ url: string; port: number }> {
    const response = await fetch(
      `${this.config.dwsApiUrl}/training/jobs/${jobId}/atropos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to start Atropos server: ${response.statusText}`);
    }

    return response.json() as Promise<{ url: string; port: number }>;
  }

  async computeMerkleRoot(
    rewards: Array<{ client: Address; amount: bigint }>
  ): Promise<string> {
    const response = await fetch(
      `${this.config.dwsApiUrl}/training/bridge/merkle/root`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewards: rewards.map((r) => ({
            client: r.client,
            amount: r.amount.toString(),
          })),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to compute Merkle root: ${response.statusText}`);
    }

    const result = (await response.json()) as { root: string };
    return result.root;
  }

  async generateMerkleProof(
    rewards: Array<{ client: Address; amount: bigint }>,
    index: number
  ): Promise<string[]> {
    const response = await fetch(
      `${this.config.dwsApiUrl}/training/bridge/merkle/proof`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewards: rewards.map((r) => ({
            client: r.client,
            amount: r.amount.toString(),
          })),
          index,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to generate Merkle proof: ${response.statusText}`
      );
    }

    const result = (await response.json()) as { proof: string[] };
    return result.proof;
  }

  async listJobs(): Promise<DWSJobStatus[]> {
    const response = await fetch(`${this.config.dwsApiUrl}/training/jobs`);

    if (!response.ok) {
      return [];
    }

    const result = (await response.json()) as { jobs: DWSJobStatus[] };
    return result.jobs;
  }

  async cancelJob(jobId: string): Promise<void> {
    const response = await fetch(
      `${this.config.dwsApiUrl}/training/jobs/${jobId}/cancel`,
      {
        method: 'POST',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to cancel job: ${response.statusText}`);
    }

    this.stopPolling(jobId);
    this.activeJobs.delete(jobId);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private startPolling(jobId: string): void {
    if (this.pollingIntervals.has(jobId)) return;

    const interval = setInterval(async () => {
      const status = await this.getJobStatus(jobId);

      if (status?.status === 'completed' || status?.status === 'failed') {
        this.stopPolling(jobId);
      }
    }, this.config.pollingIntervalMs);

    this.pollingIntervals.set(jobId, interval);
  }

  private stopPolling(jobId: string): void {
    const interval = this.pollingIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(jobId);
    }
  }

  cleanup(): void {
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
    this.activeJobs.clear();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createDWSClient(config: DWSClientConfig): DWSTrainingClient {
  return new DWSTrainingClient(config);
}

export function isDWSAvailable(): boolean {
  return !!process.env.DWS_API_URL;
}

export function getDefaultDWSConfig(): DWSClientConfig {
  return {
    dwsApiUrl: process.env.DWS_API_URL ?? 'http://localhost:4030',
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    evmRpcUrl: process.env.EVM_RPC_URL ?? 'http://localhost:6546',
    evmPrivateKey: process.env.EVM_PRIVATE_KEY as Hex | undefined,
    bridgeAddress: process.env.BRIDGE_ADDRESS as Address | undefined,
    llmJudgeUrl: process.env.LLM_JUDGE_URL,
    llmJudgeModel: process.env.LLM_JUDGE_MODEL,
    pollingIntervalMs: 5000,
  };
}


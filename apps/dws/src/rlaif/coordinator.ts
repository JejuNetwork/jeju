/**
 * RLAIF Coordinator for Jeju DWS
 *
 * Orchestrates the complete RLAIF training loop:
 * 1. Collect rollouts from environment
 * 2. Score trajectories with LLM judge (RULER)
 * 3. Train policy with RL algorithm (GRPO/PPO)
 * 4. Evaluate and gate promotion
 *
 * Integrates with:
 * - Jeju Compute Marketplace for GPU jobs
 * - Jeju Storage for CID-first artifacts
 * - On-chain TrainingCoordinator for state management
 * - Optional Psyche for distributed training
 */

import { createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import {
  RLRunState,
  type ComputeJobResult,
  type EvaluationJobConfig,
  type JudgingJobConfig,
  type RLAIFIteration,
  type RLAIFRun,
  type RLAIFRunConfig,
  type RolloutJobConfig,
  type TrainingJobConfig,
} from './types';
import { TrajectoryStore } from './trajectory-store';
import { RulerScorer } from './ruler-scorer';

const RLAIF_COORDINATOR_ABI = [
  {
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'environmentId', type: 'string' },
      { name: 'policyModelCID', type: 'string' },
      { name: 'targetIterations', type: 'uint32' },
    ],
    name: 'createRun',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'runId', type: 'bytes32' }],
    name: 'getRunState',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'manifestCID', type: 'string' },
      { name: 'count', type: 'uint32' },
    ],
    name: 'submitRollouts',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'rewardsCID', type: 'string' },
    ],
    name: 'submitJudgingResults',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'newPolicyCID', type: 'string' },
      { name: 'metricsCID', type: 'string' },
    ],
    name: 'submitTrainingResult',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'evalCID', type: 'string' },
      { name: 'passed', type: 'bool' },
      { name: 'score', type: 'uint256' },
    ],
    name: 'submitEvaluation',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'runId', type: 'bytes32' }],
    name: 'getCurrentIteration',
    outputs: [{ name: '', type: 'uint32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface RLAIFCoordinatorConfig {
  rpcUrl: string;
  privateKey?: Hex;
  coordinatorAddress: Address;
  computeApiUrl: string;
  storageApiUrl: string;
  psycheEnabled?: boolean;
  psycheRpcUrl?: string;
  /** Phala TEE configuration for secure training */
  phalaTeeEnabled?: boolean;
  phalaEndpoint?: string;
  phalaApiKey?: string;
}

export class RLAIFCoordinator {
  private walletClient;
  private account;
  private config: RLAIFCoordinatorConfig;
  private trajectoryStore: TrajectoryStore;
  private rulerScorer: RulerScorer;
  private activeRuns: Map<string, RLAIFRun> = new Map();

  constructor(config: RLAIFCoordinatorConfig) {
    this.config = config;
    
    const chain = foundry;

    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey);
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(config.rpcUrl),
      });
    }

    this.trajectoryStore = new TrajectoryStore({
      storageApiUrl: config.storageApiUrl,
    });

    this.rulerScorer = new RulerScorer({
      computeApiUrl: config.computeApiUrl,
    });
  }

  async createRun(runConfig: RLAIFRunConfig): Promise<string> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet client required to create runs');
    }

    const runIdBytes = this.generateRunId(runConfig);

    await this.walletClient.writeContract({
      address: this.config.coordinatorAddress,
      abi: RLAIF_COORDINATOR_ABI,
      functionName: 'createRun',
      args: [
        runIdBytes,
        runConfig.environment.id,
        runConfig.model.baseModelCID,
        runConfig.targetIterations,
      ],
    });

    const run: RLAIFRun = {
      config: runConfig,
      state: RLRunState.CollectingRollouts,
      currentIteration: 0,
      iterations: [],
      currentPolicyCID: runConfig.model.baseModelCID,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.activeRuns.set(runConfig.runId, run);
    return runConfig.runId;
  }

  async runIteration(runId: string): Promise<RLAIFIteration> {
    const run = this.activeRuns.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    const iteration: RLAIFIteration = {
      iteration: run.currentIteration + 1,
      state: RLRunState.CollectingRollouts,
      trajectoryManifestCID: '',
      trajectoryCount: 0,
      startedAt: Date.now(),
    };

    console.log(`[RLAIF] Starting iteration ${iteration.iteration} for run ${runId}`);

    // Phase 1: Collect rollouts
    iteration.state = RLRunState.CollectingRollouts;
    const rolloutResult = await this.collectRollouts({
      runId,
      iteration: iteration.iteration,
      policyModelCID: run.currentPolicyCID,
      environmentConfigCID: run.config.environment.configCID,
      numEpisodes: run.config.minTrajectoriesPerIteration,
      maxStepsPerEpisode: 100,
    });

    iteration.trajectoryManifestCID = rolloutResult.outputCID ?? '';
    iteration.trajectoryCount = rolloutResult.metrics?.trajectoryCount ?? 0;

    // Phase 2: Score with LLM judge
    iteration.state = RLRunState.Judging;
    const judgingResult = await this.scoreTrajectories({
      runId,
      iteration: iteration.iteration,
      trajectoryManifestCID: iteration.trajectoryManifestCID,
      judgeModelCID: run.config.judge.modelCID,
      rubric: {
        id: run.config.judge.rubricId,
        name: 'Default',
        description: 'RULER scoring',
        criteria: '',
        priorityMetrics: [],
      },
      groupSize: 4,
    });

    iteration.rewardsManifestCID = judgingResult.outputCID;

    // Phase 3: Train policy
    iteration.state = RLRunState.Training;
    const trainingResult = await this.trainPolicy({
      runId,
      iteration: iteration.iteration,
      trajectoryManifestCID: iteration.trajectoryManifestCID,
      rewardsManifestCID: iteration.rewardsManifestCID ?? '',
      policyModelCID: run.currentPolicyCID,
      referenceModelCID: run.config.model.referenceModelCID ?? run.config.model.baseModelCID,
      rlConfig: run.config.rl,
      outputPath: `/models/${runId}/iteration-${iteration.iteration}`,
    });

    iteration.trainingJobId = trainingResult.jobId;
    iteration.updatedPolicyCID = trainingResult.outputCID;
    iteration.metrics = {
      averageReward: trainingResult.metrics?.averageReward ?? 0,
      averageEpisodeLength: trainingResult.metrics?.averageEpisodeLength ?? 0,
      policyLoss: trainingResult.metrics?.policyLoss ?? 0,
      klDivergence: trainingResult.metrics?.klDivergence ?? 0,
      gradNorm: trainingResult.metrics?.gradNorm ?? 0,
    };

    // Phase 4: Evaluate
    iteration.state = RLRunState.Evaluating;
    const evalResult = await this.evaluatePolicy({
      runId,
      iteration: iteration.iteration,
      policyModelCID: iteration.updatedPolicyCID ?? '',
      evaluationSuiteCID: run.config.evaluation.suiteId,
      baselineModelCID: run.currentPolicyCID,
    });

    iteration.evalResultsCID = evalResult.outputCID;
    iteration.evalPassed = (evalResult.metrics?.evalScore ?? 0) >= run.config.evaluation.minScore;
    iteration.metrics.evalScore = evalResult.metrics?.evalScore;

    // Phase 5: Promote if passed
    if (iteration.evalPassed && iteration.updatedPolicyCID) {
      iteration.state = RLRunState.Promoting;
      run.currentPolicyCID = iteration.updatedPolicyCID;
      
      if (!run.bestEvalScore || (iteration.metrics.evalScore ?? 0) > run.bestEvalScore) {
        run.bestPolicyCID = iteration.updatedPolicyCID;
        run.bestEvalScore = iteration.metrics.evalScore;
      }

      await this.recordIterationOnChain(runId, iteration);
    }

    iteration.completedAt = Date.now();
    run.iterations.push(iteration);
    run.currentIteration = iteration.iteration;
    run.updatedAt = Date.now();

    console.log(`[RLAIF] Iteration ${iteration.iteration} complete`, {
      evalScore: iteration.metrics?.evalScore,
      promoted: iteration.evalPassed,
    });

    return iteration;
  }

  private async collectRollouts(config: RolloutJobConfig): Promise<ComputeJobResult> {
    console.log(`[RLAIF] Collecting rollouts for iteration ${config.iteration}`);

    const response = await fetch(`${this.config.computeApiUrl}/jobs/rollout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policyModelCID: config.policyModelCID,
        environmentConfigCID: config.environmentConfigCID,
        numEpisodes: config.numEpisodes,
        maxStepsPerEpisode: config.maxStepsPerEpisode,
        seed: config.seed,
      }),
    });

    if (!response.ok) {
      throw new Error(`Rollout job failed: ${response.status}`);
    }

    const result = (await response.json()) as ComputeJobResult;
    return this.waitForJob(result.jobId);
  }

  private async scoreTrajectories(config: JudgingJobConfig): Promise<ComputeJobResult> {
    console.log(`[RLAIF] Scoring trajectories for iteration ${config.iteration}`);

    const scores = await this.rulerScorer.scoreManifest(
      config.trajectoryManifestCID,
      config.rubric,
      config.groupSize
    );

    const rewardsCID = await this.trajectoryStore.storeRewards(scores);

    return {
      jobId: `judging-${config.iteration}`,
      status: 'completed',
      outputCID: rewardsCID,
      metrics: {
        averageScore: scores.reduce((sum, s) => sum + s.score, 0) / scores.length,
        trajectoryCount: scores.length,
      },
    };
  }

  private async trainPolicy(config: TrainingJobConfig): Promise<ComputeJobResult> {
    console.log(`[RLAIF] Training policy for iteration ${config.iteration}`);

    // Use Phala TEE if enabled (for secure GPU training on remote infrastructure)
    if (this.config.phalaTeeEnabled && this.config.phalaEndpoint) {
      return this.trainWithPhalaTee(config);
    }

    const response = await fetch(`${this.config.computeApiUrl}/jobs/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trajectoryManifestCID: config.trajectoryManifestCID,
        rewardsManifestCID: config.rewardsManifestCID,
        policyModelCID: config.policyModelCID,
        referenceModelCID: config.referenceModelCID,
        algorithm: config.rlConfig.algorithm,
        learningRate: config.rlConfig.learningRate,
        batchSize: config.rlConfig.batchSize,
        epochs: config.rlConfig.epochs,
        klCoefficient: config.rlConfig.klCoefficient,
        outputPath: config.outputPath,
      }),
    });

    if (!response.ok) {
      throw new Error(`Training job failed: ${response.status}`);
    }

    const result = (await response.json()) as ComputeJobResult;
    return this.waitForJob(result.jobId);
  }

  /**
   * Train policy using Phala TEE for secure remote execution
   */
  private async trainWithPhalaTee(config: TrainingJobConfig): Promise<ComputeJobResult> {
    console.log(`[RLAIF] Training with Phala TEE for iteration ${config.iteration}`);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.phalaApiKey) {
      headers['X-API-Key'] = this.config.phalaApiKey;
    }

    // Submit training job to Phala TEE endpoint
    const response = await fetch(`${this.config.phalaEndpoint}/training/submit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'GRPO_TRAINING',
        input: {
          trajectoryManifestCID: config.trajectoryManifestCID,
          rewardsManifestCID: config.rewardsManifestCID,
          policyModelCID: config.policyModelCID,
          referenceModelCID: config.referenceModelCID,
        },
        config: {
          algorithm: config.rlConfig.algorithm,
          learningRate: config.rlConfig.learningRate,
          batchSize: config.rlConfig.batchSize,
          epochs: config.rlConfig.epochs,
          klCoefficient: config.rlConfig.klCoefficient,
        },
        attestation: {
          required: true,
          minMeasurement: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Phala TEE training job failed: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as { jobId: string; enclaveId: string };
    console.log(`[RLAIF] Phala TEE job submitted: ${result.jobId}, enclave: ${result.enclaveId}`);

    // Poll for completion
    return this.waitForPhalaJob(result.jobId);
  }

  private async waitForPhalaJob(jobId: string, timeoutMs = 7200000): Promise<ComputeJobResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const headers: Record<string, string> = {};
      if (this.config.phalaApiKey) {
        headers['X-API-Key'] = this.config.phalaApiKey;
      }

      const response = await fetch(`${this.config.phalaEndpoint}/training/status/${jobId}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error(`Failed to get Phala job status: ${response.status}`);
      }

      const status = (await response.json()) as {
        status: 'pending' | 'running' | 'completed' | 'failed';
        outputCID?: string;
        attestation?: {
          quote: string;
          mrEnclave: string;
          timestamp: number;
        };
        metrics?: Record<string, number>;
        error?: string;
      };

      if (status.status === 'completed') {
        console.log(`[RLAIF] Phala TEE job completed with attestation: ${status.attestation?.mrEnclave}`);
        return {
          jobId,
          status: 'completed',
          outputCID: status.outputCID,
          metrics: status.metrics,
        };
      }

      if (status.status === 'failed') {
        return {
          jobId,
          status: 'failed',
          error: status.error ?? 'Phala TEE job failed',
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10s
    }

    throw new Error(`Phala TEE job ${jobId} timed out after ${timeoutMs}ms`);
  }

  private async evaluatePolicy(config: EvaluationJobConfig): Promise<ComputeJobResult> {
    console.log(`[RLAIF] Evaluating policy for iteration ${config.iteration}`);

    const response = await fetch(`${this.config.computeApiUrl}/jobs/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policyModelCID: config.policyModelCID,
        evaluationSuiteCID: config.evaluationSuiteCID,
        baselineModelCID: config.baselineModelCID,
      }),
    });

    if (!response.ok) {
      throw new Error(`Evaluation job failed: ${response.status}`);
    }

    const result = (await response.json()) as ComputeJobResult;
    return this.waitForJob(result.jobId);
  }

  private async waitForJob(jobId: string, timeoutMs = 3600000): Promise<ComputeJobResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${this.config.computeApiUrl}/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error(`Failed to get job status: ${response.status}`);
      }

      const result = (await response.json()) as ComputeJobResult;

      if (result.status === 'completed' || result.status === 'failed') {
        return result;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error(`Job ${jobId} timed out`);
  }

  private async recordIterationOnChain(runId: string, iteration: RLAIFIteration): Promise<void> {
    if (!this.walletClient) return;

    const runIdBytes = `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex;

    if (iteration.trajectoryManifestCID) {
      await this.walletClient.writeContract({
        address: this.config.coordinatorAddress,
        abi: RLAIF_COORDINATOR_ABI,
        functionName: 'submitRollouts',
        args: [runIdBytes, iteration.trajectoryManifestCID, iteration.trajectoryCount],
      });
    }

    if (iteration.rewardsManifestCID) {
      await this.walletClient.writeContract({
        address: this.config.coordinatorAddress,
        abi: RLAIF_COORDINATOR_ABI,
        functionName: 'submitJudgingResults',
        args: [runIdBytes, iteration.rewardsManifestCID],
      });
    }

    if (iteration.updatedPolicyCID) {
      await this.walletClient.writeContract({
        address: this.config.coordinatorAddress,
        abi: RLAIF_COORDINATOR_ABI,
        functionName: 'submitTrainingResult',
        args: [runIdBytes, iteration.updatedPolicyCID, iteration.evalResultsCID ?? ''],
      });
    }

    if (iteration.evalResultsCID !== undefined) {
      const scoreScaled = BigInt(Math.floor((iteration.metrics?.evalScore ?? 0) * 1e18));
      await this.walletClient.writeContract({
        address: this.config.coordinatorAddress,
        abi: RLAIF_COORDINATOR_ABI,
        functionName: 'submitEvaluation',
        args: [runIdBytes, iteration.evalResultsCID ?? '', iteration.evalPassed ?? false, scoreScaled],
      });
    }
  }

  async runContinuousTraining(
    runId: string,
    options: { maxIterations?: number; stopOnFailure?: boolean } = {}
  ): Promise<RLAIFRun> {
    const run = this.activeRuns.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    const maxIterations = options.maxIterations ?? run.config.targetIterations;

    while (run.currentIteration < maxIterations) {
      const iteration = await this.runIteration(runId);

      if (!iteration.evalPassed && options.stopOnFailure) {
        console.log(`[RLAIF] Stopping: iteration ${iteration.iteration} failed evaluation`);
        break;
      }

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    run.state = RLRunState.Finished;
    return run;
  }

  getRun(runId: string): RLAIFRun | undefined {
    return this.activeRuns.get(runId);
  }

  private generateRunId(config: RLAIFRunConfig): Hex {
    const data = `${config.environment.id}:${config.model.baseModelCID}:${Date.now()}`;
    const hash = Buffer.from(data).toString('hex').slice(0, 64).padEnd(64, '0');
    return `0x${hash}` as Hex;
  }
}

export function createRLAIFCoordinator(config: RLAIFCoordinatorConfig): RLAIFCoordinator {
  // Auto-enable Phala TEE from environment
  const enhancedConfig: RLAIFCoordinatorConfig = {
    ...config,
    phalaTeeEnabled: config.phalaTeeEnabled ?? process.env.PHALA_ENDPOINT !== undefined,
    phalaEndpoint: config.phalaEndpoint ?? process.env.PHALA_ENDPOINT,
    phalaApiKey: config.phalaApiKey ?? process.env.PHALA_API_KEY,
  };

  return new RLAIFCoordinator(enhancedConfig);
}


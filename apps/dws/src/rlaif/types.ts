/**
 * RLAIF Types for Jeju DWS
 *
 * Generalized types for Reinforcement Learning from AI Feedback.
 * Compatible with Atropos, Psyche, and custom environments.
 */

import type { Address, Hash, Hex } from 'viem';

export enum RLAlgorithm {
  GRPO = 'grpo',
  PPO = 'ppo',
  DPO = 'dpo',
  REINFORCE = 'reinforce',
}

export enum RLRunState {
  Uninitialized = 0,
  CollectingRollouts = 1,
  Judging = 2,
  Training = 3,
  Evaluating = 4,
  Promoting = 5,
  Paused = 6,
  Finished = 7,
}

export interface TrajectoryStep {
  stepNumber: number;
  timestamp: number;
  observation: Record<string, unknown>;
  action: {
    type: string;
    parameters: Record<string, unknown>;
    reasoning?: string;
  };
  reward: number;
  done: boolean;
  logprobs?: number[];
  llmCalls?: LLMCall[];
}

export interface LLMCall {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  response: string;
  reasoning?: string;
  temperature: number;
  latencyMs: number;
  purpose: 'action' | 'reasoning' | 'evaluation' | 'response' | 'other';
}

export interface Trajectory {
  id: string;
  environmentId: string;
  agentId: string;
  policyModelCID: string;
  steps: TrajectoryStep[];
  totalReward: number;
  metadata: {
    startTime: number;
    endTime: number;
    episodeLength: number;
    scenarioId?: string;
    windowId?: string;
    finalPnL?: number;
    archetype?: string;
  };
}

export interface TrajectoryManifest {
  cid: string;
  trajectoryCIDs: string[];
  totalCount: number;
  environmentId: string;
  policyModelCID: string;
  createdAt: number;
  merkleRoot: Hex;
}

export interface JudgeRubric {
  id: string;
  name: string;
  description: string;
  criteria: string;
  priorityMetrics: string[];
}

export interface JudgeScore {
  trajectoryId: string;
  score: number;
  reasoning: string;
  strengths?: string[];
  weaknesses?: string[];
  rubricId: string;
  judgedAt: number;
}

export interface ScoredTrajectoryGroup {
  manifestCID: string;
  scores: JudgeScore[];
  averageScore: number;
  normalizedScores: number[];
}

export interface RLConfig {
  algorithm: RLAlgorithm;
  learningRate: number;
  batchSize: number;
  gradientAccumulationSteps: number;
  maxGradNorm: number;
  klCoefficient: number;
  entropyCoefficient: number;
  valueCoefficient: number;
  gamma: number;
  gaeλ: number;
  epochs: number;
  clipRange: number;
}

export interface ModelConfig {
  baseModelCID: string;
  referenceModelCID?: string;
  tokenizer: string;
  maxSeqLen: number;
  dtype: 'float16' | 'bfloat16' | 'float32';
  quantization?: '4bit' | '8bit' | 'none';
}

export interface EvaluationConfig {
  suiteId: string;
  minScore: number;
  maxRegressionPercent: number;
  requiredMetrics: string[];
}

export interface RLAIFRunConfig {
  runId: string;
  creator: Address;
  environment: {
    id: string;
    type: string;
    configCID: string;
  };
  model: ModelConfig;
  rl: RLConfig;
  judge: {
    modelCID: string;
    rubricId: string;
    temperature: number;
  };
  evaluation: EvaluationConfig;
  targetIterations: number;
  minTrajectoriesPerIteration: number;
  rewardToken?: Address;
  rewardPerIteration?: bigint;
}

export interface RLAIFIteration {
  iteration: number;
  state: RLRunState;
  trajectoryManifestCID: string;
  trajectoryCount: number;
  rewardsManifestCID?: string;
  trainingJobId?: string;
  updatedPolicyCID?: string;
  evalResultsCID?: string;
  evalPassed?: boolean;
  startedAt: number;
  completedAt?: number;
  metrics?: IterationMetrics;
}

export interface IterationMetrics {
  averageReward: number;
  averageEpisodeLength: number;
  policyLoss: number;
  valueLoss?: number;
  klDivergence: number;
  entropyLoss?: number;
  gradNorm: number;
  evalScore?: number;
}

export interface RLAIFRun {
  config: RLAIFRunConfig;
  state: RLRunState;
  currentIteration: number;
  iterations: RLAIFIteration[];
  currentPolicyCID: string;
  bestPolicyCID?: string;
  bestEvalScore?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RolloutJobConfig {
  runId: string;
  iteration: number;
  policyModelCID: string;
  environmentConfigCID: string;
  numEpisodes: number;
  maxStepsPerEpisode: number;
  seed?: number;
}

export interface JudgingJobConfig {
  runId: string;
  iteration: number;
  trajectoryManifestCID: string;
  judgeModelCID: string;
  rubric: JudgeRubric;
  groupSize: number;
}

export interface TrainingJobConfig {
  runId: string;
  iteration: number;
  trajectoryManifestCID: string;
  rewardsManifestCID: string;
  policyModelCID: string;
  referenceModelCID: string;
  rlConfig: RLConfig;
  outputPath: string;
}

export interface EvaluationJobConfig {
  runId: string;
  iteration: number;
  policyModelCID: string;
  evaluationSuiteCID: string;
  baselineModelCID?: string;
}

export interface ComputeJobResult {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  outputCID?: string;
  error?: string;
  durationSeconds?: number;
  metrics?: Record<string, number>;
}

export interface RLEnvironment {
  id: string;
  name: string;
  reset(): Promise<Record<string, unknown>>;
  step(action: unknown): Promise<{
    observation: Record<string, unknown>;
    reward: number;
    done: boolean;
    info: Record<string, unknown>;
  }>;
  getTrajectory(): Trajectory;
  close(): Promise<void>;
}

export interface RLEnvironmentFactory {
  create(config: Record<string, unknown>): Promise<RLEnvironment>;
  getSchema(): Record<string, unknown>;
}


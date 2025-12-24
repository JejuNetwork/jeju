/**
 * Training module Zod schemas
 *
 * Provides validation schemas for Atropos, GRPO, Psyche, and related training APIs.
 */

import { z } from 'zod'
import { addressSchema } from '../validation'

// Atropos Server Schemas

export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  reward: z.number().optional(),
})

export const ScoredDataSchema = z.object({
  tokens: z.array(z.array(z.number())),
  masks: z.array(z.array(z.number())),
  scores: z.array(z.number()),
  advantages: z.array(z.array(z.number())).nullable().optional(),
  ref_logprobs: z.array(z.array(z.number())).nullable().optional(),
  messages: z.array(z.array(MessageSchema)).nullable().optional(),
  generation_params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
  inference_logprobs: z.array(z.array(z.number())).nullable().optional(),
  overrides: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
    .nullable()
    .optional(),
  group_overrides: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
  images: z.array(z.string()).nullable().optional(),
  env_id: z.number().nullable().optional(),
})

export const ScoredDataListSchema = z.array(ScoredDataSchema)

export const RegistrationSchema = z.object({
  run_group: z.string(),
  run_project: z.string(),
  batch_size: z.number().int().positive(),
  max_token_len: z.number().int().positive(),
  checkpoint_dir: z.string(),
  save_checkpoint_interval: z.number().int().positive(),
  starting_step: z.number().int().nonnegative(),
  num_steps: z.number().int().positive(),
})

export const RegisterEnvSchema = z.object({
  max_token_length: z.number().int().positive(),
  desired_name: z.string(),
  weight: z.number().positive(),
  group_size: z.number().int().positive(),
  min_batch_allocation: z.number().nullable().optional(),
})

export const DisconnectEnvSchema = z.object({
  env_id: z.number().int().nonnegative(),
})

// GRPO Trainer Schemas

export const BatchDataSchema = z.object({
  tokens: z.array(z.array(z.number())),
  masks: z.array(z.array(z.number())),
  scores: z.array(z.number()),
  advantages: z.array(z.array(z.number())).nullable().optional(),
  overrides: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
    .nullable()
    .optional(),
  generation_params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
  group_overrides: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
})

export const BatchResponseSchema = z.object({
  batch: z.array(BatchDataSchema).nullable(),
})

// DWS Integration Schemas

export const TrainingJobRequestSchema = z.object({
  runId: z.string(),
  modelName: z.string(),
  trainingSteps: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  learningRate: z.number().positive(),
  nodeCount: z.number().int().positive().optional().default(1),
  gpuType: z.string(),
  memoryGb: z.number().int().positive(),
  priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
  environmentId: z.string().optional(),
  datasetCid: z.string().optional(),
})

export const RolloutBundleSchema = z.object({
  prompt: z.string(),
  response: z.string(),
  score: z.number().optional(),
})

export const JudgeBundlesRequestSchema = z.object({
  bundles: z.array(RolloutBundleSchema),
})

export const AtroposStartRequestSchema = z.object({
  port: z.number().int().positive().optional(),
})

export const MerkleRewardSchema = z.object({
  client: addressSchema,
  amount: z.string(),
})

export const MerkleRootRequestSchema = z.object({
  rewards: z.array(MerkleRewardSchema),
})

export const MerkleProofRequestSchema = z.object({
  rewards: z.array(MerkleRewardSchema),
  index: z.number().int().nonnegative(),
})

// Additional Training Route Schemas

/**
 * Submit training job request (without jobId, auto-generated)
 */
export const SubmitTrainingJobRequestSchema = z.object({
  runId: z.string(),
  modelName: z.string(),
  trainingSteps: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  learningRate: z.number().positive(),
  nodeCount: z.number().int().positive().optional(),
  gpuType: z.string().optional(),
  memoryGb: z.number().int().positive().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  environmentId: z.string().optional(),
  datasetCid: z.string().optional(),
})

/**
 * Start trainer request
 */
export const StartTrainerRequestSchema = z.object({
  modelName: z.string().optional(),
  trainingSteps: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  atroposUrl: z.string().url().optional(),
})

/**
 * Judge bundles request
 */
export const JudgeRequestSchema = z.object({
  bundles: z.array(RolloutBundleSchema),
  llmJudgeUrl: z.string().url().optional(),
  llmJudgeModel: z.string().optional(),
})

/**
 * Psyche run creation request
 */
export const PsycheRunConfigSchema = z.object({
  maxClients: z.number().int().positive(),
  minClients: z.number().int().positive(),
  epochLengthMs: z.number().int().positive(),
  warmupEpochs: z.number().int().nonnegative(),
  checkpointIntervalEpochs: z.number().int().positive(),
  learningRate: z.number().positive(),
  batchSize: z.number().int().positive(),
  gradientAccumulationSteps: z.number().int().positive(),
  maxSeqLength: z.number().int().positive(),
})

export const PsycheRunMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  modelHubRepo: z.string(),
  datasetHubRepo: z.string(),
})

export const PsycheModelSchema = z.object({
  hubRepo: z.string(),
  revision: z.string(),
  sha256: z.string(),
})

export const CreatePsycheRunRequestSchema = z.object({
  runId: z.string(),
  metadata: PsycheRunMetadataSchema,
  config: PsycheRunConfigSchema,
  model: PsycheModelSchema,
})

// Crucible Integration Schemas

export const TrainingMetricsSchema = z.object({
  totalEpisodes: z.number().int().nonnegative().optional(),
  totalSteps: z.number().int().nonnegative().optional(),
  averageReward: z.number().optional(),
  bestReward: z.number().optional(),
  lossHistory: z.array(z.number()).optional(),
  // Also allow snake_case variants from API responses
  total_episodes: z.number().int().nonnegative().optional(),
  total_steps: z.number().int().nonnegative().optional(),
  average_reward: z.number().optional(),
  best_reward: z.number().optional(),
  loss_history: z.array(z.number()).optional(),
})

export const JobStatusSchema = z.object({
  status: z.string(),
  metrics: TrainingMetricsSchema.optional(),
})

export const JobsListResponseSchema = z.object({
  jobs: z.array(JobStatusSchema),
})

// Autocrat Integration Schemas

export const ProposalStatusResponseSchema = z.object({
  status: z.string().optional(),
})

export const AgentRegistrationResponseSchema = z.object({
  agentId: z.string(),
})

// Type exports

export type Message = z.infer<typeof MessageSchema>
export type ScoredData = z.infer<typeof ScoredDataSchema>
export type Registration = z.infer<typeof RegistrationSchema>
export type RegisterEnv = z.infer<typeof RegisterEnvSchema>
export type BatchData = z.infer<typeof BatchDataSchema>
export type BatchResponse = z.infer<typeof BatchResponseSchema>
export type TrainingJobRequest = z.infer<typeof TrainingJobRequestSchema>
export type RolloutBundle = z.infer<typeof RolloutBundleSchema>
export type TrainingMetrics = z.infer<typeof TrainingMetricsSchema>

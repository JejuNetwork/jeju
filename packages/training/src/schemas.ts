/**
 * @fileoverview Zod validation schemas for training package
 * @module training/schemas
 *
 * Provides runtime validation for all training-related API requests and responses.
 */

import { z } from 'zod'

// ============================================================================
// Atropos Schemas
// ============================================================================

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
  env_id: z.number().int().nullable().optional(),
})

export const ScoredDataListSchema = z.array(ScoredDataSchema)

export const RegistrationSchema = z.object({
  run_group: z.string().min(1),
  run_project: z.string().min(1),
  batch_size: z.number().int().positive(),
  max_token_len: z.number().int().positive(),
  checkpoint_dir: z.string(),
  save_checkpoint_interval: z.number().int().positive(),
  starting_step: z.number().int().nonnegative(),
  num_steps: z.number().int().positive(),
})

export const RegisterEnvSchema = z.object({
  max_token_length: z.number().int().positive(),
  desired_name: z.string().min(1),
  weight: z.number().positive(),
  group_size: z.number().int().positive(),
  min_batch_allocation: z.number().min(0).max(1).nullable().optional(),
})

export const DisconnectEnvSchema = z.object({
  env_id: z.number().int().nonnegative(),
})

// ============================================================================
// DWS Client Response Schemas
// ============================================================================

export const JobIdResponseSchema = z.object({
  jobId: z.string().min(1),
})

export const TrainingJobStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
])

export const DWSJobStatusSchema = z.object({
  jobId: z.string().min(1),
  status: TrainingJobStatusSchema,
  progress: z.object({
    step: z.number().int().nonnegative(),
    totalSteps: z.number().int().positive(),
    epoch: z.number().int().nonnegative(),
  }),
  metrics: z
    .object({
      loss: z.number(),
      learningRate: z.number(),
      gradientNorm: z.number(),
    })
    .optional(),
  allocations: z.array(
    z.object({
      nodeId: z.string(),
      gpuType: z.string(),
      status: z.string(),
    }),
  ),
})

export const JobAllocationsResponseSchema = z.object({
  allocations: z.array(
    z.object({
      nodeId: z.string(),
      gpuType: z.string(),
      status: z.string(),
    }),
  ),
})

export const JudgeResultSchema = z.object({
  bundleId: z.string(),
  score: z.number(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
})

export const JudgeResponseSchema = z.object({
  results: z.array(JudgeResultSchema),
})

export const AtroposStartResponseSchema = z.object({
  url: z.string().url(),
  port: z.number().int().positive(),
})

export const MerkleRootResponseSchema = z.object({
  root: z.string(),
})

export const MerkleProofResponseSchema = z.object({
  proof: z.array(z.string()),
})

export const JobsListResponseSchema = z.object({
  jobs: z.array(DWSJobStatusSchema),
})

// ============================================================================
// Inferred Types
// ============================================================================

export type Message = z.infer<typeof MessageSchema>
export type ScoredData = z.infer<typeof ScoredDataSchema>
export type Registration = z.infer<typeof RegistrationSchema>
export type RegisterEnv = z.infer<typeof RegisterEnvSchema>
export type DisconnectEnv = z.infer<typeof DisconnectEnvSchema>
export type DWSJobStatus = z.infer<typeof DWSJobStatusSchema>
export type JudgeResult = z.infer<typeof JudgeResultSchema>

// ============================================================================
// External API Response Schemas
// ============================================================================

/**
 * Response from DWS training jobs listing endpoint
 * Used in crucible.ts getRunStatus()
 */
export const JobsListResponseSchemaExternal = z.object({
  jobs: z.array(
    z.object({
      status: z.string(),
      metrics: z
        .object({
          totalEpisodes: z.number(),
          totalSteps: z.number(),
          averageReward: z.number(),
          bestReward: z.number(),
          lossHistory: z.array(z.number()),
        })
        .optional(),
    }),
  ),
})

/**
 * Response from GRPO batch endpoint
 */
export const BatchResponseSchema = z.object({
  batch: z
    .array(
      z.object({
        tokens: z.array(z.array(z.number())),
        masks: z.array(z.array(z.number())),
        scores: z.array(z.number()),
        advantages: z.array(z.array(z.number())).nullable().optional(),
        overrides: z
          .array(
            z.record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean()]),
            ),
          )
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
      }),
    )
    .nullable(),
})

/**
 * Response from autocrat proposal status endpoint
 */
export const ProposalStatusResponseSchema = z.object({
  status: z.string().optional(),
})

/**
 * Response from autocrat agent registration endpoint
 */
export const AgentRegistrationResponseSchema = z.object({
  agentId: z.string(),
})

/**
 * Response from vLLM/OpenAI-style completions endpoint
 */
export const CompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      text: z.string(),
      logprobs: z
        .object({
          tokens: z.array(z.number()),
          token_logprobs: z.array(z.number()),
        })
        .optional(),
    }),
  ),
})

// ============================================================================
// Atropos Server Response Schemas (for tests)
// ============================================================================

export const HealthResponseSchema = z.object({
  status: z.string(),
})

export const RegisterResponseSchema = z.object({
  uuid: z.string(),
})

export const RunInfoResponseSchema = z.object({
  group: z.string(),
  project: z.string(),
})

export const EnvRegistrationResponseSchema = z.object({
  status: z.string(),
  env_id: z.number(),
})

export const InfoResponseSchema = z.object({
  batch_size: z.number(),
})

export const StatusResponseSchema = z.object({
  queue_size: z.number(),
})

export const ScoredDataListResponseSchema = z.object({
  groups_processed: z.number(),
})

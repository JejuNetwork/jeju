/**
 * Training API validation schemas.
 */

import { z } from 'zod'

export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  reward: z.number().optional(),
})

const ParamValueSchema = z.union([
  z.string().max(4096),
  z.number().finite(),
  z.boolean(),
])

export const ScoredDataSchema = z.object({
  tokens: z.array(z.array(z.number().int())),
  masks: z.array(z.array(z.number().int())),
  scores: z.array(z.number().finite()),
  advantages: z.array(z.array(z.number().finite())).optional(),
  ref_logprobs: z.array(z.array(z.number().finite())).optional(),
  messages: z.array(z.array(MessageSchema)).optional(),
  generation_params: z
    .record(z.string().min(1).max(64), ParamValueSchema)
    .optional(),
  inference_logprobs: z.array(z.array(z.number().finite())).optional(),
  overrides: z
    .array(z.record(z.string().min(1).max(64), ParamValueSchema))
    .optional(),
  group_overrides: z
    .record(z.string().min(1).max(64), ParamValueSchema)
    .optional(),
  images: z.array(z.string().url().max(2048)).optional(),
  env_id: z.number().int().nonnegative().max(65535).optional(),
})

export const ScoredDataListSchema = z.array(ScoredDataSchema)

export const RegistrationSchema = z
  .object({
    run_group: z.string().min(1).max(255),
    run_project: z.string().min(1).max(255),
    batch_size: z.number().int().positive().max(1024),
    max_token_len: z.number().int().positive().max(131072),
    checkpoint_dir: z.string().min(1).max(4096),
    save_checkpoint_interval: z.number().int().positive(),
    starting_step: z.number().int().nonnegative(),
    num_steps: z.number().int().positive().max(1000000),
  })
  .strict()

export const RegisterEnvSchema = z
  .object({
    max_token_length: z.number().int().positive().max(131072),
    desired_name: z.string().min(1).max(255),
    weight: z.number().positive().max(100).default(1.0),
    group_size: z.number().int().positive().max(1024),
    min_batch_allocation: z.number().min(0).max(1).optional(),
  })
  .strict()

export const DisconnectEnvSchema = z
  .object({
    env_id: z.number().int().nonnegative().max(65535),
  })
  .strict()

export const JobIdResponseSchema = z
  .object({
    jobId: z.string().min(1).max(255),
  })
  .strict()

export const TrainingJobStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
])

/** Schema for GPU allocation status */
export const AllocationStatusSchema = z.enum([
  'pending',
  'allocated',
  'active',
  'released',
  'failed',
])

export const DWSJobStatusSchema = z
  .object({
    jobId: z.string().min(1).max(255),
    status: TrainingJobStatusSchema,
    progress: z
      .object({
        step: z.number().int().nonnegative(),
        totalSteps: z.number().int().positive(),
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    metrics: z
      .object({
        loss: z.number().finite(),
        learningRate: z.number().positive().finite(),
        gradientNorm: z.number().nonnegative().finite(),
      })
      .strict()
      .optional(),
    allocations: z.array(
      z
        .object({
          nodeId: z.string().min(1).max(255),
          gpuType: z.string().min(1).max(64),
          status: AllocationStatusSchema,
        })
        .strict(),
    ),
  })
  .strict()

export const JobAllocationsResponseSchema = z
  .object({
    allocations: z.array(
      z
        .object({
          nodeId: z.string().min(1).max(255),
          gpuType: z.string().min(1).max(64),
          status: AllocationStatusSchema,
        })
        .strict(),
    ),
  })
  .strict()

export const JudgeResultSchema = z
  .object({
    bundleId: z.string().min(1).max(255),
    score: z.number().finite(),
    reasoning: z.string().min(1).max(10000),
    confidence: z.number().min(0).max(1),
  })
  .strict()

export const JudgeResponseSchema = z
  .object({
    results: z.array(JudgeResultSchema),
  })
  .strict()

export const AtroposStartResponseSchema = z
  .object({
    url: z.string().url().max(2048),
    port: z.number().int().positive().max(65535),
  })
  .strict()

export const MerkleRootResponseSchema = z
  .object({
    root: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/, 'Must be a 32-byte hex string'),
  })
  .strict()

export const MerkleProofResponseSchema = z
  .object({
    proof: z.array(
      z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Must be a 32-byte hex string'),
    ),
  })
  .strict()

export const JobsListResponseSchema = z
  .object({
    jobs: z.array(DWSJobStatusSchema),
  })
  .strict()

// Inferred Types

export type Message = z.infer<typeof MessageSchema>
export type ScoredData = z.infer<typeof ScoredDataSchema>
export type Registration = z.infer<typeof RegistrationSchema>
export type RegisterEnv = z.infer<typeof RegisterEnvSchema>
export type DisconnectEnv = z.infer<typeof DisconnectEnvSchema>
export type DWSJobStatus = z.infer<typeof DWSJobStatusSchema>
export type JudgeResult = z.infer<typeof JudgeResultSchema>

// External API Response Schemas

/** Valid external job status values */
export const ExternalJobStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
])

/**
 * Response from DWS training jobs listing endpoint
 * Used in crucible.ts getRunStatus()
 */
export const JobsListResponseSchemaExternal = z
  .object({
    jobs: z.array(
      z
        .object({
          status: ExternalJobStatusSchema,
          metrics: z
            .object({
              totalEpisodes: z.number().int().nonnegative(),
              totalSteps: z.number().int().nonnegative(),
              averageReward: z.number().finite(),
              bestReward: z.number().finite(),
              lossHistory: z.array(z.number().finite()),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict()

/** Value type for override parameters */
const OverrideValueSchema = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
])

/**
 * Batch item schema - used in batch responses
 */
export const BatchItemSchema = z.object({
  tokens: z.array(z.array(z.number().int())),
  masks: z.array(z.array(z.number().int())),
  scores: z.array(z.number().finite()),
  advantages: z.array(z.array(z.number().finite())).optional(),
  overrides: z
    .array(z.record(z.string().min(1).max(64), OverrideValueSchema))
    .optional(),
  generation_params: z
    .record(z.string().min(1).max(64), OverrideValueSchema)
    .optional(),
  group_overrides: z
    .record(z.string().min(1).max(64), OverrideValueSchema)
    .optional(),
})

/**
 * Response from GRPO batch endpoint
 */
export const BatchResponseSchema = z
  .object({
    batch: z.array(BatchItemSchema).nullable(),
  })
  .strict()

/** Valid proposal status values */
export const ProposalStatusEnumSchema = z.enum([
  'draft',
  'submitted',
  'pending',
  'approved',
  'rejected',
  'executed',
  'cancelled',
])

/**
 * Response from autocrat proposal status endpoint
 */
export const ProposalStatusResponseSchema = z
  .object({
    status: ProposalStatusEnumSchema.optional(),
  })
  .strict()

/**
 * Response from autocrat agent registration endpoint
 */
export const AgentRegistrationResponseSchema = z
  .object({
    agentId: z.string().min(1).max(255),
  })
  .strict()

/**
 * Response from vLLM/OpenAI-style completions endpoint
 */
export const CompletionResponseSchema = z
  .object({
    choices: z.array(
      z.object({
        text: z.string(),
        logprobs: z
          .object({
            tokens: z.array(z.number().int()),
            token_logprobs: z.array(z.number().finite()),
          })
          .strict()
          .optional(),
      }),
    ),
  })
  .strict()

// Atropos Server Response Schemas (for tests)

/** Health check status values */
export const HealthStatusSchema = z.enum(['healthy', 'unhealthy', 'degraded'])

export const HealthResponseSchema = z
  .object({
    status: HealthStatusSchema,
    started: z.boolean().optional(),
    queue_size: z.number().int().nonnegative().optional(),
    envs: z.number().int().nonnegative().optional(),
    step: z.number().int().nonnegative().optional(),
  })
  .strict()

export const RegisterResponseSchema = z
  .object({
    uuid: z.string().min(1).max(64),
  })
  .strict()

export const RunInfoResponseSchema = z
  .object({
    group: z.string().nullable(),
    project: z.string().nullable(),
  })
  .strict()

export const EnvRegistrationResponseSchema = z
  .object({
    status: z.enum(['success', 'wait for trainer to start', 'failure']),
    env_id: z.number().int().nonnegative().optional(),
    run_name: z.string().optional(),
    checkpoint_dir: z.string().optional(),
    starting_step: z.number().int().nonnegative().optional(),
    checkpoint_interval: z.number().int().positive().optional(),
    num_steps: z.number().int().positive().optional(),
    error: z.string().optional(),
  })
  .strict()

export const InfoResponseSchema = z
  .object({
    batch_size: z.number().int(),
    max_token_len: z.number().int().optional(),
  })
  .strict()

export const StatusResponseSchema = z
  .object({
    current_step: z.number().int().nonnegative(),
    queue_size: z.number().int().nonnegative(),
  })
  .strict()

export const ScoredDataListResponseSchema = z
  .object({
    status: z.string(),
    groups_processed: z.number().int().nonnegative(),
    buffered: z.number().int().nonnegative().optional(),
    last_buffer_size: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()

/**
 * CI/CD service schemas
 */

import { z } from 'zod'
import {
  addressSchema,
  nonEmptyStringSchema,
  positiveIntSchema,
  strictHexSchema,
} from '../validation'

/**
 * Workflow list params schema
 */
export const workflowListParamsSchema = z.object({
  repoId: strictHexSchema,
})

/**
 * Workflow detail params schema
 */
export const workflowDetailParamsSchema = z.object({
  repoId: strictHexSchema,
  workflowId: strictHexSchema,
})

/**
 * Create workflow run request schema
 */
export const createWorkflowRunRequestSchema = z.object({
  branch: nonEmptyStringSchema,
  inputs: z.record(z.string(), z.string()).optional(),
})

/**
 * Workflow run params schema
 */
export const workflowRunParamsSchema = z.object({
  repoId: strictHexSchema,
  workflowId: strictHexSchema,
  runId: strictHexSchema,
})

/**
 * Simple runId param schema (for routes that only need runId)
 */
export const runIdParamsSchema = z.object({
  runId: z.string().min(1),
})

/**
 * Workflow run list query schema
 */
export const workflowRunListQuerySchema = z.object({
  status: z
    .enum(['queued', 'in_progress', 'completed', 'cancelled', 'failed'])
    .optional(),
  branch: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

/**
 * Job run params schema
 */
export const jobRunParamsSchema = z.object({
  repoId: strictHexSchema,
  workflowId: strictHexSchema,
  runId: strictHexSchema,
  jobId: nonEmptyStringSchema,
})

/**
 * Step run params schema
 */
export const stepRunParamsSchema = z.object({
  repoId: strictHexSchema,
  workflowId: strictHexSchema,
  runId: strictHexSchema,
  jobId: nonEmptyStringSchema,
  stepId: nonEmptyStringSchema,
})

/**
 * Logs query schema
 */
export const logsQuerySchema = z.object({
  jobId: z.string().optional(),
  stepId: z.string().optional(),
  level: z.enum(['info', 'warn', 'error', 'debug']).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
})

/**
 * Log entry schema for parsing stored log entries
 */
export const logEntrySchema = z.object({
  timestamp: z.number(),
  runId: z.string(),
  jobId: z.string(),
  stepId: z.string().optional(),
  level: z.enum([
    'info',
    'warn',
    'error',
    'debug',
    'group',
    'endgroup',
    'command',
  ]),
  message: z.string(),
  stream: z.enum(['stdout', 'stderr']),
})

/**
 * Artifact list params schema
 */
export const artifactListParamsSchema = z.object({
  repoId: strictHexSchema,
  runId: strictHexSchema,
})

/**
 * Artifact download params schema
 */
export const artifactDownloadParamsSchema = z.object({
  repoId: strictHexSchema,
  runId: strictHexSchema,
  artifactId: nonEmptyStringSchema,
})

/**
 * Simple artifact params schema
 */
export const artifactParamsSchema = z.object({
  runId: z.string().min(1),
  name: z.string().min(1),
})

/**
 * Runner registration request schema
 */
export const runnerRegistrationRequestSchema = z.object({
  name: nonEmptyStringSchema,
  labels: z.array(z.string()).min(1),
  capabilities: z.object({
    architecture: z.enum(['amd64', 'arm64']),
    os: z.enum(['linux', 'macos', 'windows']),
    docker: z.boolean(),
    gpu: z.boolean(),
    gpuType: z.string().optional(),
    cpuCores: positiveIntSchema,
    memoryMb: positiveIntSchema,
    storageMb: positiveIntSchema,
  }),
})

/**
 * Runner params schema
 */
export const runnerParamsSchema = z.object({
  runnerId: nonEmptyStringSchema,
})

/**
 * Secret creation request schema
 */
export const createSecretRequestSchema = z.object({
  name: nonEmptyStringSchema,
  value: nonEmptyStringSchema,
  environment: z.string().optional(),
})

/**
 * Secret update request schema
 */
export const updateSecretRequestSchema = z.object({
  value: nonEmptyStringSchema,
})

/**
 * Secret params schema
 */
export const secretParamsSchema = z.object({
  repoId: strictHexSchema,
  secretId: nonEmptyStringSchema,
})

/**
 * Simple secret params schema
 */
export const secretIdParamsSchema = z.object({
  secretId: z.string().min(1),
})

/**
 * Environment creation request schema
 */
export const createEnvironmentRequestSchema = z.object({
  name: nonEmptyStringSchema,
  url: z.string().url().optional(),
  protectionRules: z
    .object({
      requiredReviewers: z.array(addressSchema).optional(),
      waitTimer: z.number().int().nonnegative().optional(),
      preventSelfReview: z.boolean().optional(),
      deployBranchPolicy: z
        .object({
          protectedBranches: z.boolean(),
          customBranches: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  variables: z.record(z.string(), z.string()).optional(),
})

/**
 * Environment update request schema
 */
export const updateEnvironmentRequestSchema = z.object({
  url: z.string().url().optional(),
  protectionRules: z
    .object({
      requiredReviewers: z.array(addressSchema).optional(),
      waitTimer: z.number().int().nonnegative().optional(),
      preventSelfReview: z.boolean().optional(),
      deployBranchPolicy: z
        .object({
          protectedBranches: z.boolean(),
          customBranches: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  variables: z.record(z.string(), z.string()).optional(),
})

/**
 * Environment params schema
 */
export const environmentParamsSchema = z.object({
  repoId: strictHexSchema,
  environmentId: nonEmptyStringSchema,
})

/**
 * Environment name params schema
 */
export const environmentNameParamsSchema = z.object({
  repoId: strictHexSchema,
  name: z.string().min(1),
})

/**
 * Webhook creation request schema
 */
export const createWebhookRequestSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
  active: z.boolean().default(true),
})

/**
 * Webhook params schema
 */
export const webhookParamsSchema = z.object({
  repoId: strictHexSchema,
  webhookId: nonEmptyStringSchema,
})

/**
 * Webhook delivery params schema
 */
export const webhookDeliveryParamsSchema = z.object({
  repoId: strictHexSchema,
  webhookId: nonEmptyStringSchema,
  deliveryId: nonEmptyStringSchema,
})

/**
 * Simple trigger creation request schema
 */
export const createTriggerRequestSchema = z.object({
  name: nonEmptyStringSchema,
  type: z.enum(['cron', 'webhook', 'event']),
  schedule: z.string().optional(),
  target: z.string().url(),
  enabled: z.boolean().default(true),
})

/**
 * Simple trigger params schema
 */
export const triggerParamsSchema = z.object({
  id: z.string().uuid(),
})

/**
 * Badge params schema
 */
export const badgeParamsSchema = z.object({
  repoId: strictHexSchema,
  workflowId: strictHexSchema,
})

/**
 * Badge query schema
 */
export const badgeQuerySchema = z.object({
  branch: z.string().optional(),
})

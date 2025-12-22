/**
 * Compute service schemas
 */

import { z } from 'zod';
import type { Address } from 'viem';
import { addressSchema, nonEmptyStringSchema, positiveIntSchema } from '../validation';

/**
 * Compute job creation request schema
 */
export const createJobRequestSchema = z.object({
  command: nonEmptyStringSchema,
  shell: z.enum(['bash', 'sh', 'pwsh', 'powershell', 'cmd']).default('bash'),
  env: z.record(z.string(), z.string()).default({}),
  workingDir: z.string().optional(),
  timeout: z.number().int().positive().default(300000),
});

/**
 * Compute job response schema
 */
export const computeJobSchema = z.object({
  jobId: z.string().uuid(),
  command: z.string(),
  shell: z.string(),
  env: z.record(z.string(), z.string()),
  workingDir: z.string().optional(),
  timeout: z.number().int().positive(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  output: z.string(),
  exitCode: z.number().int().nullable(),
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  submittedBy: addressSchema,
});

/**
 * Job list query schema
 */
export const jobListQuerySchema = z.object({
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * Job params schema
 */
export const jobParamsSchema = z.object({
  jobId: z.string().uuid(),
});

/**
 * Training run schema
 */
export const trainingRunSchema = z.object({
  runId: z.string().uuid(),
  model: z.string().min(1),
  state: z.number().int().min(0).max(7),
  clients: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  totalSteps: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
});

/**
 * Training node registration schema
 */
export const trainingNodeRegistrationSchema = z.object({
  address: addressSchema,
  gpuTier: z.number().int().nonnegative(),
  capabilities: z.array(z.string()).optional(),
  endpoint: z.string().url().optional(),
  region: z.string().optional(),
  teeProvider: z.string().optional(),
});

/**
 * Training runs query schema
 */
export const trainingRunsQuerySchema = z.object({
  status: z.enum(['active', 'completed', 'paused']).optional(),
});

/**
 * Training run params schema
 */
export const trainingRunParamsSchema = z.object({
  runId: z.string().uuid(),
});

/**
 * Node params schema
 */
export const nodeParamsSchema = z.object({
  address: addressSchema,
});

/**
 * Inference request schema
 */
export const inferenceRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).min(1),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

/**
 * Embeddings request schema
 */
export const embeddingsRequestSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(z.string())]),
});

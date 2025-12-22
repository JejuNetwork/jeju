/**
 * Container service schemas
 */

import { z } from 'zod';
import { addressSchema, nonEmptyStringSchema, positiveIntSchema } from '../validation';

/**
 * Container execution request schema
 */
export const containerExecutionRequestSchema = z.object({
  image: nonEmptyStringSchema,
  command: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  resources: z.object({
    cpuCores: positiveIntSchema.optional(),
    memoryMb: positiveIntSchema.optional(),
    storageMb: positiveIntSchema.optional(),
    gpuType: z.string().optional(),
    gpuCount: z.number().int().nonnegative().optional(),
  }).optional(),
  mode: z.enum(['serverless', 'dedicated', 'spot']).default('serverless'),
  timeout: z.number().int().positive().default(300000),
  input: z.unknown().optional(),
  webhook: z.string().url().optional(),
});

/**
 * Container execution params schema
 */
export const containerExecutionParamsSchema = z.object({
  executionId: z.string().uuid(),
});

/**
 * Container executions query schema
 */
export const containerExecutionsQuerySchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Container image cache query schema
 */
export const imageCacheQuerySchema = z.object({
  image: nonEmptyStringSchema,
});

/**
 * Container resources schema
 */
export const containerResourcesSchema = z.object({
  cpuCores: positiveIntSchema.optional(),
  memoryMb: positiveIntSchema.optional(),
  storageMb: positiveIntSchema.optional(),
  gpuType: z.string().optional(),
  gpuCount: z.number().int().nonnegative().optional(),
});

/**
 * Cost estimation request schema
 */
export const containerCostEstimateSchema = z.object({
  resources: z.object({
    cpuCores: positiveIntSchema,
    memoryMb: positiveIntSchema,
    storageMb: positiveIntSchema,
    gpuType: z.string().optional(),
    gpuCount: z.number().int().nonnegative().optional(),
  }),
  durationMs: positiveIntSchema,
  expectColdStart: z.boolean().optional().default(false),
});

/**
 * Warm containers request schema
 */
export const warmContainersRequestSchema = z.object({
  image: nonEmptyStringSchema,
  count: positiveIntSchema,
  resources: containerResourcesSchema.optional(),
});

/**
 * Node registration request schema
 */
export const nodeRegistrationSchema = z.object({
  nodeId: nonEmptyStringSchema,
  address: addressSchema,
  endpoint: z.string().url(),
  region: nonEmptyStringSchema,
  zone: nonEmptyStringSchema,
  totalCpu: positiveIntSchema,
  totalMemoryMb: positiveIntSchema,
  totalStorageMb: positiveIntSchema,
  gpuTypes: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
});

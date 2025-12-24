/**
 * Workerd (V8 isolate workers) service schemas
 * Cloudflare Workers-compatible serverless functions
 */

import { z } from 'zod'
import { nonEmptyStringSchema } from '../validation'

/**
 * Compatibility date format: YYYY-MM-DD
 */
const compatibilityDateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    'Compatibility date must be in YYYY-MM-DD format',
  )
  .default('2024-01-01')

/**
 * Worker binding schema
 */
export const workerdBindingSchema = z.object({
  name: nonEmptyStringSchema,
  type: z.enum(['text', 'json', 'data', 'service']),
  value: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  service: z.string().optional(),
})

/**
 * Workerd deployment request schema
 */
export const deployWorkerdRequestSchema = z.object({
  name: z.string().min(1).max(64),
  code: z.string().or(z.instanceof(ArrayBuffer)).optional(),
  codeCid: z.string().optional(),
  handler: z.string().default('index.handler'),
  memoryMb: z.number().int().min(64).max(2048).default(128),
  timeoutMs: z.number().int().min(1000).max(900000).default(30000),
  cpuTimeMs: z.number().int().min(10).max(30000).default(50),
  compatibilityDate: compatibilityDateSchema,
  compatibilityFlags: z.array(z.string()).optional(),
  bindings: z.array(workerdBindingSchema).optional(),
})

/**
 * Workerd invocation request schema
 */
export const invokeWorkerdRequestSchema = z.object({
  method: z.string().default('POST'),
  path: z.string().default('/'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})

/**
 * Workerd params schema
 */
export const workerdParamsSchema = z.object({
  workerId: z.string().uuid(),
})

/**
 * Workerd list query schema
 */
export const workerdListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
  owner: z.string().optional(),
})

/**
 * Workerd invocation params schema
 */
export const workerdInvocationParamsSchema = z.object({
  workerId: z.string().uuid(),
  invocationId: z.string().uuid(),
})

/**
 * Workerd replication request schema
 */
export const workerdReplicateRequestSchema = z.object({
  targetCount: z.number().int().positive().max(10).default(3),
})

/**
 * Workerd registry deploy request schema
 */
export const workerdRegistryDeploySchema = z.object({
  agentId: z.string(),
})

/**
 * Type exports
 */
export type DeployWorkerdRequest = z.infer<typeof deployWorkerdRequestSchema>
export type InvokeWorkerdRequest = z.infer<typeof invokeWorkerdRequestSchema>
export type WorkerdBinding = z.infer<typeof workerdBindingSchema>

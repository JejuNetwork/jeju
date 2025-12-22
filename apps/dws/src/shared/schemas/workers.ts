/**
 * Workers (serverless functions) service schemas
 */

import { z } from 'zod'
import { JSONValueSchema, nonEmptyStringSchema } from '../validation'

/**
 * Worker deployment request schema
 */
export const deployWorkerRequestSchema = z.object({
  name: nonEmptyStringSchema,
  runtime: z.enum(['bun', 'node', 'deno']).optional().default('bun'),
  handler: z.string().optional().default('index.handler'),
  code: z.union([
    z.string(), // base64 encoded
    z.instanceof(Buffer).optional(),
    z.instanceof(ArrayBuffer).optional(),
  ]),
  memory: z.number().int().positive().optional().default(256),
  timeout: z.number().int().positive().optional().default(30000),
  env: z.record(z.string(), z.string()).optional().default({}),
})

/**
 * Worker invocation request schema
 */
export const invokeWorkerRequestSchema = z.object({
  payload: JSONValueSchema.optional(),
  async: z.boolean().default(false),
})

/**
 * Worker params schema
 */
export const workerParamsSchema = z.object({
  functionId: z.string().uuid(),
})

/**
 * Worker list query schema
 */
export const workerListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
})

/**
 * Worker invocation params schema
 */
export const workerInvocationParamsSchema = z.object({
  functionId: z.string().uuid(),
  invocationId: z.string().uuid(),
})

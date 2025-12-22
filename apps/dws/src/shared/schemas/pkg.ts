/**
 * Package registry service schemas
 */

import { z } from 'zod'
import { addressSchema, cidSchema, nonEmptyStringSchema } from '../validation'

/**
 * Package list query schema
 */
export const packageListQuerySchema = z.object({
  owner: addressSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
})

/**
 * Package params schema
 */
export const packageParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
})

/**
 * Package version params schema
 */
export const packageVersionParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Invalid semantic version'),
})

/**
 * Publish package request schema
 */
export const publishPackageRequestSchema = z.object({
  name: nonEmptyStringSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Invalid semantic version'),
  description: z.string().optional(),
  cid: cidSchema,
  dependencies: z.record(z.string(), z.string()).optional(),
  files: z.array(z.string()).optional(),
})

/**
 * Install package request schema
 */
export const installPackageRequestSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, 'Invalid semantic version')
    .optional(),
})

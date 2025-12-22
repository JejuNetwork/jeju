/**
 * Datasets service schemas
 */

import { z } from 'zod'
import { addressSchema, cidSchema, nonEmptyStringSchema } from '../validation'

/**
 * Dataset creation request schema
 */
export const datasetCreationSchema = z.object({
  name: nonEmptyStringSchema,
  organization: addressSchema.optional(),
  description: z.string(),
  format: z.union([z.number().int().min(0).max(8), z.string()]).optional(),
  license: z.union([z.number().int().min(0).max(7), z.string()]).optional(),
  licenseUri: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
})

/**
 * Dataset version creation schema
 */
export const datasetVersionCreationSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Invalid semantic version'),
  files: z
    .array(
      z.object({
        filename: nonEmptyStringSchema,
        cid: cidSchema,
        size: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid SHA256 hash'),
        split: z.enum(['train', 'test', 'validation']).optional(),
        numRows: z.number().int().positive().optional(),
      }),
    )
    .min(1),
  config: z
    .object({
      name: nonEmptyStringSchema,
      description: z.string(),
      splits: z
        .array(
          z.object({
            name: nonEmptyStringSchema,
            numRows: z.number().int().positive(),
            numBytes: z.number().int().positive(),
          }),
        )
        .min(1),
      features: z.record(
        z.string(),
        z.object({
          dtype: z.string(),
        }),
      ),
    })
    .optional(),
})

/**
 * Dataset params schema
 */
export const datasetParamsSchema = z.object({
  organization: addressSchema.optional(),
  dataset: nonEmptyStringSchema,
})

/**
 * Dataset version params schema
 */
export const datasetVersionParamsSchema = z.object({
  organization: addressSchema.optional(),
  dataset: nonEmptyStringSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Invalid semantic version'),
})

/**
 * Datasets search query schema
 */
export const datasetsSearchQuerySchema = z.object({
  q: z.string().optional(),
  format: z.coerce.number().int().min(0).max(8).optional(),
  license: z.coerce.number().int().min(0).max(7).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
})

/**
 * Dataset config schema
 */
export const datasetConfigSchema = z.object({
  name: nonEmptyStringSchema,
  description: z.string(),
  splits: z.array(
    z.object({
      name: nonEmptyStringSchema,
      numRows: z.number().int().nonnegative(),
      numBytes: z.number().int().nonnegative(),
    }),
  ),
  features: z.record(
    z.string(),
    z.object({
      dtype: z.string(),
    }),
  ),
})

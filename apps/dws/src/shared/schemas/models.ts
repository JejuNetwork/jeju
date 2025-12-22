/**
 * Models service schemas
 */

import { z } from 'zod';
import type { Address } from 'viem';
import { addressSchema, nonEmptyStringSchema, cidSchema, urlSchema } from '../validation';

/**
 * Model creation request schema
 */
export const modelCreationSchema = z.object({
  name: nonEmptyStringSchema,
  organization: addressSchema.optional(),
  modelType: z.number().int().min(0).max(8),
  license: z.number().int().min(0).max(7),
  licenseUri: urlSchema.optional(),
  accessLevel: z.number().int().min(0).max(2),
  description: z.string(),
  tags: z.array(z.string()),
});

/**
 * Model version creation schema
 */
export const modelVersionCreationSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Invalid semantic version'),
  weightsUri: cidSchema,
  weightsHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid SHA256 hash'),
  weightsSize: z.number().int().positive(),
  configUri: cidSchema.optional(),
  tokenizerUri: cidSchema.optional(),
  parameterCount: z.number().int().positive().optional(),
  precision: z.string().optional(),
});

/**
 * Model params schema
 */
export const modelParamsSchema = z.object({
  organization: addressSchema.optional(),
  model: nonEmptyStringSchema,
});

/**
 * Model version params schema
 */
export const modelVersionParamsSchema = z.object({
  organization: addressSchema.optional(),
  model: nonEmptyStringSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Invalid semantic version'),
});

/**
 * Model file upload schema
 */
export const modelFileUploadSchema = z.object({
  filename: nonEmptyStringSchema,
  type: z.enum(['weights', 'config', 'tokenizer', 'other']),
});

/**
 * Models search query schema
 */
export const modelsSearchQuerySchema = z.object({
  q: z.string().optional(),
  modelType: z.coerce.number().int().min(0).max(8).optional(),
  license: z.coerce.number().int().min(0).max(7).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Model creation request schema (native API)
 */
export const modelCreateRequestSchema = z.object({
  name: nonEmptyStringSchema,
  organization: nonEmptyStringSchema,
  description: z.string(),
  modelType: z.union([z.number().int().min(0).max(8), z.string()]),
  license: z.union([z.number().int().min(0).max(7), z.string()]).optional(),
  tags: z.array(z.string()).optional(),
  accessLevel: z.union([z.number().int().min(0).max(2), z.string()]).optional(),
});

/**
 * Model version creation request schema (native API)
 */
export const modelVersionRequestSchema = z.object({
  version: nonEmptyStringSchema,
  weightsUri: z.string().optional(),
  configUri: z.string().optional(),
  tokenizerUri: z.string().optional(),
  parameterCount: z.number().int().positive().optional(),
  precision: z.string().optional(),
});

/**
 * LFS batch request schema
 */
export const lfsBatchRequestSchema = z.object({
  operation: z.enum(['download', 'upload']),
  objects: z.array(z.object({
    oid: z.string().min(1),
    size: z.number().int().nonnegative(),
  })),
});

/**
 * Inference request schema
 */
export const modelInferenceRequestSchema = z.object({
  inputs: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

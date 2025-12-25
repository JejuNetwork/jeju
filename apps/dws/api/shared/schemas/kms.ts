/**
 * Key Management Service schemas
 */

import { z } from 'zod'
import {
  addressSchema,
  nonEmptyStringSchema,
  strictHexSchema,
} from '../validation'

/**
 * Key creation request schema
 */
export const createKmsKeyRequestSchema = z.object({
  name: nonEmptyStringSchema,
  algorithm: z.enum(['RSA', 'ECDSA', 'Ed25519']).default('Ed25519'),
  keySize: z.number().int().positive().optional(),
})

/**
 * Key params schema
 */
export const kmsKeyParamsSchema = z.object({
  keyId: z.string().uuid(),
})

/**
 * Sign request schema
 */
export const signRequestSchema = z.object({
  messageHash: strictHexSchema,
  encoding: z.enum(['utf8', 'hex']).default('utf8'),
})

/**
 * Encrypt request schema
 */
export const encryptRequestSchema = z.object({
  data: z.string(),
  encoding: z.enum(['utf8', 'hex']).default('utf8'),
})

/**
 * Decrypt request schema
 */
export const decryptRequestSchema = z.object({
  encrypted: z.string(),
})

/**
 * Key list query schema
 */
export const keyListQuerySchema = z.object({
  owner: addressSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
})

/**
 * Update key request schema
 */
export const updateKmsKeyRequestSchema = z.object({
  newThreshold: z.number().int().positive().optional(),
  newTotalParties: z.number().int().positive().optional(),
})

/**
 * Create secret request schema
 */
export const createSecretStoreRequestSchema = z.object({
  name: nonEmptyStringSchema,
  value: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
  expiresIn: z.number().int().positive().optional(),
})

/**
 * Key Management Service schemas
 */

import { z } from 'zod';
import type { Address } from 'viem';
import { addressSchema, nonEmptyStringSchema, strictHexSchema } from '../validation';

/**
 * Key creation request schema
 */
export const createKmsKeyRequestSchema = z.object({
  name: nonEmptyStringSchema,
  algorithm: z.enum(['RSA', 'ECDSA', 'Ed25519']).default('Ed25519'),
  keySize: z.number().int().positive().optional(),
});

/**
 * Key params schema
 */
export const kmsKeyParamsSchema = z.object({
  keyId: z.string().uuid(),
});

/**
 * Sign request schema
 */
export const signRequestSchema = z.object({
  message: z.union([z.string(), strictHexSchema]),
  encoding: z.enum(['utf8', 'hex']).default('utf8'),
});

/**
 * Encrypt request schema
 */
export const encryptRequestSchema = z.object({
  plaintext: z.union([z.string(), strictHexSchema]),
  encoding: z.enum(['utf8', 'hex']).default('utf8'),
});

/**
 * Decrypt request schema
 */
export const decryptRequestSchema = z.object({
  ciphertext: strictHexSchema,
});

/**
 * Key list query schema
 */
export const keyListQuerySchema = z.object({
  owner: addressSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

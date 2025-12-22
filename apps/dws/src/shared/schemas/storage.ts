/**
 * Storage service schemas
 */

import { z } from 'zod';
import { cidSchema, nonEmptyStringSchema } from '../validation';

/**
 * Upload request schema (multipart form)
 */
export const uploadRequestSchema = z.object({
  file: z.instanceof(File, { error: 'File is required' }),
});

/**
 * Upload raw request schema
 */
export const uploadRawRequestSchema = z.object({
  body: z.instanceof(ArrayBuffer),
  filename: z.string().optional(),
});

/**
 * Download request params schema
 */
export const downloadParamsSchema = z.object({
  cid: cidSchema,
});

/**
 * Exists request params schema
 */
export const existsParamsSchema = z.object({
  cid: cidSchema,
});

/**
 * IPFS add request schema
 */
export const ipfsAddRequestSchema = z.object({
  file: z.instanceof(File, { error: 'File is required' }),
});

/**
 * IPFS pin remove query schema
 */
export const ipfsPinRemoveQuerySchema = z.object({
  arg: cidSchema,
});

/**
 * Storage V2 schemas
 */

/**
 * Content tier enum
 */
export const contentTierSchema = z.enum(['system', 'popular', 'private']);

/**
 * Content category enum
 */
export const contentCategorySchema = z.enum(['data', 'media', 'code', 'document', 'other']);

/**
 * Storage backend type enum
 */
export const storageBackendTypeSchema = z.enum(['ipfs', 'arweave', 'webtorrent']);

/**
 * Upload form data schema (for multipart/form-data)
 */
export const uploadV2FormDataSchema = z.object({
  file: z.instanceof(File, { error: 'File is required' }),
  tier: contentTierSchema.optional(),
  category: contentCategorySchema.optional(),
  encrypt: z.string().optional(),
  permanent: z.string().optional(),
  backends: z.string().optional(),
  accessPolicy: z.string().optional(),
});

/**
 * Upload JSON request schema
 */
export const uploadV2JsonRequestSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  tier: contentTierSchema.optional(),
  category: contentCategorySchema.optional(),
  name: z.string().optional(),
  encrypt: z.boolean().optional(),
});

/**
 * Download query schema
 */
export const downloadV2QuerySchema = z.object({
  backend: storageBackendTypeSchema.optional(),
  decrypt: z.string().optional(),
});

/**
 * Content list query schema
 */
export const contentListQuerySchema = z.object({
  tier: contentTierSchema.optional(),
  category: contentCategorySchema.optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Popular content query schema
 */
export const popularContentQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).default(100),
});

/**
 * Underseeded content query schema
 */
export const underseededContentQuerySchema = z.object({
  min: z.coerce.number().int().nonnegative().default(3),
});

/**
 * Regional params schema
 */
export const regionalParamsSchema = z.object({
  region: z.string().min(1),
});

/**
 * Torrent params schema
 */
export const torrentParamsSchema = z.object({
  cid: cidSchema,
});

/**
 * Arweave params schema
 */
export const arweaveParamsSchema = z.object({
  txId: z.string().min(1),
});

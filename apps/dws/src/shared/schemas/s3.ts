/**
 * S3-compatible storage service schemas
 */

import { z } from 'zod';
import { nonEmptyStringSchema } from '../validation';

/**
 * Bucket creation request schema
 */
export const createBucketRequestSchema = z.object({
  name: nonEmptyStringSchema,
  region: z.string().optional(),
  acl: z.enum(['private', 'public-read', 'public-read-write']).default('private'),
});

/**
 * Bucket params schema
 */
export const bucketParamsSchema = z.object({
  bucket: nonEmptyStringSchema,
});

/**
 * Object params schema
 */
export const objectParamsSchema = z.object({
  bucket: nonEmptyStringSchema,
  key: z.string().min(1),
});

/**
 * Object list query schema
 */
export const objectListQuerySchema = z.object({
  prefix: z.string().optional(),
  delimiter: z.string().optional(),
  maxKeys: z.coerce.number().int().positive().max(1000).default(1000),
  continuationToken: z.string().optional(),
});

/**
 * Multipart upload initiation request schema
 */
export const initiateMultipartUploadRequestSchema = z.object({
  contentType: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

/**
 * Multipart upload completion request schema
 */
export const completeMultipartUploadRequestSchema = z.object({
  parts: z.array(z.object({
    etag: z.string(),
    partNumber: z.number().int().positive(),
  })).min(1),
});

/**
 * Presigned URL request schema
 */
export const presignRequestSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  operation: z.enum(['getObject', 'putObject']),
  expiresIn: z.number().int().positive().max(604800), // max 7 days
  contentType: z.string().optional(),
});

/**
 * Complete multipart upload XML body schema
 */
export const completeMultipartXmlSchema = z.object({
  CompleteMultipartUpload: z.object({
    Part: z.array(z.object({
      PartNumber: z.number().int().positive(),
      ETag: z.string(),
    })),
  }),
});

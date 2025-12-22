/**
 * CDN service schemas
 */

import { z } from 'zod'
import { cidSchema, urlSchema } from '../validation'

/**
 * CDN cache request schema
 */
export const cdnCacheRequestSchema = z.object({
  url: urlSchema,
  ttl: z.number().int().positive().optional(),
})

/**
 * CDN cache params schema
 */
export const cdnCacheParamsSchema = z.object({
  cid: cidSchema,
})

/**
 * CDN purge request schema
 */
export const cdnPurgeRequestSchema = z.object({
  cid: cidSchema.optional(),
  url: urlSchema.optional(),
  pattern: z.string().optional(),
})

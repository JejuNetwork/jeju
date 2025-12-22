/**
 * Common schemas used across multiple services
 */

import { z } from 'zod';

/**
 * Pagination query schema
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(30),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

/**
 * Search query schema
 */
export const searchQuerySchema = z.object({
  q: z.string().optional(),
  search: z.string().optional(),
});

/**
 * Sort query schema
 */
export const sortQuerySchema = z.object({
  sort: z.string().optional(),
  direction: z.enum(['1', '-1', 'asc', 'desc']).optional(),
});

/**
 * Region header schema
 */
export const regionHeaderSchema = z.object({
  'x-region': z.string().optional(),
  'x-jeju-region': z.string().optional(),
  'cf-ipcountry': z.string().optional(),
});

/**
 * Content type header schema
 */
export const contentTypeHeaderSchema = z.object({
  'content-type': z.string().optional(),
});

/**
 * Filename header schema
 */
export const filenameHeaderSchema = z.object({
  'x-filename': z.string().optional(),
});

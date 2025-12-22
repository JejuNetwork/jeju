/**
 * Scraping service schemas
 */

import { z } from 'zod';
import { urlSchema, nonEmptyStringSchema, JSONValueSchema } from '../validation';

/**
 * Scraping request schema
 */
export const scrapingRequestSchema = z.object({
  url: urlSchema,
  javascript: z.boolean().default(false),
  screenshot: z.boolean().default(false),
  waitFor: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  elements: z.array(z.object({
    selector: z.string().min(1),
    attribute: z.string().optional(),
  })).optional(),
});

/**
 * Scraping function request schema
 */
export const scrapingFunctionRequestSchema = z.object({
  code: nonEmptyStringSchema,
  context: z.record(z.string(), JSONValueSchema).optional(),
});

/**
 * Scraping fetch query schema
 */
export const scrapingFetchQuerySchema = z.object({
  url: urlSchema,
  screenshot: z.coerce.boolean().optional(),
  waitFor: z.string().optional(),
});

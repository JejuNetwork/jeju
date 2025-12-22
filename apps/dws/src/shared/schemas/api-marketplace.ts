/**
 * API Marketplace service schemas
 */

import { z } from 'zod';
import { addressSchema, nonEmptyStringSchema } from '../validation';

// ============================================================================
// Core Data Schemas (for persistent storage)
// ============================================================================

/**
 * Usage limits schema - validates rate limiting configuration
 */
export const UsageLimitsSchema = z.object({
  requestsPerSecond: z.number().int().positive(),
  requestsPerMinute: z.number().int().positive(),
  requestsPerDay: z.number().int().positive(),
  requestsPerMonth: z.number().int().positive(),
});
export type UsageLimitsData = z.infer<typeof UsageLimitsSchema>;

/**
 * HTTP methods allowed for API access control
 */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/**
 * Access control schema - validates domain and endpoint restrictions
 */
export const AccessControlSchema = z.object({
  allowedDomains: z.array(z.string()),
  blockedDomains: z.array(z.string()),
  allowedEndpoints: z.array(z.string()),
  blockedEndpoints: z.array(z.string()),
  allowedMethods: z.array(HttpMethodSchema),
});
export type AccessControlData = z.infer<typeof AccessControlSchema>;

// ============================================================================
// API Query Schemas
// ============================================================================

/**
 * Provider list query schema
 */
export const providerListQuerySchema = z.object({
  category: z.string().optional(),
  configured: z.coerce.boolean().optional(),
});

/**
 * Provider params schema
 */
export const providerParamsSchema = z.object({
  id: nonEmptyStringSchema,
});

/**
 * Listing list query schema
 */
export const listingListQuerySchema = z.object({
  provider: z.string().optional(),
  seller: addressSchema.optional(),
  active: z.coerce.boolean().default(true),
});

/**
 * Listing params schema
 */
export const listingParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Create listing request schema
 */
export const createListingRequestSchema = z.object({
  providerId: nonEmptyStringSchema,
  apiKey: nonEmptyStringSchema,
  pricePerRequest: z.string().optional(),
  limits: z.object({
    requestsPerMinute: z.number().int().positive().optional(),
    requestsPerHour: z.number().int().positive().optional(),
    requestsPerDay: z.number().int().positive().optional(),
  }).optional(),
  accessControl: z.object({
    allowedDomains: z.array(z.string()).optional(),
    blockedDomains: z.array(z.string()).optional(),
    allowedEndpoints: z.array(z.string()).optional(),
    blockedEndpoints: z.array(z.string()).optional(),
    allowedMethods: z.array(z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])).optional(),
  }).optional(),
});

/**
 * Update listing request schema
 */
export const updateListingRequestSchema = z.object({
  pricePerRequest: z.string().optional(),
  limits: z.object({
    requestsPerMinute: z.number().int().positive().optional(),
    requestsPerHour: z.number().int().positive().optional(),
    requestsPerDay: z.number().int().positive().optional(),
  }).optional(),
  accessControl: z.object({
    allowedDomains: z.array(z.string()).optional(),
    blockedDomains: z.array(z.string()).optional(),
    allowedEndpoints: z.array(z.string()).optional(),
    blockedEndpoints: z.array(z.string()).optional(),
    allowedMethods: z.array(z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])).optional(),
  }).optional(),
  active: z.boolean().optional(),
});

/**
 * Proxy request schema
 */
export const proxyRequestSchema = z.object({
  providerId: nonEmptyStringSchema,
  listingId: z.string().uuid().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  path: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  query: z.record(z.string(), z.string()).optional(),
});

/**
 * Deposit request schema
 */
export const depositRequestSchema = z.object({
  amount: z.string().regex(/^\d+$/, 'Amount must be a string of digits'),
});

/**
 * Withdraw request schema
 */
export const withdrawRequestSchema = z.object({
  amount: z.string().regex(/^\d+$/, 'Amount must be a string of digits'),
  recipient: addressSchema,
});

/**
 * Account params schema
 */
export const accountParamsSchema = z.object({
  address: addressSchema,
});

/**
 * Key vault key creation request schema
 */
export const createApiKeyRequestSchema = z.object({
  providerId: nonEmptyStringSchema,
  apiKey: nonEmptyStringSchema,
});

/**
 * Key vault key params schema
 */
export const apiKeyParamsSchema = z.object({
  keyId: z.string().uuid(),
});

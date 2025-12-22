/**
 * @fileoverview API Types
 *
 * Common API response and request patterns for consistent API design
 * across the Jeju ecosystem. Includes Zod schemas for runtime validation.
 */

import { z } from 'zod'
import type { PaginationSchema } from './validation'

// ============================================================================
// Error Detail Types - Strongly typed alternatives to unknown
// ============================================================================

/**
 * Error detail field types - eliminates use of unknown/any
 * Error details can be strings, arrays of strings (validation errors),
 * or structured error info with specific field errors
 */
export type ErrorDetail =
  | string
  | string[]
  | { field: string; message: string }[]
  | { path: string[]; message: string }[]

/**
 * Zod schema for error details
 */
export const ErrorDetailSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.array(z.object({ field: z.string(), message: z.string() })),
  z.array(z.object({ path: z.array(z.string()), message: z.string() })),
])

// ============================================================================
// Pagination Schemas
// ============================================================================

/**
 * Pagination info schema (response metadata)
 */
export const PaginationInfoSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})
export type PaginationInfo = z.infer<typeof PaginationInfoSchema>

/**
 * API response metadata schema
 */
export const ApiMetaSchema = z.object({
  timestamp: z.number(),
  requestId: z.string().optional(),
  version: z.string().optional(),
  pagination: PaginationInfoSchema.optional(),
})
export type ApiMeta = z.infer<typeof ApiMetaSchema>

/**
 * API error schema
 */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: ErrorDetailSchema.optional(),
  requestId: z.string().optional(),
  timestamp: z.number().optional(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

// ============================================================================
// Generic API Response Types
// ============================================================================

/**
 * Generic API response wrapper
 *
 * @template T - The data type returned by the API
 */
export interface ApiResponse<T> {
  /** Response data */
  data: T
  /** Optional metadata */
  meta?: ApiMeta
  /** Optional error information (if request failed) */
  error?: {
    code: string
    message: string
    details?: ErrorDetail
  }
}

/**
 * Create a Zod schema for ApiResponse with a specific data type
 */
export function createApiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: ApiMetaSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: ErrorDetailSchema.optional(),
      })
      .optional(),
  })
}

/**
 * Paginated API response
 * Extends ApiResponse with required pagination metadata
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    timestamp: number
    pagination: PaginationInfo
    requestId?: string
    version?: string
  }
}

/**
 * Create a Zod schema for PaginatedResponse with a specific item type
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
) {
  return z.object({
    data: z.array(itemSchema),
    meta: z.object({
      timestamp: z.number(),
      pagination: PaginationInfoSchema,
      requestId: z.string().optional(),
      version: z.string().optional(),
    }),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: ErrorDetailSchema.optional(),
      })
      .optional(),
  })
}

// ============================================================================
// A2A Response Types
// ============================================================================

/**
 * A2A (Agent-to-Agent) response
 * Standardized response format for A2A protocol
 */
export interface A2AResponse<T> extends ApiResponse<T> {
  /** A2A protocol version */
  protocol: 'a2a'
  /** Agent that generated the response */
  agentId?: string
}

/**
 * Create a Zod schema for A2AResponse with a specific data type
 */
export function createA2AResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return createApiResponseSchema(dataSchema).extend({
    protocol: z.literal('a2a'),
    agentId: z.string().optional(),
  })
}

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Base API request schema
 */
export const ApiRequestSchema = z.object({
  requestId: z.string().optional(),
  version: z.string().optional(),
  timeout: z.number().int().positive().optional(),
})
export type ApiRequest = z.infer<typeof ApiRequestSchema>

/**
 * Paginated request parameters type (uses PaginationSchema from validation)
 */
export type PaginationParams = z.infer<typeof PaginationSchema>

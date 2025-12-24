/**
 * API response/request types and schemas for consistent API design.
 */

import { z } from 'zod'
import type { PaginationSchema } from './validation'

/** Error detail field types (string, string[], or structured errors) */
export type ErrorDetail =
  | string
  | string[]
  | { field: string; message: string }[]
  | { path: string[]; message: string }[]

export const ErrorDetailSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.array(z.object({ field: z.string(), message: z.string() })),
  z.array(z.object({ path: z.array(z.string()), message: z.string() })),
])

export const PaginationInfoSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})
export type PaginationInfo = z.infer<typeof PaginationInfoSchema>

export const ApiMetaSchema = z.object({
  timestamp: z.number(),
  requestId: z.string().optional(),
  version: z.string().optional(),
  pagination: PaginationInfoSchema.optional(),
})
export type ApiMeta = z.infer<typeof ApiMetaSchema>

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: ErrorDetailSchema.optional(),
  requestId: z.string().optional(),
  timestamp: z.number().optional(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

/** Generic API response wrapper */
export interface ApiResponse<T> {
  data: T
  meta?: ApiMeta
  error?: {
    code: string
    message: string
    details?: ErrorDetail
  }
}

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

/** Paginated API response with required pagination metadata */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    timestamp: number
    pagination: PaginationInfo
    requestId?: string
    version?: string
  }
}

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

/** A2A (Agent-to-Agent) response format */
export interface A2AResponse<T> extends ApiResponse<T> {
  protocol: 'a2a'
  agentId?: string
}

export function createA2AResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return createApiResponseSchema(dataSchema).extend({
    protocol: z.literal('a2a'),
    agentId: z.string().optional(),
  })
}

export const ApiRequestSchema = z.object({
  requestId: z.string().optional(),
  version: z.string().optional(),
  timeout: z.number().int().positive().optional(),
})
export type ApiRequest = z.infer<typeof ApiRequestSchema>

export type PaginationParams = z.infer<typeof PaginationSchema>

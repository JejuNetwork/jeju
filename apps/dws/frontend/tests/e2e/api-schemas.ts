/**
 * Zod Schemas for DWS E2E Tests
 * Validates API responses in tests for stronger guarantees
 */

import { z } from 'zod'

// Base types
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

// Health response schemas
export const healthResponseSchema = z.object({
  status: z.string(),
  decentralized: z
    .object({
      identityRegistry: addressSchema,
      registeredNodes: z.number(),
      connectedPeers: z.number(),
      frontendCid: z.string().optional(),
      p2pEnabled: z.boolean().optional(),
    })
    .optional(),
  services: z.record(z.string(), z.object({ status: z.string() })).optional(),
  backends: z
    .object({
      available: z.array(z.string()),
      health: z.record(
        z.string(),
        z.union([z.boolean(), z.object({ status: z.string() })]),
      ),
    })
    .optional(),
})

export const storageHealthSchema = z.object({
  status: z.string(),
})

export const computeHealthSchema = z.object({
  status: z.string(),
})

// Storage schemas
export const uploadResponseSchema = z.object({
  cid: z.string().min(1),
  size: z.number().optional(),
  contentType: z.string().optional(),
})

// Compute schemas
export const submitJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.string().optional(),
})

export const jobStatusResponseSchema = z.object({
  jobId: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  output: z.string().optional(),
  exitCode: z.number().nullable().optional(),
})

// RPC schemas
export const rpcChainsResponseSchema = z.object({
  chains: z.array(
    z.object({
      chainId: z.number(),
      name: z.string(),
    }),
  ),
})

export const rpcResponseSchema = z.object({
  jsonrpc: z.string(),
  result: z.string().optional(),
  id: z.number(),
})

// KMS schemas
export const encryptResponseSchema = z.object({
  encrypted: z.string(),
  keyId: z.string(),
})

export const decryptResponseSchema = z.object({
  decrypted: z.string(),
})

// CDN schemas
export const cdnStatsResponseSchema = z.object({
  entries: z.number(),
  sizeBytes: z.number().optional(),
  maxSizeBytes: z.number().optional(),
  hitRate: z.number().optional(),
})

// Edge nodes schema
export const edgeNodesResponseSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      region: z.string(),
      status: z.enum(['online', 'offline', 'maintenance']),
    }),
  ),
})

// Repository schemas
export const reposResponseSchema = z.object({
  repositories: z.array(z.object({ repoId: z.string() })).optional(),
  repos: z.array(z.object({ repoId: z.string() })).optional(),
})

// Package schemas
export const searchPackagesResponseSchema = z.object({
  objects: z
    .array(z.object({ package: z.object({ name: z.string() }) }))
    .optional(),
  packages: z.array(z.object({ name: z.string() })).optional(),
})

/**
 * Helper to validate API responses in tests
 */
export function validateResponse<T>(
  data: unknown,
  schema: z.ZodType<T>,
  context?: string,
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const message = context
      ? `[${context}] Validation failed: ${result.error.message}`
      : `Validation failed: ${result.error.message}`
    throw new Error(message)
  }
  return result.data
}

/**
 * Helper for making validated API requests in tests
 */
export async function fetchAndValidate<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, options)
  const rawData = await response.json()
  const data = validateResponse(rawData, schema, url)
  return { response, data }
}

// Export type inferences
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type UploadResponse = z.infer<typeof uploadResponseSchema>
export type SubmitJobResponse = z.infer<typeof submitJobResponseSchema>
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>
export type RPCChainsResponse = z.infer<typeof rpcChainsResponseSchema>
export type EncryptResponse = z.infer<typeof encryptResponseSchema>
export type DecryptResponse = z.infer<typeof decryptResponseSchema>
export type CDNStatsResponse = z.infer<typeof cdnStatsResponseSchema>
export type EdgeNodesResponse = z.infer<typeof edgeNodesResponseSchema>

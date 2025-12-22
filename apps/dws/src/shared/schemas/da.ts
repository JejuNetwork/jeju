/**
 * Data Availability (DA) layer schemas
 */

import { z } from 'zod'
import { addressSchema, hexSchema, nonEmptyStringSchema } from '../validation'

// ============================================================================
// Blob Submission Schemas
// ============================================================================

/**
 * Blob submission request
 */
export const blobSubmitRequestSchema = z.object({
  data: nonEmptyStringSchema, // hex or base64 encoded
  submitter: addressSchema,
  namespace: hexSchema.optional(),
  quorumPercent: z.number().int().min(0).max(100).optional(),
  retentionPeriod: z.number().int().positive().optional(),
})

/**
 * Sample blob request
 */
export const blobSampleRequestSchema = z.object({
  blobId: hexSchema,
  requester: addressSchema,
})

// ============================================================================
// Chunk Storage Schemas
// ============================================================================

/**
 * Chunk proof schema
 */
export const chunkProofSchema = z.object({
  merkleProof: z.array(hexSchema),
  openingProof: hexSchema,
  polynomialIndex: z.number().int().nonnegative(),
})

/**
 * Chunk commitment schema
 */
export const chunkCommitmentSchema = z.object({
  commitment: hexSchema,
  dataChunkCount: z.number().int().positive(),
  parityChunkCount: z.number().int().nonnegative(),
  totalChunkCount: z.number().int().positive(),
  chunkSize: z.number().int().positive(),
  merkleRoot: hexSchema,
  timestamp: z.number().int().positive(),
})

/**
 * Store chunk request
 */
export const storeChunkRequestSchema = z.object({
  blobId: hexSchema,
  index: z.number().int().nonnegative(),
  data: hexSchema,
  proof: chunkProofSchema,
  commitment: chunkCommitmentSchema,
})

/**
 * Sample request (for operators)
 */
export const sampleRequestSchema = z.object({
  blobId: hexSchema,
  chunkIndices: z.array(z.number().int().nonnegative()),
  requester: addressSchema,
  nonce: hexSchema,
  timestamp: z.number().int().positive(),
})

// ============================================================================
// Attestation Schemas
// ============================================================================

/**
 * Attestation request
 */
export const attestRequestSchema = z.object({
  blobId: hexSchema,
  commitment: hexSchema,
  chunkIndices: z.array(z.number().int().nonnegative()),
})

// ============================================================================
// Operator Schemas
// ============================================================================

/**
 * DA operator info schema for registration
 * Some fields are optional for API registration and will be set by the system
 */
export const daOperatorInfoSchema = z.object({
  address: addressSchema,
  agentId: z
    .union([z.bigint(), z.number().transform((n) => BigInt(n))])
    .optional(),
  stake: z
    .union([z.bigint(), z.number().transform((n) => BigInt(n))])
    .optional(),
  endpoint: nonEmptyStringSchema,
  teeAttestation: hexSchema.optional(),
  region: nonEmptyStringSchema,
  capacityGB: z.number().positive(),
  usedGB: z.number().nonnegative(),
  status: z.enum(['pending', 'active', 'inactive', 'slashed']),
  registeredAt: z.number().int().positive().optional(),
  lastHeartbeat: z.number().int().positive().optional(),
})

// ============================================================================
// Type Exports
// ============================================================================

export type BlobSubmitRequest = z.infer<typeof blobSubmitRequestSchema>
export type BlobSampleRequest = z.infer<typeof blobSampleRequestSchema>
export type StoreChunkRequest = z.infer<typeof storeChunkRequestSchema>
export type SampleRequest = z.infer<typeof sampleRequestSchema>
export type AttestRequest = z.infer<typeof attestRequestSchema>
export type DAOperatorInfo = z.infer<typeof daOperatorInfoSchema>

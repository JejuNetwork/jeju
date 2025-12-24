/**
 * Funding-related schemas (leaderboard-funding, fee-collector, funding-verifier, dependency-scanner)
 */

import { z } from 'zod'
import { nonEmptyStringSchema } from '../validation'

// Leaderboard Funding Schemas

/**
 * Sync leaderboard to funding request
 */
export const leaderboardSyncRequestSchema = z.object({
  daoId: nonEmptyStringSchema,
  limit: z.number().int().positive().max(1000).optional(),
})

/**
 * Preview leaderboard funding request
 */
export const leaderboardPreviewRequestSchema = z.object({
  limit: z.number().int().positive().max(1000).optional(),
})

// Fee Collector Schemas

/**
 * Record fee request
 */
export const recordFeeRequestSchema = z.object({
  daoId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string'),
})

// Funding Verifier Schemas

/**
 * Social verification request
 */
export const verifySocialRequestSchema = z.object({
  contributorId: nonEmptyStringSchema,
  platform: z.enum(['github', 'discord', 'twitter', 'farcaster']),
  handle: nonEmptyStringSchema,
  oauthToken: nonEmptyStringSchema,
})

/**
 * Repository verification request
 */
export const verifyRepoRequestSchema = z.object({
  claimId: nonEmptyStringSchema,
  owner: nonEmptyStringSchema,
  repo: nonEmptyStringSchema,
  oauthToken: nonEmptyStringSchema,
})

/**
 * Dependency verification request
 */
export const verifyDependencyRequestSchema = z.object({
  claimId: nonEmptyStringSchema,
  packageName: nonEmptyStringSchema,
  registryType: z.enum(['npm', 'pypi', 'cargo', 'go']),
  oauthToken: nonEmptyStringSchema,
})

// Dependency Scanner Schemas

/**
 * Registry type enum
 */
export const registryTypeSchema = z.enum(['npm', 'pypi', 'cargo', 'go'])

/**
 * Scan repository request
 */
export const scanRepositoryRequestSchema = z.object({
  daoId: nonEmptyStringSchema,
  repoOwner: nonEmptyStringSchema,
  repoName: nonEmptyStringSchema,
  registryTypes: z.array(registryTypeSchema).optional(),
  maxDepth: z.number().int().positive().max(10).optional(),
  autoRegister: z.boolean().optional(),
})

// Type Exports

export type LeaderboardSyncRequest = z.infer<
  typeof leaderboardSyncRequestSchema
>
export type LeaderboardPreviewRequest = z.infer<
  typeof leaderboardPreviewRequestSchema
>
export type RecordFeeRequest = z.infer<typeof recordFeeRequestSchema>
export type VerifySocialRequest = z.infer<typeof verifySocialRequestSchema>
export type VerifyRepoRequest = z.infer<typeof verifyRepoRequestSchema>
export type VerifyDependencyRequest = z.infer<
  typeof verifyDependencyRequestSchema
>
export type ScanRepositoryRequest = z.infer<typeof scanRepositoryRequestSchema>

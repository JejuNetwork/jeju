/**
 * DAO Manifest Zod Schemas
 *
 * Validation schemas for DAO configuration in jeju-manifest.json
 */

import { z } from 'zod'

/** Ethereum address schema */
const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
  .optional()

/** Wei amount as string (big numbers) */
const WeiAmountSchema = z
  .string()
  .regex(/^\d+$/, 'Must be a valid wei amount (numeric string)')

/** CEO/Leader persona schema */
export const DAOCEOConfigSchema = z.object({
  name: z.string().min(1, 'CEO name is required'),
  description: z.string().min(1, 'CEO description is required'),
  personality: z.string().min(1, 'CEO personality is required'),
  traits: z.array(z.string()).min(1, 'At least one trait required'),
  voiceStyle: z.string().optional(),
  communicationTone: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  pfpCid: z.string().optional(),
})

/** Council member schema */
export const DAOCouncilMemberSchema = z.object({
  role: z.string().min(1, 'Council role is required'),
  description: z.string().min(1, 'Council member description is required'),
  weight: z
    .number()
    .int()
    .min(1)
    .max(10000, 'Weight must be between 1 and 10000 (basis points)'),
  address: AddressSchema,
  agentId: z.number().int().nonnegative().optional(),
})

/** Governance parameters schema */
export const DAOGovernanceParamsSchema = z.object({
  minQualityScore: z.number().int().min(0).max(100),
  councilVotingPeriod: z.number().int().positive(),
  gracePeriod: z.number().int().nonnegative(),
  minProposalStake: WeiAmountSchema,
  quorumBps: z.number().int().min(0).max(10000),
})

/** Governance configuration schema */
export const DAOGovernanceConfigSchema = z.object({
  ceo: DAOCEOConfigSchema,
  council: z.object({
    members: z.array(DAOCouncilMemberSchema).min(1, 'At least one council member required'),
  }),
  parameters: DAOGovernanceParamsSchema,
})

/** Funding configuration schema */
export const DAOFundingConfigSchema = z.object({
  minStake: WeiAmountSchema,
  maxStake: WeiAmountSchema,
  epochDuration: z.number().int().positive(),
  cooldownPeriod: z.number().int().nonnegative(),
  matchingMultiplier: z.number().int().min(0).max(100000),
  quadraticEnabled: z.boolean(),
  ceoWeightCap: z.number().int().min(0).max(10000),
})

/** Fee category schema */
export const DAOFeeCategorySchema = z.object({
  description: z.string(),
  defaultBps: z.number().int().min(0).max(10000),
})

/** Fee configuration schema */
export const DAOFeeConfigSchema = z.object({
  type: z.enum(['protocol', 'game', 'service']),
  controller: z.string(),
  categories: z.record(z.string(), DAOFeeCategorySchema),
})

/** Seeded package schema */
export const DAOSeededPackageSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  registry: z.enum(['npm', 'foundry', 'cargo', 'pypi']),
  fundingWeight: z.number().int().min(0).max(10000),
})

/** Seeded repository schema */
export const DAOSeededRepoSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string(),
  fundingWeight: z.number().int().min(0).max(10000),
})

/** DAO-to-DAO allocation schema */
export const DAOAllocationSchema = z.object({
  targetDao: z.string().min(1),
  type: z.enum(['deep-funding', 'fee-share', 'recurring', 'one-time']),
  amount: z.string(),
  description: z.string().optional(),
})

/** Network-specific deployment configuration schema */
export const DAONetworkDeploymentSchema = z.object({
  autoSeed: z.boolean(),
  fundTreasury: WeiAmountSchema.optional(),
  fundMatching: WeiAmountSchema.optional(),
  requiresMultisig: z.boolean().optional(),
  parentDao: z.string().optional(),
  peerAllocations: z.array(DAOAllocationSchema).optional(),
})

/** Full DAO configuration schema */
export const DAOConfigSchema = z.object({
  governance: DAOGovernanceConfigSchema,
  funding: DAOFundingConfigSchema,
  fees: DAOFeeConfigSchema.optional(),
  packages: z
    .object({
      seeded: z.array(DAOSeededPackageSchema),
    })
    .optional(),
  repos: z
    .object({
      seeded: z.array(DAOSeededRepoSchema),
    })
    .optional(),
  deployment: z
    .object({
      localnet: DAONetworkDeploymentSchema.optional(),
      testnet: DAONetworkDeploymentSchema.optional(),
      mainnet: DAONetworkDeploymentSchema.optional(),
    })
    .optional(),
})

/** DAO manifest schema (extends base manifest) */
export const DAOManifestSchema = z.object({
  name: z.string().min(1, 'DAO name is required'),
  displayName: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  type: z.literal('dao').optional(),
  network: z
    .object({
      chain: z.string(),
      testnet: z.string().optional(),
      localnet: z.string().optional(),
    })
    .optional(),
  governance: DAOGovernanceConfigSchema,
  funding: DAOFundingConfigSchema,
  fees: DAOFeeConfigSchema.optional(),
  packages: z
    .object({
      seeded: z.array(DAOSeededPackageSchema),
    })
    .optional(),
  repos: z
    .object({
      seeded: z.array(DAOSeededRepoSchema),
    })
    .optional(),
  integrations: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  deployment: z
    .object({
      localnet: DAONetworkDeploymentSchema.optional(),
      testnet: DAONetworkDeploymentSchema.optional(),
      mainnet: DAONetworkDeploymentSchema.optional(),
    })
    .optional(),
  commands: z.record(z.string(), z.string()).optional(),
})

export type DAOManifest = z.infer<typeof DAOManifestSchema>
export type DAOGovernanceConfig = z.infer<typeof DAOGovernanceConfigSchema>
export type DAOFundingValidated = z.infer<typeof DAOFundingConfigSchema>
export type DAOFeeValidated = z.infer<typeof DAOFeeConfigSchema>
export type DAONetworkDeployment = z.infer<typeof DAONetworkDeploymentSchema>

/**
 * Validate a DAO manifest
 * @throws ZodError if validation fails
 */
export function validateDAOManifest(data: unknown): DAOManifest {
  return DAOManifestSchema.parse(data)
}

/**
 * Validate council weights sum to expected total (usually 10000 bps = 100%)
 */
export function validateCouncilWeights(
  members: Array<{ weight: number }>,
  expectedTotal = 10000,
): { valid: boolean; total: number; message: string } {
  const total = members.reduce((sum, m) => sum + m.weight, 0)
  const valid = total === expectedTotal
  return {
    valid,
    total,
    message: valid
      ? `Council weights valid (${total} bps)`
      : `Council weights sum to ${total} bps, expected ${expectedTotal} bps`,
  }
}

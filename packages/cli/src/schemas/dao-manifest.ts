import { z } from 'zod'

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address')
  .optional()
const WeiAmountSchema = z.string().regex(/^\d+$/, 'Must be numeric string')

export const DAODirectorConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  personality: z.string().min(1),
  traits: z.array(z.string()).min(1),
  voiceStyle: z.string().optional(),
  communicationTone: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  pfpCid: z.string().optional(),
})

export const DAOBoardMemberSchema = z.object({
  role: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().int().min(1).max(10000),
  address: AddressSchema,
  agentId: z.number().int().nonnegative().optional(),
})

export const DAOGovernanceParamsSchema = z.object({
  minQualityScore: z.number().int().min(0).max(100),
  boardVotingPeriod: z.number().int().positive(),
  gracePeriod: z.number().int().nonnegative(),
  minProposalStake: WeiAmountSchema,
  quorumBps: z.number().int().min(0).max(10000),
})

export const DAOGovernanceConfigSchema = z.object({
  director: DAODirectorConfigSchema,
  board: z.object({ members: z.array(DAOBoardMemberSchema).min(1) }),
  parameters: DAOGovernanceParamsSchema,
})

export const DAOFundingConfigSchema = z.object({
  minStake: WeiAmountSchema,
  maxStake: WeiAmountSchema,
  epochDuration: z.number().int().positive(),
  cooldownPeriod: z.number().int().nonnegative(),
  matchingMultiplier: z.number().int().min(0).max(100000),
  quadraticEnabled: z.boolean(),
  directorWeightCap: z.number().int().min(0).max(10000),
})

export const DAOFeeCategorySchema = z.object({
  description: z.string(),
  defaultBps: z.number().int().min(0).max(10000),
})

export const DAOFeeConfigSchema = z.object({
  type: z.enum(['protocol', 'game', 'service']),
  controller: z.string(),
  categories: z.record(z.string(), DAOFeeCategorySchema),
})

export const DAOSeededPackageSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  registry: z.enum(['npm', 'foundry', 'cargo', 'pypi']),
  fundingWeight: z.number().int().min(0).max(10000),
})

export const DAOSeededRepoSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string(),
  fundingWeight: z.number().int().min(0).max(10000),
})

export const DAOAllocationSchema = z.object({
  targetDao: z.string().min(1),
  type: z.enum(['deep-funding', 'fee-share', 'recurring', 'one-time']),
  amount: z.string(),
  description: z.string().optional(),
})

export const DAONetworkDeploymentSchema = z.object({
  autoSeed: z.boolean(),
  fundTreasury: WeiAmountSchema.optional(),
  fundMatching: WeiAmountSchema.optional(),
  requiresMultisig: z.boolean().optional(),
  parentDao: z.string().optional(),
  peerAllocations: z.array(DAOAllocationSchema).optional(),
})

export const DAOManifestSchema = z.object({
  name: z.string().min(1),
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
  integrations: z
    .record(z.string(), z.record(z.string(), z.boolean()))
    .optional(),
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

export function validateDAOManifest(data: unknown): DAOManifest {
  return DAOManifestSchema.parse(data)
}

export function validateBoardWeights(
  members: Array<{ weight: number }>,
  expectedTotal = 10000,
) {
  const total = members.reduce((sum, m) => sum + m.weight, 0)
  return {
    valid: total === expectedTotal,
    total,
    message:
      total === expectedTotal
        ? `Weights valid (${total} bps)`
        : `Weights ${total} bps, expected ${expectedTotal}`,
  }
}

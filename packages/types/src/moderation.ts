/**
 * Moderation marketplace types.
 */

import { z } from 'zod'
import {
  AddressSchema,
  MAX_ARRAY_LENGTH,
  MAX_SHORT_STRING_LENGTH,
  MAX_STRING_LENGTH,
} from './validation'

export const BanType = {
  NONE: 0,
  ON_NOTICE: 1,
  CHALLENGED: 2,
  PERMANENT: 3,
} as const
export type BanType = (typeof BanType)[keyof typeof BanType]

export const BanTypeSchema = z.enum([...Object.values(BanType).map(String)] as [
  string,
  ...string[],
])

export const ReportType = {
  NETWORK_BAN: 0,
  APP_BAN: 1,
  LABEL_HACKER: 2,
  LABEL_SCAMMER: 3,
} as const
export type ReportType = (typeof ReportType)[keyof typeof ReportType]

export const SeverityLevel = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
} as const
export type SeverityLevel = (typeof SeverityLevel)[keyof typeof SeverityLevel]

export const ReportStatus = {
  PENDING: 0,
  VOTING: 1,
  RESOLVED_YES: 2,
  RESOLVED_NO: 3,
  CANCELLED: 4,
} as const
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus]

export const BanStatus = {
  NONE: 'NONE',
  ON_NOTICE: 'ON_NOTICE',
  CHALLENGED: 'CHALLENGED',
  BANNED: 'BANNED',
  CLEARED: 'CLEARED',
  APPEALING: 'APPEALING',
} as const
export type BanStatus = (typeof BanStatus)[keyof typeof BanStatus]

export const BanStatusSchema = z.enum([...Object.values(BanStatus)] as [
  string,
  ...string[],
])

export const MarketOutcome = {
  PENDING: 'PENDING',
  BAN_UPHELD: 'BAN_UPHELD',
  BAN_REJECTED: 'BAN_REJECTED',
} as const
export type MarketOutcome = (typeof MarketOutcome)[keyof typeof MarketOutcome]

export const MarketOutcomeSchema = z.enum([...Object.values(MarketOutcome)] as [
  string,
  ...string[],
])

export const VotePosition = {
  YES: 0,
  NO: 1,
} as const
export type VotePosition = (typeof VotePosition)[keyof typeof VotePosition]

export const VotePositionSchema = z.enum([
  ...Object.values(VotePosition).map(String),
] as [string, ...string[]])

export const ReputationTier = {
  UNTRUSTED: 0, // 0-1000 score: Can't report alone
  LOW: 1, // 1001-3000: Needs 3 users for quorum
  MEDIUM: 2, // 3001-6000: Needs 2 users for quorum
  HIGH: 3, // 6001-8000: Can report alone, normal stake
  TRUSTED: 4, // 8001-10000: Can report alone, reduced stake
} as const
export type ReputationTier =
  (typeof ReputationTier)[keyof typeof ReputationTier]

export const ReputationTierSchema = z.enum([
  ...Object.values(ReputationTier).map(String),
] as [string, ...string[]])
export const BanRecordSchema = z.object({
  isBanned: z.boolean(),
  banType: BanTypeSchema,
  bannedAt: z.number(),
  expiresAt: z.number(),
  reason: z.string().max(MAX_STRING_LENGTH),
  proposalId: z.string().max(MAX_SHORT_STRING_LENGTH),
  reporter: AddressSchema,
  caseId: z.string().max(MAX_SHORT_STRING_LENGTH),
})
export type BanRecord = z.infer<typeof BanRecordSchema>

export const StakeInfoSchema = z.object({
  amount: z.bigint(),
  stakedAt: z.number(),
  stakedBlock: z.number(),
  lastActivityBlock: z.number(),
  isStaked: z.boolean(),
})
export type StakeInfo = z.infer<typeof StakeInfoSchema>

export const BanCaseSchema = z.object({
  caseId: z.string(),
  reporter: AddressSchema,
  target: AddressSchema,
  reporterStake: z.bigint(),
  targetStake: z.bigint(),
  reason: z.string(),
  evidenceHash: z.string(),
  status: BanStatusSchema,
  createdAt: z.number(),
  marketOpenUntil: z.number(),
  yesVotes: z.bigint(),
  noVotes: z.bigint(),
  totalPot: z.bigint(),
  resolved: z.boolean(),
  outcome: MarketOutcomeSchema,
  appealCount: z.number(),
})
export type BanCase = z.infer<typeof BanCaseSchema>

export const VoteSchema = z.object({
  position: VotePositionSchema,
  weight: z.bigint(),
  stakedAt: z.number(),
  hasVoted: z.boolean(),
  hasClaimed: z.boolean(),
})
export type Vote = z.infer<typeof VoteSchema>

export const BanCheckResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  banType: BanTypeSchema.optional(),
  bannedAt: z.number().optional(),
  caseId: z.string().optional(),
  reporter: AddressSchema.optional(),
  canAppeal: z.boolean().optional(),
})
export type BanCheckResult = z.infer<typeof BanCheckResultSchema>

export const ModerationMarketStatsSchema = z.object({
  totalCases: z.number(),
  activeCases: z.number(),
  resolvedCases: z.number(),
  totalStaked: z.bigint(),
  totalSlashed: z.bigint(),
  averageVotingPeriod: z.number(),
})
export type ModerationMarketStats = z.infer<typeof ModerationMarketStatsSchema>

export const ModeratorReputationSchema = z.object({
  successfulBans: z.number(),
  unsuccessfulBans: z.number(),
  totalSlashedFrom: z.bigint(),
  totalSlashedOthers: z.bigint(),
  reputationScore: z.number(),
  lastReportTimestamp: z.number(),
  reportCooldownUntil: z.number(),
  tier: ReputationTierSchema,
  netPnL: z.bigint(),
})
export type ModeratorReputation = z.infer<typeof ModeratorReputationSchema>

export const ReportEvidenceSchema = z.object({
  evidenceHashes: z
    .array(z.string().max(MAX_SHORT_STRING_LENGTH))
    .max(MAX_ARRAY_LENGTH),
  notes: z.array(z.string().max(MAX_STRING_LENGTH)).max(MAX_ARRAY_LENGTH),
  category: z.string().max(MAX_SHORT_STRING_LENGTH),
  timestamp: z.number(),
})
export type ReportEvidence = z.infer<typeof ReportEvidenceSchema>

export const QuorumStatusSchema = z.object({
  reached: z.boolean(),
  currentCount: z.number(),
  requiredCount: z.number(),
  reporters: z.array(AddressSchema).max(MAX_ARRAY_LENGTH),
})
export type QuorumStatus = z.infer<typeof QuorumStatusSchema>
export const BAN_MANAGER_ABI = [
  {
    name: 'isAddressBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isOnNotice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isPermanentlyBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isAddressAccessAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'appId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAddressBan',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'isBanned', type: 'bool' },
          { name: 'banType', type: 'uint8' },
          { name: 'bannedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'proposalId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'caseId', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    name: 'isNetworkBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isAccessAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'appId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

export const MODERATION_MARKETPLACE_ABI = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'unstake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'openCase',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'reason', type: 'string' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'caseId', type: 'bytes32' }],
  },
  {
    name: 'challengeCase',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'vote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'caseId', type: 'bytes32' },
      { name: 'position', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    name: 'resolveCase',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'requestReReview',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getCase',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'caseId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'reporterStake', type: 'uint256' },
          { name: 'targetStake', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'marketOpenUntil', type: 'uint256' },
          { name: 'yesVotes', type: 'uint256' },
          { name: 'noVotes', type: 'uint256' },
          { name: 'totalPot', type: 'uint256' },
          { name: 'resolved', type: 'bool' },
          { name: 'outcome', type: 'uint8' },
          { name: 'appealCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'amount', type: 'uint256' },
          { name: 'stakedAt', type: 'uint256' },
          { name: 'stakedBlock', type: 'uint256' },
          { name: 'lastActivityBlock', type: 'uint256' },
          { name: 'isStaked', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'canReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isStakeValidForVoting',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAllCaseIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'minReporterStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'minChallengeStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getModeratorReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'moderator', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'successfulBans', type: 'uint256' },
          { name: 'unsuccessfulBans', type: 'uint256' },
          { name: 'totalSlashedFrom', type: 'uint256' },
          { name: 'totalSlashedOthers', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'lastReportTimestamp', type: 'uint256' },
          { name: 'reportCooldownUntil', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getReputationTier',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'getRequiredStakeForReporter',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reporter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getQuorumRequired',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reporter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'checkQuorumStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [
      { name: 'reached', type: 'bool' },
      { name: 'currentCount', type: 'uint256' },
      { name: 'requiredCount', type: 'uint256' },
    ],
  },
  {
    name: 'getModeratorPnL',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'moderator', type: 'address' }],
    outputs: [{ name: '', type: 'int256' }],
  },
  {
    name: 'getCaseEvidence',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'evidenceHashes', type: 'bytes32[]' },
          { name: 'notes', type: 'string[]' },
          { name: 'category', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'addEvidence',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'caseId', type: 'bytes32' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'note', type: 'string' },
    ],
    outputs: [],
  },
] as const
/**
 * Convert app name to bytes32 appId
 */
export function appNameToId(appName: string): `0x${string}` {
  // Convert string to hex without Buffer (browser compatible)
  let hex = ''
  for (let i = 0; i < appName.length; i++) {
    hex += appName.charCodeAt(i).toString(16).padStart(2, '0')
  }
  // Pad to 64 chars (32 bytes)
  hex = hex.padEnd(64, '0')
  return `0x${hex}` as `0x${string}`
}

/**
 * Get human-readable ban status
 */
export function getBanStatusLabel(status: BanStatus): string {
  switch (status) {
    case BanStatus.NONE:
      return 'Not Banned'
    case BanStatus.ON_NOTICE:
      return 'On Notice'
    case BanStatus.CHALLENGED:
      return 'Challenged'
    case BanStatus.BANNED:
      return 'Banned'
    case BanStatus.CLEARED:
      return 'Cleared'
    case BanStatus.APPEALING:
      return 'Appealing'
  }
  const _exhaustiveCheck: never = status
  throw new Error(`Unhandled BanStatus: ${_exhaustiveCheck}`)
}

/**
 * Get human-readable ban type
 */
export function getBanTypeLabel(banType: BanType): string {
  switch (banType) {
    case BanType.NONE:
      return 'None'
    case BanType.ON_NOTICE:
      return 'On Notice'
    case BanType.CHALLENGED:
      return 'Challenged'
    case BanType.PERMANENT:
      return 'Permanent'
  }
  const _exhaustiveCheck: never = banType
  throw new Error(`Unhandled BanType: ${_exhaustiveCheck}`)
}

/**
 * Calculate vote percentages
 */
export function calculateVotePercentages(
  yesVotes: bigint,
  noVotes: bigint,
): { yes: number; no: number } {
  const total = yesVotes + noVotes
  if (total === BigInt(0)) return { yes: 50, no: 50 }

  const yesPercent = Number((yesVotes * BigInt(10000)) / total) / 100
  return { yes: yesPercent, no: 100 - yesPercent }
}

/**
 * Format stake for display
 * Uses BigInt arithmetic to preserve precision for large values
 */
export function formatStake(stake: bigint): string {
  const decimals = 18n
  const divisor = 10n ** decimals
  const wholePart = stake / divisor
  const fracPart = stake % divisor

  // For very small amounts
  if (wholePart === 0n && fracPart < 10n ** 15n) {
    return '<0.001 ETH'
  }

  // Format with 3 decimal places using BigInt math
  const fracScaled = (fracPart * 1000n) / divisor
  return `${wholePart}.${fracScaled.toString().padStart(3, '0')} ETH`
}

/**
 * Calculate time remaining for voting
 */
export function getTimeRemaining(marketOpenUntil: number): {
  hours: number
  minutes: number
  expired: boolean
} {
  const now = Date.now() / 1000
  const remaining = marketOpenUntil - now

  if (remaining <= 0) {
    return { hours: 0, minutes: 0, expired: true }
  }

  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)

  return { hours, minutes, expired: false }
}

/**
 * Get human-readable reputation tier label
 */
export function getReputationTierLabel(tier: ReputationTier): string {
  switch (tier) {
    case ReputationTier.UNTRUSTED:
      return 'Untrusted'
    case ReputationTier.LOW:
      return 'Low'
    case ReputationTier.MEDIUM:
      return 'Medium'
    case ReputationTier.HIGH:
      return 'High'
    case ReputationTier.TRUSTED:
      return 'Trusted'
  }
  const _exhaustiveCheck: never = tier
  throw new Error(`Unhandled ReputationTier: ${_exhaustiveCheck}`)
}

/**
 * Get reputation tier from score
 */
export function getReputationTierFromScore(score: number): ReputationTier {
  if (score <= 1000) return ReputationTier.UNTRUSTED
  if (score <= 3000) return ReputationTier.LOW
  if (score <= 6000) return ReputationTier.MEDIUM
  if (score <= 8000) return ReputationTier.HIGH
  return ReputationTier.TRUSTED
}

/**
 * Get quorum requirement for a tier
 */
export function getQuorumForTier(tier: ReputationTier): number {
  switch (tier) {
    case ReputationTier.UNTRUSTED:
      return Infinity
    case ReputationTier.LOW:
      return 3
    case ReputationTier.MEDIUM:
      return 2
    case ReputationTier.HIGH:
      return 1
    case ReputationTier.TRUSTED:
      return 1
  }
  const _exhaustiveCheck: never = tier
  throw new Error(`Unhandled ReputationTier: ${_exhaustiveCheck}`)
}

/**
 * Format P&L for display
 * Uses BigInt arithmetic to preserve precision for large values
 */
export function formatPnL(pnl: bigint): string {
  const decimals = 18n
  const divisor = 10n ** decimals
  const isNegative = pnl < 0n
  const absPnl = isNegative ? -pnl : pnl

  const wholePart = absPnl / divisor
  const fracPart = absPnl % divisor

  // Format with 4 decimal places using BigInt math
  const fracScaled = (fracPart * 10000n) / divisor
  const sign = isNegative ? '-' : '+'
  return `${sign}${wholePart}.${fracScaled.toString().padStart(4, '0')} ETH`
}

/**
 * Calculate win rate percentage
 */
export function calculateWinRate(wins: number, losses: number): number {
  const total = wins + losses
  if (total === 0) return 50
  return Math.round((wins / total) * 100)
}

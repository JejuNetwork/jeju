/** Shared Contract Type Utilities for Factory Web */

import { isHexString } from '@jejunetwork/types'
import type { Address } from 'viem'

// Hex string type
export type Hex = `0x${string}`

// Validate and return hex string - throws if invalid
export function toHex(value: string): Hex {
  if (!isHexString(value)) {
    throw new Error(`Expected hex string, got: ${value}`)
  }
  return value
}

// Safe hex conversion that returns undefined for invalid input
export function toHexSafe(value: string | undefined): Hex | undefined {
  if (!value || !isHexString(value)) return undefined
  return value
}

// Zero bytes32
export const ZERO_BYTES32: Hex = `0x${'0'.repeat(64)}`

// Check if bytes32 is zero
export function isZeroBytes32(value: string): boolean {
  return value === ZERO_BYTES32
}

// DAO Pool return type from contract
export interface DAOPoolTuple {
  daoId: Hex
  token: Address
  totalAccumulated: bigint
  contributorPool: bigint
  dependencyPool: bigint
  reservePool: bigint
  lastDistributedEpoch: bigint
  epochStartTime: bigint
}

// Funding Epoch return type from contract
export interface FundingEpochTuple {
  epochId: bigint
  daoId: Hex
  startTime: bigint
  endTime: bigint
  totalContributorRewards: bigint
  totalDependencyRewards: bigint
  totalDistributed: bigint
  finalized: boolean
}

// Contributor Share return type from contract
export interface ContributorShareTuple {
  contributorId: Hex
  weight: bigint
  pendingRewards: bigint
  claimedRewards: bigint
  lastClaimEpoch: bigint
}

// Dependency Share return type from contract
export interface DependencyShareTuple {
  depHash: Hex
  contributorId: Hex
  weight: bigint
  transitiveDepth: bigint
  usageCount: bigint
  pendingRewards: bigint
  claimedRewards: bigint
  isRegistered: boolean
}

// Fee Distribution Config return type from contract
export interface FeeDistributionConfigTuple {
  treasuryBps: bigint
  contributorPoolBps: bigint
  dependencyPoolBps: bigint
  jejuBps: bigint
  burnBps: bigint
  reserveBps: bigint
}

// Weight Vote return type from contract
export interface WeightVoteTuple {
  voter: Address
  targetId: Hex
  weightAdjustment: bigint
  reason: string
  reputation: bigint
  votedAt: bigint
}

// Payment Request return type from contract
export interface PaymentRequestTuple {
  requestId: Hex
  daoId: Hex
  requester: Address
  contributorId: Hex
  category: number
  title: string
  description: string
  evidenceUri: string
  paymentToken: Address
  requestedAmount: bigint
  approvedAmount: bigint
  status: number
  isRetroactive: boolean
  workStartDate: bigint
  workEndDate: bigint
  createdAt: bigint
  resolvedAt: bigint
  paidAt: bigint
  councilReason: string
  ceoReason: string
}

// Council vote return type from contract
export interface CouncilVoteTuple {
  voter: Address
  voteType: number
  reason: string
  votedAt: bigint
}

// CEO decision return type from contract
export interface CEODecisionTuple {
  approved: boolean
  modifiedAmount: bigint
  reason: string
  decidedAt: bigint
}

// Payment config return type from contract
export interface PaymentConfigTuple {
  minCouncilVotes: bigint
  councilVotePeriod: bigint
  ceoVotePeriod: bigint
  paymentCooldown: bigint
  maxRequestAmount: bigint
  councilThresholdBps: bigint
  autoApproveThresholdBps: bigint
}

// Contributor return type from contract
export interface ContributorTuple {
  contributorId: Hex
  wallet: Address
  contributorType: number
  profileUri: string
  registeredAt: bigint
  isVerified: boolean
  reputationScore: bigint
  totalEarnings: bigint
}

// Social link return type from contract
export interface SocialLinkTuple {
  platform: Hex
  handle: string
  isVerified: boolean
}

// Repository claim return type from contract
export interface RepositoryClaimTuple {
  owner: string
  repo: string
  isVerified: boolean
  claimedAt: bigint
}

// Dependency claim return type from contract
export interface DependencyClaimTuple {
  packageName: string
  registryType: string
  isVerified: boolean
  claimedAt: bigint
}

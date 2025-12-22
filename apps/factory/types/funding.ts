/**
 * Funding system types for Factory app
 */

import type { Address } from 'viem'

export type ContributorType = 'individual' | 'organization' | 'agent'

export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'expired'

export type SocialPlatform = 'github' | 'discord' | 'twitter' | 'farcaster'

export interface ContributorProfile {
  contributorId: string
  wallet: Address
  agentId: bigint
  contributorType: ContributorType
  profileUri: string
  totalEarned: bigint
  registeredAt: number
  lastActiveAt: number
  active: boolean
}

export interface SocialLink {
  platform: SocialPlatform
  handle: string
  proofHash: string
  status: VerificationStatus
  verifiedAt: number
  expiresAt: number
}

export interface RepositoryClaim {
  claimId: string
  contributorId: string
  owner: string
  repo: string
  proofHash: string
  status: VerificationStatus
  claimedAt: number
  verifiedAt: number
}

export interface DependencyClaim {
  claimId: string
  contributorId: string
  packageName: string
  registryType: 'npm' | 'crates' | 'pypi' | 'go' | 'maven'
  proofHash: string
  status: VerificationStatus
  claimedAt: number
  verifiedAt: number
}

export interface DAOPool {
  daoId: string
  token: Address
  totalAccumulated: bigint
  contributorPool: bigint
  dependencyPool: bigint
  reservePool: bigint
  lastDistributedEpoch: number
  epochStartTime: number
}

export interface FundingEpoch {
  epochId: number
  daoId: string
  startTime: number
  endTime: number
  totalContributorRewards: bigint
  totalDependencyRewards: bigint
  totalDistributed: bigint
  finalized: boolean
}

export interface ContributorShare {
  contributorId: string
  weight: number
  pendingRewards: bigint
  claimedRewards: bigint
  lastClaimEpoch: number
}

export interface DependencyShare {
  depHash: string
  contributorId: string
  weight: number
  transitiveDepth: number
  usageCount: number
  pendingRewards: bigint
  claimedRewards: bigint
  isRegistered: boolean
}

export interface FeeDistributionConfig {
  treasuryBps: number
  contributorPoolBps: number
  dependencyPoolBps: number
  jejuBps: number
  burnBps: number
  reserveBps: number
}

export interface WeightVote {
  voter: Address
  targetId: string
  weightAdjustment: number
  reason: string
  reputation: number
  votedAt: number
}

export type PaymentCategory =
  | 'development'
  | 'design'
  | 'marketing'
  | 'operations'
  | 'research'
  | 'other'

export type PaymentStatus =
  | 'pending'
  | 'council_review'
  | 'ceo_review'
  | 'approved'
  | 'rejected'
  | 'paid'
  | 'disputed'
  | 'cancelled'

export type VoteType = 'approve' | 'reject' | 'abstain'

export interface PaymentRequest {
  requestId: string
  daoId: string
  requester: Address
  contributorId: string
  category: PaymentCategory
  title: string
  description: string
  evidenceUri: string
  paymentToken: Address
  requestedAmount: bigint
  approvedAmount: bigint
  status: PaymentStatus
  isRetroactive: boolean
  workStartDate: number
  workEndDate: number
  submittedAt: number
  reviewedAt: number
  paidAt: number
  rejectionReason: string
  disputeCaseId: string
}

export interface CouncilVote {
  voter: Address
  vote: VoteType
  reason: string
  votedAt: number
}

export interface CEODecision {
  approved: boolean
  modifiedAmount: bigint
  reason: string
  decidedAt: number
}

export interface DAOPaymentConfig {
  requiresCouncilApproval: boolean
  minCouncilVotes: number
  councilSupermajorityBps: number
  ceoCanOverride: boolean
  maxAutoApproveAmount: bigint
  reviewPeriod: number
  disputePeriod: number
  treasuryToken: Address
  allowRetroactive: boolean
  retroactiveMaxAge: number
}

export function parseContributorType(index: number): ContributorType {
  const types: ContributorType[] = ['individual', 'organization', 'agent']
  return types[index] || 'individual'
}

export function getContributorTypeIndex(type: ContributorType): number {
  const types: ContributorType[] = ['individual', 'organization', 'agent']
  return types.indexOf(type)
}

export function parseVerificationStatus(index: number): VerificationStatus {
  const statuses: VerificationStatus[] = [
    'pending',
    'verified',
    'rejected',
    'expired',
  ]
  return statuses[index] || 'pending'
}

export function parsePaymentCategory(index: number): PaymentCategory {
  const categories: PaymentCategory[] = [
    'development',
    'design',
    'marketing',
    'operations',
    'research',
    'other',
  ]
  return categories[index] || 'other'
}

export function getPaymentCategoryIndex(category: PaymentCategory): number {
  const categories: PaymentCategory[] = [
    'development',
    'design',
    'marketing',
    'operations',
    'research',
    'other',
  ]
  return categories.indexOf(category)
}

export function parsePaymentStatus(index: number): PaymentStatus {
  const statuses: PaymentStatus[] = [
    'pending',
    'council_review',
    'ceo_review',
    'approved',
    'rejected',
    'paid',
    'disputed',
    'cancelled',
  ]
  return statuses[index] || 'pending'
}

export function parseVoteType(index: number): VoteType {
  const types: VoteType[] = ['approve', 'reject', 'abstain']
  return types[index] || 'abstain'
}

export function getVoteTypeIndex(type: VoteType): number {
  const types: VoteType[] = ['approve', 'reject', 'abstain']
  return types.indexOf(type)
}

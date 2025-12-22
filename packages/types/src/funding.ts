/**
 * @module types/funding
 * @description Shared types for deep funding system
 * Used by contracts, services, and frontend
 */

import type { Address } from 'viem'

// ============ Contributor Types ============

export type ContributorType = 'INDIVIDUAL' | 'ORGANIZATION' | 'PROJECT'
export const CONTRIBUTOR_TYPES: ContributorType[] = [
  'INDIVIDUAL',
  'ORGANIZATION',
  'PROJECT',
]

export type VerificationStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REVOKED'
export const VERIFICATION_STATUSES: VerificationStatus[] = [
  'UNVERIFIED',
  'PENDING',
  'VERIFIED',
  'REVOKED',
]

export type SocialPlatform = 'github' | 'discord' | 'twitter' | 'farcaster'
export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  'github',
  'discord',
  'twitter',
  'farcaster',
]

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
  registryType: RegistryType
  proofHash: string
  status: VerificationStatus
  claimedAt: number
  verifiedAt: number
}

export interface DAOContribution {
  daoId: string
  totalEarned: bigint
  bountyCount: number
  paymentRequestCount: number
  lastContributionAt: number
}

// ============ Payment Request Types ============

export type PaymentCategory =
  | 'MARKETING'
  | 'COMMUNITY_MANAGEMENT'
  | 'OPERATIONS'
  | 'DOCUMENTATION'
  | 'DESIGN'
  | 'SUPPORT'
  | 'RESEARCH'
  | 'PARTNERSHIP'
  | 'EVENTS'
  | 'INFRASTRUCTURE'
  | 'OTHER'

export const PAYMENT_CATEGORIES: PaymentCategory[] = [
  'MARKETING',
  'COMMUNITY_MANAGEMENT',
  'OPERATIONS',
  'DOCUMENTATION',
  'DESIGN',
  'SUPPORT',
  'RESEARCH',
  'PARTNERSHIP',
  'EVENTS',
  'INFRASTRUCTURE',
  'OTHER',
]

export const PAYMENT_CATEGORY_DISPLAY: Record<
  PaymentCategory,
  { label: string; icon: string; color: string }
> = {
  MARKETING: { label: 'Marketing', icon: '📣', color: 'text-pink-400' },
  COMMUNITY_MANAGEMENT: {
    label: 'Community',
    icon: '👥',
    color: 'text-blue-400',
  },
  OPERATIONS: { label: 'Operations', icon: '⚙️', color: 'text-slate-400' },
  DOCUMENTATION: {
    label: 'Documentation',
    icon: '📚',
    color: 'text-amber-400',
  },
  DESIGN: { label: 'Design', icon: '🎨', color: 'text-purple-400' },
  SUPPORT: { label: 'Support', icon: '🎧', color: 'text-teal-400' },
  RESEARCH: { label: 'Research', icon: '🔬', color: 'text-cyan-400' },
  PARTNERSHIP: { label: 'Partnership', icon: '🤝', color: 'text-orange-400' },
  EVENTS: { label: 'Events', icon: '🎉', color: 'text-rose-400' },
  INFRASTRUCTURE: {
    label: 'Infrastructure',
    icon: '🏗️',
    color: 'text-emerald-400',
  },
  OTHER: { label: 'Other', icon: '📦', color: 'text-slate-400' },
}

export type PaymentRequestStatus =
  | 'SUBMITTED'
  | 'COUNCIL_REVIEW'
  | 'CEO_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'DISPUTED'
  | 'CANCELLED'

export const PAYMENT_REQUEST_STATUSES: PaymentRequestStatus[] = [
  'SUBMITTED',
  'COUNCIL_REVIEW',
  'CEO_REVIEW',
  'APPROVED',
  'REJECTED',
  'PAID',
  'DISPUTED',
  'CANCELLED',
]

export const PAYMENT_STATUS_DISPLAY: Record<
  PaymentRequestStatus,
  { label: string; bgClass: string; textClass: string }
> = {
  SUBMITTED: {
    label: 'Submitted',
    bgClass: 'bg-slate-500/20',
    textClass: 'text-slate-400',
  },
  COUNCIL_REVIEW: {
    label: 'Council Review',
    bgClass: 'bg-amber-500/20',
    textClass: 'text-amber-400',
  },
  CEO_REVIEW: {
    label: 'CEO Review',
    bgClass: 'bg-purple-500/20',
    textClass: 'text-purple-400',
  },
  APPROVED: {
    label: 'Approved',
    bgClass: 'bg-emerald-500/20',
    textClass: 'text-emerald-400',
  },
  REJECTED: {
    label: 'Rejected',
    bgClass: 'bg-rose-500/20',
    textClass: 'text-rose-400',
  },
  PAID: {
    label: 'Paid',
    bgClass: 'bg-indigo-500/20',
    textClass: 'text-indigo-400',
  },
  DISPUTED: {
    label: 'Disputed',
    bgClass: 'bg-orange-500/20',
    textClass: 'text-orange-400',
  },
  CANCELLED: {
    label: 'Cancelled',
    bgClass: 'bg-slate-500/20',
    textClass: 'text-slate-500',
  },
}

export type VoteType = 'APPROVE' | 'REJECT' | 'ABSTAIN'
export const VOTE_TYPES: VoteType[] = ['APPROVE', 'REJECT', 'ABSTAIN']

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
  status: PaymentRequestStatus
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

// ============ Deep Funding Types ============

export interface FeeDistributionConfig {
  treasuryBps: number
  contributorPoolBps: number
  dependencyPoolBps: number
  jejuBps: number
  burnBps: number
  reserveBps: number
}

export const DEFAULT_FEE_CONFIG: FeeDistributionConfig = {
  treasuryBps: 3000,
  contributorPoolBps: 4000,
  dependencyPoolBps: 2000,
  jejuBps: 500,
  burnBps: 0,
  reserveBps: 500,
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

export interface WeightVote {
  voter: Address
  targetId: string
  weightAdjustment: number
  reason: string
  reputation: number
  votedAt: number
}

// ============ Dependency Scanner Types ============

export type RegistryType = 'npm' | 'pypi' | 'cargo' | 'go' | 'unknown'
export const REGISTRY_TYPES: RegistryType[] = [
  'npm',
  'pypi',
  'cargo',
  'go',
  'unknown',
]

export interface PackageInfo {
  name: string
  version: string
  registryType: RegistryType
  depth: number
  usageCount: number
  directDependents: string[]
  maintainers: string[]
  repository?: string
  license?: string
}

export interface DependencyNode {
  name: string
  version: string
  registryType: RegistryType
  depth: number
  dependencies: DependencyNode[]
  metadata?: PackageMetadata
}

export interface PackageMetadata {
  description?: string
  homepage?: string
  repository?: string
  maintainers: string[]
  license?: string
  downloads?: number
  stars?: number
}

export interface DependencyWeight {
  packageName: string
  registryType: RegistryType
  rawWeight: number
  adjustedWeight: number
  depth: number
  usageCount: number
  registeredContributorId?: string
}

export interface ScanResult {
  repoOwner: string
  repoName: string
  scannedAt: number
  totalDependencies: number
  directDependencies: number
  transitiveDependencies: number
  dependencies: DependencyWeight[]
  registeredDependencies: number
  unregisteredDependencies: number
  totalWeight: number
}

// ============ Funding Constants ============

export const MAX_BPS = 10000
export const DEPTH_DECAY_BPS = 2000 // 20% decay per level
export const MAX_DELIBERATION_INFLUENCE_BPS = 1000 // 10% max influence
export const MIN_WEIGHT_FOR_DISTRIBUTION = 10
export const DEFAULT_EPOCH_DURATION = 30 * 24 * 60 * 60 // 30 days in seconds
export const COUNCIL_REVIEW_PERIOD = 7 * 24 * 60 * 60 // 7 days
export const DEFAULT_SUPERMAJORITY_BPS = 6700 // 67%

// ============ Utility Functions ============

export function getContributorTypeIndex(type: ContributorType): number {
  return CONTRIBUTOR_TYPES.indexOf(type)
}

export function parseContributorType(index: number): ContributorType {
  return CONTRIBUTOR_TYPES[index] || 'INDIVIDUAL'
}

export function getVerificationStatusIndex(status: VerificationStatus): number {
  return VERIFICATION_STATUSES.indexOf(status)
}

export function parseVerificationStatus(index: number): VerificationStatus {
  return VERIFICATION_STATUSES[index] || 'UNVERIFIED'
}

export function getPaymentCategoryIndex(category: PaymentCategory): number {
  return PAYMENT_CATEGORIES.indexOf(category)
}

export function parsePaymentCategory(index: number): PaymentCategory {
  return PAYMENT_CATEGORIES[index] || 'OTHER'
}

export function getPaymentStatusIndex(status: PaymentRequestStatus): number {
  return PAYMENT_REQUEST_STATUSES.indexOf(status)
}

export function parsePaymentStatus(index: number): PaymentRequestStatus {
  return PAYMENT_REQUEST_STATUSES[index] || 'SUBMITTED'
}

export function getVoteTypeIndex(vote: VoteType): number {
  return VOTE_TYPES.indexOf(vote)
}

export function parseVoteType(index: number): VoteType {
  return VOTE_TYPES[index] || 'ABSTAIN'
}

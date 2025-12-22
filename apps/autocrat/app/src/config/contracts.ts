import type { Address } from 'viem'

// Contract addresses from environment
const NETWORK = process.env.PUBLIC_NETWORK || 'testnet'

interface ContractAddresses {
  banManager: Address
  moderationMarketplace: Address
  reputationLabelManager: Address
  reportingSystem: Address
  predimarket: Address
  registryGovernance: Address
  identityRegistry: Address
  evidenceRegistry: Address
  reputationProviderRegistry: Address
}

const TESTNET_CONTRACTS: ContractAddresses = {
  banManager: (process.env.PUBLIC_BAN_MANAGER ||
    '0x0000000000000000000000000000000000000000') as Address,
  moderationMarketplace: (process.env.PUBLIC_MODERATION_MARKETPLACE ||
    '0x0000000000000000000000000000000000000000') as Address,
  reputationLabelManager: (process.env.PUBLIC_REPUTATION_LABEL_MANAGER ||
    '0x0000000000000000000000000000000000000000') as Address,
  reportingSystem: (process.env.PUBLIC_REPORTING_SYSTEM ||
    '0x0000000000000000000000000000000000000000') as Address,
  predimarket: (process.env.PUBLIC_PREDIMARKET ||
    '0x0000000000000000000000000000000000000000') as Address,
  registryGovernance: (process.env.PUBLIC_REGISTRY_GOVERNANCE ||
    '0x0000000000000000000000000000000000000000') as Address,
  identityRegistry: (process.env.PUBLIC_IDENTITY_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  evidenceRegistry: (process.env.PUBLIC_EVIDENCE_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  reputationProviderRegistry: (process.env
    .PUBLIC_REPUTATION_PROVIDER_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
}

const MAINNET_CONTRACTS: ContractAddresses = {
  ...TESTNET_CONTRACTS,
  // Override with mainnet addresses when deployed
}

export const CONTRACTS =
  NETWORK === 'mainnet' ? MAINNET_CONTRACTS : TESTNET_CONTRACTS

export const MODERATION_CONTRACTS = {
  BanManager: CONTRACTS.banManager,
  ModerationMarketplace: CONTRACTS.moderationMarketplace,
  ReputationLabelManager: CONTRACTS.reputationLabelManager,
  ReportingSystem: CONTRACTS.reportingSystem,
  Predimarket: CONTRACTS.predimarket,
  RegistryGovernance: CONTRACTS.registryGovernance,
  IdentityRegistry: CONTRACTS.identityRegistry,
  EvidenceRegistry: CONTRACTS.evidenceRegistry,
  ReputationProviderRegistry: CONTRACTS.reputationProviderRegistry,
} as const

export const MODERATION_CONFIG = {
  // Moderation Marketplace settings
  minReporterStake: '0.01', // ETH required to report
  minChallengeStake: '0.01', // ETH to challenge a ban
  minEvidenceStake: '0.001', // ETH to submit evidence
  minStakeAge: 24 * 3600, // 24 hours before voting power
  defaultVotingPeriod: 3 * 24 * 3600, // 3 days
  appealVotingPeriod: 7 * 24 * 3600, // 7 days for appeals
  challengePeriod: 7 * 24 * 3600, // 7 days for provider proposals
  timelockPeriod: 2 * 24 * 3600, // 2 days timelock
  reReviewMultiplier: 10, // 10x stake required for re-review
  maxAppeals: 3, // Max re-reviews allowed

  // Reward distribution (basis points)
  winnerShareBps: 9000, // 90% to winner
  treasuryShareBps: 500, // 5% to treasury
  marketMakerShareBps: 500, // 5% to market makers

  // Report bonds
  reportBonds: {
    LOW: '0.001',
    MEDIUM: '0.01',
    HIGH: '0.05',
    CRITICAL: '0.1',
  },
  votingPeriods: {
    LOW: 7 * 24 * 3600,
    MEDIUM: 3 * 24 * 3600,
    HIGH: 24 * 3600,
    CRITICAL: 24 * 3600,
  },
} as const

// Ban types for display
export const BanType = {
  NONE: 0,
  ON_NOTICE: 1,
  CHALLENGED: 2,
  PERMANENT: 3,
} as const
export type BanType = (typeof BanType)[keyof typeof BanType]

export const BAN_TYPE_LABELS: Record<BanType, string> = {
  [BanType.NONE]: 'Not Banned',
  [BanType.ON_NOTICE]: 'On Notice (Pending Review)',
  [BanType.CHALLENGED]: 'Challenged (Market Active)',
  [BanType.PERMANENT]: 'Permanently Banned',
}

export const BAN_TYPE_COLORS: Record<BanType, string> = {
  [BanType.NONE]: 'text-green-600 bg-green-50',
  [BanType.ON_NOTICE]: 'text-yellow-600 bg-yellow-50',
  [BanType.CHALLENGED]: 'text-orange-600 bg-orange-50',
  [BanType.PERMANENT]: 'text-red-600 bg-red-50',
}

// Evidence position types
export const EvidencePosition = {
  FOR_ACTION: 0,
  AGAINST_ACTION: 1,
} as const
export type EvidencePosition =
  (typeof EvidencePosition)[keyof typeof EvidencePosition]

export const EVIDENCE_POSITION_LABELS: Record<EvidencePosition, string> = {
  [EvidencePosition.FOR_ACTION]: 'Supports Action',
  [EvidencePosition.AGAINST_ACTION]: 'Opposes Action',
}

// Proposal types for reputation providers
export const ProviderProposalType = {
  ADD_PROVIDER: 0,
  REMOVE_PROVIDER: 1,
  UPDATE_WEIGHT: 2,
  SUSPEND_PROVIDER: 3,
  UNSUSPEND_PROVIDER: 4,
} as const
export type ProviderProposalType =
  (typeof ProviderProposalType)[keyof typeof ProviderProposalType]

export const PROPOSAL_TYPE_LABELS: Record<ProviderProposalType, string> = {
  [ProviderProposalType.ADD_PROVIDER]: 'Add Provider',
  [ProviderProposalType.REMOVE_PROVIDER]: 'Remove Provider',
  [ProviderProposalType.UPDATE_WEIGHT]: 'Update Weight',
  [ProviderProposalType.SUSPEND_PROVIDER]: 'Suspend Provider',
  [ProviderProposalType.UNSUSPEND_PROVIDER]: 'Unsuspend Provider',
}

// Proposal status
export const ProposalStatus = {
  PENDING: 0,
  COUNCIL_REVIEW: 1,
  APPROVED: 2,
  REJECTED: 3,
  EXECUTED: 4,
  CANCELLED: 5,
} as const
export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus]

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  [ProposalStatus.PENDING]: 'Challenge Period',
  [ProposalStatus.COUNCIL_REVIEW]: 'Council Review',
  [ProposalStatus.APPROVED]: 'Approved (Timelock)',
  [ProposalStatus.REJECTED]: 'Rejected',
  [ProposalStatus.EXECUTED]: 'Executed',
  [ProposalStatus.CANCELLED]: 'Cancelled',
}

export const PROPOSAL_STATUS_COLORS: Record<ProposalStatus, string> = {
  [ProposalStatus.PENDING]: 'text-blue-600 bg-blue-50',
  [ProposalStatus.COUNCIL_REVIEW]: 'text-purple-600 bg-purple-50',
  [ProposalStatus.APPROVED]: 'text-green-600 bg-green-50',
  [ProposalStatus.REJECTED]: 'text-red-600 bg-red-50',
  [ProposalStatus.EXECUTED]: 'text-gray-600 bg-gray-50',
  [ProposalStatus.CANCELLED]: 'text-gray-400 bg-gray-50',
}

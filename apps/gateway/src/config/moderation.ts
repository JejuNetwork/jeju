import { CONTRACTS } from './index';

export const MODERATION_CONTRACTS = {
  BanManager: CONTRACTS.banManager,
  ModerationMarketplace: CONTRACTS.moderationMarketplace,
  ReputationLabelManager: CONTRACTS.reputationLabelManager,
  ReportingSystem: CONTRACTS.reportingSystem,
  Predimarket: CONTRACTS.predimarket,
  RegistryGovernance: CONTRACTS.registryGovernance,
  IdentityRegistry: CONTRACTS.identityRegistry,
} as const;

export const MODERATION_CONFIG = {
  // Moderation Marketplace settings
  minReporterStake: '0.01',        // ETH required to report
  minChallengeStake: '0.01',       // ETH to challenge a ban
  minStakeAge: 24 * 3600,          // 24 hours before voting power
  defaultVotingPeriod: 3 * 24 * 3600,  // 3 days
  appealVotingPeriod: 7 * 24 * 3600,   // 7 days for appeals
  reReviewMultiplier: 10,          // 10x stake required for re-review
  maxAppeals: 3,                   // Max re-reviews allowed

  // Reward distribution (basis points)
  winnerShareBps: 9000,            // 90% to winner
  treasuryShareBps: 500,           // 5% to treasury
  marketMakerShareBps: 500,        // 5% to market makers

  // Legacy report bonds
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
} as const;

// Ban types for display
export enum BanType {
  NONE = 0,
  ON_NOTICE = 1,
  CHALLENGED = 2,
  PERMANENT = 3
}

export const BAN_TYPE_LABELS: Record<BanType, string> = {
  [BanType.NONE]: 'Not Banned',
  [BanType.ON_NOTICE]: 'On Notice (Pending Review)',
  [BanType.CHALLENGED]: 'Challenged (Market Active)',
  [BanType.PERMANENT]: 'Permanently Banned',
};

export const BAN_TYPE_COLORS: Record<BanType, string> = {
  [BanType.NONE]: 'text-green-600 bg-green-50',
  [BanType.ON_NOTICE]: 'text-yellow-600 bg-yellow-50',
  [BanType.CHALLENGED]: 'text-orange-600 bg-orange-50',
  [BanType.PERMANENT]: 'text-red-600 bg-red-50',
};


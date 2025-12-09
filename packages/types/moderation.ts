/**
 * Moderation Marketplace Types
 * Shared types for ban checking and moderation across all Jeju apps
 */

// ============ Enums ============

export enum BanType {
  NONE = 0,
  ON_NOTICE = 1,    // Immediate flag, pending market
  CHALLENGED = 2,   // Target staked, market active
  PERMANENT = 3     // Market resolved, ban confirmed
}

export enum BanStatus {
  NONE = 'NONE',
  ON_NOTICE = 'ON_NOTICE',
  CHALLENGED = 'CHALLENGED',
  BANNED = 'BANNED',
  CLEARED = 'CLEARED',
  APPEALING = 'APPEALING'
}

export enum MarketOutcome {
  PENDING = 'PENDING',
  BAN_UPHELD = 'BAN_UPHELD',
  BAN_REJECTED = 'BAN_REJECTED'
}

export enum VotePosition {
  YES = 0,
  NO = 1
}

// ============ Interfaces ============

export interface BanRecord {
  isBanned: boolean;
  banType: BanType;
  bannedAt: number;
  expiresAt: number;
  reason: string;
  proposalId: string;
  reporter: string;
  caseId: string;
}

export interface StakeInfo {
  amount: bigint;
  stakedAt: number;
  stakedBlock: number;
  lastActivityBlock: number;
  isStaked: boolean;
}

export interface BanCase {
  caseId: string;
  reporter: string;
  target: string;
  reporterStake: bigint;
  targetStake: bigint;
  reason: string;
  evidenceHash: string;
  status: BanStatus;
  createdAt: number;
  marketOpenUntil: number;
  yesVotes: bigint;
  noVotes: bigint;
  totalPot: bigint;
  resolved: boolean;
  outcome: MarketOutcome;
  appealCount: number;
}

export interface Vote {
  position: VotePosition;
  weight: bigint;
  stakedAt: number;
  hasVoted: boolean;
  hasClaimed: boolean;
}

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  banType?: BanType;
  bannedAt?: number;
  caseId?: string;
  reporter?: string;
  canAppeal?: boolean;
}

export interface ModerationMarketStats {
  totalCases: number;
  activeCases: number;
  resolvedCases: number;
  totalStaked: bigint;
  totalSlashed: bigint;
  averageVotingPeriod: number;
}

// ============ Contract ABIs ============

export const BAN_MANAGER_ABI = [
  {
    name: 'isAddressBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'isOnNotice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'isPermanentlyBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'isAddressAccessAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'appId', type: 'bytes32' }
    ],
    outputs: [{ name: '', type: 'bool' }]
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
          { name: 'caseId', type: 'bytes32' }
        ]
      }
    ]
  },
  {
    name: 'isNetworkBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'isAccessAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'appId', type: 'bytes32' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

export const MODERATION_MARKETPLACE_ABI = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    name: 'unstake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    name: 'openCase',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'reason', type: 'string' },
      { name: 'evidenceHash', type: 'bytes32' }
    ],
    outputs: [{ name: 'caseId', type: 'bytes32' }]
  },
  {
    name: 'challengeCase',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: []
  },
  {
    name: 'vote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'caseId', type: 'bytes32' },
      { name: 'position', type: 'uint8' }
    ],
    outputs: []
  },
  {
    name: 'resolveCase',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: []
  },
  {
    name: 'requestReReview',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: []
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
          { name: 'appealCount', type: 'uint256' }
        ]
      }
    ]
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
          { name: 'isStaked', type: 'bool' }
        ]
      }
    ]
  },
  {
    name: 'canReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'isBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'isStakeValidForVoting',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'getAllCaseIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }]
  },
  {
    name: 'minReporterStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'minChallengeStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

// ============ Helper Functions ============

/**
 * Convert app name to bytes32 appId
 */
export function appNameToId(appName: string): `0x${string}` {
  const hex = Buffer.from(appName).toString('hex').padEnd(64, '0');
  return `0x${hex}` as `0x${string}`;
}

/**
 * Get human-readable ban status
 */
export function getBanStatusLabel(status: BanStatus): string {
  switch (status) {
    case BanStatus.NONE: return 'Not Banned';
    case BanStatus.ON_NOTICE: return 'On Notice';
    case BanStatus.CHALLENGED: return 'Challenged';
    case BanStatus.BANNED: return 'Banned';
    case BanStatus.CLEARED: return 'Cleared';
    case BanStatus.APPEALING: return 'Appealing';
    default: return 'Unknown';
  }
}

/**
 * Get human-readable ban type
 */
export function getBanTypeLabel(banType: BanType): string {
  switch (banType) {
    case BanType.NONE: return 'None';
    case BanType.ON_NOTICE: return 'On Notice';
    case BanType.CHALLENGED: return 'Challenged';
    case BanType.PERMANENT: return 'Permanent';
    default: return 'Unknown';
  }
}

/**
 * Calculate vote percentages
 */
export function calculateVotePercentages(yesVotes: bigint, noVotes: bigint): { yes: number; no: number } {
  const total = yesVotes + noVotes;
  if (total === 0n) return { yes: 50, no: 50 };
  
  const yesPercent = Number((yesVotes * 10000n) / total) / 100;
  return { yes: yesPercent, no: 100 - yesPercent };
}

/**
 * Format stake for display
 */
export function formatStake(stake: bigint): string {
  const eth = Number(stake) / 1e18;
  if (eth < 0.001) return '<0.001 ETH';
  return `${eth.toFixed(3)} ETH`;
}

/**
 * Calculate time remaining for voting
 */
export function getTimeRemaining(marketOpenUntil: number): { hours: number; minutes: number; expired: boolean } {
  const now = Date.now() / 1000;
  const remaining = marketOpenUntil - now;
  
  if (remaining <= 0) {
    return { hours: 0, minutes: 0, expired: true };
  }
  
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  
  return { hours, minutes, expired: false };
}


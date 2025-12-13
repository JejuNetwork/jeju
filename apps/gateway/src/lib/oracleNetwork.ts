import { Address } from 'viem';
import { CHAIN_ID } from '../config';

const ORACLE_ADDRESSES: Record<number, {
  feedRegistry: Address;
  reportVerifier: Address;
  committeeManager: Address;
  feeRouter: Address;
}> = {
  // Base Sepolia
  84532: {
    feedRegistry: '0x0000000000000000000000000000000000000000',
    reportVerifier: '0x0000000000000000000000000000000000000000',
    committeeManager: '0x0000000000000000000000000000000000000000',
    feeRouter: '0x0000000000000000000000000000000000000000',
  },
  // Jeju Localnet
  1337: {
    feedRegistry: '0x0000000000000000000000000000000000000000',
    reportVerifier: '0x0000000000000000000000000000000000000000',
    committeeManager: '0x0000000000000000000000000000000000000000',
    feeRouter: '0x0000000000000000000000000000000000000000',
  },
};

export function getOracleAddresses() {
  return ORACLE_ADDRESSES[CHAIN_ID] ?? ORACLE_ADDRESSES[84532];
}

export const FEED_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'createFeed',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'symbol', type: 'string' },
          { name: 'baseToken', type: 'address' },
          { name: 'quoteToken', type: 'address' },
          { name: 'decimals', type: 'uint8' },
          { name: 'heartbeatSeconds', type: 'uint32' },
          { name: 'twapWindowSeconds', type: 'uint32' },
          { name: 'minLiquidityUSD', type: 'uint256' },
          { name: 'maxDeviationBps', type: 'uint16' },
          { name: 'minOracles', type: 'uint8' },
          { name: 'quorumThreshold', type: 'uint8' },
          { name: 'requiresConfidence', type: 'bool' },
          { name: 'category', type: 'uint8' },
        ],
      },
    ],
    outputs: [{ name: 'feedId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getFeed',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'feedId', type: 'bytes32' },
          { name: 'symbol', type: 'string' },
          { name: 'baseToken', type: 'address' },
          { name: 'quoteToken', type: 'address' },
          { name: 'decimals', type: 'uint8' },
          { name: 'heartbeatSeconds', type: 'uint32' },
          { name: 'twapWindowSeconds', type: 'uint32' },
          { name: 'minLiquidityUSD', type: 'uint256' },
          { name: 'maxDeviationBps', type: 'uint16' },
          { name: 'minOracles', type: 'uint8' },
          { name: 'quorumThreshold', type: 'uint8' },
          { name: 'isActive', type: 'bool' },
          { name: 'requiresConfidence', type: 'bool' },
          { name: 'category', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFeedBySymbol',
    inputs: [{ name: 'symbol', type: 'string' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'feedId', type: 'bytes32' },
          { name: 'symbol', type: 'string' },
          { name: 'baseToken', type: 'address' },
          { name: 'quoteToken', type: 'address' },
          { name: 'decimals', type: 'uint8' },
          { name: 'heartbeatSeconds', type: 'uint32' },
          { name: 'twapWindowSeconds', type: 'uint32' },
          { name: 'minLiquidityUSD', type: 'uint256' },
          { name: 'maxDeviationBps', type: 'uint16' },
          { name: 'minOracles', type: 'uint8' },
          { name: 'quorumThreshold', type: 'uint8' },
          { name: 'isActive', type: 'bool' },
          { name: 'requiresConfidence', type: 'bool' },
          { name: 'category', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllFeeds',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveFeeds',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalFeeds',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feedExists',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isFeedActive',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

// ============ Report Verifier ABI ============

export const REPORT_VERIFIER_ABI = [
  {
    type: 'function',
    name: 'getLatestPrice',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'confidence', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'isValid', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getConsensusPrice',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'price', type: 'uint256' },
          { name: 'confidence', type: 'uint256' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'round', type: 'uint256' },
          { name: 'oracleCount', type: 'uint256' },
          { name: 'reportHash', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentRound',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isPriceValid',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isPriceStale',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getHistoricalPrice',
    inputs: [
      { name: 'feedId', type: 'bytes32' },
      { name: 'round', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'price', type: 'uint256' },
          { name: 'confidence', type: 'uint256' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'round', type: 'uint256' },
          { name: 'oracleCount', type: 'uint256' },
          { name: 'reportHash', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// ============ Committee Manager ABI ============

export const COMMITTEE_MANAGER_ABI = [
  {
    type: 'function',
    name: 'getCommittee',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'feedId', type: 'bytes32' },
          { name: 'round', type: 'uint256' },
          { name: 'members', type: 'address[]' },
          { name: 'threshold', type: 'uint8' },
          { name: 'activeUntil', type: 'uint256' },
          { name: 'leader', type: 'address' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isCommitteeMember',
    inputs: [
      { name: 'feedId', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOperatorFeeds',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'canRotate',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNextRotationTime',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ============ Fee Router ABI ============

export const FEE_ROUTER_ABI = [
  {
    type: 'function',
    name: 'subscribe',
    inputs: [
      { name: 'feedIds', type: 'bytes32[]' },
      { name: 'durationMonths', type: 'uint256' },
    ],
    outputs: [{ name: 'subscriptionId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getSubscriptionPrice',
    inputs: [
      { name: 'feedIds', type: 'bytes32[]' },
      { name: 'durationMonths', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isSubscribed',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'feedId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSubscription',
    inputs: [{ name: 'subscriptionId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'subscriber', type: 'address' },
          { name: 'feedIds', type: 'bytes32[]' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'amountPaid', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSubscriptionsByAccount',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFeeConfig',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'subscriptionFeePerMonth', type: 'uint256' },
          { name: 'perReadFee', type: 'uint256' },
          { name: 'treasuryShareBps', type: 'uint16' },
          { name: 'operatorShareBps', type: 'uint16' },
          { name: 'delegatorShareBps', type: 'uint16' },
          { name: 'disputerRewardBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTotalFeesCollected',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentEpoch',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ============ Types ============

export interface FeedSpec {
  feedId: `0x${string}`;
  symbol: string;
  baseToken: Address;
  quoteToken: Address;
  decimals: number;
  heartbeatSeconds: number;
  twapWindowSeconds: number;
  minLiquidityUSD: bigint;
  maxDeviationBps: number;
  minOracles: number;
  quorumThreshold: number;
  isActive: boolean;
  requiresConfidence: boolean;
  category: FeedCategory;
}

export enum FeedCategory {
  SPOT_PRICE = 0,
  TWAP = 1,
  FX_RATE = 2,
  STABLECOIN_PEG = 3,
  LST_RATE = 4,
  GAS_PRICE = 5,
  SEQUENCER_STATUS = 6,
  MARKET_STATUS = 7,
}

export const FEED_CATEGORY_LABELS: Record<FeedCategory, string> = {
  [FeedCategory.SPOT_PRICE]: 'Spot Price',
  [FeedCategory.TWAP]: 'TWAP',
  [FeedCategory.FX_RATE]: 'FX Rate',
  [FeedCategory.STABLECOIN_PEG]: 'Stablecoin Peg',
  [FeedCategory.LST_RATE]: 'LST Rate',
  [FeedCategory.GAS_PRICE]: 'Gas Price',
  [FeedCategory.SEQUENCER_STATUS]: 'Sequencer Status',
  [FeedCategory.MARKET_STATUS]: 'Market Status',
};

export interface ConsensusPrice {
  price: bigint;
  confidence: bigint;
  timestamp: bigint;
  round: bigint;
  oracleCount: bigint;
  reportHash: `0x${string}`;
}

export interface Committee {
  feedId: `0x${string}`;
  round: bigint;
  members: Address[];
  threshold: number;
  activeUntil: bigint;
  leader: Address;
  isActive: boolean;
}

export interface Subscription {
  subscriber: Address;
  feedIds: `0x${string}`[];
  startTime: bigint;
  endTime: bigint;
  amountPaid: bigint;
  isActive: boolean;
}

export interface FeeConfig {
  subscriptionFeePerMonth: bigint;
  perReadFee: bigint;
  treasuryShareBps: number;
  operatorShareBps: number;
  delegatorShareBps: number;
  disputerRewardBps: number;
}

// ============ Utility Functions ============

export function formatPrice(price: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const wholePart = price / divisor;
  const fracPart = price % divisor;
  const fracStr = fracPart.toString().padStart(decimals, '0').slice(0, 4);
  return `${wholePart}.${fracStr}`;
}

export function formatConfidence(confidence: bigint): string {
  // Confidence is in BPS (0-10000)
  return `${(Number(confidence) / 100).toFixed(1)}%`;
}

export function isPriceStale(timestamp: bigint, heartbeatSeconds: number): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now - timestamp > BigInt(heartbeatSeconds);
}

export function formatTimestamp(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

export function formatTimeAgo(timestamp: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - Number(timestamp);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

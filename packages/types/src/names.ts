/**
 * Jeju Name Service (JNS) Types
 * 
 * Type definitions for the decentralized naming system
 * that integrates with ERC-8004 and hosted apps
 */

import type { Address } from 'viem';

// ============ Core Types ============

/** JNS name without the .jeju suffix */
export type JNSLabel = string;

/** Full JNS name with .jeju suffix */
export type JNSName = `${string}.jeju`;

/** Node hash (keccak256) for name resolution */
export type NodeHash = `0x${string}`;

/** Label hash (keccak256 of the label) */
export type LabelHash = `0x${string}`;

// ============ Registration Types ============

export interface JNSRegistration {
  /** The registered name (without .jeju) */
  name: JNSLabel;
  /** Full name with suffix */
  fullName: JNSName;
  /** Node hash for registry lookups */
  node: NodeHash;
  /** Label hash (token ID in ERC-721) */
  labelhash: LabelHash;
  /** Current owner address */
  owner: Address;
  /** Resolver contract address */
  resolver: Address;
  /** Registration timestamp */
  registeredAt: number;
  /** Expiration timestamp */
  expiresAt: number;
  /** Whether in grace period */
  inGracePeriod: boolean;
}

export interface JNSRegistrationParams {
  /** Name to register (without .jeju) */
  name: JNSLabel;
  /** Owner address */
  owner: Address;
  /** Duration in seconds */
  duration: number;
  /** Custom resolver (optional, uses default if not provided) */
  resolver?: Address;
  /** Initial resolver data to set */
  resolverData?: JNSResolverData;
}

export interface JNSRenewalParams {
  /** Name to renew */
  name: JNSLabel;
  /** Additional duration in seconds */
  duration: number;
}

// ============ Resolver Types ============

export interface JNSResolverData {
  /** Ethereum address the name resolves to */
  addr?: Address;
  /** Content hash (IPFS CID, Swarm hash) */
  contenthash?: `0x${string}`;
  /** Text records */
  text?: Record<string, string>;
  /** App configuration */
  app?: JNSAppConfig;
}

export interface JNSAppConfig {
  /** App contract address */
  appContract?: Address;
  /** App identifier */
  appId?: string;
  /** Linked ERC-8004 agent ID */
  agentId?: bigint;
  /** App API endpoint */
  endpoint?: string;
  /** A2A endpoint for agent communication */
  a2aEndpoint?: string;
  /** MCP endpoint */
  mcpEndpoint?: string;
}

/** Standard text record keys */
export const JNS_TEXT_KEYS = {
  URL: 'url',
  DESCRIPTION: 'description',
  AVATAR: 'avatar',
  GITHUB: 'com.github',
  TWITTER: 'com.twitter',
  TELEGRAM: 'com.telegram',
  DISCORD: 'com.discord',
  EMAIL: 'email',
  APP_ENDPOINT: 'app.endpoint',
  APP_A2A: 'app.a2a',
  APP_MCP: 'app.mcp',
  APP_VERSION: 'app.version',
  APP_CATEGORY: 'app.category',
} as const;

export type JNSTextKey = typeof JNS_TEXT_KEYS[keyof typeof JNS_TEXT_KEYS] | string;

// ============ Reverse Resolution ============

export interface JNSReverseRecord {
  /** Address the record is for */
  address: Address;
  /** Reverse node hash */
  node: NodeHash;
  /** Primary name for this address */
  name: JNSName;
}

// ============ Pricing Types ============

export interface JNSPricing {
  /** Base price per year in wei */
  basePrice: bigint;
  /** Premium for 3-char names (multiplier) */
  premium3Char: number;
  /** Premium for 4-char names (multiplier) */
  premium4Char: number;
  /** Agent discount in basis points */
  agentDiscountBps: number;
}

export interface JNSPriceQuote {
  /** Name being priced */
  name: JNSLabel;
  /** Duration in seconds */
  duration: number;
  /** Base price in wei */
  basePrice: bigint;
  /** Discount applied in wei */
  discount: bigint;
  /** Final price in wei */
  finalPrice: bigint;
  /** Whether agent discount applied */
  hasAgentDiscount: boolean;
}

// ============ App Registry Integration ============

/** Canonical JNS names for Jeju apps */
export const JEJU_APP_NAMES = {
  GATEWAY: 'gateway.jeju',
  BAZAAR: 'bazaar.jeju',
  COMPUTE: 'compute.jeju',
  STORAGE: 'storage.jeju',
  INDEXER: 'indexer.jeju',
  CLOUD: 'cloud.jeju',
  INTENTS: 'intents.jeju',
  DOCUMENTATION: 'docs.jeju',
  MONITORING: 'monitoring.jeju',
} as const;

export type JejuAppName = typeof JEJU_APP_NAMES[keyof typeof JEJU_APP_NAMES];

/** Mapping of app names to their JNS configurations */
export interface JNSAppRegistry {
  [appName: string]: {
    jnsName: JNSName;
    node: NodeHash;
    agentId?: bigint;
    endpoint?: string;
    a2aEndpoint?: string;
  };
}

// ============ Event Types ============

export interface JNSNameRegisteredEvent {
  node: NodeHash;
  name: JNSLabel;
  owner: Address;
  expires: bigint;
  cost: bigint;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface JNSNameRenewedEvent {
  node: NodeHash;
  name: JNSLabel;
  expires: bigint;
  cost: bigint;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface JNSNameTransferredEvent {
  node: NodeHash;
  from: Address;
  to: Address;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface JNSResolverChangedEvent {
  node: NodeHash;
  resolver: Address;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

// ============ Query Types ============

export interface JNSLookupResult {
  /** Whether the name exists and is not expired */
  exists: boolean;
  /** Registration details if exists */
  registration?: JNSRegistration;
  /** Resolver data if set */
  resolverData?: JNSResolverData;
  /** Reverse name if address has one */
  reverseName?: JNSName;
}

export interface JNSSearchParams {
  /** Search query (partial name match) */
  query?: string;
  /** Filter by owner */
  owner?: Address;
  /** Filter by category */
  category?: string;
  /** Filter by tag */
  tag?: string;
  /** Include expired names */
  includeExpired?: boolean;
  /** Pagination offset */
  offset?: number;
  /** Pagination limit */
  limit?: number;
}

export interface JNSSearchResult {
  names: JNSRegistration[];
  total: number;
  hasMore: boolean;
}

// ============ Contract Addresses ============

export interface JNSContractAddresses {
  registry: Address;
  resolver: Address;
  registrar: Address;
  reverseRegistrar: Address;
}

// ============ Utils ============

/**
 * Compute the namehash for a JNS name
 * @param name Full name (e.g., "myapp.jeju")
 * @returns The namehash
 */
export function computeNamehash(name: string): NodeHash {
  // Implementation would use viem's namehash utility
  // This is a placeholder type definition
  throw new Error('Use viem namehash implementation');
}

/**
 * Compute the labelhash for a label
 * @param label Label without suffix (e.g., "myapp")
 * @returns The labelhash
 */
export function computeLabelhash(label: string): LabelHash {
  // Implementation would use keccak256
  // This is a placeholder type definition
  throw new Error('Use viem keccak256 implementation');
}

/**
 * Validate a JNS name
 * @param name Name to validate
 * @returns Validation result
 */
export function validateJNSName(name: string): { valid: boolean; error?: string } {
  // Check length
  if (name.length < 3) {
    return { valid: false, error: 'Name must be at least 3 characters' };
  }

  // Check characters
  const validPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  if (!validPattern.test(name)) {
    return { valid: false, error: 'Name can only contain lowercase letters, numbers, and non-consecutive hyphens' };
  }

  // Check for consecutive hyphens
  if (name.includes('--')) {
    return { valid: false, error: 'Name cannot contain consecutive hyphens' };
  }

  return { valid: true };
}

/**
 * Format a JNS name with suffix
 * @param label Label without suffix
 * @returns Full JNS name
 */
export function formatJNSName(label: JNSLabel): JNSName {
  return `${label}.jeju` as JNSName;
}

/**
 * Parse a JNS name to get the label
 * @param name Full JNS name
 * @returns The label without suffix
 */
export function parseJNSName(name: JNSName): JNSLabel {
  return name.replace('.jeju', '');
}


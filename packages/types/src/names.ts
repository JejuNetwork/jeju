/**
 * @fileoverview Network Name Service (JNS) Types
 *
 * Type definitions for the decentralized naming system
 * that integrates with ERC-8004 and hosted apps.
 * Includes Zod schemas for runtime validation.
 */

import { z } from 'zod';
import { AddressSchema, HashSchema } from './validation';

// ============ Core Type Schemas ============

/** JNS name without the .jeju suffix */
export type JNSLabel = string;

/** Full JNS name with .jeju suffix */
export type JNSName = `${string}.jeju`;

/** Node hash (keccak256) for name resolution */
export type NodeHash = `0x${string}`;

/** Label hash (keccak256 of the label) */
export type LabelHash = `0x${string}`;

/** Schema for JNS label validation */
export const JNSLabelSchema = z.string().min(3).regex(
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  'Label can only contain lowercase letters, numbers, and non-consecutive hyphens'
).refine(
  (val) => !val.includes('--'),
  'Label cannot contain consecutive hyphens'
);

/** Schema for full JNS name */
export const JNSNameSchema = z.string().endsWith('.jeju').transform((val) => val as JNSName);

/** Schema for node hash */
export const NodeHashSchema = HashSchema;

/** Schema for label hash */
export const LabelHashSchema = HashSchema;

// ============ Registration Schemas ============

export const JNSRegistrationSchema = z.object({
  /** The registered name (without .jeju) */
  name: JNSLabelSchema,
  /** Full name with suffix */
  fullName: JNSNameSchema,
  /** Node hash for registry lookups */
  node: NodeHashSchema,
  /** Label hash (token ID in ERC-721) */
  labelhash: LabelHashSchema,
  /** Current owner address */
  owner: AddressSchema,
  /** Resolver contract address */
  resolver: AddressSchema,
  /** Registration timestamp */
  registeredAt: z.number(),
  /** Expiration timestamp */
  expiresAt: z.number(),
  /** Whether in grace period */
  inGracePeriod: z.boolean(),
});
export type JNSRegistration = z.infer<typeof JNSRegistrationSchema>;

export const JNSRegistrationParamsSchema = z.object({
  /** Name to register (without .jeju) */
  name: JNSLabelSchema,
  /** Owner address */
  owner: AddressSchema,
  /** Duration in seconds */
  duration: z.number().int().positive(),
  /** Custom resolver (optional, uses default if not provided) */
  resolver: AddressSchema.optional(),
  /** Initial resolver data to set */
  resolverData: z.lazy(() => JNSResolverDataSchema).optional(),
});
export type JNSRegistrationParams = z.infer<typeof JNSRegistrationParamsSchema>;

export const JNSRenewalParamsSchema = z.object({
  /** Name to renew */
  name: JNSLabelSchema,
  /** Additional duration in seconds */
  duration: z.number().int().positive(),
});
export type JNSRenewalParams = z.infer<typeof JNSRenewalParamsSchema>;

// ============ Resolver Schemas ============

export const JNSAppConfigSchema = z.object({
  /** App contract address */
  appContract: AddressSchema.optional(),
  /** App identifier */
  appId: z.string().optional(),
  /** Linked ERC-8004 agent ID */
  agentId: z.bigint().optional(),
  /** App API endpoint */
  endpoint: z.string().url().optional(),
  /** A2A endpoint for agent communication */
  a2aEndpoint: z.string().url().optional(),
  /** MCP endpoint */
  mcpEndpoint: z.string().url().optional(),
});
export type JNSAppConfig = z.infer<typeof JNSAppConfigSchema>;

export const JNSResolverDataSchema = z.object({
  /** Ethereum address the name resolves to */
  addr: AddressSchema.optional(),
  /** Content hash (IPFS CID, Swarm hash) */
  contenthash: HashSchema.optional(),
  /** Text records */
  text: z.record(z.string(), z.string()).optional(),
  /** App configuration */
  app: JNSAppConfigSchema.optional(),
});
export type JNSResolverData = z.infer<typeof JNSResolverDataSchema>;

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

// ============ Reverse Resolution Schemas ============

export const JNSReverseRecordSchema = z.object({
  /** Address the record is for */
  address: AddressSchema,
  /** Reverse node hash */
  node: NodeHashSchema,
  /** Primary name for this address */
  name: JNSNameSchema,
});
export type JNSReverseRecord = z.infer<typeof JNSReverseRecordSchema>;

// ============ Pricing Schemas ============

export const JNSPricingSchema = z.object({
  /** Base price per year in wei */
  basePrice: z.bigint(),
  /** Premium for 3-char names (multiplier) */
  premium3Char: z.number(),
  /** Premium for 4-char names (multiplier) */
  premium4Char: z.number(),
  /** Agent discount in basis points */
  agentDiscountBps: z.number().int().min(0).max(10000),
});
export type JNSPricing = z.infer<typeof JNSPricingSchema>;

export const JNSPriceQuoteSchema = z.object({
  /** Name being priced */
  name: JNSLabelSchema,
  /** Duration in seconds */
  duration: z.number().int().positive(),
  /** Base price in wei */
  basePrice: z.bigint(),
  /** Discount applied in wei */
  discount: z.bigint(),
  /** Final price in wei */
  finalPrice: z.bigint(),
  /** Whether agent discount applied */
  hasAgentDiscount: z.boolean(),
});
export type JNSPriceQuote = z.infer<typeof JNSPriceQuoteSchema>;

// ============ App Registry Integration ============

/** Canonical JNS names for network apps */
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

export type NetworkAppName = typeof JEJU_APP_NAMES[keyof typeof JEJU_APP_NAMES];

export const JNSAppRegistryEntrySchema = z.object({
  jnsName: JNSNameSchema,
  node: NodeHashSchema,
  agentId: z.bigint().optional(),
  endpoint: z.string().url().optional(),
  a2aEndpoint: z.string().url().optional(),
});
export type JNSAppRegistryEntry = z.infer<typeof JNSAppRegistryEntrySchema>;

/** Mapping of app names to their JNS configurations */
export type JNSAppRegistry = Record<string, JNSAppRegistryEntry>;

// ============ Event Schemas ============

export const JNSNameRegisteredEventSchema = z.object({
  node: NodeHashSchema,
  name: JNSLabelSchema,
  owner: AddressSchema,
  expires: z.bigint(),
  cost: z.bigint(),
  transactionHash: HashSchema,
  blockNumber: z.bigint(),
});
export type JNSNameRegisteredEvent = z.infer<typeof JNSNameRegisteredEventSchema>;

export const JNSNameRenewedEventSchema = z.object({
  node: NodeHashSchema,
  name: JNSLabelSchema,
  expires: z.bigint(),
  cost: z.bigint(),
  transactionHash: HashSchema,
  blockNumber: z.bigint(),
});
export type JNSNameRenewedEvent = z.infer<typeof JNSNameRenewedEventSchema>;

export const JNSNameTransferredEventSchema = z.object({
  node: NodeHashSchema,
  from: AddressSchema,
  to: AddressSchema,
  transactionHash: HashSchema,
  blockNumber: z.bigint(),
});
export type JNSNameTransferredEvent = z.infer<typeof JNSNameTransferredEventSchema>;

export const JNSResolverChangedEventSchema = z.object({
  node: NodeHashSchema,
  resolver: AddressSchema,
  transactionHash: HashSchema,
  blockNumber: z.bigint(),
});
export type JNSResolverChangedEvent = z.infer<typeof JNSResolverChangedEventSchema>;

// ============ Query Schemas ============

export const JNSLookupResultSchema = z.object({
  /** Whether the name exists and is not expired */
  exists: z.boolean(),
  /** Registration details if exists */
  registration: JNSRegistrationSchema.optional(),
  /** Resolver data if set */
  resolverData: JNSResolverDataSchema.optional(),
  /** Reverse name if address has one */
  reverseName: JNSNameSchema.optional(),
});
export type JNSLookupResult = z.infer<typeof JNSLookupResultSchema>;

export const JNSSearchParamsSchema = z.object({
  /** Search query (partial name match) */
  query: z.string().optional(),
  /** Filter by owner */
  owner: AddressSchema.optional(),
  /** Filter by category */
  category: z.string().optional(),
  /** Filter by tag */
  tag: z.string().optional(),
  /** Include expired names */
  includeExpired: z.boolean().optional(),
  /** Pagination offset */
  offset: z.number().int().nonnegative().optional(),
  /** Pagination limit */
  limit: z.number().int().positive().max(100).optional(),
});
export type JNSSearchParams = z.infer<typeof JNSSearchParamsSchema>;

export const JNSSearchResultSchema = z.object({
  names: z.array(JNSRegistrationSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type JNSSearchResult = z.infer<typeof JNSSearchResultSchema>;

// ============ Contract Addresses ============

export const JNSContractAddressesSchema = z.object({
  registry: AddressSchema,
  resolver: AddressSchema,
  registrar: AddressSchema,
  reverseRegistrar: AddressSchema,
});
export type JNSContractAddresses = z.infer<typeof JNSContractAddressesSchema>;

// ============ Utils ============

/**
 * Compute the namehash for a JNS name
 * @param name Full name (e.g., "myapp.jeju")
 * @returns The namehash
 */
export function computeNamehash(_name: string): NodeHash {
  // Implementation would use viem's namehash utility
  throw new Error('Use viem namehash implementation');
}

/**
 * Compute the labelhash for a label
 * @param label Label without suffix (e.g., "myapp")
 * @returns The labelhash
 */
export function computeLabelhash(_label: string): LabelHash {
  // Implementation would use keccak256
  throw new Error('Use viem keccak256 implementation');
}

/**
 * Validate a JNS name
 * @param name Name to validate
 * @returns Validation result
 */
export function validateJNSName(name: string): { valid: boolean; error?: string } {
  const result = JNSLabelSchema.safeParse(name);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message ?? 'Invalid name' };
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

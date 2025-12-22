/**
 * API Marketplace Types
 *
 * Decentralized API key marketplace with TEE-backed secure key vault
 * Enhanced with Proof-of-Cloud verification for high-risk operations
 */

import type { Address, Hex } from 'viem'
import type { PoCStatus, PoCVerificationLevel, TEEPlatform } from '../poc/types'
import type { JSONObject, JSONValue } from '../shared/validation'

// ============================================================================
// Authentication Types
// ============================================================================

export type AuthType = 'bearer' | 'header' | 'query' | 'basic'

export interface AuthConfig {
  /** Header name for auth (e.g., 'Authorization', 'X-API-Key') */
  headerName?: string
  /** Query parameter name (e.g., 'api-key', 'key') */
  queryParam?: string
  /** Prefix before the key (e.g., 'Bearer ', 'Key ') */
  prefix?: string
}

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderCategory =
  | 'inference' // AI/LLM providers
  | 'blockchain' // RPC, indexers
  | 'data' // Analytics, market data
  | 'media' // Image/video generation
  | 'search' // Web search, scraping
  | 'storage' // IPFS, Arweave

export interface APIProvider {
  id: string
  name: string
  description: string
  baseUrl: string
  authType: AuthType
  authConfig: AuthConfig
  schemaType: 'openapi' | 'graphql' | 'rest'
  schemaUrl?: string
  categories: ProviderCategory[]
  /** Environment variable name for API key */
  envVar: string
  /** Default price per request in wei */
  defaultPricePerRequest: bigint
  /** Known endpoints for this provider */
  knownEndpoints?: string[]
  /** Whether this provider supports streaming */
  supportsStreaming?: boolean
}

// ============================================================================
// Listing Types
// ============================================================================

export interface UsageLimits {
  requestsPerSecond: number
  requestsPerMinute: number
  requestsPerDay: number
  requestsPerMonth: number
}

export interface AccessControl {
  /** Allowed domain patterns (glob-style) */
  allowedDomains: string[]
  /** Blocked domain patterns */
  blockedDomains: string[]
  /** Allowed endpoint patterns (glob-style) */
  allowedEndpoints: string[]
  /** Blocked endpoint patterns */
  blockedEndpoints: string[]
  /** Allowed HTTP methods */
  allowedMethods: Array<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>
}

/**
 * Risk level for API operations
 * - low: No special requirements
 * - medium: Prefer PoC-verified nodes but allow unverified
 * - high: Require PoC-verified nodes (TEE attestation + cloud verification)
 */
export type APIRiskLevel = 'low' | 'medium' | 'high'

export interface APIListing {
  id: string
  providerId: string
  seller: Address
  /** Reference to encrypted key in TEE vault */
  keyVaultId: string
  /** Price per request in wei */
  pricePerRequest: bigint
  /** Usage limits */
  limits: UsageLimits
  /** Access control rules */
  accessControl: AccessControl
  /** Whether listing is active */
  active: boolean
  /** Creation timestamp */
  createdAt: number
  /** Total requests served */
  totalRequests: bigint
  /** Total revenue in wei */
  totalRevenue: bigint
  /** Risk level (determines PoC requirements) */
  riskLevel: APIRiskLevel
  /** Required minimum PoC verification level (for medium/high risk) */
  requiredPoCLevel?: PoCVerificationLevel
  /** Agent ID in ERC-8004 registry (for PoC verification) */
  agentId?: bigint
}

// ============================================================================
// User Account Types
// ============================================================================

export interface UserAccount {
  address: Address
  /** Balance in wei */
  balance: bigint
  /** Total spent in wei */
  totalSpent: bigint
  /** Total requests made */
  totalRequests: bigint
  /** Active subscriptions */
  subscriptions: UserSubscription[]
}

export interface UserSubscription {
  listingId: string
  /** Requests remaining in current period */
  remainingRequests: bigint
  /** Period end timestamp */
  periodEnd: number
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface ProxyRequest {
  /** Listing ID to use */
  listingId: string
  /** Target endpoint path */
  endpoint: string
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** Request headers (auth headers will be stripped) */
  headers?: Record<string, string>
  /** Request body - JSON-serializable data or raw string */
  body?: string | JSONObject
  /** Query parameters */
  queryParams?: Record<string, string>
}

export interface ProxyResponse {
  /** HTTP status code */
  status: number
  /** Response headers (sanitized) */
  headers: Record<string, string>
  /** Response body (sanitized) - JSON data or string from upstream API */
  body: JSONValue | string
  /** Request cost in wei */
  cost: bigint
  /** Latency in ms */
  latencyMs: number
  /** Request ID for tracking */
  requestId: string
}

// ============================================================================
// Key Vault Types
// ============================================================================

export interface VaultKey {
  id: string
  providerId: string
  owner: Address
  /** Encrypted key data (only decryptable in TEE) */
  encryptedKey: string
  /** TEE attestation of key storage */
  attestation?: string
  /** Proof-of-Cloud verification status */
  pocVerification?: PoCVerificationInfo
  /** Creation timestamp */
  createdAt: number
}

/**
 * Proof-of-Cloud verification information
 */
export interface PoCVerificationInfo {
  /** PoC verification status */
  status: PoCStatus
  /** Verification level (1, 2, or 3) */
  level: PoCVerificationLevel | null
  /** TEE platform type */
  platform: TEEPlatform | null
  /** Hardware ID hash (salted) */
  hardwareIdHash: Hex | null
  /** Cloud provider (e.g., "aws", "gcp", "azure") */
  cloudProvider: string | null
  /** Data center region */
  region: string | null
  /** Last verification timestamp */
  verifiedAt: number | null
  /** Verification expiry timestamp */
  expiresAt: number | null
}

export interface VaultDecryptRequest {
  keyId: string
  /** Requester must have valid listing access */
  requester: Address
  /** Request context for audit */
  requestContext: {
    listingId: string
    endpoint: string
    requestId: string
  }
  /** Whether PoC verification is required for this request */
  requirePoC?: boolean
}

// ============================================================================
// Payment Types
// ============================================================================

export interface PaymentProof {
  txHash: string
  amount: bigint
  payer: Address
  timestamp: number
}

export interface DepositRequest {
  amount: bigint
  payer: Address
}

export interface WithdrawRequest {
  amount: bigint
  recipient: Address
}

// ============================================================================
// Sanitization Types
// ============================================================================

export interface SanitizationConfig {
  /** Regex patterns to scrub from responses */
  patterns: RegExp[]
  /** Specific key values to scrub */
  knownKeys: string[]
  /** Headers to strip from proxied response */
  stripHeaders: string[]
  /** JSON paths to redact */
  redactPaths: string[]
}

// ============================================================================
// Event Types
// ============================================================================

/** Event data for listing creation */
export interface ListingCreatedEventData {
  listingId: string
  providerId: string
  seller: Address
  pricePerRequest: string
}

/** Event data for listing updates */
export interface ListingUpdatedEventData {
  listingId: string
  changes: {
    pricePerRequest?: string
    active?: boolean
    limits?: Partial<UsageLimits>
  }
}

/** Event data for served requests */
export interface RequestServedEventData {
  listingId: string
  requestId: string
  userAddress: Address
  cost: string
  latencyMs: number
  statusCode: number
}

/** Event data for deposits */
export interface DepositEventData {
  userAddress: Address
  amount: string
  txHash?: string
}

/** Event data for withdrawals */
export interface WithdrawalEventData {
  userAddress: Address
  amount: string
  recipient: Address
  txHash?: string
}

/** Union type for all marketplace event data */
export type MarketplaceEventData =
  | { type: 'listing_created'; data: ListingCreatedEventData }
  | { type: 'listing_updated'; data: ListingUpdatedEventData }
  | { type: 'request_served'; data: RequestServedEventData }
  | { type: 'deposit'; data: DepositEventData }
  | { type: 'withdrawal'; data: WithdrawalEventData }

export interface MarketplaceEvent {
  type: MarketplaceEventData['type']
  timestamp: number
  data:
    | ListingCreatedEventData
    | ListingUpdatedEventData
    | RequestServedEventData
    | DepositEventData
    | WithdrawalEventData
}

// ============================================================================
// Health/Stats Types
// ============================================================================

export interface MarketplaceStats {
  totalProviders: number
  totalListings: number
  activeListings: number
  totalUsers: number
  totalRequests: bigint
  totalVolume: bigint
  last24hRequests: bigint
  last24hVolume: bigint
  /** PoC statistics */
  pocStats: {
    /** Number of listings requiring PoC */
    pocRequiredListings: number
    /** Number of verified vault keys */
    verifiedVaultKeys: number
    /** Requests served via PoC-verified nodes */
    pocVerifiedRequests: bigint
  }
}

export interface ProviderHealth {
  providerId: string
  healthy: boolean
  latencyMs: number
  lastCheck: number
  errorRate: number
}

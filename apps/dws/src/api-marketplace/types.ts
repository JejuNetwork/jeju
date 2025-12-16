/**
 * API Marketplace Types
 *
 * Decentralized API key marketplace with TEE-backed secure key vault
 */

import type { Address } from 'viem';

// ============================================================================
// Authentication Types
// ============================================================================

export type AuthType = 'bearer' | 'header' | 'query' | 'basic';

export interface AuthConfig {
  /** Header name for auth (e.g., 'Authorization', 'X-API-Key') */
  headerName?: string;
  /** Query parameter name (e.g., 'api-key', 'key') */
  queryParam?: string;
  /** Prefix before the key (e.g., 'Bearer ', 'Key ') */
  prefix?: string;
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
  | 'storage'; // IPFS, Arweave

export interface APIProvider {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: AuthType;
  authConfig: AuthConfig;
  schemaType: 'openapi' | 'graphql' | 'rest';
  schemaUrl?: string;
  categories: ProviderCategory[];
  /** Environment variable name for API key */
  envVar: string;
  /** Default price per request in wei */
  defaultPricePerRequest: bigint;
  /** Known endpoints for this provider */
  knownEndpoints?: string[];
  /** Whether this provider supports streaming */
  supportsStreaming?: boolean;
}

// ============================================================================
// Listing Types
// ============================================================================

export interface UsageLimits {
  requestsPerSecond: number;
  requestsPerMinute: number;
  requestsPerDay: number;
  requestsPerMonth: number;
}

export interface AccessControl {
  /** Allowed domain patterns (glob-style) */
  allowedDomains: string[];
  /** Blocked domain patterns */
  blockedDomains: string[];
  /** Allowed endpoint patterns (glob-style) */
  allowedEndpoints: string[];
  /** Blocked endpoint patterns */
  blockedEndpoints: string[];
  /** Allowed HTTP methods */
  allowedMethods: Array<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>;
}

export interface APIListing {
  id: string;
  providerId: string;
  seller: Address;
  /** Reference to encrypted key in TEE vault */
  keyVaultId: string;
  /** Price per request in wei */
  pricePerRequest: bigint;
  /** Usage limits */
  limits: UsageLimits;
  /** Access control rules */
  accessControl: AccessControl;
  /** Whether listing is active */
  active: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Total requests served */
  totalRequests: bigint;
  /** Total revenue in wei */
  totalRevenue: bigint;
}

// ============================================================================
// User Account Types
// ============================================================================

export interface UserAccount {
  address: Address;
  /** Balance in wei */
  balance: bigint;
  /** Total spent in wei */
  totalSpent: bigint;
  /** Total requests made */
  totalRequests: bigint;
  /** Active subscriptions */
  subscriptions: UserSubscription[];
}

export interface UserSubscription {
  listingId: string;
  /** Requests remaining in current period */
  remainingRequests: bigint;
  /** Period end timestamp */
  periodEnd: number;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface ProxyRequest {
  /** Listing ID to use */
  listingId: string;
  /** Target endpoint path */
  endpoint: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Request headers (auth headers will be stripped) */
  headers?: Record<string, string>;
  /** Request body */
  body?: string | Record<string, unknown>;
  /** Query parameters */
  queryParams?: Record<string, string>;
}

export interface ProxyResponse {
  /** HTTP status code */
  status: number;
  /** Response headers (sanitized) */
  headers: Record<string, string>;
  /** Response body (sanitized) */
  body: unknown;
  /** Request cost in wei */
  cost: bigint;
  /** Latency in ms */
  latencyMs: number;
  /** Request ID for tracking */
  requestId: string;
}

// ============================================================================
// Key Vault Types
// ============================================================================

export interface VaultKey {
  id: string;
  providerId: string;
  owner: Address;
  /** Encrypted key data (only decryptable in TEE) */
  encryptedKey: string;
  /** TEE attestation of key storage */
  attestation?: string;
  /** Creation timestamp */
  createdAt: number;
}

export interface VaultDecryptRequest {
  keyId: string;
  /** Requester must have valid listing access */
  requester: Address;
  /** Request context for audit */
  requestContext: {
    listingId: string;
    endpoint: string;
    requestId: string;
  };
}

// ============================================================================
// Payment Types
// ============================================================================

export interface PaymentProof {
  txHash: string;
  amount: bigint;
  payer: Address;
  timestamp: number;
}

export interface DepositRequest {
  amount: bigint;
  payer: Address;
}

export interface WithdrawRequest {
  amount: bigint;
  recipient: Address;
}

// ============================================================================
// Sanitization Types
// ============================================================================

export interface SanitizationConfig {
  /** Regex patterns to scrub from responses */
  patterns: RegExp[];
  /** Specific key values to scrub */
  knownKeys: string[];
  /** Headers to strip from proxied response */
  stripHeaders: string[];
  /** JSON paths to redact */
  redactPaths: string[];
}

// ============================================================================
// Event Types
// ============================================================================

export interface MarketplaceEvent {
  type: 'listing_created' | 'listing_updated' | 'request_served' | 'deposit' | 'withdrawal';
  timestamp: number;
  data: Record<string, unknown>;
}

// ============================================================================
// Health/Stats Types
// ============================================================================

export interface MarketplaceStats {
  totalProviders: number;
  totalListings: number;
  activeListings: number;
  totalUsers: number;
  totalRequests: bigint;
  totalVolume: bigint;
  last24hRequests: bigint;
  last24hVolume: bigint;
}

export interface ProviderHealth {
  providerId: string;
  healthy: boolean;
  latencyMs: number;
  lastCheck: number;
  errorRate: number;
}

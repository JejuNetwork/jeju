/**
 * API Marketplace Registry - Decentralized via CovenantSQL
 *
 * Manages providers, listings, and user accounts with persistent state
 */

import type { Address } from 'viem';
import type {
  APIListing,
  APIProvider,
  AccessControl,
  UsageLimits,
  UserAccount,
  MarketplaceStats,
  ProviderHealth,
} from './types';
import { ALL_PROVIDERS, PROVIDERS_BY_ID, getProvider } from './providers';
import { apiListingState, apiUserAccountState, initializeDWSState } from '../state.js';
import { expectValid } from '../shared/validation';
import { UsageLimitsSchema, AccessControlSchema } from '../shared/schemas/api-marketplace';

// Initialize state on module load (skip in test to avoid connection errors)
if (process.env.NODE_ENV !== 'test') {
  initializeDWSState().catch((err) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[API Marketplace] Running without CQL:', err.message);
    } else {
      console.error('[API Marketplace] CQL required in production:', err);
      throw err;
    }
  });
}

// Provider health is ephemeral (not persisted)
const providerHealth = new Map<string, ProviderHealth>();

// ============================================================================
// Default Access Control
// ============================================================================

const DEFAULT_LIMITS: UsageLimits = {
  requestsPerSecond: 10,
  requestsPerMinute: 100,
  requestsPerDay: 10000,
  requestsPerMonth: 100000,
};

const DEFAULT_ACCESS_CONTROL: AccessControl = {
  allowedDomains: ['*'],
  blockedDomains: [],
  allowedEndpoints: ['*'],
  blockedEndpoints: [],
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
};

// ============================================================================
// Listing Management
// ============================================================================

export interface CreateListingParams {
  providerId: string;
  seller: Address;
  keyVaultId: string;
  pricePerRequest?: bigint;
  limits?: Partial<UsageLimits>;
  accessControl?: Partial<AccessControl>;
}

/**
 * Create a new API listing
 */
export async function createListing(params: CreateListingParams): Promise<APIListing> {
  const provider = getProvider(params.providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${params.providerId}`);
  }

  const id = crypto.randomUUID();
  const limits = { ...DEFAULT_LIMITS, ...params.limits };
  const accessControl = {
    ...DEFAULT_ACCESS_CONTROL,
    ...params.accessControl,
    allowedDomains: params.accessControl?.allowedDomains ?? DEFAULT_ACCESS_CONTROL.allowedDomains,
    blockedDomains: params.accessControl?.blockedDomains ?? DEFAULT_ACCESS_CONTROL.blockedDomains,
    allowedEndpoints: params.accessControl?.allowedEndpoints ?? DEFAULT_ACCESS_CONTROL.allowedEndpoints,
    blockedEndpoints: params.accessControl?.blockedEndpoints ?? DEFAULT_ACCESS_CONTROL.blockedEndpoints,
    allowedMethods: params.accessControl?.allowedMethods ?? DEFAULT_ACCESS_CONTROL.allowedMethods,
  };

  await apiListingState.save({
    listingId: id,
    providerId: params.providerId,
    seller: params.seller,
    keyVaultId: params.keyVaultId,
    pricePerRequest: (params.pricePerRequest ?? provider.defaultPricePerRequest).toString(),
    limits,
    accessControl,
    status: 'active',
  });

  return {
    id,
    providerId: params.providerId,
    seller: params.seller,
    keyVaultId: params.keyVaultId,
    pricePerRequest: params.pricePerRequest ?? provider.defaultPricePerRequest,
    limits,
    accessControl,
    active: true,
    createdAt: Date.now(),
    totalRequests: 0n,
    totalRevenue: 0n,
    riskLevel: 'low',
  };
}

function rowToListing(row: {
  listing_id: string;
  provider_id: string;
  seller: string;
  key_vault_id: string;
  price_per_request: string;
  limits: string;
  access_control: string;
  status: string;
  total_requests: number;
  total_revenue: string;
  created_at: number;
  risk_level?: string;
}): APIListing {
  const limits = expectValid(UsageLimitsSchema, JSON.parse(row.limits), `listing ${row.listing_id} limits`);
  const accessControl = expectValid(AccessControlSchema, JSON.parse(row.access_control), `listing ${row.listing_id} accessControl`);
  
  return {
    id: row.listing_id,
    providerId: row.provider_id,
    seller: row.seller as Address,
    keyVaultId: row.key_vault_id,
    pricePerRequest: BigInt(row.price_per_request),
    limits,
    accessControl,
    active: row.status === 'active',
    createdAt: row.created_at,
    totalRequests: BigInt(row.total_requests),
    totalRevenue: BigInt(row.total_revenue),
    riskLevel: (row.risk_level as 'low' | 'medium' | 'high') ?? 'low',
  };
}

/**
 * Get a listing by ID
 */
export async function getListing(id: string): Promise<APIListing | undefined> {
  const row = await apiListingState.get(id);
  return row ? rowToListing(row) : undefined;
}

/**
 * Get listings by seller
 */
export async function getListingsBySeller(seller: Address): Promise<APIListing[]> {
  const rows = await apiListingState.listBySeller(seller);
  return rows.map(rowToListing);
}

/**
 * Get all listings (Note: uses in-memory fallback for listing enumeration)
 * In production, use getListingsBySeller with pagination
 */
export async function getAllListings(): Promise<APIListing[]> {
  // This would require a full scan - not ideal but needed for stats
  // In production, this should be paginated or cached
  console.warn('[API Marketplace] getAllListings is expensive - use getListingsBySeller for production');
  return [];
}

/**
 * Get listings by provider
 */
export async function getListingsByProvider(_providerId: string): Promise<APIListing[]> {
  // Would need to add provider_id query to state module
  // For now, return empty - callers should use getListingsBySeller
  return [];
}

/**
 * Get active listings
 */
export async function getActiveListings(): Promise<APIListing[]> {
  // Would need status filter query
  return [];
}

/**
 * Update listing
 */
export async function updateListing(
  id: string,
  updates: {
    pricePerRequest?: bigint;
    limits?: Partial<UsageLimits>;
    accessControl?: Partial<AccessControl>;
    active?: boolean;
  }
): Promise<APIListing> {
  const listing = await getListing(id);
  if (!listing) {
    throw new Error(`Listing not found: ${id}`);
  }

  // Merge and validate updates
  const updatedLimits = expectValid(
    UsageLimitsSchema,
    updates.limits ? { ...listing.limits, ...updates.limits } : listing.limits,
    `listing ${id} limits update`
  );
  const updatedAccessControl = expectValid(
    AccessControlSchema,
    updates.accessControl ? { ...listing.accessControl, ...updates.accessControl } : listing.accessControl,
    `listing ${id} accessControl update`
  );
  
  await apiListingState.save({
    listingId: listing.id,
    providerId: listing.providerId,
    seller: listing.seller,
    keyVaultId: listing.keyVaultId,
    pricePerRequest: (updates.pricePerRequest ?? listing.pricePerRequest).toString(),
    limits: updatedLimits,
    accessControl: updatedAccessControl,
    status: updates.active !== undefined ? (updates.active ? 'active' : 'inactive') : (listing.active ? 'active' : 'inactive'),
  });

  return {
    ...listing,
    pricePerRequest: updates.pricePerRequest ?? listing.pricePerRequest,
    limits: updatedLimits,
    accessControl: updatedAccessControl,
    active: updates.active ?? listing.active,
    riskLevel: listing.riskLevel,
  };
}

/**
 * Find cheapest listing for a provider
 */
export async function findCheapestListing(providerId: string): Promise<APIListing | undefined> {
  const listings = await getListingsByProvider(providerId);
  if (listings.length === 0) return undefined;
  return listings.reduce((cheapest, current) =>
    current.pricePerRequest < cheapest.pricePerRequest ? current : cheapest
  );
}

/**
 * Get marketplace statistics
 */
export function getMarketplaceStats(): MarketplaceStats {
  // This would require aggregation queries - return placeholder
  return {
    totalProviders: ALL_PROVIDERS.length,
    totalListings: 0,
    activeListings: 0,
    totalUsers: 0,
    totalRequests: 0n,
    totalVolume: 0n,
    last24hRequests: 0n,
    last24hVolume: 0n,
    pocStats: {
      pocRequiredListings: 0,
      verifiedVaultKeys: 0,
      pocVerifiedRequests: 0n,
    },
  };
}

/**
 * Get user account
 */
export async function getAccount(address: Address): Promise<UserAccount | undefined> {
  const row = await apiUserAccountState.getOrCreate(address);
  const listingIds = JSON.parse(row.active_listings) as string[];
  return {
    address: row.address as Address,
    balance: BigInt(row.balance),
    totalSpent: BigInt(row.total_spent),
    totalRequests: BigInt(row.total_requests),
    subscriptions: listingIds.map(id => ({ listingId: id, remainingRequests: 0n, periodEnd: 0 })),
  };
}

/**
 * Record a request for a listing
 */
export async function recordRequest(listingId: string, cost: bigint): Promise<void> {
  await apiListingState.incrementUsage(listingId, cost.toString());
}

// ============================================================================
// User Account Management
// ============================================================================

/**
 * Get or create user account
 */
export async function getOrCreateAccount(address: Address): Promise<UserAccount> {
  const row = await apiUserAccountState.getOrCreate(address);
  const listingIds = JSON.parse(row.active_listings) as string[];
  return {
    address: row.address as Address,
    balance: BigInt(row.balance),
    totalSpent: BigInt(row.total_spent),
    totalRequests: BigInt(row.total_requests),
    subscriptions: listingIds.map(id => ({ listingId: id, remainingRequests: 0n, periodEnd: 0 })),
  };
}

/**
 * Deposit funds to account
 */
export async function deposit(address: Address, amount: bigint): Promise<UserAccount> {
  await apiUserAccountState.updateBalance(address, amount.toString());
  return getOrCreateAccount(address);
}

/**
 * Withdraw funds from account
 */
export async function withdraw(address: Address, amount: bigint): Promise<UserAccount> {
  const account = await getOrCreateAccount(address);
  if (account.balance < amount) {
    throw new Error(`Insufficient balance: have ${account.balance}, need ${amount}`);
  }
  await apiUserAccountState.updateBalance(address, (-amount).toString());
  return getOrCreateAccount(address);
}

/**
 * Charge user for a request
 */
export async function chargeUser(address: Address, amount: bigint): Promise<boolean> {
  const account = await getOrCreateAccount(address);
  if (account.balance < amount) {
    return false;
  }
  await apiUserAccountState.recordRequest(address, amount.toString());
  return true;
}

/**
 * Check if user can afford a request
 */
export async function canAfford(address: Address, amount: bigint): Promise<boolean> {
  const account = await getOrCreateAccount(address);
  return account.balance >= amount;
}

// ============================================================================
// Provider Health (Ephemeral - not persisted)
// ============================================================================

/**
 * Update provider health status
 */
export function updateProviderHealth(
  providerId: string,
  healthy: boolean,
  latencyMs: number,
  errorRate: number
): void {
  providerHealth.set(providerId, {
    providerId,
    healthy,
    latencyMs,
    lastCheck: Date.now(),
    errorRate,
  });
}

/**
 * Get provider health
 */
export function getProviderHealth(providerId: string): ProviderHealth | undefined {
  return providerHealth.get(providerId);
}

/**
 * Get all provider health statuses
 */
export function getAllProviderHealth(): ProviderHealth[] {
  return Array.from(providerHealth.values());
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Get all providers
 */
export function getAllProviders(): APIProvider[] {
  return ALL_PROVIDERS;
}

/**
 * Get provider by ID
 */
export function getProviderById(id: string): APIProvider | undefined {
  return PROVIDERS_BY_ID.get(id);
}

// ============================================================================
// Auto-create system listings for configured providers
// ============================================================================

const SYSTEM_SELLER = '0x0000000000000000000000000000000000000001' as Address;

/**
 * Initialize system listings for all configured providers
 */
export async function initializeSystemListings(): Promise<void> {
  for (const provider of ALL_PROVIDERS) {
    if (process.env[provider.envVar]) {
      const existing = await getListingsBySeller(SYSTEM_SELLER);
      const hasListing = existing.some(l => l.providerId === provider.id);
      if (!hasListing) {
        await createListing({
          providerId: provider.id,
          seller: SYSTEM_SELLER,
          keyVaultId: `system:${provider.id}`,
          pricePerRequest: provider.defaultPricePerRequest,
        });
        console.log(`[API Marketplace] Created system listing for ${provider.name}`);
      }
    }
  }
}

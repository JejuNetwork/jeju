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

// Initialize state on module load (non-blocking, graceful fallback for dev)
initializeDWSState().catch((err) => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[API Marketplace] Running without CQL:', err.message);
  } else {
    console.error('[API Marketplace] CQL required in production:', err);
    throw err;
  }
});

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
}): APIListing {
  return {
    id: row.listing_id,
    providerId: row.provider_id,
    seller: row.seller as Address,
    keyVaultId: row.key_vault_id,
    pricePerRequest: BigInt(row.price_per_request),
    limits: JSON.parse(row.limits) as UsageLimits,
    accessControl: JSON.parse(row.access_control) as AccessControl,
    active: row.status === 'active',
    createdAt: row.created_at,
    totalRequests: BigInt(row.total_requests),
    totalRevenue: BigInt(row.total_revenue),
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
 * Get all listings (limited for performance)
 */
export async function getAllListings(limit = 100): Promise<APIListing[]> {
  const rows = await apiListingState.listAll(limit);
  return rows.map(row => rowToListing(row));
}

/**
 * Get listings by provider
 */
export async function getListingsByProvider(providerId: string): Promise<APIListing[]> {
  const rows = await apiListingState.listByProvider(providerId);
  return rows.map(row => rowToListing(row));
}

/**
 * Get active listings
 */
export async function getActiveListings(): Promise<APIListing[]> {
  const rows = await apiListingState.listActive();
  return rows.map(row => rowToListing(row));
}

// Helper to convert row to listing
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
  updated_at: number;
}): APIListing {
  const provider = getProvider(row.provider_id);
  const limits = JSON.parse(row.limits) as UsageLimits;
  const accessControl = JSON.parse(row.access_control);
  
  return {
    id: row.listing_id,
    providerId: row.provider_id,
    seller: row.seller as Address,
    keyVaultId: row.key_vault_id,
    pricePerRequest: BigInt(row.price_per_request || '0'),
    limits: { ...DEFAULT_LIMITS, ...limits },
    accessControl: { ...DEFAULT_ACCESS_CONTROL, ...accessControl },
    active: row.status === 'active',
    totalRequests: BigInt(row.total_requests),
    totalRevenue: BigInt(row.total_revenue || '0'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

  // Re-save with updates
  const updatedLimits = updates.limits ? { ...listing.limits, ...updates.limits } : listing.limits;
  const updatedAccessControl = updates.accessControl ? { ...listing.accessControl, ...updates.accessControl } : listing.accessControl;
  await apiListingState.save({
    listingId: listing.id,
    providerId: listing.providerId,
    seller: listing.seller,
    keyVaultId: listing.keyVaultId,
    pricePerRequest: (updates.pricePerRequest ?? listing.pricePerRequest).toString(),
    limits: updatedLimits as unknown as Record<string, number>,
    accessControl: updatedAccessControl as unknown as Record<string, string[]>,
    status: updates.active !== undefined ? (updates.active ? 'active' : 'inactive') : (listing.active ? 'active' : 'inactive'),
  });

  return {
    ...listing,
    pricePerRequest: updates.pricePerRequest ?? listing.pricePerRequest,
    limits: updates.limits ? { ...listing.limits, ...updates.limits } : listing.limits,
    accessControl: updates.accessControl ? { ...listing.accessControl, ...updates.accessControl } : listing.accessControl,
    active: updates.active ?? listing.active,
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
export async function getMarketplaceStats(): Promise<MarketplaceStats> {
  const stats = await apiListingState.getStats();
  
  return {
    totalProviders: ALL_PROVIDERS.length,
    totalListings: stats.totalListings,
    activeListings: stats.activeListings,
    totalUsers: 0, // Would need user count query
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
  // Handle both string and number values from database, including scientific notation
  const parseBalance = (val: string | number | null | undefined): bigint => {
    if (val === null || val === undefined || val === '') return 0n;
    const strVal = String(val);
    // Handle scientific notation (e.g., "1.0e+18")
    if (strVal.includes('e') || strVal.includes('E')) {
      const num = parseFloat(strVal);
      if (!Number.isFinite(num)) return 0n;
      // Round to avoid floating point issues
      return BigInt(Math.round(num));
    }
    // Handle regular integers
    return BigInt(strVal.split('.')[0]); // Remove any decimal part
  };
  return {
    address: row.address as Address,
    balance: parseBalance(row.balance),
    totalSpent: parseBalance(row.total_spent),
    totalRequests: BigInt(row.total_requests ?? 0),
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

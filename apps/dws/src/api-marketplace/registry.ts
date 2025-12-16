/**
 * API Marketplace Registry
 *
 * Manages providers, listings, and user accounts
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

// ============================================================================
// In-Memory Storage (would be on-chain in production)
// ============================================================================

const listings = new Map<string, APIListing>();
const userAccounts = new Map<Address, UserAccount>();
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
export function createListing(params: CreateListingParams): APIListing {
  const provider = getProvider(params.providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${params.providerId}`);
  }

  const id = crypto.randomUUID();
  const listing: APIListing = {
    id,
    providerId: params.providerId,
    seller: params.seller,
    keyVaultId: params.keyVaultId,
    pricePerRequest: params.pricePerRequest ?? provider.defaultPricePerRequest,
    limits: { ...DEFAULT_LIMITS, ...params.limits },
    accessControl: {
      ...DEFAULT_ACCESS_CONTROL,
      ...params.accessControl,
      allowedDomains: params.accessControl?.allowedDomains ?? DEFAULT_ACCESS_CONTROL.allowedDomains,
      blockedDomains: params.accessControl?.blockedDomains ?? DEFAULT_ACCESS_CONTROL.blockedDomains,
      allowedEndpoints: params.accessControl?.allowedEndpoints ?? DEFAULT_ACCESS_CONTROL.allowedEndpoints,
      blockedEndpoints: params.accessControl?.blockedEndpoints ?? DEFAULT_ACCESS_CONTROL.blockedEndpoints,
      allowedMethods: params.accessControl?.allowedMethods ?? DEFAULT_ACCESS_CONTROL.allowedMethods,
    },
    active: true,
    createdAt: Date.now(),
    totalRequests: 0n,
    totalRevenue: 0n,
  };

  listings.set(id, listing);
  return listing;
}

/**
 * Get a listing by ID
 */
export function getListing(id: string): APIListing | undefined {
  return listings.get(id);
}

/**
 * Get all listings
 */
export function getAllListings(): APIListing[] {
  return Array.from(listings.values());
}

/**
 * Get listings by provider
 */
export function getListingsByProvider(providerId: string): APIListing[] {
  return Array.from(listings.values()).filter((l) => l.providerId === providerId);
}

/**
 * Get listings by seller
 */
export function getListingsBySeller(seller: Address): APIListing[] {
  return Array.from(listings.values()).filter(
    (l) => l.seller.toLowerCase() === seller.toLowerCase()
  );
}

/**
 * Get active listings
 */
export function getActiveListings(): APIListing[] {
  return Array.from(listings.values()).filter((l) => l.active);
}

/**
 * Update listing
 */
export function updateListing(
  id: string,
  updates: Partial<Pick<APIListing, 'pricePerRequest' | 'limits' | 'accessControl' | 'active'>>
): APIListing {
  const listing = listings.get(id);
  if (!listing) {
    throw new Error(`Listing not found: ${id}`);
  }

  if (updates.pricePerRequest !== undefined) {
    listing.pricePerRequest = updates.pricePerRequest;
  }
  if (updates.limits) {
    listing.limits = { ...listing.limits, ...updates.limits };
  }
  if (updates.accessControl) {
    listing.accessControl = { ...listing.accessControl, ...updates.accessControl };
  }
  if (updates.active !== undefined) {
    listing.active = updates.active;
  }

  return listing;
}

/**
 * Record a request for a listing
 */
export function recordRequest(listingId: string, cost: bigint): void {
  const listing = listings.get(listingId);
  if (listing) {
    listing.totalRequests += 1n;
    listing.totalRevenue += cost;
  }
}

// ============================================================================
// User Account Management
// ============================================================================

/**
 * Get or create user account
 */
export function getOrCreateAccount(address: Address): UserAccount {
  const normalized = address.toLowerCase() as Address;
  let account = userAccounts.get(normalized);
  if (!account) {
    account = {
      address: normalized,
      balance: 0n,
      totalSpent: 0n,
      totalRequests: 0n,
      subscriptions: [],
    };
    userAccounts.set(normalized, account);
  }
  return account;
}

/**
 * Get user account
 */
export function getAccount(address: Address): UserAccount | undefined {
  return userAccounts.get(address.toLowerCase() as Address);
}

/**
 * Deposit funds to account
 */
export function deposit(address: Address, amount: bigint): UserAccount {
  const account = getOrCreateAccount(address);
  account.balance += amount;
  return account;
}

/**
 * Withdraw funds from account
 */
export function withdraw(address: Address, amount: bigint): UserAccount {
  const account = getOrCreateAccount(address);
  if (account.balance < amount) {
    throw new Error(`Insufficient balance: have ${account.balance}, need ${amount}`);
  }
  account.balance -= amount;
  return account;
}

/**
 * Charge user for a request
 */
export function chargeUser(address: Address, amount: bigint): boolean {
  const account = getOrCreateAccount(address);
  if (account.balance < amount) {
    return false;
  }
  account.balance -= amount;
  account.totalSpent += amount;
  account.totalRequests += 1n;
  return true;
}

/**
 * Check if user can afford a request
 */
export function canAfford(address: Address, amount: bigint): boolean {
  const account = getAccount(address);
  return account ? account.balance >= amount : false;
}

// ============================================================================
// Provider Health
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
// Marketplace Stats
// ============================================================================

/**
 * Get marketplace statistics
 */
export function getMarketplaceStats(): MarketplaceStats {
  const allListings = Array.from(listings.values());
  const activeListings = allListings.filter((l) => l.active);

  const totalRequests = allListings.reduce((sum, l) => sum + l.totalRequests, 0n);
  const totalVolume = allListings.reduce((sum, l) => sum + l.totalRevenue, 0n);

  // Calculate 24h stats (simplified - in production would use time-series data)
  const last24hRequests = totalRequests / 30n; // Rough estimate
  const last24hVolume = totalVolume / 30n;

  return {
    totalProviders: ALL_PROVIDERS.length,
    totalListings: allListings.length,
    activeListings: activeListings.length,
    totalUsers: userAccounts.size,
    totalRequests,
    totalVolume,
    last24hRequests,
    last24hVolume,
  };
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

/**
 * Find cheapest listing for a provider
 */
export function findCheapestListing(providerId: string): APIListing | undefined {
  const providerListings = getListingsByProvider(providerId).filter((l) => l.active);
  if (providerListings.length === 0) return undefined;
  return providerListings.reduce((cheapest, current) =>
    current.pricePerRequest < cheapest.pricePerRequest ? current : cheapest
  );
}

// ============================================================================
// Auto-create system listings for configured providers
// ============================================================================

const SYSTEM_SELLER = '0x0000000000000000000000000000000000000001' as Address;

/**
 * Initialize system listings for all configured providers
 */
export function initializeSystemListings(): void {
  for (const provider of ALL_PROVIDERS) {
    if (process.env[provider.envVar]) {
      // Check if system listing already exists
      const existing = getListingsByProvider(provider.id).find(
        (l) => l.seller.toLowerCase() === SYSTEM_SELLER.toLowerCase()
      );
      if (!existing) {
        createListing({
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

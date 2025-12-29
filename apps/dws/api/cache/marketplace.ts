/**
 * Cache Service Marketplace Integration
 *
 * Integrates the serverless cache service with the DWS API marketplace.
 * Enables cache instances to be discovered, provisioned, and billed through
 * the same infrastructure as other API providers.
 */

import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import type {
  APIListing,
  APIProvider,
  ProviderCategory,
  UsageLimits,
} from '../api-marketplace/types'
import {
  getCacheProvisioningManager,
  initializeCacheProvisioning,
} from './provisioning'
import { type CacheInstance, type CacheRentalPlan, CacheTier } from './types'

// Cache Provider Definitions for API Marketplace

export const CACHE_PROVIDERS: APIProvider[] = [
  {
    id: 'jeju-cache-standard',
    name: 'Jeju Cache Standard',
    description: 'Serverless Redis-compatible cache - shared multi-tenant',
    baseUrl:
      process.env.DWS_CACHE_ENDPOINT ?? 'https://cache.dws.jejunetwork.org',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'rest',
    categories: ['storage'] as ProviderCategory[],
    envVar: 'JEJU_CACHE_API_KEY',
    defaultPricePerRequest: 0n, // Free tier
    knownEndpoints: [
      '/cache/get',
      '/cache/set',
      '/cache/del',
      '/cache/mget',
      '/cache/mset',
      '/cache/hget',
      '/cache/hset',
      '/cache/hgetall',
      '/cache/lpush',
      '/cache/rpush',
      '/cache/lrange',
      '/cache/sadd',
      '/cache/smembers',
      '/cache/zadd',
      '/cache/zrange',
      '/cache/keys',
      '/cache/ttl',
      '/cache/expire',
    ],
    supportsStreaming: false,
  },
  {
    id: 'jeju-cache-premium',
    name: 'Jeju Cache Premium',
    description:
      'Serverless Redis-compatible cache - dedicated resources with SLA',
    baseUrl:
      process.env.DWS_CACHE_ENDPOINT ?? 'https://cache.dws.jejunetwork.org',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'rest',
    categories: ['storage'] as ProviderCategory[],
    envVar: 'JEJU_CACHE_API_KEY',
    defaultPricePerRequest: 1000000000000n, // 0.000001 ETH
    knownEndpoints: [
      '/cache/get',
      '/cache/set',
      '/cache/del',
      '/cache/mget',
      '/cache/mset',
      '/cache/hget',
      '/cache/hset',
      '/cache/hgetall',
      '/cache/lpush',
      '/cache/rpush',
      '/cache/lrange',
      '/cache/sadd',
      '/cache/smembers',
      '/cache/zadd',
      '/cache/zrange',
      '/cache/keys',
      '/cache/ttl',
      '/cache/expire',
    ],
    supportsStreaming: false,
  },
  {
    id: 'jeju-cache-tee',
    name: 'Jeju Cache TEE Secure',
    description: 'TEE-backed cache with memory encryption and attestation',
    baseUrl:
      process.env.DWS_CACHE_ENDPOINT ?? 'https://cache.dws.jejunetwork.org',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'rest',
    categories: ['storage'] as ProviderCategory[],
    envVar: 'JEJU_CACHE_API_KEY',
    defaultPricePerRequest: 5000000000000n, // 0.000005 ETH
    knownEndpoints: [
      '/cache/get',
      '/cache/set',
      '/cache/del',
      '/cache/mget',
      '/cache/mset',
      '/cache/hget',
      '/cache/hset',
      '/cache/hgetall',
      '/cache/lpush',
      '/cache/rpush',
      '/cache/lrange',
      '/cache/sadd',
      '/cache/smembers',
      '/cache/zadd',
      '/cache/zrange',
      '/cache/keys',
      '/cache/ttl',
      '/cache/expire',
      '/cache/attestation',
    ],
    supportsStreaming: false,
  },
]

/**
 * Convert a cache rental plan to marketplace listing format
 */
export function planToListing(
  plan: CacheRentalPlan,
  seller: Address,
  instanceId?: string,
): APIListing {
  const providerId =
    plan.tier === CacheTier.TEE
      ? 'jeju-cache-tee'
      : plan.tier === CacheTier.PREMIUM
        ? 'jeju-cache-premium'
        : 'jeju-cache-standard'

  const listingId = instanceId
    ? `cache-${instanceId}`
    : `cache-${keccak256(toBytes(`${seller}:${plan.id}:${Date.now()}`)).slice(2, 18)}`

  const limits: UsageLimits = {
    requestsPerSecond: plan.tier === CacheTier.STANDARD ? 10 : 100,
    requestsPerMinute: plan.tier === CacheTier.STANDARD ? 100 : 1000,
    requestsPerDay:
      plan.tier === CacheTier.STANDARD
        ? 10000
        : plan.tier === CacheTier.PREMIUM
          ? 100000
          : 1000000,
    requestsPerMonth:
      plan.tier === CacheTier.STANDARD
        ? 300000
        : plan.tier === CacheTier.PREMIUM
          ? 3000000
          : 30000000,
  }

  return {
    id: listingId,
    providerId,
    seller,
    keyVaultId: '', // Cache doesn't use traditional key vault
    pricePerRequest: plan.pricePerHour > 0n ? plan.pricePerHour / 3600n : 0n,
    limits,
    accessControl: {
      allowedDomains: ['*'],
      blockedDomains: [],
      allowedEndpoints: ['/cache/*'],
      blockedEndpoints: [],
      allowedMethods: ['GET', 'POST', 'DELETE'],
    },
    active: true,
    createdAt: Date.now(),
    totalRequests: 0n,
    totalRevenue: 0n,
    riskLevel: plan.teeRequired ? 'high' : 'low',
    requiredPoCLevel: plan.teeRequired ? 2 : undefined,
  }
}

/**
 * Convert a cache instance to marketplace listing format
 */
export function instanceToListing(instance: CacheInstance): APIListing {
  const providerId =
    instance.tier === CacheTier.TEE
      ? 'jeju-cache-tee'
      : instance.tier === CacheTier.PREMIUM
        ? 'jeju-cache-premium'
        : 'jeju-cache-standard'

  const limits: UsageLimits = {
    requestsPerSecond: instance.tier === CacheTier.STANDARD ? 10 : 100,
    requestsPerMinute: instance.tier === CacheTier.STANDARD ? 100 : 1000,
    requestsPerDay:
      instance.tier === CacheTier.STANDARD
        ? 10000
        : instance.tier === CacheTier.PREMIUM
          ? 100000
          : 1000000,
    requestsPerMonth:
      instance.tier === CacheTier.STANDARD
        ? 300000
        : instance.tier === CacheTier.PREMIUM
          ? 3000000
          : 30000000,
  }

  return {
    id: `cache-${instance.id}`,
    providerId,
    seller: instance.owner,
    keyVaultId: instance.id,
    pricePerRequest: 0n, // Instance owner pays upfront
    limits,
    accessControl: {
      allowedDomains: ['*'],
      blockedDomains: [],
      allowedEndpoints: ['/cache/*'],
      blockedEndpoints: [],
      allowedMethods: ['GET', 'POST', 'DELETE'],
    },
    active: instance.status === 'running',
    createdAt: instance.createdAt,
    totalRequests: 0n,
    totalRevenue: 0n,
    riskLevel: instance.tier === CacheTier.TEE ? 'high' : 'low',
    requiredPoCLevel: instance.tier === CacheTier.TEE ? 2 : undefined,
  }
}

// DWS Node Type Extension

export const DWS_CACHE_TAG = 'dws-cache'
export const DWS_CACHE_TEE_TAG = 'dws-cache-tee'

/**
 * Get cache-related tags for DWS node registration
 */
export function getCacheNodeTags(tier: CacheTier): string[] {
  const tags = ['dws', DWS_CACHE_TAG]
  if (tier === CacheTier.TEE) {
    tags.push(DWS_CACHE_TEE_TAG)
  }
  return tags
}

/**
 * Get metadata for DWS node registration
 */
export function getCacheNodeMetadata(
  endpoint: string,
  tier: CacheTier,
  maxMemoryMb: number,
): Record<string, string> {
  return {
    dwsEndpoint: endpoint,
    dwsCacheEndpoint: `${endpoint}/cache`,
    dwsCacheTier: tier,
    dwsCacheMaxMemoryMb: maxMemoryMb.toString(),
    dwsNodeType: 'cache',
    dwsVersion: '1.0.0',
  }
}

// Integration with API Marketplace

/**
 * Register cache providers with the API marketplace
 */
export function registerCacheProviders(
  existingProviders: APIProvider[],
): APIProvider[] {
  // Check if already registered
  const hasCache = existingProviders.some((p) => p.id.startsWith('jeju-cache'))
  if (hasCache) {
    return existingProviders
  }

  return [...existingProviders, ...CACHE_PROVIDERS]
}

/**
 * Create a cache service listing from provisioning
 */
export async function createCacheListing(
  owner: Address,
  planId: string,
  namespace?: string,
  durationHours?: number,
): Promise<{ listing: APIListing; instance: CacheInstance }> {
  const manager = getCacheProvisioningManager()

  // Ensure manager is initialized
  const globalStats = manager.getGlobalStats()
  if (globalStats.totalInstances === 0 && globalStats.totalNodes === 0) {
    await initializeCacheProvisioning()
  }

  // Create instance
  const instance = await manager.createInstance(
    owner,
    planId,
    namespace,
    durationHours,
  )

  // Create listing
  const listing = instanceToListing(instance)

  return { listing, instance }
}

/**
 * Get all cache listings from active instances
 */
export function getCacheListings(): APIListing[] {
  const manager = getCacheProvisioningManager()
  const instances = manager.getAllInstances()
  return instances.map(instanceToListing)
}

/**
 * Get cache listing by instance ID
 */
export function getCacheListing(instanceId: string): APIListing | null {
  const manager = getCacheProvisioningManager()
  const instance = manager.getInstance(instanceId)
  if (!instance) return null
  return instanceToListing(instance)
}

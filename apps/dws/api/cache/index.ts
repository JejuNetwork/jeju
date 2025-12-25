/**
 * DWS Cache Service
 *
 * Serverless decentralized cache with:
 * - Redis-compatible API
 * - Namespace isolation and multi-tenancy
 * - Standard, Premium, and TEE-backed tiers
 * - LRU eviction with TTL
 * - dstack TEE simulator support for local development
 *
 * Usage:
 *
 * ```typescript
 * import { createCacheService } from './cache'
 *
 * const app = await createCacheService()
 * app.listen(4015)
 * ```
 */

// Types
export * from './types'

// Engine
export { CacheEngine } from './engine'

// TEE Provider
export {
  createTEECacheProvider,
  TEECacheProvider,
  type CreateTEECacheProviderConfig,
  type TEECacheProviderConfig,
} from './tee-provider'

// Provisioning
export {
  CacheProvisioningManager,
  getCacheProvisioningManager,
  initializeCacheProvisioning,
  resetCacheProvisioning,
} from './provisioning'

// Routes
export { createCacheRoutes, createCacheService } from './routes'

// Marketplace Integration
export {
  CACHE_PROVIDERS,
  createCacheListing,
  DWS_CACHE_TAG,
  DWS_CACHE_TEE_TAG,
  getCacheListing,
  getCacheListings,
  getCacheNodeMetadata,
  getCacheNodeTags,
  instanceToListing,
  planToListing,
  registerCacheProviders,
} from './marketplace'

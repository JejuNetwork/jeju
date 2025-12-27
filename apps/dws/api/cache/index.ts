/**
 * DWS Cache Service
 *
 * Serverless decentralized cache with:
 * - Redis-compatible API
 * - Namespace isolation and multi-tenancy
 * - Standard, Premium, and TEE-backed tiers
 * - LRU eviction with TTL
 * - dstack TEE simulator support for local development
 * - x402 payment protocol for billing
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

// Billing
export {
  type BillingInvoice,
  BillingMode,
  CacheBillingManager,
  type CachePayment,
  type CachePaymentConfig,
  type CacheSubscription,
  getCacheBillingManager,
  type InvoiceLineItem,
  initializeCacheBilling,
  type PaymentProof,
  type PaymentRequirement,
  PaymentStatus,
  parseBillingMode,
  resetCacheBilling,
  SubscriptionStatus,
  type UsageMetrics,
} from './billing'
// Engine
export { CacheEngine } from './engine'
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
// Provisioning
export {
  CacheProvisioningManager,
  getCacheProvisioningManager,
  initializeCacheProvisioning,
  resetCacheProvisioning,
} from './provisioning'
// Redis Protocol Server (for ioredis, node-redis compatibility)
export {
  createRedisProtocolServer,
  type RedisProtocolConfig,
  RedisProtocolServer,
} from './redis-protocol'
// Routes
export {
  createCacheRoutes,
  createCacheService,
  getSharedEngine,
} from './routes'
// TEE Provider
export {
  type CreateTEECacheProviderConfig,
  createTEECacheProvider,
  TEECacheProvider,
  type TEECacheProviderConfig,
} from './tee-provider'
// Types
export * from './types'

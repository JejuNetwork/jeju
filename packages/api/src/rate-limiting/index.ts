/**
 * Rate Limiting Module
 *
 * Framework-agnostic rate limiting with Elysia adapter.
 *
 * @example
 * // Using core functions
 * import { RateLimiter, createRateLimitKey } from '@jejunetwork/api/rate-limiting/core'
 *
 * // Using Elysia adapter
 * import { rateLimitPlugin, simpleRateLimit } from '@jejunetwork/api/rate-limiting/elysia'
 */

// Core
export {
  createRateLimitHeaders,
  createRateLimitKey,
  extractClientIp,
  getRateLimiter,
  InMemoryRateLimitStore,
  initRateLimiter,
  RateLimiter,
  resetRateLimiter,
} from './core.js'
// Elysia adapter
export {
  type RateLimitContext,
  type RateLimitPluginConfig,
  rateLimitPlugin,
  simpleRateLimit,
  tieredRateLimit,
  withRateLimit,
} from './elysia.js'
// Types
export {
  type RateLimitEntry,
  type RateLimiterConfig,
  type RateLimitHeaders,
  type RateLimitResult,
  type RateLimitStore,
  type RateLimitTier,
  RateLimitTiers,
} from './types.js'

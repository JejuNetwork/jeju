/**
 * @jejunetwork/cache - Type Definitions
 *
 * Decentralized serverless cache with Redis compatibility.
 */

import { z } from 'zod'

/**
 * Cache entry wrapper
 */
export interface CacheEntry<T = string> {
  /** The actual data */
  data: T
  /** Timestamp when entry was created */
  createdAt: number
  /** Timestamp when entry was last accessed */
  lastAccessedAt: number
  /** TTL in seconds (0 = no expiration) */
  ttlSeconds: number
}

/**
 * Response wrapper for cache operations
 */
export interface CacheResponse<T = string> {
  /** The data value */
  data: T
  /** Timestamp when set */
  setAtTimestamp: number
  /** Duration of the operation in ms */
  duration?: number
}

/**
 * Cache client configuration
 */
export interface CacheClientConfig {
  /** DWS cache server URL */
  serverUrl: string
  /** Cache namespace for isolation (default: 'default') */
  namespace?: string
  /** Default TTL in seconds (default: 3600) */
  defaultTtlSeconds?: number
  /** Max retries for failed requests (default: 3) */
  maxRetries?: number
  /** Base delay in ms for exponential backoff (default: 100) */
  baseDelayMs?: number
  /** Max delay in ms for exponential backoff (default: 5000) */
  maxDelayMs?: number
}

/**
 * Cache server configuration
 */
export interface CacheServerConfig {
  /** Maximum memory in MB (default: 256) */
  maxMemoryMb?: number
  /** Default TTL in seconds (default: 3600) */
  defaultTtlSeconds?: number
  /** Maximum TTL in seconds (default: 30 days) */
  maxTtlSeconds?: number
}

/**
 * Options for cache set operations
 */
export interface CacheSetOptions {
  /** TTL in seconds */
  ttl?: number
  /** Only set if key does not exist */
  nx?: boolean
  /** Only set if key exists */
  xx?: boolean
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total keys in cache */
  totalKeys: number
  /** Used memory in bytes */
  usedMemoryBytes: number
  /** Maximum memory in bytes */
  maxMemoryBytes: number
  /** Cache hits */
  hits: number
  /** Cache misses */
  misses: number
  /** Hit rate (0-1) */
  hitRate: number
  /** Total evictions */
  evictions: number
  /** Expired keys cleaned up */
  expiredKeys: number
  /** Average key size in bytes */
  avgKeySize: number
  /** Average value size in bytes */
  avgValueSize: number
  /** Age of oldest key in ms */
  oldestKeyAge: number
  /** Number of namespaces */
  namespaces: number
  /** Uptime in ms */
  uptime: number
}

// Zod schemas for validation

export const CacheSetOptionsSchema = z.object({
  ttl: z.number().optional(),
  nx: z.boolean().optional(),
  xx: z.boolean().optional(),
})

export const CacheStatsSchema = z.object({
  totalKeys: z.number(),
  usedMemoryBytes: z.number(),
  maxMemoryBytes: z.number(),
  hits: z.number(),
  misses: z.number(),
  hitRate: z.number(),
  evictions: z.number(),
  expiredKeys: z.number(),
  avgKeySize: z.number(),
  avgValueSize: z.number(),
  oldestKeyAge: z.number(),
  namespaces: z.number(),
  uptime: z.number(),
})

/**
 * Error codes for cache operations
 */
export const CacheErrorCode = {
  KEY_NOT_FOUND: 'KEY_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_TTL: 'INVALID_TTL',
  SERVER_ERROR: 'SERVER_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
} as const

export type CacheErrorCode = (typeof CacheErrorCode)[keyof typeof CacheErrorCode]

/**
 * Cache error class
 */
export class CacheError extends Error {
  constructor(
    public readonly code: CacheErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'CacheError'
  }
}

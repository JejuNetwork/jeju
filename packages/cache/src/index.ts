/**
 * @jejunetwork/cache
 *
 * Production-ready decentralized serverless cache with Redis compatibility.
 *
 * Features:
 * - Redis-compatible API (GET, SET, HSET, LPUSH, SADD, ZADD, etc.)
 * - Automatic retries with exponential backoff
 * - Namespace isolation for multi-tenancy
 * - Rate limiting awareness
 * - Works in browser, Node.js, and serverless environments
 *
 * @example
 * ```typescript
 * import { CacheClient } from '@jejunetwork/cache'
 *
 * const cache = new CacheClient({
 *   serverUrl: 'https://dws.jeju.network',
 *   namespace: 'my-app',
 * })
 *
 * // Simple set/get
 * await cache.set('key', 'value')
 * const value = await cache.get('key')
 *
 * // With TTL
 * await cache.set('key', 'value', { ttl: 3600 })
 *
 * // Hash operations
 * await cache.hset('user:1', 'name', 'Alice')
 * const name = await cache.hget('user:1', 'name')
 *
 * // List operations
 * await cache.rpush('queue', 'task1', 'task2')
 * const task = await cache.lpop('queue')
 *
 * // Set operations
 * await cache.sadd('tags', 'redis', 'cache', 'fast')
 * const tags = await cache.smembers('tags')
 *
 * // Sorted set operations
 * await cache.zadd('leaderboard', { member: 'player1', score: 100 })
 * const top3 = await cache.zrange('leaderboard', 0, 2)
 * ```
 */

// Client
export { CacheClient, createCacheClient } from './client'

// Types
export {
  // Types
  type CacheClientConfig,
  type CacheEntry,
  // Error handling
  CacheError,
  CacheErrorCode,
  type CacheResponse,
  type CacheServerConfig,
  type CacheSetOptions,
  type CacheStats,
} from './types'

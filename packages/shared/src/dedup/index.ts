/**
 * Duplicate Content Detection Utility
 *
 * Prevents users from posting duplicate content in a short time period.
 * Uses content hashing to detect exact and near-duplicate content.
 *
 * @module @jejunetwork/shared/dedup
 */

import type { CacheClient } from '../cache'
import { getCacheClient } from '../cache'
import { bytesToHex, hash256 } from '../crypto/universal'
import { logger } from '../logger'

interface DuplicateRecord {
  contentHash: string
  timestamp: number
}

// Distributed cache for duplicate detection
let dedupCache: CacheClient | null = null

function getDedupCache(): CacheClient {
  if (!dedupCache) {
    dedupCache = getCacheClient('dedup')
  }
  return dedupCache
}

/**
 * Duplicate detection configurations
 */
export const DUPLICATE_DETECTION_CONFIGS = {
  POST: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    actionType: 'post',
  },
  COMMENT: {
    windowMs: 2 * 60 * 1000, // 2 minutes
    actionType: 'comment',
  },
  MESSAGE: {
    windowMs: 1 * 60 * 1000, // 1 minute
    actionType: 'message',
  },
} as const

export type DuplicateConfigType = keyof typeof DUPLICATE_DETECTION_CONFIGS

export interface DuplicateConfig {
  windowMs: number
  actionType: string
}

export interface DuplicateCheckResult {
  isDuplicate: boolean
  lastPostedAt?: Date
}

/**
 * Create a hash of content for duplicate detection
 * Normalizes content by removing extra whitespace and converting to lowercase
 */
function hashContent(content: string): string {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ')
  return bytesToHex(hash256(normalized))
}

/**
 * Check if content is a duplicate
 *
 * Returns true if the same content was posted recently by the same user.
 *
 * @param userId - User identifier
 * @param content - Content to check
 * @param config - Duplicate detection configuration
 * @returns DuplicateCheckResult with isDuplicate flag and lastPostedAt if duplicate
 *
 * @example
 * ```typescript
 * const result = await checkDuplicate(
 *   userId,
 *   postContent,
 *   DUPLICATE_DETECTION_CONFIGS.POST
 * )
 * if (result.isDuplicate) {
 *   throw new Error('Please wait before posting similar content')
 * }
 * ```
 */
export async function checkDuplicate(
  userId: string,
  content: string,
  config: DuplicateConfig,
): Promise<DuplicateCheckResult> {
  const cache = getDedupCache()
  const cacheKey = `dedup:${userId}:${config.actionType}`
  const contentHash = hashContent(content)
  const now = Date.now()
  const ttlSeconds = Math.ceil((config.windowMs * 2) / 1000)

  // Get existing records from cache
  const cached = await cache.get(cacheKey)
  let records: DuplicateRecord[] = cached ? JSON.parse(cached) : []

  // Remove old records outside the window
  const windowStart = now - config.windowMs
  records = records.filter((record) => record.timestamp > windowStart)

  // Check for duplicate
  const duplicate = records.find((record) => record.contentHash === contentHash)

  if (duplicate) {
    logger.warn('Duplicate content detected', {
      userId,
      actionType: config.actionType,
      contentHash,
      lastPostedAt: new Date(duplicate.timestamp).toISOString(),
    })

    return {
      isDuplicate: true,
      lastPostedAt: new Date(duplicate.timestamp),
    }
  }

  // Record this content
  records.push({
    contentHash,
    timestamp: now,
  })

  // Save updated records
  await cache.set(cacheKey, JSON.stringify(records), ttlSeconds)

  logger.debug('Content uniqueness check passed', {
    userId,
    actionType: config.actionType,
    contentHash,
  })

  return {
    isDuplicate: false,
  }
}

/**
 * Clear duplicate records for a user and action type
 */
export async function clearDuplicates(
  userId: string,
  actionType: string,
): Promise<void> {
  const cache = getDedupCache()
  const cacheKey = `dedup:${userId}:${actionType}`
  await cache.delete(cacheKey)
  logger.info('Duplicate records cleared', { userId, actionType })
}

/**
 * Clear all duplicate records
 */
export async function clearAllDuplicates(): Promise<void> {
  const cache = getDedupCache()
  await cache.clear()
  logger.info('All duplicate records cleared')
}

// Cleanup handled by distributed cache TTL - no periodic cleanup needed

/**
 * Get statistics about duplicate detection
 * Note: Returns estimated stats based on cache keys
 */
export async function getDuplicateStats(): Promise<{
  totalUsers: number
  totalRecords: number
  recordsByType: Record<string, number>
}> {
  const cache = getDedupCache()
  const keys = await cache.keys('dedup:*')
  const size = keys.length

  // Cache stores per-user-per-action entries, so size approximates users
  return {
    totalUsers: size,
    totalRecords: size, // Each entry contains records for one user/action combo
    recordsByType: {}, // Type breakdown not available without iterating all keys
  }
}

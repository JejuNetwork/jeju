/**
 * EQLite-backed Distributed Rate Limit Store
 *
 * Uses EQLite for distributed rate limiting across multiple nodes.
 * Provides eventual consistency with atomic increment operations.
 */

import type { EQLiteClient } from '@jejunetwork/db'
import type { RateLimitEntry, RateLimitStore } from './types.js'

const RATE_LIMIT_TABLE = 'rate_limits'
const SCHEMA_VERSION = 1

export interface EQLiteRateLimitStoreConfig {
  /** EQLite client instance */
  client: EQLiteClient
  /** Database ID for rate limit data */
  databaseId: string
  /** Key prefix for namespacing */
  keyPrefix?: string
  /** How often to cleanup expired entries (ms) - default 5 minutes */
  cleanupIntervalMs?: number
}

export class EQLiteRateLimitStore implements RateLimitStore {
  private client: EQLiteClient
  private databaseId: string
  private keyPrefix: string
  private initialized = false
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: EQLiteRateLimitStoreConfig) {
    this.client = config.client
    this.databaseId = config.databaseId
    this.keyPrefix = config.keyPrefix ?? 'rl'

    // Start cleanup interval
    const cleanupMs = config.cleanupIntervalMs ?? 5 * 60 * 1000
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((err: Error) => {
        console.error('[EQLiteRateLimitStore] Cleanup failed:', err.message)
      })
    }, cleanupMs)
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    await this.client.exec(
      `CREATE TABLE IF NOT EXISTS ${RATE_LIMIT_TABLE} (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        reset_at INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION},
        updated_at INTEGER NOT NULL
      )`,
      [],
      this.databaseId,
    )

    await this.client.exec(
      `CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON ${RATE_LIMIT_TABLE}(reset_at)`,
      [],
      this.databaseId,
    )

    this.initialized = true
  }

  private makeKey(key: string): string {
    return `${this.keyPrefix}:${key}`
  }

  async get(key: string): Promise<RateLimitEntry | undefined> {
    await this.ensureInitialized()

    const fullKey = this.makeKey(key)
    const result = await this.client.query<{
      count: number
      reset_at: number
    }>(
      `SELECT count, reset_at FROM ${RATE_LIMIT_TABLE} WHERE key = ?`,
      [fullKey],
      this.databaseId,
    )

    if (result.rows.length === 0) {
      return undefined
    }

    const row = result.rows[0]
    return {
      count: row.count,
      resetAt: row.reset_at,
    }
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    await this.ensureInitialized()

    const fullKey = this.makeKey(key)
    const now = Date.now()

    // Use upsert pattern for atomic update
    await this.client.exec(
      `INSERT INTO ${RATE_LIMIT_TABLE} (key, count, reset_at, schema_version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = excluded.count,
         reset_at = excluded.reset_at,
         updated_at = excluded.updated_at`,
      [fullKey, entry.count, entry.resetAt, SCHEMA_VERSION, now],
      this.databaseId,
    )
  }

  /**
   * Atomic increment - increments count and returns new value
   * Uses upsert with conditional logic for atomic operation
   */
  async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }> {
    await this.ensureInitialized()

    const fullKey = this.makeKey(key)
    const now = Date.now()
    const newResetAt = now + windowMs

    // First, try to get current entry
    const result = await this.client.query<{
      count: number
      reset_at: number
    }>(
      `SELECT count, reset_at FROM ${RATE_LIMIT_TABLE} WHERE key = ?`,
      [fullKey],
      this.databaseId,
    )

    let newCount: number
    let finalResetAt: number

    if (result.rows.length === 0) {
      // New entry - insert with count 1
      newCount = 1
      finalResetAt = newResetAt
      await this.client.exec(
        `INSERT INTO ${RATE_LIMIT_TABLE} (key, count, reset_at, schema_version, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN excluded.reset_at > ${RATE_LIMIT_TABLE}.reset_at
                        THEN 1 ELSE ${RATE_LIMIT_TABLE}.count + 1 END,
           reset_at = CASE WHEN excluded.reset_at > ${RATE_LIMIT_TABLE}.reset_at
                           THEN excluded.reset_at ELSE ${RATE_LIMIT_TABLE}.reset_at END,
           updated_at = excluded.updated_at`,
        [fullKey, newCount, finalResetAt, SCHEMA_VERSION, now],
        this.databaseId,
      )
    } else {
      const current = result.rows[0]

      if (current.reset_at < now) {
        // Window expired, start new window
        newCount = 1
        finalResetAt = newResetAt
      } else {
        // Increment within current window
        newCount = current.count + 1
        finalResetAt = current.reset_at
      }

      // Use atomic update with version check
      await this.client.exec(
        `UPDATE ${RATE_LIMIT_TABLE}
         SET count = CASE WHEN reset_at < ? THEN 1 ELSE count + 1 END,
             reset_at = CASE WHEN reset_at < ? THEN ? ELSE reset_at END,
             updated_at = ?
         WHERE key = ?`,
        [now, now, newResetAt, now, fullKey],
        this.databaseId,
      )
    }

    return { count: newCount, resetAt: finalResetAt }
  }

  async delete(key: string): Promise<void> {
    await this.ensureInitialized()

    const fullKey = this.makeKey(key)
    await this.client.exec(
      `DELETE FROM ${RATE_LIMIT_TABLE} WHERE key = ?`,
      [fullKey],
      this.databaseId,
    )
  }

  async clear(): Promise<void> {
    await this.ensureInitialized()

    // Only clear entries with our prefix
    await this.client.exec(
      `DELETE FROM ${RATE_LIMIT_TABLE} WHERE key LIKE ?`,
      [`${this.keyPrefix}:%`],
      this.databaseId,
    )
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<number> {
    if (!this.initialized) return 0

    const now = Date.now()
    const result = await this.client.exec(
      `DELETE FROM ${RATE_LIMIT_TABLE} WHERE reset_at < ?`,
      [now],
      this.databaseId,
    )

    return result.rowsAffected
  }

  /**
   * Get stats about the store
   */
  async getStats(): Promise<{
    totalEntries: number
    activeEntries: number
    expiredEntries: number
  }> {
    await this.ensureInitialized()

    const now = Date.now()

    const total = await this.client.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${RATE_LIMIT_TABLE} WHERE key LIKE ?`,
      [`${this.keyPrefix}:%`],
      this.databaseId,
    )

    const active = await this.client.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${RATE_LIMIT_TABLE} WHERE key LIKE ? AND reset_at >= ?`,
      [`${this.keyPrefix}:%`, now],
      this.databaseId,
    )

    const totalCount = total.rows[0]?.count ?? 0
    const activeCount = active.rows[0]?.count ?? 0

    return {
      totalEntries: totalCount,
      activeEntries: activeCount,
      expiredEntries: totalCount - activeCount,
    }
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }
}

/**
 * Create a EQLite-backed rate limit store
 */
export function createEQLiteRateLimitStore(
  config: EQLiteRateLimitStoreConfig,
): EQLiteRateLimitStore {
  return new EQLiteRateLimitStore(config)
}


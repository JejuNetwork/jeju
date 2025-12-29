/**
 * Content Status Cache
 *
 * Caches moderation results for content that has already been processed.
 * This avoids redundant processing of the same content.
 *
 * Key features:
 * - SHA256-based lookup (exact match)
 * - Perceptual hash lookup (similar images) - only for non-CSAM
 * - Attribution tracking (wallets that uploaded this content)
 * - Retroactive enforcement support
 */

import { logger } from '../logger'
import type { Address } from 'viem'

export type ContentStatusType = 'clean' | 'nsfw_adult' | 'quarantined' | 'banned'

export interface ContentStatus {
  sha256: string
  
  // Status
  status: ContentStatusType
  policyClass?: string
  
  // Detection history
  firstSeen: number
  lastSeen: number
  seenCount: number
  
  // Attribution (for retroactive enforcement)
  wallets: Address[]
  providers: string[]
  
  // Perceptual hash (only for non-CSAM, non-youth content)
  perceptualHash?: string
  
  // Ban reason (if banned)
  banReason?: string
  bannedAt?: number
}

export interface ContentCacheConfig {
  /** Maximum cache entries (default: 100000) */
  maxEntries?: number
  /** TTL for clean content in ms (default: 24 hours) */
  cleanTtlMs?: number
  /** Hamming distance threshold for similar image matching (default: 10) */
  similarityThreshold?: number
}

const DEFAULT_CONFIG = {
  maxEntries: 100000,
  cleanTtlMs: 24 * 60 * 60 * 1000,
  similarityThreshold: 10,
}

// In-memory storage (replace with persistent store in production)
const contentByHash = new Map<string, ContentStatus>()
const perceptualHashIndex = new Map<string, Set<string>>() // pHash -> sha256[]

/**
 * Content Status Cache
 *
 * Caches moderation results to avoid redundant processing.
 */
export class ContentCache {
  private config: typeof DEFAULT_CONFIG

  constructor(config: ContentCacheConfig = {}) {
    this.config = {
      maxEntries: config.maxEntries ?? DEFAULT_CONFIG.maxEntries,
      cleanTtlMs: config.cleanTtlMs ?? DEFAULT_CONFIG.cleanTtlMs,
      similarityThreshold: config.similarityThreshold ?? DEFAULT_CONFIG.similarityThreshold,
    }
  }

  async initialize(): Promise<void> {
    logger.info('[ContentCache] Initialized', {
      maxEntries: this.config.maxEntries,
      cleanTtlMs: this.config.cleanTtlMs,
    })
  }

  /**
   * Look up content by exact SHA256 hash
   */
  async lookup(sha256: string): Promise<ContentStatus | null> {
    const normalized = sha256.toLowerCase()
    const status = contentByHash.get(normalized)

    if (!status) return null

    // Update last seen
    status.lastSeen = Date.now()
    status.seenCount++
    contentByHash.set(normalized, status)

    return status
  }

  /**
   * Update or create content status
   */
  async update(status: ContentStatus): Promise<void> {
    const normalized = status.sha256.toLowerCase()
    
    // Check cache size limit
    if (!contentByHash.has(normalized) && contentByHash.size >= this.config.maxEntries) {
      this.evictOldest()
    }

    contentByHash.set(normalized, status)

    // Index perceptual hash if present
    if (status.perceptualHash) {
      const existing = perceptualHashIndex.get(status.perceptualHash)
      if (existing) {
        existing.add(normalized)
      } else {
        perceptualHashIndex.set(status.perceptualHash, new Set([normalized]))
      }
    }
  }

  /**
   * Record a wallet that uploaded this content
   */
  async recordUploader(sha256: string, wallet: Address): Promise<void> {
    const status = await this.lookup(sha256)
    if (!status) return

    if (!status.wallets.includes(wallet)) {
      status.wallets.push(wallet)
      contentByHash.set(sha256.toLowerCase(), status)
    }
  }

  /**
   * Find similar content by perceptual hash
   *
   * IMPORTANT: Only use for non-CSAM, non-youth-ambiguous content!
   */
  async findSimilar(perceptualHash: string, threshold?: number): Promise<ContentStatus[]> {
    const maxDistance = threshold ?? this.config.similarityThreshold
    const results: ContentStatus[] = []

    // Check all indexed perceptual hashes
    for (const [indexedHash, sha256Set] of perceptualHashIndex.entries()) {
      const distance = this.hammingDistance(perceptualHash, indexedHash)
      if (distance <= maxDistance) {
        for (const sha256 of sha256Set) {
          const status = contentByHash.get(sha256)
          if (status) {
            results.push(status)
          }
        }
      }
    }

    return results
  }

  /**
   * Ban content and trigger retroactive enforcement
   *
   * Returns list of wallets that uploaded this content.
   */
  async ban(sha256: string, reason: string): Promise<Address[]> {
    const normalized = sha256.toLowerCase()
    let status = contentByHash.get(normalized)

    if (!status) {
      // Create new entry for banned content
      status = {
        sha256: normalized,
        status: 'banned',
        policyClass: 'csam',
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        seenCount: 1,
        wallets: [],
        providers: [],
        banReason: reason,
        bannedAt: Date.now(),
      }
    } else {
      status.status = 'banned'
      status.banReason = reason
      status.bannedAt = Date.now()
    }

    contentByHash.set(normalized, status)

    logger.info('[ContentCache] Content banned', {
      hash: normalized.slice(0, 16),
      reason,
      affectedWallets: status.wallets.length,
    })

    return status.wallets
  }

  /**
   * Find all content matching a perceptual hash and ban them
   *
   * Used for retroactive enforcement when a similar image is detected as CSAM.
   */
  async banSimilar(perceptualHash: string, reason: string): Promise<{
    contentBanned: number
    walletsAffected: Address[]
  }> {
    const similar = await this.findSimilar(perceptualHash, 5) // Strict threshold
    const walletsAffected = new Set<Address>()
    let contentBanned = 0

    for (const content of similar) {
      if (content.status !== 'banned') {
        const wallets = await this.ban(content.sha256, reason)
        wallets.forEach(w => walletsAffected.add(w))
        contentBanned++
      }
    }

    logger.info('[ContentCache] Similar content banned', {
      pHash: perceptualHash.slice(0, 8),
      contentBanned,
      walletsAffected: walletsAffected.size,
    })

    return {
      contentBanned,
      walletsAffected: Array.from(walletsAffected),
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEntries: number
    byStatus: Record<ContentStatusType, number>
    perceptualHashCount: number
  } {
    const byStatus: Record<ContentStatusType, number> = {
      clean: 0,
      nsfw_adult: 0,
      quarantined: 0,
      banned: 0,
    }

    for (const status of contentByHash.values()) {
      byStatus[status.status]++
    }

    return {
      totalEntries: contentByHash.size,
      byStatus,
      perceptualHashCount: perceptualHashIndex.size,
    }
  }

  /**
   * Compute Hamming distance between two hex strings
   */
  private hammingDistance(hash1: string, hash2: string): number {
    const n1 = BigInt('0x' + hash1)
    const n2 = BigInt('0x' + hash2)
    let xor = n1 ^ n2
    let distance = 0

    while (xor > 0n) {
      if (xor & 1n) distance++
      xor >>= 1n
    }

    return distance
  }

  /**
   * Evict oldest entries when cache is full
   */
  private evictOldest(): void {
    // Find oldest non-banned entry
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, status] of contentByHash.entries()) {
      if (status.status !== 'banned' && status.lastSeen < oldestTime) {
        oldestTime = status.lastSeen
        oldestKey = key
      }
    }

    if (oldestKey) {
      const status = contentByHash.get(oldestKey)
      contentByHash.delete(oldestKey)

      // Clean up perceptual hash index
      if (status?.perceptualHash) {
        const set = perceptualHashIndex.get(status.perceptualHash)
        if (set) {
          set.delete(oldestKey)
          if (set.size === 0) {
            perceptualHashIndex.delete(status.perceptualHash)
          }
        }
      }
    }
  }
}

// Singleton
let instance: ContentCache | null = null

export function getContentCache(config?: ContentCacheConfig): ContentCache {
  if (!instance) {
    instance = new ContentCache(config)
  }
  return instance
}


/**
 * Hash-Based Content Detection Provider
 *
 * Uses cryptographic hashes to detect known bad content.
 * 
 * CAPABILITIES:
 * - SHA256 hash matching against local blocklist
 * - MD5 hash matching (for legacy databases)
 * - Internal hash database management
 *
 * NOT IMPLEMENTED (requires external partnerships):
 * - NCMEC PhotoDNA integration (requires law enforcement partnership)
 * - VirusTotal API (requires paid subscription)
 * - Perceptual hashing (requires image processing library)
 *
 * This is the FASTEST tier - instant matching against known bad hashes.
 */

import type {
  CategoryScore,
  ContentType,
  HashMatch,
  ModerationCategory,
  ModerationProvider,
  ModerationResult,
} from '../types'

// ============ Hash Database Types ============

export interface HashEntry {
  hash: string
  hashType: 'sha256' | 'md5'
  category: ModerationCategory
  source: 'internal' | 'imported'
  addedAt: number
  description?: string
}

export interface HashDatabaseConfig {
  /** Path to local hash list file (newline-separated hashes) */
  csamHashListPath?: string
  /** Path to malware hash list file */
  malwareHashListPath?: string
}

// ============ In-Memory Hash Databases ============

// Using Maps for O(1) lookup
const csamHashes = new Map<string, HashEntry>()
const malwareHashes = new Map<string, HashEntry>()
const internalHashes = new Map<string, HashEntry>()

// ============ Hash Computation ============

async function computeSha256(buffer: Buffer): Promise<string> {
  const uint8Array = new Uint8Array(buffer)
  const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Array)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============ Provider Implementation ============

export interface HashProviderConfig extends HashDatabaseConfig {
  /** Pre-loaded hash entries to add on initialization */
  preloadedHashes?: Array<{
    hash: string
    category: ModerationCategory
    description?: string
  }>
}

export class HashModerationProvider {
  readonly name: ModerationProvider = 'hash'
  readonly supportedTypes: ContentType[] = ['image', 'file', 'video']

  private config: HashProviderConfig
  private initialized = false

  constructor(config: HashProviderConfig = {}) {
    this.config = config
  }

  /**
   * Initialize hash databases
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Load from file paths if provided
    if (this.config.csamHashListPath) {
      await this.loadHashFile(this.config.csamHashListPath, 'csam', csamHashes)
    }

    if (this.config.malwareHashListPath) {
      await this.loadHashFile(this.config.malwareHashListPath, 'malware', malwareHashes)
    }

    // Load preloaded hashes
    if (this.config.preloadedHashes) {
      for (const entry of this.config.preloadedHashes) {
        this.addHash(entry.hash, entry.category, entry.description)
      }
    }

    this.initialized = true
    console.log(
      `[HashProvider] Loaded ${csamHashes.size} CSAM hashes, ${malwareHashes.size} malware hashes, ${internalHashes.size} internal hashes`
    )
  }

  /**
   * Load hashes from a file (newline-separated)
   */
  private async loadHashFile(
    path: string,
    category: ModerationCategory,
    targetMap: Map<string, HashEntry>
  ): Promise<void> {
    try {
      const fs = await import('fs/promises')
      const content = await fs.readFile(path, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim().length > 0)

      for (const line of lines) {
        const hash = line.trim().toLowerCase()
        // Validate hash format (32 chars = MD5, 64 chars = SHA256)
        if (/^[a-f0-9]{32}$/.test(hash) || /^[a-f0-9]{64}$/.test(hash)) {
          targetMap.set(hash, {
            hash,
            hashType: hash.length === 64 ? 'sha256' : 'md5',
            category,
            source: 'imported',
            addedAt: Date.now(),
          })
        }
      }

      console.log(`[HashProvider] Loaded ${lines.length} hashes from ${path}`)
    } catch (err) {
      console.warn(`[HashProvider] Could not load hash file ${path}:`, err)
    }
  }

  /**
   * Add a hash to the internal blocklist
   */
  addHash(
    hash: string,
    category: ModerationCategory,
    description?: string
  ): void {
    const normalizedHash = hash.toLowerCase()
    const entry: HashEntry = {
      hash: normalizedHash,
      hashType: normalizedHash.length === 64 ? 'sha256' : 'md5',
      category,
      source: 'internal',
      addedAt: Date.now(),
      description,
    }

    internalHashes.set(normalizedHash, entry)

    // Also add to category-specific map for faster lookup
    if (category === 'csam') {
      csamHashes.set(normalizedHash, entry)
    } else if (category === 'malware') {
      malwareHashes.set(normalizedHash, entry)
    }
  }

  /**
   * Remove a hash from the blocklist
   */
  removeHash(hash: string): boolean {
    const normalizedHash = hash.toLowerCase()
    const existed = internalHashes.delete(normalizedHash)
    csamHashes.delete(normalizedHash)
    malwareHashes.delete(normalizedHash)
    return existed
  }

  /**
   * Check content against hash databases
   */
  async moderate(fileBuffer: Buffer): Promise<ModerationResult> {
    const startTime = Date.now()
    const hashMatches: HashMatch[] = []
    const categories: CategoryScore[] = []

    // Compute SHA256 hash
    const sha256 = await computeSha256(fileBuffer)

    // Check all databases
    const allMaps = [
      { map: csamHashes, name: 'csam' as const },
      { map: malwareHashes, name: 'malware' as const },
      { map: internalHashes, name: 'internal' as const },
    ]

    for (const { map, name } of allMaps) {
      const match = map.get(sha256)
      if (match) {
        hashMatches.push({
          hashType: 'sha256',
          database: name,
          matchConfidence: 1.0, // Exact hash match
          category: match.category,
        })
        categories.push({
          category: match.category,
          score: 1.0,
          confidence: 1.0,
          provider: 'hash',
          details: `Exact SHA256 match in ${name} database`,
        })
      }
    }

    // Determine action based on matches
    const hasCsam = categories.some((c) => c.category === 'csam')
    const hasMalware = categories.some((c) => c.category === 'malware')

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let reviewRequired = false

    if (hasCsam) {
      action = 'ban'
      severity = 'critical'
      reviewRequired = true
    } else if (hasMalware) {
      action = 'block'
      severity = 'high'
      reviewRequired = false
    } else if (categories.length > 0) {
      action = 'block'
      severity = 'medium'
      reviewRequired = true
    }

    const primaryCategory =
      categories.length > 0
        ? categories.reduce((a, b) => (a.score > b.score ? a : b)).category
        : undefined

    return {
      safe: action === 'allow',
      action,
      severity,
      categories,
      primaryCategory,
      blockedReason:
        action !== 'allow'
          ? `Hash match: ${primaryCategory} (${hashMatches[0]?.database})`
          : undefined,
      reviewRequired,
      processingTimeMs: Date.now() - startTime,
      providers: ['hash'],
      hashMatches,
    }
  }

  /**
   * Alias for moderate() to match pipeline expectations
   */
  async moderateFile(fileBuffer: Buffer): Promise<ModerationResult> {
    return this.moderate(fileBuffer)
  }

  /**
   * Check if a specific hash exists in any database
   */
  hasHash(hash: string): boolean {
    const normalizedHash = hash.toLowerCase()
    return (
      csamHashes.has(normalizedHash) ||
      malwareHashes.has(normalizedHash) ||
      internalHashes.has(normalizedHash)
    )
  }

  /**
   * Get database statistics
   */
  getStats(): {
    csamCount: number
    malwareCount: number
    internalCount: number
    initialized: boolean
  } {
    return {
      csamCount: csamHashes.size,
      malwareCount: malwareHashes.size,
      internalCount: internalHashes.size,
      initialized: this.initialized,
    }
  }

  /**
   * Export all hashes for backup
   */
  exportHashes(): HashEntry[] {
    return [
      ...Array.from(csamHashes.values()),
      ...Array.from(malwareHashes.values()),
      ...Array.from(internalHashes.values()),
    ]
  }

  /**
   * Clear all databases (use with caution)
   */
  clearAll(): void {
    csamHashes.clear()
    malwareHashes.clear()
    internalHashes.clear()
    this.initialized = false
  }
}

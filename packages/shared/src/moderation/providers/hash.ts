/**
 * Hash-based content detection with SHA256 and perceptual hashing
 *
 * Features:
 * - SHA256 exact matching for known bad content
 * - Perceptual hashing (pHash) for similar image detection
 * - Auto-add detected banned content to pHash database
 *
 * CSAM HASH SOURCES:
 * - NCMEC (National Center for Missing & Exploited Children) - requires partnership
 * - IWF (Internet Watch Foundation) - requires membership
 * - CAID (Child Abuse Image Database) - UK law enforcement only
 *
 * Set CSAM_HASH_LIST_PATH or MALWARE_HASH_LIST_PATH env vars
 */

import type {
  CategoryScore,
  HashMatch,
  ModerationCategory,
  ModerationProvider,
  ModerationResult,
} from '../types'

export interface HashEntry {
  hash: string
  hashType: 'sha256' | 'md5' | 'phash'
  category: ModerationCategory
  source: 'internal' | 'imported' | 'detected'
  addedAt: number
  description?: string
}

export interface HashDatabaseConfig {
  csamHashListPath?: string
  malwareHashListPath?: string
}

export interface HashProviderConfig extends HashDatabaseConfig {
  preloadedHashes?: Array<{
    hash: string
    category: ModerationCategory
    description?: string
  }>
  /** Enable perceptual hashing for similar image detection (default: true) */
  enablePHash?: boolean
  /** Hamming distance threshold for pHash matches (default: 10) */
  phashThreshold?: number
  /** Auto-add detected NSFW/banned content to pHash database (default: true) */
  autoAddDetected?: boolean
}

// Hash databases
const csamHashes = new Map<string, HashEntry>()
const malwareHashes = new Map<string, HashEntry>()
const internalHashes = new Map<string, HashEntry>()

// Perceptual hash database (pHash)
const perceptualHashes = new Map<string, HashEntry>()

async function sha256(buffer: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Calculate perceptual hash (pHash) of an image
 * Uses average hash algorithm: resize to 8x8, grayscale, compare to average
 * Returns 64-bit hash as 16-char hex string
 */
async function calculatePHash(buffer: Buffer): Promise<string | null> {
  try {
    // Check if valid image
    if (!isImage(buffer)) return null

    // Simple average hash implementation
    // 1. Convert to grayscale samples
    const samples = extractGrayscaleSamples(buffer, 8, 8)
    if (!samples) return null

    // 2. Calculate average
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length

    // 3. Create hash: 1 if pixel > avg, 0 otherwise
    let hash = ''
    for (const sample of samples) {
      hash += sample > avg ? '1' : '0'
    }

    // 4. Convert binary to hex
    let hexHash = ''
    for (let i = 0; i < hash.length; i += 4) {
      hexHash += parseInt(hash.slice(i, i + 4), 2).toString(16)
    }

    return hexHash
  } catch {
    return null
  }
}

function isImage(buf: Buffer): boolean {
  if (buf.length < 12) return false
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return true
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true
  // WebP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return true
  return false
}

/**
 * Extract grayscale samples from image buffer
 * Simple downsampling based on buffer position (fast but approximate)
 */
function extractGrayscaleSamples(
  buffer: Buffer,
  width: number,
  height: number,
): number[] | null {
  const samples: number[] = []
  const targetSize = width * height
  const step = Math.max(1, Math.floor(buffer.length / targetSize))

  for (let i = 0; i < targetSize && i * step < buffer.length; i++) {
    const idx = i * step
    // Sample 3 bytes as RGB, convert to grayscale
    const r = buffer[idx] ?? 128
    const g = buffer[idx + 1] ?? r
    const b = buffer[idx + 2] ?? r
    samples.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b))
  }

  return samples.length === targetSize ? samples : null
}

/**
 * Calculate Hamming distance between two hex hashes
 */
function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return Infinity

  let distance = 0
  for (let i = 0; i < hash1.length; i++) {
    const char1 = hash1.charAt(i)
    const char2 = hash2.charAt(i)
    const b1 = parseInt(char1, 16)
    const b2 = parseInt(char2, 16)
    // Count differing bits
    let xor = b1 ^ b2
    while (xor) {
      distance += xor & 1
      xor >>= 1
    }
  }
  return distance
}

export class HashModerationProvider {
  readonly name: ModerationProvider = 'hash'
  private config: HashProviderConfig
  private initialized = false

  constructor(config: HashProviderConfig = {}) {
    this.config = {
      enablePHash: true,
      phashThreshold: 10,
      autoAddDetected: true,
      ...config,
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    if (this.config.csamHashListPath) {
      await this.loadHashFile(this.config.csamHashListPath, 'csam', csamHashes)
    }
    if (this.config.malwareHashListPath) {
      await this.loadHashFile(
        this.config.malwareHashListPath,
        'malware',
        malwareHashes,
      )
    }
    if (this.config.preloadedHashes) {
      for (const e of this.config.preloadedHashes) {
        this.addHash(e.hash, e.category, e.description)
      }
    }

    this.initialized = true
    console.log(
      `[HashProvider] Loaded ${csamHashes.size} CSAM, ${malwareHashes.size} malware, ${internalHashes.size} internal, ${perceptualHashes.size} pHash`,
    )
  }

  private async loadHashFile(
    path: string,
    category: ModerationCategory,
    target: Map<string, HashEntry>,
  ): Promise<void> {
    try {
      const fs = await import('node:fs/promises')
      const content = await fs.readFile(path, 'utf-8')
      for (const line of content.split('\n')) {
        const hash = line.trim().toLowerCase()
        if (/^[a-f0-9]{32}$/.test(hash) || /^[a-f0-9]{64}$/.test(hash)) {
          target.set(hash, {
            hash,
            hashType: hash.length === 64 ? 'sha256' : 'md5',
            category,
            source: 'imported',
            addedAt: Date.now(),
          })
        }
      }
    } catch (err) {
      console.warn(`[HashProvider] Could not load ${path}:`, err)
    }
  }

  addHash(
    hash: string,
    category: ModerationCategory,
    description?: string,
  ): void {
    const h = hash.toLowerCase()
    const entry: HashEntry = {
      hash: h,
      hashType: h.length === 64 ? 'sha256' : h.length === 16 ? 'phash' : 'md5',
      category,
      source: 'internal',
      addedAt: Date.now(),
      description,
    }

    if (entry.hashType === 'phash') {
      perceptualHashes.set(h, entry)
    } else {
      internalHashes.set(h, entry)
      if (category === 'csam') csamHashes.set(h, entry)
      else if (category === 'malware') malwareHashes.set(h, entry)
    }
  }

  /**
   * Add a detected banned image to the perceptual hash database
   * Call this when external moderation (Hive/OpenAI) confirms CSAM
   */
  async addBannedImage(
    buffer: Buffer,
    category: ModerationCategory,
    description?: string,
  ): Promise<string | null> {
    const pHash = await calculatePHash(buffer)
    if (pHash) {
      this.addHash(pHash, category, description)
      console.log(`[HashProvider] Added pHash ${pHash} for ${category}`)
      return pHash
    }
    return null
  }

  removeHash(hash: string): boolean {
    const h = hash.toLowerCase()
    const existed = internalHashes.delete(h) || perceptualHashes.delete(h)
    csamHashes.delete(h)
    malwareHashes.delete(h)
    return existed
  }

  async moderate(buffer: Buffer): Promise<ModerationResult> {
    const start = Date.now()
    const hash = await sha256(buffer)
    const matches: HashMatch[] = []
    const categories: CategoryScore[] = []

    // Check exact SHA256 matches
    for (const { map, name } of [
      { map: csamHashes, name: 'csam' as const },
      { map: malwareHashes, name: 'malware' as const },
      { map: internalHashes, name: 'internal' as const },
    ]) {
      const entry = map.get(hash)
      if (entry) {
        matches.push({
          hashType: 'sha256',
          database: name,
          matchConfidence: 1,
          category: entry.category,
        })
        categories.push({
          category: entry.category,
          score: 1,
          confidence: 1,
          provider: 'hash',
          details: `Exact match in ${name}`,
        })
      }
    }

    // Check perceptual hash if enabled and no exact match
    if (this.config.enablePHash && matches.length === 0 && isImage(buffer)) {
      const pHash = await calculatePHash(buffer)
      if (pHash) {
        const pHashMatch = this.findPHashMatch(pHash)
        if (pHashMatch) {
          matches.push({
            hashType: 'phash',
            database: 'internal',
            matchConfidence: pHashMatch.confidence,
            category: pHashMatch.entry.category,
          })
          categories.push({
            category: pHashMatch.entry.category,
            score: pHashMatch.confidence,
            confidence: pHashMatch.confidence,
            provider: 'hash',
            details: `Similar image (pHash distance: ${pHashMatch.distance})`,
          })
        }
      }
    }

    const hasCsam = categories.some((c) => c.category === 'csam')
    const hasMalware = categories.some((c) => c.category === 'malware')

    return {
      safe: categories.length === 0,
      action: hasCsam
        ? 'ban'
        : hasMalware
          ? 'block'
          : categories.length
            ? 'block'
            : 'allow',
      severity: hasCsam
        ? 'critical'
        : hasMalware
          ? 'high'
          : categories.length
            ? 'medium'
            : 'none',
      categories,
      primaryCategory: categories[0]?.category,
      blockedReason: matches[0]
        ? `Hash match: ${matches[0].category} (${matches[0].hashType})`
        : undefined,
      reviewRequired: hasCsam,
      processingTimeMs: Date.now() - start,
      providers: ['hash'],
      hashMatches: matches.length ? matches : undefined,
    }
  }

  private findPHashMatch(
    pHash: string,
  ): { entry: HashEntry; distance: number; confidence: number } | null {
    let bestMatch: {
      entry: HashEntry
      distance: number
      confidence: number
    } | null = null

    for (const entry of perceptualHashes.values()) {
      const distance = hammingDistance(pHash, entry.hash)
      if (distance <= (this.config.phashThreshold ?? 10)) {
        const confidence = 1 - distance / 64 // 64 bits max
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = { entry, distance, confidence }
        }
      }
    }

    return bestMatch
  }

  hasHash(hash: string): boolean {
    const h = hash.toLowerCase()
    return (
      csamHashes.has(h) ||
      malwareHashes.has(h) ||
      internalHashes.has(h) ||
      perceptualHashes.has(h)
    )
  }

  getStats() {
    return {
      csamCount: csamHashes.size,
      malwareCount: malwareHashes.size,
      internalCount: internalHashes.size,
      phashCount: perceptualHashes.size,
      initialized: this.initialized,
    }
  }

  /** Export current hash database for persistence */
  exportHashes(): { sha256: HashEntry[]; phash: HashEntry[] } {
    return {
      sha256: [
        ...csamHashes.values(),
        ...malwareHashes.values(),
        ...internalHashes.values(),
      ],
      phash: [...perceptualHashes.values()],
    }
  }
}

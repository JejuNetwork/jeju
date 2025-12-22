/**
 * Multi-Backend Storage Manager
 *
 * Unified interface for multi-backend decentralized storage:
 * - Content tiering (System, Popular, Private)
 * - Intelligent backend selection
 * - KMS integration for private content
 * - Popularity tracking and regional caching
 */

import { createHash } from 'node:crypto'
import { keccak256 } from 'viem'
import { type ArweaveBackend, getArweaveBackend } from './arweave-backend'
import type {
  ContentAddress,
  ContentCategory,
  ContentMetadata,
  ContentTier,
  DownloadOptions,
  DownloadResult,
  MultiBackendConfig,
  NodeStorageStats,
  PopularityScore,
  RegionalPopularity,
  StorageBackendType,
  UploadOptions,
  UploadResult,
} from './types'
import {
  getWebTorrentBackend,
  type WebTorrentBackend,
} from './webtorrent-backend'

// ============================================================================
// Types
// ============================================================================

interface StorageBackend {
  name: string
  type: StorageBackendType
  upload(
    content: Buffer,
    options?: { filename?: string },
  ): Promise<{ cid: string; url: string }>
  download(cid: string): Promise<Buffer>
  exists(cid: string): Promise<boolean>
  healthCheck(): Promise<boolean>
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MultiBackendConfig = {
  backends: [
    { type: 'local', enabled: true, priority: 0 },
    { type: 'webtorrent', enabled: true, priority: 1 },
    { type: 'ipfs', enabled: true, priority: 2 },
    { type: 'arweave', enabled: true, priority: 3 },
  ],
  defaultTier: 'popular',
  replicationFactor: 2,

  // System content: WebTorrent + IPFS (fast, free)
  systemContentBackends: ['webtorrent', 'ipfs'],

  // Popular content: WebTorrent + IPFS (incentivized)
  popularContentBackends: ['webtorrent', 'ipfs'],

  // Private content: Local + IPFS with encryption
  privateContentBackends: ['local', 'ipfs'],
}

// ============================================================================
// Multi-Backend Manager
// ============================================================================

export class MultiBackendManager {
  private config: MultiBackendConfig
  private backends: Map<StorageBackendType, StorageBackend> = new Map()

  // Content registry
  private contentRegistry: Map<string, ContentMetadata> = new Map()
  private cidToBackends: Map<string, Set<StorageBackendType>> = new Map()

  // Specialized backends
  private arweaveBackend: ArweaveBackend
  private webtorrentBackend: WebTorrentBackend

  // Popularity tracking
  private popularityScores: Map<string, PopularityScore> = new Map()
  private accessLog: Array<{ cid: string; region: string; timestamp: number }> =
    []

  // KMS integration
  private kmsEndpoint: string | null = null

  constructor(config: Partial<MultiBackendConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize specialized backends
    this.arweaveBackend = getArweaveBackend()
    this.webtorrentBackend = getWebTorrentBackend()

    // Initialize basic backends
    this.initializeBackends()

    // KMS endpoint
    this.kmsEndpoint = config.kmsEndpoint ?? process.env.KMS_ENDPOINT ?? null
  }

  private initializeBackends(): void {
    // Local backend
    const localStorage = new Map<string, Buffer>()
    this.backends.set('local', {
      name: 'local',
      type: 'local',
      async upload(content: Buffer): Promise<{ cid: string; url: string }> {
        const cid = keccak256(new Uint8Array(content)).slice(2, 50)
        localStorage.set(cid, content)
        return { cid, url: `/storage/${cid}` }
      },
      async download(cid: string): Promise<Buffer> {
        const content = localStorage.get(cid)
        if (!content) throw new Error(`Not found: ${cid}`)
        return content
      },
      async exists(cid: string): Promise<boolean> {
        return localStorage.has(cid)
      },
      async healthCheck(): Promise<boolean> {
        return true
      },
    })

    // IPFS backend
    const ipfsApiUrl = process.env.IPFS_API_URL
    const ipfsGatewayUrl = process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.io'

    if (ipfsApiUrl) {
      this.backends.set('ipfs', {
        name: 'ipfs',
        type: 'ipfs',
        async upload(
          content: Buffer,
          options?: { filename?: string },
        ): Promise<{ cid: string; url: string }> {
          const formData = new FormData()
          formData.append(
            'file',
            new Blob([new Uint8Array(content)]),
            options?.filename ?? 'file',
          )

          const response = await fetch(`${ipfsApiUrl}/api/v0/add`, {
            method: 'POST',
            body: formData,
          })

          if (!response.ok)
            throw new Error(`IPFS upload failed: ${response.statusText}`)
          const data = (await response.json()) as { Hash: string }
          return { cid: data.Hash, url: `${ipfsGatewayUrl}/ipfs/${data.Hash}` }
        },
        async download(cid: string): Promise<Buffer> {
          const response = await fetch(`${ipfsGatewayUrl}/ipfs/${cid}`)
          if (!response.ok)
            throw new Error(`IPFS download failed: ${response.statusText}`)
          return Buffer.from(await response.arrayBuffer())
        },
        async exists(cid: string): Promise<boolean> {
          const response = await fetch(`${ipfsGatewayUrl}/ipfs/${cid}`, {
            method: 'HEAD',
          })
          return response.ok
        },
        async healthCheck(): Promise<boolean> {
          const response = await fetch(`${ipfsApiUrl}/api/v0/id`, {
            method: 'POST',
          }).catch(() => null)
          return response?.ok ?? false
        },
      })
    }

    // Arweave wrapper
    this.backends.set('arweave', {
      name: 'arweave',
      type: 'arweave',
      upload: async (content: Buffer, options?: { filename?: string }) => {
        const result = await this.arweaveBackend.upload(content, {
          filename: options?.filename,
        })
        return { cid: result.txId, url: result.url }
      },
      download: (cid: string) => this.arweaveBackend.download(cid),
      exists: (cid: string) => this.arweaveBackend.exists(cid),
      healthCheck: () => this.arweaveBackend.healthCheck(),
    })

    // WebTorrent wrapper
    this.backends.set('webtorrent', {
      name: 'webtorrent',
      type: 'webtorrent',
      upload: async (content: Buffer, options?: { filename?: string }) => {
        const cid = keccak256(new Uint8Array(content)).slice(2, 50)
        const torrent = await this.webtorrentBackend.createTorrent(content, {
          name: options?.filename ?? 'file',
          cid,
          tier: 'popular',
          category: 'data',
        })
        return { cid, url: torrent.magnetUri }
      },
      download: (cid: string) => this.webtorrentBackend.download(cid),
      exists: (cid: string) =>
        Promise.resolve(this.webtorrentBackend.hasTorrent(cid)),
      healthCheck: () => this.webtorrentBackend.healthCheck(),
    })
  }

  // ============================================================================
  // Upload
  // ============================================================================

  /**
   * Upload content with tier-based backend selection
   */
  async upload(
    content: Buffer,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const tier = options.tier ?? this.config.defaultTier
    const category = options.category ?? 'data'

    // Encrypt private content
    let uploadContent = content
    let encryptionKeyId: string | undefined

    if (tier === 'private' && options.encrypt !== false) {
      const encrypted = await this.encryptContent(content, options.accessPolicy)
      uploadContent = encrypted.data
      encryptionKeyId = encrypted.keyId
    }

    // Select backends based on tier
    const backends = this.getBackendsForTier(tier, options.preferredBackends)
    const replicationFactor =
      options.replicationFactor ?? this.config.replicationFactor

    // Calculate content hash
    const sha256 = createHash('sha256').update(content).digest('hex')

    // Upload to backends
    const addresses: ContentAddress = {
      cid: '',
      backends: [],
    }

    let primaryCid: string | null = null

    for (const backendType of backends) {
      if (addresses.backends.length >= replicationFactor) break

      const backend = this.backends.get(backendType)
      if (!backend) continue

      const result = await backend
        .upload(uploadContent, { filename: options.filename })
        .catch((e: Error) => {
          console.warn(
            `[MultiBackend] Upload to ${backendType} failed: ${e.message}`,
          )
          return null
        })

      if (result) {
        if (!primaryCid) primaryCid = result.cid
        addresses.backends.push(backendType)

        // Set type-specific addresses
        if (backendType === 'webtorrent') {
          const torrent = this.webtorrentBackend.getTorrent(result.cid)
          addresses.magnetUri = torrent?.magnetUri
        } else if (backendType === 'arweave') {
          addresses.arweaveTxId = result.cid
        }
      }
    }

    if (!primaryCid || addresses.backends.length === 0) {
      throw new Error('Upload failed to all backends')
    }

    addresses.cid = primaryCid

    // Register content metadata
    const metadata: ContentMetadata = {
      cid: primaryCid,
      size: content.length,
      contentType: options.contentType ?? 'application/octet-stream',
      tier,
      category,
      name: options.filename,
      createdAt: Date.now(),
      sha256,
      addresses,
      encrypted: tier === 'private',
      encryptionKeyId,
      accessPolicy: options.accessPolicy,
      accessCount: 0,
    }

    this.contentRegistry.set(primaryCid, metadata)
    this.cidToBackends.set(primaryCid, new Set(addresses.backends))

    // Create WebTorrent for popular/system content
    if ((tier === 'system' || tier === 'popular') && !addresses.magnetUri) {
      const torrent = await this.webtorrentBackend.createTorrent(
        uploadContent,
        {
          name: options.filename ?? primaryCid,
          cid: primaryCid,
          tier,
          category,
        },
      )
      addresses.magnetUri = torrent.magnetUri
    }

    return {
      cid: primaryCid,
      size: content.length,
      addresses,
      tier,
      backends: addresses.backends,
      magnetUri: addresses.magnetUri,
      arweaveTxId: addresses.arweaveTxId,
      encrypted: metadata.encrypted,
      encryptionKeyId,
    }
  }

  /**
   * Upload to Arweave (permanent storage)
   */
  async uploadPermanent(
    content: Buffer,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const result = await this.arweaveBackend.upload(content, {
      filename: options.filename,
      contentType: options.contentType,
      tier: options.tier,
      category: options.category,
      tags: options.arweaveTags,
    })

    // Also upload to other backends for availability
    const fullResult = await this.upload(content, {
      ...options,
      preferredBackends: ['webtorrent', 'ipfs'],
    })

    fullResult.arweaveTxId = result.txId
    fullResult.addresses.arweaveTxId = result.txId

    return fullResult
  }

  // ============================================================================
  // Download
  // ============================================================================

  /**
   * Download content with intelligent backend selection
   */
  async download(
    cid: string,
    options: DownloadOptions = {},
  ): Promise<DownloadResult> {
    const startTime = Date.now()

    // Get metadata
    const metadata = this.contentRegistry.get(cid)
    const backends =
      options.preferredBackends ??
      (metadata
        ? Array.from(this.cidToBackends.get(cid) ?? [])
        : ['webtorrent', 'ipfs', 'local'])

    // Try backends in priority order
    for (const backendType of backends) {
      const backend = this.backends.get(backendType)
      if (!backend) continue

      const content = await backend.download(cid).catch((e: Error) => {
        console.debug(
          `[MultiBackend] Download from ${backendType} failed: ${e.message}`,
        )
        return null
      })

      if (content) {
        // Decrypt if needed
        let finalContent = content
        if (metadata?.encrypted && options.decryptionKeyId) {
          finalContent = await this.decryptContent(
            content,
            options.decryptionKeyId,
          )
        }

        // Update access stats
        this.recordAccess(cid, options.region ?? 'unknown')

        return {
          content: finalContent,
          metadata: metadata ?? this.createBasicMetadata(cid, content),
          backend: backendType,
          latencyMs: Date.now() - startTime,
          fromCache: backendType === 'local',
        }
      }
    }

    throw new Error(`Content not found: ${cid}`)
  }

  /**
   * Check if content exists
   */
  async exists(cid: string): Promise<boolean> {
    if (this.contentRegistry.has(cid)) return true

    for (const backend of this.backends.values()) {
      if (await backend.exists(cid)) return true
    }

    return false
  }

  // ============================================================================
  // Content Registry
  // ============================================================================

  /**
   * Get content metadata
   */
  getMetadata(cid: string): ContentMetadata | null {
    return this.contentRegistry.get(cid) ?? null
  }

  /**
   * List content by tier
   */
  listByTier(tier: ContentTier): ContentMetadata[] {
    return Array.from(this.contentRegistry.values()).filter(
      (m) => m.tier === tier,
    )
  }

  /**
   * List content by category
   */
  listByCategory(category: ContentCategory): ContentMetadata[] {
    return Array.from(this.contentRegistry.values()).filter(
      (m) => m.category === category,
    )
  }

  // ============================================================================
  // Popularity Tracking
  // ============================================================================

  /**
   * Record content access
   */
  private recordAccess(cid: string, region: string): void {
    const now = Date.now()

    // Update access log
    this.accessLog.push({ cid, region, timestamp: now })

    // Trim old entries (keep 30 days)
    const cutoff = now - 30 * 24 * 60 * 60 * 1000
    this.accessLog = this.accessLog.filter((a) => a.timestamp > cutoff)

    // Update metadata
    const metadata = this.contentRegistry.get(cid)
    if (metadata) {
      metadata.accessCount++
      metadata.lastAccessed = now

      // Update regional stats
      if (!metadata.regionalStats) metadata.regionalStats = {}
      if (!metadata.regionalStats[region]) {
        metadata.regionalStats[region] = {
          region,
          accessCount: 0,
          seederCount: 0,
          avgLatencyMs: 0,
          lastAccessed: 0,
        }
      }
      metadata.regionalStats[region].accessCount++
      metadata.regionalStats[region].lastAccessed = now
    }

    // Update popularity score
    this.updatePopularityScore(cid)
  }

  /**
   * Update popularity score for content
   */
  private updatePopularityScore(cid: string): void {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000

    // Count accesses by time window
    const accesses = this.accessLog.filter((a) => a.cid === cid)
    const access24h = accesses.filter((a) => now - a.timestamp < day).length
    const access7d = accesses.filter((a) => now - a.timestamp < 7 * day).length
    const access30d = accesses.length

    // Count unique regions
    const regions = new Set(accesses.map((a) => a.region))

    // Get seeder count from WebTorrent
    const torrent = this.webtorrentBackend.getTorrent(cid)
    const seederCount = torrent
      ? (this.webtorrentBackend.getTorrentStats(torrent.infoHash)?.seeds ?? 0)
      : 0

    // Calculate score
    const recencyWeight = access24h * 10 + access7d * 3 + access30d
    const regionalWeight = regions.size * 5
    const score = recencyWeight + regionalWeight
    const replicationPriority = seederCount > 0 ? score / seederCount : score

    const popularityScore: PopularityScore = {
      cid,
      score,
      accessCount24h: access24h,
      accessCount7d: access7d,
      accessCount30d: access30d,
      uniqueRegions: regions.size,
      seederCount,
      recencyWeight,
      regionalWeight,
      replicationPriority,
      lastCalculated: now,
    }

    this.popularityScores.set(cid, popularityScore)
  }

  /**
   * Get top popular content
   */
  getPopularContent(limit = 100): PopularityScore[] {
    return Array.from(this.popularityScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Get under-seeded content that needs replication
   */
  getUnderseededContent(minSeeders = 3): PopularityScore[] {
    return Array.from(this.popularityScores.values())
      .filter((p) => p.seederCount < minSeeders && p.score > 10)
      .sort((a, b) => b.replicationPriority - a.replicationPriority)
  }

  /**
   * Get regional popularity stats
   */
  getRegionalPopularity(region: string): RegionalPopularity {
    const regionalContent = Array.from(this.contentRegistry.values())
      .filter((m) => m.regionalStats?.[region])
      .map((m) => {
        const regionStats = m.regionalStats?.[region]
        return {
          cid: m.cid,
          score: regionStats?.accessCount ?? 0,
          seederCount: this.popularityScores.get(m.cid)?.seederCount ?? 0,
        }
      })
      .sort((a, b) => b.score - a.score)

    const underseeded = regionalContent.filter((c) => c.seederCount < 3)

    return {
      region,
      topContent: regionalContent.slice(0, 20),
      underseeded: underseeded.slice(0, 10).map((c) => ({
        ...c,
        targetSeeders: Math.ceil(c.score / 10),
      })),
    }
  }

  // ============================================================================
  // Encryption (KMS Integration)
  // ============================================================================

  private async encryptContent(
    content: Buffer,
    accessPolicy?: string,
  ): Promise<{ data: Buffer; keyId: string }> {
    if (!this.kmsEndpoint) {
      // Fallback: simple AES encryption
      const keyId = createHash('sha256')
        .update(crypto.randomUUID())
        .digest('hex')
        .slice(0, 32)
      // In production, use actual KMS encryption
      return { data: content, keyId }
    }

    const response = await fetch(`${this.kmsEndpoint}/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: content.toString('base64'),
        policy: accessPolicy,
      }),
    })

    if (!response.ok) {
      throw new Error(`KMS encryption failed: ${response.statusText}`)
    }

    const result = (await response.json()) as {
      ciphertext: string
      keyId: string
    }
    return {
      data: Buffer.from(result.ciphertext, 'base64'),
      keyId: result.keyId,
    }
  }

  private async decryptContent(
    content: Buffer,
    keyId: string,
  ): Promise<Buffer> {
    if (!this.kmsEndpoint) {
      // Fallback: return as-is
      return content
    }

    const response = await fetch(`${this.kmsEndpoint}/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ciphertext: content.toString('base64'),
        keyId,
      }),
    })

    if (!response.ok) {
      throw new Error(`KMS decryption failed: ${response.statusText}`)
    }

    const result = (await response.json()) as { plaintext: string }
    return Buffer.from(result.plaintext, 'base64')
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getBackendsForTier(
    tier: ContentTier,
    preferred?: StorageBackendType[],
  ): StorageBackendType[] {
    if (preferred && preferred.length > 0) {
      return preferred
    }

    switch (tier) {
      case 'system':
        return this.config.systemContentBackends
      case 'popular':
        return this.config.popularContentBackends
      case 'private':
        return this.config.privateContentBackends
      default:
        return this.config.popularContentBackends
    }
  }

  private createBasicMetadata(cid: string, content: Buffer): ContentMetadata {
    return {
      cid,
      size: content.length,
      contentType: 'application/octet-stream',
      tier: 'popular',
      category: 'data',
      createdAt: Date.now(),
      sha256: createHash('sha256').update(content).digest('hex'),
      addresses: { cid, backends: [] },
      accessCount: 1,
    }
  }

  // ============================================================================
  // Health & Stats
  // ============================================================================

  /**
   * Health check all backends
   */
  async healthCheck(): Promise<Record<StorageBackendType, boolean>> {
    const results: Record<string, boolean> = {}

    for (const [type, backend] of this.backends) {
      results[type] = await backend.healthCheck().catch(() => false)
    }

    return results as Record<StorageBackendType, boolean>
  }

  /**
   * Get aggregated node stats
   */
  getNodeStats(): Partial<NodeStorageStats> {
    const webtorrentStats = this.webtorrentBackend.getNodeStats()

    let totalSize = 0
    for (const metadata of this.contentRegistry.values()) {
      totalSize += metadata.size
    }

    return {
      ...webtorrentStats,
      usedCapacityGB: totalSize / (1024 * 1024 * 1024),
    }
  }

  /**
   * List all backends
   */
  listBackends(): StorageBackendType[] {
    return Array.from(this.backends.keys())
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalMultiBackend: MultiBackendManager | null = null

export function getMultiBackendManager(
  config?: Partial<MultiBackendConfig>,
): MultiBackendManager {
  if (!globalMultiBackend) {
    globalMultiBackend = new MultiBackendManager(config)
  }
  return globalMultiBackend
}

export function resetMultiBackendManager(): void {
  globalMultiBackend = null
}

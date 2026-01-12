/**
 * Multi-Backend Storage Manager
 *
 * Unified interface for multi-backend decentralized storage:
 * - Content tiering (System, Popular, Private)
 * - Intelligent backend selection
 * - KMS integration for private content
 * - Popularity tracking and regional caching
 */

import {
  getCurrentNetwork,
  getIpfsApiUrl,
  getIpfsGatewayUrl,
} from '@jejunetwork/config'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import { expectValid } from '@jejunetwork/types'
import { keccak256 } from 'viem'
import {
  IpfsAddResponseSchema,
  KmsDecryptResponseSchema,
  KmsEncryptResponseSchema,
} from '../types'
import { type ArweaveBackend, getArweaveBackend } from './arweave-backend'
import { type FilecoinBackend, getFilecoinBackend } from './filecoin-backend'
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
import type { WebTorrentBackend } from './webtorrent-backend'

// Types

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

// Network-aware configuration
// Localnet prioritizes speed (local + IPFS without pinning)
// Production prioritizes durability (IPFS + Filecoin with replication)
function getDefaultConfig(): MultiBackendConfig {
  const network = getCurrentNetwork()
  const isLocalnet = network === 'localnet'

  return {
    backends: [
      { type: 'local', enabled: true, priority: 0 },
      { type: 'webtorrent', enabled: true, priority: 1 },
      { type: 'ipfs', enabled: true, priority: 2 },
      { type: 'filecoin', enabled: !isLocalnet, priority: 3 }, // Skip Filecoin in localnet
      { type: 'arweave', enabled: !isLocalnet, priority: 4 }, // Skip Arweave in localnet
    ],
    defaultTier: 'popular',
    // Localnet: single replica for speed; Production: 2 replicas for durability
    replicationFactor: isLocalnet ? 1 : 2,

    // Localnet: IPFS only (fast, with pin=false applied separately)
    // Production: IPFS + Filecoin for permanent storage
    systemContentBackends: isLocalnet ? ['ipfs'] : ['ipfs', 'filecoin'],
    popularContentBackends: isLocalnet ? ['ipfs'] : ['ipfs', 'filecoin'],
    privateContentBackends: ['ipfs'],
  }
}

const DEFAULT_CONFIG: MultiBackendConfig = getDefaultConfig()

// Multi-Backend Manager

export class MultiBackendManager {
  private config: MultiBackendConfig
  private backends: Map<StorageBackendType, StorageBackend> = new Map()

  // Content registry
  private contentRegistry: Map<string, ContentMetadata> = new Map()
  private cidToBackends: Map<string, Set<StorageBackendType>> = new Map()

  // Specialized backends
  private arweaveBackend: ArweaveBackend
  private filecoinBackend: FilecoinBackend
  private webtorrentBackend: WebTorrentBackend | null = null

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
    this.filecoinBackend = getFilecoinBackend()
    // WebTorrent is lazy-loaded to avoid native module issues

    // Initialize basic backends
    this.initializeBackends()

    // KMS endpoint
    this.kmsEndpoint = config.kmsEndpoint ?? process.env.KMS_ENDPOINT ?? null
  }

  /**
   * Get WebTorrent backend (lazy loaded)
   */
  private async getWebTorrent(): Promise<WebTorrentBackend | null> {
    if (!this.webtorrentBackend) {
      try {
        const { getWebTorrentBackend } = await import('./webtorrent-backend')
        this.webtorrentBackend = getWebTorrentBackend()
      } catch (e) {
        // WebTorrent native modules not available (e.g., in test environment)
        console.warn(
          '[MultiBackend] WebTorrent not available:',
          e instanceof Error ? e.message : String(e),
        )
        return null
      }
    }
    return this.webtorrentBackend
  }

  private initializeBackends(): void {
    // Local backend
    // Local storage uses content hashes - primarily for caching and fallback reads
    // IMPORTANT: Local backend should NOT be used for uploads in production
    // as it returns non-IPFS CIDs that won't work with decentralized routing
    const localStorage = new Map<string, Buffer>()
    this.backends.set('local', {
      name: 'local',
      type: 'local',
      async upload(content: Buffer): Promise<{ cid: string; url: string }> {
        // Generate a local content hash for caching purposes
        // This is NOT an IPFS CID and should only be used as last resort
        const contentHash = keccak256(new Uint8Array(content)).slice(2, 50)
        localStorage.set(contentHash, content)
        console.warn(
          `[LocalBackend] Stored content locally with hash ${contentHash} - this is NOT an IPFS CID`,
        )
        return { cid: contentHash, url: `/storage/${contentHash}` }
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
    const network = getCurrentNetwork()
    const ipfsApiUrl =
      (typeof process !== 'undefined' ? process.env.IPFS_API_URL : undefined) ??
      getIpfsApiUrl(network)
    const ipfsGatewayUrl =
      (typeof process !== 'undefined'
        ? process.env.IPFS_GATEWAY_URL
        : undefined) ?? getIpfsGatewayUrl(network)

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
          const data = expectValid(
            IpfsAddResponseSchema,
            await response.json(),
            'IPFS add response',
          )
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
          })
          return response.ok
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

    // Filecoin wrapper
    this.backends.set('filecoin', {
      name: 'filecoin',
      type: 'filecoin',
      upload: async (content: Buffer, options?: { filename?: string }) => {
        const result = await this.filecoinBackend.upload(content, {
          filename: options?.filename,
        })
        return { cid: result.cid, url: `https://w3s.link/ipfs/${result.cid}` }
      },
      download: (cid: string) => this.filecoinBackend.download(cid),
      exists: (cid: string) => this.filecoinBackend.exists(cid),
      healthCheck: () => this.filecoinBackend.healthCheck(),
    })

    // WebTorrent wrapper (lazy loaded)
    this.backends.set('webtorrent', {
      name: 'webtorrent',
      type: 'webtorrent',
      upload: async (content: Buffer, options?: { filename?: string }) => {
        const wt = await this.getWebTorrent()
        if (!wt) throw new Error('WebTorrent not available')
        const cid = keccak256(new Uint8Array(content)).slice(2, 50)
        const torrent = await wt.createTorrent(content, {
          name: options?.filename ?? 'file',
          cid,
          tier: 'popular',
          category: 'data',
        })
        return { cid, url: torrent.magnetUri }
      },
      download: async (cid: string) => {
        const wt = await this.getWebTorrent()
        if (!wt) throw new Error('WebTorrent not available')
        return wt.download(cid)
      },
      exists: async (cid: string) => {
        const wt = await this.getWebTorrent()
        if (!wt) return false
        return wt.hasTorrent(cid)
      },
      healthCheck: async () => {
        const wt = await this.getWebTorrent()
        if (!wt) return false
        return wt.healthCheck()
      },
    })
  }

  // Upload

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
    const sha256 = bytesToHex(hash256(new Uint8Array(content))).slice(2)

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
          const wt = await this.getWebTorrent()
          const torrent = wt ? await wt.getTorrent(result.cid) : null
          addresses.magnetUri = torrent?.magnetUri
        } else if (backendType === 'arweave') {
          addresses.arweaveTxId = result.cid
        } else if (backendType === 'filecoin') {
          // Filecoin CID is the IPFS CID used for the deal
          addresses.filecoinDealId = result.cid
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

    // Create WebTorrent for popular/system content (optional - don't fail if unavailable)
    if ((tier === 'system' || tier === 'popular') && !addresses.magnetUri) {
      try {
        const wt = await this.getWebTorrent()
        if (wt) {
          const torrent = await wt.createTorrent(uploadContent, {
            name: options.filename ?? primaryCid,
            cid: primaryCid,
            tier,
            category,
          })
          addresses.magnetUri = torrent.magnetUri
        }
      } catch (e) {
        console.warn(
          '[MultiBackend] WebTorrent creation failed:',
          e instanceof Error ? e.message : String(e),
        )
      }
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

  // Download

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
   * Check if content exists (with timeout to prevent blocking)
   */
  async exists(cid: string): Promise<boolean> {
    if (this.contentRegistry.has(cid)) return true

    // Check backends in parallel with individual timeouts
    const checkPromises = Array.from(this.backends.entries()).map(
      async ([name, backend]) => {
        try {
          const timeoutMs = 5000 // 5 second timeout per backend
          const result = await Promise.race([
            backend.exists(cid),
            new Promise<boolean>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Timeout checking ${name}`)),
                timeoutMs,
              ),
            ),
          ])
          return result
        } catch (error) {
          console.warn(
            `[MultiBackend] exists check failed for ${name}: ${error instanceof Error ? error.message : String(error)}`,
          )
          return false
        }
      },
    )

    const results = await Promise.all(checkPromises)
    return results.some((r) => r === true)
  }

  // Content Registry

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

  // Popularity Tracking

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

    // Update popularity score (fire-and-forget)
    this.updatePopularityScore(cid).catch((err: Error) => {
      console.warn(
        `[MultiBackend] Failed to update popularity score for ${cid}:`,
        err.message,
      )
    })
  }

  /**
   * Update popularity score for content
   */
  private async updatePopularityScore(cid: string): Promise<void> {
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
    let seederCount = 0
    const wt = this.webtorrentBackend
    if (wt) {
      const torrent = await wt.getTorrent(cid)
      seederCount = torrent
        ? (wt.getTorrentStats(torrent.infoHash)?.seeds ?? 0)
        : 0
    }

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

  // Encryption (KMS Integration)

  private async encryptContent(
    content: Buffer,
    accessPolicy?: string,
  ): Promise<{ data: Buffer; keyId: string }> {
    if (!this.kmsEndpoint) {
      // Fallback: simple AES encryption
      const keyId = bytesToHex(hash256(crypto.randomUUID())).slice(2, 34)
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

    const result = expectValid(
      KmsEncryptResponseSchema,
      await response.json(),
      'KMS encrypt response',
    )
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
      throw new Error('KMS endpoint required for decryption')
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

    const result = expectValid(
      KmsDecryptResponseSchema,
      await response.json(),
      'KMS decrypt response',
    )
    return Buffer.from(result.plaintext, 'base64')
  }

  // Helpers

  private getBackendsForTier(
    tier: ContentTier,
    preferred?: StorageBackendType[],
  ): StorageBackendType[] {
    if (preferred && preferred.length > 0) {
      return preferred
    }

    let backends: StorageBackendType[]
    switch (tier) {
      case 'system':
        backends = [...this.config.systemContentBackends]
        break
      case 'popular':
        backends = [...this.config.popularContentBackends]
        break
      case 'private':
        backends = [...this.config.privateContentBackends]
        break
      default:
        backends = [...this.config.popularContentBackends]
    }

    // On localnet, add 'local' as fallback if not already included
    // This allows deployment without running IPFS locally
    const network = getCurrentNetwork()
    if (network === 'localnet' && !backends.includes('local')) {
      backends.push('local')
    }

    return backends
  }

  private createBasicMetadata(cid: string, content: Buffer): ContentMetadata {
    return {
      cid,
      size: content.length,
      contentType: 'application/octet-stream',
      tier: 'popular',
      category: 'data',
      createdAt: Date.now(),
      sha256: bytesToHex(hash256(new Uint8Array(content))).slice(2),
      addresses: { cid, backends: [] },
      accessCount: 1,
    }
  }

  // Health & Stats

  /**
   * Health check all backends
   */
  async healthCheck(): Promise<Record<StorageBackendType, boolean>> {
    const results: Record<string, boolean> = {}

    for (const [type, backend] of this.backends) {
      try {
        results[type] = await backend.healthCheck()
      } catch {
        results[type] = false
      }
    }

    return results as Record<StorageBackendType, boolean>
  }

  /**
   * Get aggregated node stats
   */
  getNodeStats(): Partial<NodeStorageStats> {
    const webtorrentStats = this.webtorrentBackend?.getNodeStats() ?? {}

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

// Factory

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

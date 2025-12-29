import { createHash } from 'node:crypto'
import { keccak256, stringToBytes } from 'viem'
import type { BackendManager } from '../storage/backends'

export type CacheScope = 'project' | 'organization' | 'global'

export interface CacheEntry {
  key: string
  hash: string
  scope: CacheScope
  projectId?: string
  orgId?: string

  // Storage
  cid: string
  sizeBytes: number
  compressedSize: number

  // Metadata
  createdAt: number
  lastAccessedAt: number
  accessCount: number
  expiresAt: number

  // Source
  platform: string // node, rust, docker, etc.
  version?: string
  paths: string[]
}

export interface CacheStats {
  totalEntries: number
  totalSizeBytes: number
  hitCount: number
  missCount: number
  hitRate: number
  oldestEntry: number
  newestEntry: number
}

export interface CacheKeyInput {
  platform: string
  files: Array<{ path: string; content: string }>
  env?: Record<string, string>
  version?: string
}

export interface RestoreResult {
  hit: boolean
  entry?: CacheEntry
  data?: Buffer
}

export interface SaveResult {
  entry: CacheEntry
  reused: boolean
}

// ============================================================================
// Cache Key Generator
// ============================================================================

export function generateCacheKey(input: CacheKeyInput): string {
  const hash = createHash('sha256')

  // Add platform and version
  hash.update(`platform:${input.platform}\n`)
  if (input.version) {
    hash.update(`version:${input.version}\n`)
  }

  // Add file contents (sorted for determinism)
  const sortedFiles = [...input.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  )
  for (const file of sortedFiles) {
    hash.update(
      `file:${file.path}:${createHash('sha256').update(file.content).digest('hex')}\n`,
    )
  }

  // Add environment variables (sorted)
  if (input.env) {
    const sortedEnv = Object.entries(input.env).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    for (const [key, value] of sortedEnv) {
      hash.update(`env:${key}:${value}\n`)
    }
  }

  return hash.digest('hex')
}

/**
 * Generate cache key for common dependency managers
 */
export function generateDependencyCacheKey(
  platform: 'node' | 'rust' | 'python' | 'go',
  lockfileContent: string,
  nodeVersion?: string,
): string {
  const hash = createHash('sha256')

  hash.update(`platform:${platform}\n`)
  if (nodeVersion) {
    hash.update(`runtime:${nodeVersion}\n`)
  }
  hash.update(
    `lockfile:${createHash('sha256').update(lockfileContent).digest('hex')}\n`,
  )

  return hash.digest('hex')
}

/**
 * Generate cache key for Docker layers
 */
export function generateDockerLayerCacheKey(
  dockerfile: string,
  context: Array<{ path: string; hash: string }>,
  platform?: string,
): string {
  const hash = createHash('sha256')

  hash.update(
    `dockerfile:${createHash('sha256').update(dockerfile).digest('hex')}\n`,
  )

  if (platform) {
    hash.update(`platform:${platform}\n`)
  }

  // Add context files (sorted)
  const sorted = [...context].sort((a, b) => a.path.localeCompare(b.path))
  for (const file of sorted) {
    hash.update(`context:${file.path}:${file.hash}\n`)
  }

  return hash.digest('hex')
}

// ============================================================================
// Build Cache Manager
// ============================================================================

export class BuildCacheManager {
  private entries = new Map<string, CacheEntry>()
  private entriesByProject = new Map<string, Set<string>>() // projectId -> keys
  private entriesByOrg = new Map<string, Set<string>>() // orgId -> keys

  private backend: BackendManager
  private maxSizeBytes: number
  private currentSizeBytes = 0

  // Stats
  private hitCount = 0
  private missCount = 0

  constructor(backend: BackendManager, config: { maxSizeBytes?: number } = {}) {
    this.backend = backend
    this.maxSizeBytes = config.maxSizeBytes ?? 10 * 1024 * 1024 * 1024 // 10GB default
  }

  // =========================================================================
  // Cache Operations
  // =========================================================================

  async restore(
    key: string,
    scope: CacheScope = 'project',
    projectId?: string,
    orgId?: string,
  ): Promise<RestoreResult> {
    const entry = this.findEntry(key, scope, projectId, orgId)

    if (!entry) {
      this.missCount++
      return { hit: false }
    }

    // Check expiration
    if (entry.expiresAt < Date.now()) {
      this.deleteEntry(key)
      this.missCount++
      return { hit: false }
    }

    // Download from storage
    try {
      const result = await this.backend.download(entry.cid)

      // Update access stats
      entry.lastAccessedAt = Date.now()
      entry.accessCount++

      this.hitCount++

      console.log(
        `[BuildCache] Hit: ${key.slice(0, 12)} (${formatBytes(entry.sizeBytes)})`,
      )

      return {
        hit: true,
        entry,
        data: result.content,
      }
    } catch (error) {
      console.error(`[BuildCache] Failed to download ${key}:`, error)
      this.missCount++
      return { hit: false }
    }
  }

  async save(
    key: string,
    data: Buffer,
    options: {
      scope?: CacheScope
      projectId?: string
      orgId?: string
      platform: string
      version?: string
      paths: string[]
      ttlDays?: number
    },
  ): Promise<SaveResult> {
    const scope = options.scope ?? 'project'

    // Check if entry already exists with same content
    const existing = this.findEntry(
      key,
      scope,
      options.projectId,
      options.orgId,
    )
    if (existing) {
      existing.lastAccessedAt = Date.now()
      existing.accessCount++
      return { entry: existing, reused: true }
    }

    // Ensure space for new entry
    await this.ensureSpace(data.length)

    // Compress data
    const compressed = await this.compress(data)

    // Upload to storage
    const uploadResult = await this.backend.upload(compressed, {
      filename: `cache/${key}`,
    })

    const ttlDays = options.ttlDays ?? 7
    const entry: CacheEntry = {
      key,
      hash: keccak256(stringToBytes(key)).slice(0, 18),
      scope,
      projectId: options.projectId,
      orgId: options.orgId,
      cid: uploadResult.cid,
      sizeBytes: data.length,
      compressedSize: compressed.length,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
      expiresAt: Date.now() + ttlDays * 24 * 60 * 60 * 1000,
      platform: options.platform,
      version: options.version,
      paths: options.paths,
    }

    this.entries.set(key, entry)
    this.currentSizeBytes += entry.sizeBytes

    // Track by project/org
    if (options.projectId) {
      const projectEntries =
        this.entriesByProject.get(options.projectId) ?? new Set()
      projectEntries.add(key)
      this.entriesByProject.set(options.projectId, projectEntries)
    }

    if (options.orgId) {
      const orgEntries = this.entriesByOrg.get(options.orgId) ?? new Set()
      orgEntries.add(key)
      this.entriesByOrg.set(options.orgId, orgEntries)
    }

    console.log(
      `[BuildCache] Saved: ${key.slice(0, 12)} (${formatBytes(entry.sizeBytes)} -> ${formatBytes(compressed.length)})`,
    )

    return { entry, reused: false }
  }

  async delete(key: string): Promise<boolean> {
    return this.deleteEntry(key)
  }

  // =========================================================================
  // Lookup
  // =========================================================================

  private findEntry(
    key: string,
    scope: CacheScope,
    projectId?: string,
    orgId?: string,
  ): CacheEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    // Check scope
    if (scope === 'project' && entry.projectId !== projectId) {
      return undefined
    }
    if (scope === 'organization' && entry.orgId !== orgId) {
      return undefined
    }

    return entry
  }

  private deleteEntry(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false

    this.entries.delete(key)
    this.currentSizeBytes -= entry.sizeBytes

    // Remove from tracking maps
    if (entry.projectId) {
      this.entriesByProject.get(entry.projectId)?.delete(key)
    }
    if (entry.orgId) {
      this.entriesByOrg.get(entry.orgId)?.delete(key)
    }

    return true
  }

  // =========================================================================
  // LRU Eviction
  // =========================================================================

  private async ensureSpace(neededBytes: number): Promise<void> {
    if (this.currentSizeBytes + neededBytes <= this.maxSizeBytes) {
      return
    }

    // Sort entries by last access time (LRU)
    const sorted = Array.from(this.entries.values()).sort(
      (a, b) => a.lastAccessedAt - b.lastAccessedAt,
    )

    let freedBytes = 0
    const targetFreeBytes = neededBytes + this.maxSizeBytes * 0.1 // Free extra 10%

    for (const entry of sorted) {
      if (freedBytes >= targetFreeBytes) break

      this.deleteEntry(entry.key)
      freedBytes += entry.sizeBytes

      console.log(
        `[BuildCache] Evicted: ${entry.key.slice(0, 12)} (${formatBytes(entry.sizeBytes)})`,
      )
    }
  }

  // =========================================================================
  // Compression
  // =========================================================================

  private async compress(data: Buffer): Promise<Buffer> {
    // Use Bun's native gzip compression
    const compressed = Bun.gzipSync(new Uint8Array(data))
    return Buffer.from(compressed)
  }

  // =========================================================================
  // Stats
  // =========================================================================

  getStats(): CacheStats {
    const entries = Array.from(this.entries.values())

    return {
      totalEntries: entries.length,
      totalSizeBytes: this.currentSizeBytes,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate:
        this.hitCount + this.missCount > 0
          ? this.hitCount / (this.hitCount + this.missCount)
          : 0,
      oldestEntry:
        entries.length > 0 ? Math.min(...entries.map((e) => e.createdAt)) : 0,
      newestEntry:
        entries.length > 0 ? Math.max(...entries.map((e) => e.createdAt)) : 0,
    }
  }

  getProjectStats(projectId: string): CacheStats {
    const keys = this.entriesByProject.get(projectId)
    if (!keys || keys.size === 0) {
      return {
        totalEntries: 0,
        totalSizeBytes: 0,
        hitCount: 0,
        missCount: 0,
        hitRate: 0,
        oldestEntry: 0,
        newestEntry: 0,
      }
    }

    const entries = Array.from(keys)
      .map((k) => this.entries.get(k))
      .filter((e): e is CacheEntry => e !== undefined)

    return {
      totalEntries: entries.length,
      totalSizeBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
      hitCount: 0, // Would need per-project tracking
      missCount: 0,
      hitRate: 0,
      oldestEntry:
        entries.length > 0 ? Math.min(...entries.map((e) => e.createdAt)) : 0,
      newestEntry:
        entries.length > 0 ? Math.max(...entries.map((e) => e.createdAt)) : 0,
    }
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  async cleanupExpired(): Promise<number> {
    const now = Date.now()
    let deletedCount = 0

    for (const entry of this.entries.values()) {
      if (entry.expiresAt < now) {
        this.deleteEntry(entry.key)
        deletedCount++
      }
    }

    if (deletedCount > 0) {
      console.log(`[BuildCache] Cleaned up ${deletedCount} expired entries`)
    }

    return deletedCount
  }

  async cleanupProject(projectId: string): Promise<number> {
    const keys = this.entriesByProject.get(projectId)
    if (!keys) return 0

    let deletedCount = 0
    for (const key of keys) {
      this.deleteEntry(key)
      deletedCount++
    }

    this.entriesByProject.delete(projectId)

    return deletedCount
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
}

// ============================================================================
// Specialized Caches
// ============================================================================

/**
 * Node.js dependency cache
 */
export async function restoreNodeModules(
  cache: BuildCacheManager,
  lockfileContent: string,
  nodeVersion: string,
  projectId: string,
): Promise<RestoreResult> {
  const key = generateDependencyCacheKey('node', lockfileContent, nodeVersion)
  return cache.restore(key, 'project', projectId)
}

export async function saveNodeModules(
  cache: BuildCacheManager,
  lockfileContent: string,
  nodeVersion: string,
  data: Buffer,
  projectId: string,
): Promise<SaveResult> {
  const key = generateDependencyCacheKey('node', lockfileContent, nodeVersion)
  return cache.save(key, data, {
    scope: 'project',
    projectId,
    platform: 'node',
    version: nodeVersion,
    paths: ['node_modules'],
    ttlDays: 7,
  })
}

/**
 * Rust/Cargo cache
 */
export async function restoreCargoCache(
  cache: BuildCacheManager,
  lockfileContent: string,
  projectId: string,
): Promise<RestoreResult> {
  const key = generateDependencyCacheKey('rust', lockfileContent)
  return cache.restore(key, 'project', projectId)
}

export async function saveCargoCache(
  cache: BuildCacheManager,
  lockfileContent: string,
  data: Buffer,
  projectId: string,
): Promise<SaveResult> {
  const key = generateDependencyCacheKey('rust', lockfileContent)
  return cache.save(key, data, {
    scope: 'project',
    projectId,
    platform: 'rust',
    paths: ['target', '.cargo/registry', '.cargo/git'],
    ttlDays: 14,
  })
}

// ============================================================================
// Factory
// ============================================================================

let buildCacheManager: BuildCacheManager | null = null

export function getBuildCacheManager(
  backend: BackendManager,
): BuildCacheManager {
  if (!buildCacheManager) {
    const maxSizeGb = parseInt(process.env.BUILD_CACHE_MAX_SIZE_GB ?? '10', 10)
    buildCacheManager = new BuildCacheManager(backend, {
      maxSizeBytes: maxSizeGb * 1024 * 1024 * 1024,
    })
  }
  return buildCacheManager
}

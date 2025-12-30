/**
 * Package Upstream Proxy (JejuPkg)
 * Caches and proxies packages from npmjs.org (for upstream compatibility)
 * Uses SQLit for persistent package and tarball records
 */

import {
  getSQLitMinerUrl,
  getSQLitUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { getSQLit, resetSQLit } from '@jejunetwork/db'
import { z } from 'zod'
import type { BackendManager } from '../storage/backends'
import type {
  CacheConfig,
  CacheEntry,
  PackageRecord,
  PkgPackageMetadata,
  PkgVersionMetadata,
  TarballRecord,
  UpstreamRegistryConfig,
  UpstreamSyncResult,
} from './types'

const SQLIT_DATABASE_ID = process.env.SQLIT_DATABASE_ID ?? 'dws'

// SQLit Client singleton
let sqlitClient: ReturnType<typeof getSQLit> | null = null

async function getSQLitClient() {
  if (!sqlitClient) {
    resetSQLit()
    const blockProducerEndpoint = getSQLitUrl()
    const minerEndpoint = getSQLitMinerUrl()

    sqlitClient = getSQLit({
      blockProducerEndpoint,
      minerEndpoint,
      databaseId: SQLIT_DATABASE_ID,
      timeout: 30000,
      debug: !isProductionEnv(),
    })

    await ensureTablesExist()
  }
  return sqlitClient
}

async function ensureTablesExist(): Promise<void> {
  if (!sqlitClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS pkg_packages (
      name TEXT PRIMARY KEY,
      scope TEXT,
      manifest_cid TEXT NOT NULL,
      latest_version TEXT NOT NULL,
      versions TEXT NOT NULL,
      owner TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      download_count INTEGER NOT NULL DEFAULT 0,
      storage_backend TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS pkg_tarballs (
      package_version TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      version TEXT NOT NULL,
      cid TEXT NOT NULL,
      size INTEGER NOT NULL,
      shasum TEXT NOT NULL,
      integrity TEXT NOT NULL,
      backend TEXT NOT NULL,
      uploaded_at INTEGER NOT NULL
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_pkg_packages_scope ON pkg_packages(scope)',
    'CREATE INDEX IF NOT EXISTS idx_pkg_tarballs_name ON pkg_tarballs(package_name)',
  ]

  for (const ddl of tables) {
    await sqlitClient.exec(ddl, [], SQLIT_DATABASE_ID)
  }

  for (const idx of indexes) {
    await sqlitClient.exec(idx, [], SQLIT_DATABASE_ID)
  }
}

// Row types
interface PackageRow {
  name: string
  scope: string | null
  manifest_cid: string
  latest_version: string
  versions: string
  owner: string
  created_at: number
  updated_at: number
  download_count: number
  storage_backend: string
  verified: number
}

interface TarballRow {
  package_version: string
  package_name: string
  version: string
  cid: string
  size: number
  shasum: string
  integrity: string
  backend: string
  uploaded_at: number
}

// Schema for validating upstream npm package metadata
const PkgPackageMetadataSchema = z
  .object({
    _id: z.string(),
    _rev: z.string().optional(),
    name: z.string(),
    description: z.string().default(''),
    'dist-tags': z.record(z.string(), z.string()),
    versions: z.record(z.string(), z.unknown()),
    time: z.record(z.string(), z.string()),
    maintainers: z.array(
      z.object({ name: z.string(), email: z.string().optional() }),
    ),
  })
  .passthrough()

export interface UpstreamProxyConfig {
  backend: BackendManager
  upstream: UpstreamRegistryConfig
  cache: CacheConfig
}

export class UpstreamProxy {
  private backend: BackendManager
  private upstreamConfig: UpstreamRegistryConfig
  private cacheConfig: CacheConfig

  // In-memory caches (ephemeral TTL caches only - records are persisted in SQLit)
  private metadataCache: Map<string, CacheEntry<PkgPackageMetadata>> = new Map()
  private tarballCache: Map<string, CacheEntry<{ cid: string; size: number }>> =
    new Map()

  constructor(config: UpstreamProxyConfig) {
    this.backend = config.backend
    this.upstreamConfig = config.upstream
    this.cacheConfig = config.cache
  }

  /**
   * Get package metadata (from cache or upstream)
   */
  async getPackageMetadata(
    packageName: string,
  ): Promise<PkgPackageMetadata | null> {
    // Check scope whitelist/blacklist
    if (!this.shouldCachePackage(packageName)) {
      return this.fetchFromUpstream(packageName)
    }

    // Check in-memory cache
    const cached = this.getFromCache(packageName)
    if (cached) {
      return cached
    }

    // Check persistent storage
    const record = await this.getPackageRecord(packageName)
    if (record) {
      const result = await this.backend.download(record.manifestCid)
      if (result) {
        const parsed = PkgPackageMetadataSchema.safeParse(
          JSON.parse(result.content.toString()),
        )
        if (!parsed.success) {
          return null
        }
        const metadata = parsed.data as PkgPackageMetadata
        this.setInCache(packageName, metadata)
        return metadata
      }
    }

    // Fetch from upstream and cache
    const upstream = await this.fetchFromUpstream(packageName)
    if (upstream) {
      await this.cachePackageMetadata(packageName, upstream)
    }

    return upstream
  }

  /**
   * Get specific version metadata
   */
  async getVersionMetadata(
    packageName: string,
    version: string,
  ): Promise<PkgVersionMetadata | null> {
    const metadata = await this.getPackageMetadata(packageName)
    if (!metadata) return null
    return metadata.versions[version] || null
  }

  /**
   * Get tarball (from cache or upstream)
   */
  async getTarball(
    packageName: string,
    version: string,
  ): Promise<Buffer | null> {
    const key = `${packageName}@${version}`

    // Check tarball cache
    const cached = this.tarballCache.get(key)
    if (cached && !this.isCacheExpired(cached)) {
      const result = await this.backend.download(cached.data.cid)
      if (result) {
        return result.content
      }
    }

    // Check tarball records
    const record = await this.getTarballRecord(packageName, version)
    if (record) {
      const result = await this.backend.download(record.cid)
      if (result) {
        // Update cache
        this.tarballCache.set(key, {
          data: { cid: record.cid, size: record.size },
          timestamp: Date.now(),
          ttl: this.cacheConfig.tarballTTL,
        })
        return result.content
      }
    }

    // Fetch from upstream
    const metadata = await this.getPackageMetadata(packageName)
    if (!metadata?.versions[version]) return null

    const tarballUrl = metadata.versions[version].dist.tarball
    const tarball = await this.fetchTarballFromUpstream(tarballUrl)

    if (tarball) {
      await this.cacheTarball(
        packageName,
        version,
        tarball,
        metadata.versions[version],
      )
    }

    return tarball
  }

  /**
   * Sync a package from upstream (proactive caching)
   */
  async syncPackage(
    packageName: string,
    options: { versions?: number } = {},
  ): Promise<UpstreamSyncResult> {
    const startTime = Date.now()
    const versionsToCache = options.versions ?? 5

    const metadata = await this.fetchFromUpstream(packageName)
    if (!metadata) {
      throw new Error(`Package ${packageName} not found in upstream registry`)
    }

    // Cache metadata
    await this.cachePackageMetadata(packageName, metadata)

    // Get versions to cache (latest N)
    const allVersions = Object.keys(metadata.versions)
    const sortedVersions = this.sortVersions(allVersions).slice(
      0,
      versionsToCache,
    )

    let tarballsCached = 0
    let totalSize = 0

    for (const version of sortedVersions) {
      const tarball = await this.getTarball(packageName, version)
      if (tarball) {
        tarballsCached++
        totalSize += tarball.length
      }
    }

    return {
      packageName,
      versionsAdded: sortedVersions,
      versionsCached: sortedVersions.length,
      tarballsCached,
      totalSize,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Sync multiple packages
   */
  async syncPackages(
    packageNames: string[],
    options: { versions?: number } = {},
  ): Promise<UpstreamSyncResult[]> {
    const results: UpstreamSyncResult[] = []

    for (const packageName of packageNames) {
      const result = await this.syncPackage(packageName, options).catch(
        (err) => ({
          packageName,
          versionsAdded: [],
          versionsCached: 0,
          tarballsCached: 0,
          totalSize: 0,
          duration: 0,
          error: err.message,
        }),
      )
      results.push(result as UpstreamSyncResult)
    }

    return results
  }

  /**
   * Check if a package is cached
   */
  async isCached(packageName: string): Promise<boolean> {
    const record = await this.getPackageRecord(packageName)
    return record !== null || this.metadataCache.has(packageName)
  }

  /**
   * Check if a specific version is cached
   */
  async isVersionCached(
    packageName: string,
    version: string,
  ): Promise<boolean> {
    const key = `${packageName}@${version}`
    const record = await this.getTarballRecord(packageName, version)
    return record !== null || this.tarballCache.has(key)
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    metadataCacheSize: number
    tarballCacheSize: number
    packageRecordsCount: number
    tarballRecordsCount: number
  }> {
    const client = await getSQLitClient()

    const pkgCount = await client.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM pkg_packages',
      [],
      SQLIT_DATABASE_ID,
    )

    const tarballCount = await client.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM pkg_tarballs',
      [],
      SQLIT_DATABASE_ID,
    )

    return {
      metadataCacheSize: this.metadataCache.size,
      tarballCacheSize: this.tarballCache.size,
      packageRecordsCount: pkgCount.rows[0].count ?? 0,
      tarballRecordsCount: tarballCount.rows[0].count ?? 0,
    }
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): { metadataCleared: number; tarballsCleared: number } {
    let metadataCleared = 0
    let tarballsCleared = 0

    for (const [key, entry] of this.metadataCache) {
      if (this.isCacheExpired(entry)) {
        this.metadataCache.delete(key)
        metadataCleared++
      }
    }

    for (const [key, entry] of this.tarballCache) {
      if (this.isCacheExpired(entry)) {
        this.tarballCache.delete(key)
        tarballsCleared++
      }
    }

    return { metadataCleared, tarballsCleared }
  }

  /**
   * Invalidate cache for a package
   */
  invalidateCache(packageName: string): void {
    this.metadataCache.delete(packageName)

    // Also invalidate version caches
    for (const key of this.tarballCache.keys()) {
      if (key.startsWith(`${packageName}@`)) {
        this.tarballCache.delete(key)
      }
    }
  }

  // SQLit Operations

  private async getPackageRecord(name: string): Promise<PackageRecord | null> {
    const client = await getSQLitClient()
    const result = await client.query<PackageRow>(
      'SELECT * FROM pkg_packages WHERE name = ?',
      [name],
      SQLIT_DATABASE_ID,
    )

    const row = result.rows[0]
    if (!row) return null

    return {
      name: row.name,
      scope: row.scope ?? undefined,
      manifestCid: row.manifest_cid,
      latestVersion: row.latest_version,
      versions: JSON.parse(row.versions) as string[],
      owner: row.owner as `0x${string}`,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      downloadCount: row.download_count,
      storageBackend: row.storage_backend as 'local' | 'ipfs' | 'arweave',
      verified: row.verified === 1,
    }
  }

  private async savePackageRecord(record: PackageRecord): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      `INSERT INTO pkg_packages (name, scope, manifest_cid, latest_version, versions, owner, created_at, updated_at, download_count, storage_backend, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
       manifest_cid = excluded.manifest_cid, latest_version = excluded.latest_version, versions = excluded.versions, updated_at = excluded.updated_at`,
      [
        record.name,
        record.scope ?? null,
        record.manifestCid,
        record.latestVersion,
        JSON.stringify(record.versions),
        record.owner,
        record.createdAt,
        record.updatedAt,
        record.downloadCount,
        record.storageBackend,
        record.verified ? 1 : 0,
      ],
      SQLIT_DATABASE_ID,
    )
  }

  private async getTarballRecord(
    packageName: string,
    version: string,
  ): Promise<TarballRecord | null> {
    const client = await getSQLitClient()
    const key = `${packageName}@${version}`
    const result = await client.query<TarballRow>(
      'SELECT * FROM pkg_tarballs WHERE package_version = ?',
      [key],
      SQLIT_DATABASE_ID,
    )

    const row = result.rows[0]
    if (!row) return null

    return {
      packageName: row.package_name,
      version: row.version,
      cid: row.cid,
      size: row.size,
      shasum: row.shasum,
      integrity: row.integrity,
      backend: row.backend as 'local' | 'ipfs' | 'arweave',
      uploadedAt: row.uploaded_at,
    }
  }

  private async saveTarballRecord(record: TarballRecord): Promise<void> {
    const client = await getSQLitClient()
    const key = `${record.packageName}@${record.version}`
    await client.exec(
      `INSERT INTO pkg_tarballs (package_version, package_name, version, cid, size, shasum, integrity, backend, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(package_version) DO UPDATE SET
       cid = excluded.cid, size = excluded.size, uploaded_at = excluded.uploaded_at`,
      [
        key,
        record.packageName,
        record.version,
        record.cid,
        record.size,
        record.shasum,
        record.integrity,
        record.backend,
        record.uploadedAt,
      ],
      SQLIT_DATABASE_ID,
    )
  }

  private async fetchFromUpstream(
    packageName: string,
  ): Promise<PkgPackageMetadata | null> {
    const url = `${this.upstreamConfig.url}/${encodeURIComponent(packageName)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.upstreamConfig.timeout,
    )

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.upstreamConfig.retries; attempt++) {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }).catch((err: Error) => {
        lastError = err
        return null
      })

      clearTimeout(timeoutId)

      if (response?.ok) {
        const json = await response.json()
        return PkgPackageMetadataSchema.parse(json) as PkgPackageMetadata
      }

      if (response?.status === 404) {
        return null
      }

      // Retry on 5xx errors
      if (
        response &&
        response.status >= 500 &&
        attempt < this.upstreamConfig.retries
      ) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }

      break
    }

    if (lastError !== null) {
      console.error(
        `[Pkg Upstream] Failed to fetch ${packageName}: ${(lastError as Error).message}`,
      )
    }

    return null
  }

  private async fetchTarballFromUpstream(url: string): Promise<Buffer | null> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.upstreamConfig.timeout * 2,
    )

    const response = await fetch(url, {
      signal: controller.signal,
    }).catch((err: Error) => {
      console.error(
        `[Pkg Upstream] Failed to fetch tarball ${url}: ${err.message}`,
      )
      return null
    })

    clearTimeout(timeoutId)

    if (!response?.ok) return null

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  private async cachePackageMetadata(
    packageName: string,
    metadata: PkgPackageMetadata,
  ): Promise<void> {
    // Store in backend
    const metadataBuffer = Buffer.from(JSON.stringify(metadata))
    const result = await this.backend.upload(metadataBuffer, {
      filename: `pkg-metadata-${packageName.replace('/', '-')}.json`,
    })

    // Create/update record
    const record: PackageRecord = {
      name: packageName,
      scope: packageName.startsWith('@')
        ? packageName.split('/')[0]
        : undefined,
      manifestCid: result.cid,
      latestVersion:
        metadata['dist-tags'].latest ||
        Object.keys(metadata.versions).pop() ||
        '0.0.0',
      versions: Object.keys(metadata.versions),
      owner: 'upstream-sync' as `0x${string}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      downloadCount: 0,
      storageBackend: 'local',
      verified: true,
    }

    await this.savePackageRecord(record)

    // Update in-memory cache
    this.setInCache(packageName, metadata)
  }

  private async cacheTarball(
    packageName: string,
    version: string,
    tarball: Buffer,
    versionMetadata: PkgVersionMetadata,
  ): Promise<void> {
    const key = `${packageName}@${version}`

    // Store in backend
    const result = await this.backend.upload(tarball, {
      filename: `pkg-tarball-${packageName.replace('/', '-')}-${version}.tgz`,
    })

    // Create record
    const record: TarballRecord = {
      packageName,
      version,
      cid: result.cid,
      size: tarball.length,
      shasum: versionMetadata.dist.shasum,
      integrity: versionMetadata.dist.integrity ?? '',
      backend: 'local',
      uploadedAt: Date.now(),
    }

    await this.saveTarballRecord(record)

    // Update in-memory cache
    this.tarballCache.set(key, {
      data: { cid: result.cid, size: tarball.length },
      timestamp: Date.now(),
      ttl: this.cacheConfig.tarballTTL,
    })
  }

  private getFromCache(packageName: string): PkgPackageMetadata | null {
    const cached = this.metadataCache.get(packageName)
    if (!cached) return null

    if (this.isCacheExpired(cached)) {
      this.metadataCache.delete(packageName)
      return null
    }

    return cached.data
  }

  private setInCache(packageName: string, metadata: PkgPackageMetadata): void {
    if (!this.cacheConfig.enabled) return

    // Enforce max size
    if (this.metadataCache.size >= this.cacheConfig.maxSize) {
      // Remove oldest entry
      const oldestKey = this.metadataCache.keys().next().value
      if (oldestKey) {
        this.metadataCache.delete(oldestKey)
      }
    }

    this.metadataCache.set(packageName, {
      data: metadata,
      timestamp: Date.now(),
      ttl: this.cacheConfig.defaultTTL,
    })
  }

  private isCacheExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl
  }

  private shouldCachePackage(packageName: string): boolean {
    // Check blacklist
    if (this.upstreamConfig.scopeBlacklist) {
      for (const scope of this.upstreamConfig.scopeBlacklist) {
        if (packageName.startsWith(scope)) return false
      }
    }

    // Check whitelist (if specified, only cache whitelisted scopes)
    if (
      this.upstreamConfig.scopeWhitelist &&
      this.upstreamConfig.scopeWhitelist.length > 0
    ) {
      for (const scope of this.upstreamConfig.scopeWhitelist) {
        if (packageName.startsWith(scope)) return true
      }
      return false
    }

    return this.upstreamConfig.cacheAllPackages
  }

  private sortVersions(versions: string[]): string[] {
    // Simple version sort - in production would use semver
    return versions.sort((a, b) => {
      const aParts = a.split('.').map((p) => parseInt(p, 10) ?? 0)
      const bParts = b.split('.').map((p) => parseInt(p, 10) ?? 0)

      for (let i = 0; i < 3; i++) {
        const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0)
        if (diff !== 0) return diff
      }

      return 0
    })
  }

  async exportRecords(): Promise<{
    packages: PackageRecord[]
    tarballs: TarballRecord[]
  }> {
    const client = await getSQLitClient()

    const pkgResult = await client.query<PackageRow>(
      'SELECT * FROM pkg_packages',
      [],
      SQLIT_DATABASE_ID,
    )

    const tarballResult = await client.query<TarballRow>(
      'SELECT * FROM pkg_tarballs',
      [],
      SQLIT_DATABASE_ID,
    )

    const packages: PackageRecord[] = pkgResult.rows.map((row) => ({
      name: row.name,
      scope: row.scope ?? undefined,
      manifestCid: row.manifest_cid,
      latestVersion: row.latest_version,
      versions: JSON.parse(row.versions) as string[],
      owner: row.owner as `0x${string}`,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      downloadCount: row.download_count,
      storageBackend: row.storage_backend as 'local' | 'ipfs' | 'arweave',
      verified: row.verified === 1,
    }))

    const tarballs: TarballRecord[] = tarballResult.rows.map((row) => ({
      packageName: row.package_name,
      version: row.version,
      cid: row.cid,
      size: row.size,
      shasum: row.shasum,
      integrity: row.integrity,
      backend: row.backend as 'local' | 'ipfs' | 'arweave',
      uploadedAt: row.uploaded_at,
    }))

    return { packages, tarballs }
  }

  async importRecords(data: {
    packages: PackageRecord[]
    tarballs: TarballRecord[]
  }): Promise<void> {
    for (const pkg of data.packages) {
      await this.savePackageRecord(pkg)
    }
    for (const tarball of data.tarballs) {
      await this.saveTarballRecord(tarball)
    }
  }
}

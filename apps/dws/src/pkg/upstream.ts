/**
 * Package Upstream Proxy (JejuPkg)
 * Caches and proxies packages from npmjs.org (for upstream compatibility)
 */

import type { BackendManager } from '../storage/backends';
import type {
  PkgPackageMetadata,
  PkgVersionMetadata,
  UpstreamRegistryConfig,
  UpstreamSyncResult,
  CacheEntry,
  CacheConfig,
  PackageRecord,
  TarballRecord,
} from './types';

export interface UpstreamProxyConfig {
  backend: BackendManager;
  upstream: UpstreamRegistryConfig;
  cache: CacheConfig;
}

export class UpstreamProxy {
  private backend: BackendManager;
  private upstreamConfig: UpstreamRegistryConfig;
  private cacheConfig: CacheConfig;

  // In-memory caches
  private metadataCache: Map<string, CacheEntry<PkgPackageMetadata>> = new Map();
  private tarballCache: Map<string, CacheEntry<{ cid: string; size: number }>> = new Map();

  // Persistent records (backed by storage)
  private packageRecords: Map<string, PackageRecord> = new Map();
  private tarballRecords: Map<string, TarballRecord> = new Map();

  constructor(config: UpstreamProxyConfig) {
    this.backend = config.backend;
    this.upstreamConfig = config.upstream;
    this.cacheConfig = config.cache;
  }

  /**
   * Get package metadata (from cache or upstream)
   */
  async getPackageMetadata(packageName: string): Promise<PkgPackageMetadata | null> {
    // Check scope whitelist/blacklist
    if (!this.shouldCachePackage(packageName)) {
      return this.fetchFromUpstream(packageName);
    }

    // Check in-memory cache
    const cached = this.getFromCache(packageName);
    if (cached) {
      return cached;
    }

    // Check persistent storage
    const record = this.packageRecords.get(packageName);
    if (record) {
      const result = await this.backend.download(record.manifestCid).catch(() => null);
      if (result) {
        const metadata = JSON.parse(result.content.toString()) as PkgPackageMetadata;
        this.setInCache(packageName, metadata);
        return metadata;
      }
    }

    // Fetch from upstream and cache
    const upstream = await this.fetchFromUpstream(packageName);
    if (upstream) {
      await this.cachePackageMetadata(packageName, upstream);
    }

    return upstream;
  }

  /**
   * Get specific version metadata
   */
  async getVersionMetadata(packageName: string, version: string): Promise<PkgVersionMetadata | null> {
    const metadata = await this.getPackageMetadata(packageName);
    if (!metadata) return null;
    return metadata.versions[version] || null;
  }

  /**
   * Get tarball (from cache or upstream)
   */
  async getTarball(packageName: string, version: string): Promise<Buffer | null> {
    const key = `${packageName}@${version}`;

    // Check tarball cache
    const cached = this.tarballCache.get(key);
    if (cached && !this.isCacheExpired(cached)) {
      const result = await this.backend.download(cached.data.cid).catch(() => null);
      if (result) {
        return result.content;
      }
    }

    // Check tarball records
    const record = this.tarballRecords.get(key);
    if (record) {
      const result = await this.backend.download(record.cid).catch(() => null);
      if (result) {
        // Update cache
        this.tarballCache.set(key, {
          data: { cid: record.cid, size: record.size },
          timestamp: Date.now(),
          ttl: this.cacheConfig.tarballTTL,
        });
        return result.content;
      }
    }

    // Fetch from upstream
    const metadata = await this.getPackageMetadata(packageName);
    if (!metadata?.versions[version]) return null;

    const tarballUrl = metadata.versions[version].dist.tarball;
    const tarball = await this.fetchTarballFromUpstream(tarballUrl);

    if (tarball) {
      await this.cacheTarball(packageName, version, tarball, metadata.versions[version]);
    }

    return tarball;
  }

  /**
   * Sync a package from upstream (proactive caching)
   */
  async syncPackage(packageName: string, options: { versions?: number } = {}): Promise<UpstreamSyncResult> {
    const startTime = Date.now();
    const versionsToCache = options.versions || 5;

    const metadata = await this.fetchFromUpstream(packageName);
    if (!metadata) {
      throw new Error(`Package ${packageName} not found in upstream registry`);
    }

    // Cache metadata
    await this.cachePackageMetadata(packageName, metadata);

    // Get versions to cache (latest N)
    const allVersions = Object.keys(metadata.versions);
    const sortedVersions = this.sortVersions(allVersions).slice(0, versionsToCache);

    let tarballsCached = 0;
    let totalSize = 0;

    for (const version of sortedVersions) {
      const tarball = await this.getTarball(packageName, version);
      if (tarball) {
        tarballsCached++;
        totalSize += tarball.length;
      }
    }

    return {
      packageName,
      versionsAdded: sortedVersions,
      versionsCached: sortedVersions.length,
      tarballsCached,
      totalSize,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Sync multiple packages
   */
  async syncPackages(packageNames: string[], options: { versions?: number } = {}): Promise<UpstreamSyncResult[]> {
    const results: UpstreamSyncResult[] = [];

    for (const packageName of packageNames) {
      const result = await this.syncPackage(packageName, options).catch(err => ({
        packageName,
        versionsAdded: [],
        versionsCached: 0,
        tarballsCached: 0,
        totalSize: 0,
        duration: 0,
        error: err.message,
      }));
      results.push(result as UpstreamSyncResult);
    }

    return results;
  }

  /**
   * Check if a package is cached
   */
  isCached(packageName: string): boolean {
    return this.packageRecords.has(packageName) || this.metadataCache.has(packageName);
  }

  /**
   * Check if a specific version is cached
   */
  isVersionCached(packageName: string, version: string): boolean {
    const key = `${packageName}@${version}`;
    return this.tarballRecords.has(key) || this.tarballCache.has(key);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    metadataCacheSize: number;
    tarballCacheSize: number;
    packageRecordsCount: number;
    tarballRecordsCount: number;
  } {
    return {
      metadataCacheSize: this.metadataCache.size,
      tarballCacheSize: this.tarballCache.size,
      packageRecordsCount: this.packageRecords.size,
      tarballRecordsCount: this.tarballRecords.size,
    };
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): { metadataCleared: number; tarballsCleared: number } {
    let metadataCleared = 0;
    let tarballsCleared = 0;

    for (const [key, entry] of this.metadataCache) {
      if (this.isCacheExpired(entry)) {
        this.metadataCache.delete(key);
        metadataCleared++;
      }
    }

    for (const [key, entry] of this.tarballCache) {
      if (this.isCacheExpired(entry)) {
        this.tarballCache.delete(key);
        tarballsCleared++;
      }
    }

    return { metadataCleared, tarballsCleared };
  }

  /**
   * Invalidate cache for a package
   */
  invalidateCache(packageName: string): void {
    this.metadataCache.delete(packageName);

    // Also invalidate version caches
    for (const key of this.tarballCache.keys()) {
      if (key.startsWith(`${packageName}@`)) {
        this.tarballCache.delete(key);
      }
    }
  }

  // ============ Private Methods ============

  private async fetchFromUpstream(packageName: string): Promise<PkgPackageMetadata | null> {
    const url = `${this.upstreamConfig.url}/${encodeURIComponent(packageName)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.upstreamConfig.timeout);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.upstreamConfig.retries; attempt++) {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }).catch((err: Error) => {
        lastError = err;
        return null;
      });

      clearTimeout(timeoutId);

      if (response?.ok) {
        return response.json() as Promise<PkgPackageMetadata>;
      }

      if (response?.status === 404) {
        return null;
      }

      // Retry on 5xx errors
      if (response && response.status >= 500 && attempt < this.upstreamConfig.retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      break;
    }

    if (lastError !== null) {
      console.error(`[Pkg Upstream] Failed to fetch ${packageName}: ${(lastError as Error).message}`);
    }

    return null;
  }

  private async fetchTarballFromUpstream(url: string): Promise<Buffer | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.upstreamConfig.timeout * 2);

    const response = await fetch(url, {
      signal: controller.signal,
    }).catch((err: Error) => {
      console.error(`[Pkg Upstream] Failed to fetch tarball ${url}: ${err.message}`);
      return null;
    });

    clearTimeout(timeoutId);

    if (!response?.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async cachePackageMetadata(packageName: string, metadata: PkgPackageMetadata): Promise<void> {
    // Store in backend
    const metadataBuffer = Buffer.from(JSON.stringify(metadata));
    const result = await this.backend.upload(metadataBuffer, {
      filename: `pkg-metadata-${packageName.replace('/', '-')}.json`,
    });

    // Create/update record
    const record: PackageRecord = {
      name: packageName,
      scope: packageName.startsWith('@') ? packageName.split('/')[0] : undefined,
      manifestCid: result.cid,
      latestVersion: metadata['dist-tags'].latest || Object.keys(metadata.versions).pop() || '0.0.0',
      versions: Object.keys(metadata.versions),
      owner: 'upstream-sync' as `0x${string}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      downloadCount: 0,
      storageBackend: 'local',
      verified: true,
    };

    this.packageRecords.set(packageName, record);

    // Update in-memory cache
    this.setInCache(packageName, metadata);
  }

  private async cacheTarball(
    packageName: string,
    version: string,
    tarball: Buffer,
    versionMetadata: PkgVersionMetadata
  ): Promise<void> {
    const key = `${packageName}@${version}`;

    // Store in backend
    const result = await this.backend.upload(tarball, {
      filename: `pkg-tarball-${packageName.replace('/', '-')}-${version}.tgz`,
    });

    // Create record
    const record: TarballRecord = {
      packageName,
      version,
      cid: result.cid,
      size: tarball.length,
      shasum: versionMetadata.dist.shasum,
      integrity: versionMetadata.dist.integrity || '',
      backend: 'local',
      uploadedAt: Date.now(),
    };

    this.tarballRecords.set(key, record);

    // Update in-memory cache
    this.tarballCache.set(key, {
      data: { cid: result.cid, size: tarball.length },
      timestamp: Date.now(),
      ttl: this.cacheConfig.tarballTTL,
    });
  }

  private getFromCache(packageName: string): PkgPackageMetadata | null {
    const cached = this.metadataCache.get(packageName);
    if (!cached) return null;

    if (this.isCacheExpired(cached)) {
      this.metadataCache.delete(packageName);
      return null;
    }

    return cached.data;
  }

  private setInCache(packageName: string, metadata: PkgPackageMetadata): void {
    if (!this.cacheConfig.enabled) return;

    // Enforce max size
    if (this.metadataCache.size >= this.cacheConfig.maxSize) {
      // Remove oldest entry
      const oldestKey = this.metadataCache.keys().next().value;
      if (oldestKey) {
        this.metadataCache.delete(oldestKey);
      }
    }

    this.metadataCache.set(packageName, {
      data: metadata,
      timestamp: Date.now(),
      ttl: this.cacheConfig.defaultTTL,
    });
  }

  private isCacheExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private shouldCachePackage(packageName: string): boolean {
    // Check blacklist
    if (this.upstreamConfig.scopeBlacklist) {
      for (const scope of this.upstreamConfig.scopeBlacklist) {
        if (packageName.startsWith(scope)) return false;
      }
    }

    // Check whitelist (if specified, only cache whitelisted scopes)
    if (this.upstreamConfig.scopeWhitelist && this.upstreamConfig.scopeWhitelist.length > 0) {
      for (const scope of this.upstreamConfig.scopeWhitelist) {
        if (packageName.startsWith(scope)) return true;
      }
      return false;
    }

    return this.upstreamConfig.cacheAllPackages;
  }

  private sortVersions(versions: string[]): string[] {
    // Simple version sort - in production would use semver
    return versions.sort((a, b) => {
      const aParts = a.split('.').map(p => parseInt(p) || 0);
      const bParts = b.split('.').map(p => parseInt(p) || 0);

      for (let i = 0; i < 3; i++) {
        const diff = (bParts[i] || 0) - (aParts[i] || 0);
        if (diff !== 0) return diff;
      }

      return 0;
    });
  }

  // ============ Export/Import for Persistence ============

  exportRecords(): { packages: PackageRecord[]; tarballs: TarballRecord[] } {
    return {
      packages: Array.from(this.packageRecords.values()),
      tarballs: Array.from(this.tarballRecords.values()),
    };
  }

  importRecords(data: { packages: PackageRecord[]; tarballs: TarballRecord[] }): void {
    for (const pkg of data.packages) {
      this.packageRecords.set(pkg.name, pkg);
    }
    for (const tarball of data.tarballs) {
      const key = `${tarball.packageName}@${tarball.version}`;
      this.tarballRecords.set(key, tarball);
    }
  }
}


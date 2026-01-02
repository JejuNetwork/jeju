/**
 * Release management - fetching and caching release manifests from DWS
 */

import { getDWSUrl } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import {
  type ReleaseArtifact,
  type ReleaseIndex,
  ReleaseIndexSchema,
  type ReleaseManifest,
  ReleaseManifestSchema,
} from '@jejunetwork/types'

const releaseCache = new Map<
  string,
  { data: ReleaseManifest | ReleaseIndex; expiresAt: number }
>()
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

export interface ReleaseServiceConfig {
  dwsUrl?: string
  cacheEnabled?: boolean
  cacheTtlMs?: number
}

export class ReleaseService {
  private readonly dwsUrl: string
  private readonly cacheEnabled: boolean
  private readonly cacheTtlMs: number

  constructor(config: ReleaseServiceConfig = {}) {
    this.dwsUrl = config.dwsUrl ?? getDWSUrl()
    this.cacheEnabled = config.cacheEnabled ?? true
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  private getFromCache<T>(key: string): T | undefined {
    if (!this.cacheEnabled) return undefined
    const cached = releaseCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T
    }
    return undefined
  }

  private setCache(key: string, data: ReleaseManifest | ReleaseIndex): void {
    if (!this.cacheEnabled) return
    releaseCache.set(key, { data, expiresAt: Date.now() + this.cacheTtlMs })
  }

  async getIndex(app: string): Promise<ReleaseIndex> {
    const cacheKey = `${app}:index`
    const cached = this.getFromCache<ReleaseIndex>(cacheKey)
    if (cached) return cached

    const response = await fetch(
      `${this.dwsUrl}/storage/releases/${app}/index.json`,
    )

    if (!response.ok) {
      if (response.status === 404) {
        logger.info('[Releases] No releases found for app', { app })
        return { app, latest: '0.0.0', versions: [] }
      }
      logger.error('[Releases] Failed to fetch release index', {
        app,
        status: response.status,
      })
      throw new Error(`Failed to fetch release index: ${response.statusText}`)
    }

    const data: unknown = await response.json()
    const index = ReleaseIndexSchema.parse(data)
    this.setCache(cacheKey, index)
    return index
  }

  async getManifest(app: string, version: string): Promise<ReleaseManifest> {
    const cacheKey = `${app}:${version}`
    const cached = this.getFromCache<ReleaseManifest>(cacheKey)
    if (cached) return cached

    const response = await fetch(
      `${this.dwsUrl}/storage/releases/${app}/${version}/manifest.json`,
    )

    if (!response.ok) {
      logger.warn('[Releases] Release manifest not found', {
        app,
        version,
        status: response.status,
      })
      throw new Error(`Release ${app}@${version} not found`)
    }

    const data: unknown = await response.json()
    const manifest = ReleaseManifestSchema.parse(data)
    this.setCache(cacheKey, manifest)
    return manifest
  }

  async getLatest(
    app: string,
    channel: 'stable' | 'beta' | 'nightly' = 'stable',
  ): Promise<ReleaseManifest> {
    const index = await this.getIndex(app)

    const version =
      channel === 'beta'
        ? (index.latestBeta ?? index.latest)
        : channel === 'nightly'
          ? (index.latestNightly ?? index.latest)
          : index.latest

    if (!version || version === '0.0.0') {
      logger.warn('[Releases] No releases available', { app, channel })
      throw new Error(`No ${channel} releases available for ${app}`)
    }

    return this.getManifest(app, version)
  }

  getDownloadUrl(artifact: ReleaseArtifact): string {
    return `${this.dwsUrl}/storage/download/${artifact.cid}?filename=${encodeURIComponent(artifact.filename)}`
  }

  clearCache(app?: string): void {
    if (app) {
      for (const key of releaseCache.keys()) {
        if (key.startsWith(`${app}:`)) releaseCache.delete(key)
      }
    } else {
      releaseCache.clear()
    }
  }
}

let defaultService: ReleaseService | null = null

export function getReleaseService(): ReleaseService {
  if (!defaultService) {
    defaultService = new ReleaseService()
  }
  return defaultService
}

export function initReleaseService(config: ReleaseServiceConfig): void {
  defaultService = new ReleaseService(config)
}

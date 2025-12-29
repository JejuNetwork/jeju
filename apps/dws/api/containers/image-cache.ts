/**
 * Image Cache - EQLite-backed layer-level caching for fast container pulls
 * Implements content-addressed deduplication across images
 */

import {
  getEQLiteMinerUrl,
  getEQLiteUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { getEQLite, resetEQLite } from '@jejunetwork/db'
import type { ContainerImage, ImageCache, LayerCache } from './types'

const EQLITE_DATABASE_ID = process.env.EQLITE_DATABASE_ID ?? 'dws'

// Cache configuration
const MAX_CACHE_SIZE_MB = parseInt(
  process.env.CONTAINER_CACHE_SIZE_MB || '10240',
  10,
) // 10GB default
const CACHE_EVICTION_THRESHOLD = 0.9 // Evict when 90% full

// EQLite Client singleton
let eqliteClient: ReturnType<typeof getEQLite> | null = null

async function getEQLiteClient() {
  if (!eqliteClient) {
    resetEQLite()
    const blockProducerEndpoint = getEQLiteUrl()
    const minerEndpoint = getEQLiteMinerUrl()

    eqliteClient = getEQLite({
      blockProducerEndpoint,
      minerEndpoint,
      databaseId: EQLITE_DATABASE_ID,
      timeout: 30000,
      debug: !isProductionEnv(),
    })

    await ensureTablesExist()
  }
  return eqliteClient
}

async function ensureTablesExist(): Promise<void> {
  if (!eqliteClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS container_layers (
      digest TEXT PRIMARY KEY,
      cid TEXT NOT NULL,
      size INTEGER NOT NULL,
      local_path TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS container_images (
      digest TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      layers TEXT NOT NULL,
      total_size INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS container_cache_stats (
      id TEXT PRIMARY KEY DEFAULT 'global',
      current_size_mb REAL NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      cache_misses INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS prewarm_queue (
      id TEXT PRIMARY KEY,
      image_digests TEXT NOT NULL,
      priority TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_layers_last_accessed ON container_layers(last_accessed_at)',
    'CREATE INDEX IF NOT EXISTS idx_images_repo ON container_images(repo_id)',
    'CREATE INDEX IF NOT EXISTS idx_prewarm_priority ON prewarm_queue(priority, created_at)',
  ]

  for (const ddl of tables) {
    await eqliteClient.exec(ddl, [], EQLITE_DATABASE_ID)
  }

  for (const idx of indexes) {
    await eqliteClient.exec(idx, [], EQLITE_DATABASE_ID)
  }

  // Initialize stats row if not exists
  await eqliteClient.exec(
    `INSERT INTO container_cache_stats (id, current_size_mb, cache_hits, cache_misses)
     VALUES ('global', 0, 0, 0)
     ON CONFLICT(id) DO NOTHING`,
    [],
    EQLITE_DATABASE_ID,
  )
}

// Row types
interface LayerRow {
  digest: string
  cid: string
  size: number
  local_path: string
  cached_at: number
  last_accessed_at: number
  hit_count: number
}

interface ImageRow {
  digest: string
  repo_id: string
  cached_at: number
  last_accessed_at: number
  hit_count: number
  layers: string
  total_size: number
}

interface StatsRow {
  id: string
  current_size_mb: number
  cache_hits: number
  cache_misses: number
}

interface PrewarmRow {
  id: string
  image_digests: string
  priority: string
  created_at: number
}

// Layer Cache Operations

export async function getCachedLayer(
  digest: string,
): Promise<LayerCache | null> {
  const client = await getEQLiteClient()
  const result = await client.query<LayerRow>(
    'SELECT * FROM container_layers WHERE digest = ?',
    [digest],
    EQLITE_DATABASE_ID,
  )

  const row = result.rows[0]
  if (!row) return null

  // Update access stats
  const now = Date.now()
  await client.exec(
    'UPDATE container_layers SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE digest = ?',
    [now, digest],
    EQLITE_DATABASE_ID,
  )

  return {
    digest: row.digest,
    cid: row.cid,
    size: row.size,
    localPath: row.local_path,
    cachedAt: row.cached_at,
    lastAccessedAt: now,
    hitCount: row.hit_count + 1,
  }
}

export async function cacheLayer(
  digest: string,
  cid: string,
  size: number,
  localPath: string,
): Promise<LayerCache> {
  const client = await getEQLiteClient()
  const sizeMb = size / (1024 * 1024)

  // Check current cache size
  const stats = await getStatsRow()
  if (
    stats.current_size_mb + sizeMb >
    MAX_CACHE_SIZE_MB * CACHE_EVICTION_THRESHOLD
  ) {
    await evictLRULayers(sizeMb)
  }

  const now = Date.now()
  const layer: LayerCache = {
    digest,
    cid,
    size,
    localPath,
    cachedAt: now,
    lastAccessedAt: now,
    hitCount: 0,
  }

  await client.exec(
    `INSERT INTO container_layers (digest, cid, size, local_path, cached_at, last_accessed_at, hit_count)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(digest) DO UPDATE SET
     cid = excluded.cid, local_path = excluded.local_path, last_accessed_at = excluded.last_accessed_at`,
    [digest, cid, size, localPath, now, now],
    EQLITE_DATABASE_ID,
  )

  // Update cache size
  await client.exec(
    'UPDATE container_cache_stats SET current_size_mb = current_size_mb + ? WHERE id = ?',
    [sizeMb, 'global'],
    EQLITE_DATABASE_ID,
  )

  return layer
}

export async function invalidateLayer(digest: string): Promise<boolean> {
  const client = await getEQLiteClient()

  // Get layer size first
  const result = await client.query<LayerRow>(
    'SELECT size FROM container_layers WHERE digest = ?',
    [digest],
    EQLITE_DATABASE_ID,
  )

  if (!result.rows[0]) return false

  const sizeMb = result.rows[0].size / (1024 * 1024)

  // Delete layer
  await client.exec(
    'DELETE FROM container_layers WHERE digest = ?',
    [digest],
    EQLITE_DATABASE_ID,
  )

  // Update cache size
  await client.exec(
    'UPDATE container_cache_stats SET current_size_mb = current_size_mb - ? WHERE id = ?',
    [sizeMb, 'global'],
    EQLITE_DATABASE_ID,
  )

  return true
}

// Image Cache Operations

export async function getCachedImage(
  digest: string,
): Promise<ImageCache | null> {
  const client = await getEQLiteClient()
  const result = await client.query<ImageRow>(
    'SELECT * FROM container_images WHERE digest = ?',
    [digest],
    EQLITE_DATABASE_ID,
  )

  const row = result.rows[0]
  if (!row) return null

  // Update access stats
  const now = Date.now()
  await client.exec(
    'UPDATE container_images SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE digest = ?',
    [now, digest],
    EQLITE_DATABASE_ID,
  )

  const layers: LayerCache[] = JSON.parse(row.layers) as LayerCache[]

  return {
    digest: row.digest,
    repoId: row.repo_id,
    cachedAt: row.cached_at,
    lastAccessedAt: now,
    hitCount: row.hit_count + 1,
    layers,
    totalSize: row.total_size,
  }
}

export async function cacheImage(
  image: ContainerImage,
  layers: LayerCache[],
): Promise<ImageCache> {
  const client = await getEQLiteClient()
  const now = Date.now()

  const cached: ImageCache = {
    digest: image.digest,
    repoId: image.repoId,
    cachedAt: now,
    lastAccessedAt: now,
    hitCount: 0,
    layers,
    totalSize: layers.reduce((sum, l) => sum + l.size, 0),
  }

  await client.exec(
    `INSERT INTO container_images (digest, repo_id, cached_at, last_accessed_at, hit_count, layers, total_size)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(digest) DO UPDATE SET
     last_accessed_at = excluded.last_accessed_at, layers = excluded.layers`,
    [
      image.digest,
      image.repoId,
      now,
      now,
      JSON.stringify(layers),
      cached.totalSize,
    ],
    EQLITE_DATABASE_ID,
  )

  return cached
}

export async function invalidateImage(digest: string): Promise<boolean> {
  const client = await getEQLiteClient()
  const result = await client.exec(
    'DELETE FROM container_images WHERE digest = ?',
    [digest],
    EQLITE_DATABASE_ID,
  )
  return result.rowsAffected > 0
}

// Cache Statistics

export interface CacheStats {
  totalLayers: number
  totalImages: number
  cacheSizeMb: number
  maxCacheSizeMb: number
  cacheUtilization: number
  totalHits: number
  totalMisses: number
  hitRate: number
  avgLayerSizeMb: number
  oldestLayerAge: number
}

async function getStatsRow(): Promise<StatsRow> {
  const client = await getEQLiteClient()
  const result = await client.query<StatsRow>(
    'SELECT * FROM container_cache_stats WHERE id = ?',
    ['global'],
    EQLITE_DATABASE_ID,
  )
  return (
    result.rows[0] ?? {
      id: 'global',
      current_size_mb: 0,
      cache_hits: 0,
      cache_misses: 0,
    }
  )
}

export async function recordCacheHit(): Promise<void> {
  const client = await getEQLiteClient()
  await client.exec(
    'UPDATE container_cache_stats SET cache_hits = cache_hits + 1 WHERE id = ?',
    ['global'],
    EQLITE_DATABASE_ID,
  )
}

export async function recordCacheMiss(): Promise<void> {
  const client = await getEQLiteClient()
  await client.exec(
    'UPDATE container_cache_stats SET cache_misses = cache_misses + 1 WHERE id = ?',
    ['global'],
    EQLITE_DATABASE_ID,
  )
}

export async function getCacheStats(): Promise<CacheStats> {
  const client = await getEQLiteClient()

  const layerCount = await client.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM container_layers',
    [],
    EQLITE_DATABASE_ID,
  )

  const imageCount = await client.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM container_images',
    [],
    EQLITE_DATABASE_ID,
  )

  const layerStats = await client.query<{ total_size: number; oldest: number }>(
    'SELECT COALESCE(SUM(size), 0) as total_size, COALESCE(MIN(cached_at), 0) as oldest FROM container_layers',
    [],
    EQLITE_DATABASE_ID,
  )

  const stats = await getStatsRow()
  const totalLayers = layerCount.rows[0].count ?? 0
  const totalHits = stats.cache_hits
  const totalMisses = stats.cache_misses
  const totalRequests = totalHits + totalMisses
  const now = Date.now()
  const oldestCachedAt = layerStats.rows[0].oldest ?? now
  const totalLayerSize = layerStats.rows[0].total_size ?? 0

  return {
    totalLayers,
    totalImages: imageCount.rows[0].count ?? 0,
    cacheSizeMb: Math.round(stats.current_size_mb * 100) / 100,
    maxCacheSizeMb: MAX_CACHE_SIZE_MB,
    cacheUtilization:
      Math.round((stats.current_size_mb / MAX_CACHE_SIZE_MB) * 10000) / 100,
    totalHits,
    totalMisses,
    hitRate:
      totalRequests > 0
        ? Math.round((totalHits / totalRequests) * 10000) / 100
        : 0,
    avgLayerSizeMb:
      totalLayers > 0
        ? Math.round((totalLayerSize / totalLayers / (1024 * 1024)) * 100) / 100
        : 0,
    oldestLayerAge: now - oldestCachedAt,
  }
}

// Cache Eviction (LRU)

async function evictLRULayers(requiredSpaceMb: number): Promise<void> {
  const client = await getEQLiteClient()

  // Get layers sorted by LRU
  const layers = await client.query<LayerRow>(
    'SELECT digest, size FROM container_layers ORDER BY last_accessed_at ASC',
    [],
    EQLITE_DATABASE_ID,
  )

  let freedMb = 0
  for (const layer of layers.rows) {
    if (freedMb >= requiredSpaceMb) break

    const sizeMb = layer.size / (1024 * 1024)

    // Delete from layers
    await client.exec(
      'DELETE FROM container_layers WHERE digest = ?',
      [layer.digest],
      EQLITE_DATABASE_ID,
    )

    // Also remove from any image caches that reference this layer
    const images = await client.query<ImageRow>(
      'SELECT digest, layers FROM container_images',
      [],
      EQLITE_DATABASE_ID,
    )

    for (const image of images.rows) {
      const imageLayers: LayerCache[] = JSON.parse(image.layers) as LayerCache[]
      if (imageLayers.some((l) => l.digest === layer.digest)) {
        await client.exec(
          'DELETE FROM container_images WHERE digest = ?',
          [image.digest],
          EQLITE_DATABASE_ID,
        )
      }
    }

    freedMb += sizeMb
  }

  // Update cache size
  await client.exec(
    'UPDATE container_cache_stats SET current_size_mb = current_size_mb - ? WHERE id = ?',
    [freedMb, 'global'],
    EQLITE_DATABASE_ID,
  )
}

// Pre-warming

export interface PrewarmRequest {
  imageDigests: string[]
  priority: 'low' | 'normal' | 'high'
}

export async function queuePrewarm(request: PrewarmRequest): Promise<void> {
  const client = await getEQLiteClient()
  const id = crypto.randomUUID()
  await client.exec(
    `INSERT INTO prewarm_queue (id, image_digests, priority, created_at) VALUES (?, ?, ?, ?)`,
    [id, JSON.stringify(request.imageDigests), request.priority, Date.now()],
    EQLITE_DATABASE_ID,
  )
}

export async function getPrewarmQueue(): Promise<PrewarmRequest[]> {
  const client = await getEQLiteClient()
  const result = await client.query<PrewarmRow>(
    'SELECT * FROM prewarm_queue ORDER BY CASE priority WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END, created_at ASC',
    ['high', 'normal'],
    EQLITE_DATABASE_ID,
  )

  return result.rows.map((row) => ({
    imageDigests: JSON.parse(row.image_digests) as string[],
    priority: row.priority as 'low' | 'normal' | 'high',
  }))
}

export async function clearPrewarmQueue(): Promise<void> {
  const client = await getEQLiteClient()
  await client.exec('DELETE FROM prewarm_queue', [], EQLITE_DATABASE_ID)
}

// Prewarm status tracking via EQLite
export async function setPrewarmingStatus(status: boolean): Promise<void> {
  const client = await getEQLiteClient()
  await client.exec(
    `INSERT INTO container_cache_stats (id, current_size_mb, cache_hits, cache_misses)
     VALUES ('prewarm_status', ?, 0, 0)
     ON CONFLICT(id) DO UPDATE SET current_size_mb = ?`,
    [status ? 1 : 0, status ? 1 : 0],
    EQLITE_DATABASE_ID,
  )
}

export async function isCurrentlyPrewarming(): Promise<boolean> {
  const client = await getEQLiteClient()
  const result = await client.query<StatsRow>(
    'SELECT current_size_mb FROM container_cache_stats WHERE id = ?',
    ['prewarm_status'],
    EQLITE_DATABASE_ID,
  )
  return (result.rows[0].current_size_mb ?? 0) > 0
}

// Deduplication Analysis

export interface DeduplicationStats {
  totalLayerBytes: number
  uniqueLayerBytes: number
  savedBytes: number
  deduplicationRatio: number
  sharedLayers: Array<{
    digest: string
    sharedByImages: number
    sizeMb: number
  }>
}

export async function analyzeDeduplication(): Promise<DeduplicationStats> {
  const client = await getEQLiteClient()

  // Get all images with their layers
  const images = await client.query<ImageRow>(
    'SELECT digest, layers FROM container_images',
    [],
    EQLITE_DATABASE_ID,
  )

  const layerUsage = new Map<string, { count: number; size: number }>()

  for (const image of images.rows) {
    const layers: LayerCache[] = JSON.parse(image.layers) as LayerCache[]
    for (const layer of layers) {
      const existing = layerUsage.get(layer.digest)
      if (existing) {
        existing.count++
      } else {
        layerUsage.set(layer.digest, { count: 1, size: layer.size })
      }
    }
  }

  let totalBytes = 0
  let uniqueBytes = 0
  const sharedLayers: Array<{
    digest: string
    sharedByImages: number
    sizeMb: number
  }> = []

  for (const [digest, usage] of layerUsage) {
    totalBytes += usage.size * usage.count
    uniqueBytes += usage.size

    if (usage.count > 1) {
      sharedLayers.push({
        digest,
        sharedByImages: usage.count,
        sizeMb: Math.round((usage.size / (1024 * 1024)) * 100) / 100,
      })
    }
  }

  sharedLayers.sort((a, b) => b.sharedByImages - a.sharedByImages)

  return {
    totalLayerBytes: totalBytes,
    uniqueLayerBytes: uniqueBytes,
    savedBytes: totalBytes - uniqueBytes,
    deduplicationRatio:
      totalBytes > 0
        ? Math.round((1 - uniqueBytes / totalBytes) * 10000) / 100
        : 0,
    sharedLayers: sharedLayers.slice(0, 20),
  }
}

// Export cache contents (for debugging/sync)

export async function exportCache(): Promise<{
  layers: LayerCache[]
  images: ImageCache[]
}> {
  const client = await getEQLiteClient()

  const layerResult = await client.query<LayerRow>(
    'SELECT * FROM container_layers',
    [],
    EQLITE_DATABASE_ID,
  )

  const imageResult = await client.query<ImageRow>(
    'SELECT * FROM container_images',
    [],
    EQLITE_DATABASE_ID,
  )

  return {
    layers: layerResult.rows.map((row) => ({
      digest: row.digest,
      cid: row.cid,
      size: row.size,
      localPath: row.local_path,
      cachedAt: row.cached_at,
      lastAccessedAt: row.last_accessed_at,
      hitCount: row.hit_count,
    })),
    images: imageResult.rows.map((row) => ({
      digest: row.digest,
      repoId: row.repo_id,
      cachedAt: row.cached_at,
      lastAccessedAt: row.last_accessed_at,
      hitCount: row.hit_count,
      layers: JSON.parse(row.layers) as LayerCache[],
      totalSize: row.total_size,
    })),
  }
}

export async function clearCache(): Promise<void> {
  const client = await getEQLiteClient()
  await client.exec('DELETE FROM container_layers', [], EQLITE_DATABASE_ID)
  await client.exec('DELETE FROM container_images', [], EQLITE_DATABASE_ID)
  await client.exec(
    'UPDATE container_cache_stats SET current_size_mb = 0, cache_hits = 0, cache_misses = 0 WHERE id = ?',
    ['global'],
    EQLITE_DATABASE_ID,
  )
}

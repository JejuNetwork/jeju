/**
 * Image Cache - Layer-level caching for fast container pulls
 * Implements content-addressed deduplication across images
 */

import type { ContainerImage, LayerCache, ImageCache } from './types';

// In-memory cache (production would use disk + distributed cache)
const layerCache = new Map<string, LayerCache>();
const imageCache = new Map<string, ImageCache>();

// Cache configuration
const MAX_CACHE_SIZE_MB = parseInt(process.env.CONTAINER_CACHE_SIZE_MB || '10240'); // 10GB default
const CACHE_EVICTION_THRESHOLD = 0.9; // Evict when 90% full
let currentCacheSizeMb = 0;

// ============================================================================
// Layer Cache Operations
// ============================================================================

export function getCachedLayer(digest: string): LayerCache | null {
  const layer = layerCache.get(digest);
  if (layer) {
    layer.lastAccessedAt = Date.now();
    layer.hitCount++;
    return layer;
  }
  return null;
}

export function cacheLayer(
  digest: string,
  cid: string,
  size: number,
  localPath: string
): LayerCache {
  // Check if eviction needed
  const sizeMb = size / (1024 * 1024);
  if (currentCacheSizeMb + sizeMb > MAX_CACHE_SIZE_MB * CACHE_EVICTION_THRESHOLD) {
    evictLRULayers(sizeMb);
  }

  const layer: LayerCache = {
    digest,
    cid,
    size,
    localPath,
    cachedAt: Date.now(),
    lastAccessedAt: Date.now(),
    hitCount: 0,
  };

  layerCache.set(digest, layer);
  currentCacheSizeMb += sizeMb;

  return layer;
}

export function invalidateLayer(digest: string): boolean {
  const layer = layerCache.get(digest);
  if (layer) {
    currentCacheSizeMb -= layer.size / (1024 * 1024);
    layerCache.delete(digest);
    return true;
  }
  return false;
}

// ============================================================================
// Image Cache Operations
// ============================================================================

export function getCachedImage(digest: string): ImageCache | null {
  const image = imageCache.get(digest);
  if (image) {
    image.lastAccessedAt = Date.now();
    image.hitCount++;
    return image;
  }
  return null;
}

export function cacheImage(image: ContainerImage, layers: LayerCache[]): ImageCache {
  const cached: ImageCache = {
    digest: image.digest,
    repoId: image.repoId,
    cachedAt: Date.now(),
    lastAccessedAt: Date.now(),
    hitCount: 0,
    layers,
    totalSize: layers.reduce((sum, l) => sum + l.size, 0),
  };

  imageCache.set(image.digest, cached);
  return cached;
}

export function invalidateImage(digest: string): boolean {
  return imageCache.delete(digest);
}

// ============================================================================
// Cache Statistics
// ============================================================================

export interface CacheStats {
  totalLayers: number;
  totalImages: number;
  cacheSizeMb: number;
  maxCacheSizeMb: number;
  cacheUtilization: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  avgLayerSizeMb: number;
  oldestLayerAge: number;
}

let cacheHits = 0;
let cacheMisses = 0;

export function recordCacheHit(): void {
  cacheHits++;
}

export function recordCacheMiss(): void {
  cacheMisses++;
}

export function getCacheStats(): CacheStats {
  const layers = [...layerCache.values()];
  const now = Date.now();

  const oldestLayer = layers.reduce(
    (oldest, l) => (l.cachedAt < oldest ? l.cachedAt : oldest),
    now
  );

  return {
    totalLayers: layerCache.size,
    totalImages: imageCache.size,
    cacheSizeMb: Math.round(currentCacheSizeMb * 100) / 100,
    maxCacheSizeMb: MAX_CACHE_SIZE_MB,
    cacheUtilization: Math.round((currentCacheSizeMb / MAX_CACHE_SIZE_MB) * 10000) / 100,
    totalHits: cacheHits,
    totalMisses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0 
      ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 10000) / 100 
      : 0,
    avgLayerSizeMb: layers.length > 0
      ? Math.round((layers.reduce((sum, l) => sum + l.size, 0) / layers.length / (1024 * 1024)) * 100) / 100
      : 0,
    oldestLayerAge: now - oldestLayer,
  };
}

// ============================================================================
// Cache Eviction (LRU)
// ============================================================================

function evictLRULayers(requiredSpaceMb: number): void {
  const layers = [...layerCache.entries()]
    .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

  let freedMb = 0;
  for (const [digest, layer] of layers) {
    if (freedMb >= requiredSpaceMb) break;

    const sizeMb = layer.size / (1024 * 1024);
    layerCache.delete(digest);
    currentCacheSizeMb -= sizeMb;
    freedMb += sizeMb;

    // Also remove from any image caches
    for (const [imageDigest, image] of imageCache) {
      if (image.layers.some((l) => l.digest === digest)) {
        imageCache.delete(imageDigest);
      }
    }
  }
}

// ============================================================================
// Pre-warming
// ============================================================================

export interface PrewarmRequest {
  imageDigests: string[];
  priority: 'low' | 'normal' | 'high';
}

const prewarmQueue: PrewarmRequest[] = [];
let isPrewarming = false;

export function queuePrewarm(request: PrewarmRequest): void {
  prewarmQueue.push(request);
  prewarmQueue.sort((a, b) => {
    const priority = { high: 0, normal: 1, low: 2 };
    return priority[a.priority] - priority[b.priority];
  });
}

export function getPrewarmQueue(): PrewarmRequest[] {
  return [...prewarmQueue];
}

export function setPrewarmingStatus(status: boolean): void {
  isPrewarming = status;
}

export function isCurrentlyPrewarming(): boolean {
  return isPrewarming;
}

// ============================================================================
// Deduplication Analysis
// ============================================================================

export interface DeduplicationStats {
  totalLayerBytes: number;
  uniqueLayerBytes: number;
  savedBytes: number;
  deduplicationRatio: number;
  sharedLayers: Array<{ digest: string; sharedByImages: number; sizeMb: number }>;
}

export function analyzeDeduplication(): DeduplicationStats {
  const layerUsage = new Map<string, { count: number; size: number }>();

  for (const image of imageCache.values()) {
    for (const layer of image.layers) {
      const existing = layerUsage.get(layer.digest);
      if (existing) {
        existing.count++;
      } else {
        layerUsage.set(layer.digest, { count: 1, size: layer.size });
      }
    }
  }

  let totalBytes = 0;
  let uniqueBytes = 0;
  const sharedLayers: Array<{ digest: string; sharedByImages: number; sizeMb: number }> = [];

  for (const [digest, usage] of layerUsage) {
    totalBytes += usage.size * usage.count;
    uniqueBytes += usage.size;

    if (usage.count > 1) {
      sharedLayers.push({
        digest,
        sharedByImages: usage.count,
        sizeMb: Math.round((usage.size / (1024 * 1024)) * 100) / 100,
      });
    }
  }

  sharedLayers.sort((a, b) => b.sharedByImages - a.sharedByImages);

  return {
    totalLayerBytes: totalBytes,
    uniqueLayerBytes: uniqueBytes,
    savedBytes: totalBytes - uniqueBytes,
    deduplicationRatio: totalBytes > 0 ? Math.round((1 - uniqueBytes / totalBytes) * 10000) / 100 : 0,
    sharedLayers: sharedLayers.slice(0, 20),
  };
}

// ============================================================================
// Export cache contents (for debugging/sync)
// ============================================================================

export function exportCache(): { layers: LayerCache[]; images: ImageCache[] } {
  return {
    layers: [...layerCache.values()],
    images: [...imageCache.values()],
  };
}

export function clearCache(): void {
  layerCache.clear();
  imageCache.clear();
  currentCacheSizeMb = 0;
  cacheHits = 0;
  cacheMisses = 0;
}


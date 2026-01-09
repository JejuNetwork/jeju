import { describe, expect, test } from 'bun:test'
import { createHash } from '@jejunetwork/shared'
import { z } from 'zod'

// Static Asset Config Schema
const StaticAssetConfigSchema = z.object({
  cachePath: z.string().min(1),
  maxCacheSizeMb: z.number().int().positive().default(1024),
  manifestUrl: z.string().url().optional(),
  cdnEndpoints: z.array(z.string().url()).default([]),
  listenPort: z.number().int().min(1024).max(65535).optional(),
  metricsPort: z.number().int().min(1024).max(65535).optional(),
})

type StaticAssetConfig = z.infer<typeof StaticAssetConfigSchema>

// Asset Manifest Schema
const AssetManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  assets: z.array(
    z.object({
      path: z.string().min(1),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      size: z.number().int().positive(),
      mimeType: z.string().min(1),
    }),
  ),
  updated: z.number().int().positive(),
})

type AssetManifest = z.infer<typeof AssetManifestSchema>

// Cached Asset Schema - reserved for future validation
// Structure: { contentHash, data, mimeType, size, cachedAt, accessCount }

function validateStaticAssetConfig(data: unknown): StaticAssetConfig {
  return StaticAssetConfigSchema.parse(data)
}

function validateAssetManifest(data: unknown): AssetManifest {
  return AssetManifestSchema.parse(data)
}

describe('Static Asset Configuration', () => {
  describe('validateStaticAssetConfig', () => {
    test('validates valid config', () => {
      const config = {
        cachePath: './cache/assets',
        maxCacheSizeMb: 2048,
        manifestUrl: 'https://assets.jejunetwork.org/manifest.json',
        cdnEndpoints: [
          'https://cdn1.jejunetwork.org',
          'https://cdn2.jejunetwork.org',
        ],
        listenPort: 8080,
        metricsPort: 9090,
      }

      const result = validateStaticAssetConfig(config)
      expect(result.cachePath).toBe('./cache/assets')
      expect(result.maxCacheSizeMb).toBe(2048)
    })

    test('applies defaults', () => {
      const config = {
        cachePath: '/var/cache',
      }

      const result = validateStaticAssetConfig(config)
      expect(result.maxCacheSizeMb).toBe(1024)
      expect(result.cdnEndpoints).toEqual([])
    })

    test('validates minimal config', () => {
      const config = {
        cachePath: '/tmp/cache',
      }

      const result = validateStaticAssetConfig(config)
      expect(result.cachePath).toBe('/tmp/cache')
    })

    test('rejects empty cache path', () => {
      const config = {
        cachePath: '',
      }

      expect(() => validateStaticAssetConfig(config)).toThrow()
    })

    test('rejects invalid port', () => {
      const config = {
        cachePath: './cache',
        listenPort: 80, // Below 1024
      }

      expect(() => validateStaticAssetConfig(config)).toThrow()
    })

    test('rejects invalid CDN endpoints', () => {
      const config = {
        cachePath: './cache',
        cdnEndpoints: ['not-a-url'],
      }

      expect(() => validateStaticAssetConfig(config)).toThrow()
    })
  })

  describe('validateAssetManifest', () => {
    test('validates valid manifest', () => {
      const manifest: AssetManifest = {
        version: '1.0.0',
        assets: [
          {
            path: '/icons/logo.png',
            hash: 'a'.repeat(64),
            size: 1024,
            mimeType: 'image/png',
          },
          {
            path: '/styles/main.css',
            hash: 'b'.repeat(64),
            size: 2048,
            mimeType: 'text/css',
          },
        ],
        updated: Date.now(),
      }

      const result = validateAssetManifest(manifest)
      expect(result.version).toBe('1.0.0')
      expect(result.assets.length).toBe(2)
    })

    test('validates empty assets array', () => {
      const manifest: AssetManifest = {
        version: '2.0.0',
        assets: [],
        updated: Date.now(),
      }

      const result = validateAssetManifest(manifest)
      expect(result.assets).toEqual([])
    })

    test('rejects invalid version format', () => {
      const manifest = {
        version: 'v1.0', // Invalid
        assets: [],
        updated: Date.now(),
      }

      expect(() => validateAssetManifest(manifest)).toThrow()
    })

    test('rejects invalid hash format', () => {
      const manifest = {
        version: '1.0.0',
        assets: [
          {
            path: '/test.txt',
            hash: 'not-a-valid-hash',
            size: 100,
            mimeType: 'text/plain',
          },
        ],
        updated: Date.now(),
      }

      expect(() => validateAssetManifest(manifest)).toThrow()
    })

    test('rejects zero size', () => {
      const manifest = {
        version: '1.0.0',
        assets: [
          {
            path: '/test.txt',
            hash: 'a'.repeat(64),
            size: 0,
            mimeType: 'text/plain',
          },
        ],
        updated: Date.now(),
      }

      expect(() => validateAssetManifest(manifest)).toThrow()
    })
  })
})

describe('Content Hashing', () => {
  function computeHash(data: Uint8Array): string {
    return createHash('sha256').update(data).digestHex()
  }

  function verifyHash(data: Uint8Array, expectedHash: string): boolean {
    return computeHash(data) === expectedHash
  }

  test('computes consistent hash', () => {
    const data = new TextEncoder().encode('Hello, World!')
    const hash1 = computeHash(data)
    const hash2 = computeHash(data)

    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(64)
  })

  test('different data produces different hash', () => {
    const data1 = new TextEncoder().encode('Hello')
    const data2 = new TextEncoder().encode('World')

    expect(computeHash(data1)).not.toBe(computeHash(data2))
  })

  test('verifies correct hash', () => {
    const data = new TextEncoder().encode('Test data')
    const hash = computeHash(data)

    expect(verifyHash(data, hash)).toBe(true)
  })

  test('rejects incorrect hash', () => {
    const data = new TextEncoder().encode('Test data')
    const wrongHash = 'f'.repeat(64)

    expect(verifyHash(data, wrongHash)).toBe(false)
  })
})

describe('MIME Type Detection', () => {
  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
  }

  function getMimeType(path: string): string {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    return MIME_TYPES[ext] ?? 'application/octet-stream'
  }

  test.each([
    ['/styles/main.css', 'text/css'],
    ['/scripts/app.js', 'application/javascript'],
    ['/data/config.json', 'application/json'],
    ['/images/logo.png', 'image/png'],
    ['/images/photo.jpg', 'image/jpeg'],
    ['/images/photo.jpeg', 'image/jpeg'],
    ['/images/animation.gif', 'image/gif'],
    ['/icons/icon.svg', 'image/svg+xml'],
    ['/fonts/font.woff2', 'font/woff2'],
    ['/index.html', 'text/html'],
    ['/readme.txt', 'text/plain'],
  ])('detects MIME type for %s', (path: string, expected: string) => {
    expect(getMimeType(path)).toBe(expected)
  })

  test('returns octet-stream for unknown extension', () => {
    expect(getMimeType('/file.unknown')).toBe('application/octet-stream')
  })

  test('handles uppercase extensions', () => {
    expect(getMimeType('/FILE.PNG')).toBe('image/png')
  })

  test('handles no extension', () => {
    expect(getMimeType('/Dockerfile')).toBe('application/octet-stream')
  })
})

describe('Cache Management', () => {
  interface CacheStats {
    hits: number
    misses: number
    bytesServed: number
    currentSizeBytes: number
    maxSizeBytes: number
    itemCount: number
  }

  function calculateCacheMetrics(stats: CacheStats) {
    const hitRate =
      stats.hits + stats.misses > 0
        ? stats.hits / (stats.hits + stats.misses)
        : 0
    const utilization =
      stats.maxSizeBytes > 0 ? stats.currentSizeBytes / stats.maxSizeBytes : 0

    return { hitRate, utilization }
  }

  function shouldEvict(stats: CacheStats, newItemSize: number): boolean {
    return stats.currentSizeBytes + newItemSize > stats.maxSizeBytes
  }

  test('calculates hit rate correctly', () => {
    const stats: CacheStats = {
      hits: 80,
      misses: 20,
      bytesServed: 1000000,
      currentSizeBytes: 500000000,
      maxSizeBytes: 1000000000,
      itemCount: 100,
    }

    const metrics = calculateCacheMetrics(stats)
    expect(metrics.hitRate).toBe(0.8)
    expect(metrics.utilization).toBe(0.5)
  })

  test('handles zero requests', () => {
    const stats: CacheStats = {
      hits: 0,
      misses: 0,
      bytesServed: 0,
      currentSizeBytes: 0,
      maxSizeBytes: 1000000000,
      itemCount: 0,
    }

    const metrics = calculateCacheMetrics(stats)
    expect(metrics.hitRate).toBe(0)
    expect(metrics.utilization).toBe(0)
  })

  test('detects when eviction needed', () => {
    const stats: CacheStats = {
      hits: 100,
      misses: 10,
      bytesServed: 1000000,
      currentSizeBytes: 900000000,
      maxSizeBytes: 1000000000,
      itemCount: 500,
    }

    expect(shouldEvict(stats, 50000000)).toBe(false) // 50MB fits
    expect(shouldEvict(stats, 150000000)).toBe(true) // 150MB doesn't fit
  })
})

describe('CDN Fallback', () => {
  function selectCdnEndpoint(
    endpoints: string[],
    failedEndpoints: Set<string>,
  ): string | null {
    for (const endpoint of endpoints) {
      if (!failedEndpoints.has(endpoint)) {
        return endpoint
      }
    }
    return null
  }

  test('selects first available endpoint', () => {
    const endpoints = ['https://cdn1.example.com', 'https://cdn2.example.com']
    const failed = new Set<string>()

    expect(selectCdnEndpoint(endpoints, failed)).toBe(
      'https://cdn1.example.com',
    )
  })

  test('skips failed endpoints', () => {
    const endpoints = ['https://cdn1.example.com', 'https://cdn2.example.com']
    const failed = new Set(['https://cdn1.example.com'])

    expect(selectCdnEndpoint(endpoints, failed)).toBe(
      'https://cdn2.example.com',
    )
  })

  test('returns null when all failed', () => {
    const endpoints = ['https://cdn1.example.com', 'https://cdn2.example.com']
    const failed = new Set(endpoints)

    expect(selectCdnEndpoint(endpoints, failed)).toBeNull()
  })

  test('returns null for empty endpoints', () => {
    const endpoints: string[] = []
    const failed = new Set<string>()

    expect(selectCdnEndpoint(endpoints, failed)).toBeNull()
  })
})

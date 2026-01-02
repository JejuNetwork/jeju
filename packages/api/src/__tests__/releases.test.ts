/**
 * Comprehensive tests for Release API Service
 *
 * Tests cover:
 * - ReleaseService initialization and configuration
 * - Fetching release index from DWS
 * - Fetching release manifests
 * - Getting latest releases by channel
 * - Caching behavior
 * - Error handling
 * - Concurrent request handling
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { ReleaseIndex, ReleaseManifest } from '@jejunetwork/types'
import {
  getReleaseService,
  initReleaseService,
  ReleaseService,
} from '../releases/core'

// Save original fetch
const originalFetch = globalThis.fetch

describe('ReleaseService', () => {
  let service: ReleaseService

  const mockManifest: ReleaseManifest = {
    app: 'test-app',
    version: '1.0.0',
    releasedAt: '2024-01-01T00:00:00Z',
    channel: 'stable',
    artifacts: [
      {
        platform: 'macos',
        arch: 'arm64',
        filename: 'test-app-1.0.0-arm64.dmg',
        cid: 'QmTestManifestCid1',
        size: 1024 * 1024 * 50,
        sha256: 'abc123',
      },
      {
        platform: 'chrome',
        filename: 'test-app-1.0.0-chrome.zip',
        cid: 'QmTestManifestCid2',
        size: 1024 * 512,
        sha256: 'def456',
      },
    ],
  }

  const mockIndex: ReleaseIndex = {
    app: 'test-app',
    latest: '1.0.0',
    latestBeta: '1.1.0-beta.1',
    latestNightly: '1.2.0-nightly.123',
    versions: [
      {
        version: '1.0.0',
        channel: 'stable',
        releasedAt: '2024-01-01T00:00:00Z',
        manifestCid: 'QmManifest100',
      },
      {
        version: '1.1.0-beta.1',
        channel: 'beta',
        releasedAt: '2024-01-15T00:00:00Z',
        manifestCid: 'QmManifestBeta',
      },
      {
        version: '1.2.0-nightly.123',
        channel: 'nightly',
        releasedAt: '2024-01-20T00:00:00Z',
        manifestCid: 'QmManifestNightly',
      },
      {
        version: '0.9.0',
        channel: 'stable',
        releasedAt: '2023-12-01T00:00:00Z',
        manifestCid: 'QmManifest090',
      },
    ],
  }

  beforeEach(() => {
    // Create fresh service with caching disabled for predictable tests
    service = new ReleaseService({
      dwsUrl: 'http://test-dws.local',
      cacheEnabled: false,
    })
  })

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch
    // Clear any singleton
    service.clearCache()
  })

  describe('initialization', () => {
    it('creates service with custom DWS URL', () => {
      const customService = new ReleaseService({
        dwsUrl: 'http://custom-dws.example.com',
      })
      expect(customService).toBeInstanceOf(ReleaseService)
    })

    it('creates service with default DWS URL when not provided', () => {
      const defaultService = new ReleaseService()
      expect(defaultService).toBeInstanceOf(ReleaseService)
    })

    it('respects cache configuration', () => {
      const cachedService = new ReleaseService({
        cacheEnabled: true,
        cacheTtlMs: 10000,
      })
      expect(cachedService).toBeInstanceOf(ReleaseService)
    })
  })

  describe('getIndex', () => {
    it('fetches release index from DWS', async () => {
      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/storage/releases/test-app/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const index = await service.getIndex('test-app')
      expect(index.app).toBe('test-app')
      expect(index.latest).toBe('1.0.0')
      expect(index.versions.length).toBe(4)
    })

    it('returns empty index for non-existent app', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Not found', { status: 404 })
      })

      const index = await service.getIndex('unknown-app')
      expect(index.app).toBe('unknown-app')
      expect(index.latest).toBe('0.0.0')
      expect(index.versions).toEqual([])
    })

    it('throws on server error', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Internal Server Error', { status: 500 })
      })

      await expect(service.getIndex('test-app')).rejects.toThrow(
        'Failed to fetch release index',
      )
    })
  })

  describe('getManifest', () => {
    it('fetches manifest for specific version', async () => {
      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/storage/releases/test-app/1.0.0/manifest.json')) {
          return new Response(JSON.stringify(mockManifest), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const manifest = await service.getManifest('test-app', '1.0.0')
      expect(manifest.app).toBe('test-app')
      expect(manifest.version).toBe('1.0.0')
      expect(manifest.artifacts.length).toBe(2)
    })

    it('throws for non-existent version', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Not found', { status: 404 })
      })

      await expect(service.getManifest('test-app', '99.99.99')).rejects.toThrow(
        'not found',
      )
    })

    it('validates manifest schema', async () => {
      const invalidManifest = { app: 'test', version: 123 } // version should be string

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(invalidManifest), { status: 200 })
      })

      await expect(service.getManifest('test-app', '1.0.0')).rejects.toThrow()
    })
  })

  describe('getLatest', () => {
    it('fetches latest stable release', async () => {
      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/storage/releases/test-app/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        if (url.includes('/storage/releases/test-app/1.0.0/manifest.json')) {
          return new Response(JSON.stringify(mockManifest), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const manifest = await service.getLatest('test-app', 'stable')
      expect(manifest.app).toBe('test-app')
      expect(manifest.version).toBe('1.0.0')
      expect(manifest.channel).toBe('stable')
    })

    it('fetches latest beta release', async () => {
      const betaManifest = {
        ...mockManifest,
        version: '1.1.0-beta.1',
        channel: 'beta' as const,
      }

      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/storage/releases/test-app/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        if (
          url.includes('/storage/releases/test-app/1.1.0-beta.1/manifest.json')
        ) {
          return new Response(JSON.stringify(betaManifest), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const manifest = await service.getLatest('test-app', 'beta')
      expect(manifest.version).toBe('1.1.0-beta.1')
    })

    it('fetches latest nightly release', async () => {
      const nightlyManifest = {
        ...mockManifest,
        version: '1.2.0-nightly.123',
        channel: 'nightly' as const,
      }

      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/storage/releases/test-app/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        if (
          url.includes(
            '/storage/releases/test-app/1.2.0-nightly.123/manifest.json',
          )
        ) {
          return new Response(JSON.stringify(nightlyManifest), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const manifest = await service.getLatest('test-app', 'nightly')
      expect(manifest.version).toBe('1.2.0-nightly.123')
    })

    it('throws when no releases exist', async () => {
      const emptyIndex = {
        app: 'new-app',
        latest: '0.0.0',
        versions: [],
      }

      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/storage/releases/new-app/index.json')) {
          return new Response(JSON.stringify(emptyIndex), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      await expect(service.getLatest('new-app')).rejects.toThrow(
        'No stable releases available for new-app',
      )
    })

    it('falls back to stable when beta not available', async () => {
      const indexNoBeta = {
        ...mockIndex,
        latestBeta: undefined,
      }

      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/storage/releases/test-app/index.json')) {
          return new Response(JSON.stringify(indexNoBeta), { status: 200 })
        }
        if (url.includes('/storage/releases/test-app/1.0.0/manifest.json')) {
          return new Response(JSON.stringify(mockManifest), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const manifest = await service.getLatest('test-app', 'beta')
      expect(manifest.version).toBe('1.0.0')
    })
  })

  describe('getDownloadUrl', () => {
    it('generates correct download URL', () => {
      const artifact = mockManifest.artifacts[0]
      const url = service.getDownloadUrl(artifact)

      expect(url).toContain('http://test-dws.local')
      expect(url).toContain('/storage/download/')
      expect(url).toContain(artifact.cid)
      expect(url).toContain('filename=')
      expect(url).toContain(encodeURIComponent(artifact.filename))
    })

    it('properly encodes filenames with special characters', () => {
      const artifact = {
        ...mockManifest.artifacts[0],
        filename: 'test app (1.0.0) [special].dmg',
      }
      const url = service.getDownloadUrl(artifact)

      expect(url).toContain(encodeURIComponent(artifact.filename))
      // URL should be properly encoded - no raw spaces
      expect(url).not.toContain(' ')
      // Spaces are encoded as %20
      expect(url).toContain('%20')
      // Brackets are encoded (parentheses are allowed in URIs and not encoded by encodeURIComponent)
      expect(url).toContain('%5B') // encoded [
      expect(url).toContain('%5D') // encoded ]
    })
  })

  describe('caching', () => {
    it('caches index results when enabled', async () => {
      const cachedService = new ReleaseService({
        dwsUrl: 'http://test-dws.local',
        cacheEnabled: true,
        cacheTtlMs: 60000,
      })

      let fetchCount = 0
      globalThis.fetch = mock(async (url: string) => {
        fetchCount++
        if (url.includes('/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      // First call should fetch
      await cachedService.getIndex('test-app')
      expect(fetchCount).toBe(1)

      // Second call should use cache
      await cachedService.getIndex('test-app')
      expect(fetchCount).toBe(1)

      // Different app should fetch again
      await cachedService.getIndex('other-app')
      expect(fetchCount).toBe(2)

      cachedService.clearCache()
    })

    it('clears cache for specific app', async () => {
      const cachedService = new ReleaseService({
        dwsUrl: 'http://test-dws.local',
        cacheEnabled: true,
        cacheTtlMs: 60000,
      })

      let fetchCount = 0
      globalThis.fetch = mock(async (url: string) => {
        fetchCount++
        if (url.includes('/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      await cachedService.getIndex('test-app')
      await cachedService.getIndex('other-app')
      expect(fetchCount).toBe(2)

      // Clear only test-app cache
      cachedService.clearCache('test-app')

      // test-app should refetch
      await cachedService.getIndex('test-app')
      expect(fetchCount).toBe(3)

      // other-app should still use cache
      await cachedService.getIndex('other-app')
      expect(fetchCount).toBe(3)

      cachedService.clearCache()
    })

    it('clears all cache', async () => {
      const cachedService = new ReleaseService({
        dwsUrl: 'http://test-dws.local',
        cacheEnabled: true,
        cacheTtlMs: 60000,
      })

      let fetchCount = 0
      globalThis.fetch = mock(async (url: string) => {
        fetchCount++
        if (url.includes('/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      await cachedService.getIndex('test-app')
      await cachedService.getIndex('other-app')
      expect(fetchCount).toBe(2)

      cachedService.clearCache()

      await cachedService.getIndex('test-app')
      await cachedService.getIndex('other-app')
      expect(fetchCount).toBe(4)

      cachedService.clearCache()
    })
  })

  describe('error handling', () => {
    it('handles JSON parse errors', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('not json', { status: 200 })
      })

      await expect(service.getIndex('test-app')).rejects.toThrow()
    })

    it('handles network errors', async () => {
      globalThis.fetch = mock(async () => {
        throw new Error('Network error')
      })

      await expect(service.getIndex('test-app')).rejects.toThrow(
        'Network error',
      )
    })

    it('handles empty response body', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('', { status: 200 })
      })

      await expect(service.getIndex('test-app')).rejects.toThrow()
    })

    it('handles 503 service unavailable', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Service Unavailable', { status: 503 })
      })

      await expect(service.getIndex('test-app')).rejects.toThrow()
    })

    it('handles malformed manifest missing required fields', async () => {
      const malformedManifest = {
        app: 'test-app',
        // Missing: version, releasedAt, channel, artifacts
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(malformedManifest), { status: 200 })
      })

      await expect(service.getManifest('test-app', '1.0.0')).rejects.toThrow()
    })

    it('handles null JSON response', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('null', { status: 200 })
      })

      await expect(service.getIndex('test-app')).rejects.toThrow()
    })
  })

  describe('concurrent requests', () => {
    it('handles multiple concurrent requests', async () => {
      let fetchCount = 0

      globalThis.fetch = mock(async (url: string) => {
        fetchCount++
        await new Promise((resolve) => setTimeout(resolve, 10))

        if (url.includes('/index.json')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        if (url.includes('/manifest.json')) {
          return new Response(JSON.stringify(mockManifest), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const results = await Promise.all([
        service.getIndex('app1'),
        service.getIndex('app2'),
        service.getIndex('app3'),
      ])

      expect(results.length).toBe(3)
      expect(fetchCount).toBe(3)
    })

    it('handles mix of success and failure in concurrent requests', async () => {
      globalThis.fetch = mock(async (url: string) => {
        await new Promise((resolve) => setTimeout(resolve, 5))

        if (url.includes('/app1/')) {
          return new Response(JSON.stringify(mockIndex), { status: 200 })
        }
        if (url.includes('/app2/')) {
          return new Response('Not found', { status: 404 })
        }
        if (url.includes('/app3/')) {
          throw new Error('Network failure')
        }
        return new Response('Not found', { status: 404 })
      })

      const results = await Promise.allSettled([
        service.getIndex('app1'),
        service.getIndex('app2'),
        service.getIndex('app3'),
      ])

      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled') // 404 returns empty index
      expect(results[2].status).toBe('rejected')
    })
  })

  describe('edge cases', () => {
    it('handles manifest with empty artifacts array', async () => {
      const manifestNoArtifacts: ReleaseManifest = {
        app: 'test-app',
        version: '1.0.0',
        releasedAt: '2024-01-01T00:00:00Z',
        channel: 'stable',
        artifacts: [],
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(manifestNoArtifacts), {
          status: 200,
        })
      })

      const manifest = await service.getManifest('test-app', '1.0.0')
      expect(manifest.artifacts).toEqual([])
    })

    it('handles app names with special characters', async () => {
      globalThis.fetch = mock(async (url: string) => {
        // Verify URL is properly encoded
        expect(url).toContain('my-special_app')
        return new Response(
          JSON.stringify({ ...mockIndex, app: 'my-special_app' }),
          { status: 200 },
        )
      })

      const index = await service.getIndex('my-special_app')
      expect(index.app).toBe('my-special_app')
    })

    it('handles version strings with prerelease tags', async () => {
      const prereleaseIndex: ReleaseIndex = {
        app: 'test-app',
        latest: '2.0.0-alpha.1+build.123',
        versions: [
          {
            version: '2.0.0-alpha.1+build.123',
            channel: 'nightly',
            releasedAt: '2024-01-01T00:00:00Z',
            manifestCid: 'QmTest',
          },
        ],
      }

      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/index.json')) {
          return new Response(JSON.stringify(prereleaseIndex), { status: 200 })
        }
        if (url.includes('/2.0.0-alpha.1+build.123/')) {
          return new Response(
            JSON.stringify({
              ...mockManifest,
              version: '2.0.0-alpha.1+build.123',
            }),
            { status: 200 },
          )
        }
        return new Response('Not found', { status: 404 })
      })

      const manifest = await service.getLatest('test-app')
      expect(manifest.version).toBe('2.0.0-alpha.1+build.123')
    })

    it('handles index with only old versions (no latest set)', async () => {
      const indexNoLatest: ReleaseIndex = {
        app: 'test-app',
        latest: '0.0.0',
        versions: [],
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(indexNoLatest), { status: 200 })
      })

      await expect(service.getLatest('test-app')).rejects.toThrow(
        'No stable releases',
      )
    })

    it('falls back to stable when nightly not available', async () => {
      const indexNoNightly: ReleaseIndex = {
        ...mockIndex,
        latestNightly: undefined,
      }

      globalThis.fetch = mock(async (url: string) => {
        if (url.includes('/index.json')) {
          return new Response(JSON.stringify(indexNoNightly), { status: 200 })
        }
        if (url.includes('/1.0.0/manifest.json')) {
          return new Response(JSON.stringify(mockManifest), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      })

      const manifest = await service.getLatest('test-app', 'nightly')
      expect(manifest.version).toBe('1.0.0')
    })
  })
})

describe('getReleaseService', () => {
  it('returns singleton instance', () => {
    const service1 = getReleaseService()
    const service2 = getReleaseService()
    expect(service1).toBe(service2)
  })
})

describe('initReleaseService', () => {
  it('initializes singleton with config', () => {
    initReleaseService({ dwsUrl: 'http://custom.local' })
    const service = getReleaseService()
    expect(service).toBeInstanceOf(ReleaseService)
  })
})

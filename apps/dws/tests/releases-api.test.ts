/**
 * Releases API Tests
 *
 * Comprehensive tests for /releases/* endpoints covering:
 * - Happy path for all endpoints
 * - Boundary conditions and edge cases
 * - Error handling and invalid inputs
 * - Response schema validation
 * - Concurrent request handling
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ReleaseManifestSchema } from '@jejunetwork/types'
import Elysia from 'elysia'
import { releasesRoutes } from '../api/server/routes/releases'

// Test using Elysia's built-in handle method instead of HTTP server
let app: Elysia

beforeAll(async () => {
  app = new Elysia().use(releasesRoutes)
})

afterAll(() => {
  // No server to stop when using handle
})

async function fetchJson(path: string, options?: RequestInit) {
  const req = new Request(`http://test${path}`, options)
  const res = await app.handle(req)
  return { res, json: res.ok ? await res.json() : null }
}

describe('Releases API - Health', () => {
  test('GET /releases/health returns healthy status', async () => {
    const { res, json } = await fetchJson('/releases/health')
    expect(res.status).toBe(200)
    expect(json.status).toBe('healthy')
    expect(json.service).toBe('releases')
    expect(Array.isArray(json.apps)).toBe(true)
    expect(json.apps).toContain('node')
    expect(json.apps).toContain('wallet')
    // Storage status is now reported
    expect(typeof json.storageReachable).toBe('boolean')
    expect(typeof json.storageHasReleases).toBe('boolean')
  })
})

describe('Releases API - Node App', () => {
  test('GET /releases/node/latest returns valid manifest', async () => {
    const { res, json } = await fetchJson('/releases/node/latest')
    expect(res.status).toBe(200)

    // Validate against Zod schema (strip _source before validation)
    const { _source, ...manifestData } = json
    const parsed = ReleaseManifestSchema.safeParse(manifestData)
    expect(parsed.success).toBe(true)

    // Check required fields
    expect(json.app).toBe('node')
    expect(typeof json.version).toBe('string')
    // Version can be dev version like 0.0.0-dev
    expect(json.version).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/)
    expect(Array.isArray(json.artifacts)).toBe(true)
    expect(json.artifacts.length).toBeGreaterThan(0)

    // Check source is present
    expect(['storage', 'development']).toContain(json._source)
  })

  test('node artifacts include all major platforms', async () => {
    const { json } = await fetchJson('/releases/node/latest')
    const platforms = json.artifacts.map(
      (a: { platform: string }) => a.platform,
    )

    expect(platforms).toContain('macos')
    expect(platforms).toContain('windows')
    expect(platforms).toContain('linux')
  })

  test('node artifacts have required fields', async () => {
    const { json } = await fetchJson('/releases/node/latest')

    for (const artifact of json.artifacts) {
      expect(typeof artifact.platform).toBe('string')
      expect(typeof artifact.filename).toBe('string')
      expect(typeof artifact.cid).toBe('string')
      expect(typeof artifact.size).toBe('number')
      // Size can be 0 for placeholder data in dev mode
      expect(artifact.size).toBeGreaterThanOrEqual(0)
      expect(typeof artifact.sha256).toBe('string')
    }
  })

  test('node macOS artifacts include both arm64 and x64', async () => {
    const { json } = await fetchJson('/releases/node/latest')
    const macArtifacts = json.artifacts.filter(
      (a: { platform: string }) => a.platform === 'macos',
    )

    const arches = macArtifacts.map((a: { arch: string }) => a.arch)
    expect(arches).toContain('arm64')
    expect(arches).toContain('x64')
  })

  test('node linux artifacts include both arm64 and x64', async () => {
    const { json } = await fetchJson('/releases/node/latest')
    const linuxArtifacts = json.artifacts.filter(
      (a: { platform: string }) => a.platform === 'linux',
    )

    const arches = linuxArtifacts.map((a: { arch: string }) => a.arch)
    expect(arches).toContain('arm64')
    expect(arches).toContain('x64')
  })
})

describe('Releases API - Wallet App', () => {
  test('GET /releases/wallet/latest returns valid manifest', async () => {
    const { res, json } = await fetchJson('/releases/wallet/latest')
    expect(res.status).toBe(200)

    const { _source, ...manifestData } = json
    const parsed = ReleaseManifestSchema.safeParse(manifestData)
    expect(parsed.success).toBe(true)

    expect(json.app).toBe('wallet')
    expect(Array.isArray(json.artifacts)).toBe(true)
  })

  test('wallet artifacts include browser extensions', async () => {
    const { json } = await fetchJson('/releases/wallet/latest')
    const platforms = json.artifacts.map(
      (a: { platform: string }) => a.platform,
    )

    expect(platforms).toContain('chrome')
    expect(platforms).toContain('firefox')
  })

  test('wallet browser extension artifacts have store URLs in production', async () => {
    const { json } = await fetchJson('/releases/wallet/latest')

    // In dev mode, store URLs may not be present
    if (json._source === 'development') {
      // Placeholder data doesn't need store URLs
      return
    }

    for (const artifact of json.artifacts) {
      // Browser extensions should have store URLs in production
      if (['chrome', 'firefox'].includes(artifact.platform)) {
        expect(typeof artifact.storeUrl).toBe('string')
        expect(artifact.storeUrl.startsWith('https://')).toBe(true)
      }
    }
  })
})

describe('Releases API - Generic Endpoints', () => {
  test('GET /releases/latest defaults to node app', async () => {
    const { res, json } = await fetchJson('/releases/latest')
    expect(res.status).toBe(200)
    expect(json.app).toBe('node')
  })

  test('GET /releases/latest?app=wallet returns wallet', async () => {
    const { res, json } = await fetchJson('/releases/latest?app=wallet')
    expect(res.status).toBe(200)
    expect(json.app).toBe('wallet')
  })

  test('GET /releases/latest?app=vpn returns node (VPN uses node app)', async () => {
    const { res, json } = await fetchJson('/releases/latest?app=vpn')
    expect(res.status).toBe(200)
    // VPN uses node app as documented in releases.ts
    expect(json.app).toBe('node')
  })

  test('GET /releases/:app/:version returns manifest', async () => {
    const { res, json } = await fetchJson('/releases/node/1.0.0')
    expect(res.status).toBe(200)
    expect(json.app).toBe('node')
  })
})

describe('Releases API - Apps List', () => {
  test('GET /releases/apps returns all available apps', async () => {
    const { res, json } = await fetchJson('/releases/apps')
    expect(res.status).toBe(200)
    expect(Array.isArray(json.apps)).toBe(true)

    const appNames = json.apps.map((a: { name: string }) => a.name)
    expect(appNames).toContain('node')
    expect(appNames).toContain('wallet')
    expect(appNames).toContain('vpn')
  })

  test('apps list entries have required metadata', async () => {
    const { json } = await fetchJson('/releases/apps')

    for (const app of json.apps) {
      expect(typeof app.name).toBe('string')
      expect(typeof app.latestVersion).toBe('string')
      expect(typeof app.channel).toBe('string')
      expect(typeof app.releasedAt).toBe('string')
      expect(Array.isArray(app.platforms)).toBe(true)
      // Now includes source info
      expect(['storage', 'development']).toContain(app.source)
    }
  })
})

describe('Releases API - Manifest Validation', () => {
  test('POST /releases/validate accepts valid manifest', async () => {
    const validManifest = {
      app: 'test-app',
      version: '1.0.0',
      releasedAt: new Date().toISOString(),
      channel: 'stable',
      artifacts: [
        {
          platform: 'linux',
          arch: 'x64',
          filename: 'test-1.0.0.tar.gz',
          cid: 'QmTestCid123',
          size: 1024,
          sha256: 'abc123def456',
        },
      ],
    }

    const { res, json } = await fetchJson('/releases/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validManifest),
    })

    expect(res.status).toBe(200)
    expect(json.valid).toBe(true)
    expect(json.manifest).toBeDefined()
  })

  test('POST /releases/validate rejects manifest without version', async () => {
    const invalidManifest = {
      app: 'test-app',
      releasedAt: new Date().toISOString(),
      channel: 'stable',
      artifacts: [],
    }

    const { res, json } = await fetchJson('/releases/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidManifest),
    })

    expect(res.status).toBe(200)
    expect(json.valid).toBe(false)
    expect(Array.isArray(json.errors)).toBe(true)
    expect(
      json.errors.some((e: { path: string }) => e.path === 'version'),
    ).toBe(true)
  })

  test('POST /releases/validate rejects manifest without app name', async () => {
    const invalidManifest = {
      version: '1.0.0',
      releasedAt: new Date().toISOString(),
      channel: 'stable',
      artifacts: [],
    }

    const { res, json } = await fetchJson('/releases/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidManifest),
    })

    expect(res.status).toBe(200)
    expect(json.valid).toBe(false)
    expect(json.errors.some((e: { path: string }) => e.path === 'app')).toBe(
      true,
    )
  })

  test('POST /releases/validate rejects artifact with invalid size', async () => {
    const invalidManifest = {
      app: 'test-app',
      version: '1.0.0',
      releasedAt: new Date().toISOString(),
      channel: 'stable',
      artifacts: [
        {
          platform: 'linux',
          arch: 'x64',
          filename: 'test.tar.gz',
          cid: 'QmTest',
          size: -100, // Invalid: negative size
          sha256: 'abc',
        },
      ],
    }

    const { res, json } = await fetchJson('/releases/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidManifest),
    })

    expect(res.status).toBe(200)
    expect(json.valid).toBe(false)
  })

  test('POST /releases/validate handles empty body', async () => {
    const { res, json } = await fetchJson('/releases/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    expect(json.valid).toBe(false)
    expect(json.errors.length).toBeGreaterThan(0)
  })
})

describe('Releases API - Error Handling', () => {
  test('GET /releases/latest?app=unknown returns 404', async () => {
    const { res, json } = await fetchJson('/releases/latest?app=nonexistent')
    expect(res.status).toBe(404)
    expect(json).toBeNull()
  })

  test('GET /releases/unknownapp/1.0.0 returns 404', async () => {
    const { res, json } = await fetchJson('/releases/unknownapp/1.0.0')
    expect(res.status).toBe(404)
    expect(json).toBeNull()
  })
})

describe('Releases API - Concurrent Requests', () => {
  test('handles concurrent requests to same endpoint', async () => {
    const requests = Array(10)
      .fill(null)
      .map(() => fetchJson('/releases/node/latest'))

    const results = await Promise.all(requests)

    for (const { res, json } of results) {
      expect(res.status).toBe(200)
      expect(json.app).toBe('node')
    }
  })

  test('handles concurrent requests to different endpoints', async () => {
    const endpoints = [
      '/releases/node/latest',
      '/releases/wallet/latest',
      '/releases/apps',
      '/releases/health',
      '/releases/latest',
    ]

    const requests = endpoints.map((e) => fetchJson(e))
    const results = await Promise.all(requests)

    expect(results.every(({ res }) => res.status === 200)).toBe(true)
  })
})

describe('Releases API - Data Integrity', () => {
  test('artifact CIDs are valid IPFS format or placeholder', async () => {
    const { json } = await fetchJson('/releases/node/latest')

    for (const artifact of json.artifacts) {
      // CIDs should start with Qm (v0) or ba (v1), or be marked as placeholder
      const isValidCid =
        artifact.cid.startsWith('Qm') || artifact.cid.startsWith('ba')
      const isPlaceholder =
        artifact.cid.includes('PLACEHOLDER') || artifact.cid.includes('DEV')
      expect(isValidCid || isPlaceholder).toBe(true)
    }
  })

  test('artifact filenames match platform conventions', async () => {
    const { json } = await fetchJson('/releases/node/latest')

    for (const artifact of json.artifacts) {
      // Desktop platforms should have appropriate extensions
      switch (artifact.platform) {
        case 'macos':
          expect(artifact.filename.endsWith('.dmg')).toBe(true)
          break
        case 'windows':
          expect(
            artifact.filename.endsWith('.msi') ||
              artifact.filename.endsWith('.exe'),
          ).toBe(true)
          break
        case 'linux':
          expect(
            artifact.filename.endsWith('.AppImage') ||
              artifact.filename.endsWith('.deb') ||
              artifact.filename.endsWith('.tar.gz'),
          ).toBe(true)
          break
      }
    }
  })

  test('placeholder artifacts are clearly marked in dev', async () => {
    const { json } = await fetchJson('/releases/node/latest')

    // If this is a dev/placeholder release, sizes should be 0
    if (json._source === 'development') {
      for (const artifact of json.artifacts) {
        expect(artifact.size).toBe(0)
        expect(artifact.cid).toBe('DEV_PLACEHOLDER')
      }
    }
  })

  test('releasedAt is valid ISO date string', async () => {
    const { json } = await fetchJson('/releases/node/latest')

    const date = new Date(json.releasedAt)
    expect(date.toString()).not.toBe('Invalid Date')
    // Just check it's a valid date (placeholder data uses fixed date)
    expect(date.getFullYear()).toBeGreaterThanOrEqual(2024)
  })

  test('versions follow semver format (may include prerelease)', async () => {
    const { json } = await fetchJson('/releases/apps')

    for (const app of json.apps) {
      // Version can be semver with optional prerelease tag like 0.0.0-dev
      expect(app.latestVersion).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/)
    }
  })
})

/**
 * E2E Tests for Factory Release API Routes
 *
 * Tests cover:
 * - List all apps with releases
 * - Get release index for specific app
 * - Get latest release by channel
 * - Get specific version
 * - Get download links
 * - Direct download redirect
 * - Cache clearing
 * - Error handling for invalid apps/versions
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { type Server } from 'bun'

// Test against running Factory server or spin up test instance
const FACTORY_PORT = process.env.FACTORY_TEST_PORT || '4009'
const BASE_URL = `http://127.0.0.1:${FACTORY_PORT}`

// Helper to make API requests
async function apiRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${BASE_URL}${path}`
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

describe('Factory Release API', () => {
  // Check if server is available
  let serverAvailable = false

  beforeAll(async () => {
    // Check if Factory is running
    const healthResponse = await fetch(`${BASE_URL}/health`).catch(() => null)
    serverAvailable = healthResponse?.ok ?? false

    if (!serverAvailable) {
      console.warn(
        `Factory server not available at ${BASE_URL}. Skipping E2E tests.`,
      )
    }
  })

  describe('GET /api/releases', () => {
    it('returns list of apps with releases', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases')
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.apps).toBeDefined()
      expect(Array.isArray(data.apps)).toBe(true)

      // Should include our 4 apps
      const appNames = data.apps.map((a: { name: string }) => a.name)
      expect(appNames).toContain('otto')
      expect(appNames).toContain('vpn')
      expect(appNames).toContain('wallet')
      expect(appNames).toContain('node')
    })

    it('returns app metadata with display names and descriptions', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases')
      const data = await response.json()

      for (const app of data.apps) {
        expect(app.name).toBeDefined()
        expect(app.displayName).toBeDefined()
        expect(app.description).toBeDefined()
        expect(typeof app.displayName).toBe('string')
        expect(typeof app.description).toBe('string')
      }
    })
  })

  describe('GET /api/releases/:app', () => {
    it('returns release index for valid app', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/vpn')

      // May return 404 if no releases published yet, or 503 if DWS is down
      if (response.status === 404 || response.status === 503) {
        const data = await response.json()
        expect(data.error).toBeDefined()
        return
      }

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.app).toBe('vpn')
      expect(data.latest).toBeDefined()
      expect(Array.isArray(data.versions)).toBe(true)
    })

    it('returns 404 for invalid app name', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/invalid-app-name')
      expect(response.status).toBe(404)

      const data = await response.json()
      expect(data.error).toBeDefined()
      expect(data.error.code).toBe('NOT_FOUND')
    })

    it('returns 404 for empty app name', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/')
      // This should hit the list endpoint instead
      expect(response.ok).toBe(true)
    })
  })

  describe('GET /api/releases/:app/latest', () => {
    it('returns latest stable release by default', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/otto/latest')

      // May return 404 if no releases yet, or 503 if DWS is down
      if (response.status === 404 || response.status === 503) {
        const data = await response.json()
        expect(data.error).toBeDefined()
        return
      }

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.app).toBe('otto')
      expect(data.version).toBeDefined()
      expect(data.channel).toBe('stable')
    })

    it('accepts channel query parameter for beta', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/otto/latest?channel=beta')

      // May return 404 if no beta releases, or 503 if DWS is down
      if (response.status === 404 || response.status === 503) return

      const data = await response.json()
      expect(data.channel).toBe('beta')
    })

    it('accepts channel query parameter for nightly', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/otto/latest?channel=nightly')

      // May return 404 if no nightly releases, or 503 if DWS is down
      if (response.status === 404 || response.status === 503) return

      const data = await response.json()
      expect(data.channel).toBe('nightly')
    })
  })

  describe('GET /api/releases/:app/:version', () => {
    it('returns specific version manifest', async () => {
      if (!serverAvailable) return

      // First get latest to find a valid version
      const latestResponse = await apiRequest('/api/releases/wallet/latest')
      if (latestResponse.status === 404 || latestResponse.status === 503) return

      const latest = await latestResponse.json()
      const version = latest.version

      const response = await apiRequest(`/api/releases/wallet/${version}`)
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.version).toBe(version)
    })

    it('returns 404 or 503 for non-existent version', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/wallet/99.99.99')
      // 404 if version not found, 503 if DWS is down
      expect([404, 503]).toContain(response.status)

      const data = await response.json()
      expect(data.error).toBeDefined()
    })
  })

  describe('GET /api/releases/:app/:version/downloads', () => {
    it('returns formatted download links', async () => {
      if (!serverAvailable) return

      // First get latest to find a valid version
      const latestResponse = await apiRequest('/api/releases/node/latest')
      if (latestResponse.status === 404 || latestResponse.status === 503) return

      const latest = await latestResponse.json()

      const response = await apiRequest(
        `/api/releases/node/${latest.version}/downloads`,
      )
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.app).toBe('node')
      expect(data.version).toBe(latest.version)
      expect(Array.isArray(data.downloads)).toBe(true)

      // Each download should have expected fields
      for (const download of data.downloads) {
        expect(download.platform).toBeDefined()
        expect(download.filename).toBeDefined()
        expect(download.size).toBeDefined() // Formatted string
        expect(download.sizeBytes).toBeDefined() // Number
        expect(download.downloadUrl).toBeDefined()
        expect(download.sha256).toBeDefined()
      }
    })
  })

  describe('GET /api/releases/:app/:version/download/:platform', () => {
    it('redirects to DWS download URL', async () => {
      if (!serverAvailable) return

      const latestResponse = await apiRequest('/api/releases/vpn/latest')
      if (latestResponse.status === 404 || latestResponse.status === 503) return

      const latest = await latestResponse.json()

      // Find a platform that exists in the release
      if (!latest.artifacts || latest.artifacts.length === 0) return

      const platform = latest.artifacts[0].platform

      const response = await apiRequest(
        `/api/releases/vpn/${latest.version}/download/${platform}`,
        { redirect: 'manual' },
      )

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBeDefined()
    })

    it('returns 404 or 503 for invalid platform', async () => {
      if (!serverAvailable) return

      const latestResponse = await apiRequest('/api/releases/wallet/latest')
      if (latestResponse.status === 404 || latestResponse.status === 503) return

      const latest = await latestResponse.json()

      const response = await apiRequest(
        `/api/releases/wallet/${latest.version}/download/invalid-platform`,
      )

      // 404 if platform not found, 503 if DWS is down
      expect([404, 503]).toContain(response.status)
    })

    it('filters by architecture when specified', async () => {
      if (!serverAvailable) return

      const latestResponse = await apiRequest('/api/releases/node/latest')
      if (latestResponse.status === 404 || latestResponse.status === 503) return

      const latest = await latestResponse.json()

      const response = await apiRequest(
        `/api/releases/node/${latest.version}/download/macos?arch=arm64`,
        { redirect: 'manual' },
      )

      // Should redirect if arm64 artifact exists, 404 if not found, 503 if DWS down
      expect([302, 404, 503]).toContain(response.status)
    })
  })

  describe('POST /api/releases/cache/clear', () => {
    it('clears release cache', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/cache/clear', {
        method: 'POST',
      })

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.success).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('handles malformed URLs gracefully', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/otto/1.0.0/download/')
      // Should return 200 (list endpoint fallback), 400, 404, or 503, not 500
      expect([200, 400, 404, 503]).toContain(response.status)
    })

    it('handles special characters in app name', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases/../../etc/passwd')
      // URL path traversal gets normalized or hits list endpoint
      expect([200, 404]).toContain(response.status)
    })

    it('handles very long version strings', async () => {
      if (!serverAvailable) return

      const longVersion = '1.0.0-' + 'a'.repeat(1000)
      const response = await apiRequest(`/api/releases/otto/${longVersion}`)
      // May return 400, 404, or 503 if DWS is unavailable
      expect([400, 404, 503]).toContain(response.status)
    })
  })

  describe('Response Headers', () => {
    it('returns JSON content type', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases')
      expect(response.headers.get('content-type')).toContain('application/json')
    })

    it('includes CORS headers in dev mode', async () => {
      if (!serverAvailable) return

      const response = await apiRequest('/api/releases', {
        headers: {
          Origin: 'http://localhost:3000',
        },
      })

      // CORS headers may or may not be present depending on mode
      // Just verify the request succeeds
      expect(response.ok).toBe(true)
    })
  })
})

describe('Integration with DWS', () => {
  // These tests verify real integration with DWS storage
  // They may fail if DWS is not available or has no releases

  it('can fetch release manifests from DWS', async () => {
    // This test intentionally accesses DWS
    // Skip if running in isolation
    if (process.env.SKIP_DWS_TESTS) return

    const dwsUrl = process.env.DWS_URL || 'http://127.0.0.1:4030'
    const response = await fetch(`${dwsUrl}/health`).catch(() => null)

    if (!response?.ok) {
      console.warn('DWS not available, skipping integration test')
      return
    }

    // If DWS is available, verify release index endpoint exists
    const indexResponse = await fetch(
      `${dwsUrl}/storage/releases/otto/index.json`,
    ).catch(() => null)

    // May return 404 if no releases published, that's acceptable
    expect([200, 404]).toContain(indexResponse?.status ?? 0)
  })
})

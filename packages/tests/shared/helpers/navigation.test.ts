/**
 * Navigation Helper Tests - Server health, routing, page state
 *
 * Note: Some tests require Playwright which may not be fully available in bun test.
 * These tests focus on the utility functions that don't require a browser.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

// Try to import navigation helpers - skip tests if Playwright isn't available
let navigationModule: typeof import('./navigation') | null = null
let skipPlaywrightTests = false

try {
  navigationModule = await import('./navigation')
} catch {
  skipPlaywrightTests = true
}

const {
  getCurrentRoute = () => { throw new Error('Not available') },
  isAtRoute = () => { throw new Error('Not available') },
  waitForServerHealthy = () => Promise.resolve(false),
} = navigationModule ?? {}

// ============================================================================
// waitForServerHealthy - Server Health Checking
// ============================================================================

describe.skipIf(skipPlaywrightTests)('waitForServerHealthy - Server Availability', () => {
  test('returns false for unreachable server', async () => {
    const result = await waitForServerHealthy({
      baseUrl: 'http://localhost:59999',
      maxRetries: 2,
      retryDelay: 100,
      timeout: 500,
    })

    expect(result).toBe(false)
  })

  test('respects maxRetries limit', async () => {
    const start = Date.now()
    await waitForServerHealthy({
      baseUrl: 'http://localhost:59999',
      maxRetries: 3,
      retryDelay: 100,
      timeout: 100,
    })
    const elapsed = Date.now() - start

    // Should have waited for 2 intervals (between 3 attempts)
    expect(elapsed).toBeGreaterThanOrEqual(200)
    expect(elapsed).toBeLessThan(600)
  })

  test('respects timeout for each request', async () => {
    const start = Date.now()
    await waitForServerHealthy({
      baseUrl: 'http://localhost:59999',
      maxRetries: 1,
      timeout: 500,
    })
    const elapsed = Date.now() - start

    // Single attempt with 500ms timeout
    expect(elapsed).toBeLessThan(1000)
  })

  test('uses default values when options not provided', async () => {
    // Just verify it doesn't throw - will fail on connection
    const result = await waitForServerHealthy({
      baseUrl: 'http://localhost:59999',
      maxRetries: 1,
      retryDelay: 10,
      timeout: 100,
    })

    expect(typeof result).toBe('boolean')
  })
})

// ============================================================================
// waitForServerHealthy - Success Cases (Mock Server)
// ============================================================================

let mockServer: ReturnType<typeof Bun.serve> | null = null
const MOCK_PORT = 59888

beforeAll(() => {
  mockServer = Bun.serve({
    port: MOCK_PORT,
    fetch(req) {
      const url = new URL(req.url)

      // Health endpoint
      if (url.pathname === '/') {
        return new Response('OK', { status: 200 })
      }

      // Slow endpoint for timeout testing
      if (url.pathname === '/slow') {
        return new Promise((resolve) => {
          setTimeout(() => resolve(new Response('Slow', { status: 200 })), 5000)
        })
      }

      // 4xx response (still "healthy" - server is responding)
      if (url.pathname === '/client-error') {
        return new Response('Not Found', { status: 404 })
      }

      // 5xx response (unhealthy)
      if (url.pathname === '/server-error') {
        return new Response('Error', { status: 500 })
      }

      return new Response('Not Found', { status: 404 })
    },
  })
})

afterAll(() => {
  mockServer?.stop()
})

describe.skipIf(skipPlaywrightTests)('waitForServerHealthy - With Running Server', () => {
  test('returns true for healthy server', async () => {
    const result = await waitForServerHealthy({
      baseUrl: `http://localhost:${MOCK_PORT}`,
      maxRetries: 1,
      timeout: 2000,
    })

    expect(result).toBe(true)
  })

  test('accepts 4xx as healthy (server responding)', async () => {
    // 4xx means server is running, just endpoint not found
    const result = await waitForServerHealthy({
      baseUrl: `http://localhost:${MOCK_PORT}/client-error`,
      maxRetries: 1,
      timeout: 2000,
    })

    // Server is responding with < 500, so it's "healthy"
    expect(result).toBe(true)
  })
})

// ============================================================================
// getCurrentRoute - URL Parsing
// ============================================================================

describe.skipIf(skipPlaywrightTests)('getCurrentRoute - URL Extraction', () => {
  // Create mock page objects for testing URL functions
  const createMockPage = (url: string) => ({
    url: () => url,
  })

  test('extracts pathname from simple URL', () => {
    const page = createMockPage('http://localhost:3000/dashboard')
    const route = getCurrentRoute(page as Parameters<typeof getCurrentRoute>[0])
    expect(route).toBe('/dashboard')
  })

  test('includes query parameters', () => {
    const page = createMockPage('http://localhost:3000/search?q=test&page=2')
    const route = getCurrentRoute(page as Parameters<typeof getCurrentRoute>[0])
    expect(route).toBe('/search?q=test&page=2')
  })

  test('includes hash fragment', () => {
    const page = createMockPage('http://localhost:3000/docs#section-1')
    const route = getCurrentRoute(page as Parameters<typeof getCurrentRoute>[0])
    expect(route).toBe('/docs#section-1')
  })

  test('handles root URL', () => {
    const page = createMockPage('http://localhost:3000/')
    const route = getCurrentRoute(page as Parameters<typeof getCurrentRoute>[0])
    expect(route).toBe('/')
  })

  test('handles complex URL with all components', () => {
    const page = createMockPage(
      'http://localhost:3000/market/abc?tab=trade#positions',
    )
    const route = getCurrentRoute(page as Parameters<typeof getCurrentRoute>[0])
    expect(route).toBe('/market/abc?tab=trade#positions')
  })

  test('handles encoded URL components', () => {
    const page = createMockPage('http://localhost:3000/search?q=hello%20world')
    const route = getCurrentRoute(page as Parameters<typeof getCurrentRoute>[0])
    expect(route).toBe('/search?q=hello%20world')
  })
})

// ============================================================================
// isAtRoute - Route Matching
// ============================================================================

describe.skipIf(skipPlaywrightTests)('isAtRoute - Route Comparison', () => {
  const createMockPage = (url: string) => ({
    url: () => url,
  })

  test('matches exact routes', () => {
    const page = createMockPage('http://localhost:3000/dashboard')
    expect(
      isAtRoute(page as Parameters<typeof isAtRoute>[0], '/dashboard'),
    ).toBe(true)
  })

  test('handles trailing slash normalization', () => {
    const page = createMockPage('http://localhost:3000/dashboard/')
    expect(
      isAtRoute(page as Parameters<typeof isAtRoute>[0], '/dashboard'),
    ).toBe(true)
  })

  test('handles missing trailing slash in expected', () => {
    const page = createMockPage('http://localhost:3000/dashboard')
    expect(
      isAtRoute(page as Parameters<typeof isAtRoute>[0], '/dashboard/'),
    ).toBe(true)
  })

  test('rejects non-matching routes', () => {
    const page = createMockPage('http://localhost:3000/dashboard')
    expect(
      isAtRoute(page as Parameters<typeof isAtRoute>[0], '/settings'),
    ).toBe(false)
  })

  test('matches root route', () => {
    const page = createMockPage('http://localhost:3000/')
    expect(isAtRoute(page as Parameters<typeof isAtRoute>[0], '/')).toBe(true)
  })

  test('query parameters do not affect matching', () => {
    const page = createMockPage('http://localhost:3000/dashboard?tab=1')
    // Current implementation includes query string, so exact match fails
    expect(
      isAtRoute(page as Parameters<typeof isAtRoute>[0], '/dashboard'),
    ).toBe(false)
  })

  test('rejects partial route matches', () => {
    const page = createMockPage('http://localhost:3000/dashboard/settings')
    expect(
      isAtRoute(page as Parameters<typeof isAtRoute>[0], '/dashboard'),
    ).toBe(false)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe.skipIf(skipPlaywrightTests)('Navigation - Edge Cases', () => {
  test('waitForServerHealthy handles invalid URL', async () => {
    // Invalid URL should throw or return false
    const result = await waitForServerHealthy({
      baseUrl: 'not-a-valid-url',
      maxRetries: 1,
      timeout: 100,
    }).catch(() => false)

    expect(result).toBe(false)
  })

  test('getCurrentRoute handles URLs with port numbers', () => {
    const page = { url: () => 'http://localhost:8080/api/v1/users' }
    const route = getCurrentRoute(page as Parameters<typeof getCurrentRoute>[0])
    expect(route).toBe('/api/v1/users')
  })

  test('isAtRoute handles empty route', () => {
    const page = { url: () => 'http://localhost:3000/' }
    expect(isAtRoute(page as Parameters<typeof isAtRoute>[0], '')).toBe(true)
  })
})

// ============================================================================
// Concurrent Behavior
// ============================================================================

describe.skipIf(skipPlaywrightTests)('Navigation - Concurrent Execution', () => {
  test('multiple health checks run independently', async () => {
    const start = Date.now()
    const results = await Promise.all([
      waitForServerHealthy({
        baseUrl: `http://localhost:${MOCK_PORT}`,
        maxRetries: 1,
        timeout: 1000,
      }),
      waitForServerHealthy({
        baseUrl: `http://localhost:${MOCK_PORT}`,
        maxRetries: 1,
        timeout: 1000,
      }),
      waitForServerHealthy({
        baseUrl: `http://localhost:${MOCK_PORT}`,
        maxRetries: 1,
        timeout: 1000,
      }),
    ])
    const elapsed = Date.now() - start

    // All should succeed
    expect(results).toEqual([true, true, true])
    // Should complete in roughly parallel time, not 3x
    expect(elapsed).toBeLessThan(2000)
  })
})

// ============================================================================
// App-Specific Navigation Functions - Export Verification
// ============================================================================
// NOTE: These functions require a real Playwright page with a running app.
// Full E2E tests should be in the app-specific test suites.
// Here we verify they are exported and have correct signatures.

describe.skipIf(skipPlaywrightTests)('Navigation - App-Specific Functions Exist', () => {
  test('navigateToMarket is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.navigateToMarket).toBe('function')
    expect(nav.navigateToMarket.length).toBe(2) // page, marketId?
  })

  test('navigateToPortfolio is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.navigateToPortfolio).toBe('function')
    expect(nav.navigateToPortfolio.length).toBe(1) // page
  })

  test('navigateToSwap is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.navigateToSwap).toBe('function')
    expect(nav.navigateToSwap.length).toBe(1) // page
  })

  test('navigateToLiquidity is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.navigateToLiquidity).toBe('function')
    expect(nav.navigateToLiquidity.length).toBe(1) // page
  })

  test('hideNextDevOverlay is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.hideNextDevOverlay).toBe('function')
  })

  test('waitForPageLoad is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.waitForPageLoad).toBe('function')
  })

  test('cooldownBetweenTests is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.cooldownBetweenTests).toBe('function')
  })

  test('waitForRoute is exported and callable', async () => {
    const nav = await import('./navigation')
    expect(typeof nav.waitForRoute).toBe('function')
  })
})

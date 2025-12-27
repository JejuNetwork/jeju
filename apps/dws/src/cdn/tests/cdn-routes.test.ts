/**
 * CDN Routes Integration Tests
 * Tests for the CDN Elysia router that serves app frontends
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import {
  getAppRegistry,
  initializeAppRegistry,
  resetAppRegistry,
} from '../app-registry'
import {
  getLocalCDNServer,
  initializeLocalCDN,
  resetLocalCDN,
} from '../local-server'

const TEST_DIR = join(tmpdir(), `jeju-cdn-routes-test-${Date.now()}`)

async function setupTestApps(): Promise<void> {
  const app1Dir = join(TEST_DIR, 'testapp')
  await mkdir(join(app1Dir, 'dist/assets'), { recursive: true })

  await writeFile(
    join(app1Dir, 'dist', 'index.html'),
    '<!DOCTYPE html><html><body>Test App</body></html>',
  )
  await writeFile(join(app1Dir, 'dist', 'main.js'), 'console.log("testapp")')
  await writeFile(
    join(app1Dir, 'dist/assets', 'style.css'),
    'body { margin: 0 }',
  )
  await writeFile(
    join(app1Dir, 'dist/assets', 'logo.ab12cd34.png'),
    'fake-png-data',
  )

  const manifest = {
    name: 'testapp',
    displayName: 'Test Application',
    ports: { main: 3100 },
    dws: {
      cdn: {
        enabled: true,
        staticDir: 'dist',
        cacheRules: [
          { pattern: '/assets/**', ttl: 31536000, immutable: true },
          { pattern: '/**/*.js', ttl: 86400 },
        ],
      },
    },
    decentralization: {
      frontend: {
        spa: true,
        jnsName: 'testapp.jeju',
      },
    },
    jns: {
      name: 'testapp.jeju',
    },
  }

  await writeFile(join(app1Dir, 'jeju-manifest.json'), JSON.stringify(manifest))
}

// Simplified CDN router for testing without JNS dependencies
function createTestCDNRouter() {
  return new Elysia({ prefix: '/cdn' })
    .get('/apps', () => {
      const registry = getAppRegistry()
      const apps = registry.getEnabledApps().map((app) => ({
        name: app.name,
        displayName: app.displayName,
        jnsName: app.jnsName,
        port: app.port,
      }))
      return { apps, count: apps.length }
    })
    .get('/apps/:appName', ({ params, set }) => {
      const registry = getAppRegistry()
      const app = registry.getApp(params.appName)
      if (!app) {
        set.status = 404
        return { error: `App not found: ${params.appName}` }
      }
      return {
        name: app.name,
        displayName: app.displayName,
        jnsName: app.jnsName,
        port: app.port,
        staticDir: app.staticDir,
      }
    })
    .get('/apps/:appName/*', async ({ params, request }) => {
      const { appName } = params
      const localCDN = getLocalCDNServer()
      const url = new URL(request.url)
      const appPath = url.pathname.replace(`/cdn/apps/${appName}`, '') || '/'
      const cdnRequest = new Request(
        `http://localhost/apps/${appName}${appPath}`,
      )

      // Return the response directly - Elysia passes through Response objects
      return localCDN.handleRequest(cdnRequest)
    })
}

describe('CDN Routes', () => {
  // Use 'unknown' to accept any Elysia instance shape since the type varies with routes
  let app: { handle: (req: Request) => Promise<Response> }

  beforeEach(async () => {
    resetAppRegistry()
    resetLocalCDN()
    await setupTestApps()
    await initializeAppRegistry(TEST_DIR)
    await initializeLocalCDN({ appsDir: TEST_DIR, cacheEnabled: false })

    app = new Elysia().use(createTestCDNRouter())
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  test('GET /cdn/apps returns registered apps', async () => {
    const response = await app.handle(new Request('http://localhost/cdn/apps'))
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      apps: Array<{ name: string; jnsName: string }>
      count: number
    }
    expect(body.count).toBe(1)
    expect(body.apps[0].name).toBe('testapp')
    expect(body.apps[0].jnsName).toBe('testapp.jeju')
  })

  test('GET /cdn/apps/:appName returns app details', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp'),
    )
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      name: string
      displayName: string
      port: number
    }
    expect(body.name).toBe('testapp')
    expect(body.displayName).toBe('Test Application')
    expect(body.port).toBe(3100)
  })

  test('GET /cdn/apps/:appName returns 404 for unknown app', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/unknown'),
    )
    expect(response.status).toBe(404)

    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('not found')
  })

  test('GET /cdn/apps/:appName/index.html serves HTML', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp/index.html'),
    )
    expect(response.status).toBe(200)

    const contentType = response.headers.get('Content-Type')
    expect(contentType).toContain('text/html')

    const body = await response.text()
    expect(body).toContain('Test App')
  })

  test('GET /cdn/apps/:appName/ serves index.html for root', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp/'),
    )
    expect(response.status).toBe(200)

    const body = await response.text()
    expect(body).toContain('Test App')
  })

  test('GET /cdn/apps/:appName/main.js serves JavaScript', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp/main.js'),
    )
    expect(response.status).toBe(200)

    const contentType = response.headers.get('Content-Type')
    expect(contentType).toContain('javascript')

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toMatch(/max-age=86400/)
  })

  test('GET /cdn/apps/:appName/assets/style.css serves CSS with immutable cache', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp/assets/style.css'),
    )
    expect(response.status).toBe(200)

    const contentType = response.headers.get('Content-Type')
    expect(contentType).toContain('css')

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toMatch(/max-age=31536000/)
    expect(cacheControl).toMatch(/immutable/)
  })

  test('SPA routing: non-file paths return index.html', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp/dashboard/settings'),
    )
    expect(response.status).toBe(200)

    const body = await response.text()
    expect(body).toContain('Test App')
  })

  test('returns 404 for non-existent file with extension', async () => {
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp/nonexistent.js'),
    )
    expect(response.status).toBe(404)
  })

  test('sets CDN headers for static files', async () => {
    // Test on a specific static file to ensure headers are preserved
    const response = await app.handle(
      new Request('http://localhost/cdn/apps/testapp/main.js'),
    )
    expect(response.status).toBe(200)

    // Headers should include cache control and CDN metadata
    const headers = Object.fromEntries(response.headers.entries())
    expect(headers['content-type']).toContain('javascript')
    expect(headers['cache-control']).toBeDefined()
  })
})

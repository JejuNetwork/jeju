/**
 * App Registry Tests
 * Tests for the CDN app registry that discovers and serves Jeju app frontends
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppRegistry, resetAppRegistry } from '../app-registry'
import { LocalCDNServer, resetLocalCDN } from '../local-server'

const TEST_DIR = join(tmpdir(), `jeju-cdn-test-${Date.now()}`)

async function setupTestApps(): Promise<void> {
  // Create test app directories
  const app1Dir = join(TEST_DIR, 'app1')
  const app2Dir = join(TEST_DIR, 'app2')
  const app3Dir = join(TEST_DIR, 'app3-no-cdn')

  await mkdir(join(app1Dir, 'dist'), { recursive: true })
  await mkdir(join(app2Dir, 'build'), { recursive: true })
  await mkdir(app3Dir, { recursive: true })

  // Create test files
  await writeFile(join(app1Dir, 'dist', 'index.html'), '<html><body>App 1</body></html>')
  await writeFile(join(app1Dir, 'dist', 'main.js'), 'console.log("app1")')
  await writeFile(join(app1Dir, 'dist', 'style.css'), 'body { color: red }')
  await writeFile(join(app2Dir, 'build', 'index.html'), '<html><body>App 2</body></html>')

  // Create manifests
  const app1Manifest = {
    name: 'app1',
    displayName: 'Test App 1',
    ports: { main: 3001 },
    dws: {
      cdn: {
        enabled: true,
        staticDir: 'dist',
        cacheRules: [
          { pattern: '/**/*.js', ttl: 86400 },
        ],
      },
    },
    decentralization: {
      frontend: {
        spa: true,
        jnsName: 'app1.jeju',
      },
    },
  }

  const app2Manifest = {
    name: 'app2',
    displayName: 'Test App 2',
    ports: { frontend: 3002, main: 3003 },
    decentralization: {
      frontend: {
        buildDir: 'build',
        spa: false,
        jnsName: 'app2.jeju',
      },
      cdn: {
        enabled: true,
      },
    },
  }

  const app3Manifest = {
    name: 'app3',
    displayName: 'App Without CDN',
    ports: { main: 3004 },
  }

  await writeFile(join(app1Dir, 'jeju-manifest.json'), JSON.stringify(app1Manifest))
  await writeFile(join(app2Dir, 'jeju-manifest.json'), JSON.stringify(app2Manifest))
  await writeFile(join(app3Dir, 'jeju-manifest.json'), JSON.stringify(app3Manifest))
}

async function cleanupTestApps(): Promise<void> {
  await rm(TEST_DIR, { recursive: true, force: true })
}

describe('AppRegistry', () => {
  beforeEach(async () => {
    resetAppRegistry()
    await setupTestApps()
  })

  afterEach(async () => {
    await cleanupTestApps()
  })

  test('initializes and discovers apps', async () => {
    const registry = new AppRegistry(TEST_DIR)
    await registry.initialize()

    const apps = registry.getAllApps()
    expect(apps.length).toBe(2) // app3 has no CDN config
  })

  test('parses app configuration correctly', async () => {
    const registry = new AppRegistry(TEST_DIR)
    await registry.initialize()

    const app1 = registry.getApp('app1')
    expect(app1).toBeDefined()
    expect(app1?.displayName).toBe('Test App 1')
    expect(app1?.staticDir).toBe('dist')
    expect(app1?.port).toBe(3001)
    expect(app1?.spa).toBe(true)
    expect(app1?.jnsName).toBe('app1.jeju')
  })

  test('uses frontend port over main port', async () => {
    const registry = new AppRegistry(TEST_DIR)
    await registry.initialize()

    const app2 = registry.getApp('app2')
    expect(app2?.port).toBe(3002) // frontend port
  })

  test('applies custom cache rules', async () => {
    const registry = new AppRegistry(TEST_DIR)
    await registry.initialize()

    const rules = registry.getCacheRulesForApp('app1')
    const jsRule = rules.find((r) => r.pattern === '/**/*.js')
    expect(jsRule).toBeDefined()
    expect(jsRule?.ttl).toBe(86400)
  })

  test('sets and retrieves app CID', async () => {
    const registry = new AppRegistry(TEST_DIR)
    await registry.initialize()

    registry.setAppCid('app1', 'QmTestCid123')
    const app = registry.getApp('app1')
    expect(app?.cid).toBe('QmTestCid123')
  })

  test('getEnabledApps filters correctly', async () => {
    const registry = new AppRegistry(TEST_DIR)
    await registry.initialize()

    const enabled = registry.getEnabledApps()
    expect(enabled.every((a) => a.enabled)).toBe(true)
  })

  test('handles missing app gracefully', async () => {
    const registry = new AppRegistry(TEST_DIR)
    await registry.initialize()

    const app = registry.getApp('nonexistent')
    expect(app).toBeUndefined()
  })
})

describe('LocalCDNServer', () => {
  beforeEach(async () => {
    resetAppRegistry()
    resetLocalCDN()
    await setupTestApps()
  })

  afterEach(async () => {
    await cleanupTestApps()
  })

  test('initializes with app registry', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    const apps = server.getRegisteredApps()
    expect(apps.length).toBe(2)
  })

  test('serves index.html for app root', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    const response = await server.handleRequest(
      new Request('http://localhost/apps/app1/')
    )

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('App 1')
  })

  test('serves static files with correct content type', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    const jsResponse = await server.handleRequest(
      new Request('http://localhost/apps/app1/main.js')
    )
    expect(jsResponse.status).toBe(200)
    expect(jsResponse.headers.get('Content-Type')).toContain('javascript')

    const cssResponse = await server.handleRequest(
      new Request('http://localhost/apps/app1/style.css')
    )
    expect(cssResponse.status).toBe(200)
    expect(cssResponse.headers.get('Content-Type')).toContain('css')
  })

  test('applies cache control headers', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    const apps = server.getRegisteredApps()
    expect(apps.some(a => a.name === 'app1')).toBe(true)
    
    const app1 = apps.find(a => a.name === 'app1')
    expect(app1).toBeDefined()

    const response = await server.handleRequest(
      new Request('http://localhost/apps/app1/main.js')
    )

    expect(response.status).toBe(200)
    
    // Debug: print all headers
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => { headers[key] = value })
    console.log('All response headers:', headers)
    
    const cacheControl = headers['cache-control'] ?? headers['Cache-Control']
    expect(cacheControl).toBeTruthy()
    expect(cacheControl).toMatch(/max-age=86400/)
  })

  test('handles SPA routing', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    // Non-file path should return index.html for SPA
    const response = await server.handleRequest(
      new Request('http://localhost/apps/app1/dashboard')
    )

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('App 1')
  })

  test('returns 404 for non-SPA missing files', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    // app2 has spa: false
    const response = await server.handleRequest(
      new Request('http://localhost/apps/app2/nonexistent')
    )

    expect(response.status).toBe(404)
  })

  test('returns 404 for unknown app', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    const response = await server.handleRequest(
      new Request('http://localhost/apps/unknown/')
    )

    expect(response.status).toBe(404)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('not found')
  })

  test('lists all apps via /cdn/apps', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    const response = await server.handleRequest(
      new Request('http://localhost/cdn/apps')
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { apps: Array<{ name: string }> }
    expect(body.apps.length).toBe(2)
    expect(body.apps.some((a) => a.name === 'app1')).toBe(true)
    expect(body.apps.some((a) => a.name === 'app2')).toBe(true)
  })

  test('sets X-CDN-App header', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR })
    await server.initialize()

    const response = await server.handleRequest(
      new Request('http://localhost/apps/app1/')
    )

    expect(response.headers.get('X-CDN-App')).toBe('app1')
  })

  test('caches responses when enabled', async () => {
    const server = new LocalCDNServer({ appsDir: TEST_DIR, cacheEnabled: true })
    await server.initialize()

    // First request - should be served from filesystem
    const response1 = await server.handleRequest(
      new Request('http://localhost/apps/app1/')
    )
    expect(response1.status).toBe(200)

    // Second request - should be served from cache
    const response2 = await server.handleRequest(
      new Request('http://localhost/apps/app1/')
    )
    expect(response2.status).toBe(200)
  })
})

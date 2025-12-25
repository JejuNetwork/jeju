/**
 * App SDK Tests
 *
 * Tests the DWS App SDK for running Jeju apps as workerd workers.
 */

import { describe, expect, it } from 'bun:test'
import { DWSApp, type FetchHandler, JEJU_APPS } from '../api/workers/app-sdk'
import {
  adaptAppForWorkerd,
  generateWorkerdCode,
  generateWorkerdConfig,
} from '../api/workers/workerd/app-adapter'

/** Test helper for creating DWSApp with invalid config */
interface RawDWSAppConfig {
  name: string
  port: number
  handler: unknown
}

function createDWSAppRaw(config: RawDWSAppConfig): DWSApp {
  return new DWSApp(
    config as { name: string; port: number; handler: FetchHandler },
  )
}

// DWS App Tests

describe('DWSApp', () => {
  const mockHandler: FetchHandler = async (_request) => {
    return new Response(JSON.stringify({ message: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('should create app with required config', () => {
    const app = new DWSApp({
      name: 'test-app',
      port: 3000,
      handler: mockHandler,
    })

    expect(app).toBeDefined()
    expect(app.isRunning()).toBe(false)
    expect(app.getDeployment()).toBeNull()
  })

  it('should throw on missing name', () => {
    expect(() => {
      new DWSApp({
        name: '',
        port: 3000,
        handler: mockHandler,
      })
    }).toThrow('App name is required')
  })

  it('should throw on missing port', () => {
    expect(() => {
      new DWSApp({
        name: 'test',
        port: 0,
        handler: mockHandler,
      })
    }).toThrow('App port is required')
  })

  it('should throw on missing handler', () => {
    expect(() => {
      createDWSAppRaw({ name: 'test', port: 3000, handler: undefined })
    }).toThrow('App handler is required')
  })

  it('should start and stop app', async () => {
    const app = new DWSApp({
      name: 'test-app',
      port: 13000 + Math.floor(Math.random() * 1000),
      handler: mockHandler,
    })

    const deployment = await app.start()

    expect(deployment.status).toBe('running')
    expect(deployment.teeSimulated).toBe(true)
    expect(deployment.environment).toBe('localnet')
    expect(app.isRunning()).toBe(true)

    await app.stop()

    expect(app.getDeployment()?.status).toBe('stopped')
  })

  it('should get health status', async () => {
    const app = new DWSApp({
      name: 'test-app',
      port: 13100 + Math.floor(Math.random() * 1000),
      handler: mockHandler,
    })

    await app.start()

    const health = app.getHealth()
    expect(health.status).toBe('healthy')
    expect(health.teeMode).toBe('simulated')
    expect(health.app).toBe('test-app')

    await app.stop()
  })

  it('should get metrics', async () => {
    const app = new DWSApp({
      name: 'test-app',
      port: 13200 + Math.floor(Math.random() * 1000),
      handler: mockHandler,
    })

    await app.start()

    const metrics = app.getMetrics()
    expect(metrics.requests).toBe(0)
    expect(metrics.errors).toBe(0)
    expect(metrics.uptime).toBeGreaterThan(0)

    await app.stop()
  })
})

// JEJU_APPS Registry Tests

describe('JEJU_APPS Registry', () => {
  it('should have all standard apps', () => {
    expect(JEJU_APPS.autocrat).toBeDefined()
    expect(JEJU_APPS.bazaar).toBeDefined()
    expect(JEJU_APPS.crucible).toBeDefined()
    expect(JEJU_APPS.factory).toBeDefined()
    expect(JEJU_APPS.gateway).toBeDefined()
    expect(JEJU_APPS.dws).toBeDefined()
    expect(JEJU_APPS.indexer).toBeDefined()
    expect(JEJU_APPS.otto).toBeDefined()
  })

  it('should have unique ports', () => {
    const ports = Object.values(JEJU_APPS).map((app) => app.port)
    const uniquePorts = new Set(ports)
    expect(uniquePorts.size).toBe(ports.length)
  })

  it('should have descriptions', () => {
    for (const [_name, config] of Object.entries(JEJU_APPS)) {
      expect(config.description).toBeDefined()
      expect(config.description.length).toBeGreaterThan(5)
    }
  })
})

// Workerd App Adapter Tests

describe('Workerd App Adapter', () => {
  const mockHandler: FetchHandler = async (request) => {
    const teeMode = request.headers.get('x-tee-mode')
    return new Response(
      JSON.stringify({
        message: 'ok',
        teeMode,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  it('should adapt handler for workerd', async () => {
    const adapted = adaptAppForWorkerd(mockHandler, {
      name: 'test-app',
      region: 'local',
    })

    const mockEnv = {
      TEE_MODE: 'simulated' as const,
      TEE_PLATFORM: 'simulator',
      TEE_REGION: 'local',
      NETWORK: 'localnet' as const,
      RPC_URL: 'http://localhost:6546',
      DWS_URL: 'http://localhost:4030',
      GATEWAY_URL: 'http://localhost:4010',
      INDEXER_URL: 'http://localhost:4020',
      IDENTITY_REGISTRY_ADDRESS: '0x0',
      SERVICE_REGISTRY_ADDRESS: '0x0',
      AGENT_VAULT_ADDRESS: '0x0',
      getTEEAttestation: async () => null,
      getSecret: async () => null,
    }

    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    }

    const request = new Request('http://localhost/test')
    const response = await adapted.fetch(request, mockEnv, mockCtx)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-tee-mode')).toBe('simulated')
    expect(response.headers.get('x-tee-region')).toBe('local')
    expect(response.headers.get('x-dws-app')).toBe('test-app')

    const body = await response.json()
    expect(body.teeMode).toBe('simulated')
  })

  it('should generate workerd code', () => {
    const code = generateWorkerdCode('./src/server', 'app', {
      name: 'test-app',
      region: 'local',
    })

    expect(code).toContain("import { app } from './src/server'")
    expect(code).toContain('export default')
    expect(code).toContain('async fetch(request, env, ctx)')
    expect(code).toContain('x-tee-mode')
    expect(code).toContain('x-dws-app')
    expect(code).toContain('test-app')
  })

  it('should generate workerd config', () => {
    const config = generateWorkerdConfig({
      name: 'test-app',
      mainModule: 'worker.js',
      port: 3000,
      env: {
        NETWORK: 'localnet',
        TEE_MODE: 'simulated',
      },
    })

    expect(config).toContain('using Workerd')
    expect(config).toContain('test-app')
    expect(config).toContain('worker.js')
    expect(config).toContain('3000')
    expect(config).toContain('NETWORK')
    expect(config).toContain('localnet')
    expect(config).toContain('TEE_MODE')
    expect(config).toContain('simulated')
  })

  it('should escape special characters in config', () => {
    const config = generateWorkerdConfig({
      name: 'test',
      mainModule: 'worker.js',
      port: 3000,
      env: {
        VALUE_WITH_QUOTES: 'hello "world"',
        VALUE_WITH_NEWLINE: 'line1\nline2',
      },
    })

    expect(config).toContain('\\"world\\"')
    expect(config).toContain('\\n')
  })
})

// Integration Tests

describe('App SDK Integration', () => {
  it('should start multiple apps without port conflicts', async () => {
    const basePort = 14000 + Math.floor(Math.random() * 1000)

    const app1 = new DWSApp({
      name: 'app1',
      port: basePort,
      handler: async () => new Response('app1'),
    })

    const app2 = new DWSApp({
      name: 'app2',
      port: basePort + 1,
      handler: async () => new Response('app2'),
    })

    await app1.start()
    await app2.start()

    expect(app1.isRunning()).toBe(true)
    expect(app2.isRunning()).toBe(true)

    // Make requests to each app
    const res1 = await fetch(`http://localhost:${basePort}`)
    const res2 = await fetch(`http://localhost:${basePort + 1}`)

    expect(await res1.text()).toBe('app1')
    expect(await res2.text()).toBe('app2')

    await app1.stop()
    await app2.stop()
  })

  it('should add TEE headers to responses', async () => {
    const port = 14200 + Math.floor(Math.random() * 1000)

    const app = new DWSApp({
      name: 'test-app',
      port,
      handler: async () => new Response('ok'),
    })

    await app.start()

    const response = await fetch(`http://localhost:${port}`)

    expect(response.headers.get('x-tee-mode')).toBe('simulated')
    expect(response.headers.get('x-dws-app')).toBe('test-app')

    await app.stop()
  })
})

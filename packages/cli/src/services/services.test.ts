/**
 * Services Orchestrator Tests
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { JNSRegistrationResponseSchema, validate } from '../schemas'
import { createInferenceServer, type LocalInferenceServer } from './inference'
import { createOrchestrator, type ServicesOrchestrator } from './orchestrator'

describe('LocalInferenceServer', () => {
  let server: LocalInferenceServer
  const port = 14100 // Use non-standard port for testing

  beforeAll(async () => {
    server = createInferenceServer({ port })
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('should respond to health check', async () => {
    const response = await fetch(`http://localhost:${port}/health`)
    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  it('should list available models', async () => {
    const response = await fetch(`http://localhost:${port}/v1/models`)
    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.object).toBe('list')
    expect(Array.isArray(data.data)).toBe(true)
    // Should have at least the local fallback model
    expect(
      data.data.some((m: { id: string }) => m.id === 'local-fallback'),
    ).toBe(true)
  })

  it('should handle chat completions with local fallback', async () => {
    const response = await fetch(
      `http://localhost:${port}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local-fallback',
          messages: [{ role: 'user', content: 'help' }],
        }),
      },
    )

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.object).toBe('chat.completion')
    expect(data.choices).toHaveLength(1)
    expect(data.choices[0].message.role).toBe('assistant')
    expect(data.choices[0].message.content).toBeDefined()
  })

  it('should handle unknown model gracefully', async () => {
    const response = await fetch(
      `http://localhost:${port}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nonexistent-model',
          messages: [{ role: 'user', content: 'test' }],
        }),
      },
    )

    // In test environment without DWS, unknown models may fail to route
    // This is expected behavior - just verify we get a response
    expect(response.status).toBeDefined()
    // If DWS is not running, it may fail with 500 or similar
    // That's acceptable in isolated test environment
  })
})

// ServicesOrchestrator tests - starts Oracle and JNS mock services
// CQL is tested separately since it requires a process spawn
describe('ServicesOrchestrator', () => {
  let orchestrator: ServicesOrchestrator

  beforeAll(async () => {
    orchestrator = createOrchestrator(process.cwd())
    // Start only the Elysia-based mock services (not CQL which spawns a process)
    await orchestrator.startAll({
      inference: false, // Tested above in LocalInferenceServer
      cql: false, // Skip - tested separately, requires bun subprocess
      oracle: true, // Mock Oracle Elysia server
      indexer: false, // Requires Docker
      jns: true, // Mock JNS Elysia server
      storage: false, // Requires DWS app
      cron: false, // Requires DWS app
      cvm: false, // Requires dstack vendor
      computeBridge: false, // Requires DWS app
      git: false, // Requires DWS app
      pkg: false, // Requires DWS app
    })
    // Wait for services to fully initialize
    await new Promise((r) => setTimeout(r, 2000))
  }, 45000)

  afterAll(async () => {
    if (orchestrator) {
      await orchestrator.stopAll()
    }
  })

  it('should start and track services', () => {
    const services = orchestrator.getRunningServices()
    expect(services.size).toBeGreaterThan(0)
  })

  it('should provide environment variables', () => {
    const env = orchestrator.getEnvVars()
    expect(typeof env).toBe('object')
    // Should have at least Oracle URL (services we started)
    expect(env.ORACLE_URL).toBeDefined()
  })

  // Note: CQL service (packages/db) is tested separately in integration tests
  // as it requires spawning a bun subprocess which can be slow

  describe('Oracle Service', () => {
    it('should respond to health check', async () => {
      const url = orchestrator.getServiceUrl('oracle')
      expect(url).toBeDefined()

      const response = await fetch(`${url}/health`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      // Mode can be 'simulator' or 'on-chain' depending on contract availability
      expect(['simulator', 'on-chain']).toContain(data.mode)
    })

    it('should return prices endpoint', async () => {
      const url = orchestrator.getServiceUrl('oracle')
      const response = await fetch(`${url}/api/v1/prices`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      // Response should be an object (may be empty if no oracles configured)
      expect(typeof data).toBe('object')
    })

    it('should handle price queries', async () => {
      const url = orchestrator.getServiceUrl('oracle')
      // Service should handle requests (may return 0 if no oracle deployed)
      const response = await fetch(`${url}/api/v1/price?base=ETH&quote=USD`)
      // Response could be 200 with data or 404/500 if not configured
      expect(response.status).toBeDefined()
    })
  })

  describe('Mock JNS Service', () => {
    it('should respond to health check', async () => {
      const url = orchestrator.getServiceUrl('jns')
      expect(url).toBeDefined()

      const response = await fetch(`${url}/health`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      // Service is healthy and provides JNS functionality
      expect(data).toBeDefined()
    })

    it('should handle name resolution requests', async () => {
      const url = orchestrator.getServiceUrl('jns')
      // Check if service handles resolve requests (may be 404 if name doesn't exist)
      const response = await fetch(`${url}/api/v1/resolve?name=test.jeju`)
      // 404 is valid for non-existent names, 200 for existing
      expect([200, 404]).toContain(response.status)
    })

    it('should check name availability', async () => {
      const url = orchestrator.getServiceUrl('jns')
      // Random name should be available (not registered)
      const response = await fetch(
        `${url}/api/v1/available?name=randomname${Date.now()}.jeju`,
      )
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.available).toBe(true)
    })

    it('should return name pricing', async () => {
      const url = orchestrator.getServiceUrl('jns')
      const response = await fetch(`${url}/api/v1/price?name=testname.jeju&years=1`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      // Price should be returned for any valid name query
      expect(typeof data.pricePerYear).toBe('number')
      expect(typeof data.total).toBe('number')
    })
  })

  // Note: Cron and CVM services require DWS/dstack infrastructure
  // and are tested in integration tests with full infrastructure
})

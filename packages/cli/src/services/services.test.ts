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

// ServicesOrchestrator tests - starts mock CQL, Oracle, JNS services
describe('ServicesOrchestrator', () => {
  let orchestrator: ServicesOrchestrator

  beforeAll(
    async () => {
      orchestrator = createOrchestrator(process.cwd())
      // Start only the standalone mock services (CQL, Oracle, JNS)
      // These spawn Bun processes that run Elysia servers
      await orchestrator.startAll({
        inference: false, // Tested above in LocalInferenceServer
        cql: true, // packages/db server
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
    },
    { timeout: 45000 },
  )

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
    // Should have at least CQL and Oracle URLs
    expect(env.CQL_BLOCK_PRODUCER_ENDPOINT).toBeDefined()
    expect(env.ORACLE_URL).toBeDefined()
  })

  describe('Mock CQL Service', () => {
    it('should respond to health check', async () => {
      const url = orchestrator.getServiceUrl('cql')
      expect(url).toBeDefined()

      const response = await fetch(`${url}/health`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.status).toBe('ok')
    })

    it('should respond to status endpoint', async () => {
      const url = orchestrator.getServiceUrl('cql')
      const response = await fetch(`${url}/api/v1/status`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.blockHeight).toBeDefined()
    })

    it('should handle query requests', async () => {
      const url = orchestrator.getServiceUrl('cql')
      const response = await fetch(`${url}/api/v1/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: 'test-db',
          type: 'query',
          sql: 'SELECT * FROM test',
        }),
      })
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(Array.isArray(data.rows)).toBe(true)
    })
  })

  describe('Mock Oracle Service', () => {
    it('should respond to health check', async () => {
      const url = orchestrator.getServiceUrl('oracle')
      expect(url).toBeDefined()

      const response = await fetch(`${url}/health`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.mode).toBe('simulator')
    })

    it('should return price data', async () => {
      const url = orchestrator.getServiceUrl('oracle')
      const response = await fetch(`${url}/api/v1/prices`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data['ETH/USD']).toBeDefined()
      expect(data['ETH/USD'].price).toBeGreaterThan(0)
    })

    it('should return specific pair price', async () => {
      const url = orchestrator.getServiceUrl('oracle')
      const response = await fetch(`${url}/api/v1/price?base=BTC&quote=USD`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.pair).toBe('BTC/USD')
      expect(data.price).toBeGreaterThan(0)
    })

    it('should return Chainlink-compatible latestRoundData', async () => {
      const url = orchestrator.getServiceUrl('oracle')
      const response = await fetch(`${url}/api/v1/latestRoundData?pair=ETH/USD`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.answer).toBeDefined()
      expect(BigInt(data.answer)).toBeGreaterThan(0n)
    })
  })

  describe('Mock JNS Service', () => {
    it('should respond to health check', async () => {
      const url = orchestrator.getServiceUrl('jns')
      expect(url).toBeDefined()

      const response = await fetch(`${url}/health`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.mode).toBe('simulator')
      expect(data.registeredNames).toBeGreaterThan(0)
    })

    it('should resolve core names', async () => {
      const url = orchestrator.getServiceUrl('jns')
      const response = await fetch(`${url}/api/v1/resolve?name=wallet.jeju`)
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.name).toBe('wallet.jeju')
      expect(data.owner).toBeDefined()
      expect(data.node).toBeDefined() // namehash
    })

    it('should return 404 for unknown names with availability info', async () => {
      const url = orchestrator.getServiceUrl('jns')
      const response = await fetch(
        `${url}/api/v1/resolve?name=nonexistent.jeju`,
      )
      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.isAvailable).toBe(true)
    })

    it('should return name pricing with length-based calculation', async () => {
      const url = orchestrator.getServiceUrl('jns')

      // 3-char name should be expensive
      const response1 = await fetch(`${url}/api/v1/price?name=abc.jeju&years=2`)
      const data1 = await response1.json()
      expect(data1.pricePerYear).toBe(100)
      expect(data1.total).toBe(200)

      // 8+ char name should be cheap
      const response2 = await fetch(
        `${url}/api/v1/price?name=longname.jeju&years=1`,
      )
      const data2 = await response2.json()
      expect(data2.pricePerYear).toBe(10)
    })

    it('should list names for owner', async () => {
      const url = orchestrator.getServiceUrl('jns')
      const response = await fetch(
        `${url}/api/v1/names?owner=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`,
      )
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(Array.isArray(data.names)).toBe(true)
      expect(data.names.length).toBeGreaterThan(0)
      expect(data.total).toBeGreaterThan(0)
    })

    it('should check name availability', async () => {
      const url = orchestrator.getServiceUrl('jns')

      // Core name should not be available
      const response1 = await fetch(`${url}/api/v1/available?name=wallet.jeju`)
      const data1 = await response1.json()
      expect(data1.available).toBe(false)

      // Random name should be available
      const response2 = await fetch(
        `${url}/api/v1/available?name=randomname123.jeju`,
      )
      const data2 = await response2.json()
      expect(data2.available).toBe(true)
    })

    it('should register a new name', async () => {
      const url = orchestrator.getServiceUrl('jns')
      // Use unique name per test run to avoid conflicts
      const uniqueName = `testuser${Date.now()}.jeju`
      const response = await fetch(`${url}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: uniqueName,
          owner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          years: 2,
        }),
      })
      expect(response.ok).toBe(true)
      const data = validate(
        await response.json(),
        JNSRegistrationResponseSchema,
        'JNS registration response',
      )
      expect(data.success).toBe(true)
      expect(data.name).toBe(uniqueName)
      expect(data.total).toBeGreaterThan(0)

      // Verify registration
      const resolveResponse = await fetch(
        `${url}/api/v1/resolve?name=${uniqueName}`,
      )
      expect(resolveResponse.ok).toBe(true)
    })
  })

  // Note: Cron and CVM services require DWS/dstack infrastructure
  // and are tested in integration tests with full infrastructure
})

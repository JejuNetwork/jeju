/**
 * DA Layer Integration Tests
 *
 * Tests the full DA layer integration with DWS server
 */

import { describe, expect, it } from 'bun:test'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { app } from '../src/server'

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
const TEST_DATA = 'Hello, DA Layer!'

describe('DA Layer HTTP API', () => {
  // ============ Health ============

  it('should return health status', async () => {
    const response = await app.request('/da/health')
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      status: string
      initialized: boolean
    }
    expect(data.status).toBe('healthy')
    expect(data.initialized).toBe(true)
  })

  // ============ Blob Submission ============

  it('should submit a blob', async () => {
    // First register an operator so dispersal can work
    const operator = {
      address: TEST_ADDRESS,
      endpoint: 'http://localhost:4032',
      region: 'test-region',
      status: 'active',
      capacityGB: 100,
      usedGB: 0,
    }

    await app.request('/da/operators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operator),
    })

    const blobData = toHex(new TextEncoder().encode(TEST_DATA))

    const response = await app.request('/da/blob', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: blobData,
        submitter: TEST_ADDRESS,
      }),
    })

    // Since we have a mock operator that doesn't respond, dispersal may fail
    // but the blob should still be prepared
    if (response.status === 200) {
      const result = (await response.json()) as {
        blobId: Hex
        commitment: { commitment: Hex }
      }

      expect(result.blobId).toMatch(/^0x[a-f0-9]{64}$/)
      expect(result.commitment).toBeDefined()
      expect(result.commitment.commitment).toMatch(/^0x[a-f0-9]+$/)
    } else {
      // Dispersal failed due to no live operators - that's expected in tests
      const error = (await response.json()) as { error: string; blobId: Hex }
      expect(error.blobId).toMatch(/^0x[a-f0-9]{64}$/)
    }
  })

  // ============ Operators ============

  it('should list operators', async () => {
    const response = await app.request('/da/operators')
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      count: number
      operators: object[]
    }
    expect(typeof data.count).toBe('number')
    expect(Array.isArray(data.operators)).toBe(true)
  })

  it('should register a new operator', async () => {
    const operator = {
      address: TEST_ADDRESS,
      endpoint: 'http://localhost:4031',
      region: 'test',
      status: 'active',
      capacityGB: 100,
      usedGB: 0,
    }

    const response = await app.request('/da/operators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operator),
    })

    expect(response.status).toBe(200)

    const result = (await response.json()) as {
      success: boolean
      address: Address
    }
    expect(result.success).toBe(true)
    expect(result.address).toBe(TEST_ADDRESS)
  })

  // ============ Stats ============

  it('should return stats', async () => {
    const response = await app.request('/da/stats')
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      blobs: { totalBlobs: number }
      operators: { active: number }
    }

    expect(data.blobs).toBeDefined()
    expect(typeof data.blobs.totalBlobs).toBe('number')
    expect(data.operators).toBeDefined()
  })

  // ============ Blob Status ============

  it('should return 404 for non-existent blob', async () => {
    const fakeBlobId = keccak256(toBytes('nonexistent'))
    const response = await app.request(`/da/blob/${fakeBlobId}`)

    expect(response.status).toBe(404)
  })

  // ============ Blob List ============

  it('should list blobs', async () => {
    const response = await app.request('/da/blobs?status=available&limit=10')
    expect(response.status).toBe(200)

    const data = (await response.json()) as { count: number; blobs: object[] }
    expect(typeof data.count).toBe('number')
    expect(Array.isArray(data.blobs)).toBe(true)
  })
})

describe('DA Layer Rollup Integration', () => {
  it('should import rollup adapters', async () => {
    const {
      RollupDAAdapter,
      createRollupDAAdapter,
      OPStackDAAdapter,
      ArbitrumOrbitDAAdapter,
    } = await import('../src/da')

    expect(RollupDAAdapter).toBeDefined()
    expect(createRollupDAAdapter).toBeDefined()
    expect(OPStackDAAdapter).toBeDefined()
    expect(ArbitrumOrbitDAAdapter).toBeDefined()
  })

  it('should import BLS utilities', async () => {
    const { BLS } = await import('../src/da')

    expect(BLS.generateKeyPair).toBeDefined()
    expect(BLS.sign).toBeDefined()
    expect(BLS.verify).toBeDefined()
    expect(BLS.aggregateSignatures).toBeDefined()
  })

  it('should generate BLS key pair', async () => {
    const { BLS } = await import('../src/da')

    const keyPair = BLS.generateKeyPair()
    // Secret key is 32 bytes = 64 hex chars
    expect(keyPair.secretKey).toMatch(/^0x[a-f0-9]{64}$/i)
    // Public key is 48 bytes compressed G1 point = 96 hex chars
    expect(keyPair.publicKey).toMatch(/^0x[a-f0-9]{96}$/i)
  })
})

describe('DA Layer DWS Server Integration', () => {
  it('should include DA in health check', async () => {
    const response = await app.request('/health')
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      services: { da: { status: string } }
    }

    expect(data.services.da).toBeDefined()
    expect(data.services.da.status).toBe('healthy')
  })

  it('should list DA in services', async () => {
    const response = await app.request('/')
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      services: string[]
      endpoints: { da: string }
    }

    expect(data.services).toContain('da')
    expect(data.endpoints.da).toBe('/da/*')
  })

  it('should advertise DA in agent card', async () => {
    const response = await app.request('/.well-known/agent-card.json')
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      capabilities: Array<{ name: string; endpoint: string }>
    }

    const daCapability = data.capabilities.find((c) => c.name === 'da')
    expect(daCapability).toBeDefined()
    expect(daCapability?.endpoint).toContain('/da')
  })
})

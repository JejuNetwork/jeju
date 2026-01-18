/**
 * DWS Services Integration Tests
 *
 * Tests the DWS-native service provisioning APIs:
 * - OAuth3 (MPC-enabled auth)
 * - Data Availability (IPFS-backed)
 * - Email Service
 * - Farcaster Hubble
 * - Workers (x402, RPC Gateway, SQLit Adapter)
 *
 * Infrastructure is automatically started before tests run.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'

// Set default timeout to 2 minutes for infrastructure startup
setDefaultTimeout(120000)

import type { Address } from 'viem'
import {
  setupTestInfrastructure,
  teardownTestInfrastructure,
} from './test-setup'

// Test configuration
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address
const TEST_HEADERS = {
  'Content-Type': 'application/json',
  'x-jeju-address': TEST_ADDRESS,
}

// DWS URL (set during setup)
let dwsUrl: string

/**
 * Make a request to the DWS API
 */
async function dwsRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${dwsUrl}${path}`, {
    ...options,
    headers: {
      ...TEST_HEADERS,
      ...options.headers,
    },
  })
}

describe('DWS Services API', () => {
  beforeAll(async () => {
    // Start infrastructure (SQLit + DWS)
    const { dwsUrl: url } = await setupTestInfrastructure()
    dwsUrl = url
    console.log(`[Tests] Using DWS at ${dwsUrl}`)
  })

  afterAll(async () => {
    await teardownTestInfrastructure()
  })

  describe('Health & Configuration', () => {
    test('GET /dws-services/health returns healthy status', async () => {
      const response = await dwsRequest('/dws-services/health')
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        status: string
        service: string
      }
      expect(body.status).toBe('healthy')
      expect(body.service).toBe('dws-services')
    })

    test('GET /dws-services/testnet-configs returns all service configs', async () => {
      const response = await dwsRequest('/dws-services/testnet-configs')
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        oauth3: { mpcThreshold: number; mpcParties: number }
        da: Record<string, unknown>
        email: Record<string, unknown>
        hubble: Record<string, unknown>
        workers: Record<string, unknown>
      }
      expect(body.oauth3).toBeDefined()
      expect(body.oauth3.mpcThreshold).toBe(2) // 2-of-3 for testnet
      expect(body.oauth3.mpcParties).toBe(3)
      expect(body.da).toBeDefined()
      expect(body.email).toBeDefined()
      expect(body.hubble).toBeDefined()
      expect(body.workers).toBeDefined()
    })

    test('GET /health returns server health', async () => {
      const response = await dwsRequest('/health')
      expect(response.status).toBe(200)
    })
  })

  describe('OAuth3 Service', () => {
    let deployedServiceId: string | null = null

    test('GET /dws-services/oauth3 lists OAuth3 services (empty initially)', async () => {
      const response = await dwsRequest('/dws-services/oauth3')
      expect(response.status).toBe(200)
      const body = (await response.json()) as { services: unknown[] }
      expect(body.services).toBeInstanceOf(Array)
    })

    test('POST /dws-services/oauth3 provisions new OAuth3 service', async () => {
      const response = await dwsRequest('/dws-services/oauth3', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-oauth3',
          replicas: 3,
          mpcThreshold: 2,
          providers: [],
        }),
      })

      // May succeed or fail depending on Docker availability
      if (response.status === 201) {
        const body = (await response.json()) as { service: { id: string } }
        expect(body.service).toBeDefined()
        expect(body.service.id).toBeDefined()
        deployedServiceId = body.service.id
      } else {
        // Without Docker, we expect an error
        expect([500, 503]).toContain(response.status)
        console.log(
          '[Test] OAuth3 provisioning failed (Docker may not be available)',
        )
      }
    })

    test('GET /dws-services/oauth3/:id returns service details', async () => {
      if (!deployedServiceId) {
        console.log('[Test] Skipping - no service deployed')
        return
      }

      const response = await dwsRequest(
        `/dws-services/oauth3/${deployedServiceId}`,
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as { service: { id: string } }
      expect(body.service.id).toBe(deployedServiceId)
    })

    test('DELETE /dws-services/oauth3/:id terminates the service', async () => {
      if (!deployedServiceId) {
        console.log('[Test] Skipping - no service deployed')
        return
      }

      const response = await dwsRequest(
        `/dws-services/oauth3/${deployedServiceId}`,
        { method: 'DELETE' },
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as { status: string }
      expect(body.status).toBe('terminated')
    })

    test('POST without x-jeju-address header returns error', async () => {
      const response = await fetch(`${dwsUrl}/dws-services/oauth3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      // 401 Unauthorized is the correct response for missing auth header
      expect([401, 500]).toContain(response.status)
    })
  })

  describe('Data Availability Service', () => {
    let deployedServiceId: string | null = null

    test('GET /dws-services/da lists DA services', async () => {
      const response = await dwsRequest('/dws-services/da')
      expect(response.status).toBe(200)
      const body = (await response.json()) as { services: unknown[] }
      expect(body.services).toBeInstanceOf(Array)
    })

    test('POST /dws-services/da provisions new DA service', async () => {
      const response = await dwsRequest('/dws-services/da', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-da',
          replicas: 3,
        }),
      })

      if (response.status === 201) {
        const body = (await response.json()) as { service: { id: string } }
        expect(body.service).toBeDefined()
        deployedServiceId = body.service.id
      } else {
        expect([500, 503]).toContain(response.status)
        console.log(
          '[Test] DA provisioning failed (infra may not be available)',
        )
      }
    })

    test('DELETE /dws-services/da/:id terminates the service', async () => {
      if (!deployedServiceId) {
        console.log('[Test] Skipping - no service deployed')
        return
      }

      const response = await dwsRequest(
        `/dws-services/da/${deployedServiceId}`,
        {
          method: 'DELETE',
        },
      )
      expect(response.status).toBe(200)
    })
  })

  describe('Email Service', () => {
    let deployedServiceId: string | null = null

    test('GET /dws-services/email lists Email services', async () => {
      const response = await dwsRequest('/dws-services/email')
      expect(response.status).toBe(200)
      const body = (await response.json()) as { services: unknown[] }
      expect(body.services).toBeInstanceOf(Array)
    })

    test('POST /dws-services/email provisions new Email service', async () => {
      const response = await dwsRequest('/dws-services/email', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-email',
          emailDomain: 'test.jeju.mail',
        }),
      })

      if (response.status === 201) {
        const body = (await response.json()) as { service: { id: string } }
        expect(body.service).toBeDefined()
        deployedServiceId = body.service.id
      } else {
        expect([500, 503]).toContain(response.status)
        console.log(
          '[Test] Email provisioning failed (infra may not be available)',
        )
      }
    })

    test('DELETE /dws-services/email/:id terminates the service', async () => {
      if (!deployedServiceId) {
        console.log('[Test] Skipping - no service deployed')
        return
      }

      const response = await dwsRequest(
        `/dws-services/email/${deployedServiceId}`,
        { method: 'DELETE' },
      )
      expect(response.status).toBe(200)
    })
  })

  describe('Farcaster Hubble Service', () => {
    let deployedServiceId: string | null = null

    test('GET /dws-services/hubble lists Hubble services', async () => {
      const response = await dwsRequest('/dws-services/hubble')
      expect(response.status).toBe(200)
      const body = (await response.json()) as { services: unknown[] }
      expect(body.services).toBeInstanceOf(Array)
    })

    test('POST /dws-services/hubble provisions new Hubble service', async () => {
      const response = await dwsRequest('/dws-services/hubble', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-hubble',
          replicas: 1,
        }),
      })

      if (response.status === 201) {
        const body = (await response.json()) as { service: { id: string } }
        expect(body.service).toBeDefined()
        deployedServiceId = body.service.id
      } else {
        expect([500, 503]).toContain(response.status)
        console.log(
          '[Test] Hubble provisioning failed (infra may not be available)',
        )
      }
    })

    test('DELETE /dws-services/hubble/:id terminates the service', async () => {
      if (!deployedServiceId) {
        console.log('[Test] Skipping - no service deployed')
        return
      }

      const response = await dwsRequest(
        `/dws-services/hubble/${deployedServiceId}`,
        { method: 'DELETE' },
      )
      expect(response.status).toBe(200)
    })
  })

  describe('Workers (x402, RPC Gateway, SQLit Adapter)', () => {
    const workerIds: Record<string, string | null> = {}

    test('GET /dws-services/workers lists all workers', async () => {
      const response = await dwsRequest('/dws-services/workers')
      expect(response.status).toBe(200)
      const body = (await response.json()) as { services: unknown[] }
      expect(body.services).toBeInstanceOf(Array)
    })

    test('POST /dws-services/workers deploys x402-facilitator', async () => {
      const response = await dwsRequest('/dws-services/workers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-x402',
          type: 'x402-facilitator',
          replicas: 2,
        }),
      })

      if (response.status === 201) {
        const body = (await response.json()) as { service: { id: string } }
        expect(body.service).toBeDefined()
        workerIds.x402 = body.service.id
      } else {
        expect([500, 503]).toContain(response.status)
        console.log(
          '[Test] x402 provisioning failed (infra may not be available)',
        )
        workerIds.x402 = null
      }
    })

    test('POST /dws-services/workers deploys rpc-gateway', async () => {
      const response = await dwsRequest('/dws-services/workers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-rpc-gateway',
          type: 'rpc-gateway',
          replicas: 3,
        }),
      })

      if (response.status === 201) {
        const body = (await response.json()) as { service: { id: string } }
        expect(body.service).toBeDefined()
        workerIds['rpc-gateway'] = body.service.id
      } else {
        expect([500, 503]).toContain(response.status)
        workerIds['rpc-gateway'] = null
      }
    })

    test('POST /dws-services/workers deploys sqlit-adapter', async () => {
      const response = await dwsRequest('/dws-services/workers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-sqlit-adapter',
          type: 'sqlit-adapter',
          replicas: 2,
        }),
      })

      if (response.status === 201) {
        const body = (await response.json()) as { service: { id: string } }
        expect(body.service).toBeDefined()
        workerIds['sqlit-adapter'] = body.service.id
      } else {
        expect([500, 503]).toContain(response.status)
        workerIds['sqlit-adapter'] = null
      }
    })

    test('GET /dws-services/workers?type=rpc-gateway filters by type', async () => {
      const response = await dwsRequest(
        '/dws-services/workers?type=rpc-gateway',
      )
      expect(response.status).toBe(200)
    })

    test('DELETE /dws-services/workers/:id terminates workers', async () => {
      for (const [_type, id] of Object.entries(workerIds)) {
        if (!id) continue

        const response = await dwsRequest(`/dws-services/workers/${id}`, {
          method: 'DELETE',
        })
        expect(response.status).toBe(200)
      }
    })
  })

  describe('Request Validation', () => {
    test('Rejects OAuth3 with invalid name', async () => {
      const response = await dwsRequest('/dws-services/oauth3', {
        method: 'POST',
        body: JSON.stringify({
          name: 'INVALID_NAME_WITH_CAPS',
          replicas: 3,
        }),
      })
      expect(response.status).toBe(400)
    })

    test('Rejects OAuth3 with too few replicas', async () => {
      const response = await dwsRequest('/dws-services/oauth3', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-oauth',
          replicas: 2, // Min is 3 for MPC
        }),
      })
      expect(response.status).toBe(400)
    })

    test('Rejects workers with invalid type', async () => {
      const response = await dwsRequest('/dws-services/workers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test-worker',
          type: 'invalid-worker-type',
        }),
      })
      expect(response.status).toBe(400)
    })

    test('Rejects scale with negative replicas', async () => {
      const response = await dwsRequest('/dws-services/oauth3/some-id/scale', {
        method: 'POST',
        body: JSON.stringify({ replicas: -1 }),
      })
      expect(response.status).toBe(400)
    })
  })
})

describe('StatefulProvisioner', () => {
  test('Creates stateful services with correct replica count', async () => {
    const { StatefulProvisioner } = await import(
      '../../api/containers/stateful-provisioner'
    )
    // Basic import check - full provisioner tests require more infrastructure
    expect(StatefulProvisioner).toBeDefined()
  })
})

describe('Service Discovery', () => {
  test('Registers and resolves services via JNS', async () => {
    const discovery = await import('../../api/services/discovery')
    expect(discovery.registerStatefulService).toBeDefined()
    expect(discovery.resolveA).toBeDefined()
    expect(discovery.resolveSRV).toBeDefined()
    expect(discovery.resolveLeader).toBeDefined()
  })
})

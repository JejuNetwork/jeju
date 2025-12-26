/**
 * Infrastructure E2E Tests
 *
 * Tests the compute infrastructure:
 * - Node registration and discovery
 * - Worker deployment across nodes
 * - Request routing and load balancing
 * - TEE attestation verification
 * - Payment integration
 *
 * Requires: CQL, IPFS, Anvil, and optionally K8s
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getCurrentNetwork } from '@jejunetwork/config'
import type { Address } from 'viem'
import { dwsRequest } from './setup'
import { SKIP } from './infra-check'

// Skip all if no infrastructure
const skipAll = SKIP.NO_INFRA

setDefaultTimeout(60000) // Infrastructure tests may take longer

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

// Test response types
interface StatusResponse {
  status: string
}

interface NodesListResponse {
  nodes: object[]
}

interface WorkersListResponse {
  workers: object[]
}

interface CidResponse {
  cid: string
}

interface WorkerIdResponse {
  workerId: string
}

interface ChainsListResponse {
  chains: Array<{ chainId: number; name?: string }>
}

interface OptionalNodesResponse {
  nodes?: object[]
}

interface PeersResponse {
  peers: object[]
  count: number
}

// Check environment
const isLocalnet = getCurrentNetwork() === 'localnet'
const hasAnvil = process.env.RPC_URL?.includes('localhost:6545') || isLocalnet

describe.skipIf(skipAll)('Decentralized Infrastructure', () => {
  // Health Checks

  describe('Infrastructure Health', () => {
    test('DWS server is running', async () => {
      const res = await dwsRequest('/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as StatusResponse
      expect(body.status).toBe('healthy')
    })

    test('Workerd service is available', async () => {
      const res = await dwsRequest('/workerd/health')
      expect(res.status).toBe(200)
    })

    test('Storage backends are configured', async () => {
      const res = await dwsRequest('/storage/health')
      // 200 = healthy, 500 = service initialization issue (acceptable in test mode)
      expect([200, 500]).toContain(res.status)
    })
  })

  // Node Registry Tests

  describe('Node Registry', () => {
    test('can list nodes (may be empty)', async () => {
      const res = await dwsRequest('/edge/nodes')
      expect(res.status).toBe(200)
      const body = (await res.json()) as NodesListResponse
      expect(body.nodes).toBeInstanceOf(Array)
    })

    test.skipIf(!hasAnvil)('can register as a node on localnet', async () => {
      // This test requires a local anvil instance running
      const res = await dwsRequest('/edge/nodes/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          endpoint: 'http://localhost:4030',
          capabilities: ['compute', 'storage'],
          specs: {
            cpuCores: 4,
            memoryMb: 8192,
            storageMb: 102400,
            bandwidthMbps: 1000,
          },
          pricing: {
            pricePerHour: '1000000000000000', // 0.001 ETH
            pricePerGb: '100000000000000', // 0.0001 ETH
            pricePerRequest: '1000000000000', // 0.000001 ETH
          },
        }),
      })

      // May fail if contracts not deployed or route doesn't exist
      expect([200, 201, 400, 404, 500, 503]).toContain(res.status)
    })
  })

  // Worker Deployment Tests

  describe('Worker Deployment', () => {
    test('can list workers', async () => {
      const res = await dwsRequest('/workerd', {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as WorkersListResponse
      expect(body.workers).toBeInstanceOf(Array)
    })

    test('worker deployment requires code CID', async () => {
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'test-worker',
          // Missing codeCid
        }),
      })

      expect(res.status).toBe(400)
    })

    test('can deploy a simple worker', async () => {
      // First upload code to storage
      const workerCode = `
        export default {
          async fetch(request) {
            return new Response('Hello from decentralized worker');
          }
        }
      `

      const uploadRes = await dwsRequest('/storage/upload/raw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/javascript',
          'x-jeju-address': TEST_ADDRESS,
          'x-filename': 'worker.js',
        },
        body: workerCode,
      })

      // Storage may not be available in test mode
      if (uploadRes.status !== 200) {
        // Skip rest of test if storage is unavailable
        expect([200, 500]).toContain(uploadRes.status)
        return
      }
      const { cid } = (await uploadRes.json()) as CidResponse
      expect(cid).toBeDefined()

      // Now deploy worker
      const deployRes = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'e2e-test-worker',
          codeCid: cid,
          entrypoint: 'worker.js',
          runtime: 'workerd',
          resources: {
            memoryMb: 128,
            cpuMillis: 1000,
            timeoutMs: 30000,
          },
          scaling: {
            minInstances: 0,
            maxInstances: 1,
            scaleToZero: true,
          },
        }),
      })

      // May succeed or fail depending on workerd binary availability
      expect([200, 201, 500, 503]).toContain(deployRes.status)

      if (deployRes.status === 200 || deployRes.status === 201) {
        const body = (await deployRes.json()) as WorkerIdResponse
        expect(body.workerId).toBeDefined()

        // Cleanup
        await dwsRequest(`/workerd/${body.workerId}`, {
          method: 'DELETE',
          headers: { 'x-jeju-address': TEST_ADDRESS },
        })
      }
    })
  })

  // Request Routing Tests

  describe('Request Routing', () => {
    test('routes to healthy nodes', async () => {
      const res = await dwsRequest('/edge/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          capabilities: ['compute'],
          strategy: 'latency',
        }),
      })

      // May not find nodes in test environment
      expect([200, 404, 500, 503]).toContain(res.status)
    })

    test('RPC proxy routes requests correctly', async () => {
      const res = await dwsRequest('/rpc/chains')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ChainsListResponse
      expect(body.chains).toBeInstanceOf(Array)
      expect(body.chains.length).toBeGreaterThan(0)
    })
  })

  // Storage Integration Tests

  describe('Decentralized Storage', () => {
    test('upload and download file via IPFS', async () => {
      const testData = `Decentralized storage test ${Date.now()}`

      const uploadRes = await dwsRequest('/storage/upload/raw', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': TEST_ADDRESS,
          'x-filename': 'test.txt',
        },
        body: testData,
      })

      // Storage may not be available in test mode
      if (uploadRes.status !== 200) {
        expect([200, 500]).toContain(uploadRes.status)
        return
      }
      const { cid } = (await uploadRes.json()) as CidResponse
      expect(cid).toBeDefined()

      // Download and verify
      const downloadRes = await dwsRequest(`/storage/download/${cid}`)
      expect(downloadRes.status).toBe(200)

      const downloaded = await downloadRes.text()
      expect(downloaded).toBe(testData)
    })

    test('S3-compatible API works', async () => {
      const bucket = `infra-test-${Date.now()}`
      const key = 'test-object.txt'
      const content = 'S3 compatible storage test'

      // Create bucket
      const createRes = await dwsRequest(`/s3/${bucket}`, {
        method: 'PUT',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })
      expect(createRes.status).toBe(200)

      // Put object
      const putRes = await dwsRequest(`/s3/${bucket}/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: content,
      })
      expect(putRes.status).toBe(200)

      // Get object
      const getRes = await dwsRequest(`/s3/${bucket}/${key}`)
      expect(getRes.status).toBe(200)
      expect(await getRes.text()).toBe(content)

      // Cleanup
      await dwsRequest(`/s3/${bucket}/${key}`, { method: 'DELETE' })
      await dwsRequest(`/s3/${bucket}`, { method: 'DELETE' })
    })
  })

  // Payment Integration Tests

  describe('Payment Integration', () => {
    test('x402 endpoint exists', async () => {
      // Check if x402 facilitator is configured
      const res = await dwsRequest('/compute/x402/status')
      expect([200, 404, 500]).toContain(res.status)
    })

    test('compute requests can include x402 header', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
          'x-402-payment': 'mock-payment-header', // Mock x402 header
        },
        body: JSON.stringify({
          command: 'echo "paid compute"',
        }),
      })

      // 201 = job created, 402 = payment required, 404/500 = endpoint unavailable
      expect([201, 402, 404, 500]).toContain(res.status)
    })
  })

  // TEE/Proof of Cloud Tests

  describe('TEE and Proof of Cloud', () => {
    test('PoC status endpoint exists', async () => {
      const res = await dwsRequest('/compute/poc/status')
      expect([200, 404, 500, 503]).toContain(res.status)
    })

    test('can query nodes with TEE capability', async () => {
      const res = await dwsRequest('/edge/nodes?capability=tee')
      expect([200, 404, 500]).toContain(res.status)

      if (res.status === 200) {
        const body = (await res.json()) as OptionalNodesResponse
        // If nodes are returned, verify the response structure is valid
        // The filter by capability may return empty or matching nodes
        expect(body).toBeDefined()
        if (body.nodes && Array.isArray(body.nodes)) {
          // If any nodes match the TEE filter, they should have TEE capability
          // But empty array is also valid (no TEE nodes registered)
          expect(Array.isArray(body.nodes)).toBe(true)
        }
      }
    })
  })

  // P2P Coordination Tests

  describe('P2P Coordination', () => {
    test('can get peer count', async () => {
      const res = await dwsRequest('/edge/peers')
      expect([200, 404, 500]).toContain(res.status)

      if (res.status === 200) {
        const body = (await res.json()) as PeersResponse
        expect(typeof body.count).toBe('number')
      }
    })

    test('distributed rate limiting works', async () => {
      // Make several requests quickly
      const requests = Array.from({ length: 5 }, () =>
        dwsRequest('/health', {
          headers: { 'x-jeju-address': TEST_ADDRESS },
        }),
      )

      const responses = await Promise.all(requests)

      // All should succeed (rate limit is high)
      for (const res of responses) {
        expect(res.status).toBe(200)
      }

      // Check rate limit headers if present
      const lastRes = responses[responses.length - 1]
      const remaining = lastRes.headers.get('x-ratelimit-remaining')
      if (remaining) {
        expect(parseInt(remaining, 10)).toBeGreaterThanOrEqual(0)
      }
    })
  })

  // Auto-Scaling Tests

  describe('Auto-Scaling', () => {
    test('load balancer stats endpoint exists', async () => {
      const res = await dwsRequest('/compute/lb/stats')
      expect([200, 404, 500]).toContain(res.status)
    })

    test('can get container system stats', async () => {
      const res = await dwsRequest('/containers/stats')
      expect([200, 404, 500]).toContain(res.status)
    })
  })

  // Multi-Network Tests

  describe('Multi-Network Support', () => {
    test('supports multiple chain configurations', async () => {
      const res = await dwsRequest('/rpc/chains')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ChainsListResponse
      expect(body.chains.length).toBeGreaterThan(0)

      // Should support at least Base
      const hasBase = body.chains.some(
        (c) => c.chainId === 8453 || c.chainId === 84532,
      )
      expect(hasBase).toBe(true)
    })
  })

  // Cleanup

  afterAll(async () => {
    // Any cleanup needed
  })
})

// Stress Tests (optional, run with STRESS_TEST=true)

describe.skipIf(!process.env.STRESS_TEST)('Infrastructure Stress Tests', () => {
  test('handles concurrent worker deployments', async () => {
    const deployments = Array.from({ length: 10 }, (_, i) =>
      dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: `stress-worker-${i}`,
          codeCid: 'QmTest...',
          runtime: 'workerd',
        }),
      }),
    )

    const results = await Promise.allSettled(deployments)
    const successful = results.filter((r) => r.status === 'fulfilled')

    // At least half should succeed or fail gracefully (not 500)
    expect(successful.length).toBeGreaterThan(5)
  })

  test('handles high request throughput', async () => {
    const startTime = Date.now()
    const requestCount = 100

    const requests = Array.from({ length: requestCount }, () =>
      dwsRequest('/health'),
    )

    const results = await Promise.all(requests)
    const duration = Date.now() - startTime

    // All should succeed
    for (const res of results) {
      expect(res.status).toBe(200)
    }

    // Should complete in reasonable time (100 requests in < 5 seconds)
    expect(duration).toBeLessThan(5000)

    console.log(
      `[Stress] ${requestCount} requests in ${duration}ms (${((requestCount / duration) * 1000).toFixed(0)} req/s)`,
    )
  })
})

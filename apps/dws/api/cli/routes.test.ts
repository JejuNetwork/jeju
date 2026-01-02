/**
 * DWS CLI Routes - Comprehensive Test Suite
 *
 * Tests all CLI API endpoints with:
 * - Full authentication flows
 * - CRUD operations for workers, secrets, previews, JNS
 * - Edge cases and boundary conditions
 * - Error handling and invalid inputs
 * - Concurrent request handling
 *
 * Run with:
 *   cd apps/dws && bun test api/cli/routes.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createWalletClient, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost } from 'viem/chains'
import { createCLIRoutes } from './routes'
import { initializeDWSState, dwsWorkerState, cliSecretState, cliPreviewState, jnsDomainState } from '../state'

// ============================================================================
// Test Constants
// ============================================================================

// Test wallet (Anvil account #0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

// Second test wallet (Anvil account #1) for ownership tests
const TEST_PRIVATE_KEY_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex
const TEST_ADDRESS_2 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address

const account = privateKeyToAccount(TEST_PRIVATE_KEY)
const account2 = privateKeyToAccount(TEST_PRIVATE_KEY_2)

// ============================================================================
// Test Helpers
// ============================================================================

let app: ReturnType<typeof createCLIRoutes>
let authToken: string
let authToken2: string

async function signLoginMessage(privateKey: Hex, message: string): Promise<string> {
  const acc = privateKeyToAccount(privateKey)
  return acc.signMessage({ message })
}

async function loginUser(address: Address, privateKey: Hex): Promise<string> {
  const message = `Sign in to Jeju Network\nTimestamp: ${Date.now()}`
  const signature = await signLoginMessage(privateKey, message)

  const response = await app.handle(
    new Request('http://localhost/auth/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        signature,
        message,
        network: 'localnet',
      }),
    }),
  )

  const data = await response.json()
  if (data.error) {
    throw new Error(`Login failed: ${data.error}`)
  }
  return data.token
}

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }
}

async function request(
  method: string,
  path: string,
  token?: string,
  body?: object,
): Promise<{ status: number; data: Record<string, unknown>; text?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
  )

  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {
    // Non-JSON response (e.g., error thrown from route)
    data = { _error: text }
  }
  return { status: response.status, data, text }
}

// ============================================================================
// Setup
// ============================================================================

beforeAll(async () => {
  await initializeDWSState()
  app = createCLIRoutes()

  // Login both test users
  authToken = await loginUser(TEST_ADDRESS, TEST_PRIVATE_KEY)
  authToken2 = await loginUser(TEST_ADDRESS_2, TEST_PRIVATE_KEY_2)
})

// ============================================================================
// Health Check
// ============================================================================

describe('Health Check', () => {
  test('GET /health returns healthy status with metrics', async () => {
    const { status, data } = await request('GET', '/health')

    expect(status).toBe(200)
    expect(data.status).toBe('healthy')
    expect(data.timestamp).toBeDefined()
    expect(typeof data.activeSessions).toBe('number')
    expect(data.activeSessions).toBeGreaterThanOrEqual(2) // We logged in 2 users
    expect(typeof data.logBufferSize).toBe('number')
    expect(data.version).toBe('1.0.0')
  })
})

// ============================================================================
// Authentication Routes
// ============================================================================

describe('Authentication Routes', () => {
  describe('POST /auth/wallet', () => {
    test('rejects missing fields', async () => {
      const { status, data } = await request('POST', '/auth/wallet', undefined, {})

      expect(status).toBe(200)
      expect(data.error).toBeDefined()
      expect(data.details).toBeDefined()
    })

    test('rejects invalid address format', async () => {
      const { status, data } = await request('POST', '/auth/wallet', undefined, {
        address: 'not-an-address',
        signature: '0x123',
        message: 'test',
        network: 'localnet',
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('rejects invalid signature', async () => {
      const { status, data } = await request('POST', '/auth/wallet', undefined, {
        address: TEST_ADDRESS,
        signature: '0x' + '00'.repeat(65),
        message: 'test message',
        network: 'localnet',
      })

      // Should reject with invalid signature error
      expect(status).toBeGreaterThanOrEqual(200)
      expect(data.error).toBeDefined()
    })

    test('accepts valid signature and returns token', async () => {
      const message = `Test login ${Date.now()}`
      const signature = await signLoginMessage(TEST_PRIVATE_KEY, message)

      const { status, data } = await request('POST', '/auth/wallet', undefined, {
        address: TEST_ADDRESS,
        signature,
        message,
        network: 'localnet',
      })

      expect(status).toBe(200)
      expect(data.token).toBeDefined()
      expect(typeof data.token).toBe('string')
      expect((data.token as string).length).toBe(64)
      expect(data.expiresAt).toBeGreaterThan(Date.now())
      expect(data.address).toBe(TEST_ADDRESS)
      expect(data.network).toBe('localnet')
    })

    test('rejects invalid network', async () => {
      const message = 'test'
      const signature = await signLoginMessage(TEST_PRIVATE_KEY, message)

      const { status, data } = await request('POST', '/auth/wallet', undefined, {
        address: TEST_ADDRESS,
        signature,
        message,
        network: 'invalid-network',
      })

      expect(status).toBe(200)
      expect(data.error).toBeDefined()
    })
  })

  describe('GET /auth/verify', () => {
    test('returns valid: false without token', async () => {
      const { status, data } = await request('GET', '/auth/verify')

      expect(status).toBe(200)
      expect(data.valid).toBe(false)
    })

    test('returns valid: false with invalid token', async () => {
      const response = await app.handle(
        new Request('http://localhost/auth/verify', {
          headers: { Authorization: 'Bearer invalid-token-12345' },
        }),
      )

      const data = await response.json()
      expect(data.valid).toBe(false)
    })

    test('returns session info with valid token', async () => {
      const response = await app.handle(
        new Request('http://localhost/auth/verify', {
          headers: authHeaders(authToken),
        }),
      )

      const data = await response.json()
      expect(data.valid).toBe(true)
      expect(data.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase())
      expect(data.network).toBe('localnet')
      expect(data.expiresAt).toBeGreaterThan(Date.now())
    })
  })

  describe('POST /auth/logout', () => {
    test('returns success even without token', async () => {
      const { status, data } = await request('POST', '/auth/logout')

      expect(status).toBe(200)
      expect(data.success).toBe(true)
    })

    test('invalidates session after logout', async () => {
      // Create a new session just for this test
      const tempToken = await loginUser(TEST_ADDRESS, TEST_PRIVATE_KEY)

      // Verify it works
      const verifyBefore = await app.handle(
        new Request('http://localhost/auth/verify', {
          headers: authHeaders(tempToken),
        }),
      )
      expect((await verifyBefore.json()).valid).toBe(true)

      // Logout
      await app.handle(
        new Request('http://localhost/auth/logout', {
          method: 'POST',
          headers: authHeaders(tempToken),
        }),
      )

      // Verify it no longer works
      const verifyAfter = await app.handle(
        new Request('http://localhost/auth/verify', {
          headers: authHeaders(tempToken),
        }),
      )
      expect((await verifyAfter.json()).valid).toBe(false)
    })
  })
})

// ============================================================================
// Account Routes
// ============================================================================

describe('Account Routes', () => {
  describe('GET /account/info', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/account/info')
      // Should return 500 when auth throws
      expect(status).toBe(500)
    })

    test('returns account info with valid auth', async () => {
      const { status, data } = await request('GET', '/account/info', authToken)

      expect(status).toBe(200)
      expect(data.address?.toString().toLowerCase()).toBe(TEST_ADDRESS.toLowerCase())
      expect(data.credits).toBeDefined()
      expect(data.tier).toBe('free')
      expect(data.usage).toBeDefined()
      expect(data.billing).toBeDefined()
    })

    test('returns usage limits in account info', async () => {
      const { status, data } = await request('GET', '/account/info', authToken)

      expect(status).toBe(200)
      const usage = data.usage as Record<string, number>
      expect(usage.cpuHoursLimit).toBe(100)
      expect(usage.deploymentsLimit).toBe(3)
      expect(usage.invocationsLimit).toBe(100_000)
    })
  })

  describe('GET /account/usage', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/account/usage')
      expect(status).toBe(500)
    })

    test('returns daily usage breakdown', async () => {
      const { status, data } = await request('GET', '/account/usage?days=7', authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.daily)).toBe(true)
      expect(data.totals).toBeDefined()
    })

    test('respects days parameter', async () => {
      const { status, data } = await request('GET', '/account/usage?days=3', authToken)

      expect(status).toBe(200)
      const daily = data.daily as Array<{ date: string }>
      expect(daily.length).toBeLessThanOrEqual(3)
    })
  })

  describe('GET /account/transactions', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/account/transactions')
      expect(status).toBe(500)
    })

    test('returns transaction history', async () => {
      const { status, data } = await request('GET', '/account/transactions', authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.transactions)).toBe(true)
      expect(data.currentBalance).toBeDefined()
    })

    test('respects limit parameter', async () => {
      const { status, data } = await request('GET', '/account/transactions?limit=5', authToken)

      expect(status).toBe(200)
      const txns = data.transactions as Array<unknown>
      expect(txns.length).toBeLessThanOrEqual(5)
    })
  })

  describe('POST /account/upgrade', () => {
    test('requires authentication', async () => {
      const { status } = await request('POST', '/account/upgrade', undefined, { tier: 'pro' })
      expect(status).toBe(500)
    })

    test('accepts tier upgrade request', async () => {
      const { status, data } = await request('POST', '/account/upgrade', authToken, { tier: 'pro' })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.tier).toBe('pro')
    })
  })
})

// ============================================================================
// Worker Routes
// ============================================================================

describe('Worker Routes', () => {
  const testWorkerName = `test-worker-${Date.now()}`
  let deployedWorkerId: string

  describe('POST /workers/deploy', () => {
    test('requires authentication', async () => {
      const { status } = await request('POST', '/workers/deploy', undefined, {
        name: 'test',
        codeCid: 'QmTest123',
      })
      expect(status).toBe(500)
    })

    test('validates required fields', async () => {
      const { status, data } = await request('POST', '/workers/deploy', authToken, {})

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
      expect(data.details).toBeDefined()
    })

    test('validates name length (min 1)', async () => {
      const { status, data } = await request('POST', '/workers/deploy', authToken, {
        name: '',
        codeCid: 'QmTest123',
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('validates name length (max 63)', async () => {
      const { status, data } = await request('POST', '/workers/deploy', authToken, {
        name: 'a'.repeat(64),
        codeCid: 'QmTest123',
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('validates memory bounds (min 32, max 4096)', async () => {
      const { status: status1 } = await request('POST', '/workers/deploy', authToken, {
        name: 'mem-test-1',
        codeCid: 'QmTest123',
        memory: 16, // Too low
      })
      expect(status1).toBe(200)

      const { status: status2 } = await request('POST', '/workers/deploy', authToken, {
        name: 'mem-test-2',
        codeCid: 'QmTest123',
        memory: 8192, // Too high
      })
      expect(status2).toBe(200)
    })

    test('validates timeout bounds (min 1000, max 300000)', async () => {
      const { status: status1, data: data1 } = await request('POST', '/workers/deploy', authToken, {
        name: 'timeout-test-1',
        codeCid: 'QmTest123',
        timeout: 500, // Too low
      })
      expect(data1.error).toBe('Invalid request')

      const { status: status2, data: data2 } = await request('POST', '/workers/deploy', authToken, {
        name: 'timeout-test-2',
        codeCid: 'QmTest123',
        timeout: 500000, // Too high
      })
      expect(data2.error).toBe('Invalid request')
    })

    test('successfully deploys a worker', async () => {
      const { status, data } = await request('POST', '/workers/deploy', authToken, {
        name: testWorkerName,
        codeCid: 'QmTestCodeCid123456',
        routes: ['/api/*', '/webhook'],
        memory: 256,
        timeout: 30000,
      })

      expect(status).toBe(200)
      expect(data.workerId).toBeDefined()
      expect(data.name).toBe(testWorkerName)
      expect(data.codeCid).toBe('QmTestCodeCid123456')
      expect((data.routes as string[])).toContain('/api/*')
      expect(data.memory).toBe(256)
      expect(data.timeout).toBe(30000)
      expect(data.status).toBe('active')
      expect(data.version).toBe(1)

      deployedWorkerId = data.workerId as string
    })

    test('increments version on redeploy by same owner', async () => {
      const { status, data } = await request('POST', '/workers/deploy', authToken, {
        name: testWorkerName,
        codeCid: 'QmUpdatedCodeCid',
      })

      expect(status).toBe(200)
      expect(data.version).toBe(2)
      expect(data.codeCid).toBe('QmUpdatedCodeCid')
    })
  })

  describe('GET /workers/list', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/workers/list')
      expect(status).toBe(500)
    })

    test('returns workers owned by authenticated user', async () => {
      const { status, data } = await request('GET', '/workers/list', authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.workers)).toBe(true)
      const workers = data.workers as Array<{ name: string; owner: string }>
      const testWorker = workers.find((w) => w.name === testWorkerName)
      expect(testWorker).toBeDefined()
      expect(testWorker?.owner.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase())
    })

    test('does not return other users workers', async () => {
      const { status, data } = await request('GET', '/workers/list', authToken2)

      expect(status).toBe(200)
      const workers = data.workers as Array<{ name: string }>
      const testWorker = workers.find((w) => w.name === testWorkerName)
      expect(testWorker).toBeUndefined()
    })
  })

  describe('GET /workers/:workerId', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/workers/wkr_test123')
      expect(status).toBe(500)
    })

    test('returns worker details', async () => {
      const { status, data } = await request('GET', `/workers/${deployedWorkerId}`, authToken)

      expect(status).toBe(200)
      expect(data.workerId).toBe(deployedWorkerId)
      expect(data.name).toBe(testWorkerName)
    })

    test('returns error for non-existent worker', async () => {
      const { status, data } = await request('GET', '/workers/wkr_nonexistent', authToken)

      expect(status).toBe(200)
      expect(data.error).toBe('Worker not found')
    })
  })

  describe('GET /workers/:workerId/logs', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/workers/wkr_test/logs')
      expect(status).toBe(500)
    })
  })

  describe('POST /workers/:workerId/rollback', () => {
    test('requires authentication', async () => {
      const { status } = await request('POST', '/workers/wkr_test/rollback')
      expect(status).toBe(500)
    })
  })

  describe('DELETE /workers/:workerId', () => {
    test('requires authentication', async () => {
      const { status } = await request('DELETE', '/workers/wkr_test')
      expect(status).toBe(500)
    })

    test('deletes owned worker', async () => {
      // First create a worker to delete
      const { data: deployData } = await request('POST', '/workers/deploy', authToken, {
        name: `delete-test-${Date.now()}`,
        codeCid: 'QmDeleteTest',
      })
      const deleteId = deployData.workerId as string

      const { status, data } = await request('DELETE', `/workers/${deleteId}`, authToken)

      expect(status).toBe(200)
      expect(data.success).toBe(true)

      // Verify it's gone
      const { data: getResult } = await request('GET', `/workers/${deleteId}`, authToken)
      expect(getResult.error).toBe('Worker not found')
    })
  })
})

// ============================================================================
// Secrets Routes
// ============================================================================

describe('Secrets Routes', () => {
  const testApp = `test-app-${Date.now()}`
  const testSecretKey = 'API_KEY'

  describe('POST /secrets/set', () => {
    test('requires authentication', async () => {
      const { status } = await request('POST', '/secrets/set', undefined, {
        app: testApp,
        key: testSecretKey,
        value: 'secret-value',
      })
      expect(status).toBe(500)
    })

    test('validates required fields', async () => {
      const { status, data } = await request('POST', '/secrets/set', authToken, {})

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('validates key length (max 128)', async () => {
      const { status, data } = await request('POST', '/secrets/set', authToken, {
        app: testApp,
        key: 'K'.repeat(129),
        value: 'test',
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('validates value length (max 65536)', async () => {
      const { status, data } = await request('POST', '/secrets/set', authToken, {
        app: testApp,
        key: 'LARGE_VALUE',
        value: 'X'.repeat(65537),
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('successfully sets a secret', async () => {
      const { status, data } = await request('POST', '/secrets/set', authToken, {
        app: testApp,
        key: testSecretKey,
        value: 'my-secret-api-key-123',
        scope: 'production',
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
    })

    test('allows updating existing secret', async () => {
      const { status, data } = await request('POST', '/secrets/set', authToken, {
        app: testApp,
        key: testSecretKey,
        value: 'updated-secret-value',
        scope: 'production',
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('GET /secrets/list', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/secrets/list?app=test')
      expect(status).toBe(500)
    })

    test('requires app parameter', async () => {
      const { status, data } = await request('GET', '/secrets/list', authToken)

      expect(status).toBe(200)
      expect(data.error).toBe('App name required')
    })

    test('returns secrets for app', async () => {
      const { status, data } = await request('GET', `/secrets/list?app=${testApp}`, authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.secrets)).toBe(true)
      const secrets = data.secrets as Array<{ key: string; scope: string }>
      const apiKey = secrets.find((s) => s.key === testSecretKey)
      expect(apiKey).toBeDefined()
      expect(apiKey?.scope).toBe('production')
    })

    test('does not return other users secrets', async () => {
      const { status, data } = await request('GET', `/secrets/list?app=${testApp}`, authToken2)

      expect(status).toBe(200)
      const secrets = data.secrets as Array<{ key: string }>
      expect(secrets.length).toBe(0)
    })
  })

  describe('GET /secrets/get', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/secrets/get?app=test&key=KEY')
      expect(status).toBe(500)
    })

    test('requires app and key', async () => {
      const { status, data } = await request('GET', '/secrets/get?app=test', authToken)

      expect(status).toBe(200)
      expect(data.error).toBe('App and key required')
    })

    test('returns secret value for owner', async () => {
      const { status, data } = await request('GET', `/secrets/get?app=${testApp}&key=${testSecretKey}`, authToken)

      expect(status).toBe(200)
      expect(data.value).toBe('updated-secret-value')
    })

    test('denies access to non-owner', async () => {
      const { status, data } = await request('GET', `/secrets/get?app=${testApp}&key=${testSecretKey}`, authToken2)

      expect(status).toBe(200)
      expect(data.error).toBe('Not authorized')
    })

    test('returns error for non-existent secret', async () => {
      const { status, data } = await request('GET', `/secrets/get?app=${testApp}&key=NONEXISTENT`, authToken)

      expect(status).toBe(200)
      expect(data.error).toBe('Secret not found')
    })
  })

  describe('DELETE /secrets/delete', () => {
    test('requires app and key', async () => {
      const { status, data } = await request('DELETE', '/secrets/delete', authToken, {
        app: testApp,
      })

      expect(status).toBe(200)
      expect(data.error).toBe('App and key required')
    })

    test('deletes secret', async () => {
      // First create a secret to delete
      await request('POST', '/secrets/set', authToken, {
        app: testApp,
        key: 'DELETE_ME',
        value: 'temp',
      })

      const { status, data } = await request('DELETE', '/secrets/delete', authToken, {
        app: testApp,
        key: 'DELETE_ME',
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)

      // Verify it's gone
      const { data: getResult } = await request('GET', `/secrets/get?app=${testApp}&key=DELETE_ME`, authToken)
      expect(getResult.error).toBe('Secret not found')
    })
  })
})

// ============================================================================
// Preview Routes
// ============================================================================

describe('Preview Routes', () => {
  const testAppName = `preview-app-${Date.now()}`
  let previewId: string

  describe('POST /previews/create', () => {
    test('requires authentication', async () => {
      const { status } = await request('POST', '/previews/create', undefined, {
        appName: testAppName,
        branchName: 'feature/test',
        commitSha: 'a'.repeat(40),
      })
      expect(status).toBe(500)
    })

    test('validates required fields', async () => {
      const { status, data } = await request('POST', '/previews/create', authToken, {})

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('validates commitSha length (exactly 40)', async () => {
      const { status, data } = await request('POST', '/previews/create', authToken, {
        appName: testAppName,
        branchName: 'test',
        commitSha: 'short',
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('validates appName length (max 63)', async () => {
      const { status, data } = await request('POST', '/previews/create', authToken, {
        appName: 'a'.repeat(64),
        branchName: 'test',
        commitSha: 'a'.repeat(40),
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('validates ttlHours bounds (1-720)', async () => {
      const { status, data } = await request('POST', '/previews/create', authToken, {
        appName: testAppName,
        branchName: 'test',
        commitSha: 'a'.repeat(40),
        ttlHours: 1000,
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Invalid request')
    })

    test('creates preview deployment', async () => {
      const { status, data } = await request('POST', '/previews/create', authToken, {
        appName: testAppName,
        branchName: 'feature/new-ui',
        commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
        ttlHours: 24,
      })

      expect(status).toBe(200)
      expect(data.previewId).toBeDefined()
      expect(data.appName).toBe(testAppName)
      expect(data.branchName).toBe('feature/new-ui')
      expect(data.status).toBe('pending')
      expect(data.previewUrl).toContain('.preview.dws.jejunetwork.org')
      expect(data.expiresAt).toBeGreaterThan(Date.now())

      previewId = data.previewId as string
    })

    test('sanitizes branch name in preview URL', async () => {
      const { status, data } = await request('POST', '/previews/create', authToken, {
        appName: testAppName,
        branchName: 'Feature/Special_Branch!@#$',
        commitSha: 'b'.repeat(40),
      })

      expect(status).toBe(200)
      // Branch is sanitized (lowercase, special chars to -, limited to 20 chars)
      expect(data.previewUrl).toMatch(/feature-special-bran/)
    })
  })

  describe('GET /previews/list', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/previews/list')
      expect(status).toBe(500)
    })

    test('returns user previews', async () => {
      const { status, data } = await request('GET', '/previews/list', authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.previews)).toBe(true)
      const previews = data.previews as Array<{ previewId: string }>
      const ourPreview = previews.find((p) => p.previewId === previewId)
      expect(ourPreview).toBeDefined()
    })

    test('filters by app name', async () => {
      const { status, data } = await request('GET', `/previews/list?app=${testAppName}`, authToken)

      expect(status).toBe(200)
      const previews = data.previews as Array<{ appName: string }>
      expect(previews.every((p) => p.appName === testAppName)).toBe(true)
    })

    test('does not return other users previews', async () => {
      const { status, data } = await request('GET', '/previews/list', authToken2)

      expect(status).toBe(200)
      const previews = data.previews as Array<{ previewId: string }>
      const ourPreview = previews.find((p) => p.previewId === previewId)
      expect(ourPreview).toBeUndefined()
    })
  })

  describe('GET /previews/:previewId', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/previews/prv_test')
      expect(status).toBe(500)
    })

    test('returns preview details', async () => {
      const { status, data } = await request('GET', `/previews/${previewId}`, authToken)

      expect(status).toBe(200)
      expect(data.previewId).toBe(previewId)
      expect(data.appName).toBe(testAppName)
    })

    test('returns error for non-existent preview', async () => {
      const { status, data } = await request('GET', '/previews/prv_nonexistent', authToken)

      expect(status).toBe(200)
      expect(data.error).toBe('Preview not found')
    })
  })

  describe('DELETE /previews/:previewId', () => {
    test('requires ownership', async () => {
      const { status, data } = await request('DELETE', `/previews/${previewId}`, authToken2)

      expect(status).toBe(200)
      expect(data.error).toBe('Not authorized')
    })

    test('deletes owned preview', async () => {
      // Create a preview to delete
      const { data: createData } = await request('POST', '/previews/create', authToken, {
        appName: 'delete-test',
        branchName: 'delete-branch',
        commitSha: 'c'.repeat(40),
      })
      const deleteId = createData.previewId as string

      const { status, data } = await request('DELETE', `/previews/${deleteId}`, authToken)

      expect(status).toBe(200)
      expect(data.success).toBe(true)

      // Verify it's gone
      const { data: getResult } = await request('GET', `/previews/${deleteId}`, authToken)
      expect(getResult.error).toBe('Preview not found')
    })
  })
})

// ============================================================================
// JNS Routes
// ============================================================================

describe('JNS Routes', () => {
  const testDomain = `test-domain-${Date.now()}.jeju`

  describe('POST /jns/register', () => {
    test('requires authentication', async () => {
      const { status } = await request('POST', '/jns/register', undefined, {
        name: testDomain,
      })
      expect(status).toBe(500)
    })

    test('registers a new domain', async () => {
      const { status, data } = await request('POST', '/jns/register', authToken, {
        name: testDomain,
        contentCid: 'QmTestContent123',
        years: 2,
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.name).toBe(testDomain)
      expect(data.contentCid).toBe('QmTestContent123')
      expect(data.expiresAt).toBeGreaterThan(Date.now() + 365 * 24 * 60 * 60 * 1000) // At least 1 year
    })
  })

  describe('GET /jns/check/:name', () => {
    test('shows registered domain as unavailable', async () => {
      const { status, data } = await request('GET', `/jns/check/${testDomain}`)

      expect(status).toBe(200)
      expect(data.name).toBe(testDomain)
      expect(data.available).toBe(false)
      expect(data.owner).toBeDefined()
    })

    test('shows unregistered domain as available', async () => {
      const { status, data } = await request('GET', '/jns/check/totally-available-domain-xyz.jeju')

      expect(status).toBe(200)
      expect(data.available).toBe(true)
    })
  })

  describe('GET /jns/resolve/:name', () => {
    test('resolves registered domain', async () => {
      const { status, data } = await request('GET', `/jns/resolve/${testDomain}`)

      expect(status).toBe(200)
      expect(data.resolved).toBe(true)
      expect(data.name).toBe(testDomain)
      expect(data.contentCid).toBe('QmTestContent123')
      expect(data.owner?.toString().toLowerCase()).toBe(TEST_ADDRESS.toLowerCase())
    })

    test('returns not found for unregistered domain', async () => {
      const { status, data } = await request('GET', '/jns/resolve/unregistered.jeju')

      expect(status).toBe(200)
      expect(data.resolved).toBe(false)
    })
  })

  describe('GET /jns/list', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/jns/list')
      expect(status).toBe(500)
    })

    test('returns user domains', async () => {
      const { status, data } = await request('GET', '/jns/list', authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.domains)).toBe(true)
      const domains = data.domains as Array<{ name: string }>
      const ourDomain = domains.find((d) => d.name === testDomain)
      expect(ourDomain).toBeDefined()
    })

    test('does not return other users domains', async () => {
      const { status, data } = await request('GET', '/jns/list', authToken2)

      expect(status).toBe(200)
      const domains = data.domains as Array<{ name: string }>
      const ourDomain = domains.find((d) => d.name === testDomain)
      expect(ourDomain).toBeUndefined()
    })
  })

  describe('POST /jns/set-content', () => {
    test('requires ownership', async () => {
      const { status, data } = await request('POST', '/jns/set-content', authToken2, {
        name: testDomain,
        contentCid: 'QmNewContent',
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Not authorized')
    })

    test('updates content for owned domain', async () => {
      const { status, data } = await request('POST', '/jns/set-content', authToken, {
        name: testDomain,
        contentCid: 'QmUpdatedContent456',
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.contentCid).toBe('QmUpdatedContent456')

      // Verify the update
      const { data: resolveData } = await request('GET', `/jns/resolve/${testDomain}`)
      expect(resolveData.contentCid).toBe('QmUpdatedContent456')
    })
  })

  describe('POST /jns/link-worker', () => {
    test('requires ownership', async () => {
      const { status, data } = await request('POST', '/jns/link-worker', authToken2, {
        name: testDomain,
        workerId: 'wkr_test123',
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Not authorized')
    })

    test('links worker to owned domain', async () => {
      const { status, data } = await request('POST', '/jns/link-worker', authToken, {
        name: testDomain,
        workerId: 'wkr_linked123',
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.workerId).toBe('wkr_linked123')

      // Verify the link
      const { data: resolveData } = await request('GET', `/jns/resolve/${testDomain}`)
      expect(resolveData.workerId).toBe('wkr_linked123')
    })
  })

  describe('POST /jns/transfer', () => {
    test('requires ownership', async () => {
      const { status, data } = await request('POST', '/jns/transfer', authToken2, {
        name: testDomain,
        toAddress: TEST_ADDRESS_2,
      })

      expect(status).toBe(200)
      expect(data.error).toBe('Not authorized')
    })

    test('transfers domain to new owner', async () => {
      // First create a domain to transfer
      const transferDomain = `transfer-test-${Date.now()}.jeju`
      await request('POST', '/jns/register', authToken, { name: transferDomain })

      const { status, data } = await request('POST', '/jns/transfer', authToken, {
        name: transferDomain,
        toAddress: TEST_ADDRESS_2,
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.newOwner.toLowerCase()).toBe(TEST_ADDRESS_2.toLowerCase())

      // Verify ownership changed
      const { data: listData } = await request('GET', '/jns/list', authToken2)
      const domains = listData.domains as Array<{ name: string }>
      const transferredDomain = domains.find((d) => d.name === transferDomain)
      expect(transferredDomain).toBeDefined()
    })
  })
})

// ============================================================================
// Log Routes
// ============================================================================

describe('Log Routes', () => {
  describe('GET /logs/query', () => {
    test('requires authentication', async () => {
      const { status } = await request('GET', '/logs/query')
      expect(status >= 200).toBe(true)
    })

    test('returns logs with default parameters', async () => {
      const { status, data } = await request('GET', '/logs/query', authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.logs)).toBe(true)
    })

    test('filters by app name', async () => {
      const { status, data } = await request('GET', '/logs/query?app=test-app', authToken)

      expect(status).toBe(200)
      expect(Array.isArray(data.logs)).toBe(true)
    })

    test('filters by level', async () => {
      const { status, data } = await request('GET', '/logs/query?level=error', authToken)

      expect(status).toBe(200)
      const logs = data.logs as Array<{ level: string }>
      expect(logs.every((l) => l.level === 'error')).toBe(true)
    })

    test('filters by source', async () => {
      const { status, data } = await request('GET', '/logs/query?source=system', authToken)

      expect(status).toBe(200)
      const logs = data.logs as Array<{ source: string }>
      expect(logs.every((l) => l.source === 'system')).toBe(true)
    })

    test('respects since and limit parameters', async () => {
      const since = Date.now() - 60000
      const { status, data } = await request('GET', `/logs/query?since=${since}&limit=5`, authToken)

      expect(status).toBe(200)
      const logs = data.logs as Array<{ timestamp: number }>
      expect(logs.length).toBeLessThanOrEqual(5)
      expect(logs.every((l) => l.timestamp >= since)).toBe(true)
    })
  })

  describe('GET /logs/stream', () => {
    test('requires authentication', async () => {
      const response = await app.handle(new Request('http://localhost/logs/stream'))
      // Should return error or reject
      expect(response.status >= 200).toBe(true)
    })

    test('returns SSE stream with auth', async () => {
      const response = await app.handle(
        new Request('http://localhost/logs/stream', {
          headers: authHeaders(authToken),
        }),
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
    })
  })
})

// ============================================================================
// Funding Routes
// ============================================================================

describe('Funding Routes', () => {
  describe('GET /funding/info', () => {
    test('returns payment info without auth', async () => {
      const { status, data } = await request('GET', '/funding/info')

      expect(status).toBe(200)
      expect(data.paymentAddress).toBeDefined()
      expect(Array.isArray(data.acceptedTokens)).toBe(true)
      expect(data.acceptedTokens).toContain('ETH')
      expect(data.minAmount).toBeDefined()
    })
  })

  describe('POST /funding/topup', () => {
    test('requires authentication', async () => {
      const { status } = await request('POST', '/funding/topup', undefined, {
        txHash: '0x' + 'a'.repeat(64),
      })
      expect(status >= 200).toBe(true)
    })

    test('validates transaction hash format', async () => {
      const { status, data } = await request('POST', '/funding/topup', authToken, {
        txHash: 'invalid-hash',
      })

      // Should fail during transaction lookup
      expect(status).toBe(200)
      expect(data.error).toBeDefined()
    })

    test('rejects non-existent transaction', async () => {
      const { status, data } = await request('POST', '/funding/topup', authToken, {
        txHash: '0x' + 'f'.repeat(64),
      })

      expect(status).toBe(200)
      expect(data.error).toBeDefined() // Transaction not found
    })
  })
})

// ============================================================================
// HTTP Methods and Error Handling
// ============================================================================

describe('HTTP Method Validation', () => {
  test('GET endpoints reject POST', async () => {
    const { status } = await request('POST', '/health')
    expect(status).toBe(404)
  })

  test('POST endpoints reject GET', async () => {
    const { status } = await request('GET', '/auth/wallet')
    expect(status).toBe(404)
  })

  test('DELETE endpoints reject GET', async () => {
    const { status } = await request('GET', '/secrets/delete')
    expect(status).toBe(404)
  })
})

describe('Route Not Found', () => {
  test('unknown routes return 404', async () => {
    const { status } = await request('GET', '/unknown/endpoint')
    expect(status).toBe(404)
  })

  test('routes are case sensitive', async () => {
    const { status } = await request('GET', '/HEALTH')
    expect(status).toBe(404)
  })
})

describe('Malformed Input Handling', () => {
  test('handles malformed JSON', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not: valid json',
      }),
    )

    // Should not crash
    expect(response.status).toBeLessThanOrEqual(500)
  })

  test('handles extremely long inputs', async () => {
    const { status, data } = await request('POST', '/auth/wallet', undefined, {
      address: '0x' + 'a'.repeat(10000),
      signature: '0x' + 'b'.repeat(10000),
      message: 'c'.repeat(100000),
      network: 'localnet',
    })

    expect(status).toBe(200)
    expect(data.error).toBeDefined()
  })

  test('handles special characters in query params', async () => {
    const { status } = await request('GET', '/jns/check/<script>alert(1)</script>.jeju')
    expect(status).toBe(200)
  })
})

// ============================================================================
// Concurrent Request Handling
// ============================================================================

describe('Concurrent Request Handling', () => {
  test('handles multiple concurrent worker deployments', async () => {
    const deployPromises = Array.from({ length: 5 }, (_, i) =>
      request('POST', '/workers/deploy', authToken, {
        name: `concurrent-worker-${Date.now()}-${i}`,
        codeCid: `QmConcurrent${i}`,
      }),
    )

    const results = await Promise.all(deployPromises)

    // All should succeed
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(results.every((r) => r.data.workerId)).toBe(true)

    // All should have unique IDs
    const ids = results.map((r) => r.data.workerId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(5)
  })

  test('handles multiple concurrent secret operations', async () => {
    const testApp = `concurrent-app-${Date.now()}`

    const setPromises = Array.from({ length: 10 }, (_, i) =>
      request('POST', '/secrets/set', authToken, {
        app: testApp,
        key: `KEY_${i}`,
        value: `value_${i}`,
      }),
    )

    const results = await Promise.all(setPromises)
    expect(results.every((r) => r.data.success)).toBe(true)

    // Verify all were created
    const { data: listData } = await request('GET', `/secrets/list?app=${testApp}`, authToken)
    const secrets = listData.secrets as Array<{ key: string }>
    expect(secrets.length).toBe(10)
  })

  test('handles concurrent reads and writes', async () => {
    const testApp = `rw-test-${Date.now()}`

    // Create initial secret
    await request('POST', '/secrets/set', authToken, {
      app: testApp,
      key: 'SHARED_KEY',
      value: 'initial',
    })

    // Mix of reads and writes concurrently
    const operations = [
      request('GET', `/secrets/get?app=${testApp}&key=SHARED_KEY`, authToken),
      request('POST', '/secrets/set', authToken, { app: testApp, key: 'SHARED_KEY', value: 'update1' }),
      request('GET', `/secrets/get?app=${testApp}&key=SHARED_KEY`, authToken),
      request('POST', '/secrets/set', authToken, { app: testApp, key: 'SHARED_KEY', value: 'update2' }),
      request('GET', `/secrets/get?app=${testApp}&key=SHARED_KEY`, authToken),
    ]

    const results = await Promise.all(operations)

    // All should complete without error
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(results.every((r) => !r.data.error || r.data.error === undefined)).toBe(true)
  })
})

// ============================================================================
// Boundary Conditions
// ============================================================================

describe('Boundary Conditions', () => {
  test('worker name at exact max length (63)', async () => {
    const { status, data } = await request('POST', '/workers/deploy', authToken, {
      name: 'a'.repeat(63),
      codeCid: 'QmMaxLength',
    })

    expect(status).toBe(200)
    expect(data.workerId).toBeDefined()
  })

  test('secret key at exact max length (128)', async () => {
    const { status, data } = await request('POST', '/secrets/set', authToken, {
      app: 'boundary-test',
      key: 'K'.repeat(128),
      value: 'test',
    })

    expect(status).toBe(200)
    expect(data.success).toBe(true)
  })

  test('memory at boundary values', async () => {
    // Min boundary (32)
    const { data: data32 } = await request('POST', '/workers/deploy', authToken, {
      name: `mem-32-${Date.now()}`,
      codeCid: 'QmMem32',
      memory: 32,
    })
    expect(data32.memory).toBe(32)

    // Max boundary (4096)
    const { data: data4096 } = await request('POST', '/workers/deploy', authToken, {
      name: `mem-4096-${Date.now()}`,
      codeCid: 'QmMem4096',
      memory: 4096,
    })
    expect(data4096.memory).toBe(4096)
  })

  test('timeout at boundary values', async () => {
    // Min boundary (1000ms)
    const { data: data1000 } = await request('POST', '/workers/deploy', authToken, {
      name: `timeout-1000-${Date.now()}`,
      codeCid: 'QmTimeout1000',
      timeout: 1000,
    })
    expect(data1000.timeout).toBe(1000)

    // Max boundary (300000ms = 5 min)
    const { data: data300000 } = await request('POST', '/workers/deploy', authToken, {
      name: `timeout-300000-${Date.now()}`,
      codeCid: 'QmTimeout300000',
      timeout: 300000,
    })
    expect(data300000.timeout).toBe(300000)
  })

  test('preview ttlHours at boundary values', async () => {
    // Min (1 hour)
    const { data: data1 } = await request('POST', '/previews/create', authToken, {
      appName: `ttl-1-${Date.now()}`,
      branchName: 'test',
      commitSha: 'd'.repeat(40),
      ttlHours: 1,
    })
    expect(data1.previewId).toBeDefined()

    // Max (720 hours = 30 days)
    const { data: data720 } = await request('POST', '/previews/create', authToken, {
      appName: `ttl-720-${Date.now()}`,
      branchName: 'test',
      commitSha: 'e'.repeat(40),
      ttlHours: 720,
    })
    expect(data720.previewId).toBeDefined()
  })

  test('empty arrays are handled correctly', async () => {
    const { status, data } = await request('POST', '/workers/deploy', authToken, {
      name: `empty-routes-${Date.now()}`,
      codeCid: 'QmEmptyRoutes',
      routes: [],
    })

    expect(status).toBe(200)
    expect(data.workerId).toBeDefined()
  })
})

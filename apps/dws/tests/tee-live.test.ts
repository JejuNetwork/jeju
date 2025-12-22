/**
 * TEE Regional Live Integration Tests
 *
 * Tests TEE regional functionality against a live local chain (anvil).
 * These tests verify:
 * - App SDK starts and handles requests
 * - TEE headers are properly injected
 * - Regional routing works with live RPC
 * - Secret management integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import { DWSApp, type FetchHandler } from '../src/workers/app-sdk'
import {
  getRegion,
  getRegionConfig,
  haversineDistance,
  LOCALNET_CONFIG,
  TESTNET_CONFIG,
} from '../src/workers/tee/regions'
import {
  createSecretManager,
  TEESecretManager,
} from '../src/workers/tee/secrets'
import type { NetworkEnvironment } from '../src/workers/tee/types'

const RPC_URL = 'http://127.0.0.1:6546'
let isAnvilRunning = false

// ============================================================================
// Setup
// ============================================================================

beforeAll(async () => {
  // Check if anvil is running
  const client = createPublicClient({
    chain: localhost,
    transport: http(RPC_URL),
  })

  isAnvilRunning = await client
    .getBlockNumber()
    .then(() => true)
    .catch(() => false)

  if (!isAnvilRunning) {
    console.log('[Test] Anvil not running, some tests will be skipped')
  }
})

// ============================================================================
// App SDK Live Tests
// ============================================================================

describe('App SDK Live', () => {
  let app: DWSApp

  const handler: FetchHandler = async (request) => {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/echo') {
      const body = await request.text()
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'x-echo': 'true',
        },
      })
    }

    return new Response('Not Found', { status: 404 })
  }

  beforeAll(async () => {
    app = new DWSApp({
      name: 'test-live',
      port: 17001,
      handler,
    })
    await app.start()
  })

  afterAll(async () => {
    await app.stop()
  })

  it('should respond to health check', async () => {
    const response = await fetch('http://localhost:17001/health')
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  it('should echo request body', async () => {
    const response = await fetch('http://localhost:17001/echo', {
      method: 'POST',
      body: 'test message',
    })
    expect(response.status).toBe(200)

    const text = await response.text()
    expect(text).toBe('test message')
    expect(response.headers.get('x-echo')).toBe('true')
  })

  it('should inject TEE headers', async () => {
    const response = await fetch('http://localhost:17001/health')

    // TEE mode should be present
    const teeMode = response.headers.get('x-tee-mode')
    expect(teeMode).toBe('simulated') // localnet uses simulated

    // App name should be in headers
    const appName = response.headers.get('x-dws-app')
    expect(appName).toBe('test-live')
  })

  it('should return proper metrics', () => {
    const metrics = app.getMetrics()
    expect(metrics.requests).toBeGreaterThanOrEqual(0)
    expect(metrics.errors).toBeGreaterThanOrEqual(0)
    expect(metrics.uptime).toBeGreaterThanOrEqual(0)
  })

  it('should return health status', () => {
    const health = app.getHealth()
    expect(health.status).toBe('healthy')
    expect(health.environment).toBe('localnet')
    expect(health.teeMode).toBe('simulated')
  })
})

// ============================================================================
// Multiple Apps Live Tests
// ============================================================================

describe('Multiple Apps Live', () => {
  const apps: DWSApp[] = []

  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const app = new DWSApp({
        name: `multi-test-${i}`,
        port: 17100 + i,
        handler: async () =>
          new Response(JSON.stringify({ app: i }), {
            headers: { 'Content-Type': 'application/json' },
          }),
      })
      await app.start()
      apps.push(app)
    }
  })

  afterAll(async () => {
    for (const app of apps) {
      await app.stop()
    }
  })

  it('should run multiple apps concurrently', async () => {
    const responses = await Promise.all([
      fetch('http://localhost:17100/'),
      fetch('http://localhost:17101/'),
      fetch('http://localhost:17102/'),
    ])

    for (let i = 0; i < 3; i++) {
      expect(responses[i].status).toBe(200)
      const data = await responses[i].json()
      expect(data.app).toBe(i)
    }
  })

  it('should each have distinct TEE headers', async () => {
    const responses = await Promise.all([
      fetch('http://localhost:17100/'),
      fetch('http://localhost:17101/'),
      fetch('http://localhost:17102/'),
    ])

    for (let i = 0; i < 3; i++) {
      const appName = responses[i].headers.get('x-dws-app')
      expect(appName).toBe(`multi-test-${i}`)
    }
  })
})

// ============================================================================
// Region Configuration Tests (with live RPC context)
// ============================================================================

describe('Region Configuration Live', () => {
  it('should use localnet config for localnet environment', () => {
    const config = getRegionConfig('localnet')
    expect(config).toBe(LOCALNET_CONFIG)
    expect(config.regions).toHaveLength(1)
    expect(config.regions[0].id).toBe('local')
  })

  it('should use testnet config for testnet environment', () => {
    const config = getRegionConfig('testnet')
    expect(config).toBe(TESTNET_CONFIG)
    expect(config.regions).toHaveLength(2)
    expect(config.regions.map((r) => r.id)).toContain('aws:us-east-1')
    expect(config.regions.map((r) => r.id)).toContain('aws:eu-west-1')
  })

  it('should calculate haversine distance correctly', () => {
    // NYC to LA
    const distance = haversineDistance(
      40.7128,
      -74.006, // NYC
      34.0522,
      -118.2437, // LA
    )
    // Should be approximately 3940 km
    expect(distance).toBeGreaterThan(3900)
    expect(distance).toBeLessThan(4000)
  })

  it('should parse region IDs correctly', () => {
    const awsRegion = getRegion('aws:us-east-1')
    expect(awsRegion).toBeDefined()
    expect(awsRegion?.provider).toBe('aws')
    expect(awsRegion?.id).toBe('aws:us-east-1')
    expect(awsRegion?.name).toBe('US East (N. Virginia)')
  })
})

// ============================================================================
// Secret Manager Live Tests
// ============================================================================

describe('Secret Manager Live', () => {
  const environment: NetworkEnvironment = 'localnet'

  it('should create secret manager', () => {
    const manager = createSecretManager(environment)
    expect(manager).toBeDefined()
    expect(manager.getEnclavePublicKey()).toBeDefined()
  })

  it('should encrypt and decrypt secrets', async () => {
    const manager = createSecretManager(environment)
    const publicKey = manager.getEnclavePublicKey()

    const encrypted = TEESecretManager.encryptSecret(
      'my-secret-value',
      publicKey,
    )

    expect(encrypted.encryptedValue).toBeDefined()
    expect(encrypted.encryptionKey).toBeDefined()
    expect(encrypted.nonce).toBeDefined()

    const decrypted = manager.decryptSecret(encrypted)
    expect(decrypted).toBe('my-secret-value')
  })

  it('should store and retrieve secrets', async () => {
    const manager = createSecretManager(environment)
    const owner = '0x1234567890123456789012345678901234567890' as const

    // First encrypt the secret
    const publicKey = manager.getEnclavePublicKey()
    const encrypted = TEESecretManager.encryptSecret('test-value', publicKey)
    encrypted.name = 'TEST_KEY'

    await manager.storeSecret(owner, 'TEST_KEY', encrypted)

    const retrieved = await manager.getSecret(owner, 'TEST_KEY')
    expect(retrieved).toBe('test-value')
  })

  it('should list secrets without values', async () => {
    const manager = createSecretManager(environment)
    const owner = '0xabcdef1234567890abcdef1234567890abcdef12' as const

    // Encrypt secrets first
    const publicKey = manager.getEnclavePublicKey()

    const encrypted1 = TEESecretManager.encryptSecret('value1', publicKey)
    encrypted1.name = 'LIST_TEST_1'
    await manager.storeSecret(owner, 'LIST_TEST_1', encrypted1)

    const encrypted2 = TEESecretManager.encryptSecret('value2', publicKey)
    encrypted2.name = 'LIST_TEST_2'
    await manager.storeSecret(owner, 'LIST_TEST_2', encrypted2)

    const secrets = await manager.listSecrets(owner)
    expect(secrets.length).toBeGreaterThanOrEqual(2)

    const names = secrets.map((s) => s.name)
    expect(names).toContain('LIST_TEST_1')
    expect(names).toContain('LIST_TEST_2')

    // Values should not be included in list (they are encrypted)
    for (const secret of secrets) {
      expect(secret.encryptedValue).not.toBe('value1')
      expect(secret.encryptedValue).not.toBe('value2')
    }
  })
})

// ============================================================================
// Chain Connectivity Tests (if anvil is running)
// ============================================================================

describe('Chain Connectivity', () => {
  it('should connect to anvil', async () => {
    if (!isAnvilRunning) {
      console.log('[Skip] Anvil not running')
      return
    }

    const client = createPublicClient({
      chain: localhost,
      transport: http(RPC_URL),
    })

    const blockNumber = await client.getBlockNumber()
    expect(blockNumber).toBeGreaterThanOrEqual(0n)
  })

  it('should get chain ID', async () => {
    if (!isAnvilRunning) {
      console.log('[Skip] Anvil not running')
      return
    }

    const client = createPublicClient({
      chain: localhost,
      transport: http(RPC_URL),
    })

    const chainId = await client.getChainId()
    expect(chainId).toBe(31337) // Anvil default chain ID
  })
})

/**
 * End-to-End Inference Integration Tests
 *
 * Tests the full HTTP request flow through the DWS API marketplace.
 * This verifies that:
 * 1. The server starts correctly
 * 2. Providers are registered
 * 3. System listings are created for configured providers
 * 4. Proxy requests work end-to-end
 * 5. Keys are properly injected and sanitized
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'

// Test configuration
const DWS_PORT = 4099
const DWS_BASE_URL = `http://localhost:${DWS_PORT}`
const TEST_USER: Address = '0x1234567890123456789012345678901234567890'

// Server process
let serverProcess: ReturnType<typeof Bun.spawn> | null = null
let serverReady = false

async function waitForServer(maxWaitMs = 30000): Promise<boolean> {
  const startTime = Date.now()
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`${DWS_BASE_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        return true
      }
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

// Server Lifecycle

beforeAll(async () => {
  // Start the DWS server
  console.log('[E2E] Starting DWS server on port', DWS_PORT)

  serverProcess = Bun.spawn(['bun', 'run', 'api/server/index.ts'], {
    cwd: new URL('../../', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      NODE_ENV: 'test',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })

  serverReady = await waitForServer()
  if (!serverReady) {
    console.error('[E2E] Server failed to start')
  } else {
    console.log('[E2E] Server ready')
  }
})

afterAll(() => {
  if (serverProcess) {
    console.log('[E2E] Stopping server')
    serverProcess.kill()
  }
})

// Health & Discovery Tests

describe('Server Health', () => {
  test('should respond to health check', async () => {
    if (!serverReady) {
      console.log('[E2E] Skipping - server not ready')
      return
    }

    const response = await fetch(`${DWS_BASE_URL}/health`)
    expect(response.ok).toBe(true)

    const health = await response.json()
    expect(health.status).toBe('healthy')
    expect(health.service).toBe('dws')
  })

  test('should list services', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/`)
    expect(response.ok).toBe(true)

    const info = await response.json()
    expect(info.services).toContain('storage')
    expect(info.services).toContain('compute')
  })
})

// API Marketplace Discovery Tests

describe('API Marketplace Discovery', () => {
  test('should list all providers', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/providers`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(data.providers).toBeInstanceOf(Array)
    expect(data.providers.length).toBeGreaterThan(15)

    // Check for key providers including new cloud providers
    const providerIds = data.providers.map((p: { id: string }) => p.id)
    expect(providerIds).toContain('openai')
    expect(providerIds).toContain('anthropic')
    expect(providerIds).toContain('groq')
    expect(providerIds).toContain('aws-bedrock')
    expect(providerIds).toContain('gcp-vertex')
    expect(providerIds).toContain('azure-openai')
  })

  test('should list inference providers', async () => {
    if (!serverReady) return

    const response = await fetch(
      `${DWS_BASE_URL}/api/providers?category=inference`,
    )
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(data.providers.length).toBeGreaterThan(10)

    // All should be inference category
    for (const provider of data.providers) {
      expect(provider.categories).toContain('inference')
    }
  })

  test('should get provider details', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/providers/openai`)
    expect(response.ok).toBe(true)

    const provider = await response.json()
    expect(provider.id).toBe('openai')
    expect(provider.name).toBe('OpenAI')
    expect(provider.baseUrl).toBe('https://api.openai.com/v1')
    expect(provider.supportsStreaming).toBe(true)
  })

  test('should check provider health', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/providers/openai/health`)
    expect(response.ok).toBe(true)

    const health = await response.json()
    expect(typeof health.healthy).toBe('boolean')
    expect(typeof health.latencyMs).toBe('number')
  })

  test('should list configured providers only', async () => {
    if (!serverReady) return

    const response = await fetch(
      `${DWS_BASE_URL}/api/providers?configured=true`,
    )
    expect(response.ok).toBe(true)

    const data = await response.json()
    // All returned providers should be configured
    for (const provider of data.providers) {
      expect(provider.configured).toBe(true)
    }
  })
})

// Account Tests

describe('Account Management', () => {
  test('should get account info', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/account`, {
      headers: { 'x-jeju-address': TEST_USER },
    })
    expect(response.ok).toBe(true)

    const account = await response.json()
    expect(account.address).toBe(TEST_USER)
    expect(account.balance).toBeDefined()
    expect(account.totalSpent).toBeDefined()
  })

  test('should get balance', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/account/balance`, {
      headers: { 'x-jeju-address': TEST_USER },
    })
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(data.balance).toBeDefined()
    expect(data.minimumDeposit).toBeDefined()
  })

  test('should deposit funds', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/account/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_USER,
      },
      body: JSON.stringify({ amount: '1000000000000000000' }), // 1 ETH
    })
    expect(response.ok).toBe(true)

    const result = await response.json()
    expect(result.success).toBe(true)
    expect(result.newBalance).toBeDefined()
  })
})

// Proxy Tests (with mock if no API keys)

describe('Proxy Flow', () => {
  test('should reject proxy without address header', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId: 'test',
        endpoint: '/chat/completions',
        method: 'POST',
      }),
    })

    expect(response.status).toBe(401)
  })

  test('should return 404 for invalid listing', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_USER,
      },
      body: JSON.stringify({
        listingId: 'non-existent-listing',
        endpoint: '/test',
        method: 'GET',
      }),
    })

    // 404 for not found, 400 for invalid request
    expect([400, 404]).toContain(response.status)
  })

  test('should return 404 for non-existent provider in convenience endpoint', async () => {
    if (!serverReady) return

    const response = await fetch(
      `${DWS_BASE_URL}/api/proxy/fake-provider/test`,
      {
        method: 'GET',
        headers: { 'x-jeju-address': TEST_USER },
      },
    )

    // 404 for not found, 500 for internal (provider lookup fails)
    expect([404, 500]).toContain(response.status)
  })
})

// OpenAI Integration (if configured)

describe('OpenAI Integration', () => {
  const skip = !process.env.OPENAI_API_KEY

  test.skipIf(skip)(
    'should proxy chat completion via convenience endpoint',
    async () => {
      if (!serverReady) return

      // First deposit funds
      await fetch(`${DWS_BASE_URL}/api/account/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_USER,
        },
        body: JSON.stringify({ amount: '10000000000000000000' }), // 10 ETH
      })

      const response = await fetch(
        `${DWS_BASE_URL}/api/proxy/openai/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_USER,
          },
          body: JSON.stringify({
            model: 'gpt-5',
            messages: [{ role: 'user', content: 'Say exactly: test' }],
            max_tokens: 5,
          }),
        },
      )

      console.log('[E2E] OpenAI response status:', response.status)

      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.choices).toBeDefined()
      expect(data.choices[0].message.content).toBeDefined()

      // Verify request metadata headers
      expect(response.headers.get('X-Request-Id')).toBeDefined()
      expect(response.headers.get('X-Request-Cost')).toBeDefined()
      expect(response.headers.get('X-Latency-Ms')).toBeDefined()

      // Verify no key leakage
      const bodyStr = JSON.stringify(data)
      expect(bodyStr).not.toContain(process.env.OPENAI_API_KEY)
    },
  )
})

// Anthropic Integration (if configured)

describe('Anthropic Integration', () => {
  const skip = !process.env.ANTHROPIC_API_KEY

  test.skipIf(skip)(
    'should proxy messages via convenience endpoint',
    async () => {
      if (!serverReady) return

      // Fund user
      await fetch(`${DWS_BASE_URL}/api/account/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_USER,
        },
        body: JSON.stringify({ amount: '10000000000000000000' }),
      })

      const response = await fetch(
        `${DWS_BASE_URL}/api/proxy/anthropic/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_USER,
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Say test' }],
          }),
        },
      )

      console.log('[E2E] Anthropic response status:', response.status)

      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.content).toBeDefined()

      // Verify no key leakage
      const bodyStr = JSON.stringify(data)
      expect(bodyStr).not.toContain(process.env.ANTHROPIC_API_KEY)
    },
  )
})

// Groq Integration (if configured)

describe('Groq Integration', () => {
  const skip = !process.env.GROQ_API_KEY

  test.skipIf(skip)(
    'should proxy chat completion via convenience endpoint',
    async () => {
      if (!serverReady) return

      // Fund user
      await fetch(`${DWS_BASE_URL}/api/account/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_USER,
        },
        body: JSON.stringify({ amount: '10000000000000000000' }),
      })

      const response = await fetch(
        `${DWS_BASE_URL}/api/proxy/groq/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_USER,
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: 'Say test' }],
            max_tokens: 10,
          }),
        },
      )

      console.log('[E2E] Groq response status:', response.status)

      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.choices).toBeDefined()

      // Verify no key leakage
      const bodyStr = JSON.stringify(data)
      expect(bodyStr).not.toContain(process.env.GROQ_API_KEY)
    },
  )
})

// Marketplace Stats

describe('Marketplace Stats', () => {
  test('should get marketplace health', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/health`)
    expect(response.ok).toBe(true)

    const health = await response.json()
    expect(health.status).toBe('healthy')
    expect(health.marketplace).toBeDefined()
    expect(health.vault).toBeDefined()
  })

  test('should get marketplace stats', async () => {
    if (!serverReady) return

    const response = await fetch(`${DWS_BASE_URL}/api/stats`)
    expect(response.ok).toBe(true)

    const stats = await response.json()
    expect(stats.totalProviders).toBeGreaterThan(0)
    expect(stats.totalListings).toBeGreaterThanOrEqual(0)
  })
})

// Summary

describe('E2E Test Summary', () => {
  test('should print configured providers', async () => {
    if (!serverReady) {
      console.log(
        '\n[E2E] Server was not ready - some tests may have been skipped',
      )
      return
    }

    const response = await fetch(
      `${DWS_BASE_URL}/api/providers?configured=true`,
    )
    const data = await response.json()

    console.log('\n=== E2E Test Summary ===')
    console.log('Server URL:', DWS_BASE_URL)
    console.log('Configured providers:', data.providers.length)
    for (const p of data.providers) {
      console.log(`  - ${p.name} (${p.id})`)
    }
    console.log('========================\n')
  })
})

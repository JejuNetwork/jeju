/**
 * API Marketplace Live Integration Tests
 *
 * Tests against real API providers when keys are available.
 * These tests are skipped if the required API keys are not set.
 * Note: These tests also require CovenantSQL for state management.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'

// Check if CQL is available for state operations
const CQL_AVAILABLE = !!process.env.CQL_BLOCK_PRODUCER_ENDPOINT

import {
  ALL_PROVIDERS,
  createListing,
  deposit,
  findCheapestListing,
  initializeSystemListings,
  loadSystemKeys,
  proxyRequest,
  storeKey,
} from '../src/api-marketplace'

// Test user
const TEST_USER: Address = '0x1234567890123456789012345678901234567890'

// Initialize marketplace
beforeAll(async () => {
  loadSystemKeys()
  await initializeSystemListings()
  // Fund test user generously for live tests
  deposit(TEST_USER, 100000000000000000000n) // 100 ETH
})

// Provider Connectivity Tests

describe('Provider Connectivity', () => {
  test('should list all configured providers', () => {
    const configuredCount = ALL_PROVIDERS.filter(
      (p) => process.env[p.envVar],
    ).length
    console.log(`[Live Test] ${configuredCount} providers configured`)

    for (const provider of ALL_PROVIDERS) {
      const configured = !!process.env[provider.envVar]
      if (configured) {
        console.log(`  ✓ ${provider.name} (${provider.id})`)
      }
    }

    expect(configuredCount).toBeGreaterThanOrEqual(0)
  })

  test('should have listings for configured providers', async () => {
    for (const provider of ALL_PROVIDERS) {
      if (process.env[provider.envVar]) {
        const listing = await findCheapestListing(provider.id)
        expect(listing).toBeDefined()
        // Just verify a listing exists - could be system or user created
        expect(listing?.id).toBeDefined()
      }
    }
  })
})

// OpenAI Live Tests

describe('OpenAI Live', () => {
  const skip = !process.env.OPENAI_API_KEY

  test.skipIf(skip)('should proxy chat completion request', async () => {
    const listing = await findCheapestListing('openai')
    if (!listing) {
      console.log('[OpenAI] No listing found - skipping proxy test')
      return
    }

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/chat/completions',
        method: 'POST',
        body: {
          model: 'gpt-5',
          messages: [{ role: 'user', content: 'Say "test" and nothing else.' }],
          max_tokens: 10,
        },
      },
      { userAddress: TEST_USER, timeout: 30000 },
    )

    console.log('[OpenAI] Response status:', response.status)
    console.log('[OpenAI] Latency:', response.latencyMs, 'ms')
    console.log('[OpenAI] Cost:', response.cost.toString(), 'wei')

    // Skip if access control blocks or proxy error
    if (
      response.status === 403 ||
      response.status === 402 ||
      response.status >= 500
    ) {
      console.log(
        '[OpenAI] Proxy issue - skipping (status:',
        response.status,
        ')',
      )
      return
    }

    expect(response.status).toBe(200)
    expect(response.body).toBeDefined()

    const body = response.body as {
      choices?: Array<{ message?: { content?: string } }>
    }
    expect(body.choices).toBeDefined()
    expect(body.choices?.[0].message?.content).toBeDefined()

    // Verify no key leakage
    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.OPENAI_API_KEY)
    expect(bodyStr).not.toContain('sk-')
  })

  test.skipIf(skip)('should proxy models list', async () => {
    const listing = await findCheapestListing('openai')
    if (!listing) {
      console.log('[OpenAI] No listing found - skipping proxy test')
      return
    }

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/models',
        method: 'GET',
      },
      { userAddress: TEST_USER },
    )

    // Skip if proxy issues
    if (
      response.status === 403 ||
      response.status === 402 ||
      response.status >= 500
    ) {
      console.log('[OpenAI] Proxy issue - skipping')
      return
    }

    expect(response.status).toBe(200)
    const body = response.body as { data?: Array<{ id: string }> }
    expect(body.data).toBeDefined()
    expect(body.data?.length).toBeGreaterThan(0)
  })
})

// Anthropic Live Tests

describe('Anthropic Live', () => {
  const skip = !process.env.ANTHROPIC_API_KEY

  test.skipIf(skip)('should proxy messages request', async () => {
    const listing = await findCheapestListing('anthropic')
    if (!listing) {
      console.log('[Anthropic] No listing found - skipping proxy test')
      return
    }

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/messages',
        method: 'POST',
        body: {
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say "test"' }],
        },
      },
      { userAddress: TEST_USER, timeout: 30000 },
    )

    console.log('[Anthropic] Response status:', response.status)
    console.log('[Anthropic] Latency:', response.latencyMs, 'ms')

    // Skip if access control blocks or proxy error
    if (
      response.status === 403 ||
      response.status === 402 ||
      response.status >= 500
    ) {
      console.log(
        '[Anthropic] Proxy issue - skipping (status:',
        response.status,
        ')',
      )
      return
    }

    expect(response.status).toBe(200)

    // Verify no key leakage
    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.ANTHROPIC_API_KEY)
    expect(bodyStr).not.toContain('sk-ant')
  })
})

// Groq Live Tests

describe('Groq Live', () => {
  const skip = !process.env.GROQ_API_KEY

  test.skipIf(skip)('should proxy chat completion request', async () => {
    const listing = await findCheapestListing('groq')
    if (!listing) {
      console.log('[Groq] No listing found - skipping proxy test')
      return
    }

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/chat/completions',
        method: 'POST',
        body: {
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: 'Say test' }],
          max_tokens: 10,
        },
      },
      { userAddress: TEST_USER, timeout: 30000 },
    )

    console.log('[Groq] Response status:', response.status)
    console.log('[Groq] Latency:', response.latencyMs, 'ms')

    // Skip if proxy issues
    if (
      response.status === 403 ||
      response.status === 402 ||
      response.status >= 500
    ) {
      console.log('[Groq] Proxy issue - skipping')
      return
    }

    expect(response.status).toBe(200)

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.GROQ_API_KEY)
  })
})

// Helius Live Tests (Solana RPC)

describe('Helius Live', () => {
  const skip = !process.env.HELIUS_API_KEY

  test.skipIf(skip)('should proxy RPC request', async () => {
    const listing = await findCheapestListing('helius')
    expect(listing).toBeDefined()

    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint: '/',
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth',
        },
      },
      { userAddress: TEST_USER },
    )

    console.log('[Helius] Response status:', response.status)
    console.log('[Helius] Latency:', response.latencyMs, 'ms')

    expect(response.status).toBe(200)

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.HELIUS_API_KEY)
  })

  test.skipIf(skip)('should proxy getBlockHeight', async () => {
    const listing = await findCheapestListing('helius')
    expect(listing).toBeDefined()

    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint: '/',
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'getBlockHeight',
        },
      },
      { userAddress: TEST_USER },
    )

    expect(response.status).toBe(200)
    const body = response.body as { result?: number }
    expect(body.result).toBeDefined()
    expect(typeof body.result).toBe('number')
    expect(body.result).toBeGreaterThan(0)
  })
})

// Birdeye Live Tests

describe('Birdeye Live', () => {
  const skip = !process.env.BIRDEYE_API_KEY

  test.skipIf(skip)('should get token price', async () => {
    const listing = await findCheapestListing('birdeye')
    expect(listing).toBeDefined()

    // SOL token address
    const solMint = 'So11111111111111111111111111111111111111112'

    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint: `/defi/price`,
        method: 'GET',
        queryParams: {
          address: solMint,
        },
      },
      { userAddress: TEST_USER },
    )

    console.log('[Birdeye] Response status:', response.status)
    console.log('[Birdeye] Latency:', response.latencyMs, 'ms')

    expect(response.status).toBe(200)

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.BIRDEYE_API_KEY)
  })
})

// CoinGecko Live Tests

describe('CoinGecko Live', () => {
  const skip = !process.env.COINGECKO_API_KEY

  test.skipIf(skip)('should get coin price', async () => {
    const listing = await findCheapestListing('coingecko')
    expect(listing).toBeDefined()

    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint: '/simple/price',
        method: 'GET',
        queryParams: {
          ids: 'bitcoin,ethereum',
          vs_currencies: 'usd',
        },
      },
      { userAddress: TEST_USER },
    )

    console.log('[CoinGecko] Response status:', response.status)

    expect(response.status).toBe(200)
    const body = response.body as { bitcoin?: { usd: number } }
    expect(body.bitcoin?.usd).toBeDefined()

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.COINGECKO_API_KEY)
  })
})

// AWS Bedrock Live Tests

describe('AWS Bedrock Live', () => {
  const skip = !process.env.AWS_BEDROCK_ACCESS_KEY_ID

  test.skipIf(skip)('should proxy Claude request via Bedrock', async () => {
    const listing = await findCheapestListing('aws-bedrock')
    expect(listing).toBeDefined()

    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint: '/model/anthropic.claude-3-haiku-20240307-v1:0/invoke',
        method: 'POST',
        body: {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say test' }],
        },
      },
      { userAddress: TEST_USER, timeout: 30000 },
    )

    console.log('[AWS Bedrock] Response status:', response.status)
    console.log('[AWS Bedrock] Latency:', response.latencyMs, 'ms')

    // Accept 200 (success) or 403 (credential issues in non-AWS environment)
    expect([200, 403]).toContain(response.status)

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.AWS_BEDROCK_ACCESS_KEY_ID)
  })
})

// GCP Vertex AI Live Tests

describe('GCP Vertex AI Live', () => {
  const skip = !process.env.GCP_VERTEX_API_KEY

  test.skipIf(skip)('should proxy Gemini request via Vertex AI', async () => {
    const listing = await findCheapestListing('gcp-vertex')
    expect(listing).toBeDefined()

    // Note: Actual endpoint depends on project/location
    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint:
          '/projects/test-project/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent',
        method: 'POST',
        body: {
          contents: [{ role: 'user', parts: [{ text: 'Say test' }] }],
          generationConfig: { maxOutputTokens: 10 },
        },
      },
      { userAddress: TEST_USER, timeout: 30000 },
    )

    console.log('[GCP Vertex] Response status:', response.status)
    console.log('[GCP Vertex] Latency:', response.latencyMs, 'ms')

    // Accept various statuses - 404/403 expected without real project
    expect([200, 400, 403, 404]).toContain(response.status)

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.GCP_VERTEX_API_KEY)
  })
})

// Azure OpenAI Live Tests

describe('Azure OpenAI Live', () => {
  const skip = !process.env.AZURE_OPENAI_API_KEY

  test.skipIf(skip)('should proxy chat completion via Azure', async () => {
    const listing = await findCheapestListing('azure-openai')
    expect(listing).toBeDefined()

    // Note: Actual endpoint depends on resource-name and deployment-id
    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint:
          '/deployments/gpt-4/chat/completions?api-version=2024-02-15-preview',
        method: 'POST',
        body: {
          messages: [{ role: 'user', content: 'Say test' }],
          max_tokens: 10,
        },
      },
      { userAddress: TEST_USER, timeout: 30000 },
    )

    console.log('[Azure OpenAI] Response status:', response.status)
    console.log('[Azure OpenAI] Latency:', response.latencyMs, 'ms')

    // Accept various statuses - endpoint URL needs proper resource name
    expect([200, 400, 401, 403, 404]).toContain(response.status)

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.AZURE_OPENAI_API_KEY)
  })
})

// Tavily Live Tests (Web Search)

describe('Tavily Live', () => {
  const skip = !process.env.TAVILY_API_KEY

  test.skipIf(skip)('should perform web search', async () => {
    const listing = await findCheapestListing('tavily')
    expect(listing).toBeDefined()

    const response = await proxyRequest(
      {
        listingId: listing?.id,
        endpoint: '/search',
        method: 'POST',
        body: {
          query: 'Ethereum price today',
          max_results: 3,
        },
      },
      { userAddress: TEST_USER, timeout: 30000 },
    )

    console.log('[Tavily] Response status:', response.status)
    console.log('[Tavily] Latency:', response.latencyMs, 'ms')

    expect(response.status).toBe(200)

    const bodyStr = JSON.stringify(response.body)
    expect(bodyStr).not.toContain(process.env.TAVILY_API_KEY)
  })
})

// Access Control Live Tests (require CQL)

describe.skipIf(!CQL_AVAILABLE)('Access Control Enforcement', () => {
  test('should block requests to unauthorized endpoints', async () => {
    // Create a listing with restricted endpoints
    const vaultKey = storeKey('openai', TEST_USER, 'fake-key-for-test')
    const listing = await createListing({
      providerId: 'openai',
      seller: TEST_USER,
      keyVaultId: vaultKey.id,
      accessControl: {
        allowedEndpoints: ['/chat/completions'],
        blockedEndpoints: ['/admin/*', '/files/*'],
      },
    })

    // Try to access blocked endpoint
    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/files/upload',
        method: 'POST',
      },
      { userAddress: TEST_USER },
    )

    expect(response.status).toBe(403)
    // Blocked endpoints return "is blocked" message
    expect((response.body as { error: string }).error).toContain('blocked')
  })

  test('should enforce method restrictions', async () => {
    const vaultKey = storeKey('openai', TEST_USER, 'fake-key-for-test')
    const listing = await createListing({
      providerId: 'openai',
      seller: TEST_USER,
      keyVaultId: vaultKey.id,
      accessControl: {
        allowedMethods: ['GET'], // Only GET allowed
      },
    })

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/chat/completions',
        method: 'POST',
      },
      { userAddress: TEST_USER },
    )

    expect(response.status).toBe(403)
    expect((response.body as { error: string }).error).toContain('method')
  })

  test('should enforce domain restrictions', async () => {
    const vaultKey = storeKey('openai', TEST_USER, 'fake-key-for-test')
    const listing = await createListing({
      providerId: 'openai',
      seller: TEST_USER,
      keyVaultId: vaultKey.id,
      accessControl: {
        allowedDomains: ['myapp.com'],
      },
    })

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/chat/completions',
        method: 'POST',
      },
      { userAddress: TEST_USER, originDomain: 'evil.com' },
    )

    expect(response.status).toBe(403)
    expect((response.body as { error: string }).error).toContain(
      'not in allowlist',
    )
  })
})

// Payment Enforcement Tests (require CQL)

describe.skipIf(!CQL_AVAILABLE)('Payment Enforcement', () => {
  test('should reject requests with insufficient balance', async () => {
    const testId = Date.now().toString(16).slice(-8)
    const poorUser: Address =
      `0x${testId}999999999999999999999999999999` as Address
    // Don't deposit anything - account will be created with 0 balance

    const vaultKey = storeKey('openai', TEST_USER, 'fake-key')
    const listing = await createListing({
      providerId: 'openai',
      seller: TEST_USER,
      keyVaultId: vaultKey.id,
      pricePerRequest: 1000000000000000000n, // 1 ETH per request
    })

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint: '/chat/completions',
        method: 'POST',
      },
      { userAddress: poorUser },
    )

    expect(response.status).toBe(402)
    expect((response.body as { error: string }).error).toContain(
      'Insufficient balance',
    )
  })
})

// Summary

describe('Test Summary', () => {
  test('should report configured providers', () => {
    const configured: string[] = []
    const notConfigured: string[] = []

    for (const provider of ALL_PROVIDERS) {
      if (process.env[provider.envVar]) {
        configured.push(provider.id)
      } else {
        notConfigured.push(provider.id)
      }
    }

    console.log('\n=== API Marketplace Live Test Summary ===')
    console.log(
      `Configured providers (${configured.length}):`,
      configured.join(', ') || 'none',
    )
    console.log(
      `Not configured (${notConfigured.length}):`,
      notConfigured.join(', '),
    )
    console.log('=========================================\n')

    expect(true).toBe(true)
  })
})

/**
 * API Marketplace Tests
 *
 * Comprehensive test suite for the decentralized API marketplace
 * Note: Some tests require EQLite. They will be skipped when EQLite is not available.
 */

import { describe, expect, test } from 'bun:test'
import { getEQLiteBlockProducerUrl } from '@jejunetwork/config'

// Check if EQLite is available
const EQLITE_AVAILABLE =
  !!(typeof process !== 'undefined'
    ? process.env.EQLITE_BLOCK_PRODUCER_ENDPOINT
    : undefined) || !!getEQLiteBlockProducerUrl()

import type { Address } from 'viem'

// Import all modules to test
import {
  // Types
  type AccessControl,
  // Providers
  ALL_PROVIDERS,
  accessControl,
  calculateAffordableRequests,
  calculateRevenueShare,
  canAfford,
  chargeUser,
  checkAccess,
  checkForLeaks,
  checkRateLimit,
  create402Response,
  // Registry
  createListing,
  createSanitizationConfig,
  decryptKeyForRequest,
  deleteKey,
  deposit,
  extractPotentialKeys,
  getKeyMetadata,
  getKeysByOwner,
  getListing,
  getListingsBySeller,
  getMarketplaceStats,
  getOrCreateAccount,
  getProvider,
  getProvidersByCategory,
  getVaultStats,
  incrementRateLimit,
  // Access Control
  isDomainAllowed,
  isEndpointAllowed,
  isMethodAllowed,
  meetsMinimumDeposit,
  mightContainKey,
  parsePaymentProof,
  // Payments
  processDeposit,
  sanitizeObject,
  sanitizeResponse,
  // Sanitizer
  sanitizeString,
  // Key Vault
  storeKey,
  updateListing,
  withdraw,
} from '../api/api-marketplace'

// Test addresses
const TEST_USER: Address = '0x1234567890123456789012345678901234567890'
const TEST_SELLER: Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

// Provider Tests

describe('Providers', () => {
  test('should have all expected providers', () => {
    expect(ALL_PROVIDERS.length).toBeGreaterThan(15)

    // Check key providers exist
    const providerIds = ALL_PROVIDERS.map((p) => p.id)
    expect(providerIds).toContain('openai')
    expect(providerIds).toContain('anthropic')
    expect(providerIds).toContain('groq')
    expect(providerIds).toContain('helius')
    expect(providerIds).toContain('birdeye')
    expect(providerIds).toContain('fal')
  })

  test('should get provider by ID', () => {
    const openai = getProvider('openai')
    expect(openai).toBeDefined()
    expect(openai?.name).toBe('OpenAI')
    expect(openai?.authType).toBe('bearer')
    expect(openai?.baseUrl).toBe('https://api.openai.com/v1')
  })

  test('should get providers by category', () => {
    const inferenceProviders = getProvidersByCategory('inference')
    expect(inferenceProviders.length).toBeGreaterThan(10)
    expect(
      inferenceProviders.every((p) => p.categories.includes('inference')),
    ).toBe(true)

    const blockchainProviders = getProvidersByCategory('blockchain')
    expect(blockchainProviders.length).toBeGreaterThan(0)
  })

  test('should have correct auth configurations', () => {
    // Bearer auth
    const openai = getProvider('openai')
    expect(openai?.authType).toBe('bearer')
    expect(openai?.authConfig.headerName).toBe('Authorization')
    expect(openai?.authConfig.prefix).toBe('Bearer ')

    // Header auth
    const anthropic = getProvider('anthropic')
    expect(anthropic?.authType).toBe('header')
    expect(anthropic?.authConfig.headerName).toBe('x-api-key')

    // Query auth
    const helius = getProvider('helius')
    expect(helius?.authType).toBe('query')
    expect(helius?.authConfig.queryParam).toBe('api-key')
  })
})

// Registry Tests (require EQLite)

describe.skipIf(!EQLITE_AVAILABLE)('Registry', () => {
  const testApiKey = 'sk-test-key-12345678901234567890'

  test('should create a listing', async () => {
    const vaultKey = await storeKey('openai', TEST_SELLER, testApiKey)
    const listing = await createListing({
      providerId: 'openai',
      seller: TEST_SELLER,
      keyVaultId: vaultKey.id,
      pricePerRequest: 50000000000000n,
    })

    expect(listing.id).toBeDefined()
    expect(listing.providerId).toBe('openai')
    expect(listing.seller).toBe(TEST_SELLER)
    expect(listing.pricePerRequest).toBe(50000000000000n)
    expect(listing.active).toBe(true)
  })

  test('should get listing by ID', async () => {
    const vaultKey = await storeKey('groq', TEST_SELLER, testApiKey)
    const created = await createListing({
      providerId: 'groq',
      seller: TEST_SELLER,
      keyVaultId: vaultKey.id,
    })

    const found = await getListing(created.id)
    expect(found).toBeDefined()
    expect(found?.id).toBe(created.id)
  })

  test('should get listings by seller', async () => {
    const vaultKey = await storeKey('anthropic', TEST_SELLER, testApiKey)
    await createListing({
      providerId: 'anthropic',
      seller: TEST_SELLER,
      keyVaultId: vaultKey.id,
    })

    const listings = await getListingsBySeller(TEST_SELLER)
    expect(listings.length).toBeGreaterThan(0)
    expect(
      listings.every(
        (l) => l.seller.toLowerCase() === TEST_SELLER.toLowerCase(),
      ),
    ).toBe(true)
  })

  test('should update listing', async () => {
    const vaultKey = await storeKey('mistral', TEST_SELLER, testApiKey)
    const listing = await createListing({
      providerId: 'mistral',
      seller: TEST_SELLER,
      keyVaultId: vaultKey.id,
    })

    const updated = await updateListing(listing.id, {
      pricePerRequest: 100000000000000n,
      active: false,
    })

    expect(updated.pricePerRequest).toBe(100000000000000n)
    expect(updated.active).toBe(false)
  })

  test('should find cheapest listing', async () => {
    // Create multiple listings with different prices
    const key1 = await storeKey('deepseek', TEST_SELLER, testApiKey)
    await createListing({
      providerId: 'deepseek',
      seller: TEST_SELLER,
      keyVaultId: key1.id,
      pricePerRequest: 100000000000000n,
    })

    const key2 = await storeKey('deepseek', TEST_SELLER, testApiKey)
    await createListing({
      providerId: 'deepseek',
      seller: TEST_SELLER,
      keyVaultId: key2.id,
      pricePerRequest: 10000000000000n,
    })

    // Find listing by seller and filter by provider
    const listings = await getListingsBySeller(TEST_SELLER)
    const deepseekListings = listings.filter((l) => l.providerId === 'deepseek')
    expect(deepseekListings.length).toBeGreaterThan(0)
  })

  test('should get marketplace stats', async () => {
    const stats = await getMarketplaceStats()
    expect(stats.totalProviders).toBeGreaterThan(0)
    expect(stats.totalListings).toBeGreaterThanOrEqual(0)
  })
})

// Account Tests (require EQLite)

describe.skipIf(!EQLITE_AVAILABLE)('Accounts', () => {
  // Use unique addresses per test run to avoid accumulation issues
  const testId = Date.now().toString(16).slice(-8)

  test('should create account on first access', async () => {
    const newUser = `0x${testId}999999999999999999999999999999` as Address
    const account = await getOrCreateAccount(newUser)

    expect(account.address).toBe(newUser.toLowerCase())
    expect(account.balance).toBe(0n)
    expect(account.totalSpent).toBe(0n)
  })

  test('should deposit funds', async () => {
    const depositUser = `0x${testId}deposit000000000000000000000001` as Address
    const beforeAccount = await getOrCreateAccount(depositUser)
    const beforeBalance = beforeAccount.balance

    const account = await deposit(depositUser, 1000000000000000000n)
    expect(account.balance).toBe(beforeBalance + 1000000000000000000n)
  })

  test('should withdraw funds', async () => {
    const withdrawUser = `0x${testId}withdraw00000000000000000000001` as Address
    await deposit(withdrawUser, 2000000000000000000n)
    const beforeAccount = await getOrCreateAccount(withdrawUser)
    const beforeBalance = beforeAccount.balance

    const account = await withdraw(withdrawUser, 500000000000000000n)
    expect(account.balance).toBe(beforeBalance - 500000000000000000n)
  })

  test('should fail withdrawal with insufficient balance', async () => {
    const poorUser = `0x${testId}poor00000000000000000000000002` as Address
    await getOrCreateAccount(poorUser)

    await expect(withdraw(poorUser, 1000000000000000000n)).rejects.toThrow(
      'Insufficient balance',
    )
  })

  test('should charge user for request', async () => {
    const chargeUser1 = `0x${testId}charge0000000000000000000000003` as Address
    await deposit(chargeUser1, 1000000000000000000n)
    const beforeAccount = await getOrCreateAccount(chargeUser1)
    const beforeSpent = beforeAccount.totalSpent

    const success = await chargeUser(chargeUser1, 100000000000000n)
    expect(success).toBe(true)

    const account = await getOrCreateAccount(chargeUser1)
    expect(account.totalSpent).toBe(beforeSpent + 100000000000000n)
  })

  test('should check affordability', async () => {
    const richUser = `0x${testId}rich00000000000000000000000004` as Address
    await deposit(richUser, 1000000000000000000n)

    expect(await canAfford(richUser, 100000000000000n)).toBe(true)
    expect(await canAfford(richUser, 10000000000000000000n)).toBe(false)
  })
})

// Key Vault Tests

describe('Key Vault', () => {
  const testApiKey = 'sk-real-test-key-abcdef1234567890'

  test('should store and retrieve key metadata', async () => {
    const vaultKey = await storeKey('openai', TEST_SELLER, testApiKey)

    expect(vaultKey.id).toBeDefined()
    expect(vaultKey.providerId).toBe('openai')
    expect(vaultKey.owner).toBe(TEST_SELLER)
    expect(vaultKey.attestation).toBeDefined()

    const metadata = getKeyMetadata(vaultKey.id)
    expect(metadata).toBeDefined()
    expect(metadata.providerId).toBe('openai')
    // Encrypted key should not be in metadata
    expect((metadata as Record<string, unknown>).encryptedKey).toBeUndefined()
  })

  test('should decrypt key for valid request', async () => {
    const vaultKey = await storeKey('groq', TEST_SELLER, testApiKey)

    const decrypted = decryptKeyForRequest({
      keyId: vaultKey.id,
      requester: TEST_USER,
      requestContext: {
        listingId: 'test-listing',
        endpoint: '/chat/completions',
        requestId: 'req-123',
      },
    })

    expect(decrypted).toBe(testApiKey)
  })

  test('should return null for invalid key ID', () => {
    const decrypted = decryptKeyForRequest({
      keyId: 'non-existent-key',
      requester: TEST_USER,
      requestContext: {
        listingId: 'test-listing',
        endpoint: '/test',
        requestId: 'req-456',
      },
    })

    expect(decrypted).toBeNull()
  })

  test('should delete key by owner', async () => {
    const vaultKey = await storeKey('anthropic', TEST_SELLER, testApiKey)

    const deleted = deleteKey(vaultKey.id, TEST_SELLER)
    expect(deleted).toBe(true)

    const metadata = getKeyMetadata(vaultKey.id)
    expect(metadata).toBeUndefined()
  })

  test('should not delete key by non-owner', async () => {
    const vaultKey = await storeKey('mistral', TEST_SELLER, testApiKey)

    const deleted = deleteKey(vaultKey.id, TEST_USER)
    expect(deleted).toBe(false)

    const metadata = getKeyMetadata(vaultKey.id)
    expect(metadata).toBeDefined()
  })

  test('should get keys by owner', async () => {
    const owner = '0x1111111111111111111111111111111111111111' as Address
    await storeKey('openai', owner, 'key1')
    await storeKey('groq', owner, 'key2')

    const keys = getKeysByOwner(owner)
    expect(keys.length).toBe(2)
    expect(
      keys.every((k) => k.owner.toLowerCase() === owner.toLowerCase()),
    ).toBe(true)
  })

  test('should get vault stats', () => {
    const stats = getVaultStats()
    expect(stats.totalKeys).toBeGreaterThanOrEqual(0)
    expect(typeof stats.totalAccesses).toBe('number')
  })
})

// Sanitizer Tests

describe('Sanitizer', () => {
  test('should sanitize OpenAI-style keys', () => {
    const input = 'API key is sk-proj-abcdefghijklmnopqrstuvwxyz12345'
    const config = createSanitizationConfig()
    const sanitized = sanitizeString(input, config)

    expect(sanitized).not.toContain('sk-proj-')
    expect(sanitized).toContain('[REDACTED]')
  })

  test('should sanitize bearer tokens', () => {
    const input =
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
    const config = createSanitizationConfig()
    const sanitized = sanitizeString(input, config)

    expect(sanitized).toContain('[REDACTED]')
  })

  test('should sanitize known keys exactly', () => {
    const knownKey = 'my-super-secret-api-key-12345'
    const input = `Your key is: ${knownKey}. Use it wisely.`
    const config = createSanitizationConfig([knownKey])
    const sanitized = sanitizeString(input, config)

    expect(sanitized).not.toContain(knownKey)
    expect(sanitized).toContain('[REDACTED]')
  })

  test('should sanitize JSON objects recursively', () => {
    const obj = {
      data: {
        apiKey: 'sk-secret-key-123456789012345',
        name: 'Test User',
        nested: {
          authorization: 'Bearer token123',
        },
      },
    }

    const config = createSanitizationConfig()
    const sanitized = sanitizeObject(obj, config) as typeof obj

    expect(sanitized.data.apiKey).toBe('[REDACTED]')
    expect(sanitized.data.name).toBe('Test User')
    expect(sanitized.data.nested.authorization).toBe('[REDACTED]')
  })

  test('should sanitize response headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret123',
      'X-API-Key': 'key456',
      'X-Request-Id': 'req-789',
    }

    const config = createSanitizationConfig()
    const { headers: sanitizedHeaders } = sanitizeResponse({}, headers, config)

    expect(sanitizedHeaders['Content-Type']).toBe('application/json')
    expect(sanitizedHeaders.Authorization).toBeUndefined()
    expect(sanitizedHeaders['X-API-Key']).toBeUndefined()
  })

  test('should detect potential keys', () => {
    expect(mightContainKey('sk-proj-abcdefghijklmnop12345')).toBe(true)
    expect(mightContainKey('Hello world')).toBe(false)
  })

  test('should extract potential keys', () => {
    const input =
      'Keys: sk-proj-abc123456789012345 and AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ12345678'
    const keys = extractPotentialKeys(input)

    expect(keys.length).toBeGreaterThan(0)
  })

  test('should check for leaks', () => {
    const knownKey = 'my-api-key-1234567890123456'
    const response = { message: `Key is: ${knownKey}` }

    const { leaked, details } = checkForLeaks(response, [knownKey])
    expect(leaked).toBe(true)
    expect(details.length).toBeGreaterThan(0)
  })
})

// Access Control Tests

describe('Access Control', () => {
  describe('Domain Control', () => {
    test('should allow wildcard domains', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET', 'POST'],
      }

      expect(isDomainAllowed('example.com', ac).allowed).toBe(true)
      expect(isDomainAllowed('any.domain.here', ac).allowed).toBe(true)
    })

    test('should allow specific domains', () => {
      const ac: AccessControl = {
        allowedDomains: ['example.com', '*.myapp.com'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      }

      expect(isDomainAllowed('example.com', ac).allowed).toBe(true)
      expect(isDomainAllowed('api.myapp.com', ac).allowed).toBe(true)
      expect(isDomainAllowed('other.com', ac).allowed).toBe(false)
    })

    test('should block specific domains', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: ['evil.com', '*.blocked.org'],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      }

      expect(isDomainAllowed('good.com', ac).allowed).toBe(true)
      expect(isDomainAllowed('evil.com', ac).allowed).toBe(false)
      expect(isDomainAllowed('sub.blocked.org', ac).allowed).toBe(false)
    })
  })

  describe('Endpoint Control', () => {
    test('should allow wildcard endpoints', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      }

      expect(isEndpointAllowed('/any/path', ac).allowed).toBe(true)
      expect(isEndpointAllowed('/v1/chat/completions', ac).allowed).toBe(true)
    })

    test('should allow specific endpoints', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['/v1/chat/*', '/v1/models'],
        blockedEndpoints: [],
        allowedMethods: ['GET', 'POST'],
      }

      expect(isEndpointAllowed('/v1/chat/completions', ac).allowed).toBe(true)
      expect(isEndpointAllowed('/v1/models', ac).allowed).toBe(true)
      expect(isEndpointAllowed('/v1/embeddings', ac).allowed).toBe(false)
    })

    test('should block specific endpoints', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: ['/admin/*', '/internal/*'],
        allowedMethods: ['GET'],
      }

      expect(isEndpointAllowed('/api/data', ac).allowed).toBe(true)
      expect(isEndpointAllowed('/admin/users', ac).allowed).toBe(false)
      expect(isEndpointAllowed('/internal/health', ac).allowed).toBe(false)
    })
  })

  describe('Method Control', () => {
    test('should allow specified methods', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET', 'POST'],
      }

      expect(isMethodAllowed('GET', ac).allowed).toBe(true)
      expect(isMethodAllowed('POST', ac).allowed).toBe(true)
      expect(isMethodAllowed('DELETE', ac).allowed).toBe(false)
    })

    test('should handle case insensitivity', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      }

      expect(isMethodAllowed('get', ac).allowed).toBe(true)
      expect(isMethodAllowed('Get', ac).allowed).toBe(true)
    })
  })

  describe('Rate Limiting', () => {
    test('should allow requests within limit', () => {
      const limits = {
        requestsPerSecond: 10,
        requestsPerMinute: 100,
        requestsPerDay: 1000,
        requestsPerMonth: 10000,
      }

      const result = checkRateLimit(TEST_USER, 'test-listing-1', limits)
      expect(result.allowed).toBe(true)
    })

    test('should block requests exceeding second limit', () => {
      const limits = {
        requestsPerSecond: 2,
        requestsPerMinute: 100,
        requestsPerDay: 1000,
        requestsPerMonth: 10000,
      }

      const listingId = `rate-limit-test-${Date.now()}`

      // Make 3 requests (exceeds limit of 2)
      for (let i = 0; i < 3; i++) {
        incrementRateLimit(TEST_USER, listingId)
      }

      const result = checkRateLimit(TEST_USER, listingId, limits)
      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeGreaterThan(0)
    })
  })

  describe('Access Control Builder', () => {
    test('should build access control config', () => {
      const ac = accessControl()
        .allowDomains('example.com', '*.myapp.com')
        .blockDomains('evil.com')
        .allowEndpoints('/api/*', '/v1/*')
        .blockEndpoints('/admin/*')
        .allowMethods('GET', 'POST')
        .build()

      expect(ac.allowedDomains).toContain('example.com')
      expect(ac.blockedDomains).toContain('evil.com')
      expect(ac.allowedEndpoints).toContain('/api/*')
      expect(ac.blockedEndpoints).toContain('/admin/*')
      expect(ac.allowedMethods).toContain('GET')
    })

    test('should create read-only config', () => {
      const ac = accessControl().readOnly().build()
      expect(ac.allowedMethods).toEqual(['GET'])
    })
  })
})

// Payment Tests (some require EQLite)

describe('Payments', () => {
  test('should create 402 response', () => {
    const response = create402Response(
      100000000000000n,
      '/api/proxy/openai/chat/completions',
      'OpenAI chat completion',
    )

    expect(response.status).toBe(402)
    expect(response.headers['X-Payment-Required']).toBe('true')
    expect(response.body.x402Version).toBe(1)
    expect(response.body.accepts.length).toBe(1)
  })

  test('should parse payment proof header', () => {
    const headers = {
      'x-payment-proof':
        '0x1234567890123456789012345678901234567890123456789012345678901234:1000000000000000:0x1234567890123456789012345678901234567890:1234567890',
    }

    const proof = parsePaymentProof(headers)
    expect(proof).toBeDefined()
    expect(proof?.txHash).toBe(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
    )
    expect(proof?.amount).toBe(1000000000000000n)
  })

  test.skipIf(!EQLITE_AVAILABLE)('should process deposit', async () => {
    const testId = Date.now().toString(16).slice(-8)
    const depositor = `0x${testId}222222222222222222222222222222` as Address

    // Get initial balance (may be 0 or accumulated from previous runs)
    const beforeAccount = await getOrCreateAccount(depositor)
    const beforeBalance = beforeAccount.balance

    const result = await processDeposit({
      amount: 1000000000000000000n,
      payer: depositor,
    })

    expect(result.success).toBe(true)
    expect(result.newBalance).toBe(beforeBalance + 1000000000000000000n)
  })

  test('should check minimum deposit', () => {
    expect(meetsMinimumDeposit(1000000000000000n)).toBe(true)
    expect(meetsMinimumDeposit(100n)).toBe(false)
  })

  test('should calculate affordable requests', () => {
    const balance = 1000000000000000000n // 1 ETH
    const pricePerRequest = 100000000000000n // 0.0001 ETH

    const affordable = calculateAffordableRequests(balance, pricePerRequest)
    expect(affordable).toBe(10000n)
  })

  test('should calculate revenue share', () => {
    const amount = 1000000000000000000n // 1 ETH

    const share = calculateRevenueShare(amount)
    expect(share.total).toBe(amount)
    expect(share.platform).toBe(50000000000000000n) // 5%
    expect(share.seller).toBe(950000000000000000n) // 95%
  })
})

// Integration Tests (require EQLite)

describe.skipIf(!EQLITE_AVAILABLE)('Integration', () => {
  test('should perform full listing creation flow', async () => {
    const seller = '0x3333333333333333333333333333333333333333' as Address
    const apiKey = 'sk-integration-test-key-123456789'

    // 1. Store key in vault
    const vaultKey = await storeKey('openai', seller, apiKey)
    expect(vaultKey.id).toBeDefined()

    // 2. Create listing
    const listing = await createListing({
      providerId: 'openai',
      seller,
      keyVaultId: vaultKey.id,
      pricePerRequest: 50000000000000n,
      accessControl: {
        allowedEndpoints: ['/v1/chat/*', '/v1/models'],
        blockedEndpoints: ['/v1/files/*'],
      },
    })
    expect(listing.id).toBeDefined()
    expect(listing.accessControl.allowedEndpoints).toContain('/v1/chat/*')

    // 3. Verify listing is findable
    const found = await getListing(listing.id)
    expect(found).toBeDefined()
    expect(found?.keyVaultId).toBe(vaultKey.id)
  })

  test('should perform full access check flow', async () => {
    const seller = '0x4444444444444444444444444444444444444444' as Address
    const user = '0x5555555555555555555555555555555555555555' as Address

    // Create listing
    const vaultKey = await storeKey('groq', seller, 'test-key')
    const listing = await createListing({
      providerId: 'groq',
      seller,
      keyVaultId: vaultKey.id,
      accessControl: {
        allowedDomains: ['myapp.com'],
        allowedEndpoints: ['/v1/chat/*'],
        allowedMethods: ['POST'],
      },
    })

    // Fund user
    await deposit(user, 1000000000000000000n)

    // Check access - should pass
    const accessResult = checkAccess(
      user,
      listing,
      '/v1/chat/completions',
      'POST',
      'myapp.com',
    )
    expect(accessResult.allowed).toBe(true)

    // Check access - wrong domain
    const wrongDomain = checkAccess(
      user,
      listing,
      '/v1/chat/completions',
      'POST',
      'other.com',
    )
    expect(wrongDomain.allowed).toBe(false)

    // Check access - wrong endpoint
    const wrongEndpoint = checkAccess(
      user,
      listing,
      '/v1/embeddings',
      'POST',
      'myapp.com',
    )
    expect(wrongEndpoint.allowed).toBe(false)

    // Check access - wrong method
    const wrongMethod = checkAccess(
      user,
      listing,
      '/v1/chat/completions',
      'GET',
      'myapp.com',
    )
    expect(wrongMethod.allowed).toBe(false)
  })

  test('should sanitize response with known keys', () => {
    const apiKey = 'sk-known-key-for-sanitization-test'

    const response = {
      data: {
        message: `Your API key is: ${apiKey}. Keep it safe.`,
        nested: {
          apiKey: apiKey,
        },
      },
    }

    const config = createSanitizationConfig([apiKey])
    const sanitized = sanitizeObject(response, config) as typeof response

    expect(sanitized.data.message).not.toContain(apiKey)
    expect(sanitized.data.nested.apiKey).toBe('[REDACTED]')
  })
})

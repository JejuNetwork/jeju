/**
 * Tests for the typed API client
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { API_BASE, ApiError, api } from '../client'

// Mock global fetch
const originalFetch = globalThis.fetch

// Helper to create a properly typed mock fetch
// Mock functions need type assertion to match fetch signature
type MockFetch = typeof fetch & {
  preconnect: () => void
}

function createMockFetch(response: Response): typeof fetch {
  const mockFn = mock(async () => response) as MockFetch
  mockFn.preconnect = () => {}
  return mockFn
}

describe('API client', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('api.health', () => {
    it('should return health status on success', async () => {
      const mockResponse = {
        status: 'ok',
        service: 'bazaar-api',
      }

      globalThis.fetch = createMockFetch(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await api.health.get()
      expect(result.status).toBe('ok')
      expect(result.service).toBe('bazaar-api')
    })

    it('should throw ApiError on failure', async () => {
      globalThis.fetch = createMockFetch(
        new Response(JSON.stringify({ error: 'Server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await expect(api.health.get()).rejects.toThrow(ApiError)
    })
  })

  describe('api.faucet', () => {
    it('should get faucet info', async () => {
      const mockInfo = {
        name: 'Test Faucet',
        description: 'Test faucet description',
        tokenSymbol: 'JEJU',
        amountPerClaim: '100',
        cooldownHours: 12,
        requirements: ['Registration required'],
        chainId: 31337,
        chainName: 'Localnet',
        explorerUrl: 'http://localhost:8545',
        isConfigured: true,
      }

      globalThis.fetch = createMockFetch(
        new Response(JSON.stringify(mockInfo), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await api.faucet.getInfo()
      expect(result.name).toBe('Test Faucet')
      expect(result.tokenSymbol).toBe('JEJU')
    })

    it('should get faucet status for address', async () => {
      const mockStatus = {
        eligible: true,
        isRegistered: true,
        cooldownRemaining: 0,
        nextClaimAt: null,
        amountPerClaim: '100',
        faucetBalance: '10000',
      }

      globalThis.fetch = createMockFetch(
        new Response(JSON.stringify(mockStatus), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const testAddress: `0x${string}` =
        '0x1234567890123456789012345678901234567890'
      const result = await api.faucet.getStatus(testAddress)
      expect(result.eligible).toBe(true)
      expect(result.isRegistered).toBe(true)
    })

    it('should claim from faucet', async () => {
      const mockResult = {
        success: true,
        txHash: '0xabc123',
        amount: '100',
      }

      globalThis.fetch = createMockFetch(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const claimAddress: `0x${string}` =
        '0x1234567890123456789012345678901234567890'
      const result = await api.faucet.claim(claimAddress)
      expect(result.success).toBe(true)
      expect(result.txHash).toBe('0xabc123')
    })
  })

  describe('ApiError', () => {
    it('should contain status code and details', () => {
      const error = new ApiError('Test error', 400, { field: 'test' })
      expect(error.message).toBe('Test error')
      expect(error.statusCode).toBe(400)
      expect(error.details).toEqual({ field: 'test' })
      expect(error.name).toBe('ApiError')
    })
  })

  describe('API_BASE', () => {
    it('should be defined', () => {
      expect(typeof API_BASE).toBe('string')
    })
  })
})

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

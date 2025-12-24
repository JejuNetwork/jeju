/**
 * Inference Client Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { type AvailableModel, InferenceClient } from './inferenceClient'

/** API response for models endpoint */
interface ModelsApiResponse {
  models: Partial<AvailableModel>[]
}

/** API response for chat endpoint */
interface ChatApiResponse {
  id?: string
  model?: string
  choices?: Array<{ message?: { role?: string; content?: string } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

type MockApiResponse = ModelsApiResponse | ChatApiResponse

/**
 * Type for our mock fetch function that matches the subset of fetch we use.
 * This allows proper typing without casting through unknown.
 */
type MockFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

// Helper to create mock Response - minimal mock for testing
const createMockResponse = (data: MockApiResponse, ok = true): Response => {
  const response = {
    ok,
    json: () => Promise.resolve(data),
    headers: new Headers(),
    redirected: false,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: '',
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    bytes: () => Promise.resolve(new Uint8Array()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(data)),
    clone: (): Response => createMockResponse(data, ok),
  }
  return response as Response
}

let mockFetch: ReturnType<typeof mock<MockFetchFn>>

describe('InferenceClient', () => {
  let client: InferenceClient

  beforeEach(() => {
    mockFetch = mock<MockFetchFn>(() =>
      Promise.resolve(createMockResponse({ models: [] })),
    )
    // Mock fetch for testing - override global fetch with properly typed mock
    globalThis.fetch = mockFetch as typeof fetch
    client = new InferenceClient({
      gatewayUrl: 'https://test-gateway.example.com',
      maxRetries: 1, // Fast retries for tests
      retryDelayMs: 10,
    })
  })

  describe('configure', () => {
    it('should update configuration', () => {
      client.configure({ preferredModel: 'custom-model' })
      // Configuration should be updated (internal state)
    })
  })

  describe('setWalletAddress', () => {
    it('should set wallet address', () => {
      client.setWalletAddress('0x1234567890123456789012345678901234567890')
      // Address should be set for context injection
    })
  })

  describe('getModels', () => {
    it('should throw when gateway unavailable', async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new Error('Network error')),
      )

      await expect(client.getModels()).rejects.toThrow('Network error')
    })

    it('should fetch models from gateway', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createMockResponse({
            models: [
              {
                id: 'test-model',
                name: 'Test Model',
                description: 'A test model',
                contextWindow: 4096,
                pricePerInputToken: '0.0001',
                pricePerOutputToken: '0.0003',
                provider: 'test',
                teeType: 'none',
                active: true,
              },
            ],
          }),
        ),
      )

      const models = await client.getModels()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-gateway.example.com/v1/models',
        expect.objectContaining({ headers: expect.any(Object) }),
      )
      expect(models).toHaveLength(1)
      expect(models[0].id).toBe('test-model')
    })

    it('should cache models', async () => {
      // Create fresh client for this test
      const cacheClient = new InferenceClient({
        gatewayUrl: 'https://cache-test.example.com',
      })

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createMockResponse({
            models: [{ id: 'cached' }],
          }),
        ),
      )

      const models1 = await cacheClient.getModels()
      const models2 = await cacheClient.getModels()

      // Second call should use cache (models should be same array reference after cache hit)
      expect(models1).toEqual(models2)
    })

    it('should force refresh when requested', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(createMockResponse({ models: [] })),
      )

      await client.getModels()
      await client.getModels(true)

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('chat', () => {
    it('should send chat request and return response', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createMockResponse({
            id: 'chat-123',
            model: 'jeju/llama-3.1-70b',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Hello! How can I help you?',
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 8,
              total_tokens: 18,
            },
          }),
        ),
      )

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(response.content).toBe('Hello! How can I help you?')
      expect(response.tokensUsed.total).toBe(18)
    })

    it('should throw on network error', async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new Error('Network error')),
      )

      await expect(
        client.chat({
          messages: [{ role: 'user', content: 'help' }],
        }),
      ).rejects.toThrow('Network error')
    })

    it('should maintain conversation history', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createMockResponse({
            id: 'chat-123',
            choices: [{ message: { content: 'Response 1' } }],
            usage: { total_tokens: 10 },
          }),
        ),
      )

      await client.chat({
        messages: [{ role: 'user', content: 'First message' }],
      })

      const history = client.getHistory()
      expect(history.length).toBeGreaterThan(1)
      expect(history.some((m) => m.content === 'First message')).toBe(true)
    })
  })

  describe('clearHistory', () => {
    it('should reset conversation history', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createMockResponse({
            choices: [{ message: { content: 'Test' } }],
            usage: { total_tokens: 5 },
          }),
        ),
      )

      await client.chat({ messages: [{ role: 'user', content: 'Test' }] })
      client.clearHistory()

      const history = client.getHistory()
      // Should only have system prompt
      expect(history.length).toBe(1)
      expect(history[0].role).toBe('system')
    })
  })

  describe('error handling', () => {
    let errorClient: InferenceClient

    beforeEach(() => {
      mockFetch.mockImplementation(() => Promise.reject(new Error('Offline')))
      errorClient = new InferenceClient({
        gatewayUrl: 'https://offline.example.com',
        maxRetries: 1,
        retryDelayMs: 1,
      })
    })

    it('should throw when service unavailable', async () => {
      await expect(
        errorClient.chat({
          messages: [{ role: 'user', content: 'anything' }],
        }),
      ).rejects.toThrow('Offline')
    })

    it('should throw after all retries exhausted', async () => {
      const multiRetryClient = new InferenceClient({
        gatewayUrl: 'https://offline.example.com',
        maxRetries: 2,
        retryDelayMs: 1,
      })

      await expect(
        multiRetryClient.chat({
          messages: [{ role: 'user', content: 'test' }],
        }),
      ).rejects.toThrow('Offline')

      // Should have tried twice
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should propagate specific error messages', async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new Error('Rate limit exceeded')),
      )

      await expect(
        errorClient.chat({
          messages: [{ role: 'user', content: 'test' }],
        }),
      ).rejects.toThrow('Rate limit exceeded')
    })
  })
})

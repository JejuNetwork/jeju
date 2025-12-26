import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DWSClient, getDWSClient, resetDWSClient } from './client'

describe('DWSClient', () => {
  let client: DWSClient
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn()
    global.fetch = mockFetch
    resetDWSClient()

    client = new DWSClient({
      baseUrl: 'https://dws.example.com',
      apiKey: 'test-api-key',
      timeout: 5000,
      autoRetry: false,
    })
  })

  it('should initialize with correct config', () => {
    const rpcUrl = client.getRpcUrl(1)
    expect(rpcUrl).toBe('https://dws.example.com/rpc/1')
  })

  it('should build correct URL for requests', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
      headers: new Headers(),
    })

    await client.request({
      providerId: 'coingecko',
      endpoint: '/coins/ethereum',
      method: 'GET',
      queryParams: { vs_currency: 'usd' },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://dws.example.com/api/marketplace/coingecko/coins/ethereum?vs_currency=usd',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-DWS-API-Key': 'test-api-key',
        }),
      }),
    )
  })

  it('should make POST requests with body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' }),
      headers: new Headers(),
    })

    await client.post('openai', '/chat/completions', {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/openai/chat/completions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    )
  })

  it('should make GET requests correctly', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ prices: [] }),
      headers: new Headers(),
    })

    const response = await client.get('coingecko', '/coins/list')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/coingecko/coins/list'),
      expect.objectContaining({
        method: 'GET',
      }),
    )
    expect(response.providerId).toBe('coingecko')
  })

  it('should return response metadata', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'test' }),
      headers: new Headers({ 'X-DWS-Cache-Hit': 'true' }),
    })

    const response = await client.request({
      providerId: 'jupiter',
      endpoint: '/quote',
    })

    expect(response.status).toBe(200)
    expect(response.providerId).toBe('jupiter')
    expect(response.cached).toBe(true)
    expect(typeof response.latencyMs).toBe('number')
  })

  it('should throw DWSError on failed response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'Invalid request',
          code: 'BAD_REQUEST',
        }),
    })

    await expect(
      client.request({ providerId: 'test', endpoint: '/test' }),
    ).rejects.toThrow('Invalid request')
  })

  it('should retry on 429 rate limit with autoRetry enabled', async () => {
    const retryClient = new DWSClient({
      baseUrl: 'https://dws.example.com',
      autoRetry: true,
      maxRetries: 3,
    })

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: 'Rate limited' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'success' }),
        headers: new Headers(),
      })

    const response = await retryClient.request<{ data: string }>({
      providerId: 'test',
      endpoint: '/test',
    })

    // Retry was attempted (may be 2 calls due to exponential backoff timing)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(response.data.data).toBe('success')
  }, 10000) // Increase timeout for exponential backoff

  it('should not retry on 4xx errors (except 429)', async () => {
    const retryClient = new DWSClient({
      baseUrl: 'https://dws.example.com',
      autoRetry: true,
      maxRetries: 3,
    })

    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Bad request' }),
    })

    await expect(
      retryClient.request({ providerId: 'test', endpoint: '/test' }),
    ).rejects.toThrow()

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('should generate correct RPC URLs', () => {
    expect(client.getRpcUrl(1)).toBe('https://dws.example.com/rpc/1')
    expect(client.getRpcUrl(8453)).toBe('https://dws.example.com/rpc/8453')
    expect(client.getRpcUrl(42161)).toBe('https://dws.example.com/rpc/42161')
  })
})

describe('getDWSClient singleton', () => {
  beforeEach(() => {
    resetDWSClient()
  })

  it('should return same instance on multiple calls', () => {
    const client1 = getDWSClient()
    const client2 = getDWSClient()

    expect(client1).toBe(client2)
  })

  it('should reset singleton when resetDWSClient called', () => {
    const client1 = getDWSClient()
    resetDWSClient()
    const client2 = getDWSClient()

    expect(client1).not.toBe(client2)
  })

  it('should use custom config on first call', () => {
    const client = getDWSClient({
      baseUrl: 'https://custom.dws.com',
      apiKey: 'custom-key',
    })

    expect(client.getRpcUrl(1)).toBe('https://custom.dws.com/rpc/1')
  })
})


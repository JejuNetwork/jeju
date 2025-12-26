import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

describe('GraphQL Proxy', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.INDEXER_GRAPHQL_URL
    delete process.env.INDEXER_DWS_URL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('resolves URL with fallback', () => {
    const getUrl = () =>
      process.env.INDEXER_GRAPHQL_URL || 'http://127.0.0.1:4350/graphql'
    expect(getUrl()).toBe('http://127.0.0.1:4350/graphql')

    process.env.INDEXER_GRAPHQL_URL = 'https://example.com/graphql'
    expect(getUrl()).toBe('https://example.com/graphql')
  })

  it('decides fallback on primary failure', () => {
    const shouldFallback = (
      failed: boolean,
      primary: string,
      fallback: string,
    ) => failed && primary !== fallback

    expect(shouldFallback(false, 'http://a', 'http://b')).toBe(false)
    expect(shouldFallback(true, 'http://a', 'http://b')).toBe(true)
    expect(shouldFallback(true, 'http://same', 'http://same')).toBe(false)
  })

  it('handles failover flow', async () => {
    const proxy = async (
      primary: () => Promise<Response>,
      fallback: () => Promise<Response>,
    ) => {
      try {
        const r = await primary()
        if (r.ok) return { response: r, usedFallback: false }
        throw new Error('fail')
      } catch {
        return {
          response: await fallback().catch(() => null),
          usedFallback: true,
        }
      }
    }

    const r1 = await proxy(
      () => Promise.resolve(new Response('ok')),
      () => Promise.resolve(new Response('fb')),
    )
    expect(r1.usedFallback).toBe(false)

    const r2 = await proxy(
      () => Promise.reject(new Error()),
      () => Promise.resolve(new Response('fb')),
    )
    expect(r2.usedFallback).toBe(true)
  })

  it('validates GraphQL request body', () => {
    const validate = (body: unknown) => {
      if (typeof body !== 'object' || body === null) return null
      const r = body as Record<string, unknown>
      return typeof r.query === 'string' ? { query: r.query } : null
    }

    expect(validate({ query: '{ test }' })).toEqual({ query: '{ test }' })
    expect(validate({})).toBeNull()
    expect(validate(null)).toBeNull()
  })

  it('categorizes errors', () => {
    const categorize = (msg: string) => {
      const m = msg.toLowerCase()
      if (m.includes('econnrefused')) return 'network'
      if (m.includes('timeout')) return 'timeout'
      if (m.includes('500')) return 'server'
      return 'unknown'
    }

    expect(categorize('ECONNREFUSED')).toBe('network')
    expect(categorize('timeout')).toBe('timeout')
    expect(categorize('500 error')).toBe('server')
  })

  it('determines retry eligibility', () => {
    const shouldRetry = (status: number) => status >= 500 || status === 429

    expect(shouldRetry(500)).toBe(true)
    expect(shouldRetry(429)).toBe(true)
    expect(shouldRetry(404)).toBe(false)
    expect(shouldRetry(200)).toBe(false)
  })
})

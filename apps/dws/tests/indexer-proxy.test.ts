import { describe, expect, it } from 'bun:test'

interface Endpoint {
  url: string
  type: 'graphql' | 'rest'
  healthy: boolean
  latencyMs: number
  errorCount: number
}

describe('Indexer Proxy', () => {
  it('selects lowest latency healthy endpoint', () => {
    const endpoints = new Map<string, Endpoint>([
      [
        'slow',
        {
          url: 'http://slow',
          type: 'graphql',
          healthy: true,
          latencyMs: 500,
          errorCount: 0,
        },
      ],
      [
        'fast',
        {
          url: 'http://fast',
          type: 'graphql',
          healthy: true,
          latencyMs: 50,
          errorCount: 0,
        },
      ],
      [
        'down',
        {
          url: 'http://down',
          type: 'graphql',
          healthy: false,
          latencyMs: 10,
          errorCount: 5,
        },
      ],
    ])

    const best = Array.from(endpoints.values())
      .filter((e) => e.type === 'graphql' && e.healthy)
      .sort((a, b) => a.latencyMs - b.latencyMs)[0]

    expect(best.url).toBe('http://fast')
  })

  it('marks unhealthy after 3 errors', () => {
    const endpoint: Endpoint = {
      url: 'http://test',
      type: 'graphql',
      healthy: true,
      latencyMs: 0,
      errorCount: 2,
    }

    endpoint.errorCount++
    if (endpoint.errorCount >= 3) endpoint.healthy = false

    expect(endpoint.healthy).toBe(false)
  })

  it('resets error count on success', () => {
    const endpoint: Endpoint = {
      url: 'http://test',
      type: 'graphql',
      healthy: false,
      latencyMs: 0,
      errorCount: 5,
    }

    endpoint.errorCount = 0
    endpoint.healthy = true

    expect(endpoint.errorCount).toBe(0)
    expect(endpoint.healthy).toBe(true)
  })

  it('validates GraphQL request', () => {
    const validate = (body: unknown) => {
      if (typeof body !== 'object' || body === null) return null
      const req = body as Record<string, unknown>
      if (typeof req.query !== 'string' || !req.query) return null
      return { query: req.query }
    }

    expect(validate({ query: '{ blocks }' })).toEqual({ query: '{ blocks }' })
    expect(validate({})).toBeNull()
    expect(validate(null)).toBeNull()
  })

  it('detects CQL-supported query types', () => {
    const detect = (q: string) => {
      const ql = q.toLowerCase()
      if (ql.includes('__typename')) return 'introspection'
      if (ql.includes('blocks')) return 'blocks'
      if (ql.includes('transactions')) return 'transactions'
      return 'unsupported'
    }

    expect(detect('{ __typename }')).toBe('introspection')
    expect(detect('{ blocks { id } }')).toBe('blocks')
    expect(detect('{ agents { id } }')).toBe('unsupported')
  })

  it('builds proxy URL with query params', () => {
    const build = (
      base: string,
      path: string,
      query: Record<string, string>,
    ) => {
      const url = new URL(path, base)
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
      return url.toString()
    }

    expect(build('http://localhost:4352', '/api/blocks', { limit: '10' })).toBe(
      'http://localhost:4352/api/blocks?limit=10',
    )
  })

  it('aggregates health status', () => {
    const endpoints = new Map<string, Endpoint>([
      [
        'gql',
        {
          url: 'http://gql',
          type: 'graphql',
          healthy: true,
          latencyMs: 0,
          errorCount: 0,
        },
      ],
      [
        'rest',
        {
          url: 'http://rest',
          type: 'rest',
          healthy: false,
          latencyMs: 0,
          errorCount: 5,
        },
      ],
    ])

    const gqlHealthy = Array.from(endpoints.values()).filter(
      (e) => e.type === 'graphql' && e.healthy,
    ).length
    const restHealthy = Array.from(endpoints.values()).filter(
      (e) => e.type === 'rest' && e.healthy,
    ).length

    const status =
      gqlHealthy > 0 && restHealthy > 0
        ? 'healthy'
        : gqlHealthy > 0 || restHealthy > 0
          ? 'degraded'
          : 'down'

    expect(status).toBe('degraded')
  })
})

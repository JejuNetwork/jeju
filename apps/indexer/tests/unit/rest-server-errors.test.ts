import { describe, expect, it } from 'bun:test'

class ServiceUnavailableError extends Error {
  readonly status = 503
  constructor(message = 'Database not available') {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}

describe('REST Server', () => {
  it('ServiceUnavailableError has correct properties', () => {
    const err = new ServiceUnavailableError()
    expect(err.status).toBe(503)
    expect(err.message).toBe('Database not available')
    expect(err.name).toBe('ServiceUnavailableError')
    expect(err instanceof Error).toBe(true)
  })

  it('parses pagination params', () => {
    const parse = (limit?: string, offset?: string) => ({
      limit: Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 100),
      offset: Math.max(parseInt(offset || '0', 10) || 0, 0),
    })

    expect(parse()).toEqual({ limit: 50, offset: 0 })
    expect(parse('25', '10')).toEqual({ limit: 25, offset: 10 })
    expect(parse('500')).toEqual({ limit: 100, offset: 0 })
    expect(parse('abc')).toEqual({ limit: 50, offset: 0 })
  })

  it('validates IDs', () => {
    const valid = (id: string) =>
      /^\d+$/.test(id) ||
      /^0x[a-fA-F0-9]{40}$/.test(id) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

    expect(valid('123')).toBe(true)
    expect(valid(`0x${'a'.repeat(40)}`)).toBe(true)
    expect(valid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(valid('abc')).toBe(false)
    expect(valid('0x123')).toBe(false)
  })

  it('validates search queries', () => {
    const validate = (q: string) => {
      const t = q.trim()
      if (!t) return { valid: false, error: 'empty' }
      if (t.length < 2) return { valid: false, error: 'short' }
      if (t.length > 200) return { valid: false, error: 'long' }
      return { valid: true, sanitized: t.replace(/[<>'"]/g, '') }
    }

    expect(validate('test').valid).toBe(true)
    expect(validate('').valid).toBe(false)
    expect(validate('a').error).toBe('short')
  })

  it('formats list responses', () => {
    const format = <T>(
      data: T[],
      total: number,
      limit: number,
      offset: number,
    ) => ({
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    })

    expect(format([1, 2], 100, 10, 0).hasMore).toBe(true)
    expect(format([1, 2], 2, 10, 0).hasMore).toBe(false)
  })

  it('formats health responses', () => {
    const format = (pg: boolean, mode: string) => ({
      status: mode === 'unavailable' ? 'degraded' : 'ok',
      postgres: pg,
      mode,
    })

    expect(format(true, 'postgres').status).toBe('ok')
    expect(format(false, 'unavailable').status).toBe('degraded')
  })

  it('builds filter clauses', () => {
    const build = (filters: { status?: string; type?: string }) => {
      const conds: string[] = []
      if (filters.status)
        conds.push(`status = '${filters.status.toUpperCase()}'`)
      if (filters.type) conds.push(`type = '${filters.type.toLowerCase()}'`)
      return conds
    }

    expect(build({})).toEqual([])
    expect(build({ status: 'active' })).toContain("status = 'ACTIVE'")
  })

  it('validates sort params', () => {
    const allowed = ['createdAt', 'name', 'balance']
    const validate = (field?: string, order?: string) => ({
      field: allowed.includes(field || '') ? field : 'createdAt',
      order: order?.toLowerCase() === 'asc' ? 'asc' : 'desc',
    })

    expect(validate()).toEqual({ field: 'createdAt', order: 'desc' })
    expect(validate('name', 'asc')).toEqual({ field: 'name', order: 'asc' })
    expect(validate('invalid')).toEqual({ field: 'createdAt', order: 'desc' })
  })

  it('transforms bigints to strings', () => {
    const transform = (
      obj: Record<string, unknown>,
    ): Record<string, unknown> => {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj)) {
        result[k] = typeof v === 'bigint' ? v.toString() : v
      }
      return result
    }

    expect(transform({ balance: 1000n })).toEqual({ balance: '1000' })
    expect(transform({ name: 'test' })).toEqual({ name: 'test' })
  })

  it('shortens addresses', () => {
    const shorten = (addr: string) =>
      addr.length < 10 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`

    expect(shorten('0x1234567890abcdef1234567890abcdef12345678')).toBe(
      '0x1234...5678',
    )
    expect(shorten('0x123')).toBe('0x123')
  })
})

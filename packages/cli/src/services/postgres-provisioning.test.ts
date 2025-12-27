import { describe, expect, it } from 'bun:test'

describe('PostgreSQL Provisioning', () => {
  it('calculates exponential backoff', () => {
    const backoff = (attempt: number, max: number) =>
      Math.min(1000 * 2 ** (attempt - 1), max)

    expect(backoff(1, 30000)).toBe(1000)
    expect(backoff(2, 30000)).toBe(2000)
    expect(backoff(5, 10000)).toBe(10000)
  })

  it('validates port numbers', () => {
    const valid = (p: number) => Number.isInteger(p) && p > 0 && p <= 65535

    expect(valid(5432)).toBe(true)
    expect(valid(0)).toBe(false)
    expect(valid(65536)).toBe(false)
  })

  it('validates hostnames', () => {
    const valid = (h: string) => {
      if (!h) return false
      if (h === 'localhost' || h === '::1') return true
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h))
        return h.split('.').every((p) => +p <= 255)
      return /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/.test(h)
    }

    expect(valid('localhost')).toBe(true)
    expect(valid('127.0.0.1')).toBe(true)
    expect(valid('256.0.0.1')).toBe(false)
    expect(valid('')).toBe(false)
  })

  it('builds connection strings', () => {
    const build = (
      host: string,
      port: number,
      db: string,
      user: string,
      pass: string,
    ) =>
      `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`

    expect(build('localhost', 5432, 'db', 'user', 'pass')).toBe(
      'postgresql://user:pass@localhost:5432/db',
    )
    expect(build('localhost', 5432, 'db', 'user', 'p@ss!')).toContain('p%40ss!')
  })

  it('matches container names', () => {
    const patterns = ['postgres', 'pg', 'indexer-db']
    const matches = (name: string) => patterns.some((p) => name.includes(p))

    expect(matches('jeju-postgres')).toBe(true)
    expect(matches('redis')).toBe(false)
  })

  it('extracts postgres port from mappings', () => {
    const extract = (ports: { host: number; container: number }[]) =>
      ports.find((p) => p.container === 5432)?.host ?? null

    expect(extract([{ host: 23798, container: 5432 }])).toBe(23798)
    expect(extract([{ host: 6379, container: 6379 }])).toBeNull()
  })

  it('selects indexer mode', () => {
    const mode = (pg: boolean, eqlite: boolean, force: boolean) =>
      force ? 'eqlite-only' : pg ? 'postgres' : eqlite ? 'eqlite-only' : 'unavailable'

    expect(mode(true, true, false)).toBe('postgres')
    expect(mode(false, true, false)).toBe('eqlite-only')
    expect(mode(true, true, true)).toBe('eqlite-only')
    expect(mode(false, false, false)).toBe('unavailable')
  })

  it('detects required schema tables', () => {
    const required = ['block', 'transaction', 'agent']
    const hasAll = (tables: string[]) =>
      required.every((t) => tables.includes(t))

    expect(hasAll(['block', 'transaction', 'agent', 'token'])).toBe(true)
    expect(hasAll(['block'])).toBe(false)
  })

  it('parses health responses', () => {
    const parse = (r: unknown) => {
      if (typeof r !== 'object' || r === null) return null
      const o = r as Record<string, unknown>
      if (!['ok', 'error', 'degraded'].includes(o.status as string)) return null
      return { status: o.status }
    }

    expect(parse({ status: 'ok' })).toEqual({ status: 'ok' })
    expect(parse({})).toBeNull()
    expect(parse(null)).toBeNull()
  })
})

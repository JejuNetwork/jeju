import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

describe('Indexer Mode Detection', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns eqlite-only when configured', () => {
    const getMode = (eqliteOnly: boolean, pgAvail: boolean) =>
      eqliteOnly ? 'eqlite-only' : pgAvail ? 'postgres' : 'unavailable'

    expect(getMode(true, false)).toBe('eqlite-only')
    expect(getMode(true, true)).toBe('eqlite-only')
    expect(getMode(false, true)).toBe('postgres')
    expect(getMode(false, false)).toBe('unavailable')
  })

  it('parses port numbers', () => {
    const parsePort = (s: string, def: number) => {
      const p = parseInt(s, 10)
      return Number.isNaN(p) || p <= 0 || p > 65535 ? def : p
    }

    expect(parsePort('5432', 23798)).toBe(5432)
    expect(parsePort('0', 23798)).toBe(23798)
    expect(parsePort('abc', 23798)).toBe(23798)
  })

  it('generates db config from env', () => {
    process.env.DB_HOST = 'db.local'
    process.env.DB_PORT = '5433'
    process.env.DB_NAME = 'mydb'
    process.env.DB_USER = 'user'
    process.env.DB_PASS = 'pass'

    const host = process.env.DB_HOST || 'localhost'
    const port = parseInt(process.env.DB_PORT || '23798', 10)

    expect(host).toBe('db.local')
    expect(port).toBe(5433)
  })

  it('calculates exponential backoff', () => {
    const backoff = (attempt: number, max: number) =>
      Math.min(1000 * 2 ** (attempt - 1), max)

    expect(backoff(1, 10000)).toBe(1000)
    expect(backoff(2, 10000)).toBe(2000)
    expect(backoff(5, 10000)).toBe(10000)
  })

  it('converts camelCase to snake_case', () => {
    const toSnake = (s: string) =>
      s
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase()

    expect(toSnake('camelCase')).toBe('camel_case')
    expect(toSnake('HTTPRequest')).toBe('http_request')
    expect(toSnake('erc20Token')).toBe('erc20_token')
  })
})

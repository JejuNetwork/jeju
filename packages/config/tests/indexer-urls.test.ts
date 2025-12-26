import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

describe('Indexer URL Configuration', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.INDEXER_GRAPHQL_URL
    delete process.env.INDEXER_DWS_URL
    delete process.env.USE_DWS_INDEXER
    delete process.env.HOST
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('resolves URL with priority order', () => {
    const getUrl = () => {
      if (process.env.INDEXER_GRAPHQL_URL)
        return process.env.INDEXER_GRAPHQL_URL
      if (process.env.INDEXER_DWS_URL) return process.env.INDEXER_DWS_URL
      if (process.env.USE_DWS_INDEXER === 'true')
        return `http://${process.env.HOST || '127.0.0.1'}:4030/indexer/graphql`
      return `http://${process.env.HOST || '127.0.0.1'}:4350/graphql`
    }

    expect(getUrl()).toBe('http://127.0.0.1:4350/graphql')

    process.env.USE_DWS_INDEXER = 'true'
    expect(getUrl()).toBe('http://127.0.0.1:4030/indexer/graphql')

    process.env.INDEXER_DWS_URL = 'https://dws.example.com/indexer/graphql'
    expect(getUrl()).toBe('https://dws.example.com/indexer/graphql')

    process.env.INDEXER_GRAPHQL_URL = 'https://direct.example.com/graphql'
    expect(getUrl()).toBe('https://direct.example.com/graphql')
  })

  it('respects HOST env var', () => {
    process.env.HOST = '192.168.1.100'
    const url = `http://${process.env.HOST}:4350/graphql`
    expect(url).toBe('http://192.168.1.100:4350/graphql')
  })

  it('validates HTTP URLs', () => {
    const isValid = (url: string) => {
      try {
        const p = new URL(url)
        return p.protocol === 'http:' || p.protocol === 'https:'
      } catch {
        return false
      }
    }

    expect(isValid('http://127.0.0.1:4350/graphql')).toBe(true)
    expect(isValid('https://example.com/graphql')).toBe(true)
    expect(isValid('ftp://example.com')).toBe(false)
    expect(isValid('not-a-url')).toBe(false)
  })
})

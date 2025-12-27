/**
 * Connection Tests
 *
 * Tests the EQLite connection handling and API detection.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { Connection } from '../src/Connection'
import type { ConnectionConfig } from '../src/ConnectionConfig'

// Mock fetch for testing
const originalFetch = global.fetch

describe('Connection', () => {
  beforeEach(() => {
    // Reset fetch mock
    global.fetch = originalFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('should create a connection with config', () => {
    const config: ConnectionConfig = {
      endpoint: 'http://localhost:4661',
      dbid: 'test-db',
    }

    const conn = new Connection(config)
    expect(conn.config).toEqual(config)
    expect(conn.state).toBe('disconnected')
    expect(conn.isConnected).toBe(false)
  })

  test('should connect via EQLite API', async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes('/v1/query') || url.includes('/v1/exec')) {
        return new Response(
          JSON.stringify({
            data: { rows: [{ '1': 1 }] },
            status: 'ok',
          }),
          { status: 200 },
        )
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const conn = new Connection({
      endpoint: 'http://localhost:4661',
      dbid: 'test',
    })

    await conn.connect()
    expect(conn.isConnected).toBe(true)
  })

  test('should detect EQLite API', async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes('/status') || url.includes('/api/v1/status')) {
        return new Response('Not found', { status: 404 })
      }
      if (url.includes('/v1/query')) {
        return new Response(
          JSON.stringify({
            data: { rows: [{ '1': 1 }] },
            status: 'ok',
          }),
          { status: 200 },
        )
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const conn = new Connection({
      endpoint: 'http://localhost:4661',
      dbid: 'test',
    })

    await conn.connect()
    expect(conn.isConnected).toBe(true)
  })

  test('should execute query', async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes('/v1/query')) {
        return new Response(
          JSON.stringify({
            data: {
              rows: [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
              ],
            },
            status: 'ok',
          }),
          { status: 200 },
        )
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const conn = new Connection({
      endpoint: 'http://localhost:4661',
      dbid: 'test',
    })

    await conn.connect()
    const rows = await conn.query('SELECT * FROM users')

    expect(rows).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
  })

  test('should execute write', async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes('/v1/query')) {
        return new Response(
          JSON.stringify({
            data: { rows: [{ '1': 1 }] },
            status: 'ok',
          }),
          { status: 200 },
        )
      }
      if (url.includes('/v1/exec')) {
        return new Response(
          JSON.stringify({
            data: { rows: [] },
            status: 'ok',
          }),
          { status: 200 },
        )
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const conn = new Connection({
      endpoint: 'http://localhost:4661',
      dbid: 'test',
    })

    await conn.connect()
    const result = await conn.exec('INSERT INTO users (name) VALUES (?)', [
      'Charlie',
    ])

    expect(result).toEqual([])
  })

  test('should check health correctly', async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes('/v1/status')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const conn = new Connection({
      endpoint: 'http://localhost:4661',
      dbid: 'test',
    })

    const healthy = await conn.isHealthy()
    expect(healthy).toBe(true)
  })

  test('should handle connection errors', async () => {
    global.fetch = mock(async () => {
      throw new Error('Connection refused')
    }) as typeof fetch

    const conn = new Connection({
      endpoint: 'http://localhost:9999',
      dbid: 'test',
    })

    await expect(conn.connect()).rejects.toThrow()
  })

  test('should close connection', async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes('/v1/query') || url.includes('/v1/exec')) {
        return new Response(
          JSON.stringify({
            data: { rows: [{ '1': 1 }] },
            status: 'ok',
          }),
          { status: 200 },
        )
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const conn = new Connection({
      endpoint: 'http://localhost:4661',
      dbid: 'test',
    })

    await conn.connect()
    expect(conn.isConnected).toBe(true)

    await conn.close()
    expect(conn.isConnected).toBe(false)
    expect(conn.state).toBe('disconnected')
  })
})

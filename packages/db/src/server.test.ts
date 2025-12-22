/**
 * CQL Server Tests
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { type CQLServer, createCQLServer } from './server'

const TEST_PORT = 4399
const TEST_DATA_DIR = '.data/cql-test'

describe('CQL Server', () => {
  let server: CQLServer

  beforeAll(() => {
    // Clean up any existing test data
    rmSync(TEST_DATA_DIR, { recursive: true, force: true })

    server = createCQLServer({
      port: TEST_PORT,
      dataDir: TEST_DATA_DIR,
      debug: false,
    })
    server.start()
  })

  afterAll(() => {
    server.stop()
    rmSync(TEST_DATA_DIR, { recursive: true, force: true })
  })

  test('health check returns status', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`)
    const data = await res.json()

    expect(res.ok).toBe(true)
    expect(data.status).toBe('ok')
    expect(data.type).toBe('sqlite')
    expect(typeof data.blockHeight).toBe('number')
  })

  test('status endpoint returns info', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/v1/status`)
    const data = await res.json()

    expect(res.ok).toBe(true)
    expect(data.status).toBe('running')
    expect(data.type).toBe('sqlite-dev')
  })

  test('creates database', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/v1/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeCount: 1,
        schema: 'CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)',
        owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      }),
    })
    const data = await res.json()

    expect(res.ok).toBe(true)
    expect(data.id).toBeDefined()
    expect(data.status).toBe('active')
  })

  test('lists databases', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/v1/databases`)
    const data = await res.json()

    expect(res.ok).toBe(true)
    expect(Array.isArray(data.databases)).toBe(true)
    expect(data.databases.length).toBeGreaterThan(0)
  })

  test('executes SQL queries', async () => {
    const dbId = 'query-test-db'

    // Create table
    const createRes = await fetch(
      `http://localhost:${TEST_PORT}/api/v1/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: dbId,
          type: 'exec',
          sql: 'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)',
        }),
      },
    )
    expect(createRes.ok).toBe(true)

    // Insert data
    const insertRes = await fetch(
      `http://localhost:${TEST_PORT}/api/v1/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: dbId,
          type: 'exec',
          sql: 'INSERT INTO items (name) VALUES (?)',
          params: ['Test Item'],
        }),
      },
    )
    const insertData = await insertRes.json()
    expect(insertRes.ok).toBe(true)
    expect(insertData.rowsAffected).toBe(1)
    expect(insertData.lastInsertId).toBe('1')

    // Query data
    const selectRes = await fetch(
      `http://localhost:${TEST_PORT}/api/v1/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: dbId,
          type: 'query',
          sql: 'SELECT * FROM items',
        }),
      },
    )
    const selectData = await selectRes.json()
    expect(selectRes.ok).toBe(true)
    expect(selectData.rows).toHaveLength(1)
    expect(selectData.rows[0].name).toBe('Test Item')
  })

  test('handles ACL operations', async () => {
    const dbId = 'acl-test-db'
    const address = '0x1234567890123456789012345678901234567890'

    // Grant permissions
    const grantRes = await fetch(
      `http://localhost:${TEST_PORT}/api/v1/databases/${dbId}/acl/grant`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          permissions: ['SELECT', 'INSERT'],
        }),
      },
    )
    expect(grantRes.ok).toBe(true)

    // List ACL
    const listRes = await fetch(
      `http://localhost:${TEST_PORT}/api/v1/databases/${dbId}/acl`,
    )
    const listData = await listRes.json()
    expect(listRes.ok).toBe(true)
    expect(listData.rules).toHaveLength(1)
    expect(listData.rules[0].address).toBe(address)

    // Revoke permissions
    const revokeRes = await fetch(
      `http://localhost:${TEST_PORT}/api/v1/databases/${dbId}/acl/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      },
    )
    expect(revokeRes.ok).toBe(true)

    // Verify revocation
    const verifyRes = await fetch(
      `http://localhost:${TEST_PORT}/api/v1/databases/${dbId}/acl`,
    )
    const verifyData = await verifyRes.json()
    expect(verifyData.rules).toHaveLength(0)
  })

  test('returns rental plans', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/v1/plans`)
    const data = await res.json()

    expect(res.ok).toBe(true)
    expect(Array.isArray(data.plans)).toBe(true)
    expect(data.plans.length).toBeGreaterThan(0)
    expect(data.plans[0].id).toBeDefined()
    expect(data.plans[0].name).toBeDefined()
  })

  test('returns metrics', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/metrics`)
    const text = await res.text()

    expect(res.ok).toBe(true)
    expect(text).toContain('cql_block_height')
    expect(text).toContain('cql_databases_total')
  })

  test('block height increments on writes', async () => {
    const dbId = 'block-height-test'

    // Get initial height
    const healthRes = await fetch(`http://localhost:${TEST_PORT}/health`)
    const initialHealth = await healthRes.json()
    const initialHeight = initialHealth.blockHeight

    // Execute a write
    await fetch(`http://localhost:${TEST_PORT}/api/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: dbId,
        type: 'exec',
        sql: 'CREATE TABLE IF NOT EXISTS blocks_test (id INTEGER PRIMARY KEY)',
      }),
    })

    // Check height increased
    const afterRes = await fetch(`http://localhost:${TEST_PORT}/health`)
    const afterHealth = await afterRes.json()
    expect(afterHealth.blockHeight).toBeGreaterThan(initialHeight)
  })
})

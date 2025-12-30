/**
 * End-to-end tests for secure database provisioning
 *
 * These tests require a running DWS server with database service enabled.
 * Run with: jeju test (starts all services)
 * Or: DWS_ENDPOINT=http://localhost:4030 bun test
 */

import { describe, expect, test } from 'bun:test'
import { getDwsApiUrl } from '@jejunetwork/config'
import type { Hex } from 'viem'
import { privateKeyToAccount, signMessage } from 'viem/accounts'

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const OTHER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex
const DWS_ENDPOINT = getDwsApiUrl()
const APP_NAME = `test-app-${Date.now()}`

// Skip unless explicitly running E2E tests
const SKIP_E2E =
  process.env.RUN_E2E !== 'true' && process.env.DWS_ENDPOINT === undefined

const account = privateKeyToAccount(TEST_PRIVATE_KEY)
const otherAccount = privateKeyToAccount(OTHER_PRIVATE_KEY)

let databaseId: string

describe.skipIf(SKIP_E2E)('Secure Database Provisioning', () => {
  test('health endpoint should respond', async () => {
    const resp = await fetch(`${DWS_ENDPOINT}/database/health`)
    const data = await resp.json()
    expect(data.status).toBe('healthy')
  })

  test('should provision a new database', async () => {
    const timestamp = Date.now()
    const message = JSON.stringify({
      appName: APP_NAME,
      owner: account.address,
      timestamp,
    })

    const signature = await signMessage({
      message,
      privateKey: TEST_PRIVATE_KEY,
    })

    const resp = await fetch(`${DWS_ENDPOINT}/database/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName: APP_NAME,
        owner: account.address,
        signature,
        timestamp,
        schema: 'CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);',
      }),
    })

    const result = await resp.json()
    expect(result.success).toBe(true)
    expect(result.database.databaseId).toContain(APP_NAME.toLowerCase())
    expect(result.database.owner.toLowerCase()).toBe(
      account.address.toLowerCase(),
    )

    databaseId = result.database.databaseId
  })

  test('should execute insert with signed request', async () => {
    const timestamp = Date.now()
    const payload = {
      database: databaseId,
      type: 'exec' as const,
      sql: 'INSERT INTO users (id, name) VALUES (?, ?)',
      params: ['user-1', 'Alice'],
      timestamp,
    }

    const signature = await signMessage({
      message: JSON.stringify(payload),
      privateKey: TEST_PRIVATE_KEY,
    })

    const resp = await fetch(`${DWS_ENDPOINT}/sqlit/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        signature,
        signer: account.address,
      }),
    })

    const result = await resp.json()
    expect(result.rowsAffected).toBe(1)
  })

  test('should query data with signed request', async () => {
    const timestamp = Date.now()
    const payload = {
      database: databaseId,
      type: 'query' as const,
      sql: 'SELECT * FROM users',
      params: [],
      timestamp,
    }

    const signature = await signMessage({
      message: JSON.stringify(payload),
      privateKey: TEST_PRIVATE_KEY,
    })

    const resp = await fetch(`${DWS_ENDPOINT}/sqlit/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        signature,
        signer: account.address,
      }),
    })

    const result = await resp.json()
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Alice')
  })

  test('should deny access to unauthorized user', async () => {
    const timestamp = Date.now()
    const payload = {
      database: databaseId,
      type: 'query' as const,
      sql: 'SELECT * FROM users',
      params: [],
      timestamp,
    }

    const signature = await signMessage({
      message: JSON.stringify(payload),
      privateKey: OTHER_PRIVATE_KEY,
    })

    const resp = await fetch(`${DWS_ENDPOINT}/sqlit/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        signature,
        signer: otherAccount.address,
      }),
    })

    expect(resp.status).toBe(403)
    const result = await resp.json()
    expect(result.error).toContain('Access denied')
  })

  test('should require authentication for non-system databases', async () => {
    const resp = await fetch(`${DWS_ENDPOINT}/sqlit/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: databaseId,
        type: 'query',
        sql: 'SELECT * FROM users',
        params: [],
        timestamp: Date.now(),
      }),
    })

    expect(resp.status).toBe(401)
    const result = await resp.json()
    expect(result.error).toContain('Authentication required')
  })

  test('should allow system database access from localhost', async () => {
    const resp = await fetch(`${DWS_ENDPOINT}/sqlit/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: 'dws',
        type: 'query',
        sql: 'SELECT 1 as test',
        params: [],
        timestamp: Date.now(),
      }),
    })

    expect(resp.ok).toBe(true)
    const result = await resp.json()
    expect(result.rows[0].test).toBe(1)
  })

  test('should list databases owned by address', async () => {
    const resp = await fetch(`${DWS_ENDPOINT}/database/list/${account.address}`)
    expect(resp.ok).toBe(true)

    const result = await resp.json()
    expect(result.databases).toBeInstanceOf(Array)
    expect(
      result.databases.some(
        (db: { databaseId: string }) => db.databaseId === databaseId,
      ),
    ).toBe(true)
  })
})

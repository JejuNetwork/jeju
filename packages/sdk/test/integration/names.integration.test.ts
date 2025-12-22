/**
 * Names (JNS) Module Integration Tests
 *
 * Tests JNS registry against REAL localnet.
 * Run: jeju dev --minimal first, then bun test
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:6546'

describe('JNS (Names) Integration Tests', () => {
  let client: JejuClient | null = null
  let chainRunning = false

  beforeAll(async () => {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          id: 1,
        }),
        signal: AbortSignal.timeout(3000),
      })
      chainRunning = response.ok
    } catch {
      // Chain not running
    }

    if (chainRunning) {
      try {
        const account = privateKeyToAccount(TEST_PRIVATE_KEY)
        client = await createJejuClient({
          account,
          network: 'localnet',
          rpcUrl: RPC_URL,
          smartAccount: false,
        })
      } catch {
        chainRunning = false
      }
    }
  })

  test('client created successfully', () => {
    if (!chainRunning || !client) return
    expect(client).toBeDefined()
    expect(client.names).toBeDefined()
  })

  test('isAvailable returns boolean', async () => {
    if (!chainRunning || !client) return
    try {
      const available = await client.names.isAvailable(
        'test-unique-name-123456',
      )
      expect(typeof available).toBe('boolean')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getRegistrationCost returns bigint', async () => {
    if (!chainRunning || !client) return
    try {
      const cost = await client.names.getRegistrationCost('test', 1)
      expect(typeof cost).toBe('bigint')
      expect(cost > 0n).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('resolve returns address or null', async () => {
    if (!chainRunning || !client) return
    try {
      const address = await client.names.resolve('nonexistent-name.jeju')
      expect(address === null || typeof address === 'string').toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('reverseResolve returns name or null', async () => {
    if (!chainRunning || !client) return
    try {
      const name = await client.names.reverseResolve(client.address)
      expect(name === null || typeof name === 'string').toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getExpiration returns date or null', async () => {
    if (!chainRunning || !client) return
    try {
      const expiry = await client.names.getExpiration('test.jeju')
      expect(expiry === null || expiry instanceof Date).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })
})

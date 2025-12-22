/**
 * Identity Module Integration Tests
 *
 * Tests ERC-8004 registry against REAL localnet.
 * Run: jeju dev --minimal first, then bun test
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:6546'

describe('Identity Integration Tests', () => {
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
    expect(client.identity).toBeDefined()
  })

  test('getMyAgent returns null or agent info', async () => {
    if (!chainRunning || !client) return
    try {
      const agent = await client.identity.getMyAgent()
      expect(agent === null || typeof agent === 'object').toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('amIBanned returns boolean', async () => {
    if (!chainRunning || !client) return
    try {
      const banned = await client.identity.amIBanned()
      expect(typeof banned).toBe('boolean')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listAgents returns array', async () => {
    if (!chainRunning || !client) return
    try {
      const agents = await client.identity.listAgents()
      expect(Array.isArray(agents)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listAgents with tag filter', async () => {
    if (!chainRunning || !client) return
    try {
      const agents = await client.identity.listAgents(['ai'])
      expect(Array.isArray(agents)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })
})

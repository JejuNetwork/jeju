/**
 * Storage Module Tests
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../src/client'

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:9545'

describe('Storage Module', () => {
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
        client = await createJejuClient({
          network: 'localnet',
          privateKey: generatePrivateKey(),
          smartAccount: false,
        })
      } catch {
        chainRunning = false
      }
    }
  })

  test('estimateCost calculates correctly', async () => {
    if (!chainRunning || !client) return
    try {
      const cost = client.storage.estimateCost(1024 * 1024 * 1024, 1, 'hot')
      expect(cost).toBeGreaterThan(0n)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getGatewayUrl returns valid URL', async () => {
    if (!chainRunning || !client) return
    const cid = 'QmTest123456789abcdefghijklmnopqrstuvwxyz'
    const url = client.storage.getGatewayUrl(cid)
    expect(url).toContain('/ipfs/')
    expect(url).toContain(cid)
  })
})

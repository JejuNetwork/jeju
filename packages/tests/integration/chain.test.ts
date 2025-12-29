/**
 * Chain Integration Tests
 *
 * Tests the L1 and L2 chain infrastructure.
 * Requires: docker compose --profile chain up
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { getL1RpcUrl, getL2RpcUrl, getLocalhostHost } from '@jejunetwork/config'
import { createPublicClient, http, parseEther } from 'viem'
import { z } from 'zod'

// Simple JSON-RPC response schema for chain tests
const JsonRpcResultSchema = z.object({
  result: z.string(),
})

const host = getLocalhostHost()
const L1_RPC =
  (typeof process !== 'undefined' ? process.env.L1_RPC_URL : undefined) ||
  getL1RpcUrl() ||
  `http://${host}:6545`
const L2_RPC =
  (typeof process !== 'undefined' ? process.env.L2_RPC_URL : undefined) ||
  getL2RpcUrl() ||
  `http://${host}:6546`

const TEST_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

async function isChainRunning(rpcUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

describe('Chain Infrastructure', () => {
  let l1Available = false
  let l2Available = false

  beforeAll(async () => {
    l1Available = await isChainRunning(L1_RPC)
    l2Available = await isChainRunning(L2_RPC)

    if (!l1Available && !l2Available) {
      console.log(
        'Chains not running. Start with: docker compose -f packages/tests/docker-compose.test.yml --profile chain up -d',
      )
    }
  })

  describe('L1 Chain', () => {
    test('should respond to JSON-RPC', async () => {
      if (!l1Available) {
        console.log('L1 not available, skipping')
        return
      }

      const response = await fetch(L1_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
      })

      expect(response.ok).toBe(true)
      const data = JsonRpcResultSchema.parse(await response.json())
      expect(data.result).toBeDefined()
    })

    test('should return block number', async () => {
      if (!l1Available) return

      const response = await fetch(L1_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      })

      const data = JsonRpcResultSchema.parse(await response.json())
      const blockNumber = parseInt(data.result, 16)
      expect(blockNumber).toBeGreaterThanOrEqual(0)
    })

    test('dev account should have ETH balance', async () => {
      if (!l1Available) return

      const client = createPublicClient({
        transport: http(L1_RPC),
      })

      const balance = await client.getBalance({
        address: TEST_ACCOUNT as `0x${string}`,
      })
      expect(balance).toBeGreaterThan(0n)
    })
  })

  describe('L2 Chain', () => {
    test('should respond to JSON-RPC', async () => {
      if (!l2Available) {
        console.log('L2 not available, skipping')
        return
      }

      const response = await fetch(L2_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
      })

      expect(response.ok).toBe(true)
      const data = JsonRpcResultSchema.parse(await response.json())
      expect(data.result).toBeDefined()
    })

    test('should return block number', async () => {
      if (!l2Available) return

      const response = await fetch(L2_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      })

      const data = JsonRpcResultSchema.parse(await response.json())
      const blockNumber = parseInt(data.result, 16)
      expect(blockNumber).toBeGreaterThanOrEqual(0)
    })

    test('dev account should have ETH balance', async () => {
      if (!l2Available) return

      const client = createPublicClient({
        transport: http(L2_RPC),
      })

      const balance = await client.getBalance({
        address: TEST_ACCOUNT as `0x${string}`,
      })
      expect(balance).toBeGreaterThan(0n)
    })

    test('should be able to estimate gas', async () => {
      if (!l2Available) return

      const client = createPublicClient({
        transport: http(L2_RPC),
      })

      const gasEstimate = await client.estimateGas({
        account: TEST_ACCOUNT as `0x${string}`,
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        value: parseEther('0.1'),
      })

      expect(gasEstimate).toBeGreaterThan(0n)
    })
  })
})

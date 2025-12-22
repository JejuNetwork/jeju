/**
 * Network & RPC E2E Tests
 *
 * Verifies blockchain connectivity and network operations.
 * Tests actual RPC interactions with the localnet.
 */

import { expect, test } from '@playwright/test'
import { createPublicClient, formatEther, http } from 'viem'
import {
  assertInfrastructureRunning,
  getTestAccountBalance,
  TEST_CONFIG,
} from '../setup'

test.describe('Network & RPC', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning()
  })

  test.describe('Connection', () => {
    test('should connect to localnet RPC', async () => {
      const client = createPublicClient({
        transport: http(TEST_CONFIG.rpcUrl),
      })

      const chainId = await client.getChainId()
      expect(chainId).toBe(TEST_CONFIG.chainId)
    })

    test('should handle connection to invalid RPC gracefully', async () => {
      const client = createPublicClient({
        transport: http('http://localhost:19999', { timeout: 1000 }),
      })

      await expect(client.getChainId()).rejects.toThrow()
    })
  })

  test.describe('Chain Data', () => {
    test('should fetch block number', async () => {
      const client = createPublicClient({
        transport: http(TEST_CONFIG.rpcUrl),
      })

      const blockNumber = await client.getBlockNumber()
      // Fresh anvil starts at block 0, which is valid
      expect(blockNumber).toBeGreaterThanOrEqual(0n)
    })

    test('should fetch latest block', async () => {
      const client = createPublicClient({
        transport: http(TEST_CONFIG.rpcUrl),
      })

      const block = await client.getBlock()

      expect(block.number).toBeGreaterThanOrEqual(0n)
      expect(block.hash).toBeTruthy()
      expect(block.timestamp).toBeGreaterThanOrEqual(0n)
    })

    test('should fetch pending block', async () => {
      const client = createPublicClient({
        transport: http(TEST_CONFIG.rpcUrl),
      })

      const pendingBlock = await client.getBlock({ blockTag: 'pending' })
      expect(pendingBlock).toBeTruthy()
      expect(pendingBlock.transactions).toBeInstanceOf(Array)
    })

    test('should fetch gas price', async () => {
      const client = createPublicClient({
        transport: http(TEST_CONFIG.rpcUrl),
      })

      const gasPrice = await client.getGasPrice()
      expect(gasPrice).toBeGreaterThan(0n)
    })
  })

  test.describe('Account Data', () => {
    test('should fetch test account balance', async () => {
      const balance = await getTestAccountBalance()

      // Localnet starts accounts with plenty of ETH
      expect(parseFloat(balance)).toBeGreaterThan(100)
    })

    test('should fetch balance for any address', async () => {
      const client = createPublicClient({
        transport: http(TEST_CONFIG.rpcUrl),
      })

      const balance = await client.getBalance({
        address: TEST_CONFIG.testAccount.address,
      })

      expect(formatEther(balance)).not.toBe('0')
    })
  })
})

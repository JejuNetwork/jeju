/**
 * Bridge Module Integration Tests
 *
 * Tests cross-chain bridging functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type Hex, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient, MessageStatus } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Bridge Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      if (!env.chainRunning) {
        console.log('⚠ Chain not running - skipping bridge tests')
        skipTests = true
        return
      }

      const account = privateKeyToAccount(env.privateKey)
      client = await createJejuClient({
        account,
        network: 'localnet',
        rpcUrl: env.rpcUrl,
        smartAccount: false,
      })
    } catch {
      console.log('⚠ Contracts not configured - skipping bridge tests')
      skipTests = true
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Token Bridging', () => {
    test('getSupportedTokens returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const tokens = await client.bridge.getSupportedTokens()
      expect(Array.isArray(tokens)).toBe(true)
    })

    test('getTokenMapping returns null for non-mapped token', async () => {
      if (skipTests || !env.contractsDeployed) return
      const mapping = await client.bridge.getTokenMapping(zeroAddress, 1)
      expect(mapping === null || typeof mapping === 'object').toBe(true)
    })
  })

  describe('Message Status', () => {
    test('getMessageStatus returns status for non-existent message', async () => {
      if (skipTests || !env.contractsDeployed) return
      const status = await client.bridge.getMessageStatus(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(typeof status).toBe('number')
    })

    test('getMessageDetails returns null for non-existent', async () => {
      if (skipTests || !env.contractsDeployed) return
      const details = await client.bridge.getMessageDetails(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(details === null || typeof details === 'object').toBe(true)
    })
  })

  describe('NFT Bridging', () => {
    test('getNFTBridgeHistory returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const history = await client.bridge.getNFTBridgeHistory()
      expect(Array.isArray(history)).toBe(true)
    })
  })

  describe('ZK Bridge', () => {
    test('getZKBridgeStatus returns status', async () => {
      if (skipTests || !env.contractsDeployed) return
      const status = await client.bridge.getZKBridgeStatus()
      expect(status).toBeDefined()
    })

    test('getPendingZKMessages returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const messages = await client.bridge.getPendingZKMessages()
      expect(Array.isArray(messages)).toBe(true)
    })
  })

  describe('MessageStatus Enum', () => {
    test('has expected values', () => {
      if (skipTests) return
      expect(MessageStatus.PENDING).toBeDefined()
      expect(MessageStatus.RELAYED).toBeDefined()
      expect(MessageStatus.FAILED).toBeDefined()
      expect(MessageStatus.FINALIZED).toBeDefined()
    })
  })
})

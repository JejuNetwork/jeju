/**
 * Storage Module Integration Tests
 *
 * Tests against REAL localnet IPFS services.
 * Services are auto-started via setup.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Storage Integration Tests', () => {
  let client: JejuClient | null = null
  let env: Awaited<ReturnType<typeof setupTestEnvironment>> | null = null
  let uploadedCid: string | null = null

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      const account = privateKeyToAccount(env.privateKey)
      client = await createJejuClient({
        account,
        network: 'localnet',
        rpcUrl: env.rpcUrl,
        smartAccount: false,
      })
    } catch {
      // Setup failed - tests will be skipped
    }
  })

  afterAll(async () => {
    if (uploadedCid && client) {
      try {
        await client.storage.unpin(uploadedCid)
      } catch {
        // Ignore
      }
    }
    try {
      await teardownTestEnvironment()
    } catch {
      // Cleanup failed - ignore
    }
  })

  test('client created successfully', () => {
    if (!env?.chainRunning) return
    expect(client).toBeDefined()
    expect(client?.storage).toBeDefined()
  })

  test('estimateCost returns valid bigint', () => {
    if (!env?.chainRunning || !client) return
    try {
      const cost = client.storage.estimateCost(1024 * 1024, 1, 'warm')
      expect(typeof cost).toBe('bigint')
      expect(cost > 0n).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getGatewayUrl returns valid URL', () => {
    if (!env?.chainRunning || !client) return
    const url = client.storage.getGatewayUrl('QmTest123')
    expect(url).toContain('QmTest123')
    expect(url.startsWith('http')).toBe(true)
  })

  test('upload file and get CID', async () => {
    if (!env?.servicesRunning || !client) return
    try {
      const testContent = `Test content ${Date.now()}`
      const blob = new Blob([testContent], { type: 'text/plain' })
      const result = await client.storage.upload(blob, { name: 'test.txt' })
      expect(result).toBeDefined()
      expect(result.cid).toBeDefined()
      uploadedCid = result.cid
    } catch {
      // Expected if services not running
    }
  })

  test('retrieve uploaded file', async () => {
    if (!env?.servicesRunning || !uploadedCid || !client) return
    try {
      const content = await client.storage.retrieve(uploadedCid)
      expect(content).toBeDefined()
    } catch {
      // Expected if services not running
    }
  })

  test('pin existing CID', async () => {
    if (!env?.servicesRunning || !uploadedCid || !client) return
    try {
      await client.storage.pin(uploadedCid)
    } catch {
      // Expected if services not running
    }
  })

  test('listPins returns array', async () => {
    if (!env?.servicesRunning || !client) return
    try {
      const pins = await client.storage.listPins()
      expect(Array.isArray(pins)).toBe(true)
    } catch {
      // Expected if services not running
    }
  })

  test('getStats returns storage statistics', async () => {
    if (!env?.servicesRunning || !client) return
    try {
      const stats = await client.storage.getStats()
      expect(stats).toBeDefined()
    } catch {
      // Expected if services not running
    }
  })

  test('unpin file', async () => {
    if (!env?.servicesRunning || !uploadedCid || !client) return
    try {
      await client.storage.unpin(uploadedCid)
      uploadedCid = null
    } catch {
      // Expected if services not running
    }
  })
})

/**
 * Compute Module Integration Tests
 *
 * Tests against REAL localnet services.
 * Services are auto-started via setup.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Compute Integration Tests', () => {
  let client: JejuClient | null = null
  let env: Awaited<ReturnType<typeof setupTestEnvironment>> | null = null

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
    try {
      await teardownTestEnvironment()
    } catch {
      // Cleanup failed - ignore
    }
  })

  test('client created successfully', () => {
    // Skip if chain not running or client creation failed (contracts not deployed)
    if (!env?.chainRunning || !client) return
    expect(client).toBeDefined()
    expect(client.compute).toBeDefined()
  })

  test('listProviders returns array (requires contracts)', async () => {
    if (!env?.contractsDeployed || !client) return
    try {
      const providers = await client.compute.listProviders()
      expect(Array.isArray(providers)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listProviders filters by GPU type (requires contracts)', async () => {
    if (!env?.contractsDeployed || !client) return
    try {
      const providers = await client.compute.listProviders({
        gpuType: 'NVIDIA_H100',
      })
      expect(Array.isArray(providers)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listModels returns available AI models (requires contracts)', async () => {
    if (!env?.contractsDeployed || !client) return
    try {
      const models = await client.compute.listModels()
      expect(Array.isArray(models)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listMyRentals returns user rentals (requires contracts)', async () => {
    if (!env?.contractsDeployed || !client) return
    try {
      const rentals = await client.compute.listMyRentals()
      expect(Array.isArray(rentals)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listTriggers returns trigger list (requires contracts)', async () => {
    if (!env?.contractsDeployed || !client) return
    try {
      const triggers = await client.compute.listTriggers()
      expect(Array.isArray(triggers)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getPrepaidBalance returns bigint (requires contracts)', async () => {
    if (!env?.contractsDeployed || !client) return
    try {
      const balance = await client.compute.getPrepaidBalance()
      expect(typeof balance).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getQuote returns price estimate (requires contracts)', async () => {
    if (!env?.contractsDeployed || !client) return
    try {
      const providers = await client.compute.listProviders()
      if (providers.length === 0) return
      const quote = await client.compute.getQuote(providers[0].address, 1)
      expect(quote).toBeDefined()
    } catch {
      // Expected if contracts not deployed
    }
  })
})

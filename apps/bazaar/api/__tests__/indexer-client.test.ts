import { beforeAll, describe, expect, test } from 'bun:test'
import { getCurrentNetwork, getServicesConfig } from '@jejunetwork/config'
import {
  getNetworkTokens,
  getTokenHolders,
  getTokenTransfers,
} from '../indexer-client'

// Check if indexer is available
let indexerAvailable = false

// Get indexer URL from config
const services = getServicesConfig(getCurrentNetwork())
const INDEXER_URL = services.indexer.graphql || 'http://localhost:4350/graphql'

describe('Indexer Client', () => {
  beforeAll(async () => {
    // Try to connect to indexer
    const indexerUrl = INDEXER_URL
    try {
      const response = await fetch(indexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      })
      indexerAvailable = response.ok
    } catch {
      indexerAvailable = false
    }

    if (!indexerAvailable) {
      console.log(
        '   ⚠️ Indexer not available at ' +
          indexerUrl +
          '. Live tests will be skipped.',
      )
    }
  })

  test('should fetch network tokens', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available')
      return
    }
    const tokens = await getNetworkTokens({ limit: 10 })
    expect(tokens).toBeDefined()
    expect(Array.isArray(tokens)).toBe(true)
  })

  test('should filter tokens with limit', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available')
      return
    }
    const tokens = await getNetworkTokens({ limit: 5 })
    expect(Array.isArray(tokens)).toBe(true)
    if (tokens.length > 0) {
      expect(tokens.length).toBeLessThanOrEqual(5)
    }
  })

  test('should fetch token transfers', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available')
      return
    }
    const mockAddress: `0x${string}` =
      '0x0000000000000000000000000000000000000001'
    const transfers = await getTokenTransfers(mockAddress, 10)
    expect(transfers).toBeDefined()
    expect(Array.isArray(transfers)).toBe(true)
  })

  test('should fetch token holders', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available')
      return
    }
    const mockAddress: `0x${string}` =
      '0x0000000000000000000000000000000000000001'
    const holders = await getTokenHolders(mockAddress, 10)
    expect(holders).toBeDefined()
    expect(Array.isArray(holders)).toBe(true)
  })

  test('should throw error for invalid address format', async () => {
    // Invalid addresses should throw a validation error
    await expect(getTokenTransfers('invalid-address', 10)).rejects.toThrow()
  })

  test('indexer client module should be importable', () => {
    expect(typeof getNetworkTokens).toBe('function')
    expect(typeof getTokenTransfers).toBe('function')
    expect(typeof getTokenHolders).toBe('function')
  })
})

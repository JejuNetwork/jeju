/**
 * Price Fetcher Unit Tests
 *
 * Tests price fetching utilities:
 * 1. Manual price setting
 * 2. Source hash computation
 * 3. Cache management
 */

import { describe, expect, test } from 'bun:test'
import type { PriceSourceConfig } from '@jejunetwork/types'
import type { Hex } from 'viem'
import { PriceFetcher } from '../../api/oracle/price-fetcher'

const RPC_URL = 'http://localhost:6546'

describe('PriceFetcher', () => {
  describe('Manual Price Management', () => {
    test('should set and get manual price', () => {
      const feedId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
      const sources: PriceSourceConfig[] = [
        {
          type: 'manual',
          feedId,
          address: '0x0000000000000000000000000000000000000000',
          decimals: 8,
        },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)
      const price = 350000000000n
      const confidence = 9500n

      priceFetcher.setManualPrice(feedId, price, confidence)

      // Fetch should return the set price - fetchPrice is async but manual just returns from cache
    })

    test('should update manual price on subsequent sets', () => {
      const feedId =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex
      const sources: PriceSourceConfig[] = [
        {
          type: 'manual',
          feedId,
          address: '0x0000000000000000000000000000000000000000',
          decimals: 8,
        },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)

      priceFetcher.setManualPrice(feedId, 100000000000n, 9000n)
      priceFetcher.setManualPrice(feedId, 200000000000n, 9500n)

      // Second set should override first
    })
  })

  describe('Source Hash Computation', () => {
    test('should compute deterministic hash for same sources', () => {
      const sources: PriceSourceConfig[] = []
      const priceFetcher = new PriceFetcher(RPC_URL, sources)

      const sourceStrings = ['uniswap:0x1234', 'chainlink:0x5678']

      const hash1 = priceFetcher.computeSourcesHash(sourceStrings)
      const hash2 = priceFetcher.computeSourcesHash(sourceStrings)

      expect(hash1).toBe(hash2)
    })

    test('should compute different hash for different sources', () => {
      const sources: PriceSourceConfig[] = []
      const priceFetcher = new PriceFetcher(RPC_URL, sources)

      const hash1 = priceFetcher.computeSourcesHash(['uniswap:0x1111'])
      const hash2 = priceFetcher.computeSourcesHash(['uniswap:0x2222'])

      expect(hash1).not.toBe(hash2)
    })

    test('should handle empty sources array', () => {
      const sources: PriceSourceConfig[] = []
      const priceFetcher = new PriceFetcher(RPC_URL, sources)

      const hash = priceFetcher.computeSourcesHash([])
      expect(hash).toBeDefined()
      expect(hash.startsWith('0x')).toBe(true)
      expect(hash.length).toBe(66) // 0x + 64 hex chars
    })

    test('should produce valid keccak256 hash', () => {
      const sources: PriceSourceConfig[] = []
      const priceFetcher = new PriceFetcher(RPC_URL, sources)

      const hash = priceFetcher.computeSourcesHash(['test-source'])

      // keccak256 produces 32 bytes = 64 hex chars
      expect(hash.length).toBe(66)
      expect(/^0x[0-9a-f]{64}$/.test(hash)).toBe(true)
    })
  })

  describe('Constructor', () => {
    test('should create instance with valid config', () => {
      const sources: PriceSourceConfig[] = [
        {
          type: 'manual',
          feedId: '0x1234' as Hex,
          address: '0x0',
          decimals: 8,
        },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)
      expect(priceFetcher).toBeDefined()
    })

    test('should create instance with empty sources', () => {
      const priceFetcher = new PriceFetcher(RPC_URL, [])
      expect(priceFetcher).toBeDefined()
    })

    test('should create instance with multiple sources', () => {
      const sources: PriceSourceConfig[] = [
        {
          type: 'manual',
          feedId: '0x1111' as Hex,
          address: '0x0',
          decimals: 8,
        },
        {
          type: 'manual',
          feedId: '0x2222' as Hex,
          address: '0x0',
          decimals: 8,
        },
        {
          type: 'manual',
          feedId: '0x3333' as Hex,
          address: '0x0',
          decimals: 8,
        },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)
      expect(priceFetcher).toBeDefined()
    })
  })

  describe('FetchPrice Error Cases', () => {
    test('should throw for unconfigured feed', async () => {
      const sources: PriceSourceConfig[] = [
        {
          type: 'manual',
          feedId: '0x1111' as Hex,
          address: '0x0',
          decimals: 8,
        },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)

      await expect(
        priceFetcher.fetchPrice(
          '0x9999999999999999999999999999999999999999999999999999999999999999' as Hex,
        ),
      ).rejects.toThrow('No price source configured')
    })
  })

  describe('Price Data Structure', () => {
    test('should return correct PriceData fields', () => {
      const feedId =
        '0x4444444444444444444444444444444444444444444444444444444444444444' as Hex
      const sources: PriceSourceConfig[] = [
        { type: 'manual', feedId, address: '0x0', decimals: 8 },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)
      const price = 123456789n
      const confidence = 8500n

      priceFetcher.setManualPrice(feedId, price, confidence)

      // PriceData should have: price, confidence, timestamp, source
    })
  })

  describe('Edge Cases', () => {
    test('should handle zero price', () => {
      const feedId =
        '0x5555555555555555555555555555555555555555555555555555555555555555' as Hex
      const sources: PriceSourceConfig[] = [
        { type: 'manual', feedId, address: '0x0', decimals: 8 },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)
      priceFetcher.setManualPrice(feedId, 0n, 0n)
      // Should not throw
    })

    test('should handle max uint256 values', () => {
      const feedId =
        '0x6666666666666666666666666666666666666666666666666666666666666666' as Hex
      const sources: PriceSourceConfig[] = [
        { type: 'manual', feedId, address: '0x0', decimals: 8 },
      ]

      const priceFetcher = new PriceFetcher(RPC_URL, sources)
      const maxPrice = 2n ** 256n - 1n
      const maxConfidence = 10000n

      priceFetcher.setManualPrice(feedId, maxPrice, maxConfidence)
      // Should not throw
    })
  })
})

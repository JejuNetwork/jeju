/**
 * Oracle Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { OracleService } from './index'

// Mock the jeju service
const mockGetOraclePrices = mock(() =>
  Promise.resolve(
    new Map([
      ['ETH', { price: '2000000000', decimals: 8, symbol: 'ETH' }],
      ['BTC', { price: '50000000000', decimals: 8, symbol: 'BTC' }],
    ]),
  ),
)

const mockGetGasPrice = mock(() =>
  Promise.resolve({
    slow: 10000000000n,
    standard: 15000000000n,
    fast: 20000000000n,
  }),
)

mock.module('../jeju', () => ({
  getOraclePrices: mockGetOraclePrices,
  getGasPrice: mockGetGasPrice,
}))

describe('OracleService', () => {
  let oracle: OracleService

  beforeEach(() => {
    oracle = new OracleService()
    oracle.clearCache()
    mockGetOraclePrices.mockClear()
    mockGetGasPrice.mockClear()
  })

  describe('getNativeTokenPrice', () => {
    it('should get ETH price for Ethereum mainnet', async () => {
      const price = await oracle.getNativeTokenPrice(1)
      expect(price).toBe(20) // 2000000000 / 10^8
    })

    it('should throw for unknown chain', async () => {
      await expect(oracle.getNativeTokenPrice(999999 as never)).rejects.toThrow(
        'No native token symbol configured',
      )
    })
  })

  describe('getTokenPrice', () => {
    it('should fetch and cache token price', async () => {
      const price1 = await oracle.getTokenPrice('ETH')
      const price2 = await oracle.getTokenPrice('ETH')

      expect(price1).toBe(20)
      expect(price2).toBe(20)
      // Should only call API once due to caching
      expect(mockGetOraclePrices).toHaveBeenCalledTimes(1)
    })

    it('should throw for missing price feed', async () => {
      mockGetOraclePrices.mockImplementationOnce(() =>
        Promise.resolve(new Map()),
      )

      await expect(oracle.getTokenPrice('UNKNOWN')).rejects.toThrow(
        'No price feed for symbol',
      )
    })
  })

  describe('getTokenPrices', () => {
    it('should fetch multiple token prices', async () => {
      const prices = await oracle.getTokenPrices(['ETH', 'BTC'])

      expect(prices.get('ETH')).toBe(20)
      expect(prices.get('BTC')).toBe(500)
    })
  })

  describe('getGasPrice', () => {
    it('should return gas prices for chain', async () => {
      const gas = await oracle.getGasPrice(1)

      expect(gas.slow.gwei).toBe(10)
      expect(gas.standard.gwei).toBe(15)
      expect(gas.fast.gwei).toBe(20)
      expect(gas.slow.estimatedTime).toBe(120)
      expect(gas.standard.estimatedTime).toBe(60)
      expect(gas.fast.estimatedTime).toBe(15)
    })
  })

  describe('toUsd', () => {
    it('should convert token amount to USD', async () => {
      const usd = await oracle.toUsd('ETH', 1000000000000000000n) // 1 ETH
      expect(usd).toBe(20) // $20 at $20/ETH
    })

    it('should handle custom decimals', async () => {
      mockGetOraclePrices.mockImplementationOnce(() =>
        Promise.resolve(
          new Map([
            ['USDC', { price: '100000000', decimals: 8, symbol: 'USDC' }],
          ]),
        ),
      )

      const usd = await oracle.toUsd('USDC', 1000000n, 6) // 1 USDC with 6 decimals
      expect(usd).toBe(1) // $1
    })
  })

  describe('clearCache', () => {
    it('should clear the price cache', async () => {
      await oracle.getTokenPrice('ETH')
      expect(mockGetOraclePrices).toHaveBeenCalledTimes(1)

      oracle.clearCache()
      await oracle.getTokenPrice('ETH')
      expect(mockGetOraclePrices).toHaveBeenCalledTimes(2)
    })
  })
})

/**
 * Perpetuals Trading Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address } from 'viem'

// Mock RPC service
const mockReadContract = mock(() => Promise.resolve(1000000000000000000n))
const mockGetClient = mock(() => ({
  readContract: mockReadContract,
}))

mock.module('../rpc', () => ({
  rpcService: { getClient: mockGetClient },
  isSupportedChainId: () => true,
}))

mock.module('../../sdk/chains', () => ({
  getChainContracts: () => ({
    perpetualMarket: '0xperps0000000000000000000000000000000001',
    marginManager: '0xmargin00000000000000000000000000000002',
  }),
  getNetworkRpcUrl: () => 'http://localhost:8545',
}))

const { PerpsService } = await import('./index')

describe('PerpsService', () => {
  let perps: InstanceType<typeof PerpsService>

  beforeEach(() => {
    perps = new PerpsService(420691)
    mockReadContract.mockClear()
  })

  describe('getMarkets', () => {
    it('should fetch available markets', async () => {
      mockReadContract.mockResolvedValueOnce([
        { symbol: 'ETH-USD', maxLeverage: 50n, fundingRate: 100n },
      ])

      const markets = await perps.getMarkets()
      expect(markets).toBeDefined()
    })
  })

  describe('getPosition', () => {
    it('should get position for user and market', async () => {
      mockReadContract.mockResolvedValueOnce({
        size: 1000000000000000000n,
        collateral: 100000000000000000n,
        entryPrice: 2000000000n,
        isLong: true,
        lastFundingTime: 1700000000n,
      })

      const position = await perps.getPosition(
        '0x1234567890123456789012345678901234567890' as Address,
        'ETH-USD',
      )

      expect(position).toBeDefined()
      expect(position?.isLong).toBe(true)
    })

    it('should return null for no position', async () => {
      mockReadContract.mockResolvedValueOnce({
        size: 0n,
        collateral: 0n,
        entryPrice: 0n,
        isLong: false,
        lastFundingTime: 0n,
      })

      const position = await perps.getPosition(
        '0x1234567890123456789012345678901234567890' as Address,
        'ETH-USD',
      )

      expect(position).toBeNull()
    })
  })

  describe('buildOpenPositionTx', () => {
    it('should build open long position tx', () => {
      const tx = perps.buildOpenPositionTx({
        market: 'ETH-USD',
        size: 1000000000000000000n,
        collateral: 100000000000000000n,
        isLong: true,
        maxSlippage: 50,
      })

      expect(tx).not.toBeNull()
      expect(tx?.data).toContain('0x')
    })

    it('should build open short position tx', () => {
      const tx = perps.buildOpenPositionTx({
        market: 'ETH-USD',
        size: 1000000000000000000n,
        collateral: 100000000000000000n,
        isLong: false,
        maxSlippage: 50,
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('buildClosePositionTx', () => {
    it('should build close position tx', () => {
      const tx = perps.buildClosePositionTx({
        market: 'ETH-USD',
        size: 1000000000000000000n,
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('buildAddMarginTx', () => {
    it('should build add margin tx', () => {
      const tx = perps.buildAddMarginTx({
        market: 'ETH-USD',
        amount: 100000000000000000n,
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('buildRemoveMarginTx', () => {
    it('should build remove margin tx', () => {
      const tx = perps.buildRemoveMarginTx({
        market: 'ETH-USD',
        amount: 50000000000000000n,
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('calculatePnL', () => {
    it('should calculate profit for long position', () => {
      const pnl = perps.calculatePnL({
        size: 1000000000000000000n,
        entryPrice: 2000000000n,
        currentPrice: 2200000000n,
        isLong: true,
      })

      expect(pnl > 0n).toBe(true)
    })

    it('should calculate loss for long position', () => {
      const pnl = perps.calculatePnL({
        size: 1000000000000000000n,
        entryPrice: 2000000000n,
        currentPrice: 1800000000n,
        isLong: true,
      })

      expect(pnl < 0n).toBe(true)
    })

    it('should calculate profit for short position', () => {
      const pnl = perps.calculatePnL({
        size: 1000000000000000000n,
        entryPrice: 2000000000n,
        currentPrice: 1800000000n,
        isLong: false,
      })

      expect(pnl > 0n).toBe(true)
    })
  })

  describe('calculateLiquidationPrice', () => {
    it('should calculate liquidation price for long', () => {
      const liqPrice = perps.calculateLiquidationPrice({
        entryPrice: 2000000000n,
        leverage: 10,
        isLong: true,
        maintenanceMargin: 50, // 0.5%
      })

      expect(liqPrice < 2000000000n).toBe(true)
    })

    it('should calculate liquidation price for short', () => {
      const liqPrice = perps.calculateLiquidationPrice({
        entryPrice: 2000000000n,
        leverage: 10,
        isLong: false,
        maintenanceMargin: 50,
      })

      expect(liqPrice > 2000000000n).toBe(true)
    })
  })
})

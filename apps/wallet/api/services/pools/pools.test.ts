/**
 * Liquidity Pools Service Tests
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
    xlpV2Factory: '0xfactory0000000000000000000000000000001',
    xlpV2Router: '0xrouter00000000000000000000000000000002',
    xlpV3PositionManager: '0xposition000000000000000000000000000003',
  }),
  getNetworkRpcUrl: () => 'http://localhost:8545',
}))

const { PoolsService } = await import('./index')

describe('PoolsService', () => {
  let pools: InstanceType<typeof PoolsService>

  beforeEach(() => {
    pools = new PoolsService(420691)
    mockReadContract.mockClear()
  })

  describe('getPool', () => {
    it('should get pool info', async () => {
      mockReadContract
        .mockResolvedValueOnce('0xpair0000000000000000000000000000000001') // getPair
        .mockResolvedValueOnce([1000000000000000000n, 2000000000n]) // getReserves
        .mockResolvedValueOnce(1000000000000000000n) // totalSupply

      const pool = await pools.getPool(
        '0xtokenA00000000000000000000000000000001' as Address,
        '0xtokenB00000000000000000000000000000002' as Address,
      )

      expect(pool).toBeDefined()
      expect(pool?.pairAddress).toBe('0xpair0000000000000000000000000000000001')
    })

    it('should return null for non-existent pool', async () => {
      mockReadContract.mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000000',
      )

      const pool = await pools.getPool(
        '0xtokenA00000000000000000000000000000001' as Address,
        '0xtokenB00000000000000000000000000000002' as Address,
      )

      expect(pool).toBeNull()
    })
  })

  describe('getUserPosition', () => {
    it('should get user LP position', async () => {
      mockReadContract
        .mockResolvedValueOnce('0xpair0000000000000000000000000000000001')
        .mockResolvedValueOnce(500000000000000000n) // balanceOf
        .mockResolvedValueOnce(1000000000000000000n) // totalSupply
        .mockResolvedValueOnce([1000000000000000000n, 2000000000n]) // getReserves

      const position = await pools.getUserPosition(
        '0x1234567890123456789012345678901234567890' as Address,
        '0xtokenA00000000000000000000000000000001' as Address,
        '0xtokenB00000000000000000000000000000002' as Address,
      )

      expect(position).toBeDefined()
      expect(position?.lpBalance).toBe(500000000000000000n)
    })
  })

  describe('buildAddLiquidityTx', () => {
    it('should build add liquidity tx', () => {
      const tx = pools.buildAddLiquidityTx({
        tokenA: '0xtokenA00000000000000000000000000000001' as Address,
        tokenB: '0xtokenB00000000000000000000000000000002' as Address,
        amountA: 1000000000000000000n,
        amountB: 2000000000n,
        minAmountA: 990000000000000000n,
        minAmountB: 1980000000n,
        recipient: '0x1234567890123456789012345678901234567890' as Address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      })

      expect(tx).not.toBeNull()
      expect(tx?.data).toContain('0x')
    })
  })

  describe('buildRemoveLiquidityTx', () => {
    it('should build remove liquidity tx', () => {
      const tx = pools.buildRemoveLiquidityTx({
        tokenA: '0xtokenA00000000000000000000000000000001' as Address,
        tokenB: '0xtokenB00000000000000000000000000000002' as Address,
        liquidity: 500000000000000000n,
        minAmountA: 490000000000000000n,
        minAmountB: 980000000n,
        recipient: '0x1234567890123456789012345678901234567890' as Address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('calculateOptimalAmounts', () => {
    it('should calculate optimal token amounts', async () => {
      mockReadContract
        .mockResolvedValueOnce('0xpair0000000000000000000000000000000001')
        .mockResolvedValueOnce([1000000000000000000n, 2000000000n])

      const amounts = await pools.calculateOptimalAmounts(
        '0xtokenA00000000000000000000000000000001' as Address,
        '0xtokenB00000000000000000000000000000002' as Address,
        1000000000000000000n,
        true, // amountADesired
      )

      expect(amounts).toBeDefined()
      expect(amounts.amountA).toBe(1000000000000000000n)
    })
  })

  describe('V3 positions', () => {
    it('should get V3 position info', async () => {
      mockReadContract.mockResolvedValueOnce({
        token0: '0xtokenA00000000000000000000000000000001',
        token1: '0xtokenB00000000000000000000000000000002',
        fee: 3000,
        tickLower: -887220,
        tickUpper: 887220,
        liquidity: 1000000000000000000n,
        tokensOwed0: 0n,
        tokensOwed1: 0n,
      })

      const position = await pools.getV3Position(1n)

      expect(position).toBeDefined()
      expect(position?.fee).toBe(3000)
    })

    it('should build collect fees tx', () => {
      const tx = pools.buildCollectFeesTx({
        tokenId: 1n,
        recipient: '0x1234567890123456789012345678901234567890' as Address,
        amount0Max: 1000000000000000000n,
        amount1Max: 2000000000n,
      })

      expect(tx).not.toBeNull()
    })
  })
})

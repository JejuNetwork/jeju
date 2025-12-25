/**
 * Token Launchpad Service Tests
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
    tokenLaunchpad: '0xlaunch00000000000000000000000000000001',
    bondingCurveFactory: '0xbonding0000000000000000000000000000002',
    icoPresale: '0xpresale0000000000000000000000000000003',
  }),
  getNetworkRpcUrl: () => 'http://localhost:8545',
}))

const { LaunchpadService } = await import('./index')

describe('LaunchpadService', () => {
  let launchpad: InstanceType<typeof LaunchpadService>

  beforeEach(() => {
    launchpad = new LaunchpadService(420691)
    mockReadContract.mockClear()
  })

  describe('getLaunches', () => {
    it('should get active token launches', async () => {
      mockReadContract.mockResolvedValueOnce([
        {
          token: '0xtoken00000000000000000000000000000001',
          name: 'Test Token',
          symbol: 'TEST',
          totalSupply: 1000000000000000000000n,
          raised: 50000000000000000000n,
          softCap: 100000000000000000000n,
          hardCap: 500000000000000000000n,
          startTime: 1700000000n,
          endTime: 1700100000n,
          status: 0,
        },
      ])

      const launches = await launchpad.getLaunches()

      expect(launches).toBeDefined()
      expect(launches.length).toBeGreaterThan(0)
    })
  })

  describe('getLaunch', () => {
    it('should get specific launch details', async () => {
      mockReadContract.mockResolvedValueOnce({
        token: '0xtoken00000000000000000000000000000001',
        creator: '0xcreator0000000000000000000000000000001',
        name: 'Test Token',
        symbol: 'TEST',
        totalSupply: 1000000000000000000000n,
        raised: 50000000000000000000n,
        softCap: 100000000000000000000n,
        hardCap: 500000000000000000000n,
        startTime: 1700000000n,
        endTime: 1700100000n,
        status: 0,
      })

      const launch = await launchpad.getLaunch(
        '0xtoken00000000000000000000000000000001' as Address,
      )

      expect(launch).toBeDefined()
      expect(launch?.symbol).toBe('TEST')
    })
  })

  describe('buildLaunchTokenTx', () => {
    it('should build launch token tx', () => {
      const tx = launchpad.buildLaunchTokenTx({
        name: 'My Token',
        symbol: 'MTK',
        totalSupply: 1000000000000000000000n,
        softCap: 100000000000000000000n,
        hardCap: 500000000000000000000n,
        duration: 86400 * 7, // 7 days
        tokenPrice: 1000000000000000n, // 0.001 ETH per token
      })

      expect(tx).not.toBeNull()
      expect(tx?.data).toContain('0x')
    })
  })

  describe('buildContributeTx', () => {
    it('should build contribution tx with ETH value', () => {
      const tx = launchpad.buildContributeTx({
        token: '0xtoken00000000000000000000000000000001' as Address,
        amount: 1000000000000000000n,
      })

      expect(tx).not.toBeNull()
      expect(tx?.value).toBe(1000000000000000000n)
    })
  })

  describe('buildClaimTokensTx', () => {
    it('should build claim tokens tx', () => {
      const tx = launchpad.buildClaimTokensTx({
        token: '0xtoken00000000000000000000000000000001' as Address,
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('Bonding Curve', () => {
    it('should get bonding curve info', async () => {
      mockReadContract.mockResolvedValueOnce({
        token: '0xtoken00000000000000000000000000000001',
        reserveBalance: 100000000000000000000n,
        tokenSupply: 1000000000000000000000n,
        reserveRatio: 500000, // 50%
        creator: '0xcreator0000000000000000000000000000001',
      })

      const curve = await launchpad.getBondingCurve(
        '0xtoken00000000000000000000000000000001' as Address,
      )

      expect(curve).toBeDefined()
      expect(curve?.reserveRatio).toBe(500000)
    })

    it('should calculate buy price', async () => {
      mockReadContract.mockResolvedValueOnce(1100000000000000000n) // 1.1 ETH

      const price = await launchpad.calculateBuyPrice(
        '0xtoken00000000000000000000000000000001' as Address,
        1000000000000000000n, // 1 token
      )

      expect(price).toBe(1100000000000000000n)
    })

    it('should calculate sell price', async () => {
      mockReadContract.mockResolvedValueOnce(900000000000000000n) // 0.9 ETH

      const price = await launchpad.calculateSellPrice(
        '0xtoken00000000000000000000000000000001' as Address,
        1000000000000000000n,
      )

      expect(price).toBe(900000000000000000n)
    })

    it('should build buy on curve tx', () => {
      const tx = launchpad.buildBuyOnCurveTx({
        token: '0xtoken00000000000000000000000000000001' as Address,
        minTokens: 900000000000000000n,
        ethAmount: 1000000000000000000n,
      })

      expect(tx).not.toBeNull()
      expect(tx?.value).toBe(1000000000000000000n)
    })

    it('should build sell on curve tx', () => {
      const tx = launchpad.buildSellOnCurveTx({
        token: '0xtoken00000000000000000000000000000001' as Address,
        tokenAmount: 1000000000000000000n,
        minEth: 900000000000000000n,
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('Presale', () => {
    it('should get presale info', async () => {
      mockReadContract.mockResolvedValueOnce({
        token: '0xtoken00000000000000000000000000000001',
        price: 1000000000000000n,
        minContribution: 100000000000000000n,
        maxContribution: 10000000000000000000n,
        raised: 500000000000000000000n,
        hardCap: 1000000000000000000000n,
        startTime: 1700000000n,
        endTime: 1700100000n,
        whitelistEnabled: true,
      })

      const presale = await launchpad.getPresale(
        '0xtoken00000000000000000000000000000001' as Address,
      )

      expect(presale).toBeDefined()
      expect(presale?.whitelistEnabled).toBe(true)
    })

    it('should check whitelist status', async () => {
      mockReadContract.mockResolvedValueOnce(true)

      const isWhitelisted = await launchpad.isWhitelisted(
        '0xtoken00000000000000000000000000000001' as Address,
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(isWhitelisted).toBe(true)
    })
  })
})

/**
 * JNS (Jeju Name Service) Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address } from 'viem'
import { JNSService } from './index'

// Mock chain contracts
const mockRegistrar = '0xjnsregistrar0000000000000000000000000001' as Address
const mockResolver = '0xjnsresolver0000000000000000000000000002' as Address
const mockReverse = '0xjnsreverse00000000000000000000000000003' as Address

mock.module('../../sdk/chains', () => ({
  getChainContracts: () => ({
    jnsRegistrar: mockRegistrar,
    jnsResolver: mockResolver,
    jnsReverseRegistrar: mockReverse,
  }),
  getNetworkRpcUrl: () => 'http://localhost:8545',
}))

// Mock RPC service
const mockReadContract = mock(() => Promise.resolve(true))
const mockGetClient = mock(() => ({
  readContract: mockReadContract,
}))

mock.module('../rpc', () => ({
  rpcService: { getClient: mockGetClient },
  isSupportedChainId: () => true,
}))

describe('JNSService', () => {
  let jns: JNSService

  beforeEach(() => {
    jns = new JNSService(420691)
    mockReadContract.mockClear()
  })

  describe('isAvailable', () => {
    it('should check name availability', async () => {
      mockReadContract.mockResolvedValueOnce(true)

      const available = await jns.isAvailable('myname')
      expect(available).toBe(true)
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: mockRegistrar,
          functionName: 'available',
          args: ['myname'],
        }),
      )
    })

    it('should return false for taken names', async () => {
      mockReadContract.mockResolvedValueOnce(false)

      const available = await jns.isAvailable('taken')
      expect(available).toBe(false)
    })
  })

  describe('getPrice', () => {
    it('should get pricing from registrar', async () => {
      mockReadContract.mockResolvedValueOnce(true) // isAvailable
      mockReadContract.mockResolvedValueOnce(1000000000000000n) // rentPrice

      const pricing = await jns.getPrice('test', 1)

      expect(pricing.name).toBe('test')
      expect(pricing.available).toBe(true)
      expect(pricing.price).toBe(1000000000000000n)
      expect(pricing.duration).toBe(365 * 24 * 60 * 60)
    })

    it('should calculate multi-year pricing', async () => {
      mockReadContract.mockResolvedValueOnce(true)
      mockReadContract.mockResolvedValueOnce(2000000000000000n) // 2 years price

      const pricing = await jns.getPrice('test', 2)

      expect(pricing.pricePerYear).toBe(1000000000000000n)
    })
  })

  describe('resolve', () => {
    it('should resolve name to address', async () => {
      const expectedAddress =
        '0x1234567890123456789012345678901234567890' as Address
      mockReadContract.mockResolvedValueOnce(expectedAddress)

      const address = await jns.resolve('test.jeju')
      expect(address).toBe(expectedAddress)
    })

    it('should return null for unregistered names', async () => {
      mockReadContract.mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000000',
      )

      const address = await jns.resolve('unregistered')
      expect(address).toBeNull()
    })

    it('should add .jeju suffix if missing', async () => {
      const expectedAddress =
        '0x1234567890123456789012345678901234567890' as Address
      mockReadContract.mockResolvedValueOnce(expectedAddress)

      await jns.resolve('test') // Without .jeju
      expect(mockReadContract).toHaveBeenCalled()
    })
  })

  describe('getText', () => {
    it('should get text record', async () => {
      mockReadContract.mockResolvedValueOnce('Hello World')

      const text = await jns.getText('test', 'description')
      expect(text).toBe('Hello World')
    })
  })

  describe('buildRegisterTx', () => {
    it('should build registration transaction', () => {
      const tx = jns.buildRegisterTx({
        name: 'myname',
        owner: '0x1234567890123456789012345678901234567890' as Address,
        duration: 365 * 24 * 60 * 60,
      })

      expect(tx).not.toBeNull()
      expect(tx?.to).toBe(mockRegistrar)
      expect(tx?.data).toContain('0x') // Has data
    })
  })

  describe('buildSetPrimaryNameTx', () => {
    it('should build set primary name transaction', () => {
      const tx = jns.buildSetPrimaryNameTx('myname')

      expect(tx).not.toBeNull()
      expect(tx?.to).toBe(mockReverse)
    })
  })

  describe('formatAddress', () => {
    it('should format address with JNS name if available', async () => {
      mockReadContract
        .mockResolvedValueOnce('0xnode123') // node
        .mockResolvedValueOnce('alice.jeju') // name

      const formatted = await jns.formatAddress(
        '0x1234567890123456789012345678901234567890' as Address,
      )
      expect(formatted).toBe('alice.jeju')
    })

    it('should format address as truncated hex if no name', async () => {
      mockReadContract
        .mockResolvedValueOnce('0xnode123')
        .mockResolvedValueOnce(null)

      const formatted = await jns.formatAddress(
        '0x1234567890123456789012345678901234567890' as Address,
      )
      expect(formatted).toBe('0x1234...7890')
    })
  })
})

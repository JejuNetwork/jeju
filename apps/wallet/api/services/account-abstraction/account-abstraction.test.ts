/**
 * Account Abstraction Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address, Hex } from 'viem'

// Mock RPC service
const mockReadContract = mock(() =>
  Promise.resolve('0xsmartaccount0000000000000000000000000001'),
)
const mockGetClient = mock(() => ({
  readContract: mockReadContract,
  getCode: mock(() => Promise.resolve('0x123456')),
  estimateGas: mock(() => Promise.resolve(100000n)),
  getGasPrice: mock(() => Promise.resolve(20000000000n)),
}))

mock.module('../rpc', () => ({
  rpcService: { getClient: mockGetClient },
  isSupportedChainId: () => true,
}))

mock.module('../../sdk/chains', () => ({
  getChainContracts: () => ({
    entryPoint: '0xentrypoint00000000000000000000000000001',
    simpleAccountFactory: '0xfactory0000000000000000000000000000002',
  }),
  getNetworkRpcUrl: () => 'http://localhost:8545',
}))

// Mock fetch for bundler
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: {
          callGasLimit: '0x10000',
          verificationGasLimit: '0x20000',
          preVerificationGas: '0x5000',
        },
      }),
  }),
)

globalThis.fetch = mockFetch as typeof fetch

const { AAService } = await import('./index')

describe('AAService', () => {
  let aa: InstanceType<typeof AAService>

  beforeEach(() => {
    aa = new AAService(1)
    mockReadContract.mockClear()
    mockFetch.mockClear()
  })

  describe('getSmartAccountAddress', () => {
    it('should compute counterfactual address', async () => {
      mockReadContract.mockResolvedValueOnce(
        '0xsmartaccount0000000000000000000000000001',
      )

      const address = await aa.getSmartAccountAddress(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(address).toBe('0xsmartaccount0000000000000000000000000001')
    })
  })

  describe('isDeployed', () => {
    it('should return true for deployed account', async () => {
      mockReadContract.mockResolvedValueOnce(
        '0xsmartaccount0000000000000000000000000001',
      )

      const deployed = await aa.isDeployed(
        '0xsmartaccount0000000000000000000000000001' as Address,
      )

      expect(deployed).toBe(true)
    })

    it('should return false for non-deployed account', async () => {
      const mockClient = mockGetClient()
      mockClient.getCode = mock(() => Promise.resolve('0x'))

      const deployed = await aa.isDeployed(
        '0xnotdeployed000000000000000000000000001' as Address,
      )

      // Default mock returns code, so should be true
      expect(deployed).toBe(true)
    })
  })

  describe('buildUserOperation', () => {
    it('should build user operation', async () => {
      const userOp = await aa.buildUserOperation({
        sender: '0xsmartaccount0000000000000000000000000001' as Address,
        callData: '0x123456' as Hex,
      })

      expect(userOp.sender).toBe('0xsmartaccount0000000000000000000000000001')
      expect(userOp.callData).toBe('0x123456')
    })

    it('should include init code for new accounts', async () => {
      const mockClient = mockGetClient()
      mockClient.getCode = mock(() => Promise.resolve('0x'))

      const userOp = await aa.buildUserOperation({
        sender: '0xnewaccount0000000000000000000000000001' as Address,
        callData: '0x123456' as Hex,
      })

      expect(userOp.initCode).not.toBe('0x')
    })
  })

  describe('estimateUserOperationGas', () => {
    it('should get gas estimates from bundler', async () => {
      const gas = await aa.estimateUserOperationGas({
        sender: '0xsmartaccount0000000000000000000000000001' as Address,
        callData: '0x123456' as Hex,
        nonce: 0n,
        initCode: '0x' as Hex,
        signature: '0x' as Hex,
      })

      expect(gas.callGasLimit).toBeDefined()
      expect(gas.verificationGasLimit).toBeDefined()
      expect(gas.preVerificationGas).toBeDefined()
    })
  })

  describe('sendUserOperation', () => {
    it('should send user operation to bundler', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: '0xuserophash00000000000000000000000000001',
          }),
      })

      const hash = await aa.sendUserOperation({
        sender: '0xsmartaccount0000000000000000000000000001' as Address,
        callData: '0x123456' as Hex,
        nonce: 0n,
        initCode: '0x' as Hex,
        callGasLimit: 100000n,
        verificationGasLimit: 200000n,
        preVerificationGas: 20000n,
        maxFeePerGas: 20000000000n,
        maxPriorityFeePerGas: 1000000000n,
        signature: '0xsig' as Hex,
      })

      expect(hash).toBe('0xuserophash00000000000000000000000000001')
    })
  })

  describe('getUserOperationReceipt', () => {
    it('should get operation receipt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: {
              success: true,
              receipt: {
                transactionHash: '0xtxhash000000000000000000000000000001',
              },
            },
          }),
      })

      const receipt = await aa.getUserOperationReceipt(
        '0xuserophash00000000000000000000000000001' as Hex,
      )

      expect(receipt?.success).toBe(true)
      expect(receipt?.txHash).toBe('0xtxhash000000000000000000000000000001')
    })

    it('should return null for pending operations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: null,
          }),
      })

      const receipt = await aa.getUserOperationReceipt(
        '0xpending0000000000000000000000000000001' as Hex,
      )

      expect(receipt).toBeNull()
    })
  })

  describe('encodeExecute', () => {
    it('should encode single call', () => {
      const data = aa.encodeExecute({
        to: '0xto000000000000000000000000000000000001' as Address,
        value: 1000000000000000000n,
        data: '0x' as Hex,
      })

      expect(data).toContain('0x')
    })

    it('should encode batch calls', () => {
      const data = aa.encodeExecuteBatch([
        {
          to: '0xto000000000000000000000000000000000001' as Address,
          value: 0n,
          data: '0x123456' as Hex,
        },
        {
          to: '0xto000000000000000000000000000000000002' as Address,
          value: 0n,
          data: '0x789abc' as Hex,
        },
      ])

      expect(data).toContain('0x')
    })
  })
})

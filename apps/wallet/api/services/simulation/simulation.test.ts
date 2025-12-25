/**
 * Transaction Simulation Service Tests
 *
 * Tests transaction simulation using mocks.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { PublicClient } from 'viem'
import * as oracleModule from '../oracle'
import type { SupportedChainId } from '../rpc'
import * as rpcModule from '../rpc'
import { SimulationService } from './index'

/**
 * Creates a mock PublicClient for SimulationService testing.
 * Uses Partial to implement only the methods used in these tests.
 */
function createMockPublicClient(): PublicClient {
  const partialClient: Partial<PublicClient> = {
    estimateGas: mock(() => Promise.resolve(21000n)),
    getGasPrice: mock(() => Promise.resolve(1000000000n)),
    estimateFeesPerGas: mock(() =>
      Promise.resolve({
        maxFeePerGas: 1500000000n,
        maxPriorityFeePerGas: 100000000n,
      }),
    ),
    call: mock(() => Promise.resolve({})),
    readContract: mock(() => Promise.resolve('TOKEN')),
  }
  // Type assertion is safe because tests only call the mocked methods
  return partialClient as PublicClient
}

describe('SimulationService', () => {
  let simulationService: SimulationService
  let originalGetClient: typeof rpcModule.rpcService.getClient
  let originalGetNativeTokenPrice: typeof oracleModule.oracleService.getNativeTokenPrice
  let originalGetTokenPrice: typeof oracleModule.oracleService.getTokenPrice

  beforeEach(() => {
    // Save originals
    originalGetClient = rpcModule.rpcService.getClient
    originalGetNativeTokenPrice = oracleModule.oracleService.getNativeTokenPrice
    originalGetTokenPrice = oracleModule.oracleService.getTokenPrice

    // Create mock client with proper typing
    const mockClient = createMockPublicClient()

    // Mock rpcService.getClient - returns RPCPublicClient which mock satisfies
    rpcModule.rpcService.getClient = mock(() => mockClient)

    // Mock oracle service
    oracleModule.oracleService.getNativeTokenPrice = mock(() =>
      Promise.resolve(2000),
    )
    oracleModule.oracleService.getTokenPrice = mock(() => Promise.resolve(1))

    simulationService = new SimulationService()
  })

  afterEach(() => {
    // Restore originals
    rpcModule.rpcService.getClient = originalGetClient
    oracleModule.oracleService.getNativeTokenPrice = originalGetNativeTokenPrice
    oracleModule.oracleService.getTokenPrice = originalGetTokenPrice
  })

  describe('simulate', () => {
    it('should simulate a simple ETH transfer', async () => {
      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xabcdef1234567890abcdef1234567890abcdef12',
        value: 1000000000000000000n, // 1 ETH
        data: '0x',
      })

      expect(result.success).toBe(true)
      expect(result.nativeChange).toBeDefined()
      expect(result.nativeChange?.type).toBe('send')
      expect(result.gas.gasLimit).toBeGreaterThan(0n)
    })

    it('should detect approve transactions', async () => {
      const approveData =
        '0x095ea7b3' +
        '000000000000000000000000abcdef1234567890abcdef1234567890abcdef12' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: 0n,
        data: approveData as `0x${string}`,
      })

      expect(result.success).toBe(true)
      expect(result.approvalChanges).toHaveLength(1)
      expect(result.approvalChanges[0].amount).toBe('unlimited')
    })

    it('should set risk level for unlimited approvals', async () => {
      const approveData =
        '0x095ea7b3' +
        '000000000000000000000000abcdef1234567890abcdef1234567890abcdef12' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: 0n,
        data: approveData as `0x${string}`,
      })

      expect(result.risk.level).not.toBe('safe')
      expect(result.risk.warnings.length).toBeGreaterThan(0)
    })

    it('should include gas estimate', async () => {
      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xabcdef1234567890abcdef1234567890abcdef12',
        value: 1000000000000000000n,
        data: '0x',
      })

      expect(result.gas).toBeDefined()
      expect(result.gas.gasLimit).toBeGreaterThan(0n)
      expect(result.gas.totalCostUsd).toBeGreaterThanOrEqual(0)
    })
  })
})

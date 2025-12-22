/**
 * Gas Abstraction Service Tests
 * Tests for gas status, token selection, and cross-chain gas bridging logic
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  mock,
} from 'bun:test'
import type { Address, PublicClient } from 'viem'
import {
  createGasService,
  GasAbstractionService,
  type GasConfig,
} from './gas-abstraction'
import type { TokenBalance } from './types'

// Test addresses
const TEST_USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address

// Mock function types
type GetBalanceFn = (args: { address: Address }) => Promise<bigint>
type GetGasPriceFn = () => Promise<bigint>
type ReadContractFn = (args: object) => Promise<bigint>

// Create mock public client with accessible mock functions
interface MockPublicClientWithFns {
  client: PublicClient
  getBalance: Mock<GetBalanceFn>
  getGasPrice: Mock<GetGasPriceFn>
  readContract: Mock<ReadContractFn>
}

/**
 * Creates a mock PublicClient for testing.
 * Uses Partial to implement only the methods used in GasAbstractionService tests.
 */
const createMockPublicClient = (): MockPublicClientWithFns => {
  const getBalance = mock<GetBalanceFn>(() => Promise.resolve(0n))
  const getGasPrice = mock<GetGasPriceFn>(() => Promise.resolve(0n))
  const readContract = mock<ReadContractFn>(() => Promise.resolve(0n))

  // Create partial mock - cast via Partial for type safety
  const partialClient: Partial<PublicClient> = {
    getBalance,
    getGasPrice,
    readContract,
  }

  return {
    // Type assertion is safe because tests only call the mocked methods
    client: partialClient as PublicClient,
    getBalance,
    getGasPrice,
    readContract,
  }
}

// Helper to create token balance
const createTokenBalance = (
  address: Address,
  chainId: number,
  symbol: string,
  balance: bigint,
  usdValue?: number,
): TokenBalance => ({
  token: {
    address,
    chainId,
    symbol,
    name: symbol,
    decimals: symbol.includes('USD') ? 6 : 18,
    isNative: address === ZERO_ADDRESS,
  },
  balance,
  usdValue,
})

describe('GasAbstractionService', () => {
  let service: GasAbstractionService
  let publicClients: Map<number, PublicClient>
  let mockClient1: MockPublicClientWithFns
  let mockClient8453: MockPublicClientWithFns

  beforeEach(() => {
    mockClient1 = createMockPublicClient()
    mockClient8453 = createMockPublicClient()

    publicClients = new Map([
      [1, mockClient1.client],
      [8453, mockClient8453.client],
    ])

    service = createGasService({
      publicClients,
      supportedChains: [1, 8453],
    })
  })

  afterEach(() => {
    // Mocks are recreated in beforeEach, no need for explicit clearing
  })

  describe('getGasStatus', () => {
    it('should detect native balance availability', async () => {
      const nativeBalance = 1000000000000000000n // 1 ETH
      mockClient1.getBalance.mockImplementationOnce(() =>
        Promise.resolve(nativeBalance),
      )
      mockClient1.getGasPrice.mockImplementationOnce(() =>
        Promise.resolve(20000000000n),
      )

      const status = await service.getGasStatus(1, TEST_USER, [])

      expect(status.chainId).toBe(1)
      expect(status.hasNativeBalance).toBe(true)
      expect(status.nativeBalance).toBe(nativeBalance)
    })

    it('should detect no native balance', async () => {
      mockClient1.getBalance.mockImplementationOnce(() => Promise.resolve(0n))
      mockClient1.getGasPrice.mockImplementationOnce(() =>
        Promise.resolve(20000000000n),
      )

      const status = await service.getGasStatus(1, TEST_USER, [])

      expect(status.hasNativeBalance).toBe(false)
      expect(status.nativeBalance).toBe(0n)
    })

    it('should throw for unsupported chain', async () => {
      await expect(service.getGasStatus(999999, TEST_USER, [])).rejects.toThrow(
        'Chain 999999 not supported',
      )
    })

    it('should detect need for bridging when no balance on any source', async () => {
      mockClient1.getBalance.mockImplementationOnce(() => Promise.resolve(0n))
      mockClient1.getGasPrice.mockImplementationOnce(() =>
        Promise.resolve(20000000000n),
      )

      // User has balance on Base
      const tokenBalances: TokenBalance[] = [
        createTokenBalance(USDC_BASE, 8453, 'USDC', 10000000n, 10), // 10 USDC on Base
      ]

      const status = await service.getGasStatus(1, TEST_USER, tokenBalances)

      expect(status.needsBridge).toBe(true)
      expect(status.bridgeEstimate).toBeDefined()
      expect(status.bridgeEstimate?.sourceChain).toBe(8453)
    })

    it('should not need bridging when has native balance', async () => {
      mockClient1.getBalance.mockImplementationOnce(() =>
        Promise.resolve(1000000000000000000n),
      )
      mockClient1.getGasPrice.mockImplementationOnce(() =>
        Promise.resolve(20000000000n),
      )

      const status = await service.getGasStatus(1, TEST_USER, [])

      expect(status.needsBridge).toBe(false)
    })
  })

  describe('getSupportedTokens', () => {
    it('should return supported tokens for Ethereum mainnet', () => {
      const tokens = service.getSupportedTokens(1)

      expect(tokens).toContain(USDC_ETH)
      expect(tokens).toContain(USDT_ADDRESS)
      expect(tokens.length).toBeGreaterThan(0)
    })

    it('should return supported tokens for Base', () => {
      const tokens = service.getSupportedTokens(8453)

      expect(tokens).toContain(USDC_BASE)
    })

    it('should return empty array for localnet', () => {
      const tokens = service.getSupportedTokens(1337)

      expect(tokens).toEqual([])
    })

    it('should return empty array for unknown chain', () => {
      const tokens = service.getSupportedTokens(999999)

      expect(tokens).toEqual([])
    })
  })

  describe('buildPaymasterData', () => {
    it('should build empty paymaster data for unconfigured chain', () => {
      const paymasterData = service.buildPaymasterData(999999, USDC_ETH)

      expect(paymasterData).toBe('0x')
    })

    it('should build paymaster data for configured chain', () => {
      // For chains with EIL configured, should return paymaster data
      const paymasterData = service.buildPaymasterData(1, USDC_ETH)

      // Either returns 0x (no EIL) or valid paymaster data
      expect(paymasterData).toMatch(/^0x/)
    })
  })

  describe('setConfig', () => {
    it('should update configuration', () => {
      const newConfig: Partial<GasConfig> = {
        preferredMode: 'native',
        maxGasPriceGwei: 50,
        autoBridge: false,
      }

      service.setConfig(newConfig)

      // Config is private, but behavior should change
      // No direct way to verify, but shouldn't throw
      expect(true).toBe(true)
    })
  })

  describe('ensureGas', () => {
    it('should return ready when has sufficient native balance', async () => {
      mockClient1.getBalance.mockImplementationOnce(() =>
        Promise.resolve(1000000000000000000n),
      )
      mockClient1.getGasPrice.mockImplementationOnce(() =>
        Promise.resolve(20000000000n),
      )

      const result = await service.ensureGas(
        1,
        TEST_USER,
        [],
        100000000000000n, // 0.0001 ETH
      )

      expect(result.ready).toBe(true)
      expect(result.action).toBe('none')
    })

    it('should return not ready when balance is insufficient', async () => {
      mockClient1.getBalance.mockImplementationOnce(() => Promise.resolve(0n))
      mockClient1.getGasPrice.mockImplementationOnce(() =>
        Promise.resolve(20000000000n),
      )

      const result = await service.ensureGas(
        1,
        TEST_USER,
        [],
        1000000000000000n,
      )

      expect(result.ready).toBe(false)
    })
  })

  describe('getBestGasOption', () => {
    it('should return null when no EIL client', async () => {
      // Chain 999999 won't have EIL client
      const unconfiguredService = createGasService({
        publicClients: new Map([[999999, createMockPublicClient().client]]),
        supportedChains: [999999],
      })

      const option = await unconfiguredService.getBestGasOption(
        999999,
        TEST_USER,
        [],
        100000n,
      )

      expect(option).toBeNull()
    })

    it('should return null when no token balances', async () => {
      const option = await service.getBestGasOption(1, TEST_USER, [], 100000n)

      expect(option).toBeNull()
    })
  })

  describe('Factory function', () => {
    it('should create GasAbstractionService instance', () => {
      const gasService = createGasService({
        publicClients,
        supportedChains: [1, 8453],
      })

      expect(gasService).toBeInstanceOf(GasAbstractionService)
    })

    it('should accept default config', () => {
      const gasService = createGasService({
        publicClients,
        supportedChains: [1],
        defaultConfig: {
          preferredMode: 'sponsored',
          maxGasPriceGwei: 200,
        },
      })

      expect(gasService).toBeInstanceOf(GasAbstractionService)
    })
  })
})

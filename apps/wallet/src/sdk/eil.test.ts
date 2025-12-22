/**
 * EIL SDK Tests
 * Tests for Ethereum Interop Layer client, paymaster data building, and cross-chain operations
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
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { createEILClient, EILClient } from './eil'
import type { TokenBalance } from './types'

// Test addresses
const TEST_USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
const TEST_RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address
const TEST_PAYMASTER = '0x9406Cc6185a346906296840746125a0E44976454' as Address
const TEST_APP = '0x1234567890123456789012345678901234567890' as Address

/** Mock function type for contract reads */
type ContractReadMock = Mock<(...args: unknown[]) => Promise<unknown>>
/** Mock function type for contract writes */
type ContractWriteMock = Mock<(...args: unknown[]) => Promise<Hex>>
/** Mock function type for transaction receipts */
type TxReceiptMock = Mock<(...args: unknown[]) => Promise<{ status: string }>>

/**
 * Subset of PublicClient methods used in EIL SDK tests.
 * This allows type-safe mocking without needing the full PublicClient interface.
 */
interface MockablePublicClient {
  readContract: ContractReadMock
  waitForTransactionReceipt: TxReceiptMock
}

/**
 * Subset of WalletClient properties used in EIL SDK tests.
 */
interface MockableWalletClient {
  account: { address: Address }
  writeContract: ContractWriteMock
}

// Create mock public client with accessible mock functions
interface MockPublicClientWithFns {
  client: MockablePublicClient
  readContract: ContractReadMock
  waitForTransactionReceipt: TxReceiptMock
}

const createMockPublicClient = (): MockPublicClientWithFns => {
  const readContract = mock(() => Promise.resolve()) as ContractReadMock
  const waitForTransactionReceipt = mock(() =>
    Promise.resolve({ status: 'success' }),
  ) as TxReceiptMock

  const client: MockablePublicClient = {
    readContract,
    waitForTransactionReceipt,
  }
  return {
    client,
    readContract,
    waitForTransactionReceipt,
  }
}

interface MockWalletClientWithFns {
  client: MockableWalletClient
  writeContract: ContractWriteMock
}

const createMockWalletClient = (): MockWalletClientWithFns => {
  const writeContract = mock(() =>
    Promise.resolve('0x' as Hex),
  ) as ContractWriteMock

  const client: MockableWalletClient = {
    account: { address: TEST_USER },
    writeContract,
  }
  return {
    client,
    writeContract,
  }
}

describe('EILClient', () => {
  let client: EILClient
  let mockPublicClient: MockPublicClientWithFns
  let mockWalletClient: MockWalletClientWithFns

  beforeEach(() => {
    mockPublicClient = createMockPublicClient()
    mockWalletClient = createMockWalletClient()

    // Create client with custom paymaster to ensure isConfigured = true
    client = new EILClient({
      chainId: 84532, // Base Sepolia has contracts configured
      publicClient: mockPublicClient.client as PublicClient,
      walletClient: mockWalletClient.client as WalletClient,
    })
  })

  afterEach(() => {
    // Mocks are recreated in beforeEach, no need to clear
  })

  describe('buildPaymasterData', () => {
    it('should build token payment data correctly', () => {
      const paymasterData = client.buildPaymasterData(USDC_ADDRESS)

      // Format: [mode(1 byte)][token(20 bytes)][appAddress(20 bytes)]
      expect(paymasterData).toMatch(/^0x/)
      expect(paymasterData.length).toBe(2 + 2 + 40 + 40) // 0x + mode + token + app

      // Mode should be 00
      expect(paymasterData.slice(2, 4)).toBe('00')

      // Token address should follow (lowercase)
      expect(paymasterData.slice(4, 44).toLowerCase()).toBe(
        USDC_ADDRESS.slice(2).toLowerCase(),
      )

      // App address should be zero address when not specified
      expect(paymasterData.slice(44).toLowerCase()).toBe(
        ZERO_ADDRESS.slice(2).toLowerCase(),
      )
    })

    it('should include app address when provided', () => {
      const paymasterData = client.buildPaymasterData(USDC_ADDRESS, TEST_APP)

      expect(paymasterData.slice(44).toLowerCase()).toBe(
        TEST_APP.slice(2).toLowerCase(),
      )
    })

    it('should handle different token addresses', () => {
      const usdcData = client.buildPaymasterData(USDC_ADDRESS)
      const usdtData = client.buildPaymasterData(USDT_ADDRESS)

      expect(usdcData).not.toBe(usdtData)
      expect(usdcData.slice(4, 44).toLowerCase()).toBe(
        USDC_ADDRESS.slice(2).toLowerCase(),
      )
      expect(usdtData.slice(4, 44).toLowerCase()).toBe(
        USDT_ADDRESS.slice(2).toLowerCase(),
      )
    })
  })

  describe('isReady', () => {
    it('should return true when paymaster is configured', () => {
      // Base Sepolia has contracts configured
      const configuredClient = new EILClient({
        chainId: 84532,
        publicClient: mockPublicClient.client as PublicClient,
        paymasterAddress: TEST_PAYMASTER,
      })

      expect(configuredClient.isReady()).toBe(true)
    })

    it('should return false when paymaster is not configured', () => {
      // Localnet may not have contracts
      const unconfiguredClient = new EILClient({
        chainId: 999999, // Unknown chain
        publicClient: mockPublicClient.client as PublicClient,
      })

      expect(unconfiguredClient.isReady()).toBe(false)
    })
  })

  describe('canSponsor', () => {
    it('should check if paymaster can sponsor with token', async () => {
      const gasCost = 100000n
      const tokenCost = 5000000n // 5 USDC (6 decimals)
      const userBalance = 10000000n // 10 USDC

      mockPublicClient.readContract.mockResolvedValueOnce([
        true,
        tokenCost,
        userBalance,
      ])

      const result = await client.canSponsor(gasCost, USDC_ADDRESS, TEST_USER)

      expect(result.canSponsor).toBe(true)
      expect(result.tokenCost).toBe(tokenCost)
      expect(result.userBalance).toBe(userBalance)
    })

    it('should return false when user has insufficient balance', async () => {
      mockPublicClient.readContract.mockResolvedValueOnce([
        false,
        5000000n,
        1000000n,
      ])

      const result = await client.canSponsor(100000n, USDC_ADDRESS, TEST_USER)

      expect(result.canSponsor).toBe(false)
    })
  })

  describe('getBestGasToken', () => {
    it('should find best gas payment token', async () => {
      const tokens = [USDC_ADDRESS, USDT_ADDRESS]
      mockPublicClient.readContract.mockResolvedValueOnce([
        USDC_ADDRESS,
        5000000n,
      ])

      const result = await client.getBestGasToken(TEST_USER, 100000n, tokens)

      expect(result.bestToken).toBe(USDC_ADDRESS)
      expect(result.tokenCost).toBe(5000000n)
    })

    it('should return zero address when no suitable token', async () => {
      mockPublicClient.readContract.mockResolvedValueOnce([ZERO_ADDRESS, 0n])

      const result = await client.getBestGasToken(TEST_USER, 100000n, [
        USDC_ADDRESS,
      ])

      expect(result.bestToken).toBe(ZERO_ADDRESS)
    })
  })

  describe('getBestPaymentTokenForApp', () => {
    it('should consider app preferences when finding best token', async () => {
      const tokenBalances: TokenBalance[] = [
        {
          token: {
            address: USDC_ADDRESS,
            chainId: 1,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            isNative: false,
          },
          balance: 10000000n, // 10 USDC
        },
        {
          token: {
            address: USDT_ADDRESS,
            chainId: 1,
            symbol: 'USDT',
            name: 'Tether',
            decimals: 6,
            isNative: false,
          },
          balance: 20000000n, // 20 USDT
        },
      ]

      mockPublicClient.readContract.mockResolvedValueOnce([
        USDC_ADDRESS,
        5000000n,
        'App prefers USDC',
      ])

      const result = await client.getBestPaymentTokenForApp(
        TEST_APP,
        TEST_USER,
        100000n,
        tokenBalances,
      )

      expect(result.bestToken).toBe(USDC_ADDRESS)
      expect(result.tokenCost).toBe(5000000n)
      expect(result.reason).toBe('App prefers USDC')
    })
  })

  describe('previewTokenCost', () => {
    it('should calculate token cost for gas', async () => {
      const estimatedGas = 100000n
      const gasPrice = 20000000000n // 20 gwei
      const expectedCost = 5000000n // 5 USDC

      mockPublicClient.readContract.mockResolvedValueOnce(expectedCost)

      const cost = await client.previewTokenCost(
        estimatedGas,
        gasPrice,
        USDC_ADDRESS,
      )

      expect(cost).toBe(expectedCost)
    })
  })

  describe('getSwapQuote', () => {
    it('should get swap quote with price impact', async () => {
      const amountIn = 1000000n // 1 USDC
      const expectedOut = 995000n // ~0.995 USDC worth
      const priceImpactBps = 50n // 0.5%

      mockPublicClient.readContract.mockResolvedValueOnce([
        expectedOut,
        priceImpactBps,
      ])

      const result = await client.getSwapQuote(
        USDC_ADDRESS,
        USDT_ADDRESS,
        amountIn,
      )

      expect(result.amountOut).toBe(expectedOut)
      expect(result.priceImpact).toBe(0.005) // 50 bps = 0.5%
    })
  })

  describe('Cross-chain operations', () => {
    it('should throw when creating transfer on unconfigured chain', async () => {
      const unconfiguredClient = new EILClient({
        chainId: 999999,
        publicClient: mockPublicClient.client as PublicClient,
        walletClient: mockWalletClient.client as WalletClient,
      })

      await expect(
        unconfiguredClient.createCrossChainTransfer({
          sourceToken: ZERO_ADDRESS,
          amount: 1000000000000000000n,
          destinationToken: ZERO_ADDRESS,
          destinationChainId: 8453,
        }),
      ).rejects.toThrow('EIL not configured')
    })

    it('should throw when wallet not connected', async () => {
      const clientNoWallet = new EILClient({
        chainId: 84532,
        publicClient: mockPublicClient.client as PublicClient,
        paymasterAddress: TEST_PAYMASTER,
        // No wallet client
      })

      await expect(
        clientNoWallet.createCrossChainTransfer({
          sourceToken: ZERO_ADDRESS,
          amount: 1000000000000000000n,
          destinationToken: ZERO_ADDRESS,
          destinationChainId: 8453,
        }),
      ).rejects.toThrow('Wallet not connected')
    })
  })

  describe('getCurrentFee', () => {
    it('should get current fee for request', async () => {
      const requestId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
      const expectedFee = 100000000000000n // 0.0001 ETH

      mockPublicClient.readContract.mockResolvedValueOnce(expectedFee)

      const fee = await client.getCurrentFee(requestId)

      expect(fee).toBe(expectedFee)
    })
  })

  describe('getRequest', () => {
    it('should return null for non-existent request', async () => {
      const requestId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex

      mockPublicClient.readContract.mockResolvedValueOnce({
        requester: ZERO_ADDRESS,
        token: ZERO_ADDRESS,
        amount: 0n,
        destinationToken: ZERO_ADDRESS,
        destinationChainId: 0n,
        recipient: ZERO_ADDRESS,
        gasOnDestination: 0n,
        maxFee: 0n,
        feeIncrement: 0n,
        deadline: 0n,
        createdBlock: 0n,
        claimed: false,
        expired: false,
        refunded: false,
        bidCount: 0n,
        winningXLP: ZERO_ADDRESS,
        winningFee: 0n,
      })

      const request = await client.getRequest(requestId)

      expect(request).toBeNull()
    })

    it('should return request with pending status', async () => {
      const requestId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex

      mockPublicClient.readContract.mockResolvedValueOnce({
        requester: TEST_USER,
        token: USDC_ADDRESS,
        amount: 1000000n,
        destinationToken: USDC_ADDRESS,
        destinationChainId: 8453n,
        recipient: TEST_RECIPIENT,
        gasOnDestination: 100000n,
        maxFee: 1000000000000000n,
        feeIncrement: 10000000000000n,
        deadline: 1700000000n,
        createdBlock: 18000000n,
        claimed: false,
        expired: false,
        refunded: false,
        bidCount: 2n,
        winningXLP: ZERO_ADDRESS,
        winningFee: 0n,
      })

      const request = await client.getRequest(requestId)

      expect(request).not.toBeNull()
      expect(request?.status).toBe('pending')
      expect(request?.requester).toBe(TEST_USER)
    })

    it('should return claimed status', async () => {
      const requestId = '0xabc' as Hex

      mockPublicClient.readContract.mockResolvedValueOnce({
        requester: TEST_USER,
        token: USDC_ADDRESS,
        amount: 1000000n,
        destinationToken: USDC_ADDRESS,
        destinationChainId: 8453n,
        recipient: TEST_RECIPIENT,
        gasOnDestination: 100000n,
        maxFee: 1000000000000000n,
        feeIncrement: 10000000000000n,
        deadline: 1700000000n,
        createdBlock: 18000000n,
        claimed: true,
        expired: false,
        refunded: false,
        bidCount: 2n,
        winningXLP: TEST_APP,
        winningFee: 500000000000000n,
      })

      const request = await client.getRequest(requestId)

      expect(request?.status).toBe('claimed')
    })
  })

  describe('Factory function', () => {
    it('should create EILClient instance', () => {
      const eilClient = createEILClient({
        chainId: 1,
        publicClient: mockPublicClient.client as PublicClient,
      })

      expect(eilClient).toBeInstanceOf(EILClient)
    })

    it('should accept custom paymaster address', () => {
      const eilClient = createEILClient({
        chainId: 1,
        publicClient: mockPublicClient.client as PublicClient,
        paymasterAddress: TEST_PAYMASTER,
      })

      expect(eilClient.isReady()).toBe(true)
    })
  })
})

/**
 * Account Abstraction SDK Tests
 * Tests for UserOperation building, call data encoding, and AA client operations
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
import type { Address, Hex, PublicClient } from 'viem'
import { AAClient, type Call, createAAClient } from './account-abstraction'

// Known test addresses
const TEST_OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
const TEST_RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address
const TEST_FACTORY = '0x9406Cc6185a346906296840746125a0E44976454' as Address
const TEST_SMART_ACCOUNT =
  '0x1234567890abcdef1234567890abcdef12345678' as Address

/**
 * Subset of PublicClient methods used in AA SDK tests.
 * This allows type-safe mocking without needing the full PublicClient interface.
 */
interface MockablePublicClient {
  readContract: Mock<() => Promise<bigint | Address>>
  getCode: Mock<() => Promise<string | undefined>>
  estimateFeesPerGas: Mock<
    () => Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>
  >
  getGasPrice: Mock<() => Promise<bigint>>
}

// Create mock public client with accessible mock functions
interface MockPublicClientWithFns {
  client: MockablePublicClient
  readContract: Mock<() => Promise<bigint | Address>>
  getCode: Mock<() => Promise<string | undefined>>
  estimateFeesPerGas: Mock<
    () => Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>
  >
  getGasPrice: Mock<() => Promise<bigint>>
}

const createMockPublicClient = (): MockPublicClientWithFns => {
  const readContract = mock(() => Promise.resolve(0n as bigint | Address))
  const getCode = mock(() => Promise.resolve(undefined as string | undefined))
  const estimateFeesPerGas = mock(() =>
    Promise.resolve({ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }),
  )
  const getGasPrice = mock(() => Promise.resolve(0n))

  const client: MockablePublicClient = {
    readContract,
    getCode,
    estimateFeesPerGas,
    getGasPrice,
  }
  return {
    client,
    readContract,
    getCode,
    estimateFeesPerGas,
    getGasPrice,
  }
}

describe('AAClient', () => {
  let client: AAClient
  let mockPublicClient: MockPublicClientWithFns

  beforeEach(() => {
    mockPublicClient = createMockPublicClient()
    client = createAAClient({
      chainId: 1,
      publicClient: mockPublicClient.client as PublicClient,
      bundlerUrl: 'http://localhost:4337',
    })
  })

  afterEach(() => {
    mockPublicClient.readContract.mockClear()
    mockPublicClient.getCode.mockClear()
    mockPublicClient.estimateFeesPerGas.mockClear()
    mockPublicClient.getGasPrice.mockClear()
  })

  describe('buildCallData', () => {
    it('should encode single call correctly', () => {
      const call: Call = {
        to: TEST_RECIPIENT,
        value: 1000000000000000000n, // 1 ETH
        data: '0x' as Hex,
      }

      const callData = client.buildCallData(call)

      // Should be execute(address,uint256,bytes) selector + encoded params
      expect(callData).toMatch(/^0x/)
      expect(callData.length).toBeGreaterThan(10)

      // execute selector: 0xb61d27f6
      expect(callData.slice(0, 10)).toBe('0xb61d27f6')
    })

    it('should handle zero value correctly', () => {
      const call: Call = {
        to: TEST_RECIPIENT,
        value: 0n,
        data: '0xabcdef' as Hex,
      }

      const callData = client.buildCallData(call)
      expect(callData.slice(0, 10)).toBe('0xb61d27f6')
    })

    it('should handle undefined value as zero', () => {
      const call: Call = {
        to: TEST_RECIPIENT,
        data: '0xabcdef' as Hex,
      }

      const callData = client.buildCallData(call)
      expect(callData).toMatch(/^0xb61d27f6/)
    })

    it('should handle undefined data as empty bytes', () => {
      const call: Call = {
        to: TEST_RECIPIENT,
        value: 1n,
      }

      const callData = client.buildCallData(call)
      expect(callData).toMatch(/^0xb61d27f6/)
    })

    it('should encode complex calldata correctly', () => {
      // Simulate an ERC20 transfer call
      const transferData =
        '0xa9059cbb' + // transfer selector
        '0000000000000000000000001234567890123456789012345678901234567890' + // to
        '0000000000000000000000000000000000000000000000000de0b6b3a7640000' // amount

      const call: Call = {
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
        value: 0n,
        data: transferData as Hex,
      }

      const callData = client.buildCallData(call)

      // Verify structure
      expect(callData.slice(0, 10)).toBe('0xb61d27f6')
      expect(callData.length).toBeGreaterThan(200)
    })
  })

  describe('buildBatchCallData', () => {
    it('should encode batch calls correctly', () => {
      const calls: Call[] = [
        { to: TEST_RECIPIENT, value: 1000000000000000000n, data: '0x' as Hex },
        { to: TEST_OWNER, value: 500000000000000000n, data: '0x' as Hex },
      ]

      const callData = client.buildBatchCallData(calls)

      // executeBatch selector: 0x18dfb3c7
      expect(callData.slice(0, 10)).toBe('0x18dfb3c7')
    })

    it('should handle single call in batch', () => {
      const calls: Call[] = [{ to: TEST_RECIPIENT, data: '0xabcdef' as Hex }]

      const callData = client.buildBatchCallData(calls)
      expect(callData.slice(0, 10)).toBe('0x18dfb3c7')
    })

    it('should handle empty data in batch calls', () => {
      const calls: Call[] = [{ to: TEST_RECIPIENT }, { to: TEST_OWNER }]

      const callData = client.buildBatchCallData(calls)
      expect(callData).toMatch(/^0x18dfb3c7/)
    })

    it('should preserve order of calls', () => {
      const calls: Call[] = [
        {
          to: '0x1111111111111111111111111111111111111111' as Address,
          data: '0xaa' as Hex,
        },
        {
          to: '0x2222222222222222222222222222222222222222' as Address,
          data: '0xbb' as Hex,
        },
        {
          to: '0x3333333333333333333333333333333333333333' as Address,
          data: '0xcc' as Hex,
        },
      ]

      const callData = client.buildBatchCallData(calls)

      // Each address should appear in order in the encoded data
      const callDataLower = callData.toLowerCase()
      const pos1 = callDataLower.indexOf(
        '1111111111111111111111111111111111111111',
      )
      const pos2 = callDataLower.indexOf(
        '2222222222222222222222222222222222222222',
      )
      const pos3 = callDataLower.indexOf(
        '3333333333333333333333333333333333333333',
      )

      expect(pos1).toBeLessThan(pos2)
      expect(pos2).toBeLessThan(pos3)
    })
  })

  describe('buildInitCode', () => {
    it('should build valid init code', () => {
      const initCode = client.buildInitCode(TEST_FACTORY, TEST_OWNER, 0n)

      // Init code should start with factory address
      expect(initCode.toLowerCase()).toContain(
        TEST_FACTORY.toLowerCase().slice(2),
      )

      // Should contain createAccount selector: 0x5fbfb9cf
      expect(initCode.toLowerCase()).toContain('5fbfb9cf')
    })

    it('should use default salt of 0', () => {
      const initCode1 = client.buildInitCode(TEST_FACTORY, TEST_OWNER)
      const initCode2 = client.buildInitCode(TEST_FACTORY, TEST_OWNER, 0n)

      expect(initCode1).toBe(initCode2)
    })

    it('should produce different init codes for different salts', () => {
      const initCode1 = client.buildInitCode(TEST_FACTORY, TEST_OWNER, 0n)
      const initCode2 = client.buildInitCode(TEST_FACTORY, TEST_OWNER, 1n)

      expect(initCode1).not.toBe(initCode2)
    })

    it('should produce different init codes for different owners', () => {
      const initCode1 = client.buildInitCode(TEST_FACTORY, TEST_OWNER, 0n)
      const initCode2 = client.buildInitCode(TEST_FACTORY, TEST_RECIPIENT, 0n)

      expect(initCode1).not.toBe(initCode2)
    })
  })

  describe('isAccountDeployed', () => {
    it('should return true for deployed account', async () => {
      mockPublicClient.getCode.mockResolvedValueOnce('0x608060405234801561001')

      const isDeployed = await client.isAccountDeployed(TEST_SMART_ACCOUNT)

      expect(isDeployed).toBe(true)
      expect(mockPublicClient.getCode).toHaveBeenCalledWith({
        address: TEST_SMART_ACCOUNT,
      })
    })

    it('should return false for undeployed account', async () => {
      mockPublicClient.getCode.mockResolvedValueOnce(undefined)

      const isDeployed = await client.isAccountDeployed(TEST_SMART_ACCOUNT)

      expect(isDeployed).toBe(false)
    })

    it('should return false for empty code', async () => {
      mockPublicClient.getCode.mockResolvedValueOnce('0x')

      const isDeployed = await client.isAccountDeployed(TEST_SMART_ACCOUNT)

      expect(isDeployed).toBe(false)
    })
  })

  describe('getNonce', () => {
    it('should fetch nonce from EntryPoint', async () => {
      mockPublicClient.readContract.mockResolvedValueOnce(5n)

      const nonce = await client.getNonce(TEST_SMART_ACCOUNT)

      expect(nonce).toBe(5n)
      // Verify readContract was called with getNonce function
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getNonce',
          args: [TEST_SMART_ACCOUNT, 0n],
        }),
      )
    })

    it('should support custom nonce key', async () => {
      mockPublicClient.readContract.mockResolvedValueOnce(10n)

      const nonce = await client.getNonce(TEST_SMART_ACCOUNT, 1n)

      expect(nonce).toBe(10n)
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getNonce',
          args: [TEST_SMART_ACCOUNT, 1n],
        }),
      )
    })
  })

  describe('getSmartAccountAddress', () => {
    it('should compute counterfactual address', async () => {
      mockPublicClient.readContract.mockResolvedValueOnce(TEST_SMART_ACCOUNT)

      const address = await client.getSmartAccountAddress(
        TEST_OWNER,
        0n,
        TEST_FACTORY,
      )

      expect(address).toBe(TEST_SMART_ACCOUNT)
      expect(mockPublicClient.readContract).toHaveBeenCalledWith({
        address: TEST_FACTORY,
        abi: expect.anything(),
        functionName: 'getAddress',
        args: [TEST_OWNER, 0n],
      })
    })

    it('should throw without factory address', async () => {
      await expect(
        client.getSmartAccountAddress(TEST_OWNER, 0n),
      ).rejects.toThrow('Factory address required')
    })
  })

  describe('getDeposit', () => {
    it('should fetch deposit balance from EntryPoint', async () => {
      const depositAmount = 1000000000000000000n // 1 ETH
      mockPublicClient.readContract.mockResolvedValueOnce(depositAmount)

      const deposit = await client.getDeposit(TEST_SMART_ACCOUNT)

      expect(deposit).toBe(depositAmount)
      // Verify readContract was called with balanceOf function
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'balanceOf',
          args: [TEST_SMART_ACCOUNT],
        }),
      )
    })

    it('should return 0 for account with no deposit', async () => {
      mockPublicClient.readContract.mockResolvedValueOnce(0n)

      const deposit = await client.getDeposit(TEST_SMART_ACCOUNT)

      expect(deposit).toBe(0n)
    })
  })

  describe('Factory function', () => {
    it('should create AAClient instance', () => {
      const aaClient = createAAClient({
        chainId: 8453,
        publicClient: mockPublicClient.client as PublicClient,
      })

      expect(aaClient).toBeInstanceOf(AAClient)
    })

    it('should accept custom bundler URL', () => {
      const customBundlerUrl = 'https://custom.bundler.com'
      const aaClient = createAAClient({
        chainId: 1,
        publicClient: mockPublicClient.client as PublicClient,
        bundlerUrl: customBundlerUrl,
      })

      expect(aaClient).toBeInstanceOf(AAClient)
    })

    it('should accept custom entry point address', () => {
      const customEntryPoint =
        '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address
      const aaClient = createAAClient({
        chainId: 1,
        publicClient: mockPublicClient.client as PublicClient,
        entryPointAddress: customEntryPoint,
      })

      expect(aaClient).toBeInstanceOf(AAClient)
    })
  })
})

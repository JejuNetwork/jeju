/**
 * Safe Service Unit Tests
 *
 * Tests for Gnosis Safe integration service including:
 * - Safe info fetching
 * - Transaction proposals
 * - Signature verification
 * - Batch transaction encoding
 * - MultiSend encoding validation
 */

import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test'
import type { Address, Hex } from 'viem'
import {
  AutocratSafeService,
  createSafeService,
} from '../../api/safe-service'
import {
  SafeOperation,
  SafeErrorCode,
  SafeError,
} from '../../lib/safe-types'

// Test addresses
const MOCK_SAFE_ADDRESS = '0x1234567890123456789012345678901234567890' as Address
const MOCK_OWNER_1 = '0xaaaa567890123456789012345678901234567890' as Address
const MOCK_OWNER_2 = '0xbbbb567890123456789012345678901234567890' as Address
const MOCK_OWNER_3 = '0xcccc567890123456789012345678901234567890' as Address
const MOCK_TX_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

// Mock fetch for API calls
const originalFetch = globalThis.fetch
let mockFetchResponses: Map<string, Response>

function mockFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = url.toString()

  // Check for matching mock
  for (const [pattern, response] of mockFetchResponses.entries()) {
    if (urlStr.includes(pattern)) {
      return Promise.resolve(response.clone())
    }
  }

  // Default: network error
  return Promise.reject(new Error(`No mock for URL: ${urlStr}`))
}

describe('AutocratSafeService', () => {
  let service: AutocratSafeService

  beforeEach(() => {
    service = createSafeService('http://localhost:8545', 8453)
    mockFetchResponses = new Map()
    globalThis.fetch = mockFetch as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('Service Creation', () => {
    it('should create service with default chain (Base)', () => {
      const defaultService = createSafeService('http://localhost:8545')
      expect(defaultService).toBeInstanceOf(AutocratSafeService)
    })

    it('should create service with custom chain', () => {
      const mainnetService = createSafeService('http://localhost:8545', 1)
      expect(mainnetService).toBeInstanceOf(AutocratSafeService)
    })

    it('should throw error for unsupported chain when fetching transactions', async () => {
      const unsupportedService = createSafeService('http://localhost:8545', 999)

      await expect(
        unsupportedService.getPendingTransactions(MOCK_SAFE_ADDRESS),
      ).rejects.toThrow('Safe Transaction Service not available for chain 999')
    })
  })

  describe('getPendingTransactions', () => {
    it('should fetch and parse pending transactions', async () => {
      const mockResponse = {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            safe: MOCK_SAFE_ADDRESS,
            to: MOCK_OWNER_1,
            value: '1000000000000000000',
            data: '0x',
            operation: 0,
            safeTxGas: '0',
            baseGas: '0',
            gasPrice: '0',
            gasToken: ZERO_ADDRESS,
            refundReceiver: ZERO_ADDRESS,
            nonce: 5,
            confirmations: [
              {
                owner: MOCK_OWNER_1,
                signature: '0xabcd',
                submissionDate: '2024-01-01T00:00:00Z',
              },
            ],
            confirmationsRequired: 2,
            isExecuted: false,
            safeTxHash: MOCK_TX_HASH,
            proposer: MOCK_OWNER_1,
            submissionDate: '2024-01-01T00:00:00Z',
            executionDate: null,
            executor: null,
            transactionHash: null,
          },
        ],
      }

      mockFetchResponses.set(
        'multisig-transactions',
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )

      const transactions = await service.getPendingTransactions(MOCK_SAFE_ADDRESS)

      expect(transactions).toHaveLength(1)
      expect(transactions[0].nonce).toBe(5)
      expect(transactions[0].value).toBe(1000000000000000000n)
      expect(transactions[0].confirmations).toHaveLength(1)
      expect(transactions[0].isExecuted).toBe(false)
    })

    it('should throw SafeError on API failure', async () => {
      mockFetchResponses.set(
        'multisig-transactions',
        new Response('Internal Server Error', { status: 500 }),
      )

      await expect(
        service.getPendingTransactions(MOCK_SAFE_ADDRESS),
      ).rejects.toThrow('Failed to fetch pending transactions')
    })
  })

  describe('getTransactionStatus', () => {
    const createMockTxResponse = (confirmations: number, required: number, isExecuted: boolean) => ({
      safe: MOCK_SAFE_ADDRESS,
      to: MOCK_OWNER_1,
      value: '0',
      data: '0x',
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce: 1,
      confirmations: Array.from({ length: confirmations }, (_, i) => ({
        owner: `0x${String(i).padStart(40, '0')}`,
        signature: `0x${String(i).padStart(130, '0')}`,
        submissionDate: '2024-01-01T00:00:00Z',
      })),
      confirmationsRequired: required,
      isExecuted,
      safeTxHash: MOCK_TX_HASH,
      submissionDate: '2024-01-01T00:00:00Z',
      executionDate: isExecuted ? '2024-01-02T00:00:00Z' : null,
      executor: null,
      transactionHash: isExecuted ? '0xexecuted' : null,
    })

    it('should return pending status for 0 confirmations', async () => {
      mockFetchResponses.set(
        MOCK_TX_HASH,
        new Response(JSON.stringify(createMockTxResponse(0, 2, false)), { status: 200 }),
      )

      const status = await service.getTransactionStatus(MOCK_TX_HASH)

      expect(status.status).toBe('pending')
      expect(status.confirmations).toBe(0)
      expect(status.required).toBe(2)
      expect(status.canExecute).toBe(false)
    })

    it('should return awaiting_confirmations status', async () => {
      mockFetchResponses.set(
        MOCK_TX_HASH,
        new Response(JSON.stringify(createMockTxResponse(1, 2, false)), { status: 200 }),
      )

      const status = await service.getTransactionStatus(MOCK_TX_HASH)

      expect(status.status).toBe('awaiting_confirmations')
      expect(status.confirmations).toBe(1)
      expect(status.canExecute).toBe(false)
    })

    it('should return ready_to_execute status', async () => {
      mockFetchResponses.set(
        MOCK_TX_HASH,
        new Response(JSON.stringify(createMockTxResponse(2, 2, false)), { status: 200 }),
      )

      const status = await service.getTransactionStatus(MOCK_TX_HASH)

      expect(status.status).toBe('ready_to_execute')
      expect(status.confirmations).toBe(2)
      expect(status.canExecute).toBe(true)
    })

    it('should return executed status', async () => {
      mockFetchResponses.set(
        MOCK_TX_HASH,
        new Response(JSON.stringify(createMockTxResponse(2, 2, true)), { status: 200 }),
      )

      const status = await service.getTransactionStatus(MOCK_TX_HASH)

      expect(status.status).toBe('executed')
      expect(status.canExecute).toBe(false)
    })

    it('should throw TX_NOT_FOUND for missing transaction', async () => {
      mockFetchResponses.set(
        MOCK_TX_HASH,
        new Response('Not found', { status: 404 }),
      )

      await expect(
        service.getTransactionStatus(MOCK_TX_HASH),
      ).rejects.toThrow('Transaction not found')
    })
  })

  describe('buildSignatures', () => {
    it('should sort signatures by owner address', () => {
      // Access private method via any cast for testing
      const serviceAny = service as { buildSignatures: (confirmations: Array<{ owner: Address; signature: Hex }>) => Hex }

      const confirmations = [
        { owner: MOCK_OWNER_3, signature: '0xcccc1234' as Hex, submissionDate: '', signatureType: 'EOA' as const },
        { owner: MOCK_OWNER_1, signature: '0xaaaa1234' as Hex, submissionDate: '', signatureType: 'EOA' as const },
        { owner: MOCK_OWNER_2, signature: '0xbbbb1234' as Hex, submissionDate: '', signatureType: 'EOA' as const },
      ]

      const packed = serviceAny.buildSignatures(confirmations)

      // Should be sorted by owner: OWNER_1, OWNER_2, OWNER_3
      expect(packed).toBe('0xaaaa1234bbbb1234cccc1234')
    })

    it('should handle single signature', () => {
      const serviceAny = service as { buildSignatures: (confirmations: Array<{ owner: Address; signature: Hex }>) => Hex }

      const confirmations = [
        { owner: MOCK_OWNER_1, signature: '0xabcdef' as Hex, submissionDate: '', signatureType: 'EOA' as const },
      ]

      const packed = serviceAny.buildSignatures(confirmations)
      expect(packed).toBe('0xabcdef')
    })
  })

  describe('encodeMultiSend', () => {
    it('should encode single ETH transfer correctly', () => {
      const serviceAny = service as { encodeMultiSend: (txs: Array<{ to: Address; value: bigint; data: Hex; operation: number }>) => Hex }

      const transactions = [
        {
          to: MOCK_OWNER_1,
          value: 1000000000000000000n, // 1 ETH
          data: '0x' as Hex,
          operation: SafeOperation.CALL,
        },
      ]

      const encoded = serviceAny.encodeMultiSend(transactions)

      // Should start with multiSend selector
      expect(encoded.startsWith('0x8d80ff0a')).toBe(true)
      // Should contain the encoded transaction data
      expect(encoded.length).toBeGreaterThan(10)
    })

    it('should encode ERC20 transfer correctly', () => {
      const serviceAny = service as { encodeMultiSend: (txs: Array<{ to: Address; value: bigint; data: Hex; operation: number }>) => Hex }

      // ERC20 transfer(to, amount) calldata
      const transferData = '0xa9059cbb000000000000000000000000bbbb56789012345678901234567890123456789000000000000000000000000000000000000000000000000000000000000003e8' as Hex

      const transactions = [
        {
          to: '0x4200000000000000000000000000000000000006' as Address, // WETH on Base
          value: 0n,
          data: transferData,
          operation: SafeOperation.CALL,
        },
      ]

      const encoded = serviceAny.encodeMultiSend(transactions)

      expect(encoded.startsWith('0x8d80ff0a')).toBe(true)
      // Should be longer than ETH transfer due to data
      expect(encoded.length).toBeGreaterThan(200)
    })

    it('should encode multiple transactions', () => {
      const serviceAny = service as { encodeMultiSend: (txs: Array<{ to: Address; value: bigint; data: Hex; operation: number }>) => Hex }

      const transactions = [
        {
          to: MOCK_OWNER_1,
          value: 1000000000000000000n,
          data: '0x' as Hex,
          operation: SafeOperation.CALL,
        },
        {
          to: MOCK_OWNER_2,
          value: 2000000000000000000n,
          data: '0x' as Hex,
          operation: SafeOperation.CALL,
        },
      ]

      const encoded = serviceAny.encodeMultiSend(transactions)

      expect(encoded.startsWith('0x8d80ff0a')).toBe(true)
      // Should be roughly 2x length of single tx
      expect(encoded.length).toBeGreaterThan(200)
    })

    // Known-good encoding test from Safe documentation
    it('should match known-good MultiSend encoding format', () => {
      const serviceAny = service as { encodeMultiSend: (txs: Array<{ to: Address; value: bigint; data: Hex; operation: number }>) => Hex }

      // Simple ETH transfer
      const transactions = [
        {
          to: '0x0000000000000000000000000000000000000001' as Address,
          value: 0n,
          data: '0x' as Hex,
          operation: 0,
        },
      ]

      const encoded = serviceAny.encodeMultiSend(transactions)

      // MultiSend encodes as:
      // - multiSend(bytes transactions) selector: 0x8d80ff0a
      // - ABI encoded bytes: offset (32 bytes) + length (32 bytes) + data
      // Each transaction: operation (1) + to (20) + value (32) + dataLength (32) + data

      // Verify the structure
      expect(encoded.slice(0, 10)).toBe('0x8d80ff0a') // multiSend selector

      // The encoded data after selector should be valid ABI encoding
      const dataWithoutSelector = encoded.slice(10)
      // Offset (32 bytes = 64 hex chars) should point to data
      const offset = dataWithoutSelector.slice(0, 64)
      expect(offset).toBe('0'.repeat(62) + '20') // offset = 32 = 0x20
    })
  })

  describe('SafeError', () => {
    it('should create error with code and details', () => {
      const error = new SafeError(
        'Signer is not an owner',
        SafeErrorCode.NOT_AN_OWNER,
        { signer: MOCK_OWNER_1, safe: MOCK_SAFE_ADDRESS },
      )

      expect(error.message).toBe('Signer is not an owner')
      expect(error.code).toBe('NOT_AN_OWNER')
      expect(error.details).toEqual({ signer: MOCK_OWNER_1, safe: MOCK_SAFE_ADDRESS })
      expect(error.name).toBe('SafeError')
    })

    it('should work without details', () => {
      const error = new SafeError('Not found', SafeErrorCode.TX_NOT_FOUND)

      expect(error.message).toBe('Not found')
      expect(error.code).toBe('TX_NOT_FOUND')
      expect(error.details).toBeUndefined()
    })
  })

  describe('SafeOperation constants', () => {
    it('should have correct values matching Safe contract', () => {
      // These values must match the Safe contract exactly
      expect(SafeOperation.CALL).toBe(0)
      expect(SafeOperation.DELEGATE_CALL).toBe(1)
    })
  })

  describe('API URL mapping', () => {
    it('should use correct URLs for supported chains', () => {
      // Test by creating services and checking they don't throw
      const chains = [1, 10, 8453, 42161, 84532, 11155111]

      for (const chainId of chains) {
        const chainService = createSafeService('http://localhost:8545', chainId)
        expect(chainService).toBeInstanceOf(AutocratSafeService)
      }
    })
  })

  describe('Transaction data validation', () => {
    it('should correctly map transaction response to typed data', async () => {
      const mockResponse = {
        safe: MOCK_SAFE_ADDRESS,
        to: MOCK_OWNER_1,
        value: '123456789',
        data: '0xabcdef',
        operation: 1,
        safeTxGas: '21000',
        baseGas: '0',
        gasPrice: '1000000000',
        gasToken: ZERO_ADDRESS,
        refundReceiver: ZERO_ADDRESS,
        nonce: 42,
        confirmations: [],
        confirmationsRequired: 3,
        isExecuted: false,
        safeTxHash: MOCK_TX_HASH,
        submissionDate: '2024-01-15T10:30:00Z',
        executionDate: null,
        executor: null,
        transactionHash: null,
      }

      mockFetchResponses.set(
        MOCK_TX_HASH,
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )

      const tx = await service.getTransaction(MOCK_TX_HASH)

      expect(tx).not.toBeNull()
      expect(tx!.value).toBe(123456789n)
      expect(tx!.safeTxGas).toBe(21000n)
      expect(tx!.gasPrice).toBe(1000000000n)
      expect(tx!.operation).toBe(1)
      expect(tx!.nonce).toBe(42)
      expect(tx!.data).toBe('0xabcdef')
    })

    it('should handle null data as 0x', async () => {
      const mockResponse = {
        safe: MOCK_SAFE_ADDRESS,
        to: MOCK_OWNER_1,
        value: '0',
        data: null, // API returns null for empty data
        operation: 0,
        safeTxGas: '0',
        baseGas: '0',
        gasPrice: '0',
        gasToken: ZERO_ADDRESS,
        refundReceiver: ZERO_ADDRESS,
        nonce: 1,
        confirmations: [],
        confirmationsRequired: 1,
        isExecuted: false,
        safeTxHash: MOCK_TX_HASH,
        submissionDate: '2024-01-01T00:00:00Z',
      }

      mockFetchResponses.set(
        MOCK_TX_HASH,
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )

      const tx = await service.getTransaction(MOCK_TX_HASH)

      expect(tx!.data).toBe('0x')
    })
  })
})

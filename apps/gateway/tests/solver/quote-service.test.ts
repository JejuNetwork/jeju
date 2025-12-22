/**
 * Tests for the real quote-service.ts
 * These tests exercise actual service logic with error-first behavior
 */
import { describe, expect, it } from 'bun:test'
import { getQuotes, type QuoteParams } from '../../src/services/quote-service'

describe('Quote Service (Real)', () => {
  const baseParams: QuoteParams = {
    sourceChain: 1,
    destinationChain: 42161,
    sourceToken: '0x0000000000000000000000000000000000000000',
    destinationToken: '0x0000000000000000000000000000000000000000',
    amount: '1000000000000000000', // 1 ETH
  }

  describe('getQuotes - No Solvers Available', () => {
    it('should throw when no active solvers available', async () => {
      await expect(getQuotes(baseParams)).rejects.toThrow()
    })

    it('should throw with descriptive error message', async () => {
      await expect(getQuotes(baseParams)).rejects.toThrow(/no.*solvers/i)
    })

    it('should include chain info in error message', async () => {
      await expect(getQuotes(baseParams)).rejects.toThrow(/chain/)
    })
  })

  describe('getQuotes - Different Chain Combinations', () => {
    it('should throw for L2-to-L2 routes when no solvers', async () => {
      const l2Params: QuoteParams = {
        ...baseParams,
        sourceChain: 10, // Optimism
        destinationChain: 42161, // Arbitrum
      }

      await expect(getQuotes(l2Params)).rejects.toThrow(/no.*solvers/i)
    })

    it('should throw for L1-to-L2 routes when no solvers', async () => {
      const l1Params: QuoteParams = {
        ...baseParams,
        sourceChain: 1, // Ethereum
        destinationChain: 42161, // Arbitrum
      }

      await expect(getQuotes(l1Params)).rejects.toThrow(/no.*solvers/i)
    })

    it('should throw for Base to Optimism when no solvers', async () => {
      const params: QuoteParams = {
        ...baseParams,
        sourceChain: 8453, // Base
        destinationChain: 10, // Optimism
      }

      await expect(getQuotes(params)).rejects.toThrow(/no.*solvers/i)
    })
  })

  describe('getQuotes - Amount Validation', () => {
    it('should throw for very small amounts when no solvers', async () => {
      const smallParams: QuoteParams = {
        ...baseParams,
        amount: '1000', // 1000 wei
      }

      await expect(getQuotes(smallParams)).rejects.toThrow(/no.*solvers/i)
    })

    it('should throw for very large amounts when no solvers', async () => {
      const largeParams: QuoteParams = {
        ...baseParams,
        amount: '1000000000000000000000', // 1000 ETH
      }

      await expect(getQuotes(largeParams)).rejects.toThrow(/no.*solvers/i)
    })

    it('should throw for 1 wei when no solvers', async () => {
      const params: QuoteParams = {
        ...baseParams,
        amount: '1',
      }

      await expect(getQuotes(params)).rejects.toThrow(/no.*solvers/i)
    })
  })

  describe('getQuotes - Consistent Error Behavior', () => {
    it('should throw consistently for repeated calls', async () => {
      await expect(getQuotes(baseParams)).rejects.toThrow()
      await expect(getQuotes(baseParams)).rejects.toThrow()
      await expect(getQuotes(baseParams)).rejects.toThrow()
    })

    it('should throw same error type for different chains', async () => {
      const params1: QuoteParams = { ...baseParams, sourceChain: 1 }
      const params2: QuoteParams = { ...baseParams, sourceChain: 10 }
      const params3: QuoteParams = { ...baseParams, sourceChain: 8453 }

      await expect(getQuotes(params1)).rejects.toThrow(/no.*solvers/i)
      await expect(getQuotes(params2)).rejects.toThrow(/no.*solvers/i)
      await expect(getQuotes(params3)).rejects.toThrow(/no.*solvers/i)
    })
  })
})

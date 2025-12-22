/**
 * Tests for swap business logic
 */

import { describe, expect, it } from 'bun:test'
import { parseEther } from 'viem'
import {
  BASE_NETWORK_FEE,
  CROSS_CHAIN_PREMIUM,
  calculateOutputAmount,
  calculateSwapFees,
  DEFAULT_FEE_BPS,
  formatRate,
  formatSwapAmount,
  generateSwapQuote,
  getExchangeRate,
  getSwapButtonText,
  getTokenByAddress,
  getTokenBySymbol,
  isCrossChain,
  isSwapButtonDisabled,
  PRICE_PAIRS,
  parseSwapAmount,
  SWAP_TOKENS,
  validateSwap,
  XLP_FEE_BPS,
} from '../swap'

describe('swap lib', () => {
  describe('constants', () => {
    it('has required swap tokens', () => {
      expect(SWAP_TOKENS.length).toBeGreaterThanOrEqual(3)
      expect(getTokenBySymbol('ETH')).toBeDefined()
      expect(getTokenBySymbol('USDC')).toBeDefined()
      expect(getTokenBySymbol('JEJU')).toBeDefined()
    })

    it('has ETH/USDC price pair', () => {
      const pair = PRICE_PAIRS.find(
        (p) => p.baseToken === 'ETH' && p.quoteToken === 'USDC',
      )
      expect(pair).toBeDefined()
      expect(pair?.rate).toBe(3000)
    })

    it('has correct fee constants', () => {
      expect(DEFAULT_FEE_BPS).toBe(30n)
      expect(XLP_FEE_BPS).toBe(5n)
      expect(BASE_NETWORK_FEE).toBe(parseEther('0.001'))
      expect(CROSS_CHAIN_PREMIUM).toBe(parseEther('0.0005'))
    })
  })

  describe('getTokenBySymbol', () => {
    it('finds ETH token', () => {
      const token = getTokenBySymbol('ETH')
      expect(token).toBeDefined()
      expect(token?.symbol).toBe('ETH')
      expect(token?.address).toBe('0x0000000000000000000000000000000000000000')
    })

    it('returns undefined for unknown token', () => {
      const token = getTokenBySymbol('UNKNOWN')
      expect(token).toBeUndefined()
    })
  })

  describe('getTokenByAddress', () => {
    it('finds token by address', () => {
      const token = getTokenByAddress(
        '0x0000000000000000000000000000000000000000',
      )
      expect(token?.symbol).toBe('ETH')
    })

    it('handles case insensitive address', () => {
      const token = getTokenByAddress(
        '0x0000000000000000000000000000000000000001',
      )
      expect(token?.symbol).toBe('USDC')
    })

    it('returns undefined for unknown address', () => {
      const token = getTokenByAddress(
        '0xdead000000000000000000000000000000000000',
      )
      expect(token).toBeUndefined()
    })
  })

  describe('getExchangeRate', () => {
    it('returns 1 for same token', () => {
      expect(getExchangeRate('ETH', 'ETH')).toBe(1)
    })

    it('returns correct rate for ETH/USDC', () => {
      expect(getExchangeRate('ETH', 'USDC')).toBe(3000)
    })

    it('returns inverse rate for USDC/ETH', () => {
      const rate = getExchangeRate('USDC', 'ETH')
      expect(rate).toBeCloseTo(1 / 3000, 10)
    })

    it('returns 1 for unknown pair', () => {
      expect(getExchangeRate('UNKNOWN', 'OTHER')).toBe(1)
    })
  })

  describe('formatRate', () => {
    it('formats rate >= 1', () => {
      const display = formatRate('ETH', 'USDC', 3000)
      expect(display).toContain('1 ETH')
      expect(display).toContain('3,000')
      expect(display).toContain('USDC')
    })

    it('formats rate < 1 as inverse', () => {
      const display = formatRate('USDC', 'ETH', 1 / 3000)
      expect(display).toContain('1 ETH')
      expect(display).toContain('USDC')
    })
  })

  describe('isCrossChain', () => {
    it('returns false for same chain', () => {
      expect(isCrossChain(1, 1)).toBe(false)
      expect(isCrossChain(420690, 420690)).toBe(false)
    })

    it('returns true for different chains', () => {
      expect(isCrossChain(1, 42161)).toBe(true)
      expect(isCrossChain(420690, 420691)).toBe(true)
    })
  })

  describe('calculateSwapFees', () => {
    it('calculates fees for same-chain swap', () => {
      const amount = parseEther('1')
      const fees = calculateSwapFees(amount, 1, 1)

      expect(fees.networkFee).toBe(BASE_NETWORK_FEE)
      expect(fees.xlpFee).toBe((amount * 5n) / 10000n)
      expect(fees.totalFee).toBe(fees.networkFee + fees.xlpFee)
      expect(fees.estimatedTime).toBe(0)
    })

    it('calculates fees for cross-chain swap', () => {
      const amount = parseEther('1')
      const fees = calculateSwapFees(amount, 1, 42161)

      expect(fees.networkFee).toBe(BASE_NETWORK_FEE + CROSS_CHAIN_PREMIUM)
      expect(fees.estimatedTime).toBe(10)
    })

    it('handles zero amount', () => {
      const fees = calculateSwapFees(0n, 1, 1)
      expect(fees.xlpFee).toBe(0n)
      expect(fees.networkFee).toBe(BASE_NETWORK_FEE)
    })
  })

  describe('calculateOutputAmount', () => {
    it('returns 0 for zero input', () => {
      const fees = calculateSwapFees(0n, 1, 1)
      const output = calculateOutputAmount(0n, 'ETH', 'USDC', fees)
      expect(output).toBe(0n)
    })

    it('calculates output for ETH to USDC', () => {
      const input = parseEther('1')
      const fees = calculateSwapFees(input, 1, 1)
      const output = calculateOutputAmount(input, 'ETH', 'USDC', fees)

      // Output should be positive and less than input * rate (due to fees)
      expect(output).toBeGreaterThan(0n)
      expect(output).toBeLessThan(parseEther('3000'))
    })

    it('calculates output for same token (1:1)', () => {
      const input = parseEther('1')
      const fees = calculateSwapFees(input, 1, 1)
      const output = calculateOutputAmount(input, 'ETH', 'ETH', fees)

      // Should be slightly less than input due to fees
      expect(output).toBeGreaterThan(0n)
      expect(output).toBeLessThan(input)
    })

    it('returns 0 when fees exceed amount', () => {
      const input = parseEther('0.0001') // Very small amount
      const fees = calculateSwapFees(input, 1, 42161) // Cross-chain for higher fees
      const output = calculateOutputAmount(input, 'ETH', 'USDC', fees)

      expect(output).toBe(0n)
    })
  })

  describe('generateSwapQuote', () => {
    it('generates complete quote', () => {
      const input = parseEther('1')
      const quote = generateSwapQuote(input, 'ETH', 'USDC', 1, 1)

      expect(quote.inputAmount).toBe(input)
      expect(quote.outputAmount).toBeGreaterThan(0n)
      expect(quote.rate).toBe(3000)
      expect(quote.rateDisplay).toContain('ETH')
      expect(quote.feePercent).toBe(0.3)
      expect(quote.isCrossChain).toBe(false)
    })

    it('marks cross-chain quotes correctly', () => {
      const input = parseEther('1')
      const quote = generateSwapQuote(input, 'ETH', 'USDC', 1, 42161)

      expect(quote.isCrossChain).toBe(true)
      expect(quote.fees.estimatedTime).toBe(10)
    })
  })

  describe('validateSwap', () => {
    it('rejects disconnected wallet', () => {
      const result = validateSwap(false, '1', 'ETH', 'USDC', 1, 1, true, true)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Connect your wallet first')
    })

    it('rejects empty amount', () => {
      const result = validateSwap(true, '', 'ETH', 'USDC', 1, 1, true, true)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Enter an amount')
    })

    it('rejects zero amount', () => {
      const result = validateSwap(true, '0', 'ETH', 'USDC', 1, 1, true, true)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Enter an amount')
    })

    it('rejects same token on same chain', () => {
      const result = validateSwap(true, '1', 'ETH', 'ETH', 1, 1, true, true)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Select different tokens')
    })

    it('allows same token cross-chain', () => {
      const result = validateSwap(true, '1', 'ETH', 'ETH', 1, 42161, true, true)
      expect(result.valid).toBe(true)
    })

    it('rejects cross-chain without EIL', () => {
      const result = validateSwap(
        true,
        '1',
        'ETH',
        'USDC',
        1,
        42161,
        true,
        false,
      )
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Cross-chain swaps not available yet')
    })

    it('rejects same-chain on wrong network', () => {
      const result = validateSwap(true, '1', 'ETH', 'USDC', 1, 1, false, true)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Switch to the correct network')
    })

    it('accepts valid same-chain swap', () => {
      const result = validateSwap(true, '1', 'ETH', 'USDC', 1, 1, true, true)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('accepts valid cross-chain swap', () => {
      const result = validateSwap(
        true,
        '1',
        'ETH',
        'USDC',
        1,
        42161,
        true,
        true,
      )
      expect(result.valid).toBe(true)
    })
  })

  describe('parseSwapAmount', () => {
    it('parses valid amount', () => {
      expect(parseSwapAmount('1')).toBe(parseEther('1'))
      expect(parseSwapAmount('0.5')).toBe(parseEther('0.5'))
    })

    it('returns 0 for empty string', () => {
      expect(parseSwapAmount('')).toBe(0n)
    })

    it('returns 0 for invalid input', () => {
      expect(parseSwapAmount('abc')).toBe(0n)
      expect(parseSwapAmount('-1')).toBe(0n)
      expect(parseSwapAmount('0')).toBe(0n)
    })
  })

  describe('formatSwapAmount', () => {
    it('formats positive amount', () => {
      const amount = parseEther('1')
      expect(formatSwapAmount(amount)).toBe('1')
    })

    it('returns empty for zero', () => {
      expect(formatSwapAmount(0n)).toBe('')
    })

    it('returns empty for negative', () => {
      expect(formatSwapAmount(-1n)).toBe('')
    })
  })

  describe('getSwapButtonText', () => {
    it('shows Connect Wallet when disconnected', () => {
      expect(
        getSwapButtonText(false, false, true, true, false, 'Arbitrum'),
      ).toBe('Connect Wallet')
    })

    it('shows Swapping when in progress', () => {
      expect(getSwapButtonText(true, true, true, true, false, 'Arbitrum')).toBe(
        'Swapping...',
      )
    })

    it('shows Enter Amount when no input', () => {
      expect(
        getSwapButtonText(true, false, true, false, false, 'Arbitrum'),
      ).toBe('Enter Amount')
    })

    it('shows cross-chain destination', () => {
      expect(getSwapButtonText(true, false, true, true, true, 'Arbitrum')).toBe(
        'Swap to Arbitrum',
      )
    })

    it('shows Switch Network when wrong chain', () => {
      expect(
        getSwapButtonText(true, false, false, true, false, 'Arbitrum'),
      ).toBe('Switch Network')
    })

    it('shows Swap for valid state', () => {
      expect(
        getSwapButtonText(true, false, true, true, false, 'Arbitrum'),
      ).toBe('Swap')
    })
  })

  describe('isSwapButtonDisabled', () => {
    it('disabled when disconnected', () => {
      expect(isSwapButtonDisabled(false, false, true, true, false)).toBe(true)
    })

    it('disabled when swapping', () => {
      expect(isSwapButtonDisabled(true, true, true, true, false)).toBe(true)
    })

    it('disabled when no input', () => {
      expect(isSwapButtonDisabled(true, false, true, false, false)).toBe(true)
    })

    it('disabled on wrong chain for same-chain swap', () => {
      expect(isSwapButtonDisabled(true, false, false, true, false)).toBe(true)
    })

    it('enabled for valid cross-chain swap (wrong chain ok)', () => {
      expect(isSwapButtonDisabled(true, false, false, true, true)).toBe(false)
    })

    it('enabled for valid same-chain swap', () => {
      expect(isSwapButtonDisabled(true, false, true, true, false)).toBe(false)
    })
  })
})

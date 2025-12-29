/**
 * Tests for cross-chain swap integration pure functions
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import {
  CROSS_CHAIN_TOKENS,
  calculateMinOutput,
  formatCrossChainAmount,
  getChainInfo,
  getTokenAddress,
  isSolanaChain,
  isTokenSupported,
  SOLANA_CHAINS,
  SUPPORTED_CHAINS,
} from '../crosschain'

describe('Cross-chain Constants', () => {
  test('SUPPORTED_CHAINS includes expected networks', () => {
    expect(SUPPORTED_CHAINS.length).toBeGreaterThanOrEqual(4)

    const chainIds = SUPPORTED_CHAINS.map((c) => c.chainId)
    expect(chainIds).toContain(1) // Ethereum
    expect(chainIds).toContain(42161) // Arbitrum
    expect(chainIds).toContain(10) // Optimism
  })

  test('SOLANA_CHAINS contains Solana network IDs', () => {
    expect(SOLANA_CHAINS).toContain(101)
    expect(SOLANA_CHAINS).toContain(102)
    expect(SOLANA_CHAINS.length).toBe(2)
  })

  test('CROSS_CHAIN_TOKENS has entries for major chains', () => {
    expect(CROSS_CHAIN_TOKENS[1]).toBeDefined() // Ethereum
    expect(CROSS_CHAIN_TOKENS[42161]).toBeDefined() // Arbitrum
    expect(CROSS_CHAIN_TOKENS[10]).toBeDefined() // Optimism
  })
})

describe('isSolanaChain', () => {
  test('returns true for Solana mainnet', () => {
    expect(isSolanaChain(101)).toBe(true)
  })

  test('returns true for Solana devnet', () => {
    expect(isSolanaChain(102)).toBe(true)
  })

  test('returns false for Ethereum', () => {
    expect(isSolanaChain(1)).toBe(false)
  })

  test('returns false for Arbitrum', () => {
    expect(isSolanaChain(42161)).toBe(false)
  })

  test('returns false for unknown chain', () => {
    expect(isSolanaChain(999999)).toBe(false)
  })
})

describe('getChainInfo', () => {
  test('returns info for Ethereum', () => {
    const info = getChainInfo(1)
    expect(info).toBeDefined()
    expect(info?.name).toBe('Ethereum')
    expect(info?.chainId).toBe(1)
  })

  test('returns info for Arbitrum', () => {
    const info = getChainInfo(42161)
    expect(info).toBeDefined()
    expect(info?.name).toBe('Arbitrum')
  })

  test('returns info for Optimism', () => {
    const info = getChainInfo(10)
    expect(info).toBeDefined()
    expect(info?.name).toBe('Optimism')
  })

  test('returns undefined for unknown chain', () => {
    const info = getChainInfo(999999)
    expect(info).toBeUndefined()
  })

  test('Solana chains have isSolana flag', () => {
    const solanaMain = getChainInfo(101)
    const solanaDevnet = getChainInfo(102)

    expect(solanaMain?.isSolana).toBe(true)
    expect(solanaDevnet?.isSolana).toBe(true)
  })
})

describe('getTokenAddress', () => {
  test('returns ETH address on Ethereum', () => {
    const addr = getTokenAddress(1, 'ETH')
    expect(addr).toBe('0x0000000000000000000000000000000000000000')
  })

  test('returns USDC address on Ethereum', () => {
    const addr = getTokenAddress(1, 'USDC')
    expect(addr).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
  })

  test('returns WETH address on Arbitrum', () => {
    const addr = getTokenAddress(42161, 'WETH')
    expect(addr).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1')
  })

  test('returns undefined for unsupported token', () => {
    const addr = getTokenAddress(1, 'FAKE_TOKEN')
    expect(addr).toBeUndefined()
  })

  test('returns undefined for unsupported chain', () => {
    const addr = getTokenAddress(999999, 'ETH')
    expect(addr).toBeUndefined()
  })
})

describe('isTokenSupported', () => {
  const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
  const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
  const FAKE_TOKEN = '0xDEADBEEF00000000000000000000000000000000' as Address

  test('returns true for ETH on Ethereum', () => {
    expect(isTokenSupported(1, ETH_ADDRESS)).toBe(true)
  })

  test('returns true for USDC on Ethereum', () => {
    expect(isTokenSupported(1, USDC_ETH)).toBe(true)
  })

  test('returns false for fake token', () => {
    expect(isTokenSupported(1, FAKE_TOKEN)).toBe(false)
  })

  test('returns false for unsupported chain', () => {
    expect(isTokenSupported(999999, ETH_ADDRESS)).toBe(false)
  })
})

describe('formatCrossChainAmount', () => {
  test('formats millions correctly', () => {
    const amount = '5000000000000000000000000' // 5M with 18 decimals
    expect(formatCrossChainAmount(amount, 18)).toBe('5.00M')
  })

  test('formats thousands correctly', () => {
    const amount = '50000000000000000000000' // 50K with 18 decimals
    expect(formatCrossChainAmount(amount, 18)).toBe('50.00K')
  })

  test('formats regular amounts correctly', () => {
    const amount = '1500000000000000000' // 1.5 with 18 decimals
    expect(formatCrossChainAmount(amount, 18)).toBe('1.5000')
  })

  test('formats small amounts correctly', () => {
    const amount = '500000000000000' // 0.0005 with 18 decimals
    expect(formatCrossChainAmount(amount, 18)).toBe('0.000500')
  })

  test('handles 6 decimal tokens (USDC)', () => {
    const amount = '1000000' // 1 USDC
    expect(formatCrossChainAmount(amount, 6)).toBe('1.0000')
  })

  test('handles large USDC amounts', () => {
    const amount = '5000000000000' // 5M USDC
    expect(formatCrossChainAmount(amount, 6)).toBe('5.00M')
  })

  test('uses 18 decimals by default', () => {
    const amount = '1000000000000000000' // 1 ETH
    expect(formatCrossChainAmount(amount)).toBe('1.0000')
  })
})

describe('calculateMinOutput', () => {
  test('calculates min output with 50 bps (0.5%) slippage', () => {
    const output = '1000000000000000000' // 1 ETH
    const minOutput = calculateMinOutput(output, 50)
    // 1 ETH - 0.5% = 0.995 ETH
    expect(minOutput).toBe('995000000000000000')
  })

  test('calculates min output with 100 bps (1%) slippage', () => {
    const output = '1000000000000000000' // 1 ETH
    const minOutput = calculateMinOutput(output, 100)
    // 1 ETH - 1% = 0.99 ETH
    expect(minOutput).toBe('990000000000000000')
  })

  test('calculates min output with 0 slippage', () => {
    const output = '1000000000000000000'
    const minOutput = calculateMinOutput(output, 0)
    expect(minOutput).toBe('1000000000000000000')
  })

  test('handles large amounts correctly', () => {
    const output = '1000000000000000000000000' // 1M ETH
    const minOutput = calculateMinOutput(output, 50)
    // 1M ETH - 0.5% = 995K ETH
    expect(minOutput).toBe('995000000000000000000000')
  })

  test('handles small amounts with precision', () => {
    const output = '1000' // 1000 wei
    const minOutput = calculateMinOutput(output, 50)
    // 1000 - 0.5% = 995
    expect(minOutput).toBe('995')
  })

  test('rounds down on fractional results', () => {
    const output = '999' // 999 wei
    const minOutput = calculateMinOutput(output, 50)
    // 999 * 9950 / 10000 = 994.005 -> rounds down to 994
    expect(minOutput).toBe('994')
  })

  test('handles max slippage (100%)', () => {
    const output = '1000000000000000000'
    const minOutput = calculateMinOutput(output, 10000) // 100%
    expect(minOutput).toBe('0')
  })
})

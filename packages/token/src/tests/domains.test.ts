/**
 * @fileoverview Comprehensive tests for domain ID mappings
 * Tests boundary conditions, error handling, and data integrity
 */

import { describe, expect, test } from 'bun:test'
import { ALL_CHAINS, MAINNET_CHAINS, TESTNET_CHAINS } from '../config/chains'
import { CHAIN_TO_DOMAIN, getDomainId } from '../config/domains'
import type { ChainId } from '../types'

describe('Domain ID Mapping - Data Integrity', () => {
  test('every chain in ALL_CHAINS has a domain mapping', () => {
    for (const chain of ALL_CHAINS) {
      const domain = CHAIN_TO_DOMAIN[chain.chainId]
      expect(domain).toBeDefined()
      expect(typeof domain).toBe('number')
    }
  })

  test('domain IDs are unique across all chains', () => {
    const domains = Object.values(CHAIN_TO_DOMAIN)
    const uniqueDomains = new Set(domains)
    expect(uniqueDomains.size).toBe(domains.length)
  })

  test('EVM chain IDs equal their domain IDs', () => {
    const evmChains = ALL_CHAINS.filter((c) => c.chainType === 'evm')
    for (const chain of evmChains) {
      // EVM chains have numeric chainIds by definition
      if (typeof chain.chainId !== 'number') continue
      expect(CHAIN_TO_DOMAIN[chain.chainId]).toBe(chain.chainId)
    }
  })

  test('Solana domain IDs are in expected range', () => {
    // Solana domains are 32-bit representations
    const solanaMainnet = CHAIN_TO_DOMAIN['solana-mainnet']
    const solanaDevnet = CHAIN_TO_DOMAIN['solana-devnet']

    expect(solanaMainnet).toBeGreaterThan(1_000_000_000)
    expect(solanaDevnet).toBeGreaterThan(1_000_000_000)
    expect(solanaMainnet).not.toBe(solanaDevnet)
  })
})

describe('getDomainId - Error Handling', () => {
  test('throws for undefined chain ID', () => {
    expect(() => getDomainId(undefined as unknown as ChainId)).toThrow()
  })

  test('throws for null chain ID', () => {
    expect(() => getDomainId(null as unknown as ChainId)).toThrow()
  })

  test('throws for negative chain ID', () => {
    expect(() => getDomainId(-1 as ChainId)).toThrow('Unknown domain')
  })

  test('throws for zero chain ID', () => {
    expect(() => getDomainId(0 as ChainId)).toThrow('Unknown domain')
  })

  test('throws for very large chain ID', () => {
    expect(() => getDomainId(Number.MAX_SAFE_INTEGER as ChainId)).toThrow(
      'Unknown domain',
    )
  })

  test('throws for string that is not a valid SVM chain', () => {
    expect(() => getDomainId('invalid-chain' as ChainId)).toThrow(
      'Unknown domain',
    )
  })

  test('throws for empty string', () => {
    expect(() => getDomainId('' as ChainId)).toThrow('Unknown domain')
  })
})

describe('getDomainId - Valid Inputs', () => {
  test('returns correct domain for all mainnet EVM chains', () => {
    const evmMainnets = MAINNET_CHAINS.filter((c) => c.chainType === 'evm')
    for (const chain of evmMainnets) {
      // EVM chains have numeric chainIds by definition
      if (typeof chain.chainId !== 'number') continue
      const domain = getDomainId(chain.chainId)
      // EVM chain IDs equal domain IDs
      expect(domain).toBe(chain.chainId)
    }
  })

  test('returns correct domain for all testnet chains', () => {
    for (const chain of TESTNET_CHAINS) {
      const domain = getDomainId(chain.chainId)
      expect(typeof domain).toBe('number')
      expect(domain).toBeGreaterThan(0)
    }
  })

  test('returns stable values across multiple calls', () => {
    const chainIds: ChainId[] = [1, 8453, 42161, 'solana-mainnet']
    for (const chainId of chainIds) {
      const domain1 = getDomainId(chainId)
      const domain2 = getDomainId(chainId)
      const domain3 = getDomainId(chainId)
      expect(domain1).toBe(domain2)
      expect(domain2).toBe(domain3)
    }
  })
})

describe('Domain Mapping - Boundary Conditions', () => {
  test('smallest EVM chain ID (Ethereum mainnet)', () => {
    const domain = getDomainId(1)
    expect(domain).toBe(1)
  })

  test('largest testnet chain ID', () => {
    // Arbitrum Sepolia has the largest testnet ID
    const domain = getDomainId(421614)
    expect(domain).toBe(421614)
  })

  test('L2 chains have valid domains', () => {
    // L2 EVM chain IDs (numeric literals)
    const l2ChainIds = [10, 8453, 42161] as const // Optimism, Base, Arbitrum
    for (const chainId of l2ChainIds) {
      const domain = getDomainId(chainId)
      // Domain should equal chain ID for EVM chains
      expect(domain).toBe(chainId)
    }
  })

  test('alt-L1 chains have valid domains', () => {
    // Alt-L1 EVM chain IDs (numeric literals)
    const altL1ChainIds = [56, 137, 43114] as const // BSC, Polygon, Avalanche
    for (const chainId of altL1ChainIds) {
      const domain = getDomainId(chainId)
      // Domain should equal chain ID for EVM chains
      expect(domain).toBe(chainId)
    }
  })
})

describe('Hyperlane Domain ID Specification', () => {
  /**
   * Hyperlane uses domain IDs that typically match chain IDs for EVM,
   * but Solana uses a special 32-bit domain derived from chain name
   */
  test('Solana mainnet domain matches Hyperlane spec', () => {
    // This is the official Hyperlane domain ID for Solana mainnet
    expect(getDomainId('solana-mainnet')).toBe(1399811149)
  })

  test('Solana devnet domain matches Hyperlane spec', () => {
    // This is the official Hyperlane domain ID for Solana devnet
    expect(getDomainId('solana-devnet')).toBe(1399811150)
  })
})

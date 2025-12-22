/**
 * @fileoverview Comprehensive tests for chain configuration
 * Tests data integrity, validation, and edge cases
 */

import { describe, expect, test } from 'bun:test'
import {
  ALL_CHAINS,
  getChainConfig,
  getEVMChains,
  getHomeChain,
  getSolanaChains,
  MAINNET_CHAINS,
  TESTNET_CHAINS,
  validateChainConfig,
} from '../config/chains'
import type { ChainId } from '../types'

describe('Chain Registry - Data Integrity', () => {
  test('ALL_CHAINS contains all mainnet and testnet chains', () => {
    const expected = MAINNET_CHAINS.length + TESTNET_CHAINS.length
    expect(ALL_CHAINS.length).toBe(expected)
  })

  test('no duplicate chain IDs in ALL_CHAINS', () => {
    const chainIds = ALL_CHAINS.map((c) => c.chainId)
    const uniqueIds = new Set(chainIds)
    expect(uniqueIds.size).toBe(chainIds.length)
  })

  test('no duplicate chain names in ALL_CHAINS', () => {
    const names = ALL_CHAINS.map((c) => c.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })

  test('exactly one home chain in mainnet', () => {
    const homeChains = MAINNET_CHAINS.filter((c) => c.isHomeChain)
    expect(homeChains.length).toBe(1)
    expect(homeChains[0].chainId).toBe(1)
  })

  test('exactly one home chain in testnet', () => {
    const homeChains = TESTNET_CHAINS.filter((c) => c.isHomeChain)
    expect(homeChains.length).toBe(1)
  })
})

describe('Chain Configuration - Required Fields', () => {
  test('all chains have required fields', () => {
    for (const chain of ALL_CHAINS) {
      expect(chain.chainId).toBeDefined()
      expect(chain.chainType).toBeDefined()
      expect(chain.name).toBeDefined()
      expect(chain.rpcUrl).toBeDefined()
      expect(chain.blockExplorerUrl).toBeDefined()
      expect(chain.nativeCurrency).toBeDefined()
      expect(chain.hyperlaneMailbox).toBeDefined()
      expect(chain.hyperlaneIgp).toBeDefined()
      expect(typeof chain.isHomeChain).toBe('boolean')
      expect(typeof chain.avgBlockTime).toBe('number')
    }
  })

  test('all native currencies have required fields', () => {
    for (const chain of ALL_CHAINS) {
      expect(chain.nativeCurrency.name).toBeDefined()
      expect(chain.nativeCurrency.symbol).toBeDefined()
      expect(typeof chain.nativeCurrency.decimals).toBe('number')
    }
  })

  test('native currency decimals are reasonable', () => {
    for (const chain of ALL_CHAINS) {
      expect(chain.nativeCurrency.decimals).toBeGreaterThanOrEqual(6)
      expect(chain.nativeCurrency.decimals).toBeLessThanOrEqual(18)
    }
  })
})

describe('EVM Chains - Specific Validation', () => {
  const evmChains = ALL_CHAINS.filter((c) => c.chainType === 'evm')

  test('EVM chain IDs are positive integers', () => {
    for (const chain of evmChains) {
      expect(typeof chain.chainId).toBe('number')
      expect(chain.chainId).toBeGreaterThan(0)
      expect(Number.isInteger(chain.chainId)).toBe(true)
    }
  })

  test('EVM hyperlane addresses are valid format', () => {
    for (const chain of evmChains) {
      // Skip chains without Hyperlane configured (e.g., Jeju testnet)
      if (!chain.hyperlaneMailbox) continue

      expect(chain.hyperlaneMailbox.startsWith('0x')).toBe(true)
      expect(chain.hyperlaneMailbox.length).toBe(42)
      expect(chain.hyperlaneIgp.startsWith('0x')).toBe(true)
      expect(chain.hyperlaneIgp.length).toBe(42)
    }
  })

  test('EVM RPC URLs are valid URLs', () => {
    for (const chain of evmChains) {
      expect(
        chain.rpcUrl.startsWith('http://') ||
          chain.rpcUrl.startsWith('https://'),
      ).toBe(true)
    }
  })

  test('EVM block explorers are valid URLs', () => {
    for (const chain of evmChains) {
      expect(chain.blockExplorerUrl.startsWith('https://')).toBe(true)
    }
  })

  test('average block times are reasonable', () => {
    for (const chain of evmChains) {
      // Block times should be between 0.1s and 15s
      expect(chain.avgBlockTime).toBeGreaterThanOrEqual(0.1)
      expect(chain.avgBlockTime).toBeLessThanOrEqual(15)
    }
  })
})

describe('Solana Chains - Specific Validation', () => {
  const solanaChains = ALL_CHAINS.filter((c) => c.chainType === 'solana')

  test('Solana chains have string chain IDs', () => {
    for (const chain of solanaChains) {
      expect(typeof chain.chainId).toBe('string')
    }
  })

  test('Solana chains have 9 decimal native currency', () => {
    for (const chain of solanaChains) {
      expect(chain.nativeCurrency.decimals).toBe(9)
      expect(chain.nativeCurrency.symbol).toBe('SOL')
    }
  })

  test('Solana has faster block times than Ethereum', () => {
    const ethereum = getChainConfig(1)
    const solana = getChainConfig('solana-mainnet')
    expect(solana.avgBlockTime).toBeLessThan(ethereum.avgBlockTime)
  })
})

describe('getChainConfig - Error Handling', () => {
  test('throws for unknown numeric chain ID', () => {
    expect(() => getChainConfig(999999 as ChainId)).toThrow('Unknown chain ID')
  })

  test('throws for unknown string chain ID', () => {
    expect(() => getChainConfig('unknown-chain' as ChainId)).toThrow(
      'Unknown chain ID',
    )
  })

  test('returns correct config for valid IDs', () => {
    const ethereum = getChainConfig(1)
    expect(ethereum.name).toBe('Ethereum Mainnet')

    const solana = getChainConfig('solana-mainnet')
    expect(solana.name).toBe('Solana Mainnet')
  })
})

describe('getEVMChains - Filtering', () => {
  test('mainnetOnly=true returns only mainnet EVM chains', () => {
    const chains = getEVMChains(true)
    for (const chain of chains) {
      expect(chain.chainType).toBe('evm')
      expect(MAINNET_CHAINS).toContain(chain)
    }
  })

  test('mainnetOnly=false returns all EVM chains', () => {
    const chains = getEVMChains(false)
    const allEvmCount = ALL_CHAINS.filter((c) => c.chainType === 'evm').length
    expect(chains.length).toBe(allEvmCount)
  })

  test('no Solana chains in results', () => {
    const mainnetChains = getEVMChains(true)
    const allChains = getEVMChains(false)
    for (const chain of [...mainnetChains, ...allChains]) {
      expect(chain.chainType).not.toBe('solana')
    }
  })
})

describe('getSolanaChains - Filtering', () => {
  test('mainnetOnly=true returns only mainnet Solana chains', () => {
    const chains = getSolanaChains(true)
    for (const chain of chains) {
      expect(chain.chainType).toBe('solana')
      expect(MAINNET_CHAINS).toContain(chain)
    }
  })

  test('mainnetOnly=false returns all Solana chains', () => {
    const chains = getSolanaChains(false)
    const allSolanaCount = ALL_CHAINS.filter(
      (c) => c.chainType === 'solana',
    ).length
    expect(chains.length).toBe(allSolanaCount)
  })

  test('includes both mainnet and devnet Solana', () => {
    const allSolanaChains = getSolanaChains(false)
    const chainIds = allSolanaChains.map((c) => c.chainId)
    expect(chainIds).toContain('solana-mainnet')
    expect(chainIds).toContain('solana-devnet')
  })
})

describe('getHomeChain - Selection', () => {
  test('mainnetOnly=true returns Ethereum mainnet', () => {
    const home = getHomeChain(true)
    expect(home.chainId).toBe(1)
    expect(home.name).toBe('Ethereum Mainnet')
  })

  test('mainnetOnly=false may return testnet home', () => {
    // When mainnetOnly is false, should still find a home chain
    const home = getHomeChain(false)
    expect(home.isHomeChain).toBe(true)
  })

  test('home chain has correct configuration', () => {
    const home = getHomeChain()
    expect(home.isHomeChain).toBe(true)
    expect(home.chainType).toBe('evm')
  })
})

describe('validateChainConfig - Validation', () => {
  test('accepts valid EVM chain config', () => {
    const validChain = getChainConfig(1)
    expect(() => validateChainConfig(validChain)).not.toThrow()
  })

  test('accepts valid SVM chain config', () => {
    const validChain = getChainConfig('solana-mainnet')
    expect(() => validateChainConfig(validChain)).not.toThrow()
  })

  test('throws for missing RPC URL', () => {
    const invalidChain = { ...getChainConfig(1), rpcUrl: '' }
    expect(() => validateChainConfig(invalidChain)).toThrow('Missing RPC URL')
  })

  test('throws for missing Hyperlane mailbox', () => {
    const invalidChain = { ...getChainConfig(1), hyperlaneMailbox: '' }
    expect(() => validateChainConfig(invalidChain)).toThrow(
      'Missing Hyperlane mailbox',
    )
  })

  test('throws for invalid EVM mailbox address format', () => {
    const invalidChain = {
      ...getChainConfig(1),
      hyperlaneMailbox: 'not-a-valid-address',
    }
    expect(() => validateChainConfig(invalidChain)).toThrow(
      'Invalid EVM mailbox address',
    )
  })
})

describe('Chain Specific - Ethereum Mainnet', () => {
  const ethereum = getChainConfig(1)

  test('has correct chain ID', () => {
    expect(ethereum.chainId).toBe(1)
  })

  test('is home chain', () => {
    expect(ethereum.isHomeChain).toBe(true)
  })

  test('has Uniswap V4 pool manager', () => {
    expect(ethereum.uniswapV4PoolManager).toBeDefined()
    expect(ethereum.uniswapV4PoolManager?.startsWith('0x')).toBe(true)
  })

  test('has DEX router', () => {
    expect(ethereum.dexRouter).toBeDefined()
    expect(ethereum.dexRouter?.startsWith('0x')).toBe(true)
  })

  test('has ~12s block time', () => {
    expect(ethereum.avgBlockTime).toBe(12)
  })
})

describe('Chain Specific - L2 Chains', () => {
  const l2ChainIds: ChainId[] = [10, 8453, 42161] // Optimism, Base, Arbitrum

  test('L2s are not home chains', () => {
    for (const chainId of l2ChainIds) {
      const chain = getChainConfig(chainId)
      expect(chain.isHomeChain).toBe(false)
    }
  })

  test('L2s have faster block times than L1', () => {
    const ethereum = getChainConfig(1)
    for (const chainId of l2ChainIds) {
      const chain = getChainConfig(chainId)
      expect(chain.avgBlockTime).toBeLessThan(ethereum.avgBlockTime)
    }
  })

  test('L2s use ETH as native currency', () => {
    for (const chainId of l2ChainIds) {
      const chain = getChainConfig(chainId)
      expect(chain.nativeCurrency.symbol).toBe('ETH')
    }
  })
})

describe('Chain Specific - Alt L1s', () => {
  test('BSC uses BNB', () => {
    const bsc = getChainConfig(56)
    expect(bsc.nativeCurrency.symbol).toBe('BNB')
    expect(bsc.nativeCurrency.name).toBe('BNB')
  })

  test('Polygon uses MATIC', () => {
    const polygon = getChainConfig(137)
    expect(polygon.nativeCurrency.symbol).toBe('MATIC')
  })

  test('Avalanche uses AVAX', () => {
    const avalanche = getChainConfig(43114)
    expect(avalanche.nativeCurrency.symbol).toBe('AVAX')
  })
})

describe('Testnet Chains', () => {
  test('testnets are not mixed with mainnets', () => {
    for (const testnet of TESTNET_CHAINS) {
      expect(MAINNET_CHAINS).not.toContain(testnet)
    }
  })

  test('Sepolia is testnet home chain', () => {
    const sepolia = getChainConfig(11155111)
    expect(sepolia.isHomeChain).toBe(true)
    expect(TESTNET_CHAINS).toContain(sepolia)
  })

  test('testnet block explorers point to testnet', () => {
    for (const chain of TESTNET_CHAINS) {
      if (chain.chainType === 'evm') {
        expect(
          chain.blockExplorerUrl.includes('sepolia') ||
            chain.blockExplorerUrl.includes('testnet') ||
            chain.blockExplorerUrl.includes('devnet'),
        ).toBe(true)
      }
    }
  })
})

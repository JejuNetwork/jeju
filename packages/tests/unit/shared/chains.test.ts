/**
 * Unit Tests for shared/chains.ts
 * Tests boundary conditions, edge cases, and all exports
 *
 * Note: These tests validate the dynamic chain configuration loaded from packages/config.
 * Values may change based on config, so tests focus on structure and behavior.
 */

import { describe, expect, test } from 'bun:test'
import {
  CHAIN_NAMES,
  chainName,
  getChainIds,
  MAINNET_CHAIN_IDS,
  PUBLIC_RPCS,
  rpcUrl,
  TESTNET_CHAIN_IDS,
} from './chains'

describe('PUBLIC_RPCS', () => {
  test('should have core EVM testnet chains', () => {
    // Core EVM testnets that should always exist
    expect(PUBLIC_RPCS[11155111]).toBeDefined() // Sepolia
    expect(PUBLIC_RPCS[84532]).toBeDefined() // Base Sepolia
    expect(PUBLIC_RPCS[421614]).toBeDefined() // Arbitrum Sepolia
    expect(PUBLIC_RPCS[11155420]).toBeDefined() // Optimism Sepolia
    expect(PUBLIC_RPCS[420690]).toBeDefined() // Jeju Testnet
  })

  test('should have core EVM mainnet chains', () => {
    expect(PUBLIC_RPCS[1]).toBeDefined() // Ethereum
    expect(PUBLIC_RPCS[8453]).toBeDefined() // Base
    expect(PUBLIC_RPCS[42161]).toBeDefined() // Arbitrum One
    expect(PUBLIC_RPCS[10]).toBeDefined() // Optimism
    expect(PUBLIC_RPCS[420691]).toBeDefined() // Jeju Mainnet
  })

  test('should return undefined for unknown chain', () => {
    expect(PUBLIC_RPCS[999999]).toBeUndefined()
    expect(PUBLIC_RPCS[0]).toBeUndefined()
    expect(PUBLIC_RPCS[-1]).toBeUndefined()
  })

  test('all URLs should be valid http/https URLs', () => {
    for (const url of Object.values(PUBLIC_RPCS)) {
      expect(url).toMatch(/^https?:\/\/.+/)
      expect(url.endsWith('/')).toBe(false)
    }
  })

  test('should have at least 10 chains configured', () => {
    expect(Object.keys(PUBLIC_RPCS).length).toBeGreaterThanOrEqual(10)
  })
})

describe('CHAIN_NAMES', () => {
  test('should have human-readable names for core testnets', () => {
    expect(CHAIN_NAMES[11155111]).toBeDefined()
    expect(CHAIN_NAMES[84532]).toBeDefined()
    expect(CHAIN_NAMES[421614]).toBeDefined()
    expect(CHAIN_NAMES[420690]).toBeDefined()
  })

  test('should have human-readable names for core mainnets', () => {
    expect(CHAIN_NAMES[1]).toBe('Ethereum')
    expect(CHAIN_NAMES[8453]).toBe('Base')
    expect(CHAIN_NAMES[42161]).toBe('Arbitrum One')
    expect(CHAIN_NAMES[420691]).toBeDefined()
  })

  test('coverage: every PUBLIC_RPCS key has a CHAIN_NAMES entry', () => {
    for (const chainId of Object.keys(PUBLIC_RPCS)) {
      expect(CHAIN_NAMES[Number(chainId)]).toBeDefined()
      expect(CHAIN_NAMES[Number(chainId)].length).toBeGreaterThan(0)
    }
  })
})

describe('TESTNET_CHAIN_IDS', () => {
  test('should contain at least 5 testnet chains', () => {
    expect(TESTNET_CHAIN_IDS.length).toBeGreaterThanOrEqual(5)
  })

  test('should contain core testnet chain IDs', () => {
    expect(TESTNET_CHAIN_IDS).toContain(11155111) // Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(84532) // Base Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(421614) // Arbitrum Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(11155420) // Optimism Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(420690) // Jeju Testnet
  })

  test('should not contain core mainnet EVM chains', () => {
    expect(TESTNET_CHAIN_IDS).not.toContain(1)
    expect(TESTNET_CHAIN_IDS).not.toContain(8453)
    expect(TESTNET_CHAIN_IDS).not.toContain(42161)
    expect(TESTNET_CHAIN_IDS).not.toContain(10)
    expect(TESTNET_CHAIN_IDS).not.toContain(420691)
  })
})

describe('MAINNET_CHAIN_IDS', () => {
  test('should contain at least 5 mainnet chains', () => {
    expect(MAINNET_CHAIN_IDS.length).toBeGreaterThanOrEqual(5)
  })

  test('should contain core mainnet chain IDs', () => {
    expect(MAINNET_CHAIN_IDS).toContain(1) // Ethereum
    expect(MAINNET_CHAIN_IDS).toContain(8453) // Base
    expect(MAINNET_CHAIN_IDS).toContain(42161) // Arbitrum One
    expect(MAINNET_CHAIN_IDS).toContain(10) // Optimism
    expect(MAINNET_CHAIN_IDS).toContain(420691) // Jeju Mainnet
  })

  test('should not contain core testnet EVM chains', () => {
    expect(MAINNET_CHAIN_IDS).not.toContain(11155111)
    expect(MAINNET_CHAIN_IDS).not.toContain(84532)
    expect(MAINNET_CHAIN_IDS).not.toContain(421614)
    expect(MAINNET_CHAIN_IDS).not.toContain(11155420)
    expect(MAINNET_CHAIN_IDS).not.toContain(420690)
  })
})

describe('getChainIds()', () => {
  test('should return testnet IDs for "testnet"', () => {
    const result = getChainIds('testnet')
    expect(result).toEqual(TESTNET_CHAIN_IDS)
    expect(result.length).toBeGreaterThanOrEqual(5)
  })

  test('should return mainnet IDs for "mainnet"', () => {
    const result = getChainIds('mainnet')
    expect(result).toEqual(MAINNET_CHAIN_IDS)
    expect(result.length).toBeGreaterThanOrEqual(5)
  })

  test('should return different arrays for different networks', () => {
    const testnet = getChainIds('testnet')
    const mainnet = getChainIds('mainnet')
    expect(testnet).not.toEqual(mainnet)

    // Core EVM chains should not overlap between testnet and mainnet
    const coreTestnets = [11155111, 84532, 421614, 11155420, 420690]
    const coreMainnets = [1, 8453, 42161, 10, 420691]
    for (const id of coreTestnets) {
      expect(mainnet).not.toContain(id)
    }
    for (const id of coreMainnets) {
      expect(testnet).not.toContain(id)
    }
  })
})

describe('chainName()', () => {
  test('should return name for known chains', () => {
    expect(chainName(1)).toBe('Ethereum')
    expect(chainName(8453)).toBe('Base')
    expect(chainName(420690)).toBeDefined()
    expect(chainName(420691)).toBeDefined()
  })

  test('should return fallback for unknown chains', () => {
    expect(chainName(999999)).toBe('Chain 999999')
    expect(chainName(0)).toBe('Chain 0')
  })

  test('should handle boundary values', () => {
    expect(chainName(Number.MAX_SAFE_INTEGER)).toBe(
      `Chain ${Number.MAX_SAFE_INTEGER}`,
    )
  })
})

describe('rpcUrl()', () => {
  test('should return URL for known chains', () => {
    expect(rpcUrl(1)).toBe('https://eth.llamarpc.com')
    expect(rpcUrl(11155111)).toBe('https://ethereum-sepolia-rpc.publicnode.com')
    expect(rpcUrl(8453)).toBe('https://mainnet.base.org')
  })

  test('should throw for unknown chains', () => {
    expect(() => rpcUrl(999999)).toThrow('No RPC URL for chain 999999')
    expect(() => rpcUrl(0)).toThrow('No RPC URL for chain 0')
  })

  test('should throw with specific chain ID in message', () => {
    expect(() => rpcUrl(12345)).toThrow('12345')
  })
})

describe('data consistency', () => {
  test('PUBLIC_RPCS and CHAIN_NAMES have same keys', () => {
    const rpcKeys = Object.keys(PUBLIC_RPCS)
      .map(Number)
      .sort((a, b) => a - b)
    const nameKeys = Object.keys(CHAIN_NAMES)
      .map(Number)
      .sort((a, b) => a - b)
    expect(rpcKeys).toEqual(nameKeys)
  })

  test('all chain ID arrays reference valid chains', () => {
    for (const id of [...TESTNET_CHAIN_IDS, ...MAINNET_CHAIN_IDS]) {
      expect(PUBLIC_RPCS[id]).toBeDefined()
      expect(CHAIN_NAMES[id]).toBeDefined()
    }
  })

  test('total chains equals testnets plus mainnets', () => {
    const totalChains = Object.keys(PUBLIC_RPCS).length
    expect(totalChains).toBe(
      TESTNET_CHAIN_IDS.length + MAINNET_CHAIN_IDS.length,
    )
  })
})

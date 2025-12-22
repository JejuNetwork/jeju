/**
 * CAIP-2 Chain Identification Tests
 *
 * Tests for chain ID parsing, formatting, and conversion.
 */

import { describe, expect, test } from 'bun:test'
import {
  CHAINS,
  type ChainId,
  caip2ToEvmChainId,
  evmChainIdToCAIP2,
  formatChainId,
  getAllChains,
  getChainInfo,
  getMainnetChains,
  getSolanaCluster,
  getTestnetChains,
  isEvmChain,
  isSolanaChain,
  parseChainId,
  SOLANA_DEVNET_GENESIS,
  SOLANA_MAINNET_GENESIS,
  SOLANA_TESTNET_GENESIS,
  solanaClusterToCAIP2,
} from '../caip/chains'

describe('caip/chains.ts - CAIP-2 Chain Identification', () => {
  describe('parseChainId', () => {
    test('parses EVM chain IDs correctly', () => {
      const result = parseChainId('eip155:1')
      expect(result.namespace).toBe('eip155')
      expect(result.reference).toBe('1')
    })

    test('parses multi-digit chain references', () => {
      const result = parseChainId('eip155:84532')
      expect(result.namespace).toBe('eip155')
      expect(result.reference).toBe('84532')
    })

    test('parses Solana chain IDs correctly', () => {
      const result = parseChainId(`solana:${SOLANA_MAINNET_GENESIS}`)
      expect(result.namespace).toBe('solana')
      expect(result.reference).toBe(SOLANA_MAINNET_GENESIS)
    })

    test('parses other valid namespaces', () => {
      const cosmos = parseChainId('cosmos:cosmoshub-4')
      expect(cosmos.namespace).toBe('cosmos')
      expect(cosmos.reference).toBe('cosmoshub-4')

      const polkadot = parseChainId('polkadot:91b171bb158e2d3848fa23a9f1c25182')
      expect(polkadot.namespace).toBe('polkadot')
    })

    test('throws on invalid format - no colon', () => {
      expect(() => parseChainId('eip1551')).toThrow('Invalid CAIP-2 chain ID')
    })

    test('throws on invalid format - too many colons', () => {
      expect(() => parseChainId('eip155:1:extra')).toThrow(
        'Invalid CAIP-2 chain ID',
      )
    })

    test('throws on invalid namespace', () => {
      expect(() => parseChainId('invalid:1')).toThrow('Invalid namespace')
    })

    test('throws on empty string', () => {
      expect(() => parseChainId('')).toThrow('Invalid CAIP-2 chain ID')
    })
  })

  describe('formatChainId', () => {
    test('formats EVM chain ID correctly', () => {
      const chainId: ChainId = { namespace: 'eip155', reference: '1' }
      expect(formatChainId(chainId)).toBe('eip155:1')
    })

    test('formats Solana chain ID correctly', () => {
      const chainId: ChainId = {
        namespace: 'solana',
        reference: SOLANA_MAINNET_GENESIS,
      }
      expect(formatChainId(chainId)).toBe(`solana:${SOLANA_MAINNET_GENESIS}`)
    })

    test('round-trips correctly', () => {
      const original = 'eip155:137'
      const parsed = parseChainId(original)
      const formatted = formatChainId(parsed)
      expect(formatted).toBe(original)
    })

    test('round-trips with Solana', () => {
      const original = `solana:${SOLANA_DEVNET_GENESIS}`
      const parsed = parseChainId(original)
      const formatted = formatChainId(parsed)
      expect(formatted).toBe(original)
    })
  })

  describe('getChainInfo', () => {
    test('returns info for Ethereum mainnet', () => {
      const info = getChainInfo('eip155:1')
      expect(info).toBeDefined()
      expect(info?.name).toBe('Ethereum Mainnet')
      expect(info?.shortName).toBe('eth')
      expect(info?.nativeCurrency.symbol).toBe('ETH')
      expect(info?.isTestnet).toBe(false)
    })

    test('returns info for Base', () => {
      const info = getChainInfo('eip155:8453')
      expect(info).toBeDefined()
      expect(info?.name).toBe('Base')
      expect(info?.shortName).toBe('base')
    })

    test('returns info for Solana mainnet', () => {
      const info = getChainInfo(`solana:${SOLANA_MAINNET_GENESIS}`)
      expect(info).toBeDefined()
      expect(info?.name).toBe('Solana Mainnet')
      expect(info?.nativeCurrency.symbol).toBe('SOL')
      expect(info?.nativeCurrency.decimals).toBe(9)
    })

    test('returns undefined for unknown chain', () => {
      const info = getChainInfo('eip155:999999')
      expect(info).toBeUndefined()
    })

    test('identifies testnets correctly', () => {
      const sepolia = getChainInfo('eip155:11155111')
      expect(sepolia?.isTestnet).toBe(true)

      const baseSepolia = getChainInfo('eip155:84532')
      expect(baseSepolia?.isTestnet).toBe(true)

      const solanaDevnet = getChainInfo(`solana:${SOLANA_DEVNET_GENESIS}`)
      expect(solanaDevnet?.isTestnet).toBe(true)
    })
  })

  describe('evmChainIdToCAIP2', () => {
    test('converts Ethereum mainnet', () => {
      expect(evmChainIdToCAIP2(1)).toBe('eip155:1')
    })

    test('converts Base', () => {
      expect(evmChainIdToCAIP2(8453)).toBe('eip155:8453')
    })

    test('converts Arbitrum', () => {
      expect(evmChainIdToCAIP2(42161)).toBe('eip155:42161')
    })

    test('handles zero', () => {
      expect(evmChainIdToCAIP2(0)).toBe('eip155:0')
    })

    test('handles large chain IDs', () => {
      expect(evmChainIdToCAIP2(999999999)).toBe('eip155:999999999')
    })
  })

  describe('caip2ToEvmChainId', () => {
    test('extracts Ethereum mainnet chain ID', () => {
      expect(caip2ToEvmChainId('eip155:1')).toBe(1)
    })

    test('extracts Base chain ID', () => {
      expect(caip2ToEvmChainId('eip155:8453')).toBe(8453)
    })

    test('returns undefined for Solana', () => {
      expect(
        caip2ToEvmChainId(`solana:${SOLANA_MAINNET_GENESIS}`),
      ).toBeUndefined()
    })

    test('returns undefined for Cosmos', () => {
      expect(caip2ToEvmChainId('cosmos:cosmoshub-4')).toBeUndefined()
    })

    test('round-trips correctly', () => {
      const original = 42161
      const caip = evmChainIdToCAIP2(original)
      const back = caip2ToEvmChainId(caip)
      expect(back).toBe(original)
    })
  })

  describe('isEvmChain', () => {
    test('returns true for EVM chains', () => {
      expect(isEvmChain('eip155:1')).toBe(true)
      expect(isEvmChain('eip155:8453')).toBe(true)
      expect(isEvmChain('eip155:137')).toBe(true)
    })

    test('returns false for Solana', () => {
      expect(isEvmChain(`solana:${SOLANA_MAINNET_GENESIS}`)).toBe(false)
    })

    test('returns false for Cosmos', () => {
      expect(isEvmChain('cosmos:cosmoshub-4')).toBe(false)
    })
  })

  describe('isSolanaChain', () => {
    test('returns true for Solana chains', () => {
      expect(isSolanaChain(`solana:${SOLANA_MAINNET_GENESIS}`)).toBe(true)
      expect(isSolanaChain(`solana:${SOLANA_DEVNET_GENESIS}`)).toBe(true)
      expect(isSolanaChain(`solana:${SOLANA_TESTNET_GENESIS}`)).toBe(true)
    })

    test('returns false for EVM chains', () => {
      expect(isSolanaChain('eip155:1')).toBe(false)
    })

    test('returns false for Cosmos', () => {
      expect(isSolanaChain('cosmos:cosmoshub-4')).toBe(false)
    })
  })

  describe('getSolanaCluster', () => {
    test('identifies mainnet-beta', () => {
      expect(getSolanaCluster(`solana:${SOLANA_MAINNET_GENESIS}`)).toBe(
        'mainnet-beta',
      )
    })

    test('identifies devnet', () => {
      expect(getSolanaCluster(`solana:${SOLANA_DEVNET_GENESIS}`)).toBe('devnet')
    })

    test('identifies testnet', () => {
      expect(getSolanaCluster(`solana:${SOLANA_TESTNET_GENESIS}`)).toBe(
        'testnet',
      )
    })

    test('returns undefined for unknown Solana chain', () => {
      expect(getSolanaCluster('solana:unknowngenesis')).toBeUndefined()
    })

    test('returns undefined for non-Solana chains', () => {
      expect(getSolanaCluster('eip155:1')).toBeUndefined()
    })
  })

  describe('solanaClusterToCAIP2', () => {
    test('converts mainnet-beta', () => {
      expect(solanaClusterToCAIP2('mainnet-beta')).toBe(
        `solana:${SOLANA_MAINNET_GENESIS}`,
      )
    })

    test('converts devnet', () => {
      expect(solanaClusterToCAIP2('devnet')).toBe(
        `solana:${SOLANA_DEVNET_GENESIS}`,
      )
    })

    test('converts testnet', () => {
      expect(solanaClusterToCAIP2('testnet')).toBe(
        `solana:${SOLANA_TESTNET_GENESIS}`,
      )
    })

    test('round-trips correctly', () => {
      const clusters = ['mainnet-beta', 'devnet', 'testnet'] as const
      for (const cluster of clusters) {
        const caip = solanaClusterToCAIP2(cluster)
        const back = getSolanaCluster(caip)
        expect(back).toBe(cluster)
      }
    })
  })

  describe('getAllChains', () => {
    test('returns array of chain info', () => {
      const chains = getAllChains()
      expect(Array.isArray(chains)).toBe(true)
      expect(chains.length).toBeGreaterThan(0)
    })

    test('includes both EVM and Solana chains', () => {
      const chains = getAllChains()
      const hasEvm = chains.some((c) => c.id.namespace === 'eip155')
      const hasSolana = chains.some((c) => c.id.namespace === 'solana')
      expect(hasEvm).toBe(true)
      expect(hasSolana).toBe(true)
    })

    test('all chains have required properties', () => {
      const chains = getAllChains()
      for (const chain of chains) {
        expect(chain.id).toBeDefined()
        expect(chain.name).toBeDefined()
        expect(chain.shortName).toBeDefined()
        expect(chain.nativeCurrency).toBeDefined()
        expect(chain.nativeCurrency.name).toBeDefined()
        expect(chain.nativeCurrency.symbol).toBeDefined()
        expect(typeof chain.nativeCurrency.decimals).toBe('number')
        expect(chain.rpcUrls.length).toBeGreaterThan(0)
        expect(typeof chain.isTestnet).toBe('boolean')
      }
    })
  })

  describe('getMainnetChains', () => {
    test('returns only mainnet chains', () => {
      const chains = getMainnetChains()
      for (const chain of chains) {
        expect(chain.isTestnet).toBe(false)
      }
    })

    test('includes Ethereum and Solana mainnets', () => {
      const chains = getMainnetChains()
      const ethMainnet = chains.find((c) => c.name === 'Ethereum Mainnet')
      const solMainnet = chains.find((c) => c.name === 'Solana Mainnet')
      expect(ethMainnet).toBeDefined()
      expect(solMainnet).toBeDefined()
    })
  })

  describe('getTestnetChains', () => {
    test('returns only testnet chains', () => {
      const chains = getTestnetChains()
      for (const chain of chains) {
        expect(chain.isTestnet).toBe(true)
      }
    })

    test('includes Sepolia and Solana devnet', () => {
      const chains = getTestnetChains()
      const sepolia = chains.find((c) => c.name === 'Sepolia')
      const solDevnet = chains.find((c) => c.name === 'Solana Devnet')
      expect(sepolia).toBeDefined()
      expect(solDevnet).toBeDefined()
    })
  })

  describe('CHAINS constant', () => {
    test('is indexed by CAIP-2 strings', () => {
      expect(CHAINS['eip155:1']).toBeDefined()
      expect(CHAINS['eip155:8453']).toBeDefined()
      expect(CHAINS[`solana:${SOLANA_MAINNET_GENESIS}`]).toBeDefined()
    })

    test('chain info id matches key', () => {
      for (const [key, info] of Object.entries(CHAINS)) {
        const formatted = formatChainId(info.id)
        expect(formatted).toBe(key)
      }
    })
  })

  describe('Genesis hash constants', () => {
    test('Solana mainnet genesis hash is correct format', () => {
      expect(SOLANA_MAINNET_GENESIS).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
    })

    test('Solana devnet genesis hash is correct format', () => {
      expect(SOLANA_DEVNET_GENESIS).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
    })

    test('Solana testnet genesis hash is correct format', () => {
      expect(SOLANA_TESTNET_GENESIS).toBe('4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z')
    })
  })
})

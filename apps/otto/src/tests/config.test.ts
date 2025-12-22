/**
 * Otto Config Tests
 */

import { describe, expect, test } from 'bun:test'
import {
  getChainId,
  getChainName,
  isChainSupported,
  isSolanaChain,
  OTTO_COMMANDS,
  SUPPORTED_CHAINS,
} from '../config'

describe('Config', () => {
  describe('getChainId', () => {
    test('resolves chain names to IDs', () => {
      expect(getChainId('jeju')).toBe(420691)
      expect(getChainId('ethereum')).toBe(1)
      expect(getChainId('eth')).toBe(1)
      expect(getChainId('base')).toBe(8453)
      expect(getChainId('optimism')).toBe(10)
      expect(getChainId('op')).toBe(10)
      expect(getChainId('arbitrum')).toBe(42161)
      expect(getChainId('arb')).toBe(42161)
      expect(getChainId('solana')).toBe(101)
      expect(getChainId('sol')).toBe(101)
    })

    test('returns null for unknown chains', () => {
      expect(getChainId('unknown')).toBeNull()
      expect(getChainId('')).toBeNull()
    })

    test('is case insensitive', () => {
      expect(getChainId('JEJU')).toBe(420691)
      expect(getChainId('Ethereum')).toBe(1)
      expect(getChainId('BASE')).toBe(8453)
    })
  })

  describe('getChainName', () => {
    test('resolves chain IDs to names', () => {
      expect(getChainName(420691)).toBe('Jeju')
      expect(getChainName(1)).toBe('Ethereum')
      expect(getChainName(8453)).toBe('Base')
      expect(getChainName(10)).toBe('Optimism')
      expect(getChainName(42161)).toBe('Arbitrum')
      expect(getChainName(101)).toBe('Solana')
    })

    test('throws for unknown chains', () => {
      expect(() => getChainName(99999)).toThrow('Unsupported chain ID: 99999')
    })
  })

  describe('isChainSupported', () => {
    test('returns true for supported chains', () => {
      expect(isChainSupported(420691)).toBe(true)
      expect(isChainSupported(1)).toBe(true)
      expect(isChainSupported(8453)).toBe(true)
      expect(isChainSupported(10)).toBe(true)
      expect(isChainSupported(42161)).toBe(true)
      expect(isChainSupported(101)).toBe(true)
    })

    test('returns false for unsupported chains', () => {
      expect(isChainSupported(99999)).toBe(false)
      expect(isChainSupported(0)).toBe(false)
    })
  })

  describe('isSolanaChain', () => {
    test('identifies Solana chains', () => {
      expect(isSolanaChain(101)).toBe(true)
    })

    test('returns false for non-Solana chains', () => {
      expect(isSolanaChain(1)).toBe(false)
      expect(isSolanaChain(420691)).toBe(false)
      expect(isSolanaChain(8453)).toBe(false)
    })
  })

  describe('SUPPORTED_CHAINS', () => {
    test('has Jeju as default', () => {
      const jeju = SUPPORTED_CHAINS.find((c) => c.chainId === 420691)
      expect(jeju).toBeDefined()
      expect(jeju?.isDefault).toBe(true)
    })

    test('includes all major chains', () => {
      const chainIds = SUPPORTED_CHAINS.map((c) => c.chainId)
      expect(chainIds).toContain(420691) // Jeju
      expect(chainIds).toContain(1) // Ethereum
      expect(chainIds).toContain(8453) // Base
      expect(chainIds).toContain(10) // Optimism
      expect(chainIds).toContain(42161) // Arbitrum
      expect(chainIds).toContain(101) // Solana
    })
  })

  describe('OTTO_COMMANDS', () => {
    test('has all required commands', () => {
      const commands = Object.keys(OTTO_COMMANDS)
      expect(commands).toContain('help')
      expect(commands).toContain('balance')
      expect(commands).toContain('price')
      expect(commands).toContain('swap')
      expect(commands).toContain('bridge')
      expect(commands).toContain('send')
      expect(commands).toContain('launch')
      expect(commands).toContain('portfolio')
      expect(commands).toContain('limit')
      expect(commands).toContain('orders')
      expect(commands).toContain('cancel')
      expect(commands).toContain('connect')
      expect(commands).toContain('disconnect')
      expect(commands).toContain('settings')
    })

    test('each command has required properties', () => {
      for (const [_name, cmd] of Object.entries(OTTO_COMMANDS)) {
        expect(cmd.description).toBeDefined()
        expect(cmd.description.length).toBeGreaterThan(0)
        expect(cmd.usage).toBeDefined()
        expect(cmd.examples).toBeDefined()
        expect(cmd.examples.length).toBeGreaterThan(0)
      }
    })
  })
})

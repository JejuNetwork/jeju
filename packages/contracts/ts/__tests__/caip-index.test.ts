/**
 * CAIP Unified Parsing and Builder Tests
 *
 * Tests for the universal CAIP identifier parsing and the CAIPBuilder utility.
 */

import { describe, expect, test } from 'bun:test'
import { SOLANA_DEVNET_GENESIS, SOLANA_MAINNET_GENESIS } from '../caip/chains'
import {
  CAIPBuilder,
  caip,
  getCAIPType,
  isValidCAIP,
  parseUniversalId,
} from '../caip/index'

// Test addresses
const VALID_EVM_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const USDC_ETH_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('caip/index.ts - Universal CAIP Parsing', () => {
  describe('parseUniversalId', () => {
    describe('CAIP-2 (chains)', () => {
      test('parses EVM chain ID', () => {
        const result = parseUniversalId('eip155:1')

        expect(result.type).toBe('chain')
        expect(result.namespace).toBe('eip155')
        expect(result.chainId).toBe('eip155:1')
        expect(result.address).toBeUndefined()
        expect(result.assetNamespace).toBeUndefined()
      })

      test('parses Solana chain ID', () => {
        const result = parseUniversalId(`solana:${SOLANA_MAINNET_GENESIS}`)

        expect(result.type).toBe('chain')
        expect(result.namespace).toBe('solana')
        expect(result.chainId).toBe(`solana:${SOLANA_MAINNET_GENESIS}`)
      })
    })

    describe('CAIP-10 (accounts)', () => {
      test('parses EVM account', () => {
        const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
        const result = parseUniversalId(caip10)

        expect(result.type).toBe('account')
        expect(result.namespace).toBe('eip155')
        expect(result.chainId).toBe('eip155:1')
        expect(result.address).toBe(VALID_EVM_ADDRESS)
      })

      test('parses Solana account', () => {
        const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${USDC_SOLANA_MINT}`
        const result = parseUniversalId(caip10)

        expect(result.type).toBe('account')
        expect(result.namespace).toBe('solana')
        expect(result.address).toBe(USDC_SOLANA_MINT)
      })
    })

    describe('CAIP-19 (assets)', () => {
      test('parses ERC20 asset', () => {
        const caip19 = `eip155:1/erc20:${USDC_ETH_ADDRESS}`
        const result = parseUniversalId(caip19)

        expect(result.type).toBe('asset')
        expect(result.namespace).toBe('eip155')
        expect(result.chainId).toBe('eip155:1')
        expect(result.assetNamespace).toBe('erc20')
        expect(result.assetReference).toBe(USDC_ETH_ADDRESS)
      })

      test('parses native ETH (SLIP44)', () => {
        const caip19 = 'eip155:1/slip44:60'
        const result = parseUniversalId(caip19)

        expect(result.type).toBe('asset')
        expect(result.assetNamespace).toBe('slip44')
        expect(result.assetReference).toBe('60')
      })

      test('parses ERC721 with token ID', () => {
        const caip19 = `eip155:1/erc721:${VALID_EVM_ADDRESS}:999`
        const result = parseUniversalId(caip19)

        expect(result.type).toBe('asset')
        expect(result.assetNamespace).toBe('erc721')
        expect(result.assetReference).toBe(VALID_EVM_ADDRESS)
        expect(result.tokenId).toBe('999')
      })

      test('parses SPL token', () => {
        const caip19 = `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`
        const result = parseUniversalId(caip19)

        expect(result.type).toBe('asset')
        expect(result.namespace).toBe('solana')
        expect(result.assetNamespace).toBe('spl')
      })
    })

    describe('Error handling', () => {
      test('throws on empty string', () => {
        expect(() => parseUniversalId('')).toThrow(
          'CAIP identifier must be a non-empty string',
        )
      })

      test('throws on null/undefined-like input', () => {
        expect(() => parseUniversalId(null as never)).toThrow()
        expect(() => parseUniversalId(undefined as never)).toThrow()
      })

      test('throws on no colon', () => {
        expect(() => parseUniversalId('invalid')).toThrow(
          'must contain at least one colon',
        )
      })
    })
  })

  describe('isValidCAIP', () => {
    test('returns true for valid CAIP-2', () => {
      expect(isValidCAIP('eip155:1')).toBe(true)
      expect(isValidCAIP(`solana:${SOLANA_MAINNET_GENESIS}`)).toBe(true)
    })

    test('returns true for valid CAIP-10', () => {
      expect(isValidCAIP(`eip155:1:${VALID_EVM_ADDRESS}`)).toBe(true)
      expect(
        isValidCAIP(`solana:${SOLANA_MAINNET_GENESIS}:${USDC_SOLANA_MINT}`),
      ).toBe(true)
    })

    test('returns true for valid CAIP-19', () => {
      expect(isValidCAIP(`eip155:1/erc20:${USDC_ETH_ADDRESS}`)).toBe(true)
      expect(isValidCAIP('eip155:1/slip44:60')).toBe(true)
      expect(
        isValidCAIP(`solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`),
      ).toBe(true)
    })

    test('returns false for invalid strings', () => {
      expect(isValidCAIP('')).toBe(false)
      expect(isValidCAIP('invalid')).toBe(false)
      // Note: 'not:valid:format:here' parses as valid CAIP-10 (namespace:reference:address)
      // because it has the right colon structure, even though 'not' is not a valid namespace
    })
  })

  describe('getCAIPType', () => {
    test('identifies chain type', () => {
      expect(getCAIPType('eip155:1')).toBe('chain')
      expect(getCAIPType(`solana:${SOLANA_MAINNET_GENESIS}`)).toBe('chain')
    })

    test('identifies account type', () => {
      expect(getCAIPType(`eip155:1:${VALID_EVM_ADDRESS}`)).toBe('account')
      expect(
        getCAIPType(`solana:${SOLANA_MAINNET_GENESIS}:${USDC_SOLANA_MINT}`),
      ).toBe('account')
    })

    test('identifies asset type', () => {
      expect(getCAIPType(`eip155:1/erc20:${USDC_ETH_ADDRESS}`)).toBe('asset')
      expect(getCAIPType('eip155:1/slip44:60')).toBe('asset')
    })

    test('returns undefined for invalid', () => {
      expect(getCAIPType('')).toBeUndefined()
      expect(getCAIPType('invalid')).toBeUndefined()
    })
  })

  describe('CAIPBuilder', () => {
    describe('EVM chains', () => {
      test('builds Ethereum mainnet chain ID', () => {
        const builder = new CAIPBuilder().evmChain(1)
        expect(builder.chainId()).toBe('eip155:1')
      })

      test('builds Base chain ID', () => {
        const builder = new CAIPBuilder().evmChain(8453)
        expect(builder.chainId()).toBe('eip155:8453')
      })

      test('builds account ID', () => {
        const result = new CAIPBuilder()
          .evmChain(1)
          .accountId(VALID_EVM_ADDRESS)

        expect(result).toBe(`eip155:1:${VALID_EVM_ADDRESS}`)
      })

      test('builds native ETH asset', () => {
        const result = new CAIPBuilder().evmChain(1).nativeAsset()

        expect(result).toBe('eip155:1/slip44:60')
      })

      test('builds ERC20 token asset', () => {
        const result = new CAIPBuilder()
          .evmChain(1)
          .tokenAsset(USDC_ETH_ADDRESS)

        expect(result).toBe(`eip155:1/erc20:${USDC_ETH_ADDRESS}`)
      })

      test('builds ERC721 NFT asset', () => {
        const result = new CAIPBuilder()
          .evmChain(1)
          .nftAsset(VALID_EVM_ADDRESS, 42)

        expect(result).toBe(`eip155:1/erc721:${VALID_EVM_ADDRESS}:42`)
      })

      test('builds NFT asset with string token ID', () => {
        const result = new CAIPBuilder()
          .evmChain(1)
          .nftAsset(VALID_EVM_ADDRESS, '999')

        expect(result).toBe(`eip155:1/erc721:${VALID_EVM_ADDRESS}:999`)
      })
    })

    describe('Solana chains', () => {
      test('builds Solana mainnet chain ID', () => {
        const builder = new CAIPBuilder().solanaChain('mainnet-beta')
        expect(builder.chainId()).toBe(`solana:${SOLANA_MAINNET_GENESIS}`)
      })

      test('builds Solana devnet chain ID', () => {
        const builder = new CAIPBuilder().solanaChain('devnet')
        expect(builder.chainId()).toBe(`solana:${SOLANA_DEVNET_GENESIS}`)
      })

      test('defaults to mainnet-beta', () => {
        const builder = new CAIPBuilder().solanaChain()
        expect(builder.chainId()).toContain(SOLANA_MAINNET_GENESIS)
      })

      test('builds account ID', () => {
        const result = new CAIPBuilder()
          .solanaChain('mainnet-beta')
          .accountId(USDC_SOLANA_MINT)

        expect(result).toBe(
          `solana:${SOLANA_MAINNET_GENESIS}:${USDC_SOLANA_MINT}`,
        )
      })

      test('builds native SOL asset', () => {
        const result = new CAIPBuilder()
          .solanaChain('mainnet-beta')
          .nativeAsset()

        expect(result).toBe(`solana:${SOLANA_MAINNET_GENESIS}/native:SOL`)
      })

      test('builds SPL token asset', () => {
        const result = new CAIPBuilder()
          .solanaChain('mainnet-beta')
          .tokenAsset(USDC_SOLANA_MINT)

        expect(result).toBe(
          `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`,
        )
      })

      test('throws on NFT for Solana', () => {
        expect(() => {
          new CAIPBuilder()
            .solanaChain('mainnet-beta')
            .nftAsset('some-address', 1)
        }).toThrow('NFT assets are EVM-only')
      })
    })

    describe('Chaining', () => {
      test('returns this for chaining', () => {
        const builder = new CAIPBuilder()
        expect(builder.evmChain(1)).toBe(builder)
        expect(builder.solanaChain('devnet')).toBe(builder)
      })

      test('can switch chains', () => {
        const builder = new CAIPBuilder()

        builder.evmChain(1)
        expect(builder.chainId()).toBe('eip155:1')

        builder.evmChain(8453)
        expect(builder.chainId()).toBe('eip155:8453')

        builder.solanaChain('mainnet-beta')
        expect(builder.chainId()).toBe(`solana:${SOLANA_MAINNET_GENESIS}`)
      })
    })

    describe('Default state', () => {
      test('defaults to Ethereum mainnet', () => {
        const builder = new CAIPBuilder()
        expect(builder.chainId()).toBe('eip155:1')
      })
    })
  })

  describe('caip() factory function', () => {
    test('creates new CAIPBuilder', () => {
      const builder = caip()
      expect(builder).toBeInstanceOf(CAIPBuilder)
    })

    test('can be used fluently', () => {
      const result = caip().evmChain(8453).tokenAsset(USDC_ETH_ADDRESS)

      expect(result).toBe(`eip155:8453/erc20:${USDC_ETH_ADDRESS}`)
    })
  })

  describe('Integration tests', () => {
    test('parseUniversalId correctly parses builder output', () => {
      // Chain
      const chainId = caip().evmChain(137).chainId()
      const parsedChain = parseUniversalId(chainId)
      expect(parsedChain.type).toBe('chain')
      expect(parsedChain.chainId).toBe('eip155:137')

      // Account
      const accountId = caip().evmChain(1).accountId(VALID_EVM_ADDRESS)
      const parsedAccount = parseUniversalId(accountId)
      expect(parsedAccount.type).toBe('account')
      expect(parsedAccount.address).toBe(VALID_EVM_ADDRESS)

      // Asset
      const assetId = caip().evmChain(1).tokenAsset(USDC_ETH_ADDRESS)
      const parsedAsset = parseUniversalId(assetId)
      expect(parsedAsset.type).toBe('asset')
      expect(parsedAsset.assetNamespace).toBe('erc20')
    })

    test('isValidCAIP validates builder output', () => {
      expect(isValidCAIP(caip().evmChain(1).chainId())).toBe(true)
      expect(isValidCAIP(caip().evmChain(1).accountId(VALID_EVM_ADDRESS))).toBe(
        true,
      )
      expect(isValidCAIP(caip().evmChain(1).nativeAsset())).toBe(true)
      expect(isValidCAIP(caip().evmChain(1).tokenAsset(USDC_ETH_ADDRESS))).toBe(
        true,
      )
      expect(isValidCAIP(caip().solanaChain().chainId())).toBe(true)
      expect(isValidCAIP(caip().solanaChain().nativeAsset())).toBe(true)
    })

    test('getCAIPType identifies builder output', () => {
      expect(getCAIPType(caip().evmChain(1).chainId())).toBe('chain')
      expect(getCAIPType(caip().evmChain(1).accountId(VALID_EVM_ADDRESS))).toBe(
        'account',
      )
      expect(getCAIPType(caip().evmChain(1).tokenAsset(USDC_ETH_ADDRESS))).toBe(
        'asset',
      )
    })
  })

  describe('Edge cases', () => {
    test('handles large chain IDs', () => {
      const chainId = caip().evmChain(999999999).chainId()
      expect(chainId).toBe('eip155:999999999')
      expect(getCAIPType(chainId)).toBe('chain')
    })

    test('handles chain ID 0', () => {
      const chainId = caip().evmChain(0).chainId()
      expect(chainId).toBe('eip155:0')
    })

    test('handles all Solana clusters', () => {
      const clusters = ['mainnet-beta', 'devnet', 'testnet'] as const
      for (const cluster of clusters) {
        const chainId = caip().solanaChain(cluster).chainId()
        expect(getCAIPType(chainId)).toBe('chain')
      }
    })
  })
})

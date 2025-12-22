/**
 * CAIP-19 Asset Identification Tests
 *
 * Tests for asset type parsing, validation, and cross-chain asset mapping.
 */

import { describe, expect, test } from 'bun:test'
import {
  type AssetType,
  CROSS_CHAIN_ASSETS,
  caip19ToErc20Address,
  caip19ToSplMint,
  erc20ToCAIP19,
  erc721ToCAIP19,
  findEquivalentAsset,
  formatAssetType,
  getAssetChainMap,
  getAssetInfo,
  isValidAssetType,
  KNOWN_ASSETS,
  nativeCurrencyToCAIP19,
  parseAssetType,
  SLIP44,
  splTokenToCAIP19,
} from '../caip/assets'
import { SOLANA_DEVNET_GENESIS, SOLANA_MAINNET_GENESIS } from '../caip/chains'

// Test addresses
const USDC_ETH_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const VALID_EVM_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe('caip/assets.ts - CAIP-19 Asset Identification', () => {
  describe('parseAssetType', () => {
    test('parses ERC20 token correctly', () => {
      const caip19 = `eip155:1/erc20:${USDC_ETH_ADDRESS}`
      const result = parseAssetType(caip19)

      expect(result.chainId.namespace).toBe('eip155')
      expect(result.chainId.reference).toBe('1')
      expect(result.assetNamespace).toBe('erc20')
      expect(result.assetReference).toBe(USDC_ETH_ADDRESS)
      expect(result.tokenId).toBeUndefined()
    })

    test('parses native ETH (SLIP44) correctly', () => {
      const caip19 = 'eip155:1/slip44:60'
      const result = parseAssetType(caip19)

      expect(result.assetNamespace).toBe('slip44')
      expect(result.assetReference).toBe('60')
    })

    test('parses SPL token correctly', () => {
      const caip19 = `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`
      const result = parseAssetType(caip19)

      expect(result.chainId.namespace).toBe('solana')
      expect(result.assetNamespace).toBe('spl')
      expect(result.assetReference).toBe(USDC_SOLANA_MINT)
    })

    test('parses native SOL correctly', () => {
      const caip19 = `solana:${SOLANA_MAINNET_GENESIS}/native:SOL`
      const result = parseAssetType(caip19)

      expect(result.assetNamespace).toBe('native')
      expect(result.assetReference).toBe('SOL')
    })

    test('parses ERC721 with token ID', () => {
      const caip19 = `eip155:1/erc721:${VALID_EVM_ADDRESS}:12345`
      const result = parseAssetType(caip19)

      expect(result.assetNamespace).toBe('erc721')
      expect(result.assetReference).toBe(VALID_EVM_ADDRESS)
      expect(result.tokenId).toBe('12345')
    })

    test('parses ERC1155 with token ID', () => {
      const caip19 = `eip155:1/erc1155:${VALID_EVM_ADDRESS}:99`
      const result = parseAssetType(caip19)

      expect(result.assetNamespace).toBe('erc1155')
      expect(result.assetReference).toBe(VALID_EVM_ADDRESS)
      expect(result.tokenId).toBe('99')
    })

    test('throws on missing slash', () => {
      expect(() => parseAssetType('eip155:1erc20:0x123')).toThrow(
        'Invalid CAIP-19',
      )
    })

    test('throws on missing colon in asset part', () => {
      expect(() => parseAssetType('eip155:1/erc20')).toThrow('Invalid CAIP-19')
    })
  })

  describe('formatAssetType', () => {
    test('formats ERC20 correctly', () => {
      const asset: AssetType = {
        chainId: { namespace: 'eip155', reference: '1' },
        assetNamespace: 'erc20',
        assetReference: USDC_ETH_ADDRESS,
      }

      const result = formatAssetType(asset)
      expect(result).toBe(`eip155:1/erc20:${USDC_ETH_ADDRESS}`)
    })

    test('formats NFT with token ID', () => {
      const asset: AssetType = {
        chainId: { namespace: 'eip155', reference: '1' },
        assetNamespace: 'erc721',
        assetReference: VALID_EVM_ADDRESS,
        tokenId: '999',
      }

      const result = formatAssetType(asset)
      expect(result).toBe(`eip155:1/erc721:${VALID_EVM_ADDRESS}:999`)
    })

    test('round-trips correctly', () => {
      const original = `eip155:8453/erc20:${USDC_ETH_ADDRESS}`
      const parsed = parseAssetType(original)
      const formatted = formatAssetType(parsed)
      expect(formatted).toBe(original)
    })

    test('round-trips NFT correctly', () => {
      const original = `eip155:1/erc721:${VALID_EVM_ADDRESS}:42`
      const parsed = parseAssetType(original)
      const formatted = formatAssetType(parsed)
      expect(formatted).toBe(original)
    })
  })

  describe('getAssetInfo', () => {
    test('identifies native currency', () => {
      const info = getAssetInfo('eip155:1/slip44:60')

      expect(info.isNative).toBe(true)
      expect(info.isFungible).toBe(true)
      expect(info.isNFT).toBe(false)
    })

    test('identifies Solana native', () => {
      const info = getAssetInfo(`solana:${SOLANA_MAINNET_GENESIS}/native:SOL`)

      expect(info.isNative).toBe(true)
      expect(info.isFungible).toBe(true)
      expect(info.isNFT).toBe(false)
    })

    test('identifies ERC20 as fungible', () => {
      const info = getAssetInfo(`eip155:1/erc20:${USDC_ETH_ADDRESS}`)

      expect(info.isNative).toBe(false)
      expect(info.isFungible).toBe(true)
      expect(info.isNFT).toBe(false)
      expect(info.namespace).toBe('erc20')
    })

    test('identifies SPL token as fungible', () => {
      const info = getAssetInfo(
        `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`,
      )

      expect(info.isFungible).toBe(true)
      expect(info.isNFT).toBe(false)
    })

    test('identifies ERC721 as NFT', () => {
      const info = getAssetInfo(`eip155:1/erc721:${VALID_EVM_ADDRESS}:1`)

      expect(info.isNative).toBe(false)
      expect(info.isFungible).toBe(false)
      expect(info.isNFT).toBe(true)
    })

    test('identifies ERC1155 as NFT', () => {
      const info = getAssetInfo(`eip155:1/erc1155:${VALID_EVM_ADDRESS}:1`)

      expect(info.isNFT).toBe(true)
    })

    test('includes token ID in info', () => {
      const info = getAssetInfo(`eip155:1/erc721:${VALID_EVM_ADDRESS}:999`)

      expect(info.tokenId).toBe('999')
    })
  })

  describe('isValidAssetType', () => {
    test('validates ERC20 with valid address', () => {
      expect(isValidAssetType(`eip155:1/erc20:${USDC_ETH_ADDRESS}`)).toBe(true)
    })

    test('validates SLIP44 with valid coin type', () => {
      expect(isValidAssetType('eip155:1/slip44:60')).toBe(true)
    })

    test('validates SPL token with valid mint', () => {
      expect(
        isValidAssetType(
          `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`,
        ),
      ).toBe(true)
    })

    test('validates native SOL', () => {
      expect(
        isValidAssetType(`solana:${SOLANA_MAINNET_GENESIS}/native:SOL`),
      ).toBe(true)
    })

    test('validates ERC721 with valid address', () => {
      expect(isValidAssetType(`eip155:1/erc721:${VALID_EVM_ADDRESS}:123`)).toBe(
        true,
      )
    })

    test('rejects ERC20 with invalid address', () => {
      expect(isValidAssetType('eip155:1/erc20:invalid')).toBe(false)
    })

    test('rejects SPL with invalid mint', () => {
      expect(
        isValidAssetType(`solana:${SOLANA_MAINNET_GENESIS}/spl:invalid!!`),
      ).toBe(false)
    })

    test('rejects malformed CAIP-19', () => {
      expect(isValidAssetType('not-valid')).toBe(false)
    })
  })

  describe('nativeCurrencyToCAIP19', () => {
    test('creates ETH CAIP-19 from numeric chain ID', () => {
      const result = nativeCurrencyToCAIP19(1)
      expect(result).toBe(`eip155:1/slip44:${SLIP44.ETH}`)
    })

    test('handles different EVM chains', () => {
      expect(nativeCurrencyToCAIP19(8453)).toBe('eip155:8453/slip44:60')
      expect(nativeCurrencyToCAIP19(137)).toBe('eip155:137/slip44:60')
    })

    test('creates SOL CAIP-19 from Solana chain ID', () => {
      const result = nativeCurrencyToCAIP19(`solana:${SOLANA_MAINNET_GENESIS}`)
      expect(result).toBe(`solana:${SOLANA_MAINNET_GENESIS}/native:SOL`)
    })

    test('throws on unsupported chain format', () => {
      expect(() => nativeCurrencyToCAIP19('cosmos:cosmoshub-4')).toThrow(
        'Unsupported chain',
      )
    })
  })

  describe('erc20ToCAIP19', () => {
    test('creates valid CAIP-19 for ERC20', () => {
      const result = erc20ToCAIP19(1, USDC_ETH_ADDRESS)
      expect(result).toContain('eip155:1/erc20:')
      expect(isValidAssetType(result)).toBe(true)
    })

    test('checksums the address', () => {
      const lowercase = USDC_ETH_ADDRESS.toLowerCase()
      const result = erc20ToCAIP19(1, lowercase)
      expect(result).toContain(USDC_ETH_ADDRESS) // Checksummed
    })

    test('throws on invalid address', () => {
      expect(() => erc20ToCAIP19(1, 'invalid')).toThrow('Invalid ERC20 address')
    })
  })

  describe('splTokenToCAIP19', () => {
    test('creates valid CAIP-19 for SPL token on mainnet', () => {
      const result = splTokenToCAIP19(USDC_SOLANA_MINT, 'mainnet-beta')
      expect(result).toBe(
        `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`,
      )
    })

    test('creates valid CAIP-19 for SPL token on devnet', () => {
      const result = splTokenToCAIP19(USDC_SOLANA_MINT, 'devnet')
      expect(result).toBe(
        `solana:${SOLANA_DEVNET_GENESIS}/spl:${USDC_SOLANA_MINT}`,
      )
    })

    test('defaults to mainnet-beta', () => {
      const result = splTokenToCAIP19(USDC_SOLANA_MINT)
      expect(result).toContain(SOLANA_MAINNET_GENESIS)
    })
  })

  describe('erc721ToCAIP19', () => {
    test('creates valid CAIP-19 for ERC721', () => {
      const result = erc721ToCAIP19(1, VALID_EVM_ADDRESS, 123)
      expect(result).toBe(`eip155:1/erc721:${VALID_EVM_ADDRESS}:123`)
    })

    test('handles string token ID', () => {
      const result = erc721ToCAIP19(1, VALID_EVM_ADDRESS, '999')
      expect(result).toContain(':999')
    })

    test('throws on invalid contract address', () => {
      expect(() => erc721ToCAIP19(1, 'invalid', 1)).toThrow(
        'Invalid contract address',
      )
    })
  })

  describe('caip19ToErc20Address', () => {
    test('extracts ERC20 address from CAIP-19', () => {
      const caip19 = `eip155:1/erc20:${USDC_ETH_ADDRESS}`
      const result = caip19ToErc20Address(caip19)

      expect(result?.toLowerCase()).toBe(USDC_ETH_ADDRESS.toLowerCase())
    })

    test('returns undefined for non-ERC20', () => {
      expect(caip19ToErc20Address('eip155:1/slip44:60')).toBeUndefined()
      expect(
        caip19ToErc20Address(`eip155:1/erc721:${VALID_EVM_ADDRESS}:1`),
      ).toBeUndefined()
    })
  })

  describe('caip19ToSplMint', () => {
    test('extracts SPL mint from CAIP-19', () => {
      const caip19 = `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`
      const result = caip19ToSplMint(caip19)

      expect(result).toBeDefined()
      expect(result?.toBase58()).toBe(USDC_SOLANA_MINT)
    })

    test('returns undefined for non-SPL', () => {
      expect(
        caip19ToSplMint(`solana:${SOLANA_MAINNET_GENESIS}/native:SOL`),
      ).toBeUndefined()
      expect(
        caip19ToSplMint(`eip155:1/erc20:${USDC_ETH_ADDRESS}`),
      ).toBeUndefined()
    })
  })

  describe('findEquivalentAsset', () => {
    test('finds USDC on different chains', () => {
      const ethUsdc =
        'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

      const baseUsdc = findEquivalentAsset(ethUsdc, 'eip155:8453')
      expect(baseUsdc).toBeDefined()
      expect(baseUsdc).toContain('eip155:8453')
    })

    test('finds USDC on Solana from Ethereum', () => {
      const ethUsdc =
        'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

      const solUsdc = findEquivalentAsset(
        ethUsdc,
        `solana:${SOLANA_MAINNET_GENESIS}`,
      )
      expect(solUsdc).toBeDefined()
      expect(solUsdc).toContain(USDC_SOLANA_MINT)
    })

    test('returns undefined for unknown asset', () => {
      const unknown = `eip155:1/erc20:${VALID_EVM_ADDRESS}`
      const result = findEquivalentAsset(unknown, 'eip155:8453')
      expect(result).toBeUndefined()
    })

    test('returns undefined for unsupported target chain', () => {
      const ethUsdc =
        'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      const result = findEquivalentAsset(ethUsdc, 'cosmos:cosmoshub-4')
      expect(result).toBeUndefined()
    })
  })

  describe('getAssetChainMap', () => {
    test('returns chain map for USDC', () => {
      const map = getAssetChainMap('USDC')
      expect(map).toBeDefined()
      expect(map?.size).toBeGreaterThan(0)
      expect(map?.has('eip155:1')).toBe(true)
    })

    test('returns chain map for USDT', () => {
      const map = getAssetChainMap('USDT')
      expect(map).toBeDefined()
      expect(map?.has('eip155:1')).toBe(true)
    })

    test('returns undefined for unknown symbol', () => {
      const map = getAssetChainMap('UNKNOWN_TOKEN')
      expect(map).toBeUndefined()
    })
  })

  describe('SLIP44 constants', () => {
    test('has correct coin types', () => {
      expect(SLIP44.ETH).toBe(60)
      expect(SLIP44.BTC).toBe(0)
      expect(SLIP44.SOL).toBe(501)
    })
  })

  describe('KNOWN_ASSETS', () => {
    test('includes USDT on Ethereum', () => {
      const key = 'eip155:1/erc20:0xdAC17F958D2ee523a2206206994597C13D831ec7'
      const asset = KNOWN_ASSETS[key]
      expect(asset).toBeDefined()
      expect(asset?.symbol).toBe('USDT')
      expect(asset?.decimals).toBe(6)
    })

    test('includes USDC on Ethereum', () => {
      const key = 'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      const asset = KNOWN_ASSETS[key]
      expect(asset).toBeDefined()
      expect(asset?.symbol).toBe('USDC')
    })
  })

  describe('CROSS_CHAIN_ASSETS', () => {
    test('USDC is defined', () => {
      const usdc = CROSS_CHAIN_ASSETS.get('USDC')
      expect(usdc).toBeDefined()
      expect(usdc?.symbol).toBe('USDC')
      expect(usdc?.decimals).toBe(6)
    })

    test('USDC has multiple chains', () => {
      const usdc = CROSS_CHAIN_ASSETS.get('USDC')
      expect(usdc?.chains.size).toBeGreaterThan(2)
    })

    test('USDT is defined', () => {
      const usdt = CROSS_CHAIN_ASSETS.get('USDT')
      expect(usdt).toBeDefined()
      expect(usdt?.symbol).toBe('USDT')
    })
  })

  describe('Property-based tests', () => {
    function randomEvmAddress(): string {
      const chars = '0123456789abcdef'
      let addr = '0x'
      for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * chars.length)]
      }
      return addr
    }

    test('parseAssetType and formatAssetType are inverse for ERC20', () => {
      for (let i = 0; i < 50; i++) {
        const addr = randomEvmAddress()
        const chainId = Math.floor(Math.random() * 100000)
        const original = `eip155:${chainId}/erc20:${addr}`

        const parsed = parseAssetType(original)
        const formatted = formatAssetType(parsed)
        const reParsed = parseAssetType(formatted)

        expect(reParsed.assetReference.toLowerCase()).toBe(
          parsed.assetReference.toLowerCase(),
        )
        expect(reParsed.assetNamespace).toBe(parsed.assetNamespace)
      }
    })

    test('erc20ToCAIP19 always produces valid CAIP-19', () => {
      for (let i = 0; i < 50; i++) {
        const addr = randomEvmAddress()
        const chainId = Math.floor(Math.random() * 100000)
        const caip19 = erc20ToCAIP19(chainId, addr)

        expect(isValidAssetType(caip19)).toBe(true)
      }
    })

    test('getAssetInfo correctly identifies fungibility', () => {
      const testCases = [
        { caip: 'eip155:1/slip44:60', fungible: true, nft: false },
        {
          caip: `eip155:1/erc20:${USDC_ETH_ADDRESS}`,
          fungible: true,
          nft: false,
        },
        {
          caip: `eip155:1/erc721:${VALID_EVM_ADDRESS}:1`,
          fungible: false,
          nft: true,
        },
        {
          caip: `eip155:1/erc1155:${VALID_EVM_ADDRESS}:1`,
          fungible: false,
          nft: true,
        },
        {
          caip: `solana:${SOLANA_MAINNET_GENESIS}/native:SOL`,
          fungible: true,
          nft: false,
        },
        {
          caip: `solana:${SOLANA_MAINNET_GENESIS}/spl:${USDC_SOLANA_MINT}`,
          fungible: true,
          nft: false,
        },
      ]

      for (const tc of testCases) {
        const info = getAssetInfo(tc.caip)
        expect(info.isFungible).toBe(tc.fungible)
        expect(info.isNFT).toBe(tc.nft)
      }
    })
  })
})

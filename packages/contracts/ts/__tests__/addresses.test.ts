/**
 * CAIP-10 Account Identification Tests
 *
 * Tests for address parsing, validation, and conversion across EVM and Solana.
 */

import { describe, expect, test } from 'bun:test'
import {
  type AccountId,
  areAddressesEqual,
  bytes32ToAddress,
  caip10ToEvmAddress,
  caip10ToSolanaPublicKey,
  createMultiChainAddress,
  createUniversalAddress,
  evmAddressToCAIP10,
  formatAccountId,
  isValidAccountId,
  isValidEvmAddress,
  isValidSolanaAddress,
  parseAccountId,
  shortenAddress,
  solanaAddressToCAIP10,
} from '../caip/addresses'
import { SOLANA_DEVNET_GENESIS, SOLANA_MAINNET_GENESIS } from '../caip/chains'

// Test addresses
const VALID_EVM_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' // vitalik.eth
const VALID_EVM_ADDRESS_LOWERCASE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const VALID_SOLANA_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC mint

describe('caip/addresses.ts - CAIP-10 Account Identification', () => {
  describe('parseAccountId', () => {
    test('parses EVM CAIP-10 correctly', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
      const result = parseAccountId(caip10)

      expect(result.chainId.namespace).toBe('eip155')
      expect(result.chainId.reference).toBe('1')
      expect(result.address).toBe(VALID_EVM_ADDRESS)
    })

    test('parses Solana CAIP-10 correctly', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      const result = parseAccountId(caip10)

      expect(result.chainId.namespace).toBe('solana')
      expect(result.chainId.reference).toBe(SOLANA_MAINNET_GENESIS)
      expect(result.address).toBe(VALID_SOLANA_ADDRESS)
    })

    test('handles multi-digit chain references', () => {
      const caip10 = `eip155:42161:${VALID_EVM_ADDRESS}`
      const result = parseAccountId(caip10)

      expect(result.chainId.reference).toBe('42161')
    })

    test('throws on invalid format - no colon', () => {
      expect(() => parseAccountId('invalid')).toThrow('Invalid CAIP-10')
    })

    test('throws on invalid format - only one colon', () => {
      expect(() => parseAccountId('eip155:1')).toThrow('Invalid CAIP-10')
    })

    test('handles addresses with colons', () => {
      // Some edge case - shouldn't happen in practice but test robustness
      const caip10 = 'eip155:1:0x1234:extra'
      const result = parseAccountId(caip10)
      expect(result.address).toBe('0x1234:extra')
    })
  })

  describe('formatAccountId', () => {
    test('formats EVM account ID correctly', () => {
      const accountId: AccountId = {
        chainId: { namespace: 'eip155', reference: '1' },
        address: VALID_EVM_ADDRESS,
      }

      const result = formatAccountId(accountId)
      expect(result).toBe(`eip155:1:${VALID_EVM_ADDRESS}`)
    })

    test('formats Solana account ID correctly', () => {
      const accountId: AccountId = {
        chainId: { namespace: 'solana', reference: SOLANA_MAINNET_GENESIS },
        address: VALID_SOLANA_ADDRESS,
      }

      const result = formatAccountId(accountId)
      expect(result).toBe(
        `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`,
      )
    })

    test('round-trips correctly', () => {
      const original = `eip155:137:${VALID_EVM_ADDRESS}`
      const parsed = parseAccountId(original)
      const formatted = formatAccountId(parsed)
      expect(formatted).toBe(original)
    })
  })

  describe('createUniversalAddress', () => {
    test('creates universal address for EVM', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS_LOWERCASE}`
      const result = createUniversalAddress(caip10)

      expect(result.isEvm).toBe(true)
      expect(result.isSolana).toBe(false)
      expect(result.address).toBe(VALID_EVM_ADDRESS_LOWERCASE)
      // Normalized should be checksummed
      expect(result.normalized).toBe(VALID_EVM_ADDRESS)
    })

    test('creates universal address for Solana', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      const result = createUniversalAddress(caip10)

      expect(result.isEvm).toBe(false)
      expect(result.isSolana).toBe(true)
      expect(result.address).toBe(VALID_SOLANA_ADDRESS)
      expect(result.normalized).toBe(VALID_SOLANA_ADDRESS)
    })

    test('caip10 property contains normalized address', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS_LOWERCASE}`
      const result = createUniversalAddress(caip10)

      expect(result.caip10).toContain(VALID_EVM_ADDRESS) // Checksummed
    })
  })

  describe('isValidAccountId', () => {
    test('validates correct EVM account ID', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
      expect(isValidAccountId(caip10)).toBe(true)
    })

    test('validates correct Solana account ID', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      expect(isValidAccountId(caip10)).toBe(true)
    })

    test('rejects invalid EVM address', () => {
      const caip10 = 'eip155:1:0xinvalid'
      expect(isValidAccountId(caip10)).toBe(false)
    })

    test('rejects invalid Solana address', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:invalid!!`
      expect(isValidAccountId(caip10)).toBe(false)
    })

    test('rejects malformed CAIP-10', () => {
      expect(isValidAccountId('not-a-caip')).toBe(false)
      expect(isValidAccountId('')).toBe(false)
    })
  })

  describe('isValidSolanaAddress', () => {
    test('validates correct Solana address', () => {
      expect(isValidSolanaAddress(VALID_SOLANA_ADDRESS)).toBe(true)
    })

    test('validates another Solana address', () => {
      // Serum DEX program
      expect(
        isValidSolanaAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'),
      ).toBe(true)
    })

    test('rejects invalid addresses', () => {
      expect(isValidSolanaAddress('invalid')).toBe(false)
      expect(isValidSolanaAddress('0x1234')).toBe(false)
      expect(isValidSolanaAddress('')).toBe(false)
    })
  })

  describe('isValidEvmAddress', () => {
    test('validates correct EVM address', () => {
      expect(isValidEvmAddress(VALID_EVM_ADDRESS)).toBe(true)
    })

    test('validates lowercase address', () => {
      expect(isValidEvmAddress(VALID_EVM_ADDRESS_LOWERCASE)).toBe(true)
    })

    test('validates zero address', () => {
      expect(
        isValidEvmAddress('0x0000000000000000000000000000000000000000'),
      ).toBe(true)
    })

    test('rejects invalid addresses', () => {
      expect(isValidEvmAddress('invalid')).toBe(false)
      expect(isValidEvmAddress('0x123')).toBe(false) // Too short
      expect(isValidEvmAddress('')).toBe(false)
    })
  })

  describe('evmAddressToCAIP10', () => {
    test('converts EVM address to CAIP-10', () => {
      const result = evmAddressToCAIP10(1, VALID_EVM_ADDRESS_LOWERCASE)

      expect(result).toContain('eip155:1:')
      expect(result).toContain(VALID_EVM_ADDRESS) // Should be checksummed
    })

    test('handles different chain IDs', () => {
      expect(evmAddressToCAIP10(8453, VALID_EVM_ADDRESS)).toContain(
        'eip155:8453:',
      )
      expect(evmAddressToCAIP10(137, VALID_EVM_ADDRESS)).toContain(
        'eip155:137:',
      )
    })

    test('throws on invalid address', () => {
      expect(() => evmAddressToCAIP10(1, 'invalid')).toThrow(
        'Invalid EVM address',
      )
    })
  })

  describe('solanaAddressToCAIP10', () => {
    test('converts Solana address to CAIP-10 mainnet', () => {
      const result = solanaAddressToCAIP10(VALID_SOLANA_ADDRESS, 'mainnet-beta')

      expect(result).toBe(
        `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`,
      )
    })

    test('converts Solana address to CAIP-10 devnet', () => {
      const result = solanaAddressToCAIP10(VALID_SOLANA_ADDRESS, 'devnet')

      expect(result).toBe(
        `solana:${SOLANA_DEVNET_GENESIS}:${VALID_SOLANA_ADDRESS}`,
      )
    })

    test('defaults to mainnet-beta', () => {
      const result = solanaAddressToCAIP10(VALID_SOLANA_ADDRESS)
      expect(result).toContain(SOLANA_MAINNET_GENESIS)
    })
  })

  describe('caip10ToEvmAddress', () => {
    test('extracts EVM address from CAIP-10', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS_LOWERCASE}`
      const result = caip10ToEvmAddress(caip10)

      expect(result).toBe(VALID_EVM_ADDRESS)
    })

    test('returns undefined for Solana CAIP-10', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      const result = caip10ToEvmAddress(caip10)

      expect(result).toBeUndefined()
    })
  })

  describe('caip10ToSolanaPublicKey', () => {
    test('extracts Solana PublicKey from CAIP-10', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      const result = caip10ToSolanaPublicKey(caip10)

      expect(result).toBeDefined()
      expect(result?.toBase58()).toBe(VALID_SOLANA_ADDRESS)
    })

    test('returns undefined for EVM CAIP-10', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
      const result = caip10ToSolanaPublicKey(caip10)

      expect(result).toBeUndefined()
    })
  })

  describe('createMultiChainAddress', () => {
    test('creates multi-chain address for EVM', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
      const result = createMultiChainAddress(caip10)

      expect(result.original).toBe(VALID_EVM_ADDRESS)
      expect(result.evm).toBe(VALID_EVM_ADDRESS)
      expect(result.solana).toBeUndefined()
      expect(result.bytes32.length).toBe(32)

      // EVM addresses are right-aligned in 32 bytes (first 12 bytes are zero)
      const first12 = result.bytes32.slice(0, 12)
      expect(first12.every((b) => b === 0)).toBe(true)
    })

    test('creates multi-chain address for Solana', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      const result = createMultiChainAddress(caip10)

      expect(result.original).toBe(VALID_SOLANA_ADDRESS)
      expect(result.evm).toBeUndefined()
      expect(result.solana).toBeDefined()
      expect(result.solana?.toBase58()).toBe(VALID_SOLANA_ADDRESS)
      expect(result.bytes32.length).toBe(32)
    })
  })

  describe('bytes32ToAddress', () => {
    test('converts bytes32 back to EVM address', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
      const multiChain = createMultiChainAddress(caip10)

      const result = bytes32ToAddress(multiChain.bytes32, true)
      expect(result.toLowerCase()).toBe(VALID_EVM_ADDRESS.toLowerCase())
    })

    test('converts bytes32 back to Solana address', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      const multiChain = createMultiChainAddress(caip10)

      const result = bytes32ToAddress(multiChain.bytes32, false)
      expect(result).toBe(VALID_SOLANA_ADDRESS)
    })
  })

  describe('areAddressesEqual', () => {
    test('returns true for same EVM address different case', () => {
      const a = `eip155:1:${VALID_EVM_ADDRESS}`
      const b = `eip155:1:${VALID_EVM_ADDRESS_LOWERCASE}`

      expect(areAddressesEqual(a, b)).toBe(true)
    })

    test('returns true for identical addresses', () => {
      const a = `eip155:1:${VALID_EVM_ADDRESS}`
      expect(areAddressesEqual(a, a)).toBe(true)
    })

    test('returns false for different addresses same chain', () => {
      const a = `eip155:1:${VALID_EVM_ADDRESS}`
      const b = 'eip155:1:0x0000000000000000000000000000000000000000'

      expect(areAddressesEqual(a, b)).toBe(false)
    })

    test('returns false for same address different chains', () => {
      const a = `eip155:1:${VALID_EVM_ADDRESS}`
      const b = `eip155:8453:${VALID_EVM_ADDRESS}`

      expect(areAddressesEqual(a, b)).toBe(false)
    })

    test('returns false for invalid addresses', () => {
      expect(areAddressesEqual('invalid', 'eip155:1:0x1234')).toBe(false)
    })
  })

  describe('shortenAddress', () => {
    test('shortens EVM address with default chars', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
      const result = shortenAddress(caip10)

      // Default is 4 chars after 0x prefix: "0xd8dA...6045"
      expect(result).toMatch(/^0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}$/)
      expect(result.includes('...')).toBe(true)
    })

    test('shortens with custom char count', () => {
      const caip10 = `eip155:1:${VALID_EVM_ADDRESS}`
      const result = shortenAddress(caip10, 6)

      // 6 chars after 0x prefix: "0xd8dA6B...A96045"
      expect(result).toMatch(/^0x[a-fA-F0-9]{6}\.\.\.[a-fA-F0-9]{6}$/)
    })

    test('returns full address if too short to shorten', () => {
      const caip10 = 'eip155:1:0x12'
      const result = shortenAddress(caip10)

      expect(result).toBe('0x12')
    })

    test('shortens Solana address', () => {
      const caip10 = `solana:${SOLANA_MAINNET_GENESIS}:${VALID_SOLANA_ADDRESS}`
      const result = shortenAddress(caip10)

      expect(result).toContain('...')
      expect(result.length).toBeLessThan(VALID_SOLANA_ADDRESS.length)
    })
  })

  describe('Property-based tests', () => {
    // Random EVM address generator
    function randomEvmAddress(): string {
      const chars = '0123456789abcdef'
      let addr = '0x'
      for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * chars.length)]
      }
      return addr
    }

    test('evmAddressToCAIP10 always produces valid CAIP-10', () => {
      for (let i = 0; i < 50; i++) {
        const addr = randomEvmAddress()
        const chainId = Math.floor(Math.random() * 100000)
        const caip10 = evmAddressToCAIP10(chainId, addr)

        expect(isValidAccountId(caip10)).toBe(true)
      }
    })

    test('parseAccountId and formatAccountId are inverse operations', () => {
      for (let i = 0; i < 50; i++) {
        const addr = randomEvmAddress()
        const chainId = Math.floor(Math.random() * 100000)
        const original = `eip155:${chainId}:${addr}`

        const parsed = parseAccountId(original)
        const formatted = formatAccountId(parsed)
        const reParsed = parseAccountId(formatted)

        // Addresses should match (case-insensitive due to checksumming)
        expect(reParsed.address.toLowerCase()).toBe(
          parsed.address.toLowerCase(),
        )
        expect(reParsed.chainId.namespace).toBe(parsed.chainId.namespace)
        expect(reParsed.chainId.reference).toBe(parsed.chainId.reference)
      }
    })

    test('areAddressesEqual is symmetric', () => {
      for (let i = 0; i < 20; i++) {
        const addr1 = randomEvmAddress()
        const addr2 = randomEvmAddress()
        const caip1 = `eip155:1:${addr1}`
        const caip2 = `eip155:1:${addr2}`

        expect(areAddressesEqual(caip1, caip2)).toBe(
          areAddressesEqual(caip2, caip1),
        )
      }
    })
  })
})

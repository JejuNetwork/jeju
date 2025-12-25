/**
 * @fileoverview Comprehensive tests for address utilities
 * Tests address conversion, padding, and bytes32 transformations
 * Includes property-based testing for address transformations
 */

import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { addressToBytes32, bytes32ToAddress } from '../utils/address'

// addressToBytes32 - CORE CONVERSION

describe('addressToBytes32 - Standard Addresses', () => {
  test('converts standard 40-char address', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const result = addressToBytes32(address)

    expect(result.length).toBe(66) // 0x + 64 hex chars
    expect(result.startsWith('0x')).toBe(true)
    expect(result).toBe(
      '0x0000000000000000000000001234567890123456789012345678901234567890',
    )
  })

  test('converts zero address', () => {
    const address = '0x0000000000000000000000000000000000000000'
    const result = addressToBytes32(address)

    expect(result).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
  })

  test('converts checksummed address', () => {
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const result = addressToBytes32(address)

    // Should be lowercase in output
    expect(result.toLowerCase()).toBe(
      '0x0000000000000000000000005aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
    )
  })

  test('converts all-lowercase address', () => {
    const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const result = addressToBytes32(address)

    expect(result).toBe(
      '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    )
  })

  test('converts all-uppercase address', () => {
    const address = '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD'
    const result = addressToBytes32(address)

    // Output should be lowercase
    expect(result).toBe(
      '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    )
  })
})

describe('addressToBytes32 - Case Normalization', () => {
  test('normalizes mixed case to lowercase', () => {
    const mixedCase = '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd'
    const result = addressToBytes32(mixedCase)

    expect(result.includes('A')).toBe(false)
    expect(result.includes('B')).toBe(false)
    expect(result.includes('C')).toBe(false)
    expect(result.includes('D')).toBe(false)
    expect(result.includes('E')).toBe(false)
    expect(result.includes('F')).toBe(false)
  })

  test('handles EIP-55 checksummed addresses', () => {
    // Common checksummed addresses
    const addresses = [
      '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0x6B175474E89094C44Da98b954EedcdEAC495271d', // DAI-like (valid hex)
    ]

    for (const addr of addresses) {
      const result = addressToBytes32(addr)
      expect(result.length).toBe(66)
      expect(result.startsWith('0x')).toBe(true)
    }
  })
})

describe('addressToBytes32 - Padding', () => {
  test('left-pads with 24 zeros (12 bytes)', () => {
    const address = '0xffffffffffffffffffffffffffffffffffffffff'
    const result = addressToBytes32(address)

    // First 24 chars after 0x should be zeros
    const padding = result.slice(2, 26)
    expect(padding).toBe('000000000000000000000000')
  })

  test('preserves address in last 40 chars', () => {
    const address = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const result = addressToBytes32(address)

    const last40 = result.slice(-40)
    expect(last40).toBe('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  })

  test('rejects short addresses (security validation)', () => {
    // Short addresses should be rejected for security - proper EVM addresses are always 40 hex chars
    const shortAddress = '0x1'
    expect(() => addressToBytes32(shortAddress)).toThrow(
      'Invalid EVM address format',
    )
  })

  test('rejects addresses with wrong length', () => {
    const wrongLength = '0x123456' // Too short
    expect(() => addressToBytes32(wrongLength)).toThrow(
      'Invalid EVM address format',
    )
  })
})

// bytes32ToAddress - REVERSE CONVERSION

describe('bytes32ToAddress - Standard Conversion', () => {
  test('extracts address from padded bytes32', () => {
    const bytes32 =
      '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd' as Hex
    const result = bytes32ToAddress(bytes32)

    expect(result.length).toBe(42)
    expect(result.startsWith('0x')).toBe(true)
    expect(result).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
  })

  test('extracts zero address', () => {
    const bytes32 =
      '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
    const result = bytes32ToAddress(bytes32)

    expect(result).toBe('0x0000000000000000000000000000000000000000')
  })

  test('extracts address from minimal padding', () => {
    const bytes32 =
      '0x000000000000000000000000ffffffffffffffffffffffffffffffffffffffff' as Hex
    const result = bytes32ToAddress(bytes32)

    expect(result).toBe('0xffffffffffffffffffffffffffffffffffffffff')
  })
})

describe('bytes32ToAddress - Edge Cases', () => {
  test('handles bytes32 with non-zero upper bytes', () => {
    // If the upper bytes contain data, they are discarded
    const bytes32 =
      '0xdeadbeef000000000000000012345678901234567890123456789012345678ab' as Hex
    const result = bytes32ToAddress(bytes32)

    // Only last 40 chars (20 bytes) are extracted
    // Input: deadbeef000000000000000012345678901234567890123456789012345678ab
    //        ^^^^^^^^^^^^^^^^^^^^^^^^|--- last 40 chars: 12345678901234567890123456789012345678ab
    expect(result).toBe('0x12345678901234567890123456789012345678ab')
  })

  test('handles short bytes32 (non-standard)', () => {
    // Implementation behavior with shorter input
    const shortBytes =
      '0x00000000000000000000000000000000000000000000000000000000000001' as Hex
    const result = bytes32ToAddress(shortBytes)

    // Takes last 40 chars
    expect(result.length).toBe(42)
  })
})

// ROUND TRIP - addressToBytes32 -> bytes32ToAddress

describe('Round Trip Conversion', () => {
  test('recovers original address from bytes32', () => {
    const addresses = [
      '0x1234567890123456789012345678901234567890',
      '0x0000000000000000000000000000000000000001',
      '0xffffffffffffffffffffffffffffffffffffffff',
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ]

    for (const original of addresses) {
      const bytes32 = addressToBytes32(original)
      const recovered = bytes32ToAddress(bytes32)
      expect(recovered.toLowerCase()).toBe(original.toLowerCase())
    }
  })

  test('round trip preserves address (lowercase)', () => {
    const address = '0xabcdef0123456789abcdef0123456789abcdef01'
    const bytes32 = addressToBytes32(address)
    const recovered = bytes32ToAddress(bytes32)

    expect(recovered).toBe(address)
  })

  test('round trip normalizes case', () => {
    const mixedCase = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01'
    const bytes32 = addressToBytes32(mixedCase)
    const recovered = bytes32ToAddress(bytes32)

    // Result should be lowercase
    expect(recovered).toBe('0xabcdef0123456789abcdef0123456789abcdef01')
  })
})

// PROPERTY-BASED TESTING (FUZZING)

describe('Property-Based Testing', () => {
  // Generate random valid addresses
  function generateRandomAddress(): string {
    const chars = '0123456789abcdef'
    let addr = '0x'
    for (let i = 0; i < 40; i++) {
      addr += chars[Math.floor(Math.random() * 16)]
    }
    return addr
  }

  const randomAddresses = Array.from({ length: 100 }, generateRandomAddress)

  test('bytes32 output is always 66 characters', () => {
    for (const addr of randomAddresses) {
      const result = addressToBytes32(addr)
      expect(result.length).toBe(66)
    }
  })

  test('bytes32 output always starts with 0x', () => {
    for (const addr of randomAddresses) {
      const result = addressToBytes32(addr)
      expect(result.startsWith('0x')).toBe(true)
    }
  })

  test('bytes32 output is valid hex', () => {
    const hexPattern = /^0x[0-9a-f]{64}$/
    for (const addr of randomAddresses) {
      const result = addressToBytes32(addr)
      expect(hexPattern.test(result)).toBe(true)
    }
  })

  test('round trip always recovers original (lowercase)', () => {
    for (const addr of randomAddresses) {
      const bytes32 = addressToBytes32(addr)
      const recovered = bytes32ToAddress(bytes32)
      expect(recovered.toLowerCase()).toBe(addr.toLowerCase())
    }
  })

  test('address output is always 42 characters', () => {
    for (const addr of randomAddresses) {
      const bytes32 = addressToBytes32(addr)
      const recovered = bytes32ToAddress(bytes32)
      expect(recovered.length).toBe(42)
    }
  })

  test('address output always starts with 0x', () => {
    for (const addr of randomAddresses) {
      const bytes32 = addressToBytes32(addr)
      const recovered = bytes32ToAddress(bytes32)
      expect(recovered.startsWith('0x')).toBe(true)
    }
  })

  test('deterministic: same input always produces same output', () => {
    for (const addr of randomAddresses.slice(0, 10)) {
      const result1 = addressToBytes32(addr)
      const result2 = addressToBytes32(addr)
      const result3 = addressToBytes32(addr)
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    }
  })
})

// HYPERLANE COMPATIBILITY

describe('Hyperlane Cross-Chain Format', () => {
  test('format matches Hyperlane bytes32 recipient format', () => {
    // Hyperlane uses bytes32 for cross-chain message recipients
    const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0AB33'
    const bytes32 = addressToBytes32(address)

    // Should be left-padded to 32 bytes (64 hex chars)
    expect(bytes32.slice(2).length).toBe(64)

    // First 24 chars (12 bytes) should be zeros
    expect(bytes32.slice(2, 26)).toBe('000000000000000000000000')

    // Last 40 chars should contain the address
    expect(bytes32.slice(-40).toLowerCase()).toBe(
      address.slice(2).toLowerCase(),
    )
  })

  test('can decode Hyperlane bytes32 sender', () => {
    // Example bytes32 from Hyperlane message
    const bytes32 =
      '0x000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f0ab33' as Hex
    const address = bytes32ToAddress(bytes32)

    expect(address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0ab33')
  })

  test('handles cross-chain token transfer addresses', () => {
    // Common patterns in cross-chain scenarios
    const testCases = [
      '0x0000000000000000000000000000000000000001', // Precompile addresses
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // Native token placeholder
      '0xdead000000000000000000000000000000000000', // Dead address
    ]

    for (const addr of testCases) {
      const bytes32 = addressToBytes32(addr)
      const recovered = bytes32ToAddress(bytes32)
      expect(recovered.toLowerCase()).toBe(addr.toLowerCase())
    }
  })
})

// TYPE SAFETY

describe('Type Safety', () => {
  test('addressToBytes32 returns Hex type', () => {
    const result = addressToBytes32(
      '0x1234567890123456789012345678901234567890',
    )

    // Type assertion - TypeScript should accept this as Hex
    const hex: Hex = result
    expect(hex).toBeDefined()
  })

  test('bytes32ToAddress returns Address type', () => {
    const bytes32 =
      '0x0000000000000000000000001234567890123456789012345678901234567890' as Hex
    const result = bytes32ToAddress(bytes32)

    // Type assertion - TypeScript should accept this as Address
    const address: Address = result
    expect(address).toBeDefined()
  })
})

// COMMON CONTRACT ADDRESSES

describe('Well-Known Addresses', () => {
  const wellKnownAddresses: [string, string][] = [
    ['USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7'],
    ['USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
    ['WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
    ['Uniswap V2 Router', '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'],
    ['Uniswap V3 Router', '0xe592427a0aece92de3edee1f18e0157c05861564'],
  ]

  test('correctly converts well-known contract addresses', () => {
    for (const [_name, address] of wellKnownAddresses) {
      const bytes32 = addressToBytes32(address)
      const recovered = bytes32ToAddress(bytes32)
      expect(recovered.toLowerCase()).toBe(address.toLowerCase())
    }
  })

  test('maintains consistency across conversions', () => {
    for (const [, address] of wellKnownAddresses) {
      // Multiple round trips should produce same result
      let current = address
      for (let i = 0; i < 3; i++) {
        const bytes32 = addressToBytes32(current)
        current = bytes32ToAddress(bytes32)
      }
      expect(current.toLowerCase()).toBe(address.toLowerCase())
    }
  })
})

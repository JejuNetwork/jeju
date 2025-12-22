/**
 * Unit tests for XLP Router utility functions
 * Tests V3 path encoding
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { encodeV3Path } from '../useXLPRouter'

// Test addresses
const _WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
const _USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
const _DAI = '0x6B175474E89094C44Da98b954EescdeCB5BE3d04' as Address // Intentionally invalid for one test

// Valid checksum addresses for testing
const TOKEN_A = '0x1111111111111111111111111111111111111111' as Address
const TOKEN_B = '0x2222222222222222222222222222222222222222' as Address
const TOKEN_C = '0x3333333333333333333333333333333333333333' as Address

// =============================================================================
// V3 PATH ENCODING TESTS
// =============================================================================

describe('encodeV3Path', () => {
  test('should encode single-hop path correctly', () => {
    const tokens = [TOKEN_A, TOKEN_B]
    const fees = [3000] // 0.3% fee

    const encoded = encodeV3Path(tokens, fees)

    // Result should be a hex string
    expect(encoded.startsWith('0x')).toBe(true)

    // Length should be: 20 bytes (address) + 3 bytes (fee) + 20 bytes (address) = 43 bytes = 86 hex chars + 0x
    expect(encoded.length).toBe(2 + 86)
  })

  test('should encode multi-hop path correctly', () => {
    const tokens = [TOKEN_A, TOKEN_B, TOKEN_C]
    const fees = [3000, 500] // 0.3% then 0.05%

    const encoded = encodeV3Path(tokens, fees)

    expect(encoded.startsWith('0x')).toBe(true)

    // Length: 20 + 3 + 20 + 3 + 20 = 66 bytes = 132 hex chars + 0x
    expect(encoded.length).toBe(2 + 132)
  })

  test('should throw for path with less than 2 tokens', () => {
    expect(() => encodeV3Path([TOKEN_A], [])).toThrow()
  })

  test('should throw for mismatched tokens and fees length', () => {
    // tokens.length should be fees.length + 1
    expect(() => encodeV3Path([TOKEN_A, TOKEN_B], [3000, 500])).toThrow()
    expect(() => encodeV3Path([TOKEN_A, TOKEN_B, TOKEN_C], [3000])).toThrow()
  })

  test('should throw for invalid fee values', () => {
    // Fee must be between 0 and 1000000
    expect(() => encodeV3Path([TOKEN_A, TOKEN_B], [-1])).toThrow()
    expect(() => encodeV3Path([TOKEN_A, TOKEN_B], [1000001])).toThrow()
  })

  test('should accept all valid V3 fee tiers', () => {
    const validFees = [100, 500, 3000, 10000]

    for (const fee of validFees) {
      const encoded = encodeV3Path([TOKEN_A, TOKEN_B], [fee])
      expect(encoded.startsWith('0x')).toBe(true)
    }
  })

  test('should produce different paths for different fees', () => {
    const path1 = encodeV3Path([TOKEN_A, TOKEN_B], [500])
    const path2 = encodeV3Path([TOKEN_A, TOKEN_B], [3000])

    expect(path1).not.toBe(path2)
  })

  test('should produce different paths for different token orders', () => {
    const pathAB = encodeV3Path([TOKEN_A, TOKEN_B], [3000])
    const pathBA = encodeV3Path([TOKEN_B, TOKEN_A], [3000])

    expect(pathAB).not.toBe(pathBA)
  })

  test('should handle complex multi-hop paths', () => {
    // A -> B -> C -> A (circular, but valid encoding)
    const tokens = [TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_A]
    const fees = [500, 3000, 10000]

    const encoded = encodeV3Path(tokens, fees)

    expect(encoded.startsWith('0x')).toBe(true)
    // Length: 4 * 20 + 3 * 3 = 89 bytes = 178 hex chars + 0x
    expect(encoded.length).toBe(2 + 178)
  })
})

// =============================================================================
// PATH STRUCTURE VERIFICATION
// =============================================================================

describe('encodeV3Path structure', () => {
  test('should contain token addresses in order', () => {
    const encoded = encodeV3Path([TOKEN_A, TOKEN_B], [3000])

    // First 40 hex chars after 0x should be TOKEN_A (lowercased)
    const firstToken = encoded.slice(2, 42)
    expect(firstToken.toLowerCase()).toBe(TOKEN_A.slice(2).toLowerCase())
  })

  test('should contain fee between tokens', () => {
    const encoded = encodeV3Path([TOKEN_A, TOKEN_B], [3000])

    // After first address (40 hex chars), next 6 hex chars should be the fee
    // 3000 in hex = 0x0BB8, padded to 3 bytes = 000BB8
    const feeHex = encoded.slice(42, 48)
    expect(parseInt(feeHex, 16)).toBe(3000)
  })
})

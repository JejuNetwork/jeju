/**
 * Unit tests for messaging contract deployment utilities
 *
 * Tests contract address extraction from forge output.
 */

import { describe, expect, it } from 'bun:test'
import type { Address } from 'viem'

/**
 * Extract contract address from forge deployment output
 * Forge outputs "Deployed to: 0x..." when deploying contracts
 */
function extractContractAddress(output: string): Address {
  const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/)
  if (!match) {
    throw new Error('Failed to extract contract address from deployment output')
  }
  return match[1] as Address
}
describe('extractContractAddress', () => {
  it('should extract valid address from standard forge output', () => {
    const output = `
Compiling 2 files with Solc 0.8.26
Compiler run successful with warnings
Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
Transaction hash: 0x1234...
`
    const address = extractContractAddress(output)
    expect(address).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
  })

  it('should extract lowercase hex addresses', () => {
    const output = 'Deployed to: 0xabcdef1234567890abcdef1234567890abcdef12'
    const address = extractContractAddress(output)
    expect(address).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  })

  it('should extract uppercase hex addresses', () => {
    const output = 'Deployed to: 0xABCDEF1234567890ABCDEF1234567890ABCDEF12'
    const address = extractContractAddress(output)
    expect(address).toBe('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')
  })

  it('should extract mixed case hex addresses', () => {
    const output = 'Deployed to: 0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
    const address = extractContractAddress(output)
    expect(address).toBe('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')
  })

  it('should handle multiline output with address anywhere', () => {
    const output = `
Starting deployment...
Network: testnet
Gas price: 1 gwei
Deployed to: 0x1234567890123456789012345678901234567890
Verification pending...
Done!
`
    const address = extractContractAddress(output)
    expect(address).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should throw when no address found', () => {
    const output = 'Contract compilation complete. No deployment performed.'
    expect(() => extractContractAddress(output)).toThrow(
      'Failed to extract contract address from deployment output',
    )
  })

  it('should throw for empty output', () => {
    expect(() => extractContractAddress('')).toThrow(
      'Failed to extract contract address from deployment output',
    )
  })

  it('should throw for malformed address (too short)', () => {
    const output = 'Deployed to: 0x123456'
    expect(() => extractContractAddress(output)).toThrow(
      'Failed to extract contract address from deployment output',
    )
  })

  it('should extract exactly 40 hex chars even from longer string', () => {
    // The regex captures exactly 40 hex chars, so longer addresses just get truncated
    const output = 'Deployed to: 0x12345678901234567890123456789012345678901234'
    const address = extractContractAddress(output)
    expect(address).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should throw for address without 0x prefix', () => {
    const output = 'Deployed to: 1234567890123456789012345678901234567890'
    expect(() => extractContractAddress(output)).toThrow(
      'Failed to extract contract address from deployment output',
    )
  })

  it('should throw for invalid hex characters', () => {
    const output = 'Deployed to: 0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'
    expect(() => extractContractAddress(output)).toThrow(
      'Failed to extract contract address from deployment output',
    )
  })

  it('should extract first address when multiple present', () => {
    const output = `
Deployed KeyRegistry to: 0x1111111111111111111111111111111111111111
Deployed to: 0x2222222222222222222222222222222222222222
Deployed NodeRegistry to: 0x3333333333333333333333333333333333333333
`
    const address = extractContractAddress(output)
    // Should match the first "Deployed to:" pattern
    expect(address).toBe('0x2222222222222222222222222222222222222222')
  })

  it('should handle JSON output from forge', () => {
    const output = `{"deployer":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","Deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3","tx":"0x..."}`
    const address = extractContractAddress(output)
    expect(address).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
  })
})

describe('Address format validation', () => {
  it('should extract addresses that pass checksum validation', () => {
    // These are valid checksummed addresses
    const validChecksumAddresses: Address[] = [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    ]

    for (const addr of validChecksumAddresses) {
      const output = `Deployed to: ${addr}`
      const extracted = extractContractAddress(output)
      expect(extracted).toBe(addr)
    }
  })

  it('should extract the canonical EntryPoint address', () => {
    const output = 'Deployed to: 0x0000000071727De22E5E9d8BAf0edAc6f37da032'
    const address = extractContractAddress(output)
    expect(address).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032')
  })

  it('should handle zero address', () => {
    const output = 'Deployed to: 0x0000000000000000000000000000000000000000'
    const address = extractContractAddress(output)
    expect(address).toBe('0x0000000000000000000000000000000000000000')
  })

  it('should handle max address', () => {
    const output = 'Deployed to: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
    const address = extractContractAddress(output)
    expect(address).toBe('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
  })
})

describe('Edge cases in forge output', () => {
  it('should handle ANSI color codes in output', () => {
    // Forge sometimes outputs colored text
    const output =
      '\x1b[32mDeployed to: 0x1234567890123456789012345678901234567890\x1b[0m'
    const address = extractContractAddress(output)
    expect(address).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should handle Windows line endings', () => {
    const output =
      'Starting...\r\nDeployed to: 0x1234567890123456789012345678901234567890\r\nDone'
    const address = extractContractAddress(output)
    expect(address).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should handle extra whitespace', () => {
    const output = 'Deployed to:   0x1234567890123456789012345678901234567890  '
    // Note: The regex expects exactly one space after the colon
    // This test verifies current behavior
    expect(() => extractContractAddress(output)).toThrow()
  })

  it('should handle address at end of output without newline', () => {
    const output = 'Deployed to: 0x1234567890123456789012345678901234567890'
    const address = extractContractAddress(output)
    expect(address).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should not match similar but different patterns', () => {
    // These should NOT match
    const nonMatchingOutputs = [
      'deployed to: 0x1234567890123456789012345678901234567890', // lowercase "deployed"
      'Deployed at: 0x1234567890123456789012345678901234567890', // "at" instead of "to"
      'Contract deployed to: 0x1234567890123456789012345678901234567890', // extra prefix
      'Deployed to 0x1234567890123456789012345678901234567890', // missing colon
    ]

    for (const output of nonMatchingOutputs) {
      expect(() => extractContractAddress(output)).toThrow(
        'Failed to extract contract address from deployment output',
      )
    }
  })
})

describe('Property-based address extraction', () => {
  it('should correctly extract any valid Ethereum address', () => {
    // Generate random valid addresses and verify extraction
    for (let i = 0; i < 100; i++) {
      const randomHex = Array.from({ length: 40 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('')
      const randomAddress = `0x${randomHex}`

      const output = `Some output before\nDeployed to: ${randomAddress}\nSome output after`
      const extracted = extractContractAddress(output)

      expect(extracted.toLowerCase()).toBe(randomAddress.toLowerCase())
    }
  })
})

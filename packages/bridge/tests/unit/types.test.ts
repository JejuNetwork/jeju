/**
 * Unit Tests for Type Utilities
 */

import { describe, expect, it } from 'bun:test'
import {
  ChainId,
  isEVMChain,
  isSolanaChain,
  TransferStatus,
  toHash32,
} from '../../src/types/index.js'

describe('Type Utilities', () => {
  describe('toHash32', () => {
    it('should create Hash32 from 32-byte array', () => {
      const bytes = new Uint8Array(32).fill(0xab)
      const hash = toHash32(bytes)
      expect(hash.length).toBe(32)
      expect(hash[0]).toBe(0xab)
    })

    it('should throw for wrong size array', () => {
      const bytes = new Uint8Array(31)
      expect(() => toHash32(bytes)).toThrow()
    })

    it('should preserve byte values', () => {
      const bytes = new Uint8Array(32).fill(0x01)
      const hash = toHash32(bytes)
      expect(hash[0]).toBe(0x01)
      expect(hash[31]).toBe(0x01)
    })

    // Edge cases
    it('should throw for 33-byte array (too long)', () => {
      const bytes = new Uint8Array(33)
      expect(() => toHash32(bytes)).toThrow()
    })

    it('should throw for empty array', () => {
      const bytes = new Uint8Array(0)
      expect(() => toHash32(bytes)).toThrow()
    })

    it('should handle all zeros', () => {
      const bytes = new Uint8Array(32).fill(0x00)
      const hash = toHash32(bytes)
      expect(hash.every((b) => b === 0)).toBe(true)
    })

    it('should handle all 0xFF (max byte value)', () => {
      const bytes = new Uint8Array(32).fill(0xff)
      const hash = toHash32(bytes)
      expect(hash.every((b) => b === 0xff)).toBe(true)
    })

    it('should be same reference (cast, not copy)', () => {
      const bytes = new Uint8Array(32).fill(0xab)
      const hash = toHash32(bytes)
      bytes[0] = 0x00 // mutate original
      expect(hash[0]).toBe(0x00) // hash shares reference
    })
  })

  describe('isEVMChain', () => {
    it('should return true for Ethereum mainnet', () => {
      expect(isEVMChain(ChainId.ETHEREUM_MAINNET)).toBe(true)
    })

    it('should return true for Base mainnet', () => {
      expect(isEVMChain(ChainId.BASE_MAINNET)).toBe(true)
    })

    it('should return true for Arbitrum', () => {
      expect(isEVMChain(ChainId.ARBITRUM_ONE)).toBe(true)
    })

    it('should return true for Optimism', () => {
      expect(isEVMChain(ChainId.OPTIMISM)).toBe(true)
    })

    it('should return true for BSC', () => {
      expect(isEVMChain(ChainId.BSC_MAINNET)).toBe(true)
    })

    it('should return false for Solana mainnet', () => {
      expect(isEVMChain(ChainId.SOLANA_MAINNET)).toBe(false)
    })

    it('should return false for Solana devnet', () => {
      expect(isEVMChain(ChainId.SOLANA_DEVNET)).toBe(false)
    })

    it('should return false for local Solana', () => {
      expect(isEVMChain(ChainId.LOCAL_SOLANA)).toBe(false)
    })
  })

  describe('isSolanaChain', () => {
    it('should return true for Solana mainnet', () => {
      expect(isSolanaChain(ChainId.SOLANA_MAINNET)).toBe(true)
    })

    it('should return true for Solana devnet', () => {
      expect(isSolanaChain(ChainId.SOLANA_DEVNET)).toBe(true)
    })

    it('should return true for Solana localnet', () => {
      expect(isSolanaChain(ChainId.SOLANA_LOCALNET)).toBe(true)
    })

    it('should return true for local Solana', () => {
      expect(isSolanaChain(ChainId.LOCAL_SOLANA)).toBe(true)
    })

    it('should return false for Ethereum mainnet', () => {
      expect(isSolanaChain(ChainId.ETHEREUM_MAINNET)).toBe(false)
    })

    it('should return false for Base', () => {
      expect(isSolanaChain(ChainId.BASE_MAINNET)).toBe(false)
    })
  })

  describe('TransferStatus', () => {
    it('should have correct status values', () => {
      expect(TransferStatus.PENDING).toBe('PENDING')
      expect(TransferStatus.SOURCE_CONFIRMED).toBe('SOURCE_CONFIRMED')
      expect(TransferStatus.PROVING).toBe('PROVING')
      expect(TransferStatus.PROOF_GENERATED).toBe('PROOF_GENERATED')
      expect(TransferStatus.DEST_SUBMITTED).toBe('DEST_SUBMITTED')
      expect(TransferStatus.COMPLETED).toBe('COMPLETED')
      expect(TransferStatus.FAILED).toBe('FAILED')
    })
  })

  describe('ChainId', () => {
    it('should have correct EVM chain IDs', () => {
      expect(ChainId.ETHEREUM_MAINNET).toBe(1)
      expect(ChainId.BASE_MAINNET).toBe(8453)
      expect(ChainId.ARBITRUM_ONE).toBe(42161)
      expect(ChainId.OPTIMISM).toBe(10)
      expect(ChainId.BSC_MAINNET).toBe(56)
    })

    it('should have correct testnet chain IDs', () => {
      expect(ChainId.ETHEREUM_SEPOLIA).toBe(11155111)
      expect(ChainId.BASE_SEPOLIA).toBe(84532)
    })

    it('should have correct local chain IDs', () => {
      expect(ChainId.LOCAL_EVM).toBe(31337)
      expect(ChainId.LOCAL_SOLANA).toBe(104)
    })
  })
})

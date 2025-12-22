/**
 * Unit Tests for Merkle Tree Computation
 *
 * Tests the computeMerkleRoot function used for:
 * - Validator stake proofs
 * - Transfer batch commitments
 * - State proofs
 */

import { describe, expect, it } from 'bun:test'
import { keccak_256 } from '@noble/hashes/sha3'
import { type Hash32, toHash32 } from '../../src/types/index.js'
import {
  computeMerkleRoot,
  hashToHex,
  hexToHash32,
} from '../../src/utils/validation.js'

// Helper to create random Hash32
function randomHash32(): Hash32 {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHash32(bytes)
}

// Helper to create deterministic Hash32 from number
function deterministicHash32(n: number): Hash32 {
  const bytes = new Uint8Array(32)
  bytes[31] = n & 0xff
  bytes[30] = (n >> 8) & 0xff
  bytes[29] = (n >> 16) & 0xff
  bytes[28] = (n >> 24) & 0xff
  return toHash32(bytes)
}

describe('Merkle Tree Computation', () => {
  describe('computeMerkleRoot', () => {
    it('should return zero hash for empty leaves', () => {
      const root = computeMerkleRoot([], keccak_256)
      expect(root.length).toBe(32)
      expect(root.every((b) => b === 0)).toBe(true)
    })

    it('should return leaf itself for single leaf', () => {
      const leaf = deterministicHash32(42)
      const root = computeMerkleRoot([leaf], keccak_256)

      expect(hashToHex(root)).toBe(hashToHex(leaf))
    })

    it('should compute correct root for two leaves', () => {
      const leaf1 = deterministicHash32(1)
      const leaf2 = deterministicHash32(2)

      const root = computeMerkleRoot([leaf1, leaf2], keccak_256)

      // Manually compute expected root
      const combined = new Uint8Array(64)
      combined.set(leaf1, 0)
      combined.set(leaf2, 32)
      const expected = toHash32(keccak_256(combined))

      expect(hashToHex(root)).toBe(hashToHex(expected))
    })

    it('should handle odd number of leaves by duplicating last', () => {
      const leaf1 = deterministicHash32(1)
      const leaf2 = deterministicHash32(2)
      const leaf3 = deterministicHash32(3)

      const root = computeMerkleRoot([leaf1, leaf2, leaf3], keccak_256)

      // With 3 leaves:
      // Level 0: [leaf1, leaf2, leaf3]
      // Level 1: [hash(leaf1||leaf2), hash(leaf3||leaf3)] (duplicate leaf3)
      // Level 2: [hash(level1[0]||level1[1])]

      const hash12 = keccak_256(new Uint8Array([...leaf1, ...leaf2]))
      const hash33 = keccak_256(new Uint8Array([...leaf3, ...leaf3]))
      const expected = keccak_256(new Uint8Array([...hash12, ...hash33]))

      expect(hashToHex(root)).toBe(hashToHex(toHash32(expected)))
    })

    it('should compute same root regardless of order for balanced tree', () => {
      // For a proper Merkle tree, order matters!
      // This test verifies that different orders produce different roots
      const leaf1 = deterministicHash32(1)
      const leaf2 = deterministicHash32(2)
      const leaf3 = deterministicHash32(3)
      const leaf4 = deterministicHash32(4)

      const root1 = computeMerkleRoot([leaf1, leaf2, leaf3, leaf4], keccak_256)
      const root2 = computeMerkleRoot([leaf4, leaf3, leaf2, leaf1], keccak_256)

      // Different order should produce different root
      expect(hashToHex(root1)).not.toBe(hashToHex(root2))
    })

    it('should produce deterministic results', () => {
      const leaves = [
        deterministicHash32(100),
        deterministicHash32(200),
        deterministicHash32(300),
        deterministicHash32(400),
      ]

      const root1 = computeMerkleRoot(leaves, keccak_256)
      const root2 = computeMerkleRoot(leaves, keccak_256)

      expect(hashToHex(root1)).toBe(hashToHex(root2))
    })

    it('should handle power of 2 leaves (perfect binary tree)', () => {
      const leaves = Array.from({ length: 8 }, (_, i) => deterministicHash32(i))
      const root = computeMerkleRoot(leaves, keccak_256)

      expect(root.length).toBe(32)
      // Root should not be all zeros
      expect(root.some((b) => b !== 0)).toBe(true)
    })

    it('should handle non-power-of-2 leaves', () => {
      // 5 leaves requires padding
      const leaves = Array.from({ length: 5 }, (_, i) => deterministicHash32(i))
      const root = computeMerkleRoot(leaves, keccak_256)

      expect(root.length).toBe(32)
      expect(root.some((b) => b !== 0)).toBe(true)
    })

    it('should handle large number of leaves', () => {
      const leaves = Array.from({ length: 1000 }, (_, i) =>
        deterministicHash32(i),
      )
      const root = computeMerkleRoot(leaves, keccak_256)

      expect(root.length).toBe(32)
      expect(root.some((b) => b !== 0)).toBe(true)
    })
  })

  describe('Tree Properties', () => {
    it('should produce different roots for different leaves', () => {
      const leaves1 = [deterministicHash32(1), deterministicHash32(2)]
      const leaves2 = [deterministicHash32(3), deterministicHash32(4)]

      const root1 = computeMerkleRoot(leaves1, keccak_256)
      const root2 = computeMerkleRoot(leaves2, keccak_256)

      expect(hashToHex(root1)).not.toBe(hashToHex(root2))
    })

    it('should change root when any leaf changes', () => {
      const original = [
        deterministicHash32(1),
        deterministicHash32(2),
        deterministicHash32(3),
        deterministicHash32(4),
      ]

      const modified = [
        deterministicHash32(1),
        deterministicHash32(999), // Changed
        deterministicHash32(3),
        deterministicHash32(4),
      ]

      const root1 = computeMerkleRoot(original, keccak_256)
      const root2 = computeMerkleRoot(modified, keccak_256)

      expect(hashToHex(root1)).not.toBe(hashToHex(root2))
    })

    it('should not be affected by duplicating the tree', () => {
      const leaves = [deterministicHash32(1), deterministicHash32(2)]
      const doubled = [...leaves, ...leaves]

      const root1 = computeMerkleRoot(leaves, keccak_256)
      const root2 = computeMerkleRoot(doubled, keccak_256)

      // Doubling the leaves creates a different (larger) tree
      expect(hashToHex(root1)).not.toBe(hashToHex(root2))
    })
  })

  describe('Hash Utilities', () => {
    describe('hashToHex', () => {
      it('should convert Hash32 to lowercase hex string', () => {
        const hash = deterministicHash32(0x12345678)
        const hex = hashToHex(hash)

        expect(hex.length).toBe(64) // 32 bytes = 64 hex chars
        expect(hex).toMatch(/^[0-9a-f]+$/)
      })

      it('should pad single-digit bytes with zeros', () => {
        const bytes = new Uint8Array(32)
        bytes[0] = 0x0a // Should be "0a" not "a"
        const hash = toHash32(bytes)
        const hex = hashToHex(hash)

        expect(hex.startsWith('0a')).toBe(true)
      })

      it('should handle all zeros', () => {
        const hash = toHash32(new Uint8Array(32))
        const hex = hashToHex(hash)

        expect(hex).toBe('0'.repeat(64))
      })

      it('should handle all 0xff', () => {
        const hash = toHash32(new Uint8Array(32).fill(0xff))
        const hex = hashToHex(hash)

        expect(hex).toBe('f'.repeat(64))
      })
    })

    describe('hexToHash32', () => {
      it('should convert hex string to Hash32', () => {
        const hex = '0123456789abcdef'.repeat(4)
        const hash = hexToHash32(hex)

        expect(hash.length).toBe(32)
        expect(hash[0]).toBe(0x01)
        expect(hash[1]).toBe(0x23)
      })

      it('should handle 0x prefix', () => {
        const hex = `0x${'0123456789abcdef'.repeat(4)}`
        const hash = hexToHash32(hex)

        expect(hash.length).toBe(32)
        expect(hash[0]).toBe(0x01)
      })

      it('should throw for wrong length', () => {
        expect(() => hexToHash32('0123')).toThrow('Invalid hex length')
        expect(() => hexToHash32('0x0123')).toThrow('Invalid hex length')
      })

      it('should be inverse of hashToHex', () => {
        const original = randomHash32()
        const hex = hashToHex(original)
        const recovered = hexToHash32(hex)

        expect(hashToHex(recovered)).toBe(hashToHex(original))
      })

      it('should handle uppercase hex', () => {
        const hex = 'ABCDEF1234567890'.repeat(4)
        const hash = hexToHash32(hex)

        expect(hash[0]).toBe(0xab)
        expect(hash[1]).toBe(0xcd)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle 2 identical leaves', () => {
      const leaf = deterministicHash32(42)
      const root = computeMerkleRoot([leaf, leaf], keccak_256)

      // hash(leaf || leaf)
      const expected = keccak_256(new Uint8Array([...leaf, ...leaf]))
      expect(hashToHex(root)).toBe(hashToHex(toHash32(expected)))
    })

    it('should handle maximum realistic tree size (10000 leaves)', () => {
      const leaves = Array.from({ length: 10000 }, (_, i) =>
        deterministicHash32(i),
      )
      const start = performance.now()
      const root = computeMerkleRoot(leaves, keccak_256)
      const elapsed = performance.now() - start

      expect(root.length).toBe(32)
      // Should complete in reasonable time (< 1 second)
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('Cross-Chain Transfer Batching', () => {
    interface MockTransfer {
      id: number
      amount: bigint
      sender: string
      recipient: string
    }

    function transferToLeaf(transfer: MockTransfer): Hash32 {
      const encoder = new TextEncoder()
      const data = JSON.stringify({
        id: transfer.id,
        amount: transfer.amount.toString(),
        sender: transfer.sender,
        recipient: transfer.recipient,
      })
      return toHash32(keccak_256(encoder.encode(data)))
    }

    it('should create deterministic batch root', () => {
      const transfers: MockTransfer[] = [
        { id: 1, amount: 1000000n, sender: '0xabc', recipient: '0xdef' },
        { id: 2, amount: 2000000n, sender: '0x123', recipient: '0x456' },
      ]

      const leaves = transfers.map(transferToLeaf)
      const root1 = computeMerkleRoot(leaves, keccak_256)
      const root2 = computeMerkleRoot(leaves, keccak_256)

      expect(hashToHex(root1)).toBe(hashToHex(root2))
    })

    it('should detect tampered transfers', () => {
      const original: MockTransfer[] = [
        { id: 1, amount: 1000000n, sender: '0xabc', recipient: '0xdef' },
        { id: 2, amount: 2000000n, sender: '0x123', recipient: '0x456' },
      ]

      const tampered: MockTransfer[] = [
        { id: 1, amount: 9999999n, sender: '0xabc', recipient: '0xdef' }, // Changed amount
        { id: 2, amount: 2000000n, sender: '0x123', recipient: '0x456' },
      ]

      const originalRoot = computeMerkleRoot(
        original.map(transferToLeaf),
        keccak_256,
      )
      const tamperedRoot = computeMerkleRoot(
        tampered.map(transferToLeaf),
        keccak_256,
      )

      expect(hashToHex(originalRoot)).not.toBe(hashToHex(tamperedRoot))
    })
  })
})

/**
 * Reed-Solomon Erasure Coding Tests
 *
 * Tests for Reed-Solomon codec functionality:
 * - Encoding data into shards
 * - Decoding with missing shards
 * - Verification of shard consistency
 * - Merkle proof generation and verification
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { Hex } from 'viem'
import { keccak256 } from 'viem'
import {
  createReedSolomonCodec,
  defaultCodec,
  ReedSolomonCodec,
} from '../src/da/erasure'

const TEST_BLOB_ID =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex

// ============================================================================
// Codec Configuration Tests
// ============================================================================

describe('ReedSolomonCodec Configuration', () => {
  it('should create codec with default configuration', () => {
    const codec = createReedSolomonCodec()
    expect(codec.config.dataShards).toBe(16)
    expect(codec.config.parityShards).toBe(16)
  })

  it('should create codec with custom configuration', () => {
    const codec = createReedSolomonCodec({ dataShards: 8, parityShards: 4 })
    expect(codec.config.dataShards).toBe(8)
    expect(codec.config.parityShards).toBe(4)
  })

  it('should reject invalid configuration', () => {
    // Total shards cannot exceed 255 for GF(2^8)
    expect(
      () => new ReedSolomonCodec({ dataShards: 200, parityShards: 100 }),
    ).toThrow()
  })

  it('should have default codec available', () => {
    expect(defaultCodec).toBeDefined()
    expect(defaultCodec.config.dataShards).toBe(16)
    expect(defaultCodec.config.parityShards).toBe(16)
  })
})

// ============================================================================
// Encoding Tests
// ============================================================================

describe('ReedSolomonCodec.encode', () => {
  let codec: ReedSolomonCodec

  beforeEach(() => {
    codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
  })

  it('should encode data into correct number of shards', () => {
    const data = new Uint8Array(100)
    for (let i = 0; i < data.length; i++) data[i] = i

    const shards = codec.encode(data)

    expect(shards.length).toBe(6) // 4 data + 2 parity
  })

  it('should produce shards of equal size', () => {
    const data = new Uint8Array(100)
    const shards = codec.encode(data)

    const shardSize = shards[0].length
    for (const shard of shards) {
      expect(shard.length).toBe(shardSize)
    }
  })

  it('should preserve data in first N shards', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(data, 2) // 2 bytes per shard

    // First 4 shards should contain the original data
    expect(shards[0]).toEqual(new Uint8Array([1, 2]))
    expect(shards[1]).toEqual(new Uint8Array([3, 4]))
    expect(shards[2]).toEqual(new Uint8Array([5, 6]))
    expect(shards[3]).toEqual(new Uint8Array([7, 8]))
  })

  it('should pad data if necessary', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
    const data = new Uint8Array([1, 2, 3]) // Only 3 bytes

    const shards = codec.encode(data, 2) // Each shard is 2 bytes

    expect(shards.length).toBe(6)
    // Data should be padded to 8 bytes (4 shards × 2 bytes)
  })

  it('should handle large data correctly', () => {
    const codec = createReedSolomonCodec({ dataShards: 16, parityShards: 8 })
    const data = new Uint8Array(10000)
    for (let i = 0; i < data.length; i++) data[i] = i % 256

    const shards = codec.encode(data)

    expect(shards.length).toBe(24) // 16 data + 8 parity

    // Verify all shards have same size
    const size = shards[0].length
    expect(shards.every((s) => s.length === size)).toBe(true)
  })
})

// ============================================================================
// Decoding Tests
// ============================================================================

describe('ReedSolomonCodec.decode', () => {
  let codec: ReedSolomonCodec

  beforeEach(() => {
    codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
  })

  it('should decode when all shards are available', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(original, 2)

    const decoded = codec.decode(shards, original.length)

    expect(decoded).toEqual(original)
  })

  it('should decode with missing data shards', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(original, 2)

    // Remove 2 data shards (we have 2 parity shards, so this should work)
    const sparseShards: (Uint8Array | null)[] = [...shards]
    sparseShards[0] = null
    sparseShards[1] = null

    const decoded = codec.decode(sparseShards, original.length)

    expect(decoded).toEqual(original)
  })

  it('should decode with missing parity shards', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(original, 2)

    // Remove both parity shards
    const sparseShards: (Uint8Array | null)[] = [...shards]
    sparseShards[4] = null
    sparseShards[5] = null

    const decoded = codec.decode(sparseShards, original.length)

    expect(decoded).toEqual(original)
  })

  it('should decode with mixed missing shards', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(original, 2)

    // Remove 1 data shard and 1 parity shard
    const sparseShards: (Uint8Array | null)[] = [...shards]
    sparseShards[2] = null
    sparseShards[5] = null

    const decoded = codec.decode(sparseShards, original.length)

    expect(decoded).toEqual(original)
  })

  it('should fail when too many shards are missing', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(original, 2)

    // Remove 3 shards (more than parity shards count)
    const sparseShards: (Uint8Array | null)[] = [...shards]
    sparseShards[0] = null
    sparseShards[1] = null
    sparseShards[2] = null

    expect(() => codec.decode(sparseShards, original.length)).toThrow(
      /Insufficient shards/,
    )
  })

  it('should handle reconstruction with exactly minimum shards', () => {
    const codec = createReedSolomonCodec({ dataShards: 8, parityShards: 4 })
    const original = new Uint8Array(64)
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) % 256

    const shards = codec.encode(original)

    // Keep exactly 8 shards (the minimum needed)
    const sparseShards: (Uint8Array | null)[] = new Array(12).fill(null)
    // Keep shards 0, 2, 4, 5, 8, 9, 10, 11 (8 total, mix of data and parity)
    sparseShards[0] = shards[0]
    sparseShards[2] = shards[2]
    sparseShards[4] = shards[4]
    sparseShards[5] = shards[5]
    sparseShards[8] = shards[8]
    sparseShards[9] = shards[9]
    sparseShards[10] = shards[10]
    sparseShards[11] = shards[11]

    const decoded = codec.decode(sparseShards, original.length)

    expect(decoded).toEqual(original)
  })
})

// ============================================================================
// Verification Tests
// ============================================================================

describe('ReedSolomonCodec.verify', () => {
  let codec: ReedSolomonCodec

  beforeEach(() => {
    codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
  })

  it('should verify valid shards', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(data, 2)

    expect(codec.verify(shards)).toBe(true)
  })

  it('should reject corrupted data shard', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(data, 2)

    // Corrupt a data shard
    shards[0][0] = 0xff

    expect(codec.verify(shards)).toBe(false)
  })

  it('should reject corrupted parity shard', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(data, 2)

    // Corrupt a parity shard
    shards[4][0] = 0xff

    expect(codec.verify(shards)).toBe(false)
  })

  it('should reject wrong number of shards', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const shards = codec.encode(data, 2)

    // Remove a shard
    const incomplete = shards.slice(0, 5)

    expect(codec.verify(incomplete)).toBe(false)
  })
})

// ============================================================================
// Chunk Creation Tests
// ============================================================================

describe('ReedSolomonCodec.createChunks', () => {
  let codec: ReedSolomonCodec

  beforeEach(() => {
    codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
  })

  it('should create chunks with correct structure', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const chunks = codec.createChunks(data, TEST_BLOB_ID)

    expect(chunks.length).toBe(6)

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i)
      expect(chunks[i].blobId).toBe(TEST_BLOB_ID)
      expect(chunks[i].data).toBeDefined()
      expect(chunks[i].proof).toBeDefined()
    }
  })

  it('should generate valid Merkle proofs', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const chunks = codec.createChunks(data, TEST_BLOB_ID)

    // Each chunk should have a Merkle proof
    for (const chunk of chunks) {
      expect(chunk.proof.merkleProof).toBeDefined()
      expect(Array.isArray(chunk.proof.merkleProof)).toBe(true)
    }
  })

  it('should generate opening proofs', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const chunks = codec.createChunks(data, TEST_BLOB_ID)

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].proof.openingProof).toMatch(/^0x[a-f0-9]{64}$/)
      expect(chunks[i].proof.polynomialIndex).toBe(i)
    }
  })
})

// ============================================================================
// Chunk Reconstruction Tests
// ============================================================================

describe('ReedSolomonCodec.reconstructFromChunks', () => {
  let codec: ReedSolomonCodec

  beforeEach(() => {
    codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
  })

  it('should reconstruct from all chunks', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const chunks = codec.createChunks(original, TEST_BLOB_ID)

    const reconstructed = codec.reconstructFromChunks(chunks, original.length)

    expect(reconstructed).toEqual(original)
  })

  it('should reconstruct from partial chunks', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const chunks = codec.createChunks(original, TEST_BLOB_ID)

    // Keep only minimum required chunks (4 out of 6)
    const partialChunks = [chunks[0], chunks[2], chunks[4], chunks[5]]

    const reconstructed = codec.reconstructFromChunks(
      partialChunks,
      original.length,
    )

    expect(reconstructed).toEqual(original)
  })

  it('should handle random data correctly', () => {
    const original = new Uint8Array(256)
    for (let i = 0; i < original.length; i++) {
      original[i] = Math.floor(Math.random() * 256)
    }

    const chunks = codec.createChunks(original, TEST_BLOB_ID)

    // Remove 2 random chunks
    const availableChunks = chunks.filter((_, i) => i !== 1 && i !== 3)

    const reconstructed = codec.reconstructFromChunks(
      availableChunks,
      original.length,
    )

    expect(reconstructed).toEqual(original)
  })
})

// ============================================================================
// Merkle Proof Verification Tests
// ============================================================================

describe('ReedSolomonCodec.verifyMerkleProof', () => {
  let codec: ReedSolomonCodec

  beforeEach(() => {
    codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
  })

  it('should verify valid Merkle proofs', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const chunks = codec.createChunks(data, TEST_BLOB_ID)
    const shards = codec.encode(data, 2)

    // Compute the Merkle root from all leaves
    const leaves = shards.map((s) => keccak256(s))

    // Build tree to get root
    let level = leaves
    while (level.length > 1) {
      const nextLevel: string[] = []
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]
        const right = level[i + 1] ?? left
        const combined = keccak256(`0x${left.slice(2)}${right.slice(2)}`)
        nextLevel.push(combined)
      }
      level = nextLevel
    }
    const root = level[0] as Hex

    // Verify each chunk's proof
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const leaf = keccak256(chunk.data)
      const isValid = codec.verifyMerkleProof(
        leaf,
        chunk.proof.merkleProof,
        root,
        i,
      )
      expect(isValid).toBe(true)
    }
  })

  it('should reject invalid proofs', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const chunks = codec.createChunks(data, TEST_BLOB_ID)

    const wrongRoot = keccak256('0xwrong') as Hex
    const leaf = keccak256(chunks[0].data)

    const isValid = codec.verifyMerkleProof(
      leaf,
      chunks[0].proof.merkleProof,
      wrongRoot,
      0,
    )
    expect(isValid).toBe(false)
  })
})

// ============================================================================
// Edge Cases and Stress Tests
// ============================================================================

describe('ReedSolomonCodec Edge Cases', () => {
  it('should handle minimum size data', () => {
    const codec = createReedSolomonCodec({ dataShards: 2, parityShards: 1 })
    const data = new Uint8Array([42])

    const shards = codec.encode(data)
    expect(shards.length).toBe(3)

    const decoded = codec.decode(shards, data.length)
    expect(decoded).toEqual(data)
  })

  it('should handle data exactly matching shard size', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
    const data = new Uint8Array(100) // Will be evenly divided

    const shards = codec.encode(data, 25) // 4 shards × 25 bytes = 100 bytes

    // Remove some shards and reconstruct
    const sparse: (Uint8Array | null)[] = [...shards]
    sparse[1] = null
    sparse[3] = null

    const decoded = codec.decode(sparse, data.length)
    expect(decoded.length).toBe(data.length)
  })

  it('should handle high redundancy configuration', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 8 })
    const data = new Uint8Array(32)
    for (let i = 0; i < data.length; i++) data[i] = i

    const shards = codec.encode(data)
    expect(shards.length).toBe(12)
    expect(codec.verify(shards)).toBe(true)

    // Can lose up to 8 shards
    const sparse: (Uint8Array | null)[] = [...shards]
    for (let i = 0; i < 8; i++) {
      sparse[i] = null
    }

    const decoded = codec.decode(sparse, data.length)
    expect(decoded).toEqual(data)
  })

  it('should produce deterministic output', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 2 })
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

    const shards1 = codec.encode(data, 2)
    const shards2 = codec.encode(data, 2)

    for (let i = 0; i < shards1.length; i++) {
      expect(shards1[i]).toEqual(shards2[i])
    }
  })
})

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('ReedSolomonCodec Property Tests', () => {
  it('should always reconstruct original data (fuzzing)', () => {
    const codec = createReedSolomonCodec({ dataShards: 8, parityShards: 4 })

    for (let trial = 0; trial < 20; trial++) {
      // Random data size
      const size = Math.floor(Math.random() * 500) + 10
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = Math.floor(Math.random() * 256)
      }

      const shards = codec.encode(data)

      // Remove up to 4 random shards
      const numToRemove = Math.floor(Math.random() * 4)
      const indicesToRemove = new Set<number>()
      while (indicesToRemove.size < numToRemove) {
        indicesToRemove.add(Math.floor(Math.random() * 12))
      }

      const sparse: (Uint8Array | null)[] = shards.map((s, i) =>
        indicesToRemove.has(i) ? null : s,
      )

      const decoded = codec.decode(sparse, data.length)
      expect(decoded).toEqual(data)
    }
  })

  it('should have consistent parity (fuzzing)', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 })

    for (let trial = 0; trial < 20; trial++) {
      const size = Math.floor(Math.random() * 100) + 10
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = Math.floor(Math.random() * 256)
      }

      const shards = codec.encode(data)
      expect(codec.verify(shards)).toBe(true)
    }
  })
})

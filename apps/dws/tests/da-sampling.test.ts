/**
 * Data Availability Sampling Tests
 *
 * Tests for statistical sampling algorithms:
 * - calculateRequiredSamples
 * - generateSampleIndices
 * - PeerDAS sampling patterns
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { getLocalhostHost, getTeeEndpoint } from '@jejunetwork/config'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import {
  calculateRequiredSamples,
  createSampleRequest,
  DASampler,
  DEFAULT_SAMPLING_CONFIG,
  generatePeerDASSamples,
  generateSampleIndices,
  SampleVerifier,
  verifyPeerDASSampling,
} from '../api/da/sampling'

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

// calculateRequiredSamples Tests

describe('calculateRequiredSamples', () => {
  it('should calculate samples for 99.99% confidence with 50% availability', () => {
    // With 50% availability threshold, P(undetected) = 0.5^k
    // For 99.99% confidence: 0.5^k < 0.0001
    // k = log(0.0001) / log(0.5) ≈ 13.3 => 14 samples
    const samples = calculateRequiredSamples(0.9999, 0.5)
    expect(samples).toBeGreaterThanOrEqual(13)
    expect(samples).toBeLessThanOrEqual(15)
  })

  it('should calculate samples for 99% confidence with 50% availability', () => {
    // 0.5^k < 0.01, k = log(0.01) / log(0.5) ≈ 6.6 => 7 samples
    const samples = calculateRequiredSamples(0.99, 0.5)
    expect(samples).toBeGreaterThanOrEqual(6)
    expect(samples).toBeLessThanOrEqual(8)
  })

  it('should require more samples for higher confidence', () => {
    const samples90 = calculateRequiredSamples(0.9, 0.5)
    const samples99 = calculateRequiredSamples(0.99, 0.5)
    const samples9999 = calculateRequiredSamples(0.9999, 0.5)

    expect(samples99).toBeGreaterThan(samples90)
    expect(samples9999).toBeGreaterThan(samples99)
  })

  it('should require fewer samples with higher availability threshold', () => {
    const samples50 = calculateRequiredSamples(0.99, 0.5)
    const samples75 = calculateRequiredSamples(0.99, 0.75)

    expect(samples75).toBeLessThan(samples50)
  })

  it('should handle edge case of near-zero confidence', () => {
    const samples = calculateRequiredSamples(0.01, 0.5)
    expect(samples).toBeGreaterThanOrEqual(1)
  })

  it('should handle high availability threshold', () => {
    const samples = calculateRequiredSamples(0.99, 0.9)
    expect(samples).toBeGreaterThanOrEqual(2)
    expect(samples).toBeLessThanOrEqual(5)
  })

  it('should satisfy the probability formula', () => {
    const confidence = 0.999
    const threshold = 0.5
    const k = calculateRequiredSamples(confidence, threshold)

    // Verify: 1 - (1 - threshold)^k >= confidence
    const actualConfidence = 1 - (1 - threshold) ** k
    expect(actualConfidence).toBeGreaterThanOrEqual(confidence)
  })
})

// generateSampleIndices Tests

describe('generateSampleIndices', () => {
  it('should generate correct number of indices', () => {
    const indices = generateSampleIndices(100, 16)
    expect(indices.length).toBe(16)
  })

  it('should generate unique indices', () => {
    const indices = generateSampleIndices(100, 16)
    const unique = new Set(indices)
    expect(unique.size).toBe(16)
  })

  it('should generate indices within valid range', () => {
    const totalChunks = 100
    const indices = generateSampleIndices(totalChunks, 16)

    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(totalChunks)
    }
  })

  it('should return sorted indices', () => {
    const indices = generateSampleIndices(100, 16)
    const sorted = [...indices].sort((a, b) => a - b)
    expect(indices).toEqual(sorted)
  })

  it('should produce deterministic results with same seed', () => {
    const seed =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex

    const indices1 = generateSampleIndices(100, 16, seed)
    const indices2 = generateSampleIndices(100, 16, seed)

    expect(indices1).toEqual(indices2)
  })

  it('should produce different results with different seeds', () => {
    const seed1 =
      '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex
    const seed2 =
      '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex

    const indices1 = generateSampleIndices(100, 16, seed1)
    const indices2 = generateSampleIndices(100, 16, seed2)

    expect(indices1).not.toEqual(indices2)
  })

  it('should handle case where sampleCount > totalChunks', () => {
    const indices = generateSampleIndices(10, 20)
    expect(indices.length).toBe(10) // Can't sample more than total
  })

  it('should handle large chunk counts', () => {
    const indices = generateSampleIndices(1000000, 100)
    expect(indices.length).toBe(100)

    // Verify all unique
    const unique = new Set(indices)
    expect(unique.size).toBe(100)
  })

  it('should have uniform distribution over many samples', () => {
    const totalChunks = 100
    const sampleCount = 10
    const iterations = 1000
    const counts = new Array(totalChunks).fill(0)

    for (let i = 0; i < iterations; i++) {
      const seed = keccak256(toBytes(`iteration-${i}`))
      const indices = generateSampleIndices(totalChunks, sampleCount, seed)
      for (const idx of indices) {
        counts[idx]++
      }
    }

    // Each index should appear roughly sampleCount/totalChunks * iterations times
    // Using 50% tolerance for randomness (expected * 0.5)

    // At least check that no index is completely starved
    for (let i = 0; i < totalChunks; i++) {
      expect(counts[i]).toBeGreaterThan(0)
    }

    // And that the distribution is roughly uniform
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    const variance =
      counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length
    const stdDev = Math.sqrt(variance)

    // Standard deviation should be reasonable for uniform distribution
    expect(stdDev).toBeLessThan(mean) // Std dev should be less than mean for decent uniformity
  })
})

// PeerDAS Sampling Tests

describe('generatePeerDASSamples', () => {
  it('should generate samples for each custody group', () => {
    const totalChunks = 256
    const custodyGroups = 8
    const samplesPerGroup = 4
    const seed = keccak256(toBytes('test-seed'))

    const samples = generatePeerDASSamples(
      totalChunks,
      custodyGroups,
      samplesPerGroup,
      seed,
    )

    expect(samples.length).toBe(custodyGroups)

    for (const groupSamples of samples) {
      expect(groupSamples.length).toBe(samplesPerGroup)
    }
  })

  it('should keep samples within their custody group boundaries', () => {
    const totalChunks = 256
    const custodyGroups = 8
    const samplesPerGroup = 4
    const groupSize = Math.ceil(totalChunks / custodyGroups)
    const seed = keccak256(toBytes('test-seed'))

    const samples = generatePeerDASSamples(
      totalChunks,
      custodyGroups,
      samplesPerGroup,
      seed,
    )

    for (let group = 0; group < custodyGroups; group++) {
      const groupStart = group * groupSize
      const groupEnd = Math.min(groupStart + groupSize, totalChunks)

      for (const idx of samples[group]) {
        expect(idx).toBeGreaterThanOrEqual(groupStart)
        expect(idx).toBeLessThan(groupEnd)
      }
    }
  })

  it('should produce deterministic results with same seed', () => {
    const seed = keccak256(toBytes('deterministic'))

    const samples1 = generatePeerDASSamples(256, 8, 4, seed)
    const samples2 = generatePeerDASSamples(256, 8, 4, seed)

    expect(samples1).toEqual(samples2)
  })
})

describe('verifyPeerDASSampling', () => {
  it('should verify successful sampling when all groups pass', () => {
    const samples = [
      [0, 1, 2, 3],
      [8, 9, 10, 11],
      [16, 17, 18, 19],
    ]
    const verifiedSamples = new Set([0, 1, 8, 9, 16, 17]) // At least 50% per group

    const result = verifyPeerDASSampling(samples, verifiedSamples, 0.5)

    expect(result.success).toBe(true)
    expect(result.groupResults.every((r) => r === true)).toBe(true)
  })

  it('should fail when a group does not have enough verified samples', () => {
    const samples = [
      [0, 1, 2, 3],
      [8, 9, 10, 11],
      [16, 17, 18, 19],
    ]
    const verifiedSamples = new Set([0, 1, 8, 9]) // Group 2 has 0%

    const result = verifyPeerDASSampling(samples, verifiedSamples, 0.5)

    expect(result.success).toBe(false)
    expect(result.groupResults[0]).toBe(true)
    expect(result.groupResults[1]).toBe(true)
    expect(result.groupResults[2]).toBe(false)
  })

  it('should respect minGroupSuccess parameter', () => {
    const samples = [[0, 1, 2, 3]] // 4 samples
    const verifiedSamples = new Set([0, 1]) // 2 verified = 50%

    // 50% threshold - should pass
    expect(verifyPeerDASSampling(samples, verifiedSamples, 0.5).success).toBe(
      true,
    )

    // 75% threshold - should fail
    expect(verifyPeerDASSampling(samples, verifiedSamples, 0.75).success).toBe(
      false,
    )
  })
})

// DASampler Class Tests

describe('DASampler', () => {
  it('should use default config', () => {
    // Verify DASampler can be constructed with empty config
    new DASampler({})

    expect(DEFAULT_SAMPLING_CONFIG.sampleCount).toBe(16)
    expect(DEFAULT_SAMPLING_CONFIG.targetConfidence).toBe(0.9999)
  })

  it('should update operators', () => {
    const sampler = new DASampler({})

    const operators = [
      {
        address: TEST_ADDRESS,
        status: 'active' as const,
        endpoint: getTeeEndpoint() || `http://${getLocalhostHost()}:8080`,
        reputation: 100,
      },
    ]

    sampler.updateOperators(operators)
    // No error means success
  })

  it('should clear cache', () => {
    const sampler = new DASampler({})
    sampler.clearCache()
    // No error means success
  })
})

// SampleVerifier Class Tests

describe('SampleVerifier', () => {
  let verifier: SampleVerifier
  const blobId =
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex

  beforeEach(() => {
    verifier = new SampleVerifier()
  })

  it('should store and check blob existence', () => {
    expect(verifier.hasBlob(blobId)).toBe(false)

    verifier.storeChunk(blobId, {
      index: 0,
      data: new Uint8Array([1, 2, 3]),
      blobId,
      proof: {
        merkleProof: [],
        openingProof: '0x' as Hex,
        polynomialIndex: 0,
      },
    })

    expect(verifier.hasBlob(blobId)).toBe(true)
  })

  it('should track chunk count', () => {
    expect(verifier.getChunkCount(blobId)).toBe(0)

    for (let i = 0; i < 5; i++) {
      verifier.storeChunk(blobId, {
        index: i,
        data: new Uint8Array([i]),
        blobId,
        proof: {
          merkleProof: [],
          openingProof: '0x' as Hex,
          polynomialIndex: i,
        },
      })
    }

    expect(verifier.getChunkCount(blobId)).toBe(5)
  })

  it('should remove blob data', () => {
    verifier.storeChunk(blobId, {
      index: 0,
      data: new Uint8Array([1, 2, 3]),
      blobId,
      proof: {
        merkleProof: [],
        openingProof: '0x' as Hex,
        polynomialIndex: 0,
      },
    })

    expect(verifier.hasBlob(blobId)).toBe(true)

    verifier.removeBlob(blobId)

    expect(verifier.hasBlob(blobId)).toBe(false)
  })

  it('should return storage stats', () => {
    const stats = verifier.getStats()

    expect(stats.blobCount).toBe(0)
    expect(stats.totalChunks).toBe(0)

    verifier.storeChunk(blobId, {
      index: 0,
      data: new Uint8Array([1]),
      blobId,
      proof: {
        merkleProof: [],
        openingProof: '0x' as Hex,
        polynomialIndex: 0,
      },
    })

    const stats2 = verifier.getStats()
    expect(stats2.blobCount).toBe(1)
    expect(stats2.totalChunks).toBe(1)
  })

  it('should handle sample requests', () => {
    // Store some chunks
    for (let i = 0; i < 10; i++) {
      verifier.storeChunk(blobId, {
        index: i,
        data: new Uint8Array([i]),
        blobId,
        proof: {
          merkleProof: [],
          openingProof: '0x' as Hex,
          polynomialIndex: i,
        },
      })
    }

    const request = createSampleRequest(blobId, [0, 1, 2, 5, 9], TEST_ADDRESS)
    const response = verifier.handleRequest(request, '0xsig' as Hex)

    expect(response.chunks.length).toBe(5)
    expect(response.request.blobId).toBe(blobId)
  })
})

// Sample Request/Response Tests

describe('createSampleRequest', () => {
  it('should create request with correct fields', () => {
    const blobId =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
    const chunkIndices = [0, 1, 2, 3, 4]

    const request = createSampleRequest(blobId, chunkIndices, TEST_ADDRESS)

    expect(request.blobId).toBe(blobId)
    expect(request.chunkIndices).toEqual(chunkIndices)
    expect(request.requester).toBe(TEST_ADDRESS)
    expect(request.nonce).toMatch(/^0x[a-f0-9]{64}$/)
    expect(request.timestamp).toBeGreaterThan(0)
  })

  it('should generate unique nonces', () => {
    const blobId =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex

    const request1 = createSampleRequest(blobId, [0], TEST_ADDRESS)
    const request2 = createSampleRequest(blobId, [0], TEST_ADDRESS)

    expect(request1.nonce).not.toBe(request2.nonce)
  })
})

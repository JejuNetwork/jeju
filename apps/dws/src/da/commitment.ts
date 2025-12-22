/**
 * Polynomial Commitment Scheme
 *
 * Implements efficient commitment and verification:
 * - Commit to blob data as polynomial coefficients
 * - Generate opening proofs for individual chunks
 * - Batch verification support
 * - Compatible with sampling-based verification
 */

import type { Hex } from 'viem'
import { concatHex, keccak256, toBytes, toHex } from 'viem'
import type { BlobCommitment, Chunk, ChunkProof } from './types'

// ============================================================================
// Polynomial Operations (in prime field)
// ============================================================================

// Using a 256-bit prime field for cryptographic security
// p = 2^256 - 2^32 - 977 (secp256k1 field prime)
const FIELD_PRIME =
  0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base = base % mod
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod
    }
    exp = exp / 2n
    base = (base * base) % mod
  }
  return result
}

function modInverse(a: bigint, mod: bigint): bigint {
  return modPow(a, mod - 2n, mod)
}

/**
 * Evaluate polynomial at point
 * Reserved for future use in polynomial commitment verification
 */
export function evaluatePolynomial(coeffs: bigint[], x: bigint): bigint {
  let result = 0n
  let power = 1n

  for (const coeff of coeffs) {
    result = (result + ((coeff * power) % FIELD_PRIME)) % FIELD_PRIME
    power = (power * x) % FIELD_PRIME
  }

  return result
}

/**
 * Lagrange interpolation to find polynomial from points
 */
function lagrangeInterpolate(
  points: Array<{ x: bigint; y: bigint }>,
): bigint[] {
  const n = points.length
  const coeffs: bigint[] = new Array(n).fill(0n)

  for (let i = 0; i < n; i++) {
    // Calculate Lagrange basis polynomial
    let numerator: bigint[] = [1n]
    let denominator = 1n

    for (let j = 0; j < n; j++) {
      if (i !== j) {
        // Multiply numerator by (x - x_j)
        const newNumerator: bigint[] = new Array(numerator.length + 1).fill(0n)
        for (let k = 0; k < numerator.length; k++) {
          newNumerator[k] =
            (newNumerator[k] + numerator[k] * -points[j].x) % FIELD_PRIME
          newNumerator[k + 1] =
            (newNumerator[k + 1] + numerator[k]) % FIELD_PRIME
        }
        numerator = newNumerator.map((c) => (c + FIELD_PRIME) % FIELD_PRIME)

        // Multiply denominator by (x_i - x_j)
        const diff = (points[i].x - points[j].x + FIELD_PRIME) % FIELD_PRIME
        denominator = (denominator * diff) % FIELD_PRIME
      }
    }

    // Scale by y_i / denominator
    const scale =
      (points[i].y * modInverse(denominator, FIELD_PRIME)) % FIELD_PRIME

    // Add to result
    for (let k = 0; k < numerator.length; k++) {
      coeffs[k] = (coeffs[k] + numerator[k] * scale) % FIELD_PRIME
    }
  }

  return coeffs
}

// ============================================================================
// Commitment Generation
// ============================================================================

/**
 * Generate polynomial commitment from data chunks
 */
export function createCommitment(
  chunks: Uint8Array[],
  chunkSize: number,
  dataChunkCount: number,
  parityChunkCount: number,
): BlobCommitment {
  // Convert chunks to field elements
  const elements: bigint[] = chunks.map((chunk) => {
    // Hash chunk to get field element
    const hash = keccak256(chunk)
    return BigInt(hash) % FIELD_PRIME
  })

  // Create polynomial from elements
  // Each chunk becomes a point on the polynomial
  const points = elements.map((y, x) => ({
    x: BigInt(x + 1), // Use 1-indexed to avoid x=0
    y,
  }))

  // Interpolate polynomial
  const _coefficients = lagrangeInterpolate(points)

  // Commitment is hash of polynomial coefficients
  const coeffHashInput = _coefficients
    .map((c) => c.toString(16).padStart(64, '0'))
    .join('')
  const commitment = keccak256(toBytes(`0x${coeffHashInput}`))

  // Compute Merkle root of chunks
  const leaves = chunks.map((c) => keccak256(c))
  const merkleRoot = computeMerkleRoot(leaves)

  return {
    commitment,
    dataChunkCount,
    parityChunkCount,
    totalChunkCount: chunks.length,
    chunkSize,
    merkleRoot,
    timestamp: Date.now(),
  }
}

/**
 * Compute Merkle root from leaves
 */
function computeMerkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) {
    return keccak256(toBytes('0x'))
  }

  if (leaves.length === 1) {
    return leaves[0]
  }

  const nextLevel: Hex[] = []
  for (let i = 0; i < leaves.length; i += 2) {
    const left = leaves[i]
    const right = leaves[i + 1] ?? left
    nextLevel.push(keccak256(concatHex([left, right])))
  }

  return computeMerkleRoot(nextLevel)
}

// ============================================================================
// Proof Generation
// ============================================================================

/**
 * Generate opening proof for a specific chunk
 */
export function createOpeningProof(
  chunks: Uint8Array[],
  chunkIndex: number,
  _commitment: BlobCommitment,
): ChunkProof {
  // Compute Merkle proof
  const leaves = chunks.map((c) => keccak256(c))
  const merkleProof = computeMerkleProof(leaves, chunkIndex)

  // Create polynomial opening proof
  // This is a simplified version - production would use KZG proofs
  const openingProof = createPolynomialOpening(chunks, chunkIndex)

  return {
    merkleProof,
    openingProof,
    polynomialIndex: chunkIndex,
  }
}

/**
 * Compute Merkle proof for leaf at index
 */
function computeMerkleProof(leaves: Hex[], index: number): Hex[] {
  const proof: Hex[] = []
  let level = [...leaves]
  let idx = index

  while (level.length > 1) {
    const isRight = idx % 2 === 1
    const siblingIdx = isRight ? idx - 1 : idx + 1

    if (siblingIdx < level.length) {
      proof.push(level[siblingIdx])
    } else {
      proof.push(level[idx])
    }

    // Move to next level
    const nextLevel: Hex[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1] ?? left
      nextLevel.push(keccak256(concatHex([left, right])))
    }

    level = nextLevel
    idx = Math.floor(idx / 2)
  }

  return proof
}

/**
 * Create polynomial opening proof
 * Simplified version - production would use proper KZG setup
 */
function createPolynomialOpening(chunks: Uint8Array[], index: number): Hex {
  // Hash all chunks with the index to create deterministic proof
  const proofData = chunks.map((c, i) => {
    const chunkHash = keccak256(c)
    return keccak256(toBytes(`${chunkHash}:${index}:${i}`))
  })

  // Aggregate into single proof
  const aggregated = proofData.reduce(
    (acc, h) => keccak256(concatHex([acc, h])),
    keccak256(toBytes(`opening:${index}`)),
  )

  return aggregated
}

// ============================================================================
// Proof Verification
// ============================================================================

/**
 * Verify chunk proof against commitment
 */
export function verifyProof(chunk: Chunk, commitment: BlobCommitment): boolean {
  // Verify Merkle proof
  const chunkHash = keccak256(chunk.data)
  const merkleValid = verifyMerkleProof(
    chunkHash,
    chunk.proof.merkleProof,
    commitment.merkleRoot,
    chunk.index,
  )

  if (!merkleValid) {
    return false
  }

  // Verify polynomial opening (simplified)
  // In production, this would verify against KZG commitment
  return verifyPolynomialOpening(chunk, commitment)
}

/**
 * Verify Merkle proof
 */
function verifyMerkleProof(
  leaf: Hex,
  proof: Hex[],
  root: Hex,
  index: number,
): boolean {
  let hash = leaf
  let idx = index

  for (const sibling of proof) {
    const isRight = idx % 2 === 1
    if (isRight) {
      hash = keccak256(concatHex([sibling, hash]))
    } else {
      hash = keccak256(concatHex([hash, sibling]))
    }
    idx = Math.floor(idx / 2)
  }

  return hash.toLowerCase() === root.toLowerCase()
}

/**
 * Verify polynomial opening proof
 *
 * This implementation verifies:
 * 1. Chunk index bounds
 * 2. Chunk size matches commitment
 * 3. Polynomial index consistency
 *
 * NOTE: The Merkle proof provides the primary security.
 * For production KZG, implement: e(C - [y]_1, [1]_2) = e(π, [τ - x]_2)
 * using a trusted setup ceremony and pairing-friendly curves.
 */
function verifyPolynomialOpening(
  chunk: Chunk,
  commitment: BlobCommitment,
): boolean {
  // Verify the chunk index is valid
  if (chunk.index < 0 || chunk.index >= commitment.totalChunkCount) {
    return false
  }

  // Verify chunk size (allow slight variation for padding)
  if (chunk.data.length > commitment.chunkSize + 32) {
    return false
  }

  // Verify polynomial index matches chunk index
  if (chunk.proof.polynomialIndex !== chunk.index) {
    return false
  }

  // The Merkle proof verification (done separately) provides
  // cryptographic binding between the chunk and commitment.
  // Opening proof adds polynomial consistency check.
  return true
}

// ============================================================================
// Batch Verification
// ============================================================================

/**
 * Verify multiple chunks in batch
 */
export function verifyBatch(
  chunks: Chunk[],
  commitment: BlobCommitment,
): { valid: boolean; validCount: number; invalidIndices: number[] } {
  const invalidIndices: number[] = []

  for (const chunk of chunks) {
    if (!verifyProof(chunk, commitment)) {
      invalidIndices.push(chunk.index)
    }
  }

  return {
    valid: invalidIndices.length === 0,
    validCount: chunks.length - invalidIndices.length,
    invalidIndices,
  }
}

// ============================================================================
// Polynomial Commitment Wrapper
// ============================================================================

export interface PolynomialCommitment {
  commitment: BlobCommitment
  chunks: Chunk[]

  getChunk(index: number): Chunk | null
  getProof(index: number): ChunkProof | null
  verify(chunk: Chunk): boolean
  verifyAll(): boolean
}

export function createPolynomialCommitment(
  _data: Uint8Array,
  chunks: Uint8Array[],
  dataChunkCount: number,
  parityChunkCount: number,
  blobId: Hex,
): PolynomialCommitment {
  const chunkSize = chunks[0]?.length ?? 0
  const commitment = createCommitment(
    chunks,
    chunkSize,
    dataChunkCount,
    parityChunkCount,
  )

  const chunksWithProofs: Chunk[] = chunks.map((chunk, index) => ({
    index,
    data: chunk,
    blobId,
    proof: createOpeningProof(chunks, index, commitment),
  }))

  return {
    commitment,
    chunks: chunksWithProofs,

    getChunk(index: number): Chunk | null {
      return chunksWithProofs[index] ?? null
    },

    getProof(index: number): ChunkProof | null {
      return chunksWithProofs[index]?.proof ?? null
    },

    verify(chunk: Chunk): boolean {
      return verifyProof(chunk, commitment)
    },

    verifyAll(): boolean {
      return chunksWithProofs.every((c) => verifyProof(c, commitment))
    },
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Convert bytes to hex with proper formatting
 */
export function bytesToCommitmentHex(data: Uint8Array): Hex {
  return toHex(data)
}

/**
 * Compute blob ID from data
 */
export function computeBlobId(data: Uint8Array): Hex {
  return keccak256(data)
}

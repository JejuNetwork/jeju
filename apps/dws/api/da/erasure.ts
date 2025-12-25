/**
 * Reed-Solomon Erasure Coding
 *
 * Implements erasure coding for data redundancy:
 * - Encode data into N data shards + M parity shards
 * - Reconstruct original data from any N shards
 * - Efficient Galois Field arithmetic
 */

import type { Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import type { Chunk, ErasureConfig } from './types'

// Galois Field GF(2^8) Implementation

const GF_SIZE = 256
const PRIMITIVE_POLY = 0x11d // x^8 + x^4 + x^3 + x^2 + 1

// Precomputed tables for fast GF arithmetic
let gfExp: Uint8Array
let gfLog: Uint8Array
let tablesInitialized = false

function initGFTables(): void {
  if (tablesInitialized) return

  gfExp = new Uint8Array(GF_SIZE * 2)
  gfLog = new Uint8Array(GF_SIZE)

  let x = 1
  for (let i = 0; i < GF_SIZE - 1; i++) {
    gfExp[i] = x
    gfExp[i + GF_SIZE - 1] = x
    gfLog[x] = i
    x = x << 1
    if (x >= GF_SIZE) {
      x ^= PRIMITIVE_POLY
    }
  }
  gfLog[0] = 0 // Special case

  tablesInitialized = true
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return gfExp[gfLog[a] + gfLog[b]]
}

/** Galois field division */
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF')
  if (a === 0) return 0
  return gfExp[gfLog[a] + GF_SIZE - 1 - gfLog[b]]
}

function gfPow(a: number, n: number): number {
  if (n === 0) return 1
  if (a === 0) return 0
  return gfExp[(gfLog[a] * n) % (GF_SIZE - 1)]
}

function gfInv(a: number): number {
  if (a === 0) throw new Error('Cannot invert zero in GF')
  return gfExp[GF_SIZE - 1 - gfLog[a]]
}

// Vandermonde Matrix Operations

function createVandermondeMatrix(rows: number, cols: number): Uint8Array[] {
  const matrix: Uint8Array[] = []

  for (let r = 0; r < rows; r++) {
    const row = new Uint8Array(cols)
    for (let c = 0; c < cols; c++) {
      row[c] = gfPow(r + 1, c)
    }
    matrix.push(row)
  }

  return matrix
}

function matrixMul(
  matrix: Uint8Array[],
  data: Uint8Array[],
  dataShards: number,
): Uint8Array[] {
  const result: Uint8Array[] = []
  const chunkSize = data[0].length

  for (let r = 0; r < matrix.length; r++) {
    const row = new Uint8Array(chunkSize)
    for (let c = 0; c < dataShards; c++) {
      if (!data[c]) continue
      const coeff = matrix[r][c]
      for (let i = 0; i < chunkSize; i++) {
        row[i] ^= gfMul(coeff, data[c][i])
      }
    }
    result.push(row)
  }

  return result
}

function invertMatrix(matrix: Uint8Array[]): Uint8Array[] {
  const n = matrix.length
  const augmented: Uint8Array[] = []

  // Create augmented matrix [M | I]
  for (let i = 0; i < n; i++) {
    const row = new Uint8Array(n * 2)
    for (let j = 0; j < n; j++) {
      row[j] = matrix[i][j]
    }
    row[n + i] = 1
    augmented.push(row)
  }

  // Gaussian elimination
  for (let col = 0; col < n; col++) {
    // Find pivot
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (augmented[row][col] > augmented[pivot][col]) {
        pivot = row
      }
    }

    // Swap rows
    if (pivot !== col) {
      ;[augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]]
    }

    // Scale pivot row
    const scale = gfInv(augmented[col][col])
    for (let j = 0; j < n * 2; j++) {
      augmented[col][j] = gfMul(augmented[col][j], scale)
    }

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row !== col && augmented[row][col] !== 0) {
        const factor = augmented[row][col]
        for (let j = 0; j < n * 2; j++) {
          augmented[row][j] ^= gfMul(factor, augmented[col][j])
        }
      }
    }
  }

  // Extract inverse matrix
  const inverse: Uint8Array[] = []
  for (let i = 0; i < n; i++) {
    inverse.push(augmented[i].slice(n, n * 2))
  }

  return inverse
}

// Reed-Solomon Codec

export interface ReedSolomonCodecConfig {
  dataShards: number
  parityShards: number
}

export class ReedSolomonCodec {
  private readonly dataShards: number
  private readonly parityShards: number
  private readonly totalShards: number
  private readonly parityMatrix: Uint8Array[]

  constructor(config: ReedSolomonCodecConfig) {
    initGFTables()

    this.dataShards = config.dataShards
    this.parityShards = config.parityShards
    this.totalShards = config.dataShards + config.parityShards

    if (this.totalShards > GF_SIZE - 1) {
      throw new Error(
        `Total shards (${this.totalShards}) exceeds maximum (${GF_SIZE - 1})`,
      )
    }

    // Create Vandermonde parity matrix
    this.parityMatrix = createVandermondeMatrix(
      this.parityShards,
      this.dataShards,
    )
  }

  /**
   * Encode data into shards
   */
  encode(data: Uint8Array, chunkSize?: number): Uint8Array[] {
    const shardSize = chunkSize ?? Math.ceil(data.length / this.dataShards)
    const paddedSize = shardSize * this.dataShards

    // Pad data if necessary
    const paddedData = new Uint8Array(paddedSize)
    paddedData.set(data)

    // Split into data shards
    const dataShards: Uint8Array[] = []
    for (let i = 0; i < this.dataShards; i++) {
      const start = i * shardSize
      dataShards.push(paddedData.slice(start, start + shardSize))
    }

    // Generate parity shards
    const parityShards = matrixMul(
      this.parityMatrix,
      dataShards,
      this.dataShards,
    )

    return [...dataShards, ...parityShards]
  }

  /**
   * Decode data from shards (some may be missing)
   */
  decode(shards: (Uint8Array | null)[], originalSize: number): Uint8Array {
    // Find available shards
    const availableIndices: number[] = []
    for (let i = 0; i < shards.length; i++) {
      if (shards[i] !== null) {
        availableIndices.push(i)
      }
    }

    if (availableIndices.length < this.dataShards) {
      throw new Error(
        `Insufficient shards: need ${this.dataShards}, have ${availableIndices.length}`,
      )
    }

    // Use first dataShards available shards
    const usedIndices = availableIndices.slice(0, this.dataShards)

    // Check if all data shards are available (no reconstruction needed)
    const allDataAvailable = usedIndices.every((i) => i < this.dataShards)
    if (allDataAvailable) {
      // Just concatenate data shards
      const firstIndex = usedIndices[0]
      if (firstIndex === undefined) {
        throw new Error('No available shard indices')
      }
      const firstShard = shards[firstIndex]
      if (!firstShard) {
        throw new Error('First shard not found')
      }
      const shardSize = firstShard.length
      const result = new Uint8Array(originalSize)
      let offset = 0
      for (let i = 0; i < this.dataShards && offset < originalSize; i++) {
        const shard = shards[i]
        if (!shard) {
          throw new Error(`Data shard ${i} not found`)
        }
        const copyLen = Math.min(shardSize, originalSize - offset)
        result.set(shard.slice(0, copyLen), offset)
        offset += copyLen
      }
      return result
    }

    // Build reconstruction matrix
    const fullMatrix = this.buildFullMatrix()
    const subMatrix: Uint8Array[] = []
    for (const idx of usedIndices) {
      subMatrix.push(fullMatrix[idx])
    }

    // Invert the submatrix
    const invMatrix = invertMatrix(subMatrix)

    // Collect available shards
    const availableShards: Uint8Array[] = usedIndices.map((i) => {
      const shard = shards[i]
      if (!shard) {
        throw new Error(`Shard at index ${i} not found`)
      }
      return shard
    })

    // Reconstruct data shards
    const reconstructed = matrixMul(invMatrix, availableShards, this.dataShards)

    // Concatenate and return
    const shardSize = availableShards[0].length
    const result = new Uint8Array(originalSize)
    let offset = 0
    for (let i = 0; i < this.dataShards && offset < originalSize; i++) {
      const shard = reconstructed[i]
      const copyLen = Math.min(shardSize, originalSize - offset)
      result.set(shard.slice(0, copyLen), offset)
      offset += copyLen
    }

    return result
  }

  /**
   * Build full encoding matrix (identity for data + Vandermonde for parity)
   */
  private buildFullMatrix(): Uint8Array[] {
    const matrix: Uint8Array[] = []

    // Identity matrix for data shards
    for (let i = 0; i < this.dataShards; i++) {
      const row = new Uint8Array(this.dataShards)
      row[i] = 1
      matrix.push(row)
    }

    // Parity matrix
    for (const row of this.parityMatrix) {
      matrix.push(row)
    }

    return matrix
  }

  /**
   * Verify that shards are consistent
   */
  verify(shards: Uint8Array[]): boolean {
    if (shards.length !== this.totalShards) {
      return false
    }

    // Re-encode and compare parity
    const dataShards = shards.slice(0, this.dataShards)
    const expectedParity = matrixMul(
      this.parityMatrix,
      dataShards,
      this.dataShards,
    )

    for (let i = 0; i < this.parityShards; i++) {
      const actual = shards[this.dataShards + i]
      const expected = expectedParity[i]
      if (actual.length !== expected.length) return false
      for (let j = 0; j < actual.length; j++) {
        if (actual[j] !== expected[j]) return false
      }
    }

    return true
  }

  /**
   * Create chunks with proofs
   */
  createChunks(data: Uint8Array, blobId: Hex): Chunk[] {
    const shards = this.encode(data)
    const chunks: Chunk[] = []

    // Build Merkle tree for proofs
    const leaves = shards.map((s) => keccak256(s))
    const merkleTree = this.buildMerkleTree(leaves)

    for (let i = 0; i < shards.length; i++) {
      const proof = this.getMerkleProof(merkleTree, i)
      // Generate opening proof: hash of chunk data with index and blob ID
      // This binds the chunk to its position in the polynomial
      const openingProof = keccak256(
        toBytes(`opening:${blobId}:${i}:${keccak256(shards[i])}`),
      )

      chunks.push({
        index: i,
        data: shards[i],
        blobId,
        proof: {
          merkleProof: proof,
          openingProof,
          polynomialIndex: i,
        },
      })
    }

    return chunks
  }

  /**
   * Reconstruct data from chunks
   */
  reconstructFromChunks(chunks: Chunk[], originalSize: number): Uint8Array {
    // Create shard array with nulls for missing shards
    const shards: (Uint8Array | null)[] = new Array(this.totalShards).fill(null)

    for (const chunk of chunks) {
      shards[chunk.index] = chunk.data
    }

    return this.decode(shards, originalSize)
  }

  /**
   * Build Merkle tree from leaves
   */
  private buildMerkleTree(leaves: Hex[]): Hex[][] {
    const tree: Hex[][] = [leaves]

    while (tree[tree.length - 1].length > 1) {
      const level = tree[tree.length - 1]
      const nextLevel: Hex[] = []

      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]
        const right = level[i + 1] ?? left
        nextLevel.push(keccak256(toBytes(`${left}${right.slice(2)}`)))
      }

      tree.push(nextLevel)
    }

    return tree
  }

  /**
   * Get Merkle proof for leaf at index
   */
  private getMerkleProof(tree: Hex[][], index: number): Hex[] {
    const proof: Hex[] = []
    let idx = index

    for (let level = 0; level < tree.length - 1; level++) {
      const isRight = idx % 2 === 1
      const siblingIdx = isRight ? idx - 1 : idx + 1

      if (siblingIdx < tree[level].length) {
        proof.push(tree[level][siblingIdx])
      } else {
        proof.push(tree[level][idx])
      }

      idx = Math.floor(idx / 2)
    }

    return proof
  }

  /**
   * Verify Merkle proof
   */
  verifyMerkleProof(
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
        hash = keccak256(toBytes(`${sibling}${hash.slice(2)}`))
      } else {
        hash = keccak256(toBytes(`${hash}${sibling.slice(2)}`))
      }
      idx = Math.floor(idx / 2)
    }

    return hash === root
  }

  get config(): ReedSolomonCodecConfig {
    return {
      dataShards: this.dataShards,
      parityShards: this.parityShards,
    }
  }
}

// Factory

export function createReedSolomonCodec(
  config?: Partial<ErasureConfig>,
): ReedSolomonCodec {
  return new ReedSolomonCodec({
    dataShards: config?.dataShards ?? 16,
    parityShards: config?.parityShards ?? 16,
  })
}

// Default codec for typical use (50% redundancy)
export const defaultCodec = createReedSolomonCodec({
  dataShards: 16,
  parityShards: 16,
})

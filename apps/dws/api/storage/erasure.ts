/**
 * Erasure Coding for DWS Storage
 *
 * Implements Reed-Solomon erasure coding for content durability:
 * - Split content into data shards
 * - Generate parity shards for redundancy
 * - Reconstruct content from any k-of-n shards
 * - Distribute shards across different nodes/regions
 *
 * Default configuration: 4 data shards + 2 parity shards (4,2)
 * Can recover from loss of any 2 shards
 */

import { createHash } from 'node:crypto'
import type { Hex } from 'viem'

// ============ Configuration ============

export interface ErasureConfig {
  /** Number of data shards (k) */
  dataShards: number
  /** Number of parity shards (m) */
  parityShards: number
  /** Minimum shards required for reconstruction (equals dataShards) */
  minShards?: number
  /** Enable debug logging */
  debug?: boolean
}

export interface EncodedContent {
  /** Original content CID/hash */
  contentId: string
  /** Original content size in bytes */
  originalSize: number
  /** SHA256 hash of original content */
  originalHash: Hex
  /** Number of data shards */
  dataShards: number
  /** Number of parity shards */
  parityShards: number
  /** Shard size in bytes */
  shardSize: number
  /** Array of shard metadata */
  shards: ShardInfo[]
}

export interface ShardInfo {
  /** Shard index (0 to dataShards + parityShards - 1) */
  index: number
  /** Shard hash for verification */
  hash: Hex
  /** Shard size in bytes */
  size: number
  /** Whether this is a parity shard */
  isParity: boolean
  /** CID for the shard content */
  cid?: string
  /** Node ID storing this shard */
  nodeId?: string
  /** Region where shard is stored */
  region?: string
}

export interface Shard {
  /** Shard info */
  info: ShardInfo
  /** Shard data */
  data: Uint8Array
}

// Default configuration (4,2) - can recover from 2 node failures
const DEFAULT_CONFIG: ErasureConfig = {
  dataShards: 4,
  parityShards: 2,
  debug: false,
}

// ============ Galois Field Arithmetic ============

/**
 * GF(2^8) Galois Field implementation for Reed-Solomon coding
 * Using primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
 */
class GaloisField {
  private static readonly FIELD_SIZE = 256
  private static readonly PRIMITIVE_POLYNOMIAL = 0x11d

  private expTable: Uint8Array
  private logTable: Uint8Array

  constructor() {
    this.expTable = new Uint8Array(GaloisField.FIELD_SIZE * 2)
    this.logTable = new Uint8Array(GaloisField.FIELD_SIZE)

    // Generate exp and log tables
    let x = 1
    for (let i = 0; i < GaloisField.FIELD_SIZE - 1; i++) {
      this.expTable[i] = x
      this.expTable[i + GaloisField.FIELD_SIZE - 1] = x
      this.logTable[x] = i

      x <<= 1
      if (x >= GaloisField.FIELD_SIZE) {
        x ^= GaloisField.PRIMITIVE_POLYNOMIAL
      }
    }
    this.logTable[0] = 0 // log(0) is undefined, but we set it to 0 for convenience
  }

  add(a: number, b: number): number {
    return a ^ b
  }

  sub(a: number, b: number): number {
    return a ^ b // Same as add in GF(2^n)
  }

  mul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0
    return this.expTable[this.logTable[a] + this.logTable[b]]
  }

  div(a: number, b: number): number {
    if (b === 0) throw new Error('Division by zero')
    if (a === 0) return 0
    return this.expTable[this.logTable[a] + 255 - this.logTable[b]]
  }

  pow(a: number, n: number): number {
    if (n === 0) return 1
    if (a === 0) return 0
    return this.expTable[(this.logTable[a] * n) % 255]
  }

  inv(a: number): number {
    if (a === 0) throw new Error('Cannot invert zero')
    return this.expTable[255 - this.logTable[a]]
  }
}

// ============ Reed-Solomon Encoder/Decoder ============

/**
 * Reed-Solomon encoder/decoder using Vandermonde matrix
 */
class ReedSolomon {
  private gf: GaloisField
  private dataShards: number
  private parityShards: number
  private matrix: Uint8Array[]

  constructor(dataShards: number, parityShards: number) {
    this.gf = new GaloisField()
    this.dataShards = dataShards
    this.parityShards = parityShards

    // Generate Vandermonde matrix for encoding
    this.matrix = this.generateEncodingMatrix()
  }

  /**
   * Generate the encoding matrix (Vandermonde-based)
   */
  private generateEncodingMatrix(): Uint8Array[] {
    const matrix: Uint8Array[] = []

    // First dataShards rows are identity matrix
    for (let i = 0; i < this.dataShards; i++) {
      const row = new Uint8Array(this.dataShards)
      row[i] = 1
      matrix.push(row)
    }

    // Parity rows use Vandermonde construction
    for (let i = 0; i < this.parityShards; i++) {
      const row = new Uint8Array(this.dataShards)
      for (let j = 0; j < this.dataShards; j++) {
        row[j] = this.gf.pow(j + 1, i)
      }
      matrix.push(row)
    }

    return matrix
  }

  /**
   * Encode data into data + parity shards
   */
  encode(data: Uint8Array): Uint8Array[] {
    // Pad data to be divisible by dataShards
    const shardSize = Math.ceil(data.length / this.dataShards)
    const paddedSize = shardSize * this.dataShards

    const paddedData = new Uint8Array(paddedSize)
    paddedData.set(data)

    // Split into data shards
    const shards: Uint8Array[] = []
    for (let i = 0; i < this.dataShards; i++) {
      shards.push(paddedData.slice(i * shardSize, (i + 1) * shardSize))
    }

    // Generate parity shards
    for (let i = 0; i < this.parityShards; i++) {
      const parityShard = new Uint8Array(shardSize)

      for (let byteIdx = 0; byteIdx < shardSize; byteIdx++) {
        let parity = 0
        for (let j = 0; j < this.dataShards; j++) {
          parity = this.gf.add(
            parity,
            this.gf.mul(
              this.matrix[this.dataShards + i][j],
              shards[j][byteIdx],
            ),
          )
        }
        parityShard[byteIdx] = parity
      }

      shards.push(parityShard)
    }

    return shards
  }

  /**
   * Decode shards back to original data
   * @param shards Array of shards (null for missing shards)
   * @param presentIndices Indices of present shards
   */
  decode(shards: (Uint8Array | null)[], presentIndices: number[]): Uint8Array {
    if (presentIndices.length < this.dataShards) {
      throw new Error(
        `Need at least ${this.dataShards} shards to reconstruct, got ${presentIndices.length}`,
      )
    }

    const shardSize = shards[presentIndices[0]]?.length ?? 0
    if (shardSize === 0) {
      throw new Error('Invalid shard size')
    }

    // Use only dataShards present shards for reconstruction
    const usedIndices = presentIndices.slice(0, this.dataShards)

    // Build sub-matrix from encoding matrix for present shards
    const subMatrix: number[][] = []
    for (const idx of usedIndices) {
      subMatrix.push(Array.from(this.matrix[idx]))
    }

    // Invert the sub-matrix
    const invMatrix = this.invertMatrix(subMatrix)

    // Reconstruct data shards
    const reconstructed: Uint8Array[] = []
    for (let i = 0; i < this.dataShards; i++) {
      const dataShard = new Uint8Array(shardSize)

      for (let byteIdx = 0; byteIdx < shardSize; byteIdx++) {
        let value = 0
        for (let j = 0; j < this.dataShards; j++) {
          const shardData = shards[usedIndices[j]]
          if (shardData) {
            value = this.gf.add(
              value,
              this.gf.mul(invMatrix[i][j], shardData[byteIdx]),
            )
          }
        }
        dataShard[byteIdx] = value
      }

      reconstructed.push(dataShard)
    }

    // Concatenate data shards
    const result = new Uint8Array(shardSize * this.dataShards)
    for (let i = 0; i < this.dataShards; i++) {
      result.set(reconstructed[i], i * shardSize)
    }

    return result
  }

  /**
   * Invert a matrix using Gaussian elimination
   */
  private invertMatrix(matrix: number[][]): number[][] {
    const n = matrix.length
    const result: number[][] = []

    // Create augmented matrix [A | I]
    for (let i = 0; i < n; i++) {
      result.push([...matrix[i]])
      for (let j = 0; j < n; j++) {
        result[i].push(i === j ? 1 : 0)
      }
    }

    // Gaussian elimination with partial pivoting
    for (let col = 0; col < n; col++) {
      // Find pivot
      let maxRow = col
      for (let row = col + 1; row < n; row++) {
        if (result[row][col] > result[maxRow][col]) {
          maxRow = row
        }
      }
      // Swap rows
      ;[result[col], result[maxRow]] = [result[maxRow], result[col]]

      if (result[col][col] === 0) {
        throw new Error('Matrix is singular, cannot invert')
      }

      // Scale pivot row
      const pivotInv = this.gf.inv(result[col][col])
      for (let j = 0; j < 2 * n; j++) {
        result[col][j] = this.gf.mul(result[col][j], pivotInv)
      }

      // Eliminate other rows
      for (let row = 0; row < n; row++) {
        if (row !== col && result[row][col] !== 0) {
          const factor = result[row][col]
          for (let j = 0; j < 2 * n; j++) {
            result[row][j] = this.gf.sub(
              result[row][j],
              this.gf.mul(factor, result[col][j]),
            )
          }
        }
      }
    }

    // Extract inverse matrix
    const inverse: number[][] = []
    for (let i = 0; i < n; i++) {
      inverse.push(result[i].slice(n))
    }

    return inverse
  }
}

// ============ Erasure Encoder ============

/**
 * Erasure encoder for DWS storage
 */
export class ErasureEncoder {
  private config: ErasureConfig
  private rs: ReedSolomon

  constructor(config: Partial<ErasureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rs = new ReedSolomon(this.config.dataShards, this.config.parityShards)
  }

  /**
   * Encode content into erasure-coded shards
   */
  encode(content: Buffer, contentId?: string): EncodedContent {
    const data = new Uint8Array(content)
    const originalSize = data.length
    const originalHash =
      `0x${createHash('sha256').update(content).digest('hex')}` as Hex
    const id =
      contentId ??
      createHash('sha256').update(content).digest('hex').slice(0, 16)

    // Encode using Reed-Solomon
    const shardData = this.rs.encode(data)
    const shardSize = shardData[0].length

    // Create shard info
    const shards: ShardInfo[] = shardData.map((shard, index) => ({
      index,
      hash: `0x${createHash('sha256').update(shard).digest('hex')}` as Hex,
      size: shard.length,
      isParity: index >= this.config.dataShards,
    }))

    if (this.config.debug) {
      console.log(
        `[Erasure] Encoded ${originalSize} bytes into ${shards.length} shards of ${shardSize} bytes each`,
      )
    }

    return {
      contentId: id,
      originalSize,
      originalHash,
      dataShards: this.config.dataShards,
      parityShards: this.config.parityShards,
      shardSize,
      shards,
    }
  }

  /**
   * Get shard data by index
   */
  getShardData(content: Buffer, index: number): Shard {
    const data = new Uint8Array(content)
    const shardData = this.rs.encode(data)

    if (index < 0 || index >= shardData.length) {
      throw new Error(`Invalid shard index: ${index}`)
    }

    const isParity = index >= this.config.dataShards

    return {
      info: {
        index,
        hash: `0x${createHash('sha256').update(shardData[index]).digest('hex')}` as Hex,
        size: shardData[index].length,
        isParity,
      },
      data: shardData[index],
    }
  }

  /**
   * Get all shards for content
   */
  getAllShards(content: Buffer): Shard[] {
    const data = new Uint8Array(content)
    const shardData = this.rs.encode(data)

    return shardData.map((shard, index) => ({
      info: {
        index,
        hash: `0x${createHash('sha256').update(shard).digest('hex')}` as Hex,
        size: shard.length,
        isParity: index >= this.config.dataShards,
      },
      data: shard,
    }))
  }
}

// ============ Erasure Decoder ============

/**
 * Erasure decoder for DWS storage
 */
export class ErasureDecoder {
  private config: ErasureConfig
  private rs: ReedSolomon

  constructor(config: Partial<ErasureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rs = new ReedSolomon(this.config.dataShards, this.config.parityShards)
  }

  /**
   * Decode shards back to original content
   */
  decode(shards: Shard[], encodedInfo: EncodedContent): Buffer {
    // Validate we have enough shards
    if (shards.length < this.config.dataShards) {
      throw new Error(
        `Need at least ${this.config.dataShards} shards, got ${shards.length}`,
      )
    }

    // Verify shard hashes
    for (const shard of shards) {
      const expectedHash = encodedInfo.shards.find(
        (s) => s.index === shard.info.index,
      )?.hash
      if (expectedHash && shard.info.hash !== expectedHash) {
        throw new Error(`Shard ${shard.info.index} hash mismatch`)
      }
    }

    // Prepare shards array with nulls for missing
    const totalShards = this.config.dataShards + this.config.parityShards
    const shardArray: (Uint8Array | null)[] = new Array(totalShards).fill(null)
    const presentIndices: number[] = []

    for (const shard of shards) {
      shardArray[shard.info.index] = shard.data
      presentIndices.push(shard.info.index)
    }

    // Decode
    const decoded = this.rs.decode(shardArray, presentIndices)

    // Trim to original size
    const result = Buffer.from(decoded.slice(0, encodedInfo.originalSize))

    // Verify hash
    const resultHash =
      `0x${createHash('sha256').update(result).digest('hex')}` as Hex
    if (resultHash !== encodedInfo.originalHash) {
      throw new Error('Decoded content hash mismatch')
    }

    if (this.config.debug) {
      console.log(
        `[Erasure] Decoded ${encodedInfo.originalSize} bytes from ${shards.length} shards`,
      )
    }

    return result
  }

  /**
   * Check if content can be reconstructed from available shards
   */
  canReconstruct(availableIndices: number[]): boolean {
    return availableIndices.length >= this.config.dataShards
  }

  /**
   * Calculate how many more shards are needed
   */
  shardsNeeded(availableCount: number): number {
    return Math.max(0, this.config.dataShards - availableCount)
  }
}

// ============ Convenience Functions ============

/**
 * Create an erasure encoder with default configuration
 */
export function createEncoder(config?: Partial<ErasureConfig>): ErasureEncoder {
  return new ErasureEncoder(config)
}

/**
 * Create an erasure decoder with default configuration
 */
export function createDecoder(config?: Partial<ErasureConfig>): ErasureDecoder {
  return new ErasureDecoder(config)
}

/**
 * Encode content and return all shards
 */
export function encodeContent(
  content: Buffer,
  config?: Partial<ErasureConfig>,
): { encoded: EncodedContent; shards: Shard[] } {
  const encoder = new ErasureEncoder(config)
  const encoded = encoder.encode(content)
  const shards = encoder.getAllShards(content)
  return { encoded, shards }
}

/**
 * Decode shards back to original content
 */
export function decodeContent(
  shards: Shard[],
  encodedInfo: EncodedContent,
  config?: Partial<ErasureConfig>,
): Buffer {
  const decoder = new ErasureDecoder(config)
  return decoder.decode(shards, encodedInfo)
}

/**
 * Calculate storage overhead for erasure coding
 */
export function calculateOverhead(
  dataShards: number,
  parityShards: number,
): number {
  return (dataShards + parityShards) / dataShards
}

/**
 * Calculate fault tolerance (how many shards can be lost)
 */
export function calculateFaultTolerance(parityShards: number): number {
  return parityShards
}

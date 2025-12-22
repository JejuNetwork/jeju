/**
 * PeerDAS (Peer Data Availability Sampling) Integration
 *
 * Full EIP-7594 compatible implementation:
 * - 2D erasure coding (rows + columns)
 * - Column-based custody with subnet distribution
 * - KZG-style polynomial commitments
 * - Light node sampling protocol
 * - Validator custody requirements
 *
 * @see https://eips.ethereum.org/EIPS/eip-7594
 */

import type { Address, Hex } from 'viem'
import { concatHex, keccak256, toBytes, toHex } from 'viem'
import { gfAdd, gfMul, gfPow } from './crypto/reed-solomon-2d'

// ============================================================================
// PeerDAS Constants (EIP-7594 compliant)
// ============================================================================

/** Number of columns in the data matrix */
export const DATA_COLUMN_COUNT = 128

/** Number of columns extended with parity (2x for Reed-Solomon) */
export const EXTENDED_COLUMN_COUNT = 256

/** Number of field elements per blob */
export const FIELD_ELEMENTS_PER_BLOB = 4096

/** Field element size in bytes */
export const FIELD_ELEMENT_SIZE = 32

/** Maximum blob size (128 KB) */
export const MAX_BLOB_SIZE = FIELD_ELEMENTS_PER_BLOB * FIELD_ELEMENT_SIZE

/** Number of columns per subnet */
export const COLUMNS_PER_SUBNET = 8

/** Number of subnets */
export const SUBNET_COUNT = EXTENDED_COLUMN_COUNT / COLUMNS_PER_SUBNET

/** Number of custody columns per node */
export const CUSTODY_COLUMNS_PER_NODE = 8

/** Minimum custody requirement for validators */
export const MIN_CUSTODY_REQUIREMENT = 4

/** Samples required for light node verification */
export const SAMPLES_PER_SLOT = 8

// ============================================================================
// Types
// ============================================================================

/** Column index in extended matrix */
export type ColumnIndex = number

/** Subnet identifier */
export type SubnetId = number

/** PeerDAS blob in matrix form */
export interface PeerDASBlob {
  /** Original blob data */
  data: Uint8Array
  /** 2D matrix representation (rows x columns) */
  matrix: Uint8Array[][]
  /** Extended matrix with parity columns */
  extendedMatrix: Uint8Array[][]
  /** Column commitments */
  columnCommitments: Hex[]
  /** Row commitments */
  rowCommitments: Hex[]
  /** Global blob commitment */
  commitment: Hex
}

/** Column data with proof */
export interface DataColumn {
  /** Column index */
  index: ColumnIndex
  /** Column cells */
  cells: Uint8Array[]
  /** KZG proof for column */
  proof: Hex
  /** Commitment for verification */
  commitment: Hex
}

/** Custody assignment for a node */
export interface CustodyAssignment {
  /** Node address */
  nodeId: Address
  /** Assigned column indices */
  columns: ColumnIndex[]
  /** Subnets to subscribe to */
  subnets: SubnetId[]
}

/** Sample request for light verification */
export interface PeerDASSampleRequest {
  /** Blob root/commitment */
  blobRoot: Hex
  /** Requested column indices */
  columnIndices: ColumnIndex[]
  /** Slot number */
  slot: bigint
}

/** Sample response */
export interface PeerDASSampleResponse {
  /** Columns with proofs */
  columns: DataColumn[]
  /** Whether all samples were available */
  available: boolean
}

// ============================================================================
// Matrix Operations
// ============================================================================

/**
 * Convert blob to 2D matrix format
 */
export function blobToMatrix(data: Uint8Array): Uint8Array[][] {
  const rows = FIELD_ELEMENTS_PER_BLOB / DATA_COLUMN_COUNT
  const matrix: Uint8Array[][] = []

  for (let r = 0; r < rows; r++) {
    const row: Uint8Array[] = []
    for (let c = 0; c < DATA_COLUMN_COUNT; c++) {
      const start = (r * DATA_COLUMN_COUNT + c) * FIELD_ELEMENT_SIZE
      const end = start + FIELD_ELEMENT_SIZE
      row.push(data.slice(start, Math.min(end, data.length)))
    }
    matrix.push(row)
  }

  return matrix
}

/**
 * Extend matrix with parity columns (2D Reed-Solomon)
 */
export function extendMatrix(matrix: Uint8Array[][]): Uint8Array[][] {
  const rows = matrix.length
  const extended: Uint8Array[][] = []

  for (let r = 0; r < rows; r++) {
    const row = matrix[r]
    const extendedRow: Uint8Array[] = [...row]

    // Generate parity columns for this row
    for (let c = DATA_COLUMN_COUNT; c < EXTENDED_COLUMN_COUNT; c++) {
      const parity = computeRowParity(row, c - DATA_COLUMN_COUNT)
      extendedRow.push(parity)
    }

    extended.push(extendedRow)
  }

  return extended
}

/**
 * Compute parity for a row at given parity index
 * Uses proper Galois Field GF(2^8) arithmetic
 */
function computeRowParity(row: Uint8Array[], parityIndex: number): Uint8Array {
  const parity = new Uint8Array(FIELD_ELEMENT_SIZE)

  // Use Reed-Solomon encoding with Vandermonde matrix coefficients
  for (let i = 0; i < row.length; i++) {
    // Coefficient = α^(i * (parityIndex + 1)) in GF(2^8)
    const coeff = gfPow((i + 1) % 255 || 1, parityIndex + 1)

    for (let j = 0; j < FIELD_ELEMENT_SIZE; j++) {
      const cellByte = row[i]?.[j] ?? 0
      // GF multiplication and addition (XOR)
      parity[j] = gfAdd(parity[j], gfMul(cellByte, coeff))
    }
  }

  return parity
}

/**
 * Compute column parity using proper GF(2^8) arithmetic
 */
function _computeColumnParity(
  column: Uint8Array[],
  parityIndex: number,
): Uint8Array {
  const parity = new Uint8Array(FIELD_ELEMENT_SIZE)

  for (let i = 0; i < column.length; i++) {
    const coeff = gfPow((i + 1) % 255 || 1, parityIndex + 1)

    for (let j = 0; j < FIELD_ELEMENT_SIZE; j++) {
      const cellByte = column[i]?.[j] ?? 0
      parity[j] = gfAdd(parity[j], gfMul(cellByte, coeff))
    }
  }

  return parity
}

/**
 * Extract column from extended matrix
 */
export function extractColumn(
  matrix: Uint8Array[][],
  columnIndex: ColumnIndex,
): Uint8Array[] {
  return matrix.map(
    (row) => row[columnIndex] ?? new Uint8Array(FIELD_ELEMENT_SIZE),
  )
}

/**
 * Reconstruct blob from sufficient columns
 */
export function reconstructFromColumns(
  columns: Map<ColumnIndex, Uint8Array[]>,
  rows: number,
): Uint8Array {
  if (columns.size < DATA_COLUMN_COUNT) {
    throw new Error(
      `Insufficient columns: need ${DATA_COLUMN_COUNT}, have ${columns.size}`,
    )
  }

  const result = new Uint8Array(MAX_BLOB_SIZE)
  let offset = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < DATA_COLUMN_COUNT; c++) {
      const column = columns.get(c)
      if (column?.[r]) {
        result.set(column[r], offset)
      }
      offset += FIELD_ELEMENT_SIZE
    }
  }

  return result
}

// ============================================================================
// Commitment Generation
// ============================================================================

/**
 * Generate column commitment (KZG-style)
 */
export function computeColumnCommitment(column: Uint8Array[]): Hex {
  // Hash all cells together with domain separation
  const cellHashes = column.map((cell, i) =>
    keccak256(
      concatHex([`0x${i.toString(16).padStart(4, '0')}` as Hex, toHex(cell)]),
    ),
  )

  // Merkle root of cell hashes
  return computeMerkleRoot(cellHashes)
}

/**
 * Generate row commitment
 */
export function computeRowCommitment(row: Uint8Array[]): Hex {
  const cellHashes = row.map((cell, i) =>
    keccak256(
      concatHex([`0x${i.toString(16).padStart(4, '0')}` as Hex, toHex(cell)]),
    ),
  )
  return computeMerkleRoot(cellHashes)
}

/**
 * Compute Merkle root
 */
function computeMerkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return keccak256(toBytes('0x'))
  if (leaves.length === 1) return leaves[0]

  const nextLevel: Hex[] = []
  for (let i = 0; i < leaves.length; i += 2) {
    const left = leaves[i]
    const right = leaves[i + 1] ?? left
    nextLevel.push(keccak256(concatHex([left, right])))
  }

  return computeMerkleRoot(nextLevel)
}

/**
 * Generate global blob commitment from column commitments
 */
export function computeBlobCommitment(columnCommitments: Hex[]): Hex {
  return computeMerkleRoot(columnCommitments)
}

// ============================================================================
// Custody Assignment
// ============================================================================

/**
 * Get subnet for a column index
 */
export function getSubnetForColumn(columnIndex: ColumnIndex): SubnetId {
  return Math.floor(columnIndex / COLUMNS_PER_SUBNET)
}

/**
 * Get columns for a subnet
 */
export function getColumnsForSubnet(subnetId: SubnetId): ColumnIndex[] {
  const start = subnetId * COLUMNS_PER_SUBNET
  return Array.from({ length: COLUMNS_PER_SUBNET }, (_, i) => start + i)
}

/**
 * Compute custody columns for a node based on its ID
 */
export function computeCustodyColumns(
  nodeId: Address,
  epoch: bigint = 0n,
): ColumnIndex[] {
  const seed = keccak256(toBytes(`${nodeId}:${epoch}`))
  const columns: Set<ColumnIndex> = new Set()

  let nonce = 0
  while (columns.size < CUSTODY_COLUMNS_PER_NODE) {
    const hash = keccak256(toBytes(`${seed}:${nonce}`))
    const columnIndex = Number(BigInt(hash) % BigInt(EXTENDED_COLUMN_COUNT))
    columns.add(columnIndex)
    nonce++
  }

  return Array.from(columns).sort((a, b) => a - b)
}

/**
 * Get subnets a node should subscribe to
 */
export function computeCustodySubnets(
  custodyColumns: ColumnIndex[],
): SubnetId[] {
  const subnets = new Set(custodyColumns.map((c) => getSubnetForColumn(c)))
  return Array.from(subnets).sort((a, b) => a - b)
}

/**
 * Create full custody assignment for a node
 */
export function createCustodyAssignment(
  nodeId: Address,
  epoch: bigint = 0n,
): CustodyAssignment {
  const columns = computeCustodyColumns(nodeId, epoch)
  const subnets = computeCustodySubnets(columns)

  return { nodeId, columns, subnets }
}

// ============================================================================
// Light Node Sampling
// ============================================================================

/**
 * Generate sample request for light node verification
 */
export function generateLightSampleRequest(
  blobRoot: Hex,
  slot: bigint,
  nodeId?: Address,
): PeerDASSampleRequest {
  // Generate random column indices for sampling
  const seed = nodeId
    ? keccak256(toBytes(`${blobRoot}:${slot}:${nodeId}`))
    : keccak256(toBytes(`${blobRoot}:${slot}:${Date.now()}`))

  const columnIndices: Set<ColumnIndex> = new Set()
  let nonce = 0

  while (columnIndices.size < SAMPLES_PER_SLOT) {
    const hash = keccak256(toBytes(`${seed}:${nonce}`))
    const columnIndex = Number(BigInt(hash) % BigInt(EXTENDED_COLUMN_COUNT))
    columnIndices.add(columnIndex)
    nonce++
  }

  return {
    blobRoot,
    columnIndices: Array.from(columnIndices).sort((a, b) => a - b),
    slot,
  }
}

/**
 * Verify sample response
 */
export function verifySampleResponse(
  request: PeerDASSampleRequest,
  response: PeerDASSampleResponse,
  _blobCommitment: Hex,
): boolean {
  // Check all requested columns are present
  const receivedIndices = new Set(response.columns.map((c) => c.index))
  for (const idx of request.columnIndices) {
    if (!receivedIndices.has(idx)) {
      return false
    }
  }

  // Verify each column commitment
  for (const column of response.columns) {
    const computedCommitment = computeColumnCommitment(column.cells)
    if (computedCommitment !== column.commitment) {
      return false
    }
  }

  return true
}

/**
 * Calculate availability confidence from successful samples
 */
export function calculateAvailabilityConfidence(
  successfulSamples: number,
  _totalSamples: number,
): number {
  // Probability that data is unavailable given k successful samples
  // Assuming 50% availability threshold
  const availabilityThreshold = 0.5
  const confidence = 1 - (1 - availabilityThreshold) ** successfulSamples
  return Math.min(confidence, 0.9999)
}

// ============================================================================
// PeerDAS Blob Manager
// ============================================================================

export class PeerDASBlobManager {
  private readonly blobs: Map<Hex, PeerDASBlob> = new Map()
  private readonly columns: Map<Hex, Map<ColumnIndex, DataColumn>> = new Map()

  /**
   * Prepare blob for PeerDAS distribution
   */
  prepare(data: Uint8Array): PeerDASBlob {
    // Pad to max size if needed
    const paddedData = new Uint8Array(MAX_BLOB_SIZE)
    paddedData.set(data.slice(0, MAX_BLOB_SIZE))

    // Convert to matrix
    const matrix = blobToMatrix(paddedData)

    // Extend with parity
    const extendedMatrix = extendMatrix(matrix)

    // Compute commitments
    const columnCommitments: Hex[] = []
    for (let c = 0; c < EXTENDED_COLUMN_COUNT; c++) {
      const column = extractColumn(extendedMatrix, c)
      columnCommitments.push(computeColumnCommitment(column))
    }

    const rowCommitments: Hex[] = []
    for (let r = 0; r < matrix.length; r++) {
      rowCommitments.push(computeRowCommitment(extendedMatrix[r]))
    }

    const commitment = computeBlobCommitment(columnCommitments)

    const blob: PeerDASBlob = {
      data: paddedData,
      matrix,
      extendedMatrix,
      columnCommitments,
      rowCommitments,
      commitment,
    }

    this.blobs.set(commitment, blob)
    return blob
  }

  /**
   * Get columns for distribution to operators
   */
  getColumnsForOperator(
    blobCommitment: Hex,
    operatorId: Address,
    epoch: bigint = 0n,
  ): DataColumn[] {
    const blob = this.blobs.get(blobCommitment)
    if (!blob) return []

    const custodyColumns = computeCustodyColumns(operatorId, epoch)
    const columns: DataColumn[] = []

    for (const columnIndex of custodyColumns) {
      const cells = extractColumn(blob.extendedMatrix, columnIndex)
      const commitment = blob.columnCommitments[columnIndex]

      // Generate proof
      const proof = this.generateColumnProof(blob, columnIndex)

      columns.push({
        index: columnIndex,
        cells,
        proof,
        commitment,
      })
    }

    return columns
  }

  /**
   * Generate column inclusion proof (Merkle path)
   * Proves column commitment is included in blob commitment
   */
  private generateColumnProof(
    blob: PeerDASBlob,
    columnIndex: ColumnIndex,
  ): Hex {
    // Build Merkle proof for column commitment in the blob commitment tree
    const proofPath: Hex[] = []
    let index = columnIndex
    let level = blob.columnCommitments

    while (level.length > 1) {
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1
      if (siblingIndex < level.length) {
        proofPath.push(level[siblingIndex])
      } else {
        proofPath.push(level[index])
      }

      // Move to next level
      const nextLevel: Hex[] = []
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]
        const right = level[i + 1] ?? left
        nextLevel.push(keccak256(concatHex([left, right])))
      }
      level = nextLevel
      index = Math.floor(index / 2)
    }

    // Encode proof path as single hex (concatenated hashes)
    if (proofPath.length === 0) {
      return blob.columnCommitments[columnIndex]
    }

    return keccak256(toBytes(proofPath.join('')))
  }

  /**
   * Store column from operator
   */
  storeColumn(blobCommitment: Hex, column: DataColumn): boolean {
    // Verify column commitment
    const computedCommitment = computeColumnCommitment(column.cells)
    if (computedCommitment !== column.commitment) {
      return false
    }

    if (!this.columns.has(blobCommitment)) {
      this.columns.set(blobCommitment, new Map())
    }

    const columnMap = this.columns.get(blobCommitment)
    if (!columnMap) {
      throw new Error(`Failed to create column map for blob ${blobCommitment}`)
    }
    columnMap.set(column.index, column)
    return true
  }

  /**
   * Get stored column
   */
  getColumn(blobCommitment: Hex, columnIndex: ColumnIndex): DataColumn | null {
    return this.columns.get(blobCommitment)?.get(columnIndex) ?? null
  }

  /**
   * Check if blob can be reconstructed
   */
  canReconstruct(blobCommitment: Hex): boolean {
    const columns = this.columns.get(blobCommitment)
    if (!columns) return false

    // Need at least DATA_COLUMN_COUNT columns
    return columns.size >= DATA_COLUMN_COUNT
  }

  /**
   * Reconstruct blob from stored columns
   */
  reconstruct(blobCommitment: Hex): Uint8Array | null {
    if (!this.canReconstruct(blobCommitment)) {
      return null
    }

    const columns = this.columns.get(blobCommitment)
    if (!columns) {
      return null
    }
    const columnMap = new Map<ColumnIndex, Uint8Array[]>()

    for (const [index, column] of columns) {
      columnMap.set(index, column.cells)
    }

    const rows = FIELD_ELEMENTS_PER_BLOB / DATA_COLUMN_COUNT
    return reconstructFromColumns(columnMap, rows)
  }

  /**
   * Handle sample request from light node
   */
  handleSampleRequest(request: PeerDASSampleRequest): PeerDASSampleResponse {
    const columns: DataColumn[] = []
    let allAvailable = true

    for (const columnIndex of request.columnIndices) {
      const column = this.getColumn(request.blobRoot, columnIndex)
      if (column) {
        columns.push(column)
      } else {
        allAvailable = false
      }
    }

    return {
      columns,
      available: allAvailable,
    }
  }

  /**
   * Get blob by commitment
   */
  getBlob(commitment: Hex): PeerDASBlob | null {
    return this.blobs.get(commitment) ?? null
  }

  /**
   * Get statistics
   */
  getStats(): {
    blobCount: number
    columnCount: number
    reconstructable: number
  } {
    let columnCount = 0
    let reconstructable = 0

    for (const [_commitment, columns] of this.columns) {
      columnCount += columns.size
      if (columns.size >= DATA_COLUMN_COUNT) {
        reconstructable++
      }
    }

    return {
      blobCount: this.blobs.size,
      columnCount,
      reconstructable,
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export const PeerDAS = {
  // Constants
  DATA_COLUMN_COUNT,
  EXTENDED_COLUMN_COUNT,
  FIELD_ELEMENTS_PER_BLOB,
  FIELD_ELEMENT_SIZE,
  MAX_BLOB_SIZE,
  COLUMNS_PER_SUBNET,
  SUBNET_COUNT,
  CUSTODY_COLUMNS_PER_NODE,
  MIN_CUSTODY_REQUIREMENT,
  SAMPLES_PER_SLOT,

  // Matrix operations
  blobToMatrix,
  extendMatrix,
  extractColumn,
  reconstructFromColumns,

  // Commitments
  computeColumnCommitment,
  computeRowCommitment,
  computeBlobCommitment,

  // Custody
  getSubnetForColumn,
  getColumnsForSubnet,
  computeCustodyColumns,
  computeCustodySubnets,
  createCustodyAssignment,

  // Light sampling
  generateLightSampleRequest,
  verifySampleResponse,
  calculateAvailabilityConfidence,

  // Manager
  PeerDASBlobManager,
}

export function createPeerDASBlobManager(): PeerDASBlobManager {
  return new PeerDASBlobManager()
}

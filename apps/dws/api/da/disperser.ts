/**
 * Blob Disperser
 *
 * Coordinates blob dispersal to DA operators:
 * - Encode and commit to blobs
 * - Assign chunks to operators
 * - Collect attestations
 * - Verify quorum
 */

import { HexSchema } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { z } from 'zod'

const OperatorAttestationResponseSchema = z.object({ signature: HexSchema })

import { BlobManager } from './blob'
import { DASampler } from './sampling'
import type {
  AvailabilityAttestation,
  BlobCommitment,
  BlobSubmissionRequest,
  Chunk,
  ChunkAssignment,
  DAOperatorInfo,
  OperatorSignature,
} from './types'

// Dispersal Configuration

export interface DispersalConfig {
  /** Minimum quorum percentage */
  minQuorumPercent: number
  /** Maximum time to wait for attestations (ms) */
  attestationTimeoutMs: number
  /** Retry attempts per operator */
  retryAttempts: number
  /** Chunk replication factor */
  replicationFactor: number
}

const DEFAULT_DISPERSAL_CONFIG: DispersalConfig = {
  minQuorumPercent: 67,
  attestationTimeoutMs: 30000,
  retryAttempts: 3,
  replicationFactor: 2,
}

// Dispersal Result

export interface DispersalResult {
  success: boolean
  blobId: Hex
  commitment: BlobCommitment
  attestation: AvailabilityAttestation | null
  assignments: ChunkAssignment[]
  operatorCount: number
  quorumReached: boolean
  error?: string
}

// Disperser

export class Disperser {
  private readonly config: DispersalConfig
  private readonly blobManager: BlobManager
  private readonly sampler: DASampler
  private readonly operators: Map<Address, DAOperatorInfo> = new Map()
  private readonly pendingDispersals: Map<Hex, DispersalState> = new Map()

  constructor(
    config?: Partial<DispersalConfig>,
    blobManager?: BlobManager,
    sampler?: DASampler,
  ) {
    this.config = { ...DEFAULT_DISPERSAL_CONFIG, ...config }
    this.blobManager = blobManager ?? new BlobManager()
    this.sampler = sampler ?? new DASampler({})
  }

  /**
   * Register DA operator
   */
  registerOperator(operator: DAOperatorInfo): void {
    this.operators.set(operator.address, operator)
    this.sampler.updateOperators(Array.from(this.operators.values()))
  }

  /**
   * Remove DA operator
   */
  removeOperator(address: Address): void {
    this.operators.delete(address)
    this.sampler.updateOperators(Array.from(this.operators.values()))
  }

  /**
   * Get active operators
   */
  getActiveOperators(): DAOperatorInfo[] {
    return Array.from(this.operators.values()).filter(
      (o) => o.status === 'active',
    )
  }

  /**
   * Disperse a blob to operators
   */
  async disperse(request: BlobSubmissionRequest): Promise<DispersalResult> {
    // Prepare blob
    const { blob, chunks, commitment } = this.blobManager.submit(request)

    // Update status
    this.blobManager.updateStatus(blob.id, 'dispersing')

    // Get active operators
    const operators = this.getActiveOperators()
    if (operators.length === 0) {
      return {
        success: false,
        blobId: blob.id,
        commitment,
        attestation: null,
        assignments: [],
        operatorCount: 0,
        quorumReached: false,
        error: 'No active operators',
      }
    }

    // Assign chunks to operators
    const assignments = this.assignChunks(chunks, operators)
    this.blobManager.setAssignments(
      blob.id,
      new Map(assignments.map((a) => [a.chunkIndex, a.operators])),
    )

    // Initialize dispersal state
    const state: DispersalState = {
      blobId: blob.id,
      commitment,
      assignments,
      signatures: [],
      startTime: Date.now(),
    }
    this.pendingDispersals.set(blob.id, state)

    // Send chunks to operators
    const sendResults = await this.sendChunksToOperators(chunks, assignments)

    // Collect attestations
    const attestation = await this.collectAttestations(state, operators)

    // Update sampler with assignments
    this.sampler.updateAssignments(
      new Map(assignments.map((a) => [a.chunkIndex, a.operators])),
    )

    // Determine success
    const quorumReached = attestation.quorumReached
    const success =
      quorumReached && sendResults.successCount >= chunks.length * 0.5

    if (success) {
      this.blobManager.updateStatus(blob.id, 'available')
    } else {
      this.blobManager.updateStatus(blob.id, 'unavailable')
    }

    // Cleanup
    this.pendingDispersals.delete(blob.id)

    return {
      success,
      blobId: blob.id,
      commitment,
      attestation: quorumReached ? attestation : null,
      assignments,
      operatorCount: operators.length,
      quorumReached,
      error: success ? undefined : 'Quorum not reached',
    }
  }

  /**
   * Assign chunks to operators using consistent hashing
   */
  private assignChunks(
    chunks: Chunk[],
    operators: DAOperatorInfo[],
  ): ChunkAssignment[] {
    const assignments: ChunkAssignment[] = []

    for (const chunk of chunks) {
      const assignedOperators: Address[] = []

      // Use consistent hashing for deterministic assignment
      for (let r = 0; r < this.config.replicationFactor; r++) {
        const hash = keccak256(toBytes(`${chunk.blobId}:${chunk.index}:${r}`))
        const operatorIndex = Number(BigInt(hash) % BigInt(operators.length))
        const operator = operators[operatorIndex]

        if (!assignedOperators.includes(operator.address)) {
          assignedOperators.push(operator.address)
        }
      }

      assignments.push({
        chunkIndex: chunk.index,
        operators: assignedOperators,
      })
    }

    return assignments
  }

  /**
   * Send chunks to assigned operators
   */
  private async sendChunksToOperators(
    chunks: Chunk[],
    assignments: ChunkAssignment[],
  ): Promise<{ successCount: number; failedChunks: number[] }> {
    const chunkByIndex = new Map(chunks.map((c) => [c.index, c]))
    const failedChunks: number[] = []
    let successCount = 0

    const sendPromises: Promise<void>[] = []

    for (const assignment of assignments) {
      const chunk = chunkByIndex.get(assignment.chunkIndex)
      if (!chunk) continue

      for (const operatorAddr of assignment.operators) {
        const operator = this.operators.get(operatorAddr)
        if (!operator) continue

        sendPromises.push(
          this.sendChunk(operator, chunk).then(() => {
            successCount++
          }),
        )
      }
    }

    await Promise.all(sendPromises)

    return { successCount, failedChunks }
  }

  /**
   * Send single chunk to operator
   */
  private async sendChunk(
    operator: DAOperatorInfo,
    chunk: Chunk,
  ): Promise<void> {
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      const response = await fetch(`${operator.endpoint}/da/chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobId: chunk.blobId,
          index: chunk.index,
          data: toHex(chunk.data),
          proof: chunk.proof,
        }),
      })

      if (response.ok) {
        return
      }

      // Wait before retry
      if (attempt < this.config.retryAttempts - 1) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)))
      }
    }

    throw new Error(
      `Failed to send chunk ${chunk.index} to ${operator.address}`,
    )
  }

  /**
   * Collect attestations from operators
   */
  private async collectAttestations(
    state: DispersalState,
    operators: DAOperatorInfo[],
  ): Promise<AvailabilityAttestation> {
    const signatures: OperatorSignature[] = []
    const requiredSignatures = Math.ceil(
      (operators.length * this.config.minQuorumPercent) / 100,
    )

    // Request attestations from all operators
    const attestPromises = operators.map(async (operator) => {
      const sig = await this.requestAttestation(operator, state)
      if (sig) {
        signatures.push(sig)
      }
    })

    // Wait with timeout
    await Promise.race([
      Promise.all(attestPromises),
      new Promise((resolve) =>
        setTimeout(resolve, this.config.attestationTimeoutMs),
      ),
    ])

    const quorumReached = signatures.length >= requiredSignatures

    return {
      blobId: state.blobId,
      commitment: state.commitment.commitment,
      signatures,
      quorumReached,
      timestamp: Date.now(),
    }
  }

  /**
   * Request attestation from single operator
   */
  private async requestAttestation(
    operator: DAOperatorInfo,
    state: DispersalState,
  ): Promise<OperatorSignature | null> {
    // Find chunks assigned to this operator
    const assignedIndices = state.assignments
      .filter((a) => a.operators.includes(operator.address))
      .map((a) => a.chunkIndex)

    const response = await fetch(`${operator.endpoint}/da/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blobId: state.blobId,
        commitment: state.commitment.commitment,
        chunkIndices: assignedIndices,
      }),
    })

    if (!response.ok) {
      return null
    }

    const result = OperatorAttestationResponseSchema.parse(
      await response.json(),
    )

    return {
      operator: operator.address,
      signature: result.signature,
      chunkIndices: assignedIndices,
    }
  }

  /**
   * Get dispersal status
   */
  getDispersalStatus(blobId: Hex): DispersalState | null {
    return this.pendingDispersals.get(blobId) ?? null
  }

  /**
   * Get blob manager
   */
  getBlobManager(): BlobManager {
    return this.blobManager
  }

  /**
   * Get sampler
   */
  getSampler(): DASampler {
    return this.sampler
  }
}

// Internal Types

interface DispersalState {
  blobId: Hex
  commitment: BlobCommitment
  assignments: ChunkAssignment[]
  signatures: OperatorSignature[]
  startTime: number
}

// Factory

export function createDisperser(config?: Partial<DispersalConfig>): Disperser {
  return new Disperser(config)
}

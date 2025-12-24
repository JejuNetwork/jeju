/**
 * Data Availability Sampling (DAS)
 *
 * Implements lightweight verification through random sampling:
 * - Sample random chunks from DA operators
 * - Verify proofs without downloading full blob
 * - Statistical guarantee of availability
 * - Compatible with PeerDAS sampling patterns
 */

import type { Address, Hex } from 'viem'
import { bytesToHex, keccak256, toBytes } from 'viem'
import { verifyProof } from './commitment'
import type {
  BlobCommitment,
  Chunk,
  DAOperatorInfo,
  SampleRequest,
  SampleResponse,
  SampleVerificationResult,
  SamplingConfig,
} from './types'

// Default Configuration

export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  sampleCount: 16,
  targetConfidence: 0.9999, // 99.99% confidence
  timeoutMs: 5000,
  retries: 2,
}

// Sampling Strategy

/**
 * Calculate required samples for target confidence
 * Based on: probability that data is unavailable given k successful samples
 * P(unavailable | k samples) = (1 - f)^k where f is fraction available
 *
 * With 50% availability requirement and 16 samples:
 * P(undetected unavailability) = 0.5^16 ≈ 0.000015
 */
export function calculateRequiredSamples(
  targetConfidence: number,
  availabilityThreshold = 0.5,
): number {
  // k = log(1 - confidence) / log(1 - threshold)
  const k = Math.log(1 - targetConfidence) / Math.log(1 - availabilityThreshold)
  return Math.ceil(k)
}

/**
 * Generate random sample indices for a blob
 */
export function generateSampleIndices(
  totalChunks: number,
  sampleCount: number,
  seed?: Hex,
): number[] {
  const indices = new Set<number>()
  const seedBytes = seed
    ? toBytes(seed)
    : crypto.getRandomValues(new Uint8Array(32))

  let nonce = 0
  while (indices.size < sampleCount && indices.size < totalChunks) {
    // Deterministic random from seed + nonce
    const hash = keccak256(toBytes(`${bytesToHex(seedBytes)}:${nonce}`))
    const value = BigInt(hash) % BigInt(totalChunks)
    indices.add(Number(value))
    nonce++
  }

  return Array.from(indices).sort((a, b) => a - b)
}

/**
 * Map chunk indices to responsible operators
 */
export function mapIndicesToOperators(
  indices: number[],
  operators: DAOperatorInfo[],
  chunkAssignments: Map<number, Address[]>,
): Map<Address, number[]> {
  const operatorIndices = new Map<Address, number[]>()

  for (const index of indices) {
    const assignedOperators = chunkAssignments.get(index) ?? []

    // Pick first available operator for each chunk
    for (const operatorAddr of assignedOperators) {
      const operator = operators.find((o) => o.address === operatorAddr)
      if (operator && operator.status === 'active') {
        if (!operatorIndices.has(operatorAddr)) {
          operatorIndices.set(operatorAddr, [])
        }
        const indices = operatorIndices.get(operatorAddr)
        if (indices) {
          indices.push(index)
        }
        break
      }
    }
  }

  return operatorIndices
}

// Sample Request/Response

/**
 * Create sampling request
 */
export function createSampleRequest(
  blobId: Hex,
  chunkIndices: number[],
  requester: Address,
): SampleRequest {
  const nonce = keccak256(
    toBytes(`${blobId}:${requester}:${Date.now()}:${Math.random()}`),
  )

  return {
    blobId,
    chunkIndices,
    requester,
    nonce,
    timestamp: Date.now(),
  }
}

/**
 * Validate sample response
 */
export function validateSampleResponse(
  response: SampleResponse,
  request: SampleRequest,
  commitment: BlobCommitment,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check request match
  if (response.request.blobId !== request.blobId) {
    errors.push('Blob ID mismatch')
  }

  if (response.request.nonce !== request.nonce) {
    errors.push('Nonce mismatch')
  }

  // Check all requested chunks are returned
  const returnedIndices = new Set(response.chunks.map((c) => c.index))
  for (const idx of request.chunkIndices) {
    if (!returnedIndices.has(idx)) {
      errors.push(`Missing chunk ${idx}`)
    }
  }

  // Verify chunk proofs
  for (const chunk of response.chunks) {
    if (!verifyProof(chunk, commitment)) {
      errors.push(`Invalid proof for chunk ${chunk.index}`)
    }
  }

  // Check timestamp freshness
  const maxAge = 30000 // 30 seconds
  if (Date.now() - response.timestamp > maxAge) {
    errors.push('Response too old')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// DA Sampler

export interface DASamplerConfig extends SamplingConfig {
  operators: DAOperatorInfo[]
  chunkAssignments: Map<number, Address[]>
}

export class DASampler {
  private readonly config: SamplingConfig
  private readonly operators: DAOperatorInfo[]
  private readonly chunkAssignments: Map<number, Address[]>
  private readonly responseCache: Map<string, SampleResponse[]> = new Map()

  constructor(config: Partial<DASamplerConfig>) {
    this.config = { ...DEFAULT_SAMPLING_CONFIG, ...config }
    this.operators = config.operators ?? []
    this.chunkAssignments = config.chunkAssignments ?? new Map()
  }

  /**
   * Sample a blob to verify availability
   */
  async sample(
    blobId: Hex,
    commitment: BlobCommitment,
    requester: Address,
  ): Promise<SampleVerificationResult> {
    const totalChunks = commitment.totalChunkCount
    const sampleCount = Math.min(this.config.sampleCount, totalChunks)

    // Generate random indices
    const seed = keccak256(toBytes(`${blobId}:${requester}:${Date.now()}`))
    const indices = generateSampleIndices(totalChunks, sampleCount, seed)

    // Map indices to operators
    const operatorIndices = mapIndicesToOperators(
      indices,
      this.operators,
      this.chunkAssignments,
    )

    // Fetch samples from operators
    const responses = await this.fetchSamples(
      blobId,
      operatorIndices,
      requester,
    )

    // Verify samples
    return this.verifySamples(blobId, responses, commitment, indices)
  }

  /**
   * Fetch samples from multiple operators in parallel
   */
  private async fetchSamples(
    blobId: Hex,
    operatorIndices: Map<Address, number[]>,
    requester: Address,
  ): Promise<SampleResponse[]> {
    const requests: Array<Promise<SampleResponse | null>> = []

    for (const [operatorAddr, indices] of operatorIndices) {
      const operator = this.operators.find((o) => o.address === operatorAddr)
      if (!operator) continue

      const request = createSampleRequest(blobId, indices, requester)
      requests.push(this.fetchFromOperator(operator, request))
    }

    const results = await Promise.all(requests)
    return results.filter((r): r is SampleResponse => r !== null)
  }

  /**
   * Fetch samples from a single operator
   */
  private async fetchFromOperator(
    operator: DAOperatorInfo,
    request: SampleRequest,
  ): Promise<SampleResponse | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      const response = await fetch(`${operator.endpoint}/da/sample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.ok) {
        return response.json() as Promise<SampleResponse>
      }

      // Wait before retry
      if (attempt < this.config.retries) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)))
      }
    }

    return null
  }

  /**
   * Verify collected samples
   */
  private verifySamples(
    _blobId: Hex,
    responses: SampleResponse[],
    commitment: BlobCommitment,
    requestedIndices: number[],
  ): SampleVerificationResult {
    let samplesVerified = 0
    let samplesFailed = 0
    const verifiedIndices = new Set<number>()

    for (const response of responses) {
      for (const chunk of response.chunks) {
        if (verifyProof(chunk, commitment)) {
          verifiedIndices.add(chunk.index)
          samplesVerified++
        } else {
          samplesFailed++
        }
      }
    }

    // Calculate confidence based on verified samples
    const totalRequested = requestedIndices.length
    const successRate = samplesVerified / totalRequested

    // Confidence = 1 - (1 - availabilityThreshold)^samplesVerified
    const availabilityThreshold = 0.5
    const confidence = 1 - (1 - availabilityThreshold) ** samplesVerified

    const success =
      successRate >= 0.8 && // At least 80% of samples verified
      confidence >= this.config.targetConfidence

    return {
      success,
      samplesVerified,
      samplesFailed,
      confidence,
      error: success
        ? undefined
        : `Insufficient samples: ${samplesVerified}/${totalRequested} (${(successRate * 100).toFixed(1)}%)`,
    }
  }

  /**
   * Update operator list
   */
  updateOperators(operators: DAOperatorInfo[]): void {
    this.operators.length = 0
    this.operators.push(...operators)
  }

  /**
   * Update chunk assignments
   */
  updateAssignments(assignments: Map<number, Address[]>): void {
    this.chunkAssignments.clear()
    for (const [k, v] of assignments) {
      this.chunkAssignments.set(k, v)
    }
  }

  /**
   * Clear response cache
   */
  clearCache(): void {
    this.responseCache.clear()
  }
}

// Sample Verifier (for operators)

export class SampleVerifier {
  private readonly chunks: Map<string, Map<number, Chunk>> = new Map()

  /**
   * Store chunk for later verification
   */
  storeChunk(blobId: Hex, chunk: Chunk): void {
    if (!this.chunks.has(blobId)) {
      this.chunks.set(blobId, new Map())
    }
    const chunkMap = this.chunks.get(blobId)
    if (chunkMap) {
      chunkMap.set(chunk.index, chunk)
    }
  }

  /**
   * Handle sample request
   */
  handleRequest(request: SampleRequest, signature: Hex): SampleResponse {
    const blobChunks = this.chunks.get(request.blobId)
    const chunks: Chunk[] = []

    if (blobChunks) {
      for (const index of request.chunkIndices) {
        const chunk = blobChunks.get(index)
        if (chunk) {
          chunks.push(chunk)
        }
      }
    }

    return {
      request,
      chunks,
      signature,
      timestamp: Date.now(),
    }
  }

  /**
   * Check if blob is stored
   */
  hasBlob(blobId: Hex): boolean {
    return this.chunks.has(blobId)
  }

  /**
   * Get chunk count for blob
   */
  getChunkCount(blobId: Hex): number {
    return this.chunks.get(blobId)?.size ?? 0
  }

  /**
   * Remove blob data
   */
  removeBlob(blobId: Hex): void {
    this.chunks.delete(blobId)
  }

  /**
   * Get storage stats
   */
  getStats(): { blobCount: number; totalChunks: number } {
    let totalChunks = 0
    for (const blobChunks of this.chunks.values()) {
      totalChunks += blobChunks.size
    }
    return {
      blobCount: this.chunks.size,
      totalChunks,
    }
  }
}

// PeerDAS-Compatible Sampling

/**
 * PeerDAS-style sampling pattern
 * Distributes samples across custody groups
 */
export function generatePeerDASSamples(
  totalChunks: number,
  custodyGroups: number,
  samplesPerGroup: number,
  seed: Hex,
): number[][] {
  const groupSize = Math.ceil(totalChunks / custodyGroups)
  const samples: number[][] = []

  for (let group = 0; group < custodyGroups; group++) {
    const groupStart = group * groupSize
    const groupEnd = Math.min(groupStart + groupSize, totalChunks)
    const groupChunks = groupEnd - groupStart

    // Generate samples for this group
    const groupSeed = keccak256(toBytes(`${seed}:${group}`))
    const indices = generateSampleIndices(
      groupChunks,
      samplesPerGroup,
      groupSeed,
    )

    // Offset to global indices
    samples.push(indices.map((i) => i + groupStart))
  }

  return samples
}

/**
 * Verify PeerDAS-style sampling result
 */
export function verifyPeerDASSampling(
  samples: number[][],
  verifiedSamples: Set<number>,
  minGroupSuccess: number = 0.5,
): { success: boolean; groupResults: boolean[] } {
  const groupResults = samples.map((groupSamples) => {
    const verified = groupSamples.filter((i) => verifiedSamples.has(i)).length
    return verified / groupSamples.length >= minGroupSuccess
  })

  // Require all groups to pass
  const success = groupResults.every((r) => r)

  return { success, groupResults }
}

// Factory

export type { SamplingConfig }

export function createDASampler(config?: Partial<DASamplerConfig>): DASampler {
  return new DASampler(config ?? {})
}

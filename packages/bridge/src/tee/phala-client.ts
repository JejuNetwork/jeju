/**
 * Phala TEE Client
 *
 * Real implementation using Phala Network's TEE infrastructure.
 * Phala uses Intel TDX/SGX for secure enclaves with remote attestation.
 *
 * Features:
 * - Remote attestation via Phala's attestation service
 * - Secure key generation inside enclave
 * - Signed batch attestations for ZK proofs
 */

import type { Hex } from 'viem'
import { bytesToHex, keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type {
  CrossChainTransfer,
  Hash32,
  TEEAttestation,
} from '../types/index.js'
import { toHash32 } from '../types/index.js'
import {
  computeMerkleRoot,
  createLogger,
  PhalaAttestationResponseSchema,
} from '../utils/index.js'

const log = createLogger('phala')

// =============================================================================
// TYPES
// =============================================================================

export interface PhalaConfig {
  /** Phala TEE endpoint URL */
  endpoint: string
  /** API key for Phala (optional if using wallet auth) */
  apiKey?: string
  /** Timeout for attestation requests in ms */
  timeoutMs?: number
  /** Use mock attestation for local development */
  useMock?: boolean
}

export interface PhalaAttestationRequest {
  /** Data to attest (batch hash, transfer IDs, etc.) */
  data: Hex
  /** Operator's ethereum address */
  operatorAddress: Hex
  /** Optional nonce for replay protection */
  nonce?: bigint
}

export interface PhalaAttestationResponse {
  /** The attestation quote from Phala's TEE */
  quote: Uint8Array
  /** Measurement hash of the enclave code */
  mrEnclave: Hex
  /** Report data containing the attested data hash */
  reportData: Hex
  /** Signature from the TEE */
  signature: Hex
  /** Timestamp when attestation was generated */
  timestamp: number
  /** Enclave ID for verification */
  enclaveId: string
}

export interface PhalaBatchAttestation {
  /** Unique batch identifier */
  batchId: Hash32
  /** Merkle root of all transfer IDs in batch */
  transfersRoot: Hash32
  /** Number of transfers in batch */
  transferCount: number
  /** TEE attestation */
  attestation: PhalaAttestationResponse
  /** Chain of custody proof */
  chainOfCustody: Hex[]
}

// =============================================================================
// PHALA CLIENT
// =============================================================================

export class PhalaClient {
  private config: PhalaConfig
  private initialized: boolean = false
  private enclavePublicKey: Uint8Array | null = null

  constructor(config: PhalaConfig) {
    this.config = {
      timeoutMs: 30000,
      useMock: false,
      ...config,
    }
  }

  /**
   * Initialize the Phala TEE connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (this.config.useMock) {
      log.info('Initialized in mock mode')
      this.enclavePublicKey = new Uint8Array(33)
      crypto.getRandomValues(this.enclavePublicKey)
      this.enclavePublicKey[0] = 0x02
      this.initialized = true
      return
    }

    // Verify Phala endpoint is reachable
    const timeout = this.config.timeoutMs ?? 30000
    const response = await fetch(`${this.config.endpoint}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      throw new Error(`Phala endpoint returned ${response.status}`)
    }

    const HealthResponseSchema = z.object({
      enclave_id: z.string(),
      public_key: z.string().optional(),
    })

    const healthData = HealthResponseSchema.parse(await response.json())
    log.info('Connected to TEE enclave', { enclaveId: healthData.enclave_id })

    if (healthData.public_key) {
      this.enclavePublicKey = Buffer.from(healthData.public_key, 'hex')
    }

    this.initialized = true
  }

  /**
   * Request attestation for arbitrary data
   */
  async requestAttestation(
    request: PhalaAttestationRequest,
  ): Promise<PhalaAttestationResponse> {
    if (!this.initialized) {
      await this.initialize()
    }

    if (this.config.useMock) {
      return this.generateMockAttestation(request)
    }

    // Use provided nonce or generate from timestamp
    const nonce = request.nonce?.toString() ?? Date.now().toString()
    const payload = {
      data: request.data,
      operator_address: request.operatorAddress,
      nonce,
    }

    const timeout = this.config.timeoutMs ?? 30000
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey
    }

    const response = await fetch(`${this.config.endpoint}/attestation`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Phala attestation failed: ${response.status} - ${errorText}`,
      )
    }

    const rawData: unknown = await response.json()
    const attestationData = PhalaAttestationResponseSchema.parse(rawData)

    return {
      quote: Buffer.from(attestationData.quote, 'hex'),
      mrEnclave: attestationData.mr_enclave as Hex,
      reportData: attestationData.report_data as Hex,
      signature: attestationData.signature as Hex,
      timestamp: attestationData.timestamp,
      enclaveId: attestationData.enclave_id,
    }
  }

  /**
   * Create an attestation for a batch of transfers
   */
  async attestBatch(
    batchId: Hash32,
    transfers: CrossChainTransfer[],
    operatorAddress: Hex,
  ): Promise<PhalaBatchAttestation> {
    // Compute merkle root of transfer IDs
    const transferIds = transfers.map((t) => t.transferId)
    const transfersRoot = computeMerkleRoot(transferIds, (data) => {
      const hash = keccak256(data)
      return Buffer.from(hash.slice(2), 'hex')
    })

    // Build data to attest
    const attestData = keccak256(
      new Uint8Array([
        ...batchId,
        ...transfersRoot,
        ...toBytes(BigInt(transfers.length)),
      ]),
    )

    // Request attestation from Phala TEE
    const attestation = await this.requestAttestation({
      data: attestData,
      operatorAddress,
      nonce: BigInt(Date.now()),
    })

    // Build chain of custody
    const chainOfCustody = transferIds.map((id) => bytesToHex(id) as Hex)

    return {
      batchId,
      transfersRoot,
      transferCount: transfers.length,
      attestation,
      chainOfCustody,
    }
  }

  /**
   * Verify an attestation is valid
   */
  async verifyAttestation(attestation: PhalaAttestationResponse): Promise<{
    valid: boolean
    errors: string[]
  }> {
    const errors: string[] = []

    // Check timestamp freshness (max 1 hour)
    const maxAge = 60 * 60 * 1000
    if (Date.now() - attestation.timestamp > maxAge) {
      errors.push('Attestation is stale (> 1 hour old)')
    }

    // Check quote length
    if (attestation.quote.length < 256) {
      errors.push('Attestation quote is too short')
    }

    if (this.config.useMock) {
      return { valid: errors.length === 0, errors }
    }

    // For production, verify against Phala's verification service
    const timeout = this.config.timeoutMs ?? 30000
    const response = await fetch(`${this.config.endpoint}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quote: Buffer.from(attestation.quote).toString('hex'),
        mr_enclave: attestation.mrEnclave,
        report_data: attestation.reportData,
        signature: attestation.signature,
      }),
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      errors.push(`Verification service returned ${response.status}`)
    } else {
      const VerifyResponseSchema = z.object({
        valid: z.boolean(),
        error: z.string().optional(),
      })
      const result = VerifyResponseSchema.parse(await response.json())
      if (!result.valid) {
        const errorMsg = result.error ?? 'Attestation verification failed'
        errors.push(errorMsg)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Convert attestation to format used by batcher
   */
  toTEEAttestation(attestation: PhalaAttestationResponse): TEEAttestation {
    if (!this.enclavePublicKey) {
      throw new Error(
        'Enclave public key not initialized - call initialize() first',
      )
    }
    return {
      measurement: toHash32(
        attestation.mrEnclave.startsWith('0x')
          ? Buffer.from(attestation.mrEnclave.slice(2), 'hex')
          : Buffer.from(attestation.mrEnclave, 'hex'),
      ),
      quote: attestation.quote,
      publicKey: this.enclavePublicKey,
      timestamp: BigInt(attestation.timestamp),
    }
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private generateMockAttestation(
    request: PhalaAttestationRequest,
  ): PhalaAttestationResponse {
    const timestamp = Date.now()

    // Generate mock measurement
    const mrEnclave = keccak256(
      new Uint8Array([...toBytes(request.data), ...toBytes(BigInt(timestamp))]),
    )

    // Generate mock quote
    const quote = new Uint8Array(256)
    crypto.getRandomValues(quote)

    // Generate mock signature
    const signature = keccak256(
      new Uint8Array([
        ...Buffer.from(mrEnclave.slice(2), 'hex'),
        ...Buffer.from(request.operatorAddress.slice(2), 'hex'),
        ...toBytes(BigInt(timestamp)),
      ]),
    )

    return {
      quote,
      mrEnclave,
      reportData: request.data,
      signature,
      timestamp,
      enclaveId: `mock-enclave-${timestamp.toString(36)}`,
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createPhalaClient(config?: Partial<PhalaConfig>): PhalaClient {
  const endpoint = config?.endpoint ?? process.env.PHALA_ENDPOINT
  const useMock = !endpoint || (config?.useMock ?? false)

  if (!endpoint) {
    log.warn('PHALA_ENDPOINT not set, using mock mode')
  }

  return new PhalaClient({
    endpoint: endpoint ?? 'http://localhost:8000', // Default for mock mode only
    apiKey: config?.apiKey ?? process.env.PHALA_API_KEY,
    useMock,
    timeoutMs: config?.timeoutMs ?? 30000,
  })
}

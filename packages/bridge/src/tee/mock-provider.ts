/**
 * Mock TEE Provider
 *
 * Local development mock for TEE attestation.
 * Generates deterministic mock attestations for testing.
 */

import { keccak256, toBytes } from 'viem'
import type { TEEAttestation } from '../types/index.js'
import { toHash32 } from '../types/index.js'
import { createLogger } from '../utils/logger.js'
import type {
  AttestationRequest,
  AttestationResponse,
  AttestationVerification,
  ITEEProvider,
  TEECapability,
  TEEProvider,
} from './types.js'

const log = createLogger('mock-tee')

export class MockTEEProvider implements ITEEProvider {
  readonly provider: TEEProvider = 'mock'
  readonly capabilities: TEECapability[] = ['attestation', 'key_gen']

  private initialized = false
  private enclaveId: string
  private publicKey: Uint8Array
  private lastAttestationTime?: number

  constructor() {
    this.enclaveId = `mock-enclave-${Date.now().toString(36)}`
    this.publicKey = new Uint8Array(33)
    crypto.getRandomValues(this.publicKey)
    this.publicKey[0] = 0x02 // Compressed pubkey prefix
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    log.info('Initialized mock TEE provider', { enclaveId: this.enclaveId })
    this.initialized = true
  }

  async isAvailable(): Promise<boolean> {
    return true // Always available
  }

  async requestAttestation(
    request: AttestationRequest,
  ): Promise<AttestationResponse> {
    if (!this.initialized) {
      await this.initialize()
    }

    const timestamp = Date.now()
    this.lastAttestationTime = timestamp

    // Generate deterministic measurement from request data
    const measurement = keccak256(
      new Uint8Array([...toBytes(request.data), ...toBytes(BigInt(timestamp))]),
    )

    // Generate mock quote
    const quote = new Uint8Array(256)
    crypto.getRandomValues(quote)

    // Generate signature
    const signature = keccak256(
      new Uint8Array([
        ...Buffer.from(measurement.slice(2), 'hex'),
        ...toBytes(BigInt(timestamp)),
      ]),
    )

    return {
      quote,
      measurement,
      reportData: request.data,
      signature,
      timestamp,
      enclaveId: this.enclaveId,
      provider: 'mock',
      publicKey: this.publicKey,
    }
  }

  async verifyAttestation(
    attestation: AttestationResponse,
  ): Promise<AttestationVerification> {
    const errors: string[] = []

    // Check timestamp freshness (max 1 hour)
    const maxAge = 60 * 60 * 1000
    if (Date.now() - attestation.timestamp > maxAge) {
      errors.push('Attestation is stale (> 1 hour old)')
    }

    // Check quote length
    if (attestation.quote.length < 256) {
      errors.push('Quote too short')
    }

    return {
      valid: errors.length === 0,
      provider: 'mock',
      measurement: attestation.measurement,
      timestamp: attestation.timestamp,
      errors,
    }
  }

  toTEEAttestation(attestation: AttestationResponse): TEEAttestation {
    return {
      measurement: toHash32(
        Buffer.from(attestation.measurement.slice(2), 'hex'),
      ),
      quote: attestation.quote,
      publicKey: attestation.publicKey ?? this.publicKey,
      timestamp: BigInt(attestation.timestamp),
    }
  }

  async getStatus(): Promise<{
    available: boolean
    enclaveId?: string
    capabilities: TEECapability[]
    lastAttestationTime?: number
  }> {
    return {
      available: true,
      enclaveId: this.enclaveId,
      capabilities: this.capabilities,
      lastAttestationTime: this.lastAttestationTime,
    }
  }
}

export function createMockProvider(): MockTEEProvider {
  return new MockTEEProvider()
}

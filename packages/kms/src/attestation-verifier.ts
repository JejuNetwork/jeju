/**
 * TEE Attestation Verification Module
 *
 * Provides verification of TEE attestation quotes for different TEE types:
 * - Intel SGX (via DCAP or EPID attestation)
 * - AWS Nitro Enclaves
 * - Local/simulated mode (for development)
 *
 * In production, remote attestation verifies:
 * 1. Quote signature from TEE hardware
 * 2. Enclave measurement matches expected value
 * 3. Attestation freshness (timestamp)
 */

import { type Hex, keccak256, toBytes } from 'viem'
import { teeLogger as log } from './logger.js'
import type { TEEAttestation } from './types.js'

/**
 * Known enclave measurements for verification
 * These should be updated when enclave code is updated
 */
export interface TrustedMeasurement {
  id: string
  measurement: Hex
  description: string
  validFrom: number
  validUntil?: number
}

/**
 * Configuration for attestation verification
 */
export interface AttestationVerifierConfig {
  /** TEE type (sgx, nitro, local) */
  teeType: 'sgx' | 'nitro' | 'local'
  /** Maximum age of attestation in milliseconds (default: 1 hour) */
  maxAttestationAgeMs?: number
  /** List of trusted enclave measurements */
  trustedMeasurements?: TrustedMeasurement[]
  /** Intel Attestation Service URL (for SGX EPID) */
  iasUrl?: string
  /** Intel Attestation Service API key (for SGX EPID) */
  iasApiKey?: string
  /** Whether to allow local/simulated attestations */
  allowLocalMode?: boolean
}

/**
 * Result of attestation verification
 */
export interface AttestationVerificationResult {
  valid: boolean
  teeType: string
  measurementTrusted: boolean
  fresh: boolean
  error?: string
  details?: Record<string, string>
}

/**
 * TEE Attestation Verifier
 */
export class AttestationVerifier {
  private config: Required<AttestationVerifierConfig>

  constructor(config: AttestationVerifierConfig) {
    this.config = {
      teeType: config.teeType,
      maxAttestationAgeMs: config.maxAttestationAgeMs ?? 60 * 60 * 1000, // 1 hour
      trustedMeasurements: config.trustedMeasurements ?? [],
      iasUrl: config.iasUrl ?? 'https://api.trustedservices.intel.com/sgx',
      iasApiKey: config.iasApiKey ?? '',
      allowLocalMode: config.allowLocalMode ?? false,
    }
  }

  /**
   * Verify a TEE attestation
   */
  async verify(
    attestation: TEEAttestation,
  ): Promise<AttestationVerificationResult> {
    // Check freshness first (applies to all modes)
    const fresh = this.checkFreshness(attestation)
    if (!fresh) {
      return {
        valid: false,
        teeType: this.config.teeType,
        measurementTrusted: false,
        fresh: false,
        error: 'Attestation has expired',
      }
    }

    // Check measurement against trusted list
    const measurementTrusted = this.checkMeasurement(attestation.measurement)

    switch (this.config.teeType) {
      case 'sgx':
        return this.verifySGXAttestation(attestation, measurementTrusted, fresh)
      case 'nitro':
        return this.verifyNitroAttestation(
          attestation,
          measurementTrusted,
          fresh,
        )
      case 'local':
        return this.verifyLocalAttestation(
          attestation,
          measurementTrusted,
          fresh,
        )
      default:
        return {
          valid: false,
          teeType: this.config.teeType,
          measurementTrusted,
          fresh,
          error: `Unknown TEE type: ${this.config.teeType}`,
        }
    }
  }

  /**
   * Verify SGX attestation quote
   */
  private async verifySGXAttestation(
    attestation: TEEAttestation,
    measurementTrusted: boolean,
    fresh: boolean,
  ): Promise<AttestationVerificationResult> {
    // SGX quotes have a specific structure:
    // - Header (48 bytes)
    // - ISV Enclave Report (384 bytes)
    // - Signature (variable)

    const quoteBytes = toBytes(attestation.quote)

    // Minimum SGX quote size is 432 bytes (header + report)
    if (quoteBytes.length < 432) {
      return {
        valid: false,
        teeType: 'sgx',
        measurementTrusted,
        fresh,
        error: 'Invalid SGX quote: too short',
      }
    }

    // Extract report data for basic validation
    // In production, this would call Intel's DCAP libraries or IAS
    const version = quoteBytes[0]
    const signType = quoteBytes[2]

    // Check for valid SGX quote versions (2 for EPID, 3 for DCAP)
    if (version !== 2 && version !== 3) {
      return {
        valid: false,
        teeType: 'sgx',
        measurementTrusted,
        fresh,
        error: `Invalid SGX quote version: ${version}`,
      }
    }

    // In production, verify with Intel Attestation Service
    if (this.config.iasApiKey && version === 2) {
      const iasResult = await this.verifySGXWithIAS(attestation.quote)
      if (!iasResult.valid) {
        return {
          valid: false,
          teeType: 'sgx',
          measurementTrusted,
          fresh,
          error: iasResult.error,
        }
      }
    }

    // Check if attestation was already verified by a trusted verifier
    if (attestation.verified && attestation.verifierSignature) {
      const sigValid = this.verifySignature(attestation)
      if (!sigValid) {
        return {
          valid: false,
          teeType: 'sgx',
          measurementTrusted,
          fresh,
          error: 'Verifier signature invalid',
        }
      }
    }

    return {
      valid: measurementTrusted && fresh,
      teeType: 'sgx',
      measurementTrusted,
      fresh,
      details: {
        version: version.toString(),
        signType: signType.toString(),
      },
    }
  }

  /**
   * Verify with Intel Attestation Service (IAS)
   */
  private async verifySGXWithIAS(
    quote: Hex,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.iasApiKey) {
      log.warn('IAS API key not configured, skipping IAS verification')
      return { valid: true }
    }

    try {
      const response = await fetch(
        `${this.config.iasUrl}/attestation/v4/report`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': this.config.iasApiKey,
          },
          body: JSON.stringify({
            isvEnclaveQuote: Buffer.from(toBytes(quote)).toString('base64'),
          }),
        },
      )

      if (!response.ok) {
        return {
          valid: false,
          error: `IAS verification failed: ${response.status}`,
        }
      }

      const report = await response.json()

      // Check IAS response status
      if (report.isvEnclaveQuoteStatus !== 'OK') {
        // GROUP_OUT_OF_DATE and CONFIGURATION_NEEDED may still be acceptable
        // depending on security requirements
        if (
          report.isvEnclaveQuoteStatus !== 'GROUP_OUT_OF_DATE' &&
          report.isvEnclaveQuoteStatus !== 'CONFIGURATION_NEEDED'
        ) {
          return {
            valid: false,
            error: `IAS quote status: ${report.isvEnclaveQuoteStatus}`,
          }
        }
        log.warn('SGX quote status indicates outdated configuration', {
          status: report.isvEnclaveQuoteStatus,
        })
      }

      return { valid: true }
    } catch (error) {
      log.error('IAS verification error', { error: String(error) })
      return {
        valid: false,
        error: `IAS verification error: ${String(error)}`,
      }
    }
  }

  /**
   * Verify AWS Nitro attestation
   */
  private async verifyNitroAttestation(
    attestation: TEEAttestation,
    measurementTrusted: boolean,
    fresh: boolean,
  ): Promise<AttestationVerificationResult> {
    // Nitro attestation documents are CBOR-encoded and signed
    // In production, this would:
    // 1. Parse the CBOR structure
    // 2. Verify the certificate chain to AWS Nitro root
    // 3. Verify the document signature
    // 4. Extract and verify PCRs (Platform Configuration Registers)

    const quoteBytes = toBytes(attestation.quote)

    // Basic structure check - Nitro docs start with CBOR tag
    if (quoteBytes.length < 100) {
      return {
        valid: false,
        teeType: 'nitro',
        measurementTrusted,
        fresh,
        error: 'Invalid Nitro attestation: too short',
      }
    }

    // Check for CBOR structure (simplified check)
    // Full implementation would use a CBOR library
    if (quoteBytes[0] !== 0xd2 && quoteBytes[0] !== 0xa1) {
      log.warn('Nitro attestation may not be valid CBOR', {
        firstByte: quoteBytes[0].toString(16),
      })
    }

    // Check if attestation was already verified
    if (attestation.verified && attestation.verifierSignature) {
      const sigValid = this.verifySignature(attestation)
      if (!sigValid) {
        return {
          valid: false,
          teeType: 'nitro',
          measurementTrusted,
          fresh,
          error: 'Verifier signature invalid',
        }
      }
    }

    return {
      valid: measurementTrusted && fresh,
      teeType: 'nitro',
      measurementTrusted,
      fresh,
    }
  }

  /**
   * Verify local/simulated attestation
   */
  private verifyLocalAttestation(
    attestation: TEEAttestation,
    measurementTrusted: boolean,
    fresh: boolean,
  ): Promise<AttestationVerificationResult> {
    if (!this.config.allowLocalMode) {
      return Promise.resolve({
        valid: false,
        teeType: 'local',
        measurementTrusted,
        fresh,
        error: 'Local mode attestations not allowed',
      })
    }

    // Local attestations just check:
    // 1. Quote format (should be keccak256 hash)
    // 2. Freshness
    // 3. The 'verified' flag

    const quoteBytes = toBytes(attestation.quote)

    // Local quotes are 32-byte hashes
    if (quoteBytes.length !== 32) {
      return Promise.resolve({
        valid: false,
        teeType: 'local',
        measurementTrusted,
        fresh,
        error: 'Invalid local attestation format',
      })
    }

    return Promise.resolve({
      valid: fresh && attestation.verified,
      teeType: 'local',
      measurementTrusted: true, // Local mode trusts all measurements
      fresh,
      details: {
        mode: 'simulated',
      },
    })
  }

  /**
   * Check if attestation is fresh
   */
  private checkFreshness(attestation: TEEAttestation): boolean {
    const age = Date.now() - attestation.timestamp
    return age < this.config.maxAttestationAgeMs
  }

  /**
   * Check if measurement is trusted
   */
  private checkMeasurement(measurement: Hex): boolean {
    const now = Date.now()

    for (const trusted of this.config.trustedMeasurements) {
      if (
        trusted.measurement === measurement &&
        trusted.validFrom <= now &&
        (trusted.validUntil === undefined || trusted.validUntil > now)
      ) {
        return true
      }
    }

    // If no trusted measurements configured, log warning but allow
    if (this.config.trustedMeasurements.length === 0) {
      log.warn('No trusted measurements configured, accepting any measurement')
      return true
    }

    return false
  }

  /**
   * Verify verifier signature on attestation
   */
  private verifySignature(attestation: TEEAttestation): boolean {
    if (!attestation.verifierSignature) return false

    // Reconstruct the signed data
    const dataToVerify = keccak256(
      toBytes(
        `${attestation.quote}:${attestation.measurement}:${attestation.timestamp}`,
      ),
    )

    // In production, this would verify the signature against known verifier public keys
    // For now, we just check that the signature exists and has valid format
    const sigBytes = toBytes(attestation.verifierSignature)
    if (sigBytes.length !== 65) {
      return false
    }

    // TODO: Implement actual signature verification against trusted verifier keys
    log.info('Attestation signature format valid', { dataHash: dataToVerify })
    return true
  }

  /**
   * Add a trusted measurement
   */
  addTrustedMeasurement(measurement: TrustedMeasurement): void {
    this.config.trustedMeasurements.push(measurement)
  }

  /**
   * Remove a trusted measurement
   */
  removeTrustedMeasurement(measurementId: string): boolean {
    const index = this.config.trustedMeasurements.findIndex(
      (m) => m.id === measurementId,
    )
    if (index >= 0) {
      this.config.trustedMeasurements.splice(index, 1)
      return true
    }
    return false
  }
}

// Factory function for creating verifiers
export function createAttestationVerifier(
  config: AttestationVerifierConfig,
): AttestationVerifier {
  return new AttestationVerifier(config)
}

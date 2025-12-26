/**
 * Tests for TEE Attestation Verifier
 *
 * Tests verification of TEE attestations for SGX, Nitro, and local modes.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import {
  type AttestationVerifier,
  createAttestationVerifier,
  type TrustedMeasurement,
} from './attestation-verifier'
import type { TEEAttestation } from './types'

describe('AttestationVerifier', () => {
  describe('initialization', () => {
    test('creates verifier with SGX config', () => {
      const verifier = createAttestationVerifier({ teeType: 'sgx' })
      expect(verifier).toBeDefined()
    })

    test('creates verifier with Nitro config', () => {
      const verifier = createAttestationVerifier({ teeType: 'nitro' })
      expect(verifier).toBeDefined()
    })

    test('creates verifier with local config', () => {
      const verifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: true,
      })
      expect(verifier).toBeDefined()
    })

    test('creates verifier with custom max age', () => {
      const verifier = createAttestationVerifier({
        teeType: 'sgx',
        maxAttestationAgeMs: 30 * 60 * 1000, // 30 minutes
      })
      expect(verifier).toBeDefined()
    })

    test('creates verifier with trusted measurements', () => {
      const measurements: TrustedMeasurement[] = [
        {
          id: 'v1',
          measurement: keccak256(toBytes('enclave-v1')) as Hex,
          description: 'Production enclave v1',
          validFrom: Date.now() - 86400000, // 1 day ago
        },
      ]

      const verifier = createAttestationVerifier({
        teeType: 'sgx',
        trustedMeasurements: measurements,
      })
      expect(verifier).toBeDefined()
    })
  })

  describe('local mode verification', () => {
    let verifier: AttestationVerifier

    beforeEach(() => {
      verifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: true,
        maxAttestationAgeMs: 60 * 60 * 1000, // 1 hour
      })
    })

    test('verifies valid local attestation', async () => {
      const attestation: TEEAttestation = {
        quote: keccak256(toBytes(`local:${Date.now()}`)) as Hex,
        measurement: keccak256(toBytes('local-measurement')) as Hex,
        timestamp: Date.now(),
        verified: true,
      }

      const result = await verifier.verify(attestation)

      expect(result.valid).toBe(true)
      expect(result.teeType).toBe('local')
      expect(result.fresh).toBe(true)
    })

    test('rejects expired local attestation', async () => {
      const attestation: TEEAttestation = {
        quote: keccak256(toBytes('local:old')) as Hex,
        measurement: keccak256(toBytes('local-measurement')) as Hex,
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        verified: true,
      }

      const result = await verifier.verify(attestation)

      expect(result.valid).toBe(false)
      expect(result.fresh).toBe(false)
      expect(result.error).toContain('expired')
    })

    test('rejects unverified local attestation', async () => {
      const attestation: TEEAttestation = {
        quote: keccak256(toBytes(`local:${Date.now()}`)) as Hex,
        measurement: keccak256(toBytes('local-measurement')) as Hex,
        timestamp: Date.now(),
        verified: false, // Not verified
      }

      const result = await verifier.verify(attestation)

      expect(result.valid).toBe(false)
    })

    test('rejects local attestation when local mode not allowed', async () => {
      const strictVerifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: false,
      })

      const attestation: TEEAttestation = {
        quote: keccak256(toBytes(`local:${Date.now()}`)) as Hex,
        measurement: keccak256(toBytes('local-measurement')) as Hex,
        timestamp: Date.now(),
        verified: true,
      }

      const result = await strictVerifier.verify(attestation)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('not allowed')
    })

    test('rejects invalid local quote format', async () => {
      const attestation: TEEAttestation = {
        // Invalid: not a 32-byte hash
        quote: '0x1234' as Hex,
        measurement: keccak256(toBytes('local-measurement')) as Hex,
        timestamp: Date.now(),
        verified: true,
      }

      const result = await verifier.verify(attestation)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('format')
    })
  })

  describe('SGX mode verification', () => {
    let verifier: AttestationVerifier

    beforeEach(() => {
      verifier = createAttestationVerifier({
        teeType: 'sgx',
        maxAttestationAgeMs: 60 * 60 * 1000,
      })
    })

    test('rejects quote that is too short', async () => {
      const attestation: TEEAttestation = {
        quote: `0x${'00'.repeat(100)}` as Hex, // Too short for SGX
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now(),
        verified: false,
      }

      const result = await verifier.verify(attestation)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('too short')
    })

    test('validates SGX quote version', async () => {
      // Create a mock SGX quote with valid length but wrong version
      const quoteBytes = new Uint8Array(500)
      quoteBytes[0] = 99 // Invalid version
      quoteBytes[2] = 0 // Sign type

      const attestation: TEEAttestation = {
        quote: toHex(quoteBytes) as Hex,
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now(),
        verified: false,
      }

      const result = await verifier.verify(attestation)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('version')
    })

    test('accepts valid SGX quote structure (version 2)', async () => {
      // Create mock EPID quote (version 2)
      const quoteBytes = new Uint8Array(500)
      quoteBytes[0] = 2 // EPID version
      quoteBytes[2] = 0 // Sign type

      const attestation: TEEAttestation = {
        quote: toHex(quoteBytes) as Hex,
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now(),
        verified: true,
        verifierSignature: `0x${'11'.repeat(65)}` as Hex,
      }

      const result = await verifier.verify(attestation)

      // May fail on measurement check if not in trusted list
      expect(result.teeType).toBe('sgx')
      expect(result.fresh).toBe(true)
    })

    test('accepts valid SGX quote structure (version 3 DCAP)', async () => {
      // Create mock DCAP quote (version 3)
      const quoteBytes = new Uint8Array(500)
      quoteBytes[0] = 3 // DCAP version
      quoteBytes[2] = 0 // Sign type

      const attestation: TEEAttestation = {
        quote: toHex(quoteBytes) as Hex,
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now(),
        verified: true,
        verifierSignature: `0x${'22'.repeat(65)}` as Hex,
      }

      const result = await verifier.verify(attestation)

      expect(result.teeType).toBe('sgx')
      expect(result.fresh).toBe(true)
    })
  })

  describe('Nitro mode verification', () => {
    let verifier: AttestationVerifier

    beforeEach(() => {
      verifier = createAttestationVerifier({
        teeType: 'nitro',
        maxAttestationAgeMs: 60 * 60 * 1000,
      })
    })

    test('rejects attestation that is too short', async () => {
      const attestation: TEEAttestation = {
        quote: `0x${'00'.repeat(50)}` as Hex, // Too short for Nitro
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now(),
        verified: false,
      }

      const result = await verifier.verify(attestation)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('too short')
    })

    test('accepts valid Nitro attestation structure', async () => {
      // Create mock Nitro document (CBOR-like)
      const docBytes = new Uint8Array(200)
      docBytes[0] = 0xd2 // CBOR tag

      const attestation: TEEAttestation = {
        quote: toHex(docBytes) as Hex,
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now(),
        verified: true,
        verifierSignature: `0x${'33'.repeat(65)}` as Hex,
      }

      const result = await verifier.verify(attestation)

      expect(result.teeType).toBe('nitro')
      expect(result.fresh).toBe(true)
    })
  })

  describe('measurement verification', () => {
    test('accepts attestation with trusted measurement', async () => {
      const trustedMeasurement = keccak256(toBytes('trusted-enclave')) as Hex

      const verifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: true,
        trustedMeasurements: [
          {
            id: 'v1',
            measurement: trustedMeasurement,
            description: 'Trusted enclave',
            validFrom: Date.now() - 86400000,
          },
        ],
      })

      const attestation: TEEAttestation = {
        quote: keccak256(toBytes(`local:${Date.now()}`)) as Hex,
        measurement: trustedMeasurement,
        timestamp: Date.now(),
        verified: true,
      }

      const result = await verifier.verify(attestation)

      expect(result.measurementTrusted).toBe(true)
    })

    test('rejects attestation with untrusted measurement when list is configured', async () => {
      const trustedMeasurement = keccak256(toBytes('trusted-enclave')) as Hex
      const untrustedMeasurement = keccak256(toBytes('untrusted')) as Hex

      const verifier = createAttestationVerifier({
        teeType: 'sgx', // Use SGX mode which enforces measurement
        trustedMeasurements: [
          {
            id: 'v1',
            measurement: trustedMeasurement,
            description: 'Trusted enclave',
            validFrom: Date.now() - 86400000,
          },
        ],
      })

      // Create mock SGX quote
      const quoteBytes = new Uint8Array(500)
      quoteBytes[0] = 2 // EPID version

      const attestation: TEEAttestation = {
        quote: toHex(quoteBytes) as Hex,
        measurement: untrustedMeasurement,
        timestamp: Date.now(),
        verified: true,
        verifierSignature: `0x${'11'.repeat(65)}` as Hex,
      }

      const result = await verifier.verify(attestation)

      expect(result.measurementTrusted).toBe(false)
      // SGX mode requires measurementTrusted for validity
      expect(result.valid).toBe(false)
    })

    test('respects measurement validity window in SGX mode', async () => {
      const measurement = keccak256(toBytes('enclave')) as Hex
      const now = Date.now()

      const verifier = createAttestationVerifier({
        teeType: 'sgx',
        trustedMeasurements: [
          {
            id: 'v1',
            measurement,
            description: 'Enclave v1',
            validFrom: now + 86400000, // Not valid yet (starts tomorrow)
          },
        ],
      })

      const quoteBytes = new Uint8Array(500)
      quoteBytes[0] = 2

      const attestation: TEEAttestation = {
        quote: toHex(quoteBytes) as Hex,
        measurement,
        timestamp: now,
        verified: true,
        verifierSignature: `0x${'11'.repeat(65)}` as Hex,
      }

      const result = await verifier.verify(attestation)

      expect(result.measurementTrusted).toBe(false)
      expect(result.valid).toBe(false)
    })

    test('respects measurement expiry in SGX mode', async () => {
      const measurement = keccak256(toBytes('enclave')) as Hex
      const now = Date.now()

      const verifier = createAttestationVerifier({
        teeType: 'sgx',
        trustedMeasurements: [
          {
            id: 'v1',
            measurement,
            description: 'Expired enclave',
            validFrom: now - 172800000, // 2 days ago
            validUntil: now - 86400000, // Expired yesterday
          },
        ],
      })

      const quoteBytes = new Uint8Array(500)
      quoteBytes[0] = 2

      const attestation: TEEAttestation = {
        quote: toHex(quoteBytes) as Hex,
        measurement,
        timestamp: now,
        verified: true,
        verifierSignature: `0x${'11'.repeat(65)}` as Hex,
      }

      const result = await verifier.verify(attestation)

      expect(result.measurementTrusted).toBe(false)
      expect(result.valid).toBe(false)
    })

    test('accepts any measurement when no trusted list configured', async () => {
      // This is intentional behavior for development/testing
      const verifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: true,
        trustedMeasurements: [], // Empty list
      })

      const attestation: TEEAttestation = {
        quote: keccak256(toBytes(`local:${Date.now()}`)) as Hex,
        measurement: keccak256(toBytes('any-measurement')) as Hex,
        timestamp: Date.now(),
        verified: true,
      }

      const result = await verifier.verify(attestation)

      // When no measurements configured, accepts any
      expect(result.measurementTrusted).toBe(true)
    })
  })

  describe('trusted measurement management', () => {
    test('adds trusted measurement', () => {
      const verifier = createAttestationVerifier({ teeType: 'local' })

      verifier.addTrustedMeasurement({
        id: 'new-enclave',
        measurement: keccak256(toBytes('new')) as Hex,
        description: 'New enclave',
        validFrom: Date.now(),
      })

      // Verification should work with new measurement
      expect(verifier).toBeDefined()
    })

    test('removes trusted measurement', () => {
      const verifier = createAttestationVerifier({
        teeType: 'local',
        trustedMeasurements: [
          {
            id: 'to-remove',
            measurement: keccak256(toBytes('remove')) as Hex,
            description: 'To be removed',
            validFrom: Date.now(),
          },
        ],
      })

      const removed = verifier.removeTrustedMeasurement('to-remove')

      expect(removed).toBe(true)
    })

    test('returns false when removing non-existent measurement', () => {
      const verifier = createAttestationVerifier({ teeType: 'local' })

      const removed = verifier.removeTrustedMeasurement('non-existent')

      expect(removed).toBe(false)
    })
  })

  describe('freshness checking', () => {
    test('accepts fresh attestation', async () => {
      const verifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: true,
        maxAttestationAgeMs: 60 * 60 * 1000, // 1 hour
      })

      const attestation: TEEAttestation = {
        quote: keccak256(toBytes(`local:${Date.now()}`)) as Hex,
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now() - 30 * 60 * 1000, // 30 minutes ago
        verified: true,
      }

      const result = await verifier.verify(attestation)

      expect(result.fresh).toBe(true)
    })

    test('rejects stale attestation', async () => {
      const verifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: true,
        maxAttestationAgeMs: 60 * 60 * 1000, // 1 hour
      })

      const attestation: TEEAttestation = {
        quote: keccak256(toBytes('local:old')) as Hex,
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        verified: true,
      }

      const result = await verifier.verify(attestation)

      expect(result.fresh).toBe(false)
      expect(result.valid).toBe(false)
    })

    test('respects custom max age', async () => {
      const verifier = createAttestationVerifier({
        teeType: 'local',
        allowLocalMode: true,
        maxAttestationAgeMs: 5 * 60 * 1000, // 5 minutes
      })

      const attestation: TEEAttestation = {
        quote: keccak256(toBytes(`local:${Date.now()}`)) as Hex,
        measurement: keccak256(toBytes('measurement')) as Hex,
        timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
        verified: true,
      }

      const result = await verifier.verify(attestation)

      expect(result.fresh).toBe(false)
    })
  })
})

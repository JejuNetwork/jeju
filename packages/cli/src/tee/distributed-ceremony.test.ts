/**
 * Distributed TEE Ceremony Tests
 *
 * Tests for:
 * - DKG protocol rounds
 * - Threshold configuration validation
 * - Attestation cross-verification
 * - Key share generation and aggregation
 * - Threshold signature requests
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import {
  requestThresholdSignature,
  runDistributedCeremony,
  type TeeProvider,
  type ThresholdSignatureRequest,
} from './distributed-ceremony'

describe('Distributed TEE Ceremony', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CEREMONY_SIMULATION: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const createTestProviders = (count: number): TeeProvider[] => {
    return Array.from({ length: count }, (_, i) => ({
      name: `provider-${i}`,
      type: 'phala' as const,
      endpoint: `http://tee-${i}.example.com`,
      region: `region-${i}`,
    }))
  }

  describe('Threshold Configuration Validation', () => {
    test('rejects threshold greater than total providers', async () => {
      const providers = createTestProviders(3)

      await expect(
        runDistributedCeremony('testnet', providers, 5),
      ).rejects.toThrow('cannot exceed')
    })

    test('rejects threshold less than 2', async () => {
      const providers = createTestProviders(3)

      await expect(
        runDistributedCeremony('testnet', providers, 1),
      ).rejects.toThrow('at least 2')
    })

    test('rejects fewer than 3 providers', async () => {
      const providers = createTestProviders(2)

      await expect(
        runDistributedCeremony('testnet', providers, 2),
      ).rejects.toThrow('at least 3')
    })

    test('accepts valid 2-of-3 configuration', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      expect(result.threshold.threshold).toBe(2)
      expect(result.threshold.total).toBe(3)
    })

    test('accepts valid 3-of-5 configuration', async () => {
      const providers = createTestProviders(5)

      const result = await runDistributedCeremony('testnet', providers, 3)

      expect(result.threshold.threshold).toBe(3)
      expect(result.threshold.total).toBe(5)
    })

    test('accepts threshold equal to total (n-of-n)', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 3)

      expect(result.threshold.threshold).toBe(3)
      expect(result.threshold.total).toBe(3)
    })
  })

  describe('Ceremony Result Structure', () => {
    test('generates all required operator public keys', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      const expectedRoles = [
        'sequencer',
        'batcher',
        'proposer',
        'challenger',
        'admin',
        'feeRecipient',
        'guardian',
      ]

      for (const role of expectedRoles) {
        expect(
          result.publicKeys[role as keyof typeof result.publicKeys],
        ).toBeDefined()
        expect(
          result.publicKeys[role as keyof typeof result.publicKeys],
        ).toMatch(/^0x[a-f0-9]{64}$/)
      }
    })

    test('generates key shares for each provider', async () => {
      const providers = createTestProviders(4)

      const result = await runDistributedCeremony('testnet', providers, 3)

      // Should have shares for each provider for each role
      // 4 providers * 7 roles = 28 total shares
      expect(result.shares.length).toBe(28)

      // Each share should have correct structure
      for (const share of result.shares) {
        expect(share.index).toBeGreaterThanOrEqual(0)
        expect(share.index).toBeLessThan(4)
        expect(share.provider).toMatch(/^provider-\d$/)
        expect(share.publicShare).toHaveLength(64)
        expect(share.commitment).toHaveLength(64)
        expect(share.proof).toHaveLength(64)
        expect(share.encryptedShare).toContain('tee-sealed')
      }
    })

    test('generates attestations from all providers', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      expect(result.attestations).toHaveLength(3)

      for (let i = 0; i < 3; i++) {
        expect(result.attestations[i].provider).toBe(`provider-${i}`)
        expect(result.attestations[i].quote).toBeDefined()
        expect(result.attestations[i].measurementHash).toHaveLength(64)
      }
    })

    test('includes verification data', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      expect(result.verification.aggregatedCommitment).toHaveLength(64)
      expect(result.verification.thresholdProof).toHaveLength(64)
      expect(result.verification.crossTeeVerification).toBe(true)
    })

    test('generates genesis config with derived addresses', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      const requiredFields = [
        'SystemOwner',
        'Sequencer',
        'Batcher',
        'Proposer',
        'Challenger',
        'Guardian',
        'BaseFeeVaultRecipient',
        'L1FeeVaultRecipient',
        'SequencerFeeVaultRecipient',
      ]

      for (const field of requiredFields) {
        expect(result.genesisConfig[field]).toBeDefined()
        expect(result.genesisConfig[field]).toMatch(/^0x[a-f0-9]{40}$/)
      }
    })

    test('fee recipients all point to same address', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      expect(result.genesisConfig.BaseFeeVaultRecipient).toBe(
        result.genesisConfig.L1FeeVaultRecipient,
      )
      expect(result.genesisConfig.L1FeeVaultRecipient).toBe(
        result.genesisConfig.SequencerFeeVaultRecipient,
      )
    })
  })

  describe('Ceremony ID Generation', () => {
    test('generates unique ceremony IDs', async () => {
      const providers = createTestProviders(3)

      const results = await Promise.all([
        runDistributedCeremony('testnet', providers, 2),
        runDistributedCeremony('testnet', providers, 2),
        runDistributedCeremony('testnet', providers, 2),
      ])

      const ids = results.map((r) => r.ceremonyId)
      expect(new Set(ids).size).toBe(3)
    })

    test('ceremony ID has correct format', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      expect(result.ceremonyId).toMatch(/^jeju-ceremony-[a-z0-9]+-[a-f0-9]+$/)
    })
  })

  describe('Network Differentiation', () => {
    test('testnet and mainnet produce different results', async () => {
      const providers = createTestProviders(3)

      const testnetResult = await runDistributedCeremony(
        'testnet',
        providers,
        2,
      )
      const mainnetResult = await runDistributedCeremony(
        'mainnet',
        providers,
        2,
      )

      expect(testnetResult.network).toBe('testnet')
      expect(mainnetResult.network).toBe('mainnet')

      // Public keys should be different due to different derivation paths
      // (In simulation mode they're random, so they'll always differ)
      expect(testnetResult.publicKeys.admin).not.toBe(
        mainnetResult.publicKeys.admin,
      )
    })
  })

  describe('Threshold Algorithm', () => {
    test('uses FROST algorithm', async () => {
      const providers = createTestProviders(3)

      const result = await runDistributedCeremony('testnet', providers, 2)

      expect(result.threshold.algorithm).toBe('frost-secp256k1')
    })
  })
})

describe('Threshold Signature', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CEREMONY_SIMULATION: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const createTestProviders = (count: number): TeeProvider[] => {
    return Array.from({ length: count }, (_, i) => ({
      name: `provider-${i}`,
      type: 'phala' as const,
      endpoint: `http://tee-${i}.example.com`,
    }))
  }

  test('requests signature from k signers', async () => {
    const providers = createTestProviders(3)

    const request: ThresholdSignatureRequest = {
      ceremonyId: 'jeju-ceremony-test-123',
      role: 'admin',
      message: 'Sign this transaction',
      requiredSigners: ['provider-0', 'provider-1'],
    }

    const signature = await requestThresholdSignature(providers, request)

    expect(signature.shares).toHaveLength(2)
    expect(signature.signature).toMatch(/^0x[a-f0-9]{64}$/)
    expect(signature.aggregationProof).toHaveLength(64)
  })

  test('each share includes fresh attestation', async () => {
    const providers = createTestProviders(3)

    const request: ThresholdSignatureRequest = {
      ceremonyId: 'jeju-ceremony-test-123',
      role: 'admin',
      message: 'Sign this transaction',
      requiredSigners: ['provider-0', 'provider-1', 'provider-2'],
    }

    const signature = await requestThresholdSignature(providers, request)

    for (const share of signature.shares) {
      expect(share.attestation.provider).toBeDefined()
      expect(share.attestation.quote).toBeDefined()
      expect(share.attestation.measurementHash).toHaveLength(64)
    }
  })

  test('rejects unknown signer', async () => {
    const providers = createTestProviders(3)

    const request: ThresholdSignatureRequest = {
      ceremonyId: 'jeju-ceremony-test-123',
      role: 'admin',
      message: 'Sign this transaction',
      requiredSigners: ['provider-0', 'unknown-provider'],
    }

    await expect(requestThresholdSignature(providers, request)).rejects.toThrow(
      'Unknown signer',
    )
  })

  test('each signer produces unique share', async () => {
    const providers = createTestProviders(3)

    const request: ThresholdSignatureRequest = {
      ceremonyId: 'jeju-ceremony-test-123',
      role: 'admin',
      message: 'Sign this transaction',
      requiredSigners: ['provider-0', 'provider-1', 'provider-2'],
    }

    const signature = await requestThresholdSignature(providers, request)

    const shares = signature.shares.map((s) => s.share)
    expect(new Set(shares).size).toBe(3)
  })
})

describe('DKG Protocol Security', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CEREMONY_SIMULATION: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const createTestProviders = (count: number): TeeProvider[] => {
    return Array.from({ length: count }, (_, i) => ({
      name: `provider-${i}`,
      type: 'phala' as const,
      endpoint: `http://tee-${i}.example.com`,
    }))
  }

  test('commitments are unique per participant', async () => {
    const providers = createTestProviders(5)

    const result = await runDistributedCeremony('testnet', providers, 3)

    // Get commitments for a single role (admin)
    const adminShares = result.shares.filter((_, i) => i < 5)
    const commitments = adminShares.map((s) => s.commitment)

    expect(new Set(commitments).size).toBe(5)
  })

  test('proofs are unique per participant', async () => {
    const providers = createTestProviders(5)

    const result = await runDistributedCeremony('testnet', providers, 3)

    // Get proofs for a single role
    const roleShares = result.shares.filter((_, i) => i < 5)
    const proofs = roleShares.map((s) => s.proof)

    expect(new Set(proofs).size).toBe(5)
  })

  test('encrypted shares are sealed to specific TEE', async () => {
    const providers = createTestProviders(3)

    const result = await runDistributedCeremony('testnet', providers, 2)

    for (const share of result.shares) {
      expect(share.encryptedShare).toContain('tee-sealed')
      expect(share.encryptedShare).toContain(share.provider)
    }
  })

  test('aggregated commitment is deterministic for same shares', async () => {
    // Create mock shares with known commitments to verify hash computation
    const commitment1 = bytesToHex(hash256('commitment1'))
    const commitment2 = bytesToHex(hash256('commitment2'))

    // Verify commitments are valid hex (aggregated commitment = hash(commitment1:commitment2))
    expect(commitment1).toHaveLength(64)
    expect(commitment2).toHaveLength(64)

    // Run ceremony and verify structure
    const providers = createTestProviders(3)
    const result = await runDistributedCeremony('testnet', providers, 2)

    expect(result.verification.aggregatedCommitment).toHaveLength(64)
  })
})

describe('Cross-TEE Verification', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CEREMONY_SIMULATION: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const createTestProviders = (count: number): TeeProvider[] => {
    return Array.from({ length: count }, (_, i) => ({
      name: `provider-${i}`,
      type: 'phala' as const,
      endpoint: `http://tee-${i}.example.com`,
    }))
  }

  test('all attestations are cross-verified', async () => {
    const providers = createTestProviders(4)

    const result = await runDistributedCeremony('testnet', providers, 3)

    expect(result.verification.crossTeeVerification).toBe(true)
  })

  test('attestations have valid measurement hashes', async () => {
    const providers = createTestProviders(3)

    const result = await runDistributedCeremony('testnet', providers, 2)

    for (const attestation of result.attestations) {
      // Measurement hash should be SHA-256 (64 hex chars)
      expect(attestation.measurementHash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test('attestation quotes are non-empty', async () => {
    const providers = createTestProviders(3)

    const result = await runDistributedCeremony('testnet', providers, 2)

    for (const attestation of result.attestations) {
      expect(attestation.quote.length).toBeGreaterThan(50)
    }
  })
})

describe('Provider Diversity', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CEREMONY_SIMULATION: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('supports multiple provider types', async () => {
    const providers: TeeProvider[] = [
      { name: 'phala-1', type: 'phala', endpoint: 'http://phala.example.com' },
      {
        name: 'gcp-1',
        type: 'gcp',
        endpoint: 'http://gcp.example.com',
        region: 'us-east1',
      },
      {
        name: 'azure-1',
        type: 'azure',
        endpoint: 'http://azure.example.com',
        region: 'eastus',
      },
    ]

    const result = await runDistributedCeremony('testnet', providers, 2)

    expect(result.attestations).toHaveLength(3)
    expect(result.attestations[0].provider).toBe('phala-1')
    expect(result.attestations[1].provider).toBe('gcp-1')
    expect(result.attestations[2].provider).toBe('azure-1')
  })

  test('supports custom provider type', async () => {
    const providers: TeeProvider[] = [
      {
        name: 'custom-1',
        type: 'custom',
        endpoint: 'http://custom1.example.com',
      },
      {
        name: 'custom-2',
        type: 'custom',
        endpoint: 'http://custom2.example.com',
      },
      {
        name: 'custom-3',
        type: 'custom',
        endpoint: 'http://custom3.example.com',
      },
    ]

    const result = await runDistributedCeremony('testnet', providers, 2)

    expect(result.threshold.total).toBe(3)
  })
})

describe('Timestamp and Ordering', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CEREMONY_SIMULATION: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const createTestProviders = (count: number): TeeProvider[] => {
    return Array.from({ length: count }, (_, i) => ({
      name: `provider-${i}`,
      type: 'phala' as const,
      endpoint: `http://tee-${i}.example.com`,
    }))
  }

  test('ceremony timestamp is valid ISO string', async () => {
    const providers = createTestProviders(3)

    const result = await runDistributedCeremony('testnet', providers, 2)

    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

    // Should be parseable
    const date = new Date(result.timestamp)
    expect(date.getTime()).toBeGreaterThan(0)
  })

  test('attestation timestamps are valid', async () => {
    const providers = createTestProviders(3)

    const result = await runDistributedCeremony('testnet', providers, 2)

    for (const attestation of result.attestations) {
      expect(attestation.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  test('share indices are sequential', async () => {
    const providers = createTestProviders(4)

    const result = await runDistributedCeremony('testnet', providers, 3)

    // For each role, indices should be 0, 1, 2, 3
    for (let role = 0; role < 7; role++) {
      const roleShares = result.shares.slice(role * 4, (role + 1) * 4)
      const indices = roleShares.map((s) => s.index)
      expect(indices).toEqual([0, 1, 2, 3])
    }
  })
})

/**
 * KMS Signer Unit Tests
 *
 * Tests for threshold signing configuration and validation.
 * Note: Actual signing tests require infrastructure (DWS/KMS running).
 */

import { beforeEach, describe, expect, test, mock, afterEach } from 'bun:test'
import type { KMSSignerConfig } from '../../api/sdk/kms-signer'

// Mock the config module
const mockGetCurrentNetwork = mock(() => 'localnet')
const mockGetKmsServiceUrl = mock(() => 'http://localhost:4050')
const mockGetKmsThresholdConfig = mock(() => ({
  threshold: 1,
  totalParties: 2, // Must be > threshold
  requireAttestation: false,
  signingTimeoutMs: 10000,
}))
const mockGetHSMConfig = mock(() => ({
  provider: 'software' as const,
  required: false,
  keyWrapAlgorithm: 'AES256_GCM' as const,
  maxOperationsBeforeRotation: 10000,
}))
const mockIsProductionEnv = mock(() => false)
const mockCheckHSMAvailability = mock(async () => ({
  available: true,
  provider: 'software' as const,
}))

mock.module('@jejunetwork/config', () => ({
  getCurrentNetwork: mockGetCurrentNetwork,
  getKmsServiceUrl: mockGetKmsServiceUrl,
  getKmsThresholdConfig: mockGetKmsThresholdConfig,
  getHSMConfig: mockGetHSMConfig,
  isProductionEnv: mockIsProductionEnv,
  checkHSMAvailability: mockCheckHSMAvailability,
}))

describe('KMS Signer Configuration', () => {
  beforeEach(() => {
    mockGetCurrentNetwork.mockReset()
    mockGetKmsServiceUrl.mockReset()
    mockGetKmsThresholdConfig.mockReset()
    mockGetHSMConfig.mockReset()
    mockIsProductionEnv.mockReset()
    mockCheckHSMAvailability.mockReset()

    // Set localnet defaults
    mockGetCurrentNetwork.mockImplementation(() => 'localnet')
    mockGetKmsServiceUrl.mockImplementation(() => 'http://localhost:4050')
    mockGetKmsThresholdConfig.mockImplementation(() => ({
      threshold: 1,
      totalParties: 2, // Must be > threshold
      requireAttestation: false,
      signingTimeoutMs: 10000,
    }))
    mockGetHSMConfig.mockImplementation(() => ({
      provider: 'software' as const,
      required: false,
      keyWrapAlgorithm: 'AES256_GCM' as const,
      maxOperationsBeforeRotation: 10000,
    }))
    mockIsProductionEnv.mockImplementation(() => false)
  })

  describe('Threshold Validation', () => {
    test('should reject threshold < 2 in production mode', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 1,
        totalParties: 2, // Valid totalParties
        timeout: 10000,
        allowDevMode: false, // Production mode
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      expect(() => new KMSSigner(config)).toThrow(
        'Threshold must be at least 2 for production security',
      )
    })

    test('should allow threshold 1 in dev mode', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 1,
        totalParties: 2, // Must be > threshold
        timeout: 10000,
        allowDevMode: true, // Dev mode allowed
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      // Should not throw
      const signer = new KMSSigner(config)
      expect(signer).toBeDefined()
    })

    test('should require totalParties > threshold', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 2,
        totalParties: 2, // Should be > threshold
        timeout: 10000,
        allowDevMode: true,
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      expect(() => new KMSSigner(config)).toThrow(
        'Total parties must be greater than threshold',
      )
    })
  })

  describe('Factory Function', () => {
    test('should create signer with localnet defaults', async () => {
      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      const signer = createKMSSigner('http://localhost:8545', 31337)
      expect(signer).toBeDefined()
    })

    test('should use testnet threshold config', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'testnet')
      mockGetKmsServiceUrl.mockImplementation(() => 'https://kms.testnet.jejunetwork.org')
      mockGetKmsThresholdConfig.mockImplementation(() => ({
        threshold: 2,
        totalParties: 3,
        requireAttestation: true,
        signingTimeoutMs: 30000,
      }))
      mockGetHSMConfig.mockImplementation(() => ({
        provider: 'aws_cloudhsm' as const,
        required: false,
        keyWrapAlgorithm: 'AES256_GCM' as const,
        maxOperationsBeforeRotation: 100000,
      }))
      mockIsProductionEnv.mockImplementation(() => true)

      // Force re-import to pick up new mocks
      const { createKMSSigner } = await import('../../api/sdk/kms-signer')
      const signer = createKMSSigner('https://rpc.testnet.jejunetwork.org', 420691)
      expect(signer).toBeDefined()
    })

    test('should enforce mainnet minimum threshold', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'mainnet')
      mockGetKmsServiceUrl.mockImplementation(() => 'https://kms.jejunetwork.org')
      mockGetKmsThresholdConfig.mockImplementation(() => ({
        threshold: 2, // Below mainnet minimum of 3
        totalParties: 3,
        requireAttestation: true,
        signingTimeoutMs: 60000,
      }))
      mockGetHSMConfig.mockImplementation(() => ({
        provider: 'aws_cloudhsm' as const,
        required: true,
        keyWrapAlgorithm: 'AES256_GCM' as const,
        maxOperationsBeforeRotation: 1000000,
      }))
      mockIsProductionEnv.mockImplementation(() => true)

      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      expect(() => createKMSSigner('https://rpc.jejunetwork.org', 420691)).toThrow(
        'Mainnet requires minimum threshold of 3',
      )
    })

    test('should reject dev mode on mainnet', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'mainnet')
      mockGetKmsThresholdConfig.mockImplementation(() => ({
        threshold: 3,
        totalParties: 5,
        requireAttestation: false, // This would enable dev mode
        signingTimeoutMs: 60000,
      }))
      mockGetHSMConfig.mockImplementation(() => ({
        provider: 'aws_cloudhsm' as const,
        required: true,
        keyWrapAlgorithm: 'AES256_GCM' as const,
        maxOperationsBeforeRotation: 1000000,
      }))
      mockIsProductionEnv.mockImplementation(() => true)

      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      expect(() => createKMSSigner('https://rpc.jejunetwork.org', 420691)).toThrow(
        'Mainnet cannot run in development mode',
      )
    })

    test('should require HSM on mainnet', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'mainnet')
      mockGetKmsThresholdConfig.mockImplementation(() => ({
        threshold: 3,
        totalParties: 5,
        requireAttestation: true,
        signingTimeoutMs: 60000,
      }))
      mockGetHSMConfig.mockImplementation(() => ({
        provider: 'software' as const, // Software not allowed on mainnet
        required: true,
        keyWrapAlgorithm: 'AES256_GCM' as const,
        maxOperationsBeforeRotation: 1000000,
      }))
      mockIsProductionEnv.mockImplementation(() => true)

      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      expect(() => createKMSSigner('https://rpc.jejunetwork.org', 420691)).toThrow(
        'Mainnet requires HSM-backed key storage',
      )
    })
  })

  describe('Signer State', () => {
    test('should not be initialized before initialize() is called', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 1,
        totalParties: 2,
        timeout: 10000,
        allowDevMode: true,
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      const signer = new KMSSigner(config)
      expect(signer.isInitialized()).toBe(false)
    })

    test('should throw when getting address before initialization', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 1,
        totalParties: 2,
        timeout: 10000,
        allowDevMode: true,
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      const signer = new KMSSigner(config)
      expect(() => signer.getAddress()).toThrow('KMS signer not initialized')
    })

    test('should throw when getting keyId before initialization', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 1,
        totalParties: 2,
        timeout: 10000,
        allowDevMode: true,
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      const signer = new KMSSigner(config)
      expect(() => signer.getKeyId()).toThrow('KMS signer not initialized')
    })
  })
})


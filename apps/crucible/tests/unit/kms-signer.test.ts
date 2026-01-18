import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { KMSSignerConfig } from '../../api/sdk/kms-signer'

const mockGetCurrentNetwork = mock(() => 'localnet')
const mockGetKmsServiceUrl = mock(() => 'http://localhost:4050')

mock.module('@jejunetwork/config', () => ({
  getCurrentNetwork: mockGetCurrentNetwork,
  getKmsServiceUrl: mockGetKmsServiceUrl,
}))

describe('KMS Signer Configuration', () => {
  beforeEach(() => {
    mockGetCurrentNetwork.mockReset()
    mockGetKmsServiceUrl.mockReset()
    mockGetCurrentNetwork.mockImplementation(() => 'localnet')
    mockGetKmsServiceUrl.mockImplementation(() => 'http://localhost:4050')
  })

  describe('Threshold Validation', () => {
    test('should reject threshold < 2 in production mode', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 1,
        totalParties: 2,
        timeout: 10000,
        allowDevMode: false,
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
        totalParties: 2,
        timeout: 10000,
        allowDevMode: true,
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      const signer = new KMSSigner(config)
      expect(signer).toBeDefined()
    })

    test('should require totalParties > threshold in production', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      // In production mode (allowDevMode=false), totalParties must be > threshold
      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'testnet',
        threshold: 2,
        totalParties: 2,
        timeout: 10000,
        allowDevMode: false,
        rpcUrl: 'http://localhost:8545',
        chainId: 420690,
      }

      expect(() => new KMSSigner(config)).toThrow(
        'Total parties must be greater than threshold',
      )
    })

    test('should allow totalParties >= threshold in dev mode', async () => {
      const { KMSSigner } = await import('../../api/sdk/kms-signer')

      // In dev mode, totalParties can equal threshold (single-party mode)
      const config: KMSSignerConfig = {
        endpoint: 'http://localhost:4050',
        networkId: 'localnet',
        threshold: 1,
        totalParties: 1,
        timeout: 10000,
        allowDevMode: true,
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
      }

      const signer = new KMSSigner(config)
      expect(signer).toBeDefined()
    })
  })

  describe('Factory Function', () => {
    test('should create signer with localnet defaults', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'localnet')
      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      const signer = createKMSSigner('http://localhost:8545', 31337)
      expect(signer).toBeDefined()
    })

    test('should enforce mainnet minimum threshold', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'mainnet')
      mockGetKmsServiceUrl.mockImplementation(
        () => 'https://kms.jejunetwork.org',
      )

      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      expect(() =>
        createKMSSigner('https://rpc.jejunetwork.org', 420691, {
          threshold: 2,
          totalParties: 3,
        }),
      ).toThrow('Mainnet requires minimum threshold of 3')
    })

    test('should reject dev mode on mainnet', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'mainnet')
      mockGetKmsServiceUrl.mockImplementation(
        () => 'https://kms.jejunetwork.org',
      )

      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      expect(() =>
        createKMSSigner('https://rpc.jejunetwork.org', 420691, {
          threshold: 3,
          totalParties: 5,
          allowDevMode: true,
        }),
      ).toThrow('Mainnet cannot run in development mode')
    })

    test('should require HSM on mainnet', async () => {
      mockGetCurrentNetwork.mockImplementation(() => 'mainnet')
      mockGetKmsServiceUrl.mockImplementation(
        () => 'https://kms.jejunetwork.org',
      )

      const { createKMSSigner } = await import('../../api/sdk/kms-signer')

      // Test without HSM config - should throw
      expect(() =>
        createKMSSigner('https://rpc.jejunetwork.org', 420691, {
          threshold: 3,
          totalParties: 5,
          allowDevMode: false,
          hsm: { enabled: false, provider: 'software' },
        }),
      ).toThrow('Mainnet requires HSM-backed key storage')
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

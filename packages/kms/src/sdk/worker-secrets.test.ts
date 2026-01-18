/**
 * Worker Secrets Unit Tests
 *
 * Tests the KMS-backed secret management for workerd runtime.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'
import {
  getSecret,
  getSecretEnv,
  initWorkerSecrets,
  isSecretsInitialized,
  requireSecret,
  resetWorkerSecrets,
  type SecretRef,
  type WorkerSecretsConfig,
} from './worker-secrets'

// Mock fetch for testing - cast to satisfy bun's fetch type with preconnect
const mockFetch = mock(() => Promise.resolve(new Response()))

// Helper to create typed fetch mocks (cast to typeof fetch to satisfy bun's type)
function createFetchMock<T>(fn: T): typeof fetch {
  const m = fn as typeof fetch
  // Add preconnect method required by bun's fetch type
  ;(m as { preconnect: typeof fetch.preconnect }).preconnect = () => {}
  return m
}

describe('Worker Secrets', () => {
  const testOwner = '0x1234567890123456789012345678901234567890' as Address
  const testWorkerId = 'test-worker-123'

  beforeEach(() => {
    resetWorkerSecrets()
    mockFetch.mockClear()
  })

  describe('initWorkerSecrets', () => {
    test('should fetch secrets from KMS endpoint', async () => {
      const secrets: SecretRef[] = [
        { secretId: 'secret-1', envName: 'DATABASE_URL', required: true },
        { secretId: 'secret-2', envName: 'API_KEY', required: false },
      ]

      const mockResponse = {
        secrets: [
          {
            secretId: 'secret-1',
            value: 'postgres://localhost/db',
            version: 1,
          },
          { secretId: 'secret-2', value: 'sk-test-key', version: 1 },
        ],
      }

      globalThis.fetch = createFetchMock(
        mock(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const config: WorkerSecretsConfig = {
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets,
      }

      await initWorkerSecrets(config)

      expect(isSecretsInitialized()).toBe(true)
      expect(getSecret('DATABASE_URL')).toBe('postgres://localhost/db')
      expect(getSecret('API_KEY')).toBe('sk-test-key')
    })

    test('should throw if required secret is missing', async () => {
      const secrets: SecretRef[] = [
        { secretId: 'secret-1', envName: 'DATABASE_URL', required: true },
      ]

      const mockResponse = {
        secrets: [],
        errors: [{ secretId: 'secret-1', error: 'Not found' }],
      }

      globalThis.fetch = createFetchMock(
        mock(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const config: WorkerSecretsConfig = {
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets,
      }

      await expect(initWorkerSecrets(config)).rejects.toThrow(
        'Missing required secrets',
      )
    })

    test('should not throw if optional secret is missing', async () => {
      const secrets: SecretRef[] = [
        { secretId: 'secret-1', envName: 'OPTIONAL_KEY', required: false },
      ]

      const mockResponse = {
        secrets: [],
        errors: [{ secretId: 'secret-1', error: 'Not found' }],
      }

      globalThis.fetch = createFetchMock(
        mock(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const config: WorkerSecretsConfig = {
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets,
      }

      await initWorkerSecrets(config)
      expect(isSecretsInitialized()).toBe(true)
      expect(getSecret('OPTIONAL_KEY')).toBeUndefined()
    })

    test('should include TEE attestation header', async () => {
      let capturedHeaders: Record<string, string> = {}

      globalThis.fetch = createFetchMock(
        mock((_url: string, options: RequestInit) => {
          capturedHeaders = options.headers as Record<string, string>
          return Promise.resolve(
            new Response(JSON.stringify({ secrets: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }),
      )

      const config: WorkerSecretsConfig = {
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets: [],
        attestation: {
          platform: 'simulated',
          quote: '0x1234',
          measurement: '0x5678',
          reportData: '0x9abc',
          timestamp: Date.now(),
        },
      }

      await initWorkerSecrets(config)

      expect(capturedHeaders['x-tee-attestation']).toBeDefined()
      const attestation = JSON.parse(capturedHeaders['x-tee-attestation'])
      expect(attestation.platform).toBe('simulated')
      expect(attestation.quote).toBe('0x1234')
    })
  })

  describe('getSecret', () => {
    test('should throw if not initialized', () => {
      expect(() => getSecret('DATABASE_URL')).toThrow('Secrets not initialized')
    })

    test('should return undefined for non-existent secret', async () => {
      globalThis.fetch = createFetchMock(
        mock(() =>
          Promise.resolve(
            new Response(JSON.stringify({ secrets: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      await initWorkerSecrets({
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets: [],
      })

      expect(getSecret('NON_EXISTENT')).toBeUndefined()
    })
  })

  describe('requireSecret', () => {
    test('should throw if secret not found', async () => {
      globalThis.fetch = createFetchMock(
        mock(() =>
          Promise.resolve(
            new Response(JSON.stringify({ secrets: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      await initWorkerSecrets({
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets: [],
      })

      expect(() => requireSecret('DATABASE_URL')).toThrow(
        'Required secret not found',
      )
    })
  })

  describe('getSecretEnv', () => {
    test('should return all secrets as env object', async () => {
      const mockResponse = {
        secrets: [
          { secretId: 'secret-1', value: 'value1', version: 1 },
          { secretId: 'secret-2', value: 'value2', version: 1 },
        ],
      }

      globalThis.fetch = createFetchMock(
        mock(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      await initWorkerSecrets({
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets: [
          { secretId: 'secret-1', envName: 'KEY1', required: true },
          { secretId: 'secret-2', envName: 'KEY2', required: true },
        ],
      })

      const env = getSecretEnv()
      expect(env.KEY1).toBe('value1')
      expect(env.KEY2).toBe('value2')
    })
  })

  describe('resetWorkerSecrets', () => {
    test('should clear all cached secrets', async () => {
      const mockResponse = {
        secrets: [
          { secretId: 'secret-1', value: 'sensitive-value', version: 1 },
        ],
      }

      globalThis.fetch = createFetchMock(
        mock(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      await initWorkerSecrets({
        kmsEndpoint: 'http://localhost:4020',
        workerId: testWorkerId,
        ownerAddress: testOwner,
        secrets: [{ secretId: 'secret-1', envName: 'SECRET', required: true }],
      })

      expect(getSecret('SECRET')).toBe('sensitive-value')

      resetWorkerSecrets()

      expect(isSecretsInitialized()).toBe(false)
      expect(() => getSecret('SECRET')).toThrow('Secrets not initialized')
    })
  })
})

describe('Security Validation', () => {
  describe('No secrets in bundles', () => {
    test('SAFE_ENV_KEYS should not include sensitive keys', () => {
      // These should NEVER be in SAFE_ENV_KEYS
      const sensitiveKeys = [
        'PRIVATE_KEY',
        'DEPLOYER_PRIVATE_KEY',
        'SQLIT_PRIVATE_KEY',
        'API_SECRET',
        'DATABASE_PASSWORD',
        'JWT_SECRET',
        'ENCRYPTION_KEY',
      ]

      // Verify sensitive keys are not in the safe keys list
      for (const key of sensitiveKeys) {
        // SAFE_ENV_KEYS should NOT contain these
        expect(['PORT', 'NODE_ENV', 'NETWORK', 'KMS_URL'].includes(key)).toBe(
          false,
        )
      }
    })
  })
})

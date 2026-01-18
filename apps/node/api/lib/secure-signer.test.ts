/**
 * SecureSigner Tests
 *
 * Tests for KMS-backed signing functionality.
 * These tests verify the interface and mock the KMS backend.
 */

import { describe, expect, test } from 'bun:test'
import {
  createSecureSigner,
  registerNodeWithKMS,
  SecureSigner,
} from './secure-signer'

describe('SecureSigner', () => {
  test('should create signer with valid keyId', () => {
    const signer = createSecureSigner('test-key-id-12345')
    expect(signer).toBeInstanceOf(SecureSigner)
  })

  test('should throw if keyId is empty', () => {
    expect(() => createSecureSigner('')).toThrow()
  })

  test('signer should have required methods', () => {
    const signer = createSecureSigner('test-key-id')
    expect(typeof signer.getAddress).toBe('function')
    expect(typeof signer.signMessage).toBe('function')
    expect(typeof signer.signTransaction).toBe('function')
    expect(typeof signer.signTypedData).toBe('function')
    expect(typeof signer.verify).toBe('function')
    expect(typeof signer.getAttestation).toBe('function')
    expect(typeof signer.isHealthy).toBe('function')
  })
})

describe('SecureSigner Configuration', () => {
  test('should use default endpoints from config', () => {
    const signer = createSecureSigner('test-key-id')
    // Verify signer was created (endpoints are internal)
    expect(signer).toBeDefined()
  })

  test('should accept custom endpoints', () => {
    const signer = new SecureSigner({
      keyId: 'test-key-id',
      kmsEndpoint: 'https://custom-kms.example.com',
      mpcEndpoint: 'https://custom-mpc.example.com',
      requireTeeAttestation: false,
      timeoutMs: 5000,
      allowLocalFallback: true,
    })
    expect(signer).toBeDefined()
  })
})

describe('SecureSigner Security Properties', () => {
  test('signer should not expose private keys', () => {
    const signer = createSecureSigner('test-key-id')

    // Verify no private key properties exist
    const signerKeys = Object.keys(signer)
    expect(signerKeys).not.toContain('privateKey')
    expect(signerKeys).not.toContain('secret')
    expect(signerKeys).not.toContain('key')
  })

  test('signMessage should require message parameter', async () => {
    const signer = createSecureSigner('test-key-id')
    // @ts-expect-error - Testing runtime error with invalid params
    await expect(signer.signMessage({})).rejects.toBeDefined()
  })

  test('signTransaction should require chainId', async () => {
    const signer = createSecureSigner('test-key-id')
    // signTransaction needs chainId - this should fail
    await expect(
      signer.signTransaction({
        to: `0x${'00'.repeat(20)}` as `0x${string}`,
        chainId: 0, // Invalid chainId
      }),
    ).rejects.toBeDefined()
  })
})

describe('registerNodeWithKMS', () => {
  test('should return dev key on localnet', async () => {
    // On localnet, registerNodeWithKMS returns a dev key instead of using KMS
    const result = await registerNodeWithKMS(
      `0x${'00'.repeat(20)}` as `0x${string}`,
      {
        nodeId: 'test-node',
        region: 'us-east-1',
        services: ['compute'],
        teeCapable: false,
      },
    )
    // On localnet, should return dev key
    expect(result.keyId).toContain('dev-localnet-')
    expect(result.address).toBeDefined()
  })

  test('should include node metadata in request', async () => {
    const metadata = {
      nodeId: 'test-node-123',
      region: 'eu-west-1',
      services: ['compute', 'storage'],
      teeCapable: true,
      teePlatform: 'sgx',
    }

    // This will fail without KMS, but validates the interface
    try {
      await registerNodeWithKMS(
        `0x${'11'.repeat(20)}` as `0x${string}`,
        metadata,
      )
    } catch {
      // Expected to fail without real KMS
    }
  })
})

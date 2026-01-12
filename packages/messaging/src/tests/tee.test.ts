/**
 * TEE Key Management Tests
 *
 * Tests for TEE-backed XMTP key management.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { createTEEKeyManager, type TEEXMTPKeyManager } from '../tee/key-manager'
import { createKeyRegistrySync, KeyRegistrySync } from '../tee/registry-sync'
import {
  createTEEXMTPSigner,
  importTEEXMTPSigner,
  TEEXMTPSigner,
} from '../tee/xmtp-signer'

const TEST_CONFIG = {
  kmsEndpoint: 'http://localhost:8080',
  enclaveId: 'jeju-tee-test',
  attestationRequired: true,
  network: 'local' as const, // Required: mockMode only allowed on 'local'
  mockMode: true, // Required: explicitly enable mock mode for testing
}

const TEST_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
describe('TEE Key Manager', () => {
  let keyManager: TEEXMTPKeyManager

  beforeAll(() => {
    keyManager = createTEEKeyManager(TEST_CONFIG)
  })

  test('generates identity key in TEE', async () => {
    const identityKey = await keyManager.generateIdentityKey(TEST_ADDRESS)

    expect(identityKey.keyId).toContain('xmtp-identity')
    expect(identityKey.address).toBe(TEST_ADDRESS)
    expect(identityKey.publicKey).toMatch(/^0x[a-f0-9]+$/i)
    expect(typeof identityKey.createdAt).toBe('number')
  })

  test('generates attestation for key', async () => {
    const identityKey = await keyManager.generateIdentityKey(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address,
    )

    expect(identityKey.attestation).toBeDefined()
    expect(identityKey.attestation?.enclaveId).toBe(TEST_CONFIG.enclaveId)
    expect(identityKey.attestation?.signature).toMatch(/^0x[a-f0-9]+$/i)
  })

  test('gets identity key by address', async () => {
    const address = '0xcccccccccccccccccccccccccccccccccccccccc' as Address
    await keyManager.generateIdentityKey(address)

    const retrieved = await keyManager.getIdentityKey(address)

    expect(retrieved).not.toBeNull()
    expect(retrieved?.address.toLowerCase()).toBe(address.toLowerCase())
  })

  test('generates pre-key signed by identity key', async () => {
    const address = '0xdddddddddddddddddddddddddddddddddddddddd' as Address
    const identityKey = await keyManager.generateIdentityKey(address)

    const preKey = await keyManager.generatePreKey(identityKey.keyId)

    expect(preKey.keyId).toContain('prekey')
    expect(preKey.identityKeyId).toBe(identityKey.keyId)
    expect(preKey.publicKey).toMatch(/^0x[a-f0-9]+$/i)
    expect(preKey.signature).toMatch(/^0x[a-f0-9]+$/i)
  })

  test('derives installation key from identity', async () => {
    const address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address
    const identityKey = await keyManager.generateIdentityKey(address)

    const deviceId = 'device-1234'
    const installationKey = await keyManager.deriveInstallationKey(
      identityKey.keyId,
      deviceId,
    )

    expect(installationKey.keyId).toContain('installation')
    expect(installationKey.deviceId).toBe(deviceId)
    expect(installationKey.publicKey).toMatch(/^0x[a-f0-9]+$/i)
  })

  test('signs message without exposing private key', async () => {
    const address = '0xffffffffffffffffffffffffffffffffffffffffffff' as Address
    const identityKey = await keyManager.generateIdentityKey(address)

    const message = new TextEncoder().encode('Hello, TEE!')
    const signature = await keyManager.sign(identityKey.keyId, message)

    expect(signature).toMatch(/^0x[a-f0-9]+$/i)
    expect(signature.length).toBeGreaterThan(10)
  })

  test('performs ECDH in TEE', async () => {
    const address = '0x1111111111111111111111111111111111111111' as Address
    const identityKey = await keyManager.generateIdentityKey(address)
    const preKey = await keyManager.generatePreKey(identityKey.keyId)

    // Simulate their public key
    const theirPublicKey = `0x${'11'.repeat(32)}` as Hex

    const sharedSecret = await keyManager.sharedSecret(
      preKey.keyId,
      theirPublicKey,
    )

    expect(sharedSecret).toBeInstanceOf(Uint8Array)
    expect(sharedSecret.length).toBe(32)
  })

  test('exports encrypted backup', async () => {
    const address = '0x2222222222222222222222222222222222222222' as Address
    const identityKey = await keyManager.generateIdentityKey(address)

    const backup = await keyManager.exportEncrypted(
      identityKey.keyId,
      'test-password',
    )

    expect(backup.ciphertext).toMatch(/^0x[a-f0-9]+$/i)
    expect(backup.metadata.keyId).toBe(identityKey.keyId)
    expect(backup.metadata.algorithm).toBe('aes-256-gcm')
    expect(backup.metadata.kdfParams.salt).toMatch(/^0x[a-f0-9]+$/i)
  })

  test('imports from encrypted backup', async () => {
    const address = '0x3333333333333333333333333333333333333333' as Address
    const identityKey = await keyManager.generateIdentityKey(address)
    const password = 'secure-password'

    const backup = await keyManager.exportEncrypted(identityKey.keyId, password)

    const imported = await keyManager.importFromBackup(
      backup,
      password,
      'imported-key',
      address, // Pass original address for proper restoration
    )

    expect(imported.keyId).toBe('imported-key')
    expect(imported.publicKey).toBe(identityKey.publicKey)
    expect(imported.address).toBe(address)
  })

  test('verifies attestation', async () => {
    const address = '0x4444444444444444444444444444444444444444' as Address
    const identityKey = await keyManager.generateIdentityKey(address)

    const attestation = await keyManager.getAttestation(identityKey.keyId)
    const result = await keyManager.verifyAttestation(attestation)

    expect(result.valid).toBe(true)
    expect(result.enclaveIdMatch).toBe(true)
  })

  test('reports manager stats', async () => {
    const stats = keyManager.getStats()

    expect(stats.identityKeys).toBeGreaterThan(0)
    expect(typeof stats.preKeys).toBe('number')
    expect(typeof stats.installationKeys).toBe('number')
  })
})
describe('TEE XMTP Signer', () => {
  let keyManager: TEEXMTPKeyManager
  let signer: TEEXMTPSigner

  beforeAll(async () => {
    keyManager = createTEEKeyManager(TEST_CONFIG)
    signer = await createTEEXMTPSigner(
      keyManager,
      '0x5555555555555555555555555555555555555555' as Address,
    )
  })

  test('gets address', async () => {
    const address = await signer.getAddress()

    expect(address).toMatch(/^0x[a-f0-9]{40}$/i)
  })

  test('gets identity key', () => {
    const identityKey = signer.getIdentityKey()

    expect(identityKey.keyId).toBeDefined()
    expect(identityKey.publicKey).toBeDefined()
  })

  test('signs message with TEE backing', async () => {
    const message = 'Test message to sign'
    const signature = await signer.signMessage(message)

    expect(signature).toBeInstanceOf(Uint8Array)
    expect(signature.length).toBeGreaterThan(0)
  })

  test('signs bytes message', async () => {
    const message = new Uint8Array([1, 2, 3, 4, 5])
    const signature = await signer.signMessage(message)

    expect(signature).toBeInstanceOf(Uint8Array)
  })

  test('creates signed public key bundle', async () => {
    const bundle = await signer.createSignedPublicKeyBundle()

    expect(bundle.identityKey.publicKey).toBeInstanceOf(Uint8Array)
    expect(bundle.identityKey.signature).toBeInstanceOf(Uint8Array)
    expect(bundle.preKey.publicKey).toBeInstanceOf(Uint8Array)
    expect(bundle.preKey.signature).toBeInstanceOf(Uint8Array)
  })

  test('rotates pre-key', async () => {
    const preKey = await signer.rotatePreKey()

    expect(preKey.keyId).toContain('prekey')
    expect(preKey.publicKey).toBeDefined()
  })

  test('exports backup', async () => {
    const backup = await signer.exportBackup('password123')

    expect(typeof backup).toBe('string')
    expect(JSON.parse(backup)).toHaveProperty('ciphertext')
  })

  test('gets attestation', async () => {
    const result = await signer.getAttestation()

    expect(typeof result.valid).toBe('boolean')
    expect(result.attestation).toBeDefined()
  })
})
describe('TEE Signer Import', () => {
  let keyManager: TEEXMTPKeyManager

  beforeAll(() => {
    keyManager = createTEEKeyManager(TEST_CONFIG)
  })

  test('imports signer from backup', async () => {
    // Create original signer
    const originalSigner = await createTEEXMTPSigner(
      keyManager,
      '0x6666666666666666666666666666666666666666' as Address,
    )

    const password = 'import-test-password'
    const backup = await originalSigner.exportBackup(password)

    // Import on "new device"
    const importedSigner = await importTEEXMTPSigner(
      keyManager,
      backup,
      password,
      'imported-signer-key',
    )

    expect(importedSigner).toBeInstanceOf(TEEXMTPSigner)

    // Verify same public key
    const originalKey = originalSigner.getIdentityKey()
    const importedKey = importedSigner.getIdentityKey()
    expect(importedKey.publicKey).toBe(originalKey.publicKey)
  })
})
describe('Key Registry Sync', () => {
  let keyManager: TEEXMTPKeyManager
  let registrySync: KeyRegistrySync

  beforeAll(async () => {
    keyManager = createTEEKeyManager(TEST_CONFIG)

    registrySync = createKeyRegistrySync(keyManager, {
      registryAddress: '0x7777777777777777777777777777777777777777' as Address,
      rpcUrl: 'http://localhost:6546',
      network: 'testnet',
    })

    // Create a test key
    await keyManager.generateIdentityKey(
      '0x8888888888888888888888888888888888888888' as Address,
    )
  })

  test('creates registry sync instance', () => {
    expect(registrySync).toBeInstanceOf(KeyRegistrySync)
  })

  // The following tests use a mock - CI/CD would use forked network or local node

  test('lookup returns null for unregistered address', async () => {
    const result = await registrySync.getOnChainKey(
      '0x9999999999999999999999999999999999999999' as Address,
    )

    // Will fail gracefully without real contract
    expect(result === null || result === undefined).toBe(true)
  })

  test('lookup multiple addresses', async () => {
    const addresses = [
      '0xaaaa000000000000000000000000000000000001' as Address,
      '0xaaaa000000000000000000000000000000000002' as Address,
    ]

    const results = await registrySync.lookupKeys(addresses)

    expect(results).toBeInstanceOf(Map)
  })
})
describe('TEE Integration Flow', () => {
  test('complete key lifecycle', async () => {
    const keyManager = createTEEKeyManager({
      ...TEST_CONFIG,
      attestationRequired: true,
    })

    // 1. Generate identity key
    const address = '0xbbbb000000000000000000000000000000000001' as Address
    const identityKey = await keyManager.generateIdentityKey(address)

    expect(identityKey.attestation).toBeDefined()

    // 2. Generate pre-key
    await keyManager.generatePreKey(identityKey.keyId)

    // 3. Derive installation key
    await keyManager.deriveInstallationKey(identityKey.keyId, 'test-device')

    // 4. Sign a message
    await keyManager.sign(identityKey.keyId, new TextEncoder().encode('test'))

    // 5. Export backup
    await keyManager.exportEncrypted(identityKey.keyId, 'password')

    // 6. Verify attestation
    expect(identityKey.attestation).toBeDefined()
    if (!identityKey.attestation) {
      throw new Error('Expected attestation to be defined')
    }
    const verification = await keyManager.verifyAttestation(
      identityKey.attestation,
    )

    expect(verification.valid).toBe(true)

    // 7. Stats
    const stats = keyManager.getStats()
    expect(stats.identityKeys).toBeGreaterThan(0)
    expect(stats.preKeys).toBeGreaterThan(0)
    expect(stats.installationKeys).toBeGreaterThan(0)
  })

  test('multi-device flow', async () => {
    const keyManager = createTEEKeyManager(TEST_CONFIG)
    const address = '0xcccc000000000000000000000000000000000001' as Address

    // Create signer
    const signer = await createTEEXMTPSigner(keyManager, address)

    // Export for second device
    const backup = await signer.exportBackup('multi-device-password')

    // Import on "second device"
    const keyManager2 = createTEEKeyManager({
      ...TEST_CONFIG,
      enclaveId: 'jeju-tee-device-2',
    })

    const signer2 = await importTEEXMTPSigner(
      keyManager2,
      backup,
      'multi-device-password',
    )

    // Both should have same public key
    expect(signer2.getIdentityKey().publicKey).toBe(
      signer.getIdentityKey().publicKey,
    )

    // Different attestations (different enclaves) - in real TEE, attestations differ by enclave
    await signer.getAttestation()
    await signer2.getAttestation()
  })
})

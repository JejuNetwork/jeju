/**
 * Tests for credential vault encryption/decryption
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import {
  type CredentialVault,
  getCredentialVault,
} from '../../api/compute/credential-vault'

describe('CredentialVault', () => {
  const testOwner = '0x1234567890123456789012345678901234567890' as Address
  let vault: CredentialVault
  let originalVaultKey: string | undefined

  beforeAll(() => {
    // Save original env
    originalVaultKey = process.env.DWS_VAULT_KEY
    // Set a test vault key
    process.env.DWS_VAULT_KEY = 'test-vault-key-32-characters-long'
    vault = getCredentialVault()
  })

  afterAll(() => {
    // Restore original env
    if (originalVaultKey) {
      process.env.DWS_VAULT_KEY = originalVaultKey
    } else {
      delete process.env.DWS_VAULT_KEY
    }
  })

  test('should store and retrieve credential', async () => {
    const credentialId = await vault.storeCredential(testOwner, {
      provider: 'hetzner',
      name: 'Test Hetzner',
      apiKey: 'test-api-key-12345',
      skipVerification: true, // Skip API verification for testing
    })

    expect(credentialId).toStartWith('cred-')

    // Retrieve the credential
    const decrypted = await vault.getDecryptedCredential(
      credentialId,
      testOwner,
    )
    expect(decrypted).not.toBeNull()
    expect(decrypted?.apiKey).toBe('test-api-key-12345')
  })

  test('should not return credential to wrong owner', async () => {
    const credentialId = await vault.storeCredential(testOwner, {
      provider: 'digitalocean',
      name: 'Test DO',
      apiKey: 'secret-key',
      skipVerification: true,
    })

    const wrongOwner = '0x0000000000000000000000000000000000000001' as Address
    const result = await vault.getDecryptedCredential(credentialId, wrongOwner)
    expect(result).toBeNull()
  })

  test('should list credentials without exposing secrets', async () => {
    // Ensure we have at least one credential
    await vault.storeCredential(testOwner, {
      provider: 'hetzner',
      name: 'Test for listing',
      apiKey: 'list-test-key',
      skipVerification: true,
    })

    const list = vault.listCredentials(testOwner)

    // Should have credentials
    expect(list.length).toBeGreaterThan(0)

    // Should not expose encrypted fields
    for (const cred of list) {
      expect(cred).not.toHaveProperty('encryptedApiKey')
      expect(cred).not.toHaveProperty('encryptedApiSecret')
      expect(cred).not.toHaveProperty('encryptedProjectId')
    }
  })

  test('should revoke credential', async () => {
    const credentialId = await vault.storeCredential(testOwner, {
      provider: 'vultr',
      name: 'Test Vultr',
      apiKey: 'vultr-key',
      skipVerification: true,
    })

    const revoked = await vault.revokeCredential(credentialId, testOwner)
    expect(revoked).toBe(true)

    // Should not be retrievable after revocation
    const result = await vault.getDecryptedCredential(credentialId, testOwner)
    expect(result).toBeNull()
  })

  test('should encrypt with different IVs each time', async () => {
    // Store same credential twice
    const id1 = await vault.storeCredential(testOwner, {
      provider: 'linode',
      name: 'Test 1',
      apiKey: 'same-key',
      skipVerification: true,
    })

    const id2 = await vault.storeCredential(testOwner, {
      provider: 'linode',
      name: 'Test 2',
      apiKey: 'same-key',
      skipVerification: true,
    })

    // Both should decrypt to same value
    const dec1 = await vault.getDecryptedCredential(id1, testOwner)
    const dec2 = await vault.getDecryptedCredential(id2, testOwner)

    expect(dec1?.apiKey).toBe('same-key')
    expect(dec2?.apiKey).toBe('same-key')

    // But IDs should be different (different encrypted values due to random IV)
    expect(id1).not.toBe(id2)
  })
})

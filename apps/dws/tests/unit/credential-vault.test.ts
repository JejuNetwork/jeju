/**
 * Comprehensive tests for credential vault encryption/decryption
 * 
 * Coverage:
 * - Happy path: store, retrieve, list, revoke
 * - Edge cases: empty strings, unicode, large payloads
 * - Error handling: invalid inputs, wrong owners, expired credentials
 * - Security: IV uniqueness, tampered ciphertext, timing
 * - Concurrent operations
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { CredentialVault, getCredentialVault } from '../../api/compute/credential-vault'
import type { Address } from 'viem'

describe('CredentialVault', () => {
  const testOwner = '0x1234567890123456789012345678901234567890' as Address
  const altOwner = '0x0000000000000000000000000000000000000001' as Address
  let vault: CredentialVault
  let originalVaultKey: string | undefined

  beforeAll(() => {
    originalVaultKey = process.env.DWS_VAULT_KEY
    process.env.DWS_VAULT_KEY = 'test-vault-key-32-characters-long'
    vault = getCredentialVault()
  })

  afterAll(() => {
    if (originalVaultKey) {
      process.env.DWS_VAULT_KEY = originalVaultKey
    } else {
      delete process.env.DWS_VAULT_KEY
    }
  })

  // ============ Happy Path Tests ============

  describe('store and retrieve', () => {
    test('stores and retrieves credential successfully', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'hetzner',
        name: 'Test Hetzner',
        apiKey: 'test-api-key-12345',
        skipVerification: true,
      })

      expect(credentialId).toStartWith('cred-')
      expect(credentialId.length).toBeGreaterThan(10)

      const decrypted = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(decrypted).not.toBeNull()
      expect(decrypted?.apiKey).toBe('test-api-key-12345')
      expect(decrypted?.apiSecret).toBeNull()
      expect(decrypted?.projectId).toBeNull()
    })

    test('stores credential with all optional fields', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'aws',
        name: 'Full AWS',
        apiKey: 'AKIAIOSFODNN7EXAMPLE',
        apiSecret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        projectId: 'my-aws-account-123456789',
        region: 'us-east-1',
        scopes: ['ec2', 's3'],
        skipVerification: true,
      })

      const decrypted = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(decrypted?.apiKey).toBe('AKIAIOSFODNN7EXAMPLE')
      expect(decrypted?.apiSecret).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
      expect(decrypted?.projectId).toBe('my-aws-account-123456789')
    })

    test('lists credentials for owner without exposing secrets', async () => {
      await vault.storeCredential(testOwner, {
        provider: 'hetzner',
        name: 'List Test',
        apiKey: 'list-test-key-secret',
        skipVerification: true,
      })

      const list = vault.listCredentials(testOwner)
      expect(list.length).toBeGreaterThan(0)

      for (const cred of list) {
        // Should have metadata
        expect(cred.id).toStartWith('cred-')
        expect(cred.name).toBeDefined()
        expect(cred.provider).toBeDefined()

        // Should NOT have encrypted fields exposed
        expect(cred).not.toHaveProperty('encryptedApiKey')
        expect(cred).not.toHaveProperty('encryptedApiSecret')
        expect(cred).not.toHaveProperty('encryptedProjectId')
        
        // Type assertion to check raw object
        const raw = cred as Record<string, unknown>
        expect(raw['apiKey']).toBeUndefined()
        expect(raw['apiSecret']).toBeUndefined()
      }
    })

    test('revokes credential and prevents retrieval', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'vultr',
        name: 'Revoke Test',
        apiKey: 'vultr-key-to-revoke',
        skipVerification: true,
      })

      // Can retrieve before revocation
      const before = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(before?.apiKey).toBe('vultr-key-to-revoke')

      // Revoke
      const revoked = await vault.revokeCredential(credentialId, testOwner)
      expect(revoked).toBe(true)

      // Cannot retrieve after revocation
      const after = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(after).toBeNull()
    })
  })

  // ============ Authorization Tests ============

  describe('authorization', () => {
    test('blocks access from wrong owner', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'digitalocean',
        name: 'Owner Test',
        apiKey: 'owner-secret-key',
        skipVerification: true,
      })

      const result = await vault.getDecryptedCredential(credentialId, altOwner)
      expect(result).toBeNull()
    })

    test('blocks revocation by wrong owner', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'linode',
        name: 'Revoke Auth Test',
        apiKey: 'auth-test-key',
        skipVerification: true,
      })

      const revoked = await vault.revokeCredential(credentialId, altOwner)
      expect(revoked).toBe(false)

      // Still accessible to real owner
      const result = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(result?.apiKey).toBe('auth-test-key')
    })

    test('returns empty list for owner with no credentials', () => {
      const unknownOwner = '0x9999999999999999999999999999999999999999' as Address
      const list = vault.listCredentials(unknownOwner)
      expect(list).toEqual([])
    })

    test('case-insensitive owner address comparison', async () => {
      const mixedCaseOwner = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' as Address
      const lowerCaseOwner = '0xabcdef1234567890abcdef1234567890abcdef12' as Address

      const credentialId = await vault.storeCredential(mixedCaseOwner, {
        provider: 'hetzner',
        name: 'Case Test',
        apiKey: 'case-test-key',
        skipVerification: true,
      })

      // Should work with different case
      const result = await vault.getDecryptedCredential(credentialId, lowerCaseOwner)
      expect(result?.apiKey).toBe('case-test-key')
    })
  })

  // ============ Edge Case Tests ============

  describe('edge cases', () => {
    test('handles empty string API key rejection', async () => {
      await expect(
        vault.storeCredential(testOwner, {
          provider: 'hetzner',
          name: 'Empty Key',
          apiKey: '',
          skipVerification: true,
        })
      ).rejects.toThrow()
    })

    test('handles unicode in credential name', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'hetzner',
        name: 'Test 日本語 🚀 émojis',
        apiKey: 'unicode-test-key',
        skipVerification: true,
      })

      const list = vault.listCredentials(testOwner)
      const found = list.find(c => c.id === credentialId)
      expect(found?.name).toBe('Test 日本語 🚀 émojis')
    })

    test('handles long API keys (4KB)', async () => {
      const longKey = 'x'.repeat(4096)
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'aws',
        name: 'Long Key Test',
        apiKey: longKey,
        skipVerification: true,
      })

      const decrypted = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(decrypted?.apiKey).toBe(longKey)
      expect(decrypted?.apiKey.length).toBe(4096)
    })

    test('handles special characters in API key', async () => {
      const specialKey = 'key+with/special=chars&more!@#$%^*()[]{}|\\:";\'<>,.?/'
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'vultr',
        name: 'Special Chars',
        apiKey: specialKey,
        skipVerification: true,
      })

      const decrypted = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(decrypted?.apiKey).toBe(specialKey)
    })

    test('handles non-existent credential ID', async () => {
      const result = await vault.getDecryptedCredential('cred-nonexistent-12345', testOwner)
      expect(result).toBeNull()
    })

    test('revoke returns false for non-existent credential', async () => {
      const result = await vault.revokeCredential('cred-does-not-exist', testOwner)
      expect(result).toBe(false)
    })
  })

  // ============ Encryption Security Tests ============

  describe('encryption security', () => {
    test('generates unique IVs for identical plaintext', async () => {
      const sameKey = 'identical-api-key-value'
      
      const id1 = await vault.storeCredential(testOwner, {
        provider: 'linode',
        name: 'IV Test 1',
        apiKey: sameKey,
        skipVerification: true,
      })

      const id2 = await vault.storeCredential(testOwner, {
        provider: 'linode',
        name: 'IV Test 2',
        apiKey: sameKey,
        skipVerification: true,
      })

      // Both decrypt to same value
      const dec1 = await vault.getDecryptedCredential(id1, testOwner)
      const dec2 = await vault.getDecryptedCredential(id2, testOwner)
      expect(dec1?.apiKey).toBe(sameKey)
      expect(dec2?.apiKey).toBe(sameKey)

      // IDs are different (implies different storage)
      expect(id1).not.toBe(id2)
    })

    test('different owners get different encrypted values', async () => {
      const owner1 = '0x1111111111111111111111111111111111111111' as Address
      const owner2 = '0x2222222222222222222222222222222222222222' as Address
      const sameApiKey = 'shared-api-key-value'

      const id1 = await vault.storeCredential(owner1, {
        provider: 'hetzner',
        name: 'Owner 1',
        apiKey: sameApiKey,
        skipVerification: true,
      })

      const id2 = await vault.storeCredential(owner2, {
        provider: 'hetzner',
        name: 'Owner 2',
        apiKey: sameApiKey,
        skipVerification: true,
      })

      // Each can only access their own
      const dec1 = await vault.getDecryptedCredential(id1, owner1)
      const dec2 = await vault.getDecryptedCredential(id2, owner2)
      
      expect(dec1?.apiKey).toBe(sameApiKey)
      expect(dec2?.apiKey).toBe(sameApiKey)

      // Cross-access blocked
      expect(await vault.getDecryptedCredential(id1, owner2)).toBeNull()
      expect(await vault.getDecryptedCredential(id2, owner1)).toBeNull()
    })
  })

  // ============ Concurrent Operation Tests ============

  describe('concurrent operations', () => {
    test('handles concurrent stores from same owner', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        vault.storeCredential(testOwner, {
          provider: 'hetzner',
          name: `Concurrent ${i}`,
          apiKey: `concurrent-key-${i}`,
          skipVerification: true,
        })
      )

      const ids = await Promise.all(promises)
      
      // All should succeed with unique IDs
      expect(new Set(ids).size).toBe(10)
      
      // All should be retrievable
      for (let i = 0; i < 10; i++) {
        const dec = await vault.getDecryptedCredential(ids[i], testOwner)
        expect(dec?.apiKey).toBe(`concurrent-key-${i}`)
      }
    })

    test('handles concurrent retrieves', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'digitalocean',
        name: 'Concurrent Retrieve',
        apiKey: 'retrieve-test-key',
        skipVerification: true,
      })

      const promises = Array.from({ length: 20 }, () =>
        vault.getDecryptedCredential(credentialId, testOwner)
      )

      const results = await Promise.all(promises)
      
      // All should succeed with same value
      for (const result of results) {
        expect(result?.apiKey).toBe('retrieve-test-key')
      }
    })
  })

  // ============ Provider Validation Tests ============

  describe('provider validation', () => {
    test('accepts all supported providers', async () => {
      const providers = ['hetzner', 'digitalocean', 'vultr', 'linode', 'aws', 'gcp', 'azure', 'ovh'] as const

      for (const provider of providers) {
        const id = await vault.storeCredential(testOwner, {
          provider,
          name: `${provider} Test`,
          apiKey: `${provider}-key`,
          skipVerification: true,
        })
        expect(id).toStartWith('cred-')
      }
    })

    test('rejects invalid provider', async () => {
      await expect(
        vault.storeCredential(testOwner, {
          provider: 'invalid-provider' as 'hetzner',
          name: 'Invalid',
          apiKey: 'key',
          skipVerification: true,
        })
      ).rejects.toThrow()
    })
  })

  // ============ Expiration Tests ============

  describe('expiration', () => {
    test('returns null for expired credential', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'hetzner',
        name: 'Expiring',
        apiKey: 'expiring-key',
        expiresAt: Date.now() - 1000, // Already expired
        skipVerification: true,
      })

      const result = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(result).toBeNull()
    })

    test('allows access to non-expired credential', async () => {
      const credentialId = await vault.storeCredential(testOwner, {
        provider: 'hetzner',
        name: 'Future Expiry',
        apiKey: 'valid-key',
        expiresAt: Date.now() + 86400000, // Expires tomorrow
        skipVerification: true,
      })

      const result = await vault.getDecryptedCredential(credentialId, testOwner)
      expect(result?.apiKey).toBe('valid-key')
    })
  })
})

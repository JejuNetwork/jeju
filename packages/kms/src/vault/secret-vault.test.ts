/**
 * SecretVault Comprehensive Tests
 *
 * Tests for secure secret storage, access control, rotation, and audit logging.
 *
 * SECURITY NOTE: The test secret below is intentionally weak and should NEVER
 * be used in production. It is only used for deterministic test execution.
 */

// SECURITY: Test-only secret - do not use in production
process.env.VAULT_ENCRYPTION_SECRET = 'test-vault-secret-key'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Address } from 'viem'
import { getSecretVault, resetSecretVault, SecretVault } from './secret-vault'

describe('SecretVault', () => {
  let vault: SecretVault
  const owner: Address = '0x1111111111111111111111111111111111111111'
  const otherUser: Address = '0x2222222222222222222222222222222222222222'

  beforeEach(async () => {
    resetSecretVault()
    vault = new SecretVault({ auditLogging: true })
    await vault.initialize()
  })

  afterEach(() => {
    resetSecretVault()
  })

  describe('Initialization', () => {
    it('should initialize only once', async () => {
      const v = new SecretVault()
      await v.initialize()
      await v.initialize()
      await v.initialize()
      expect(v.getStatus().initialized).toBe(true)
    })

    it('should return singleton from getSecretVault', () => {
      resetSecretVault()
      const v1 = getSecretVault()
      const v2 = getSecretVault()
      expect(v1).toBe(v2)
    })
  })

  describe('Secret Storage', () => {
    it('should store and retrieve a secret', async () => {
      const secret = await vault.storeSecret('api-key', 'sk-test-12345', owner)

      expect(secret.id).toBeDefined()
      expect(secret.name).toBe('api-key')
      expect(secret.encryptedValue).not.toBe('sk-test-12345') // Should be encrypted
      expect(secret.version).toBe(1)

      const retrieved = await vault.getSecret(secret.id, owner)
      expect(retrieved).toBe('sk-test-12345')
    })

    it('should store secret with tags and metadata', async () => {
      const secret = await vault.storeSecret(
        'database-password',
        'super-secret-password',
        owner,
        undefined,
        ['production', 'database'],
        { environment: 'prod', service: 'postgres' },
      )

      expect(secret.tags).toEqual(['production', 'database'])
      expect(secret.metadata.environment).toBe('prod')
      expect(secret.metadata.service).toBe('postgres')
    })

    it('should handle empty secret value', async () => {
      const secret = await vault.storeSecret('empty-secret', '', owner)
      const retrieved = await vault.getSecret(secret.id, owner)
      expect(retrieved).toBe('')
    })

    it('should handle very long secret values', async () => {
      const longValue = 'x'.repeat(100000) // 100KB
      const secret = await vault.storeSecret('long-secret', longValue, owner)
      const retrieved = await vault.getSecret(secret.id, owner)
      expect(retrieved).toBe(longValue)
      expect(retrieved.length).toBe(100000)
    })

    it('should handle unicode in secret values', async () => {
      const unicodeValue = 'パスワード 🔐 مرور'
      const secret = await vault.storeSecret(
        'unicode-secret',
        unicodeValue,
        owner,
      )
      const retrieved = await vault.getSecret(secret.id, owner)
      expect(retrieved).toBe(unicodeValue)
    })

    it('should handle JSON in secret values', async () => {
      const jsonValue = JSON.stringify({
        key: 'value',
        nested: { array: [1, 2, 3] },
      })
      const secret = await vault.storeSecret('json-secret', jsonValue, owner)
      const retrieved = await vault.getSecret(secret.id, owner)
      expect(JSON.parse(retrieved)).toEqual(JSON.parse(jsonValue))
    })
  })

  describe('Access Control', () => {
    it('should deny access to non-owner with restrictive policy', async () => {
      const secret = await vault.storeSecret(
        'private-secret',
        'value',
        owner,
        { allowedAddresses: [owner] }, // Only owner allowed
      )

      await expect(vault.getSecret(secret.id, otherUser)).rejects.toThrow(
        'Access denied',
      )
    })

    it('should allow access to users on allowlist', async () => {
      const secret = await vault.storeSecret(
        'shared-secret',
        'shared-value',
        owner,
        { allowedAddresses: [otherUser] },
      )

      const retrieved = await vault.getSecret(secret.id, otherUser)
      expect(retrieved).toBe('shared-value')
    })

    it('should allow owner access without policy', async () => {
      const secret = await vault.storeSecret('owner-access', 'value', owner)
      const retrieved = await vault.getSecret(secret.id, owner)
      expect(retrieved).toBe('value')
    })

    it('should deny access after expiration', async () => {
      const pastTime = Date.now() - 1000 // 1 second ago
      const secret = await vault.storeSecret('expired-secret', 'value', owner, {
        expiresAt: pastTime,
        allowedAddresses: [owner],
      })

      await expect(vault.getSecret(secret.id, owner)).rejects.toThrow(
        'Access denied',
      )
    })

    it('should enforce max access count', async () => {
      const secret = await vault.storeSecret('limited-access', 'value', owner, {
        maxAccessCount: 2,
        allowedAddresses: [otherUser],
      })

      // First two accesses should succeed
      await vault.getSecret(secret.id, otherUser)
      await vault.getSecret(secret.id, otherUser)

      // Third should fail
      await expect(vault.getSecret(secret.id, otherUser)).rejects.toThrow(
        'Access denied',
      )
    })
  })

  describe('Secret Rotation', () => {
    it('should rotate secret while preserving ID', async () => {
      const secret = await vault.storeSecret('rotate-me', 'old-value', owner)

      const rotated = await vault.rotateSecret(secret.id, 'new-value', owner)

      expect(rotated.id).toBe(secret.id)
      expect(rotated.version).toBe(2)

      const retrieved = await vault.getSecret(secret.id, owner)
      expect(retrieved).toBe('new-value')
    })

    it('should deny rotation by non-owner', async () => {
      const secret = await vault.storeSecret('no-rotate', 'value', owner)

      await expect(
        vault.rotateSecret(secret.id, 'new', otherUser),
      ).rejects.toThrow('Only secret owner can rotate')
    })

    it('should reject rotation of non-existent secret', async () => {
      await expect(
        vault.rotateSecret('non-existent', 'value', owner),
      ).rejects.toThrow('not found')
    })

    it('should track rotation history', async () => {
      const secret = await vault.storeSecret('history-secret', 'v1', owner)
      await vault.rotateSecret(secret.id, 'v2', owner)
      await vault.rotateSecret(secret.id, 'v3', owner)

      // Get historical versions
      const v1 = await vault.getSecretVersion(secret.id, 1, owner)
      const v2 = await vault.getSecretVersion(secret.id, 2, owner)
      const v3 = await vault.getSecretVersion(secret.id, 3, owner)

      expect(v1).toBe('v1')
      expect(v2).toBe('v2')
      expect(v3).toBe('v3')
    })
  })

  describe('Secret Revocation', () => {
    it('should revoke secret and deny all access', async () => {
      const secret = await vault.storeSecret('revoke-me', 'value', owner)

      await vault.revokeSecret(secret.id, owner)

      await expect(vault.getSecret(secret.id, owner)).rejects.toThrow(
        'not found',
      )
    })

    it('should deny revocation by non-owner', async () => {
      const secret = await vault.storeSecret('no-revoke', 'value', owner)

      await expect(vault.revokeSecret(secret.id, otherUser)).rejects.toThrow(
        'Only secret owner can revoke',
      )
    })

    it('should mark all versions as revoked', async () => {
      const secret = await vault.storeSecret('multi-version', 'v1', owner)
      await vault.rotateSecret(secret.id, 'v2', owner)

      await vault.revokeSecret(secret.id, owner)

      await expect(vault.getSecretVersion(secret.id, 1, owner)).rejects.toThrow(
        'revoked',
      )
    })
  })

  describe('Secret Injection', () => {
    it('should inject secrets into environment mapping', async () => {
      const s1 = await vault.storeSecret('db-password', 'secret-db-pass', owner)
      const s2 = await vault.storeSecret('api-key', 'secret-api-key', owner)

      const env = await vault.injectSecrets(
        [s1.id, s2.id],
        { [s1.id]: 'DATABASE_PASSWORD', [s2.id]: 'API_KEY' },
        owner,
      )

      expect(env.DATABASE_PASSWORD).toBe('secret-db-pass')
      expect(env.API_KEY).toBe('secret-api-key')
    })

    it('should skip secrets without mapping', async () => {
      const s1 = await vault.storeSecret('mapped', 'value1', owner)
      const s2 = await vault.storeSecret('unmapped', 'value2', owner)

      const env = await vault.injectSecrets(
        [s1.id, s2.id],
        { [s1.id]: 'MAPPED_SECRET' }, // s2 has no mapping
        owner,
      )

      expect(env.MAPPED_SECRET).toBe('value1')
      expect(Object.keys(env).length).toBe(1)
    })

    it('should fail injection if any secret access is denied', async () => {
      const s1 = await vault.storeSecret('accessible', 'value1', owner, {
        allowedAddresses: [otherUser],
      })
      const s2 = await vault.storeSecret('private', 'value2', owner, {
        allowedAddresses: [owner],
      }) // Restricted

      await expect(
        vault.injectSecrets(
          [s1.id, s2.id],
          { [s1.id]: 'SECRET1', [s2.id]: 'SECRET2' },
          otherUser,
        ),
      ).rejects.toThrow('Access denied')
    })
  })

  describe('Secret Listing', () => {
    it('should list secrets owned by address', async () => {
      await vault.storeSecret('owner-secret-1', 'v1', owner)
      await vault.storeSecret('owner-secret-2', 'v2', owner)
      await vault.storeSecret('other-secret', 'v3', otherUser)

      const ownerSecrets = vault.listSecrets(owner)
      expect(ownerSecrets.length).toBe(2)
      expect(ownerSecrets.every((s) => s.encryptedValue === '[REDACTED]')).toBe(
        true,
      )
    })

    it('should include secrets accessible via allowlist', async () => {
      await vault.storeSecret('private-to-owner', 'v1', owner)
      await vault.storeSecret('shared-with-other', 'v2', owner, {
        allowedAddresses: [otherUser],
      })

      const otherSecrets = vault.listSecrets(otherUser)
      expect(otherSecrets.length).toBe(1)
      expect(otherSecrets[0].name).toBe('shared-with-other')
    })
  })

  describe('Audit Logging', () => {
    it('should log successful reads', async () => {
      const secret = await vault.storeSecret('audited', 'value', owner)
      await vault.getSecret(secret.id, owner)

      const logs = vault.getAuditLogs(secret.id)
      expect(logs.some((l) => l.action === 'read' && l.success)).toBe(true)
    })

    it('should log failed access attempts', async () => {
      const secret = await vault.storeSecret('audited', 'value', owner, {
        allowedAddresses: [owner],
      })

      try {
        await vault.getSecret(secret.id, otherUser)
      } catch {
        /* expected - access denied */
      }

      const logs = vault.getAuditLogs(secret.id)
      expect(logs.some((l) => l.action === 'read' && !l.success)).toBe(true)
    })

    it('should log rotations', async () => {
      const secret = await vault.storeSecret('audit-rotate', 'v1', owner)
      await vault.rotateSecret(secret.id, 'v2', owner)

      const logs = vault.getAuditLogs(secret.id)
      expect(logs.some((l) => l.action === 'rotate' && l.success)).toBe(true)
    })

    it('should log revocations', async () => {
      const secret = await vault.storeSecret('audit-revoke', 'value', owner)
      await vault.revokeSecret(secret.id, owner)

      const logs = vault.getAuditLogs(secret.id)
      expect(logs.some((l) => l.action === 'revoke' && l.success)).toBe(true)
    })

    it('should limit audit log retrieval', async () => {
      const secret = await vault.storeSecret('many-accesses', 'value', owner)

      for (let i = 0; i < 150; i++) {
        await vault.getSecret(secret.id, owner)
      }

      const logs = vault.getAuditLogs(secret.id, 50)
      expect(logs.length).toBeLessThanOrEqual(50)
    })

    it('should disable logging when auditLogging is false', async () => {
      const noAuditVault = new SecretVault({ auditLogging: false })
      await noAuditVault.initialize()

      const secret = await noAuditVault.storeSecret('no-audit', 'value', owner)
      await noAuditVault.getSecret(secret.id, owner)

      const logs = noAuditVault.getAuditLogs(secret.id)
      expect(logs.length).toBe(0)
    })
  })

  describe('Policy Management', () => {
    it('should update policy', async () => {
      const secret = await vault.storeSecret('policy-test', 'value', owner)

      vault.updatePolicy(secret.id, { allowedAddresses: [otherUser] }, owner)

      const retrieved = await vault.getSecret(secret.id, otherUser)
      expect(retrieved).toBe('value')
    })

    it('should deny policy update by non-owner', async () => {
      const secret = await vault.storeSecret('no-policy', 'value', owner)
      expect(() => vault.updatePolicy(secret.id, {}, otherUser)).toThrow(
        'Only owner',
      )
    })
  })

  describe('Status Reporting', () => {
    it('should report correct status', async () => {
      expect(vault.getStatus().initialized).toBe(true)
      expect(vault.getStatus().secretCount).toBe(0)

      await vault.storeSecret('s1', 'v1', owner)
      await vault.storeSecret('s2', 'v2', owner)

      expect(vault.getStatus().secretCount).toBe(2)
    })

    it('should track audit log count', async () => {
      const secret = await vault.storeSecret('log-count', 'value', owner)

      for (let i = 0; i < 5; i++) {
        await vault.getSecret(secret.id, owner)
      }

      expect(vault.getStatus().auditLogCount).toBeGreaterThanOrEqual(6) // 1 write + 5 reads
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent secret storage', async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        vault.storeSecret(`concurrent-${i}`, `value-${i}`, owner),
      )

      const secrets = await Promise.all(promises)

      expect(secrets.length).toBe(20)
      const ids = new Set(secrets.map((s) => s.id))
      expect(ids.size).toBe(20) // All unique IDs
    })

    it('should handle concurrent reads safely', async () => {
      const secret = await vault.storeSecret('concurrent-read', 'value', owner)

      const promises = Array.from({ length: 50 }, () =>
        vault.getSecret(secret.id, owner),
      )

      const results = await Promise.all(promises)
      expect(results.every((r) => r === 'value')).toBe(true)
    })
  })
})

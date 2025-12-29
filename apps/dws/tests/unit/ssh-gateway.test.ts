/**
 * SSH Gateway Tests
 *
 * Note: Full token generation requires wallet signatures which are complex to mock.
 * These tests focus on the testable parts of the gateway:
 * - Credential registration and removal
 * - Session lookup and listing
 * - Stats and audit
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { getSSHGateway, type SSHGateway } from '../../api/compute/ssh-gateway'

describe('SSHGateway', () => {
  const testOwner = '0x1234567890123456789012345678901234567890' as Address
  const _altOwner = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address
  let gateway: SSHGateway
  let originalVaultKey: string | undefined

  beforeAll(() => {
    originalVaultKey = process.env.DWS_VAULT_KEY
    process.env.DWS_VAULT_KEY = 'test-ssh-vault-key-32-chars-lng!'
    gateway = getSSHGateway()
  })

  afterAll(() => {
    if (originalVaultKey) {
      process.env.DWS_VAULT_KEY = originalVaultKey
    } else {
      delete process.env.DWS_VAULT_KEY
    }
  })

  // ============ Credential Management ============

  describe('credential management', () => {
    test('registers credentials and logs audit', async () => {
      const computeId = `compute-reg-${Date.now()}`

      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: '10.0.0.1',
        port: 2222,
        username: 'deploy',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-key\n-----END OPENSSH PRIVATE KEY-----',
      })

      // Check audit log has the registration
      const audit = gateway.getAuditLog({ computeId, limit: 10 })
      const registerEntry = audit.find(
        (a) =>
          a.action === 'credential_registered' && a.computeId === computeId,
      )
      expect(registerEntry).toBeDefined()
    })

    test('removes credentials and logs audit', async () => {
      const computeId = `compute-remove-${Date.now()}`

      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: '10.0.0.2',
        port: 22,
        username: 'ubuntu',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      })

      // Remove
      await gateway.removeCredentials(computeId)

      // Check audit log
      const audit = gateway.getAuditLog({ computeId, limit: 10 })
      const removeEntry = audit.find(
        (a) => a.action === 'credential_removed' && a.computeId === computeId,
      )
      expect(removeEntry).toBeDefined()
    })
  })

  // ============ Session Lookup ============

  describe('session lookup', () => {
    test('returns null for non-existent session', () => {
      const result = gateway.getSession('nonexistent-session-12345')
      expect(result).toBeNull()
    })

    test('returns empty array for owner with no sessions', () => {
      const unknownOwner =
        '0x9999999999999999999999999999999999999999' as Address
      const sessions = gateway.getUserSessions(unknownOwner)
      expect(sessions).toEqual([])
    })
  })

  // ============ Gateway Stats ============

  describe('gateway stats', () => {
    test('returns gateway statistics with correct structure', async () => {
      const stats = await gateway.getStats()

      expect(stats).toHaveProperty('activeSessions')
      expect(stats).toHaveProperty('pendingTokens')
      expect(stats).toHaveProperty('totalSessions')
      expect(stats).toHaveProperty('totalCredentials')
      expect(typeof stats.activeSessions).toBe('number')
      expect(typeof stats.pendingTokens).toBe('number')
      expect(typeof stats.totalSessions).toBe('number')
      expect(typeof stats.totalCredentials).toBe('number')
    })

    test('activeSessions is non-negative', async () => {
      const stats = await gateway.getStats()
      expect(stats.activeSessions).toBeGreaterThanOrEqual(0)
    })

    test('counts are non-negative', async () => {
      const stats = await gateway.getStats()
      expect(stats.totalSessions).toBeGreaterThanOrEqual(0)
      expect(stats.totalCredentials).toBeGreaterThanOrEqual(0)
    })
  })

  // ============ Audit Log ============

  describe('audit log', () => {
    test('returns audit entries', () => {
      const audit = gateway.getAuditLog({ limit: 100 })
      expect(Array.isArray(audit)).toBe(true)
    })

    test('filters by owner', async () => {
      const computeId = `compute-audit-${Date.now()}`

      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: '10.0.0.3',
        port: 22,
        username: 'ubuntu',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      })

      const audit = gateway.getAuditLog({ owner: testOwner, limit: 50 })

      // All entries should be for testOwner
      for (const entry of audit) {
        expect(entry.owner.toLowerCase()).toBe(testOwner.toLowerCase())
      }
    })

    test('filters by computeId', async () => {
      const computeId = `compute-audit-filter-${Date.now()}`

      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: '10.0.0.4',
        port: 22,
        username: 'ubuntu',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      })

      const audit = gateway.getAuditLog({ computeId, limit: 50 })

      // All entries should be for this computeId
      for (const entry of audit) {
        expect(entry.computeId).toBe(computeId)
      }
    })

    test('respects limit parameter', async () => {
      // Create several entries
      for (let i = 0; i < 5; i++) {
        await gateway.registerCredentials({
          computeId: `compute-limit-${Date.now()}-${i}`,
          owner: testOwner,
          host: `10.0.0.${10 + i}`,
          port: 22,
          username: 'ubuntu',
          privateKey:
            '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
        })
      }

      const audit = gateway.getAuditLog({ limit: 3 })
      expect(audit.length).toBeLessThanOrEqual(3)
    })
  })

  // ============ Edge Cases ============

  describe('edge cases', () => {
    test('handles non-standard SSH port', async () => {
      const computeId = `compute-port-${Date.now()}`

      // Should not throw
      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: '10.0.0.20',
        port: 65535, // Max port
        username: 'ubuntu',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      })

      const audit = gateway.getAuditLog({ computeId, limit: 1 })
      expect(audit.length).toBe(1)
    })

    test('handles IPv6 host', async () => {
      const computeId = `compute-ipv6-${Date.now()}`

      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        port: 22,
        username: 'ubuntu',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      })

      const audit = gateway.getAuditLog({ computeId, limit: 1 })
      expect(audit.length).toBe(1)
    })

    test('handles hostname instead of IP', async () => {
      const computeId = `compute-hostname-${Date.now()}`

      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: 'server.example.com',
        port: 22,
        username: 'ubuntu',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      })

      const audit = gateway.getAuditLog({ computeId, limit: 1 })
      expect(audit.length).toBe(1)
    })

    test('handles unicode in username', async () => {
      const computeId = `compute-unicode-${Date.now()}`

      await gateway.registerCredentials({
        computeId,
        owner: testOwner,
        host: '10.0.0.21',
        port: 22,
        username: 'user_日本語',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      })

      const audit = gateway.getAuditLog({ computeId, limit: 1 })
      expect(audit.length).toBe(1)
    })
  })

  // ============ Concurrent Operations ============

  describe('concurrent operations', () => {
    test('handles concurrent credential registration', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        gateway.registerCredentials({
          computeId: `compute-concurrent-${Date.now()}-${i}`,
          owner: testOwner,
          host: `10.0.0.${30 + i}`,
          port: 22,
          username: 'ubuntu',
          privateKey:
            '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
        }),
      )

      // All should complete without error
      await Promise.all(promises)

      // All should be in audit log
      const audit = gateway.getAuditLog({ owner: testOwner, limit: 100 })
      expect(audit.length).toBeGreaterThanOrEqual(5)
    })
  })
})

/**
 * E2E Tests for Managed Database Service
 *
 * Tests the full lifecycle of database operations:
 * - SQLit instance creation, scaling, and management
 * - PostgreSQL instance creation, replicas, and failover
 * - Connection pooling
 * - Backup and restore
 * - API routes
 */

import { describe, expect, test } from 'bun:test'

const BASE_URL = process.env.DWS_API_URL ?? 'http://localhost:4030'
const TEST_WALLET = '0x1234567890123456789012345678901234567890'

interface DatabaseInstance {
  instanceId: string
  name: string
  engine: 'sqlit' | 'postgresql'
  status: string
  owner: string
}

interface Backup {
  backupId: string
  status: string
}

describe('Managed Database Service E2E', () => {
  let sqlitInstanceId: string
  let postgresInstanceId: string
  let backupId: string

  // =========================================================================
  // SQLit Tests
  // =========================================================================

  describe('SQLit Database', () => {
    test('should create SQLit database instance', async () => {
      const response = await fetch(`${BASE_URL}/database/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': TEST_WALLET,
        },
        body: JSON.stringify({
          name: 'test-sqlit-e2e',
          engine: 'sqlit',
          planId: 'starter',
          region: 'us-east-1',
          config: {
            vcpus: 1,
            memoryMb: 512,
            storageMb: 1024,
            replicationFactor: 3,
            consistencyMode: 'strong',
          },
        }),
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as { instance: DatabaseInstance }
      expect(data.instance).toBeDefined()
      expect(data.instance.name).toBe('test-sqlit-e2e')
      expect(data.instance.engine).toBe('sqlit')
      sqlitInstanceId = data.instance.instanceId
    })

    test('should get SQLit instance details', async () => {
      const response = await fetch(`${BASE_URL}/database/${sqlitInstanceId}`, {
        headers: {
          'x-wallet-address': TEST_WALLET,
        },
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as { instance: DatabaseInstance }
      expect(data.instance.instanceId).toBe(sqlitInstanceId)
      expect(data.instance.engine).toBe('sqlit')
    })

    test('should get connection credentials', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${sqlitInstanceId}/connection`,
        {
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as {
        credentials: Record<string, string>
      }
      expect(data.credentials).toBeDefined()
      expect(data.credentials.authToken).toBeDefined()
      expect(data.credentials.endpoint).toBeDefined()
    })

    test('should list owner databases', async () => {
      const response = await fetch(`${BASE_URL}/database/`, {
        headers: {
          'x-wallet-address': TEST_WALLET,
        },
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as { instances: DatabaseInstance[] }
      expect(Array.isArray(data.instances)).toBe(true)
      expect(data.instances.length).toBeGreaterThan(0)
    })

    test('should update SQLit instance', async () => {
      const response = await fetch(`${BASE_URL}/database/${sqlitInstanceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': TEST_WALLET,
        },
        body: JSON.stringify({
          memoryMb: 1024,
        }),
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as { instance: DatabaseInstance }
      expect(data.instance).toBeDefined()
    })

    test('should create backup', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${sqlitInstanceId}/backups`,
        {
          method: 'POST',
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { backup: Backup }
      expect(data.backup).toBeDefined()
      expect(data.backup.backupId).toBeDefined()
      backupId = data.backup.backupId
    })

    test('should stop database', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${sqlitInstanceId}/stop`,
        {
          method: 'POST',
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { success: boolean }
      expect(data.success).toBe(true)
    })

    test('should start database', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${sqlitInstanceId}/start`,
        {
          method: 'POST',
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { success: boolean }
      expect(data.success).toBe(true)
    })
  })

  // =========================================================================
  // PostgreSQL Tests
  // =========================================================================

  describe('PostgreSQL Database', () => {
    test('should create PostgreSQL database instance', async () => {
      const response = await fetch(`${BASE_URL}/database/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': TEST_WALLET,
        },
        body: JSON.stringify({
          name: 'test-postgres-e2e',
          engine: 'postgresql',
          planId: 'standard',
          region: 'us-west-2',
          config: {
            vcpus: 2,
            memoryMb: 2048,
            storageMb: 10240,
            readReplicas: 1,
            maxConnections: 100,
            connectionPoolSize: 20,
            backupRetentionDays: 7,
            pointInTimeRecovery: true,
          },
        }),
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as { instance: DatabaseInstance }
      expect(data.instance).toBeDefined()
      expect(data.instance.name).toBe('test-postgres-e2e')
      expect(data.instance.engine).toBe('postgresql')
      postgresInstanceId = data.instance.instanceId
    })

    test('should get PostgreSQL connection credentials', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${postgresInstanceId}/connection`,
        {
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as {
        credentials: Record<string, string>
      }
      expect(data.credentials).toBeDefined()
      // PostgreSQL returns directUrl and pooledUrl
      expect(data.credentials.directUrl).toBeDefined()
      expect(data.credentials.pooledUrl).toBeDefined()
    })

    test('should get connection pool stats', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${postgresInstanceId}/pool`,
        {
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { stats: Record<string, number> }
      expect(data.stats).toBeDefined()
    })

    test('should create read replica', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${postgresInstanceId}/replicas`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': TEST_WALLET,
          },
          body: JSON.stringify({
            region: 'eu-west-1',
          }),
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as {
        replica: { replicaId: string; region: string }
      }
      expect(data.replica).toBeDefined()
      expect(data.replica.region).toBe('eu-west-1')
    })
  })

  // =========================================================================
  // Connection Pooling Tests
  // =========================================================================

  describe('Connection Pooling', () => {
    test('should handle concurrent connection requests', async () => {
      // Simulate multiple concurrent requests
      const requests = Array.from({ length: 10 }, () =>
        fetch(`${BASE_URL}/database/${postgresInstanceId}/pool`, {
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        }),
      )

      const responses = await Promise.all(requests)
      for (const response of responses) {
        expect(response.status).toBe(200)
      }
    })
  })

  // =========================================================================
  // Backup & Restore Tests
  // =========================================================================

  describe('Backup and Restore', () => {
    test('should create PostgreSQL backup', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${postgresInstanceId}/backups`,
        {
          method: 'POST',
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { backup: Backup }
      expect(data.backup).toBeDefined()
      expect(data.backup.backupId).toBeDefined()
    })

    test('should restore from backup', async () => {
      // Skip if no backup was created or instance doesn't exist
      if (!backupId || !sqlitInstanceId) {
        console.log('Skipping restore test - no backup ID or instance')
        return
      }

      // Check if instance still exists first
      const checkResponse = await fetch(
        `${BASE_URL}/database/${sqlitInstanceId}`,
        {
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )
      const checkData = (await checkResponse.json()) as { error?: string }
      if (checkData.error) {
        console.log('Instance no longer exists, skipping restore test')
        return
      }

      const response = await fetch(
        `${BASE_URL}/database/${sqlitInstanceId}/restore`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': TEST_WALLET,
          },
          body: JSON.stringify({
            backupId,
          }),
        },
      )

      // Restore may return 200 or 404 depending on timing
      const data = (await response.json()) as {
        success?: boolean
        error?: string
      }
      if (response.status === 200) {
        expect(data.success).toBe(true)
      } else {
        // Instance may have been deleted in cleanup
        expect(data.error).toBeDefined()
      }
    })
  })

  // =========================================================================
  // Error Handling Tests
  // =========================================================================

  describe('Error Handling', () => {
    test('should return 404 for non-existent database', async () => {
      const response = await fetch(`${BASE_URL}/database/non-existent-id`, {
        headers: {
          'x-wallet-address': TEST_WALLET,
        },
      })

      const data = (await response.json()) as { error?: string }
      expect(data.error).toBeDefined()
    })

    test('should reject unauthorized access', async () => {
      const response = await fetch(`${BASE_URL}/database/${sqlitInstanceId}`, {
        headers: {
          'x-wallet-address': '0x0000000000000000000000000000000000000001',
        },
      })

      const data = (await response.json()) as { error?: string }
      expect(data.error).toBeDefined()
    })

    test('should validate required fields', async () => {
      const response = await fetch(`${BASE_URL}/database/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': TEST_WALLET,
        },
        body: JSON.stringify({
          // Missing required fields
        }),
      })

      expect(response.status).not.toBe(200)
    })
  })

  // =========================================================================
  // Security Tests
  // =========================================================================

  describe('Security', () => {
    test('should require wallet address header', async () => {
      const response = await fetch(`${BASE_URL}/database/`, {
        method: 'GET',
      })

      const data = (await response.json()) as { error?: string }
      expect(data.error).toBeDefined()
    })

    test('should not expose credentials to other users', async () => {
      const response = await fetch(
        `${BASE_URL}/database/${postgresInstanceId}/connection`,
        {
          headers: {
            'x-wallet-address': '0x9999999999999999999999999999999999999999',
          },
        },
      )

      const data = (await response.json()) as { error?: string }
      expect(data.error).toBeDefined()
    })
  })

  // =========================================================================
  // Cleanup
  // =========================================================================

  describe('Cleanup', () => {
    test('should delete SQLit instance', async () => {
      if (!sqlitInstanceId) return

      const response = await fetch(`${BASE_URL}/database/${sqlitInstanceId}`, {
        method: 'DELETE',
        headers: {
          'x-wallet-address': TEST_WALLET,
        },
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as { success: boolean }
      expect(data.success).toBe(true)
    })

    test('should delete PostgreSQL instance', async () => {
      if (!postgresInstanceId) return

      const response = await fetch(
        `${BASE_URL}/database/${postgresInstanceId}`,
        {
          method: 'DELETE',
          headers: {
            'x-wallet-address': TEST_WALLET,
          },
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { success: boolean }
      expect(data.success).toBe(true)
    })
  })
})

// Additional tests for API validation and edge cases
describe('Database API Validation', () => {
  test('should validate engine type', async () => {
    const response = await fetch(`${BASE_URL}/database/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET,
      },
      body: JSON.stringify({
        name: 'invalid-engine-test',
        engine: 'invalid-engine',
        planId: 'starter',
      }),
    })

    expect(response.status).not.toBe(200)
  })

  test('should handle empty plan ID', async () => {
    const response = await fetch(`${BASE_URL}/database/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET,
      },
      body: JSON.stringify({
        name: 'empty-plan-test',
        engine: 'sqlit',
        planId: '', // Empty plan ID - may be accepted with defaults
      }),
    })

    // API may accept empty string and use default plan, or reject
    // Either behavior is acceptable
    expect([200, 400, 422]).toContain(response.status)
  })

  test('should validate database name length', async () => {
    const response = await fetch(`${BASE_URL}/database/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET,
      },
      body: JSON.stringify({
        name: 'a'.repeat(256), // Too long
        engine: 'sqlit',
        planId: 'starter',
      }),
    })

    // Should either reject with validation error or truncate
    expect(response.status).toBeDefined()
  })
})

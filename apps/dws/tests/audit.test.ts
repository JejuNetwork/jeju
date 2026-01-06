/**
 * Audit Manager Tests
 *
 * Tests for the audit and repair mechanisms:
 * - Proof-of-storage challenges
 * - Challenge verification
 * - Reputation tracking
 * - Repair task management
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createSQLitServer } from '@jejunetwork/sqlit/server'
import { resetMetadataService } from '../api/database/metadata-service'
import {
  type AuditChallenge,
  type AuditConfig,
  AuditManager,
} from '../api/storage/audit'

const TEST_DATA_DIR = join(import.meta.dir, '.test-data-audit')
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const TEST_PORT = 18580 + Math.floor(Math.random() * 100)

function createAuditConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    sqlitEndpoint: `http://localhost:${TEST_PORT}`,
    databaseId: 'audit-test',
    nodeId: `audit-node-${Math.random().toString(36).slice(2, 10)}`,
    auditIntervalMs: 60000, // High to disable during tests
    maxConcurrentAudits: 10,
    challengeTimeoutMs: 30000,
    challengeSize: 32,
    minReputationThreshold: 100,
    auditFailPenalty: 50,
    auditPassReward: 5,
    autoRepairEnabled: false, // Disable for tests
    maxRepairAttempts: 3,
    debug: false,
    ...overrides,
  }
}

describe('AuditManager', () => {
  let server: Awaited<ReturnType<typeof createSQLitServer>>
  let databaseId: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'development'

    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }

    // Start SQLit server
    server = await createSQLitServer({
      port: TEST_PORT,
      host: 'localhost',
      nodeConfig: {
        operatorPrivateKey: TEST_PRIVATE_KEY,
        endpoint: `http://localhost:${TEST_PORT}`,
        wsEndpoint: `ws://localhost:${TEST_PORT}/ws`,
        dataDir: TEST_DATA_DIR,
        region: 'global',
        teeEnabled: false,
        l2RpcUrl: 'http://localhost:8545',
        registryAddress: '0x0000000000000000000000000000000000000000',
        version: '2.0.0-test',
      },
    })

    // Create database for audit
    const result = await server.node.createDatabase({
      name: 'audit-test',
      encryptionMode: 'none',
      replication: {},
    })
    databaseId = result.databaseId
  })

  beforeEach(async () => {
    await resetMetadataService()
  })

  afterAll(async () => {
    if (server) {
      await server.stop()
    }
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  describe('Initialization', () => {
    it('should initialize audit manager', async () => {
      const manager = new AuditManager(createAuditConfig({ databaseId }))
      await manager.initialize()
      await manager.stop()
    })
  })

  describe('Challenge Creation', () => {
    let manager: AuditManager

    beforeEach(async () => {
      manager = new AuditManager(createAuditConfig({ databaseId }))
      await manager.initialize()
    })

    afterAll(async () => {
      if (manager) {
        await manager.stop()
      }
    })

    it('should create a challenge', async () => {
      const challenge = await manager.createChallenge(
        'QmTestChallengeContent',
        'target-node-1',
      )

      expect(challenge.challengeId).toBeDefined()
      expect(challenge.cid).toBe('QmTestChallengeContent')
      expect(challenge.nodeId).toBe('target-node-1')
      expect(challenge.challenge).toBeDefined()
      expect(challenge.status).toBe('pending')
      expect(challenge.expiresAt).toBeGreaterThan(Date.now())
    })

    it('should create unique challenges', async () => {
      const challenge1 = await manager.createChallenge('QmContent1', 'node-1')
      const challenge2 = await manager.createChallenge('QmContent2', 'node-2')

      expect(challenge1.challengeId).not.toBe(challenge2.challengeId)
      expect(challenge1.challenge).not.toBe(challenge2.challenge)
    })

    it('should set appropriate expiration time', async () => {
      const config = createAuditConfig({
        databaseId,
        challengeTimeoutMs: 60000,
      })
      const customManager = new AuditManager(config)
      await customManager.initialize()

      const challenge = await customManager.createChallenge('QmContent', 'node')

      const expectedExpiry = Date.now() + 60000
      expect(challenge.expiresAt).toBeGreaterThan(Date.now())
      expect(challenge.expiresAt).toBeLessThanOrEqual(expectedExpiry + 1000)

      await customManager.stop()
    })
  })

  describe('Proof Submission', () => {
    let manager: AuditManager
    let challenge: AuditChallenge

    beforeEach(async () => {
      manager = new AuditManager(createAuditConfig({ databaseId }))
      await manager.initialize()
      challenge = await manager.createChallenge('QmProofContent', 'node-proof')
    })

    afterAll(async () => {
      if (manager) {
        await manager.stop()
      }
    })

    it('should create challenge for proof submission', async () => {
      // The challenge was created in beforeEach
      expect(challenge.challengeId).toBeDefined()
      expect(challenge.status).toBe('pending')
      expect(challenge.nodeId).toBe('node-proof')
    })

    it('should reject proof for non-existent challenge', async () => {
      await expect(
        manager.submitProof(
          'non-existent-challenge-id',
          '0xabcdef' as `0x${string}`,
        ),
      ).rejects.toThrow()
    })
  })

  describe('Node Statistics', () => {
    let manager: AuditManager

    beforeEach(async () => {
      manager = new AuditManager(createAuditConfig({ databaseId }))
      await manager.initialize()
    })

    afterAll(async () => {
      if (manager) {
        await manager.stop()
      }
    })

    it('should create challenges for node', async () => {
      const nodeId = 'stats-node-1'

      // Create some challenges - stats are updated on proof submission
      const challenge1 = await manager.createChallenge('QmStats1', nodeId)
      const challenge2 = await manager.createChallenge('QmStats2', nodeId)

      expect(challenge1.nodeId).toBe(nodeId)
      expect(challenge2.nodeId).toBe(nodeId)
      expect(challenge1.challengeId).not.toBe(challenge2.challengeId)
    })

    it('should return null for unknown node', async () => {
      const stats = await manager.getNodeStats('unknown-node-xyz')
      expect(stats).toBeNull()
    })
  })

  describe('Overall Statistics', () => {
    let manager: AuditManager

    beforeEach(async () => {
      manager = new AuditManager(createAuditConfig({ databaseId }))
      await manager.initialize()
    })

    afterAll(async () => {
      if (manager) {
        await manager.stop()
      }
    })

    it('should return overall stats', async () => {
      const stats = await manager.getOverallStats()

      expect(stats).toBeDefined()
      expect(typeof stats.totalAudits).toBe('number')
      expect(typeof stats.passedAudits).toBe('number')
      expect(typeof stats.failedAudits).toBe('number')
      expect(typeof stats.avgResponseTimeMs).toBe('number')
    })
  })

  describe('Configuration', () => {
    it('should use configured challenge timeout', async () => {
      const config = createAuditConfig({
        databaseId,
        challengeTimeoutMs: 120000,
      })
      const manager = new AuditManager(config)
      await manager.initialize()

      const challenge = await manager.createChallenge('QmTimeout', 'node-1')

      const expectedMinExpiry = Date.now() + 110000 // Allow some slack
      expect(challenge.expiresAt).toBeGreaterThan(expectedMinExpiry)

      await manager.stop()
    })

    it('should use configured challenge size', async () => {
      const config = createAuditConfig({
        databaseId,
        challengeSize: 64,
      })
      const manager = new AuditManager(config)
      await manager.initialize()

      const challenge = await manager.createChallenge(
        'QmChallengeSize',
        'node-1',
      )

      // Hex encoding doubles the length, plus 0x prefix
      expect(challenge.challenge.length).toBe(2 + 64 * 2)

      await manager.stop()
    })
  })

  describe('Challenge Lifecycle', () => {
    let manager: AuditManager

    beforeEach(async () => {
      manager = new AuditManager(createAuditConfig({ databaseId }))
      await manager.initialize()
    })

    afterAll(async () => {
      if (manager) {
        await manager.stop()
      }
    })

    it('should create challenge with pending status', async () => {
      const challenge = await manager.createChallenge('QmLifecycle', 'node-1')
      expect(challenge.status).toBe('pending')
    })

    it('should include challenge bytes in response', async () => {
      const challenge = await manager.createChallenge(
        'QmChallengeBytes',
        'node-2',
      )

      expect(challenge.challenge).toBeDefined()
      expect(challenge.challenge.startsWith('0x')).toBe(true)
      expect(challenge.challenge.length).toBeGreaterThan(10)
    })
  })

  describe('Concurrent Challenges', () => {
    let manager: AuditManager

    beforeEach(async () => {
      manager = new AuditManager(createAuditConfig({ databaseId }))
      await manager.initialize()
    })

    afterAll(async () => {
      if (manager) {
        await manager.stop()
      }
    })

    it('should handle multiple concurrent challenges', async () => {
      const challenges = await Promise.all([
        manager.createChallenge('QmConcurrent1', 'node-1'),
        manager.createChallenge('QmConcurrent2', 'node-2'),
        manager.createChallenge('QmConcurrent3', 'node-3'),
        manager.createChallenge('QmConcurrent4', 'node-4'),
        manager.createChallenge('QmConcurrent5', 'node-5'),
      ])

      expect(challenges.length).toBe(5)
      expect(new Set(challenges.map((c) => c.challengeId)).size).toBe(5)
    })
  })
})

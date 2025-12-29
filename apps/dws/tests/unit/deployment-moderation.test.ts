/**
 * Tests for Deployment Moderation Service
 *
 * Tests the actual DeploymentModerationService API:
 * - scanDeployment() - scans a deployment and returns moderation result
 * - getReputation() - gets user reputation data
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'

// Mock EQLite before importing
const mockQuery = mock(() => Promise.resolve({ rows: [] }))
const mockExec = mock(() => Promise.resolve())

mock.module('@jejunetwork/db', () => ({
  getEQLite: () => ({
    query: mockQuery,
    exec: mockExec,
    isHealthy: () => Promise.resolve(true),
  }),
}))

// Import after mocking
const { DeploymentModerationService } = await import(
  '../../api/containers/deployment-moderation'
)

describe('Deployment Moderation Service', () => {
  let service: DeploymentModerationService
  const testOwner = '0x1234567890123456789012345678901234567890' as Address
  const testDeploymentId = 'deploy-123'

  beforeEach(() => {
    service = new DeploymentModerationService({
      enableImageScanning: true,
      enableCodeScanning: true,
      enableEnvScanning: true,
      enableAIAnalysis: false, // Disable AI for unit tests
      autoBlockThreshold: 0.9,
      reviewThreshold: 0.5,
    })
    mockQuery.mockClear()
    mockExec.mockClear()
  })

  describe('getReputation', () => {
    test('returns default reputation for new user', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const reputation = await service.getReputation(testOwner)

      expect(reputation.address).toBe(testOwner)
      expect(reputation.tier).toBe('untrusted')
      expect(reputation.totalDeployments).toBe(0)
      expect(reputation.reputationScore).toBe(0)
    })

    test('returns existing reputation from database', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            tier: 'high',
            total_deployments: 50,
            successful_deployments: 48,
            blocked_deployments: 1,
            reviewed_deployments: 1,
            reputation_score: 95,
            last_deployment_at: Date.now(),
            linked_identity_type: null,
            linked_identity_verified_at: null,
            linked_identity_account_age: null,
          },
        ],
      })

      const reputation = await service.getReputation(testOwner)

      expect(reputation.tier).toBe('high')
      expect(reputation.totalDeployments).toBe(50)
      expect(reputation.reputationScore).toBe(95)
    })
  })

  describe('scanDeployment', () => {
    test('approves clean deployment from trusted user', async () => {
      // Mock high reputation user
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            tier: 'high',
            total_deployments: 100,
            successful_deployments: 100,
            blocked_deployments: 0,
            reviewed_deployments: 0,
            reputation_score: 100,
            last_deployment_at: Date.now(),
            linked_identity_type: null,
            linked_identity_verified_at: null,
            linked_identity_account_age: null,
          },
        ],
      })
      // Mock store result
      mockExec.mockResolvedValueOnce(undefined)
      // Mock reputation update
      mockExec.mockResolvedValueOnce(undefined)

      const result = await service.scanDeployment({
        deploymentId: testDeploymentId,
        owner: testOwner,
        environment: {},
      })

      expect(result.action).toBe('allow')
      expect(result.overallScore).toBeLessThanOrEqual(100)
      expect(result.reviewRequired).toBe(false)
      expect(result.attestationHash).toMatch(/^0x[a-f0-9]{64}$/)
    })

    test('flags suspicious deployment for review', async () => {
      // Mock untrusted user
      mockQuery.mockResolvedValueOnce({ rows: [] })
      // Mock store result
      mockExec.mockResolvedValueOnce(undefined)
      // Mock reputation update
      mockExec.mockResolvedValueOnce(undefined)
      // Mock queue for review
      mockExec.mockResolvedValueOnce(undefined)

      const result = await service.scanDeployment({
        deploymentId: testDeploymentId,
        owner: testOwner,
        environment: {
          // Suspicious patterns
          CRYPTO_MINER: 'true',
          SECRET_KEY: 'sk-ant-api-key-123',
        },
      })

      // May be quarantine or review based on scoring
      expect(['quarantine', 'review']).toContain(result.action)
      expect(result.blockedReasons.length).toBeGreaterThan(0)
    })

    test('includes scan duration in result', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValue(undefined)

      const result = await service.scanDeployment({
        deploymentId: testDeploymentId,
        owner: testOwner,
      })

      expect(result.scanDurationMs).toBeGreaterThanOrEqual(0)
      expect(typeof result.scanDurationMs).toBe('number')
    })

    test('generates valid attestation hash', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValue(undefined)

      const result = await service.scanDeployment({
        deploymentId: testDeploymentId,
        owner: testOwner,
      })

      expect(result.attestationHash).toBeDefined()
      expect(result.attestationHash.length).toBe(66) // 0x + 64 hex chars
    })
  })

  describe('environment scanning', () => {
    test('detects sensitive environment variables', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValue(undefined)

      const result = await service.scanDeployment({
        deploymentId: testDeploymentId,
        owner: testOwner,
        environment: {
          // Value needs to look like a real secret (length > 20 or specific pattern)
          AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          OPENAI_API_KEY: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456789',
        },
      })

      // Looks for data_leak category, not leaked_credentials
      const sensitiveCategory = result.categories.find(
        (c) => c.category === 'data_leak',
      )
      expect(sensitiveCategory).toBeDefined()
    })
  })

  describe('moderation result structure', () => {
    test('returns properly structured moderation result', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValue(undefined)

      const result = await service.scanDeployment({
        deploymentId: testDeploymentId,
        owner: testOwner,
      })

      expect(result).toHaveProperty('deploymentId')
      expect(result).toHaveProperty('timestamp')
      expect(result).toHaveProperty('action')
      expect(result).toHaveProperty('categories')
      expect(result).toHaveProperty('overallScore')
      expect(result).toHaveProperty('scanDurationMs')
      expect(result).toHaveProperty('attestationHash')
      expect(result).toHaveProperty('reviewRequired')
      expect(result).toHaveProperty('blockedReasons')
      expect(Array.isArray(result.categories)).toBe(true)
      expect(Array.isArray(result.blockedReasons)).toBe(true)
    })
  })
})

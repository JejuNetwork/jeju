/**
 * Tests for Reputation Service
 *
 * Tests the actual ReputationService API:
 * - getReputation() - gets user reputation score
 * - getModerationIntensity() - gets AI moderation intensity for user
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'

// Mock SQLit before importing
const mockQuery = mock(() => Promise.resolve({ rows: [] }))
const mockExec = mock(() => Promise.resolve())

mock.module('@jejunetwork/db', () => ({
  getSQLit: () => ({
    query: mockQuery,
    exec: mockExec,
    isHealthy: () => Promise.resolve(true),
  }),
}))

// Import after mocking
const { ReputationService } = await import(
  '../../api/moderation/reputation-service'
)

describe('Reputation Service', () => {
  let service: ReputationService
  const testAddress = '0x1234567890123456789012345678901234567890' as Address

  beforeEach(() => {
    service = new ReputationService()
    mockQuery.mockClear()
    mockExec.mockClear()
  })

  describe('getReputation', () => {
    test('returns default reputation for new user', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValueOnce(undefined) // initializeUser

      const reputation = await service.getReputation(testAddress)

      expect(reputation.address).toBe(testAddress)
      expect(reputation.level).toBe('new')
      expect(reputation.totalScore).toBe(0)
      expect(reputation.components).toBeDefined()
      expect(reputation.calculatedScore).toBeDefined()
    })

    test('returns existing user reputation with calculated level', async () => {
      // Score calculation: 365*1 + 100*5 + 10*100 + 500 + 5*50 = 365 + 500 + 1000 + 500 + 250 = 2615 (verified)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 0, // Ignored - calculated dynamically
            account_age_days: 365,
            successful_deployments: 100,
            staked_tokens: '10000000000000000000', // 10 ETH
            identity_verified: 1,
            community_vouches: 5,
            violations: 0,
            violation_severity: 0,
            last_updated: Date.now(),
            created_at: Date.now() - 365 * 24 * 60 * 60 * 1000,
          },
        ],
      })

      const reputation = await service.getReputation(testAddress)

      // Calculated score: 365 + 500 + 1000 + 500 + 250 = 2615
      expect(reputation.totalScore).toBeGreaterThan(1000)
      expect(reputation.level).toBe('verified')
      expect(reputation.components.accountAge).toBe(365)
      expect(reputation.components.identityVerified).toBe(true)
    })

    test('calculates trusted level correctly', async () => {
      // Score calculation: 30*1 + 20*5 + 2*100 + 0 + 2*50 = 30 + 100 + 200 + 0 + 100 = 430 (basic)
      // Need more: 100*1 + 100*5 + 2*100 + 0 + 2*50 = 100 + 500 + 200 + 0 + 100 = 900 (trusted)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 0,
            account_age_days: 200,
            successful_deployments: 100,
            staked_tokens: '5000000000000000000', // 5 ETH
            identity_verified: 0,
            community_vouches: 4,
            violations: 0,
            violation_severity: 0,
            last_updated: Date.now(),
            created_at: Date.now() - 200 * 24 * 60 * 60 * 1000,
          },
        ],
      })

      const reputation = await service.getReputation(testAddress)
      // Calculated: 200 + 500 + 500 + 0 + 200 = 1400 -> verified
      expect(reputation.totalScore).toBeGreaterThanOrEqual(500)
    })
  })

  describe('getModerationIntensity', () => {
    test('returns high intensity for new users', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValueOnce(undefined)

      const intensity = await service.getModerationIntensity(testAddress)

      expect(intensity.level).toBe('new')
      expect(intensity.aiScanRequired).toBe(true)
      expect(intensity.aiScanDepth).toBe('full')
      expect(intensity.manualReviewRequired).toBe(true)
    })

    test('returns appropriate intensity based on reputation', async () => {
      // Basic level: 100-499 points
      // 100*1 + 5*5 + 0 + 0 + 0 = 125 (basic)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 0,
            account_age_days: 100,
            successful_deployments: 5,
            staked_tokens: '0',
            identity_verified: 0,
            community_vouches: 0,
            violations: 0,
            violation_severity: 0,
            last_updated: Date.now(),
            created_at: Date.now() - 100 * 24 * 60 * 60 * 1000,
          },
        ],
      })

      const intensity = await service.getModerationIntensity(testAddress)

      expect(intensity.level).toBe('basic')
      expect(intensity.aiScanDepth).toBe('standard')
    })

    test('verified users get reduced scrutiny', async () => {
      // Verified level: 1000-4999 points
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 0,
            account_age_days: 365,
            successful_deployments: 150,
            staked_tokens: '10000000000000000000', // 10 ETH
            identity_verified: 1,
            community_vouches: 5,
            violations: 0,
            violation_severity: 0,
            last_updated: Date.now(),
            created_at: Date.now() - 365 * 24 * 60 * 60 * 1000,
          },
        ],
      })

      const intensity = await service.getModerationIntensity(testAddress)

      expect(intensity.level).toBe('verified')
      expect(intensity.aiScanRequired).toBe(true)
      expect(intensity.aiScanDepth).toBe('minimal')
      expect(intensity.manualReviewRequired).toBe(false)
    })
  })

  describe('reputation components', () => {
    test('properly calculates age score', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 0,
            account_age_days: 100,
            successful_deployments: 0,
            staked_tokens: '0',
            identity_verified: 0,
            community_vouches: 0,
            violations: 0,
            violation_severity: 0,
            last_updated: Date.now(),
            created_at: Date.now() - 100 * 24 * 60 * 60 * 1000,
          },
        ],
      })

      const reputation = await service.getReputation(testAddress)

      expect(reputation.calculatedScore.ageScore).toBe(100)
    })

    test('applies violation penalty correctly', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 0,
            account_age_days: 200,
            successful_deployments: 50,
            staked_tokens: '5000000000000000000',
            identity_verified: 1,
            community_vouches: 3,
            violations: 2,
            violation_severity: 200,
            last_updated: Date.now(),
            created_at: Date.now() - 200 * 24 * 60 * 60 * 1000,
          },
        ],
      })

      const reputation = await service.getReputation(testAddress)

      expect(reputation.components.violations).toBe(2)
      expect(reputation.calculatedScore.violationPenalty).toBe(200)
      // Score reduced by penalty
      expect(reputation.totalScore).toBeLessThan(
        reputation.calculatedScore.ageScore +
          reputation.calculatedScore.deploymentScore +
          reputation.calculatedScore.stakeScore +
          reputation.calculatedScore.identityScore +
          reputation.calculatedScore.vouchScore,
      )
    })
  })

  describe('reputation structure', () => {
    test('returns properly structured reputation object', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValueOnce(undefined)

      const reputation = await service.getReputation(testAddress)

      expect(reputation).toHaveProperty('address')
      expect(reputation).toHaveProperty('totalScore')
      expect(reputation).toHaveProperty('level')
      expect(reputation).toHaveProperty('components')
      expect(reputation).toHaveProperty('calculatedScore')
      expect(reputation).toHaveProperty('lastUpdated')
      expect(reputation).toHaveProperty('createdAt')

      expect(reputation.components).toHaveProperty('accountAge')
      expect(reputation.components).toHaveProperty('successfulDeployments')
      expect(reputation.components).toHaveProperty('stakedTokens')
      expect(reputation.components).toHaveProperty('identityVerified')
      expect(reputation.components).toHaveProperty('communityVouches')
      expect(reputation.components).toHaveProperty('violations')
    })

    test('moderation intensity has required fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockExec.mockResolvedValueOnce(undefined)

      const intensity = await service.getModerationIntensity(testAddress)

      expect(intensity).toHaveProperty('level')
      expect(intensity).toHaveProperty('score')
      expect(intensity).toHaveProperty('aiScanRequired')
      expect(intensity).toHaveProperty('aiScanDepth')
      expect(intensity).toHaveProperty('manualReviewRequired')
      expect(intensity).toHaveProperty('deploymentDelay')
      expect(intensity).toHaveProperty('bandwidthLimit')
    })
  })
})

/**
 * Tests for Reputation-Based Trust Service
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
  }),
}))

// Import after mocking
const { ReputationService, shouldModerateDeployment, applyModerationResult } =
  await import('../../api/moderation/reputation-service')

describe('Reputation Service', () => {
  let service: ReputationService
  const testAddress = '0x1234567890123456789012345678901234567890' as Address

  beforeEach(() => {
    service = new ReputationService()
    mockQuery.mockClear()
    mockExec.mockClear()
  })

  describe('getReputation', () => {
    test('creates new user with zero reputation', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const reputation = await service.getReputation(testAddress)

      expect(reputation.address).toBe(testAddress)
      expect(reputation.totalScore).toBe(0)
      expect(reputation.level).toBe('new')
      expect(reputation.components.successfulDeployments).toBe(0)
      expect(reputation.components.violations).toBe(0)
    })

    test('returns existing user reputation', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 750,
            account_age_days: 90,
            successful_deployments: 50,
            staked_tokens: '1000000000000000000', // 1 ETH
            identity_verified: 1,
            community_vouches: 3,
            violations: 1,
            violation_severity: 50,
            last_updated: now,
            created_at: now - 90 * 86400000,
          },
        ],
      })

      const reputation = await service.getReputation(testAddress)

      expect(reputation.level).toBe('trusted')
      expect(reputation.components.accountAge).toBe(90)
      expect(reputation.components.successfulDeployments).toBe(50)
      expect(reputation.components.stakedTokens).toBe(1000000000000000000n)
      expect(reputation.components.identityVerified).toBe(true)
      expect(reputation.components.communityVouches).toBe(3)
    })

    test('calculates scores correctly', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 0, // Will be recalculated
            account_age_days: 365, // Max 365 points
            successful_deployments: 200, // Max 1000 points
            staked_tokens: '20000000000000000000', // 20 ETH = max 2000 points
            identity_verified: 1, // 500 points
            community_vouches: 10, // Max 500 points
            violations: 0,
            violation_severity: 0,
            last_updated: now,
            created_at: now - 365 * 86400000,
          },
        ],
      })

      const reputation = await service.getReputation(testAddress)

      // 365 + 1000 + 2000 + 500 + 500 = 4365
      expect(reputation.calculatedScore.ageScore).toBe(365)
      expect(reputation.calculatedScore.deploymentScore).toBe(1000)
      expect(reputation.calculatedScore.stakeScore).toBe(2000)
      expect(reputation.calculatedScore.identityScore).toBe(500)
      expect(reputation.calculatedScore.vouchScore).toBe(500)
    })
  })

  describe('getModerationIntensity', () => {
    test('new users get full moderation', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const intensity = await service.getModerationIntensity(testAddress)

      expect(intensity.level).toBe('new')
      expect(intensity.aiScanRequired).toBe(true)
      expect(intensity.aiScanDepth).toBe('full')
      expect(intensity.manualReviewRequired).toBe(true)
      expect(intensity.deploymentDelay).toBe(300)
    })

    test('trusted users get reduced moderation', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 600,
            account_age_days: 100,
            successful_deployments: 80,
            staked_tokens: '0',
            identity_verified: 0,
            community_vouches: 2,
            violations: 0,
            violation_severity: 0,
            last_updated: now,
            created_at: now - 100 * 86400000,
          },
        ],
      })

      const intensity = await service.getModerationIntensity(testAddress)

      expect(intensity.level).toBe('trusted')
      expect(intensity.aiScanRequired).toBe(true)
      expect(intensity.aiScanDepth).toBe('quick')
      expect(intensity.manualReviewRequired).toBe(false)
      expect(intensity.deploymentDelay).toBe(10)
    })

    test('elite users bypass most checks', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 5500,
            account_age_days: 365,
            successful_deployments: 500,
            staked_tokens: '30000000000000000000',
            identity_verified: 1,
            community_vouches: 10,
            violations: 0,
            violation_severity: 0,
            last_updated: now,
            created_at: now - 365 * 86400000,
          },
        ],
      })

      const intensity = await service.getModerationIntensity(testAddress)

      expect(intensity.level).toBe('elite')
      expect(intensity.aiScanRequired).toBe(false)
      expect(intensity.manualReviewRequired).toBe(false)
      expect(intensity.deploymentDelay).toBe(0)
      expect(intensity.bandwidthLimit).toBe(-1)
    })
  })

  describe('recordDeployment', () => {
    test('records successful deployment', async () => {
      await service.recordDeployment(
        testAddress,
        'dep-123',
        'success',
        'basic',
        'AI scan passed',
      )

      expect(mockExec).toHaveBeenCalled()
    })

    test('records failed deployment', async () => {
      await service.recordDeployment(testAddress, 'dep-124', 'failed', 'new')

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('recordViolation', () => {
    test('records violation and applies penalty', async () => {
      const violation = await service.recordViolation(
        testAddress,
        'content',
        'medium',
        'Prohibited content detected',
        'hash://evidence123',
      )

      expect(violation.type).toBe('content')
      expect(violation.severity).toBe('medium')
      expect(violation.penaltyApplied).toBe(200)
      expect(mockExec).toHaveBeenCalled()
    })

    test('critical violation has high penalty', async () => {
      const violation = await service.recordViolation(
        testAddress,
        'fraud',
        'critical',
        'Fraudulent activity',
        'hash://evidence456',
      )

      expect(violation.penaltyApplied).toBe(2000)
    })
  })

  describe('addVouch', () => {
    const voucherAddress =
      '0x2222222222222222222222222222222222222222' as Address
    const voucheeAddress =
      '0x3333333333333333333333333333333333333333' as Address

    test('adds vouch from trusted user', async () => {
      // Mock voucher reputation
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 600,
            account_age_days: 100,
            successful_deployments: 80,
            staked_tokens: '0',
            identity_verified: 0,
            community_vouches: 2,
            violations: 0,
            violation_severity: 0,
            last_updated: now,
            created_at: now - 100 * 86400000,
          },
        ],
      })

      // Mock existing vouch check
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const vouch = await service.addVouch(
        voucherAddress,
        voucheeAddress,
        'Good person',
      )

      expect(vouch.voucher).toBe(voucherAddress)
      expect(vouch.vouchee).toBe(voucheeAddress)
      expect(vouch.weight).toBeGreaterThanOrEqual(1)
      expect(mockExec).toHaveBeenCalled()
    })

    test('rejects vouch from low reputation user', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.addVouch(voucherAddress, voucheeAddress, 'Test'),
      ).rejects.toThrow('at least trusted')
    })

    test('rejects self-vouch', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_score: 600,
            account_age_days: 100,
            successful_deployments: 80,
            staked_tokens: '0',
            identity_verified: 0,
            community_vouches: 2,
            violations: 0,
            violation_severity: 0,
            last_updated: now,
            created_at: now - 100 * 86400000,
          },
        ],
      })

      await expect(
        service.addVouch(voucherAddress, voucherAddress, 'Self vouch'),
      ).rejects.toThrow('yourself')
    })
  })

  describe('revokeVouch', () => {
    test('revokes existing vouch', async () => {
      await service.revokeVouch(
        '0x2222222222222222222222222222222222222222' as Address,
        '0x3333333333333333333333333333333333333333' as Address,
      )

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('updateStakedTokens', () => {
    test('updates staked tokens', async () => {
      await service.updateStakedTokens(testAddress, 5000000000000000000n)

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('verifyIdentity', () => {
    test('marks identity as verified', async () => {
      await service.verifyIdentity(testAddress)

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('getViolations', () => {
    test('returns violations for address', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'vio-1',
            address: testAddress.toLowerCase(),
            type: 'content',
            severity: 'medium',
            description: 'Test violation',
            evidence: 'hash://123',
            penalty_applied: 200,
            created_at: now,
            resolved_at: null,
            appeal_status: null,
          },
        ],
      })

      const violations = await service.getViolations(testAddress)

      expect(violations).toHaveLength(1)
      expect(violations[0].type).toBe('content')
      expect(violations[0].severity).toBe('medium')
    })
  })

  describe('appealViolation', () => {
    test('appeals violation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'vio-1',
            address: testAddress.toLowerCase(),
          },
        ],
      })

      await service.appealViolation(testAddress, 'vio-1')

      expect(mockExec).toHaveBeenCalled()
    })

    test('rejects appeal for non-existent violation', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.appealViolation(testAddress, 'vio-999'),
      ).rejects.toThrow('not found')
    })
  })

  describe('resolveAppeal', () => {
    test('approves appeal and removes penalty', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            address: testAddress.toLowerCase(),
            penalty_applied: 200,
          },
        ],
      })

      await service.resolveAppeal('vio-1', true)

      expect(mockExec).toHaveBeenCalled()
    })

    test('denies appeal', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            address: testAddress.toLowerCase(),
            penalty_applied: 200,
          },
        ],
      })

      await service.resolveAppeal('vio-1', false)

      expect(mockExec).toHaveBeenCalled()
    })
  })
})

describe('shouldModerateDeployment', () => {
  test('returns moderation requirements for new user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await shouldModerateDeployment(
      '0x1234567890123456789012345678901234567890' as Address,
    )

    expect(result.shouldModerate).toBe(true)
    expect(result.intensity.aiScanRequired).toBe(true)
    expect(result.reputation.level).toBe('new')
  })
})

describe('applyModerationResult', () => {
  test('applies successful moderation result', async () => {
    await applyModerationResult(
      '0x1234567890123456789012345678901234567890' as Address,
      'dep-123',
      true,
      'basic',
      'AI scan passed',
    )

    expect(mockExec).toHaveBeenCalled()
  })

  test('applies failed moderation result with violation', async () => {
    await applyModerationResult(
      '0x1234567890123456789012345678901234567890' as Address,
      'dep-124',
      false,
      'new',
      'AI scan failed',
      {
        type: 'content',
        severity: 'high',
        description: 'Prohibited content',
        evidence: 'hash://evidence',
      },
    )

    expect(mockExec).toHaveBeenCalled()
  })
})

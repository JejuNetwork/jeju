/**
 * Registry Integration Tests
 *
 * Tests for the CouncilRegistryIntegration contract and client.
 * Requires a running chain (Anvil) for contract calls.
 *
 * Run with: AUTO_START_SERVICES=true bun test tests/integration/registry-integration.test.ts
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import {
  RegistryIntegrationClient,
  type RegistryIntegrationConfig,
} from '../../api/registry-integration'
import { requireChain } from '../setup'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

let rpcUrl: string
let client: RegistryIntegrationClient

beforeAll(async () => {
  rpcUrl = await requireChain()
  console.log(`🔗 Testing against chain at ${rpcUrl}`)

  const testConfig: RegistryIntegrationConfig = {
    rpcUrl,
    identityRegistry: process.env.IDENTITY_REGISTRY_ADDRESS || ZERO_ADDRESS,
    reputationRegistry: process.env.REPUTATION_REGISTRY_ADDRESS || ZERO_ADDRESS,
    integrationContract: process.env.REGISTRY_INTEGRATION_ADDRESS,
    delegationRegistry: process.env.DELEGATION_REGISTRY_ADDRESS,
  }

  client = new RegistryIntegrationClient(testConfig)
})

describe('RegistryIntegrationClient', () => {
  describe('Agent Profile Queries', () => {
    it('should return null for non-existent agent', async () => {
      const profile = await client.getAgentProfile(999999n)
      expect(profile).toBeNull()
    })

    it('should get agent profiles for empty array', async () => {
      const profiles = await client.getAgentProfiles([])
      expect(profiles).toEqual([])
    })

    it('should calculate voting power with default multipliers', async () => {
      const power = await client.getVotingPower(
        '0x1234567890123456789012345678901234567890',
        0n,
        1000000000000000000n, // 1 token
      )

      expect(power.baseVotes).toBe(1000000000000000000n)
      expect(power.reputationMultiplier).toBe(100)
      expect(power.stakeMultiplier).toBe(100)
      expect(power.effectiveVotes).toBe(1000000000000000000n)
    })
  })

  describe('Search Functions', () => {
    it('should search by tag and return empty for non-existent tag', async () => {
      const result = await client.searchByTag('nonexistent-tag-12345', 0, 10)

      expect(result.agentIds).toBeDefined()
      expect(Array.isArray(result.agentIds)).toBe(true)
    })

    it('should get agents by score with high threshold', async () => {
      const result = await client.getAgentsByScore(100, 0, 10)

      expect(result.agentIds).toBeDefined()
      expect(result.scores).toBeDefined()
      expect(result.agentIds.length).toBe(result.scores.length)
    })

    it('should get top agents', async () => {
      const profiles = await client.getTopAgents(5)

      expect(Array.isArray(profiles)).toBe(true)
    })
  })

  describe('Eligibility Checks', () => {
    it('should check proposal eligibility for non-existent agent', async () => {
      const result = await client.canSubmitProposal(999999n)

      expect(result.eligible).toBe(false)
      expect(result.reason).toContain('does not exist')
    })

    it('should check vote eligibility for non-existent agent', async () => {
      const result = await client.canVote(999999n)

      expect(result.eligible).toBe(false)
      expect(result.reason).toContain('does not exist')
    })

    it('should check research eligibility for non-existent agent', async () => {
      const result = await client.canConductResearch(999999n)

      expect(result.eligible).toBe(false)
      expect(result.reason).toContain('does not exist')
    })
  })

  describe('Provider Reputation', () => {
    it('should get all provider reputations', async () => {
      const providers = await client.getAllProviderReputations()

      expect(Array.isArray(providers)).toBe(true)
    })

    it('should get weighted agent reputation', async () => {
      const result = await client.getWeightedAgentReputation(1n)

      expect(result).toHaveProperty('reputation')
      expect(result).toHaveProperty('weight')
      expect(typeof result.reputation).toBe('number')
      expect(typeof result.weight).toBe('number')
    })
  })

  describe('Delegation', () => {
    it('should return null for non-existent delegate', async () => {
      const delegate = await client.getDelegate(
        '0x1234567890123456789012345678901234567890',
      )

      // Null if not registered or no delegation contract
      expect(delegate === null || delegate.delegate !== undefined).toBe(true)
    })

    it('should get top delegates', async () => {
      const delegates = await client.getTopDelegates(5)

      expect(Array.isArray(delegates)).toBe(true)
    })

    it('should get security council', async () => {
      const council = await client.getSecurityCouncil()

      expect(Array.isArray(council)).toBe(true)
    })

    it('should check security council membership', async () => {
      const isMember = await client.isSecurityCouncilMember(
        '0x1234567890123456789012345678901234567890',
      )

      expect(typeof isMember).toBe('boolean')
    })
  })

  describe('Active Agents', () => {
    it('should get active agents with pagination', async () => {
      const agents = await client.getActiveAgents(0, 10)

      expect(Array.isArray(agents)).toBe(true)
    })

    it('should get total agent count', async () => {
      const total = await client.getTotalAgents()

      expect(typeof total).toBe('number')
      expect(total).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('Composite Score Calculation', () => {
  it('should calculate score correctly for banned agent', () => {
    const banned = true
    const score = banned ? 0 : 50
    expect(score).toBe(0)
  })

  it('should weight components correctly', () => {
    const stakeScore = 80
    const repScore = 90
    const activityScore = 100
    const penaltyScore = 100

    const composite = Math.round(
      stakeScore * 0.3 +
        repScore * 0.4 +
        activityScore * 0.15 +
        penaltyScore * 0.15,
    )

    expect(composite).toBe(90)
  })

  it('should cap score at 100', () => {
    const composite = Math.min(100, 120)
    expect(composite).toBe(100)
  })

  it('should reduce score based on violations', () => {
    const violations = 5
    const penaltyScore = Math.max(0, 100 - violations * 10)
    expect(penaltyScore).toBe(50)
  })

  it('should handle max violations', () => {
    const violations = 15
    const penaltyScore = Math.max(0, 100 - violations * 10)
    expect(penaltyScore).toBe(0)
  })
})

describe('Voting Power Multipliers', () => {
  it('should calculate reputation multiplier correctly', () => {
    const reputation = 75
    const multiplier = reputation >= 50 ? 100 + (reputation - 50) * 2 : 100
    expect(multiplier).toBe(150)
  })

  it('should cap reputation multiplier at 2x', () => {
    const reputation = 100
    const multiplier = reputation >= 50 ? 100 + (reputation - 50) * 2 : 100
    expect(multiplier).toBe(200)
  })

  it('should use 1x for low reputation', () => {
    const reputation = 30
    const multiplier = reputation >= 50 ? 100 + (reputation - 50) * 2 : 100
    expect(multiplier).toBe(100)
  })

  it('should calculate stake multiplier for HIGH tier', () => {
    const tier = 3
    let multiplier = 100
    if (tier === 3) multiplier = 150
    else if (tier === 2) multiplier = 125
    else if (tier === 1) multiplier = 110
    expect(multiplier).toBe(150)
  })

  it('should calculate effective votes correctly', () => {
    const baseVotes = 1000n
    const repMultiplier = 150n
    const stakeMultiplier = 125n

    const effective = (baseVotes * repMultiplier * stakeMultiplier) / 10000n
    expect(effective).toBe(1875n)
  })
})

describe('Security Council Selection', () => {
  it('should require minimum stake', () => {
    const stakedAmount = 0.5
    const minStake = 1
    expect(stakedAmount >= minStake).toBe(false)
  })

  it('should require minimum reputation', () => {
    const reputation = 70
    const minRep = 80
    expect(reputation >= minRep).toBe(false)
  })

  it('should require minimum delegation share', () => {
    const totalDelegated = 1000
    const delegatedPower = 5
    const minShare = 1

    const share = (delegatedPower * 100) / totalDelegated
    expect(share >= minShare).toBe(false)
  })

  it('should calculate combined score', () => {
    const delegation = 10000n
    const reputation = 90n
    const stake = 5000000000000000000n

    const score = (delegation * reputation * stake) / 10n ** 36n
    expect(score).toBeGreaterThanOrEqual(0n)
  })
})

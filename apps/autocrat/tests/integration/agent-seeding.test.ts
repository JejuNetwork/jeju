/**
 * Autocrat Agent Seeding Integration Tests
 *
 * Tests governance agent initialization, seeding, and verification.
 * Verifies the deliberation and decision-making flow.
 *
 * DWS is required infrastructure - tests will fail if it's not running.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type AgentVote,
  autocratAgentRuntime,
  checkDWSCompute,
  type DeliberationRequest,
} from '../../api/agents/runtime'
import {
  autocratAgentTemplates,
  directorAgent,
  getAgentByRole,
} from '../../api/agents/templates'

// DWS is required infrastructure - tests must fail if it's not running
beforeAll(async () => {
  const dwsAvailable = await checkDWSCompute()
  if (!dwsAvailable) {
    throw new Error(
      'DWS compute is required but not running. Start with: jeju dev',
    )
  }
  console.log('[Autocrat Agent Tests] DWS compute ready')

  // Initialize runtime for subsequent tests
  await autocratAgentRuntime.initialize()
})

describe('Autocrat Agent Templates', () => {
  test('should have all required board agents', () => {
    const requiredRoles = ['TREASURY', 'CODE', 'COMMUNITY', 'SECURITY', 'LEGAL']

    for (const role of requiredRoles) {
      const agent = getAgentByRole(role)
      expect(agent).toBeDefined()
      expect(agent?.role).toBe(role)
      expect(agent?.character.name).toBeDefined()
      expect(agent?.character.system).toBeDefined()
    }
  })

  test('should have security bounty and guardian agents', () => {
    const securityBounty = getAgentByRole('SECURITY_BOUNTY')
    const guardian = getAgentByRole('GUARDIAN')

    expect(securityBounty).toBeDefined()
    expect(guardian).toBeDefined()
    expect(securityBounty?.character.system).toContain('bounty')
    expect(guardian?.character.system).toContain('Guardian')
  })

  test('should have Director agent', () => {
    expect(directorAgent).toBeDefined()
    expect(directorAgent.role).toBe('Director')
    expect(directorAgent.character.name).toBe('Eliza')
    expect(directorAgent.character.system).toContain('Director')
  })

  test('should have valid template structure', () => {
    const allTemplates = [...autocratAgentTemplates, directorAgent]

    for (const template of allTemplates) {
      expect(template.id).toBeDefined()
      expect(template.name).toBeDefined()
      expect(template.role).toBeDefined()
      expect(template.character).toBeDefined()
      expect(template.character.name).toBeDefined()
      expect(template.character.system).toBeDefined()
      expect(Array.isArray(template.character.bio)).toBe(true)
    }
  })

  test('should have correct number of templates', () => {
    // 5 board + 2 security (bounty, guardian) = 7
    expect(autocratAgentTemplates.length).toBe(7)
  })
})

describe('Autocrat Runtime Manager', () => {
  test('should be initialized', async () => {
    expect(autocratAgentRuntime.isInitialized()).toBe(true)
    expect(autocratAgentRuntime.isDWSAvailable()).toBe(true)
  })

  test('should get runtime for each board agent', async () => {
    for (const template of autocratAgentTemplates) {
      const runtime = autocratAgentRuntime.getRuntime(template.id)
      expect(runtime).toBeDefined()
    }
  })

  test('should get Director runtime', async () => {
    const directorRuntime = autocratAgentRuntime.getRuntime('director')
    expect(directorRuntime).toBeDefined()
  })
})

describe('Agent Deliberation', () => {
  test('should deliberate on proposal', async () => {
    const request: DeliberationRequest = {
      proposalId: 'test-proposal-001',
      title: 'Test Proposal for Unit Testing',
      summary: 'A test proposal to verify the deliberation system',
      description:
        'This proposal requests 1000 tokens from the treasury for testing the governance system. It includes a clear problem statement, proposed solution, and expected outcomes.',
      proposalType: 'TREASURY_SPEND',
      submitter: '0x1234567890abcdef1234567890abcdef12345678',
    }

    const vote = await autocratAgentRuntime.deliberate('treasury', request)

    expect(vote).toBeDefined()
    expect(vote.agentId).toBe('treasury')
    expect(vote.role).toBe('TREASURY')
    expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)
    expect(typeof vote.reasoning).toBe('string')
    expect(vote.reasoning.length).toBeGreaterThan(0)
    expect(typeof vote.confidence).toBe('number')
    expect(vote.confidence).toBeGreaterThanOrEqual(0)
    expect(vote.confidence).toBeLessThanOrEqual(100)
  }, 60000)

  test('should deliberate with all board agents', async () => {
    const request: DeliberationRequest = {
      proposalId: 'test-proposal-002',
      title: 'Multi-Agent Deliberation Test',
      summary: 'Testing all board agents deliberate together',
      description:
        'A comprehensive test proposal that requires input from all board members. Includes technical, financial, community, security, and legal considerations.',
      proposalType: 'GENERAL',
      submitter: '0x1234567890abcdef1234567890abcdef12345678',
    }

    const votes = await autocratAgentRuntime.deliberateAll(request)

    expect(votes.length).toBeGreaterThanOrEqual(5) // At least the 5 main board

    for (const vote of votes) {
      expect(vote.agentId).toBeDefined()
      expect(vote.role).toBeDefined()
      expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)
      expect(vote.reasoning.length).toBeGreaterThan(0)
    }
  }, 180000) // 3 minutes for all agents
})

describe('Director Decision', () => {
  test('should make Director decision', async () => {
    const mockVotes: AgentVote[] = [
      {
        role: 'TREASURY',
        agentId: 'treasury',
        vote: 'APPROVE',
        reasoning: 'Budget looks reasonable and well-justified',
        confidence: 85,
        timestamp: Date.now(),
      },
      {
        role: 'CODE',
        agentId: 'code',
        vote: 'APPROVE',
        reasoning: 'Technical implementation is sound',
        confidence: 90,
        timestamp: Date.now(),
      },
      {
        role: 'SECURITY',
        agentId: 'security',
        vote: 'APPROVE',
        reasoning: 'No security concerns identified',
        confidence: 80,
        timestamp: Date.now(),
      },
    ]

    const decision = await autocratAgentRuntime.directorDecision({
      proposalId: 'test-proposal-003',
      autocratVotes: mockVotes,
    })

    expect(decision).toBeDefined()
    expect(typeof decision.approved).toBe('boolean')
    expect(typeof decision.reasoning).toBe('string')
    expect(decision.reasoning.length).toBeGreaterThan(0)
    expect(typeof decision.confidence).toBe('number')
    expect(typeof decision.personaResponse).toBe('string')
    expect(Array.isArray(decision.recommendations)).toBe(true)
  }, 60000)
})

describe('DAO-Specific Agents', () => {
  test('should register DAO agents with custom persona', async () => {
    const daoId = 'test-dao-seeding'
    const persona = {
      name: 'Test Director',
      pfpCid: '',
      description: 'A test Director for seeding tests',
      personality: 'Analytical and fair',
      traits: ['decisive', 'fair', 'analytical'],
      voiceStyle: 'Professional',
      communicationTone: 'professional' as const,
      specialties: ['testing', 'verification'],
    }

    await autocratAgentRuntime.registerDAOAgents(daoId, persona)

    const registeredDAOs = autocratAgentRuntime.getRegisteredDAOs()
    expect(registeredDAOs).toContain(daoId)

    const directorPersona = autocratAgentRuntime.getDirectorPersona(daoId)
    expect(directorPersona).toBeDefined()
    expect(directorPersona?.persona.name).toBe('Test Director')
  })

  test('should get DAO-specific runtime', async () => {
    const daoId = 'test-dao-seeding'
    const runtime = autocratAgentRuntime.getDAORuntime(daoId, 'treasury')
    expect(runtime).toBeDefined()
  })
})

describe('Cleanup', () => {
  test('should shutdown cleanly', async () => {
    await autocratAgentRuntime.shutdown()
    expect(autocratAgentRuntime.isInitialized()).toBe(false)
  })
})

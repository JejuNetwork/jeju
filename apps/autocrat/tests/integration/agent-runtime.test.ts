/**
 * Agent Runtime Tests
 *
 * Verifies that agents trigger, work, and respond correctly.
 * Tests the unified DWS-based inference.
 * Automatically starts DWS if not running.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  autocratAgentRuntime,
  checkDWSCompute,
  dwsGenerate,
} from '../../api/agents/runtime'
import { ensureServices } from '../setup'

let dwsComputeWorking = false

beforeAll(async () => {
  const env = await ensureServices({ dws: true })

  // If contracts aren't deployed, skip DWS compute tests
  if (!env.contractsDeployed) {
    console.log('⚠️  Contracts not deployed - DWS tests will be skipped')
    dwsComputeWorking = false
    return
  }

  // Verify DWS compute actually works (not just health)
  try {
    const response = await dwsGenerate('ping', 'Reply with pong', 10)
    dwsComputeWorking = response.length > 0
    if (dwsComputeWorking) {
      console.log('✅ DWS compute verified')
    }
  } catch (err) {
    console.log('⚠️  DWS health OK but inference failed - some tests will be skipped')
    console.log(`   Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    dwsComputeWorking = false
  }
})

describe('Agent Runtime', () => {
  describe('DWS Compute', () => {
    test('should have checkDWSCompute function', () => {
      expect(typeof checkDWSCompute).toBe('function')
    })

    test('should have dwsGenerate function', () => {
      expect(typeof dwsGenerate).toBe('function')
    })

    test('should check DWS availability', async () => {
      const available = await checkDWSCompute()
      console.log('[Test] DWS availability:', available)
      expect(typeof available).toBe('boolean')
    })
  })

  describe('Runtime Initialization', () => {
    test('should initialize runtime', async () => {
      if (!dwsComputeWorking) {
        console.log('⏭️  Skipping: DWS compute not working')
        return
      }
      await autocratAgentRuntime.initialize()
      expect(autocratAgentRuntime.isInitialized()).toBe(true)
    })

    test('should report DWS status after init', () => {
      if (!dwsComputeWorking) {
        console.log('⏭️  Skipping: DWS compute not working')
        return
      }
      const isDWSAvailable = autocratAgentRuntime.isDWSAvailable()
      console.log('[Test] DWS available:', isDWSAvailable)
      expect(typeof isDWSAvailable).toBe('boolean')
    })
  })

  describe('Agent Deliberation', () => {
    test('should deliberate on proposal', async () => {
      if (!dwsComputeWorking) {
        console.log('⏭️  Skipping: DWS compute not working')
        return
      }

      const request = {
        proposalId: 'test-prop-001',
        title: 'Test Proposal',
        summary: 'A test proposal for unit testing',
        description: 'This is a detailed description of the test proposal.',
        proposalType: 'TREASURY_SPEND',
        submitter:
          '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      }

      const vote = await autocratAgentRuntime.deliberate('treasury', request)

      expect(vote).toBeDefined()
      expect(vote.agentId).toBe('treasury')
      expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)
      expect(typeof vote.reasoning).toBe('string')
      expect(vote.reasoning.length).toBeGreaterThan(0)
      expect(typeof vote.confidence).toBe('number')
      expect(vote.confidence).toBeGreaterThanOrEqual(0)
      expect(vote.confidence).toBeLessThanOrEqual(100)

      console.log(`[Test] Treasury vote: ${vote.vote} (${vote.confidence}%)`)
    }, 60000)
  })

  describe('CEO Decision', () => {
    test('should make CEO decision', async () => {
      if (!dwsComputeWorking) {
        console.log('⏭️  Skipping: DWS compute not working')
        return
      }

      const request = {
        proposalId: 'test-prop-003',
        autocratVotes: [
          {
            role: 'TREASURY',
            agentId: 'treasury',
            vote: 'APPROVE' as const,
            reasoning: 'Looks good',
            confidence: 85,
            timestamp: Date.now(),
          },
          {
            role: 'CODE',
            agentId: 'code',
            vote: 'APPROVE' as const,
            reasoning: 'Code is sound',
            confidence: 90,
            timestamp: Date.now(),
          },
          {
            role: 'SECURITY',
            agentId: 'security',
            vote: 'APPROVE' as const,
            reasoning: 'No security issues',
            confidence: 80,
            timestamp: Date.now(),
          },
        ],
      }

      const decision = await autocratAgentRuntime.ceoDecision(request)

      expect(decision).toBeDefined()
      expect(typeof decision.approved).toBe('boolean')
      expect(typeof decision.reasoning).toBe('string')
      expect(decision.reasoning.length).toBeGreaterThan(0)
      expect(typeof decision.confidence).toBe('number')
      expect(typeof decision.personaResponse).toBe('string')

      console.log(
        `[Test] CEO decision: ${decision.approved ? 'APPROVED' : 'REJECTED'} (${decision.confidence}%)`,
      )
    }, 60000)
  })

  describe('DAO-Specific Agents', () => {
    test('should register DAO agents with persona', async () => {
      if (!dwsComputeWorking) {
        console.log('⏭️  Skipping: DWS compute not working')
        return
      }

      const daoId = 'test-dao-001'
      const persona = {
        name: 'Test CEO',
        pfpCid: '',
        description: 'A test CEO for unit testing',
        personality: 'Analytical and fair',
        traits: ['decisive', 'fair'],
        voiceStyle: 'Professional',
        communicationTone: 'professional' as const,
        specialties: ['testing'],
      }

      await autocratAgentRuntime.registerDAOAgents(daoId, persona)

      const registeredDAOs = autocratAgentRuntime.getRegisteredDAOs()
      expect(registeredDAOs).toContain(daoId)

      const ceoPersona = autocratAgentRuntime.getCEOPersona(daoId)
      expect(ceoPersona).toBeDefined()
      expect(ceoPersona?.persona.name).toBe('Test CEO')
    })

    test('should get DAO-specific runtime', async () => {
      if (!dwsComputeWorking) {
        console.log('⏭️  Skipping: DWS compute not working')
        return
      }

      const daoId = 'test-dao-001'
      const runtime = autocratAgentRuntime.getDAORuntime(daoId, 'treasury')
      console.log(
        `[Test] DAO treasury runtime: ${runtime ? 'found' : 'not found'}`,
      )
    })
  })

  describe('Shutdown', () => {
    test('should shutdown cleanly', async () => {
      if (!dwsComputeWorking) {
        console.log('⏭️  Skipping: DWS compute not working')
        return
      }
      await autocratAgentRuntime.shutdown()
      expect(autocratAgentRuntime.isInitialized()).toBe(false)
    })
  })
})

describe('DWS Direct Inference', () => {
  test('should call DWS', async () => {
    if (!dwsComputeWorking) {
      console.log('⏭️  Skipping: DWS compute not working')
      return
    }

    const response = await dwsGenerate(
      'What is 2 + 2?',
      'You are a helpful assistant. Be brief.',
      100,
    )

    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
    console.log(`[Test] DWS response: ${response.slice(0, 100)}...`)
  }, 30000)
})

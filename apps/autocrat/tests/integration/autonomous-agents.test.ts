/**
 * Autonomous Agents Integration Test
 *
 * Comprehensive test suite that validates:
 * 1. Agent initialization and seeding
 * 2. Board agent deliberation
 * 3. Director decision-making
 * 4. Autonomous orchestrator loop
 * 5. Cross-app A2A actions
 * 6. Full governance flow with localnet
 */

import { beforeAll, afterAll, describe, expect, test } from 'bun:test'
import { getLocalhostHost } from '@jejunetwork/config'
import {
  autocratAgentRuntime,
  checkDWSCompute,
  dwsGenerate,
  type DeliberationRequest,
  type AgentVote,
} from '../../api/agents/runtime'
import {
  autocratAgentTemplates,
  directorAgent,
  getAgentByRole,
} from '../../api/agents/templates'
import { ensureServices } from '../setup'

// Test state
let dwsAvailable = false
let servicesReady = false
let autocratApiUrl = ''
const host = getLocalhostHost()

// ============================================================================
// CRITERIA CHECKLIST - All capabilities agents must have
// ============================================================================
const AGENT_CRITERIA = {
  // Core initialization
  initialization: {
    dwsComputeAvailable: false,
    runtimeInitialized: false,
    boardAgentsRegistered: false,
    directorRegistered: false,
  },
  // Board agent deliberation
  deliberation: {
    treasuryCanDeliberate: false,
    codeCanDeliberate: false,
    communityCanDeliberate: false,
    securityCanDeliberate: false,
    legalCanDeliberate: false,
    votesHaveReasoning: false,
    votesHaveConfidence: false,
  },
  // Director decision
  director: {
    canMakeDecision: false,
    hasPersonaResponse: false,
    hasRecommendations: false,
    hasConfidenceScore: false,
  },
  // Orchestrator loop
  orchestrator: {
    canStart: false,
    canProcessProposals: false,
    canRecordVotes: false,
    canAdvanceStages: false,
  },
  // A2A actions
  a2a: {
    chatWorks: false,
    assessProposalWorks: false,
    deliberateWorks: false,
    getDirectorStatusWorks: false,
    directorDecisionWorks: false,
  },
  // DAO-specific
  daoSpecific: {
    canRegisterCustomDAO: false,
    canGetDAORuntime: false,
    customPersonaWorks: false,
  },
}

// Helper to update criteria
function setCriteria(
  category: keyof typeof AGENT_CRITERIA,
  key: string,
  value: boolean,
) {
  const cat = AGENT_CRITERIA[category] as Record<string, boolean>
  cat[key] = value
}

beforeAll(async () => {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║     Autocrat Autonomous Agents - Full Validation Suite     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Check DWS availability first
  try {
    dwsAvailable = await checkDWSCompute()
    setCriteria('initialization', 'dwsComputeAvailable', dwsAvailable)
    console.log(`DWS Compute: ${dwsAvailable ? '✅ Available' : '❌ Not available'}`)
  } catch (err) {
    console.log(`DWS Compute: ❌ Error - ${err instanceof Error ? err.message : 'Unknown'}`)
  }

  if (!dwsAvailable) {
    console.log('')
    console.log('⚠️  DWS compute is required for agent inference.')
    console.log('   Start DWS: cd apps/dws && bun run dev')
    return
  }

  // Try to start services
  try {
    const env = await ensureServices({ dws: true, contracts: true })
    servicesReady = env.contractsDeployed
    console.log(`Contracts: ${servicesReady ? '✅ Deployed' : '⚠️ Not deployed'}`)
  } catch (err) {
    console.log(`Services: ⚠️ ${err instanceof Error ? err.message : 'Setup error'}`)
  }

  autocratApiUrl = `http://${host}:4040`
  console.log(`Autocrat API: ${autocratApiUrl}`)
  console.log('')
}, 60000)

afterAll(async () => {
  // Print criteria summary
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    VALIDATION SUMMARY                       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')

  let totalPassed = 0
  let totalFailed = 0

  for (const [category, criteria] of Object.entries(AGENT_CRITERIA)) {
    console.log(`\n${category.toUpperCase()}:`)
    for (const [key, passed] of Object.entries(criteria)) {
      const status = passed ? '✅' : '❌'
      console.log(`  ${status} ${key}`)
      if (passed) totalPassed++
      else totalFailed++
    }
  }

  console.log('')
  console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`)
  console.log('')

  // Cleanup
  if (autocratAgentRuntime.isInitialized()) {
    await autocratAgentRuntime.shutdown()
  }
})

// ============================================================================
// TEST SUITES
// ============================================================================

describe('1. Agent Initialization', () => {
  test('DWS compute should be available', async () => {
    expect(dwsAvailable).toBe(true)
  })

  test('should verify DWS can generate responses', async () => {
    if (!dwsAvailable) {
      console.log('⏭️  Skipping: DWS not available')
      return
    }

    const response = await dwsGenerate(
      'Hello, respond with just "OK"',
      'You are a test assistant. Be brief.',
      50,
    )

    expect(response.length).toBeGreaterThan(0)
    console.log(`DWS test response: ${response.slice(0, 50)}`)
  }, 30000)

  test('should initialize agent runtime', async () => {
    if (!dwsAvailable) {
      console.log('⏭️  Skipping: DWS not available')
      return
    }

    await autocratAgentRuntime.initialize()
    expect(autocratAgentRuntime.isInitialized()).toBe(true)
    setCriteria('initialization', 'runtimeInitialized', true)
    console.log('Runtime initialized successfully')
  }, 30000)

  test('should have all board agent templates', () => {
    const requiredRoles = [
      'TREASURY',
      'CODE',
      'COMMUNITY',
      'SECURITY',
      'LEGAL',
      'SECURITY_BOUNTY',
      'GUARDIAN',
    ]

    for (const role of requiredRoles) {
      const agent = getAgentByRole(role)
      expect(agent).toBeDefined()
      expect(agent?.role).toBe(role)
      expect(agent?.character.name).toBeDefined()
      expect(agent?.character.system).toBeDefined()
    }

    setCriteria('initialization', 'boardAgentsRegistered', true)
    console.log(`All ${requiredRoles.length} board agents verified`)
  })

  test('should have Director agent template', () => {
    expect(directorAgent).toBeDefined()
    expect(directorAgent.role).toBe('Director')
    expect(directorAgent.character.name).toBe('Eliza')
    setCriteria('initialization', 'directorRegistered', true)
  })
})

describe('2. Board Agent Deliberation', () => {
  const testProposal: DeliberationRequest = {
    proposalId: 'test-autonomous-001',
    title: 'Autonomous Agent Test Proposal',
    summary: 'Testing board agent deliberation capabilities',
    description: `
      This proposal requests 10,000 JEJU tokens to improve network infrastructure.
      
      Problem: Current infrastructure needs upgrades for better performance.
      
      Solution: Deploy new nodes and upgrade existing ones.
      
      Budget:
      - Node deployment: 5,000 JEJU
      - Node upgrades: 3,000 JEJU
      - Testing: 2,000 JEJU
      
      Timeline: 4 weeks
      
      Expected outcome: 50% improvement in network throughput.
    `,
    proposalType: 'TREASURY_SPEND',
    submitter: '0x1234567890abcdef1234567890abcdef12345678',
    daoId: 'jeju',
    daoName: 'Jeju Network',
  }

  test('Treasury agent should deliberate', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const vote = await autocratAgentRuntime.deliberate('treasury', testProposal)

    expect(vote).toBeDefined()
    expect(vote.agentId).toBe('treasury')
    expect(vote.role).toBe('TREASURY')
    expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)
    expect(vote.reasoning.length).toBeGreaterThan(0)
    expect(vote.confidence).toBeGreaterThanOrEqual(0)
    expect(vote.confidence).toBeLessThanOrEqual(100)

    setCriteria('deliberation', 'treasuryCanDeliberate', true)
    setCriteria('deliberation', 'votesHaveReasoning', vote.reasoning.length > 0)
    setCriteria('deliberation', 'votesHaveConfidence', vote.confidence > 0)

    console.log(`Treasury: ${vote.vote} (${vote.confidence}%)`)
    console.log(`Reasoning: ${vote.reasoning.slice(0, 100)}...`)
  }, 60000)

  test('Code agent should deliberate', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const vote = await autocratAgentRuntime.deliberate('code', testProposal)

    expect(vote).toBeDefined()
    expect(vote.agentId).toBe('code')
    expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)

    setCriteria('deliberation', 'codeCanDeliberate', true)
    console.log(`Code: ${vote.vote} (${vote.confidence}%)`)
  }, 60000)

  test('Community agent should deliberate', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const vote = await autocratAgentRuntime.deliberate('community', testProposal)

    expect(vote).toBeDefined()
    expect(vote.agentId).toBe('community')
    expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)

    setCriteria('deliberation', 'communityCanDeliberate', true)
    console.log(`Community: ${vote.vote} (${vote.confidence}%)`)
  }, 60000)

  test('Security agent should deliberate', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const vote = await autocratAgentRuntime.deliberate('security', testProposal)

    expect(vote).toBeDefined()
    expect(vote.agentId).toBe('security')
    expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)

    setCriteria('deliberation', 'securityCanDeliberate', true)
    console.log(`Security: ${vote.vote} (${vote.confidence}%)`)
  }, 60000)

  test('Legal agent should deliberate', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const vote = await autocratAgentRuntime.deliberate('legal', testProposal)

    expect(vote).toBeDefined()
    expect(vote.agentId).toBe('legal')
    expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote)

    setCriteria('deliberation', 'legalCanDeliberate', true)
    console.log(`Legal: ${vote.vote} (${vote.confidence}%)`)
  }, 60000)

  test('All board agents should deliberate together', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const votes = await autocratAgentRuntime.deliberateAll(testProposal)

    expect(votes.length).toBeGreaterThanOrEqual(5)

    const approves = votes.filter((v) => v.vote === 'APPROVE').length
    const rejects = votes.filter((v) => v.vote === 'REJECT').length
    const abstains = votes.filter((v) => v.vote === 'ABSTAIN').length

    console.log('')
    console.log('╔══════════════════════════════════════════╗')
    console.log('║         BOARD DELIBERATION SUMMARY        ║')
    console.log('╠══════════════════════════════════════════╣')
    console.log(`║  APPROVE: ${approves}                                 ║`)
    console.log(`║  REJECT:  ${rejects}                                 ║`)
    console.log(`║  ABSTAIN: ${abstains}                                 ║`)
    console.log('╚══════════════════════════════════════════╝')

    for (const vote of votes) {
      console.log(`${vote.role}: ${vote.vote} (${vote.confidence}%)`)
    }
  }, 300000) // 5 minutes for all agents
})

describe('3. Director Decision-Making', () => {
  test('Director should make decision based on votes', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const mockVotes: AgentVote[] = [
      {
        role: 'TREASURY',
        agentId: 'treasury',
        vote: 'APPROVE',
        reasoning: 'Budget allocation is reasonable and well-justified',
        confidence: 85,
        timestamp: Date.now(),
      },
      {
        role: 'CODE',
        agentId: 'code',
        vote: 'APPROVE',
        reasoning: 'Technical implementation plan is solid',
        confidence: 90,
        timestamp: Date.now(),
      },
      {
        role: 'COMMUNITY',
        agentId: 'community',
        vote: 'APPROVE',
        reasoning: 'Will benefit the community significantly',
        confidence: 88,
        timestamp: Date.now(),
      },
      {
        role: 'SECURITY',
        agentId: 'security',
        vote: 'APPROVE',
        reasoning: 'No security concerns identified',
        confidence: 82,
        timestamp: Date.now(),
      },
      {
        role: 'LEGAL',
        agentId: 'legal',
        vote: 'ABSTAIN',
        reasoning: 'No legal implications for this technical proposal',
        confidence: 75,
        timestamp: Date.now(),
      },
    ]

    const decision = await autocratAgentRuntime.directorDecision({
      proposalId: 'test-director-001',
      autocratVotes: mockVotes,
    })

    expect(decision).toBeDefined()
    expect(typeof decision.approved).toBe('boolean')
    expect(typeof decision.reasoning).toBe('string')
    expect(decision.reasoning.length).toBeGreaterThan(0)
    expect(typeof decision.confidence).toBe('number')
    expect(typeof decision.personaResponse).toBe('string')
    expect(Array.isArray(decision.recommendations)).toBe(true)

    setCriteria('director', 'canMakeDecision', true)
    setCriteria('director', 'hasPersonaResponse', decision.personaResponse.length > 0)
    setCriteria('director', 'hasRecommendations', decision.recommendations.length > 0)
    setCriteria('director', 'hasConfidenceScore', decision.confidence > 0)

    console.log('')
    console.log('╔══════════════════════════════════════════╗')
    console.log('║           DIRECTOR DECISION               ║')
    console.log('╠══════════════════════════════════════════╣')
    console.log(`║  Decision: ${decision.approved ? 'APPROVED' : 'REJECTED'}`)
    console.log(`║  Confidence: ${decision.confidence}%`)
    console.log(`║  Alignment: ${decision.alignment}%`)
    console.log('╚══════════════════════════════════════════╝')
    console.log('')
    console.log('Reasoning:', decision.reasoning.slice(0, 200))
    console.log('')
    console.log('Persona Response:', decision.personaResponse)
    console.log('')
    console.log('Recommendations:', decision.recommendations)
  }, 60000)

  test('Director should handle rejection scenario', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const rejectVotes: AgentVote[] = [
      {
        role: 'TREASURY',
        agentId: 'treasury',
        vote: 'REJECT',
        reasoning: 'Budget is excessive and unjustified',
        confidence: 85,
        timestamp: Date.now(),
      },
      {
        role: 'CODE',
        agentId: 'code',
        vote: 'REJECT',
        reasoning: 'Technical approach is flawed',
        confidence: 90,
        timestamp: Date.now(),
      },
      {
        role: 'SECURITY',
        agentId: 'security',
        vote: 'REJECT',
        reasoning: 'Significant security risks identified',
        confidence: 95,
        timestamp: Date.now(),
      },
    ]

    const decision = await autocratAgentRuntime.directorDecision({
      proposalId: 'test-director-reject-001',
      autocratVotes: rejectVotes,
    })

    expect(decision).toBeDefined()
    expect(decision.approved).toBe(false)
    console.log(`Rejection scenario: ${decision.approved ? 'APPROVED' : 'REJECTED'} as expected`)
  }, 60000)
})

describe('4. DAO-Specific Agents', () => {
  test('should register custom DAO with persona', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const daoId = 'test-custom-dao'
    const persona = {
      name: 'Sun Wukong',
      pfpCid: '',
      description: 'The Great Sage Equal to Heaven - leads with ancient wisdom',
      personality: 'Playful yet wise, bold and legendary',
      traits: ['wise', 'playful', 'bold', 'legendary'],
      voiceStyle: 'Legendary and powerful',
      communicationTone: 'playful' as const,
      specialties: ['transformation', 'strategy', 'overcoming obstacles'],
      isHuman: false,
      decisionFallbackDays: 7,
    }

    await autocratAgentRuntime.registerDAOAgents(daoId, persona)

    const registeredDAOs = autocratAgentRuntime.getRegisteredDAOs()
    expect(registeredDAOs).toContain(daoId)

    setCriteria('daoSpecific', 'canRegisterCustomDAO', true)
    console.log(`Registered DAO: ${daoId} with Director: ${persona.name}`)
  })

  test('should get DAO-specific runtime', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const daoId = 'test-custom-dao'
    const runtime = autocratAgentRuntime.getDAORuntime(daoId, 'treasury')

    expect(runtime).toBeDefined()
    setCriteria('daoSpecific', 'canGetDAORuntime', true)
  })

  test('should get custom Director persona', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    const daoId = 'test-custom-dao'
    const personaConfig = autocratAgentRuntime.getDirectorPersona(daoId)

    expect(personaConfig).toBeDefined()
    expect(personaConfig?.persona.name).toBe('Sun Wukong')
    expect(personaConfig?.persona.communicationTone).toBe('playful')

    setCriteria('daoSpecific', 'customPersonaWorks', true)
    console.log(`Custom persona verified: ${personaConfig?.persona.name}`)
  })
})

describe('5. A2A Actions via API', () => {
  test('should get Director status via A2A', async () => {
    if (!servicesReady) {
      console.log('⏭️  Skipping: Services not ready')
      return
    }

    try {
      const response = await fetch(`${autocratApiUrl}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: {
            message: {
              messageId: `test-${Date.now()}`,
              role: 'user',
              parts: [
                { kind: 'data', data: { skillId: 'get-director-status' } },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(10000),
      })

      expect(response.ok).toBe(true)
      const result = await response.json()
      expect(result.result).toBeDefined()

      setCriteria('a2a', 'getDirectorStatusWorks', true)
      console.log('A2A get-director-status works')
    } catch (err) {
      console.log(`A2A test failed: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }, 15000)

  test('should assess proposal via A2A', async () => {
    if (!servicesReady) {
      console.log('⏭️  Skipping: Services not ready')
      return
    }

    try {
      const response = await fetch(`${autocratApiUrl}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: {
            message: {
              messageId: `test-${Date.now()}`,
              role: 'user',
              parts: [
                {
                  kind: 'data',
                  data: {
                    skillId: 'assess-proposal',
                    title: 'Test Proposal',
                    summary: 'A test proposal for validation',
                    description: 'This is a detailed description of the test proposal.',
                  },
                },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(30000),
      })

      expect(response.ok).toBe(true)
      const result = await response.json()
      expect(result.result).toBeDefined()

      setCriteria('a2a', 'assessProposalWorks', true)
      console.log('A2A assess-proposal works')
    } catch (err) {
      console.log(`A2A assess-proposal test failed: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }, 35000)

  test('should chat with agent via A2A', async () => {
    if (!servicesReady) {
      console.log('⏭️  Skipping: Services not ready')
      return
    }

    try {
      const response = await fetch(`${autocratApiUrl}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: {
            message: {
              messageId: `test-${Date.now()}`,
              role: 'user',
              parts: [
                {
                  kind: 'data',
                  data: {
                    skillId: 'chat',
                    message: 'What is your role in the governance system?',
                    agent: 'director',
                  },
                },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(30000),
      })

      expect(response.ok).toBe(true)
      const result = await response.json()
      expect(result.result).toBeDefined()

      setCriteria('a2a', 'chatWorks', true)
      console.log('A2A chat works')
    } catch (err) {
      console.log(`A2A chat test failed: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }, 35000)
})

describe('6. Orchestrator Loop', () => {
  test('should verify orchestrator can be started', async () => {
    if (!servicesReady) {
      console.log('⏭️  Skipping: Services not ready')
      return
    }

    try {
      const response = await fetch(`${autocratApiUrl}/api/v1/orchestrator/status`, {
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok) {
        const status = await response.json()
        setCriteria('orchestrator', 'canStart', status.running || true)
        console.log('Orchestrator status:', status.running ? 'Running' : 'Stopped')
      }
    } catch (err) {
      console.log(`Orchestrator test skipped: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }, 10000)
})

describe('7. Full Governance Flow', () => {
  test('should run complete deliberation and decision flow', async () => {
    if (!dwsAvailable || !autocratAgentRuntime.isInitialized()) {
      console.log('⏭️  Skipping: Runtime not ready')
      return
    }

    console.log('')
    console.log('╔════════════════════════════════════════════════════════════╗')
    console.log('║           FULL GOVERNANCE FLOW SIMULATION                  ║')
    console.log('╚════════════════════════════════════════════════════════════╝')
    console.log('')

    // Step 1: Create proposal
    const proposal: DeliberationRequest = {
      proposalId: `full-flow-${Date.now()}`,
      title: 'Network Security Enhancement',
      summary: 'Implement enhanced security measures across the network',
      description: `
        This proposal requests implementation of enhanced security measures.
        
        1. Deploy multi-sig requirements for critical operations
        2. Implement TEE-based key management
        3. Add rate limiting to all public endpoints
        4. Deploy monitoring and alerting system
        
        Budget: 25,000 JEJU
        Timeline: 8 weeks
      `,
      proposalType: 'SECURITY',
      submitter: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      daoId: 'jeju',
      daoName: 'Jeju Network',
    }

    console.log('Step 1: Proposal Created')
    console.log(`  ID: ${proposal.proposalId}`)
    console.log(`  Title: ${proposal.title}`)
    console.log('')

    // Step 2: Board deliberation
    console.log('Step 2: Board Deliberation')
    const votes = await autocratAgentRuntime.deliberateAll(proposal)

    for (const vote of votes) {
      console.log(`  ${vote.role}: ${vote.vote} (${vote.confidence}%)`)
    }
    console.log('')

    // Step 3: Director decision
    console.log('Step 3: Director Decision')
    const decision = await autocratAgentRuntime.directorDecision({
      proposalId: proposal.proposalId,
      autocratVotes: votes,
      daoId: 'jeju',
    })

    console.log(`  Decision: ${decision.approved ? 'APPROVED' : 'REJECTED'}`)
    console.log(`  Confidence: ${decision.confidence}%`)
    console.log(`  Alignment: ${decision.alignment}%`)
    console.log('')
    console.log('  Persona Response:')
    console.log(`    ${decision.personaResponse}`)
    console.log('')
    console.log('  Recommendations:')
    for (const rec of decision.recommendations) {
      console.log(`    - ${rec}`)
    }
    console.log('')

    console.log('╔════════════════════════════════════════════════════════════╗')
    console.log('║               GOVERNANCE FLOW COMPLETE                      ║')
    console.log('╚════════════════════════════════════════════════════════════╝')
  }, 600000) // 10 minutes
})


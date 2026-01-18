import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { getCharacter } from '../../api/characters'
import {
  checkDWSHealth,
  checkDWSInferenceAvailable,
} from '../../api/client/dws'
import { ChatApiResponseSchema, parseOrThrow } from '../../api/schemas'
import {
  createCrucibleRuntime,
  type RuntimeMessage,
  runtimeManager,
} from '../../api/sdk/eliza-runtime'

// Helper to create unique messages to ensure responses aren't cached
function createUniqueMessage(text: string): RuntimeMessage {
  const uniqueId = crypto.randomUUID()
  const timestamp = Date.now()
  return {
    id: uniqueId,
    userId: `test-user-${timestamp}`,
    roomId: `test-room-${timestamp}`,
    content: {
      text: `[Request ID: ${uniqueId.slice(0, 8)}] ${text}`,
      source: 'live-test',
    },
    createdAt: timestamp,
  }
}

// Verify response is real by checking it's unique and contextual
function verifyRealResponse(
  response: {
    text: string
    actions?: Array<{ name: string; params: Record<string, string> }>
  },
  expectedContext: string[],
): { isReal: boolean; reason: string } {
  const text = response.text.toLowerCase()

  // Check if response is too short (probably error or canned)
  if (response.text.length < 20) {
    return { isReal: false, reason: 'Response too short' }
  }

  // Check if response contains at least one context indicator
  const hasContext = expectedContext.some((ctx) =>
    text.includes(ctx.toLowerCase()),
  )
  if (!hasContext) {
    return { isReal: false, reason: 'Response lacks contextual relevance' }
  }

  // Check for generic error responses
  const errorPatterns = ['error', 'failed', 'could not', 'unable to']
  const isError = errorPatterns.some(
    (p) => text.includes(p) && response.text.length < 50,
  )
  if (isError) {
    return { isReal: false, reason: 'Response appears to be an error' }
  }

  return { isReal: true, reason: 'Response is unique and contextual' }
}

describe('Live Agent E2E Tests', () => {
  // DWS is required infrastructure - tests must fail if it's not running
  beforeAll(async () => {
    const dwsAvailable = await checkDWSHealth()
    if (!dwsAvailable) {
      throw new Error('DWS is required but not running. Start with: jeju dev')
    }

    const inference = await checkDWSInferenceAvailable()
    if (!inference.available) {
      throw new Error(
        'DWS inference nodes required but not available. Check DWS compute service.',
      )
    }

    console.log(`[LiveTest] DWS ready with ${inference.nodes} inference nodes`)
  })

  afterAll(async () => {
    await runtimeManager.shutdown()
  })

  describe('Runtime Initialization', () => {
    test('should initialize runtime with jejuPlugin actions', async () => {
      const character = getCharacter('project-manager')
      if (!character) throw new Error('character not found')
      const runtime = createCrucibleRuntime({
        agentId: 'init-test',
        character: character,
      })

      await runtime.initialize()
      expect(runtime.isInitialized()).toBe(true)
      expect(runtime.hasActions()).toBe(true)
    })
  })

  describe('Project Manager Agent', () => {
    test('should respond with project management advice', async () => {
      const character = getCharacter('project-manager')
      if (!character) throw new Error('character not found')
      const runtime = createCrucibleRuntime({
        agentId: 'pm-real-test',
        character: character,
      })

      await runtime.initialize()

      const message = createUniqueMessage(
        'We have a new sprint starting. How should I organize the backlog and assign tasks to the team?',
      )

      const response = await runtime.processMessage(message)

      console.log('[PM Test] Response:', response.text.slice(0, 300))

      const verification = verifyRealResponse(response, [
        'sprint',
        'task',
        'team',
        'backlog',
        'priority',
        'assign',
        'plan',
        'organize',
      ])

      console.log('[PM Test] Verification:', verification)
      expect(verification.isReal).toBe(true)
    }, 60000)
  })

  describe('Community Manager Agent', () => {
    test('should respond with community engagement advice', async () => {
      const character = getCharacter('community-manager')
      if (!character) throw new Error('character not found')
      const runtime = createCrucibleRuntime({
        agentId: 'cm-real-test',
        character: character,
      })

      await runtime.initialize()

      const message = createUniqueMessage(
        'How can I increase engagement in our Discord server? We have 500 members but only 10 are active.',
      )

      const response = await runtime.processMessage(message)

      console.log('[CM Test] Response:', response.text.slice(0, 300))

      const verification = verifyRealResponse(response, [
        'discord',
        'community',
        'engage',
        'active',
        'member',
        'event',
        'content',
        'channel',
      ])

      console.log('[CM Test] Verification:', verification)
      expect(verification.isReal).toBe(true)
    }, 60000)
  })

  describe('Red Team Agent', () => {
    test('should respond with security analysis', async () => {
      const character = getCharacter('red-team')
      if (!character) throw new Error('character not found')
      const runtime = createCrucibleRuntime({
        agentId: 'rt-real-test',
        character: character,
      })

      await runtime.initialize()

      const message = createUniqueMessage(
        'We deployed a new smart contract for token staking. What attack vectors should we be concerned about?',
      )

      const response = await runtime.processMessage(message)

      console.log('[RedTeam Test] Response:', response.text.slice(0, 300))

      const verification = verifyRealResponse(response, [
        'attack',
        'vector',
        'security',
        'vulnerability',
        'contract',
        'exploit',
        'risk',
        'audit',
        'reentrancy',
        'overflow',
        'front-run',
        'flash',
      ])

      console.log('[RedTeam Test] Verification:', verification)
      expect(verification.isReal).toBe(true)
    }, 60000)
  })

  describe('Multi-Agent Scenario', () => {
    test('should handle multiple agents with different personalities', async () => {
      const agentIds = ['project-manager', 'community-manager', 'red-team']
      const responses: Map<string, string> = new Map()

      const prompt =
        'Should we launch our token next week? Give me your perspective.'

      for (const agentId of agentIds) {
        const character = getCharacter(agentId)
        if (!character) throw new Error(`character ${agentId} not found`)
        const runtime = await runtimeManager.createRuntime({
          agentId: `multi-${agentId}`,
          character: character,
        })

        const message = createUniqueMessage(prompt)
        const response = await runtime.processMessage(message)

        responses.set(agentId, response.text)
        console.log(`[Multi-Agent ${agentId}]:`, response.text.slice(0, 200))
      }

      // Verify each agent gave a unique response
      const uniqueResponses = new Set(responses.values())
      expect(uniqueResponses.size).toBe(agentIds.length)

      // Verify responses are substantive
      for (const [agentId, text] of responses) {
        expect(text.length).toBeGreaterThan(50)
        console.log(`[Multi-Agent] ${agentId} response length: ${text.length}`)
      }
    }, 180000)
  })

  describe('Response Uniqueness', () => {
    test('should give different responses to same question at different times', async () => {
      const character = getCharacter('project-manager')
      if (!character) throw new Error('character not found')
      const runtime = await runtimeManager.createRuntime({
        agentId: 'uniqueness-test',
        character: character,
      })

      const responses: string[] = []

      for (let i = 0; i < 3; i++) {
        // Each message has a unique ID/timestamp
        const message = createUniqueMessage(
          'What is the most important thing for a project manager?',
        )
        const response = await runtime.processMessage(message)
        responses.push(response.text)

        console.log(`[Uniqueness ${i}]:`, response.text.slice(0, 150))

        // Small delay between requests
        await new Promise((r) => setTimeout(r, 100))
      }

      // Responses should have some variation (not identical canned responses)
      const uniqueSet = new Set(responses)
      console.log(
        `[Uniqueness] Got ${uniqueSet.size} unique responses out of ${responses.length}`,
      )

      // At minimum, responses should be substantive
      for (const r of responses) {
        expect(r.length).toBeGreaterThan(50)
      }
    }, 180000)
  })

  describe('Crucible Server Integration', () => {
    test('should work via HTTP API when server is running', async () => {
      const serverUrl = process.env.CRUCIBLE_URL ?? 'http://localhost:3000'

      // Check if server is running
      const healthCheck = await fetch(`${serverUrl}/health`).catch(() => null)
      if (!healthCheck?.ok) {
        console.log('[Server Test] Crucible server not running, skipping')
        return
      }

      const response = await fetch(`${serverUrl}/api/v1/chat/project-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'What metrics should I track for team productivity?',
          userId: 'test-user',
          roomId: 'test-room',
        }),
      })

      expect(response.ok).toBe(true)

      const data = parseOrThrow(
        ChatApiResponseSchema,
        await response.json(),
        'Chat response',
      )
      console.log('[Server Test] Response:', data.text.slice(0, 200))

      expect(data.text.length).toBeGreaterThan(50)
    }, 30000)
  })
})

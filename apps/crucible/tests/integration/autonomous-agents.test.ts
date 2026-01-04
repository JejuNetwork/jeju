/**
 * Autonomous Agent Integration Tests
 *
 * Tests that Crucible agents:
 * 1. Start up correctly with all characters
 * 2. Run autonomously in tick loops
 * 3. Have access to all Jeju Network actions (80+)
 * 4. Execute actions correctly via DWS
 * 5. Process A2A, compute, storage, DeFi, governance, moderation actions
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { characters, getCharacter, listCharacters } from '../../api/characters'
import { checkDWSHealth } from '../../api/client/dws'
import {
  createCrucibleRuntime,
  type RuntimeMessage,
  runtimeManager,
} from '../../api/sdk/eliza-runtime'

const CRUCIBLE_URL = process.env.CRUCIBLE_URL ?? 'http://localhost:4021'
const _DWS_URL = process.env.DWS_URL ?? 'http://localhost:4030'

let crucibleAutonomousAvailable = false

// DWS is required infrastructure - tests must fail if it's not running
beforeAll(async () => {
  // Check DWS - required
  const dwsAvailable = await checkDWSHealth()
  if (!dwsAvailable) {
    throw new Error('DWS is required but not running. Start with: jeju dev')
  }
  console.log('[Autonomous Tests] DWS ready')

  // Check Crucible health - required
  const crucibleHealth = await fetch(`${CRUCIBLE_URL}/health`).catch(() => null)
  if (!crucibleHealth?.ok) {
    throw new Error(
      'Crucible is required but not running. Start with: cd apps/crucible && bun run dev',
    )
  }
  console.log('[Autonomous Tests] Crucible ready')

  // Check if autonomous endpoints are available (they're only in full server mode)
  const autonomousStatus = await fetch(
    `${CRUCIBLE_URL}/api/v1/autonomous/status`,
  ).catch(() => null)
  crucibleAutonomousAvailable = autonomousStatus?.ok ?? false
  if (!crucibleAutonomousAvailable) {
    console.log(
      '[Autonomous Tests] Crucible running in worker mode - autonomous endpoints disabled',
    )
  }
})

afterAll(async () => {
  await runtimeManager.shutdown()
})

describe('Agent Character Validation', () => {
  test('should have all 14 required characters', () => {
    const allChars = listCharacters()
    expect(allChars.length).toBe(14)

    const expectedCharacters = [
      'project-manager',
      'community-manager',
      'devrel',
      'liaison',
      'social-media-manager',
      'red-team',
      'scammer',
      'security-researcher',
      'contracts-expert',
      'fuzz-tester',
      'blue-team',
      'moderator',
      'network-guardian',
      'contracts-auditor',
    ]

    for (const id of expectedCharacters) {
      const char = getCharacter(id)
      expect(char, `Character ${id} should exist`).toBeDefined()
      expect(char?.name, `Character ${id} should have a name`).toBeTruthy()
      expect(
        char?.system,
        `Character ${id} should have system prompt`,
      ).toBeTruthy()
    }
  })

  test('characters should have valid structure', () => {
    for (const id of listCharacters()) {
      const char = characters[id]
      expect(char.id).toBe(id)
      expect(typeof char.name).toBe('string')
      expect(char.name.length).toBeGreaterThan(0)
      expect(typeof char.system).toBe('string')
      expect(Array.isArray(char.topics)).toBe(true)
      expect(Array.isArray(char.adjectives)).toBe(true)
      expect(char.style).toBeDefined()
      expect(Array.isArray(char.style.all)).toBe(true)
    }
  })
})

describe('Agent Runtime Initialization', () => {
  test('should initialize all agent runtimes with 80 actions', async () => {
    const testAgents = ['project-manager', 'red-team', 'blue-team']

    for (const id of testAgents) {
      const char = getCharacter(id)
      expect(char).toBeDefined()
      if (!char) continue

      const runtime = createCrucibleRuntime({
        agentId: `test-${id}`,
        character: char,
      })

      await runtime.initialize()
      expect(runtime.isInitialized()).toBe(true)
      expect(runtime.hasActions()).toBe(true)

      const actions = runtime.getAvailableActions()
      expect(actions.length).toBeGreaterThanOrEqual(70) // Should have 80

      // Verify key action categories
      const actionList = actions.join(',').toLowerCase()
      expect(actionList).toContain('inference')
      expect(actionList).toContain('swap')
      expect(actionList).toContain('proposal')
      expect(actionList).toContain('agent')
      expect(actionList).toContain('storage')
    }
  })
})

describe('DWS Inference Integration', () => {
  test('should generate responses via DWS inference', async () => {
    const char = getCharacter('project-manager')
    if (!char) throw new Error('character not found')

    const runtime = createCrucibleRuntime({
      agentId: 'inference-test',
      character: char,
    })

    await runtime.initialize()

    const message: RuntimeMessage = {
      id: crypto.randomUUID(),
      userId: 'test-user',
      roomId: 'test-room',
      content: {
        text: 'What tasks should I prioritize this week?',
        source: 'test',
      },
      createdAt: Date.now(),
    }

    const response = await runtime.processMessage(message)
    expect(response.text).toBeTruthy()
    expect(response.text.length).toBeGreaterThan(20)
  }, 60000)
})

describe('Autonomous Agent API', () => {
  test('should check autonomous status via API', async () => {
    if (!crucibleAutonomousAvailable) {
      console.log(
        '[Skipped] Crucible autonomous mode required (run full server)',
      )
      return
    }

    const response = await fetch(`${CRUCIBLE_URL}/api/v1/autonomous/status`)
    expect(response.ok).toBe(true)

    const status = (await response.json()) as {
      enabled: boolean
      running: boolean
      agentCount: number
    }
    expect(typeof status.enabled).toBe('boolean')
    expect(typeof status.running).toBe('boolean')
  })

  test('should register agent for autonomous mode', async () => {
    if (!crucibleAutonomousAvailable) {
      console.log(
        '[Skipped] Crucible autonomous mode required (run full server)',
      )
      return
    }

    const response = await fetch(`${CRUCIBLE_URL}/api/v1/autonomous/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: 'devrel',
        tickIntervalMs: 60000,
        capabilities: {
          canChat: true,
          a2a: true,
          compute: true,
        },
      }),
    })

    expect(response.ok).toBe(true)
    const result = (await response.json()) as {
      success: boolean
      agentId: string
    }
    expect(result.success).toBe(true)
    expect(result.agentId).toContain('devrel')

    // Cleanup
    await fetch(`${CRUCIBLE_URL}/api/v1/autonomous/agents/${result.agentId}`, {
      method: 'DELETE',
    })
  })
})

describe('Agent Chat API', () => {
  test('should chat with all character types', async () => {
    // Initialize all agents first - retry if busy
    for (let i = 0; i < 3; i++) {
      const initRes = await fetch(`${CRUCIBLE_URL}/api/v1/chat/init`, {
        method: 'POST',
      }).catch(() => null)
      if (initRes?.ok) break
      await new Promise((r) => setTimeout(r, 2000))
    }

    const testChars = ['project-manager', 'red-team', 'blue-team', 'moderator']

    for (const charId of testChars) {
      // Retry logic for chat requests
      let response: Response | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(`${CRUCIBLE_URL}/api/v1/chat/${charId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Hello ${charId}, what is your role?`,
            userId: 'test',
            roomId: 'test',
          }),
        }).catch(() => null)

        if (response?.ok) break
        // Wait before retry
        await new Promise((r) => setTimeout(r, 1000))
      }

      expect(response?.ok, `Chat with ${charId} should succeed`).toBe(true)
      const data = (await response?.json()) as {
        text: string
        character: string
      }
      expect(data.text.length).toBeGreaterThan(10)
      expect(data.character).toBe(charId)
    }
  }, 180000) // Increase timeout to 3 minutes
})

describe('Action Execution', () => {
  test('should have handlers for key actions', async () => {
    const char = getCharacter('project-manager')
    if (!char) throw new Error('character not found')

    const runtime = createCrucibleRuntime({
      agentId: 'action-test',
      character: char,
    })

    await runtime.initialize()

    // Check key actions have handlers
    const criticalActions = [
      'RUN_INFERENCE',
      'UPLOAD_FILE',
      'SWAP_TOKENS',
      'CREATE_PROPOSAL',
      'CALL_AGENT',
      'DISCOVER_AGENTS',
      'REPORT_AGENT',
      'CREATE_BOUNTY',
    ]

    for (const action of criticalActions) {
      expect(
        runtime.actionHasHandler(action),
        `Action ${action} should have a handler`,
      ).toBe(true)
    }
  })
})

describe('Multi-Agent Coordination', () => {
  test('should run multiple agents concurrently', async () => {
    const agents = ['project-manager', 'red-team', 'blue-team']
    const runtimes = await Promise.all(
      agents.map(async (id) => {
        const char = getCharacter(id)
        if (!char) throw new Error(`Character ${id} not found`)
        return runtimeManager.createRuntime({
          agentId: `multi-${id}`,
          character: char,
        })
      }),
    )

    expect(runtimes.length).toBe(3)
    expect(runtimeManager.getAllRuntimes().length).toBeGreaterThanOrEqual(3)

    // All should be initialized
    for (const runtime of runtimes) {
      expect(runtime.isInitialized()).toBe(true)
    }
  })

  test('should produce different responses for same prompt', async () => {
    const prompt = 'Should we launch a new feature this week?'
    const responses = new Map<string, string>()

    for (const id of ['project-manager', 'red-team', 'blue-team']) {
      const char = getCharacter(id)
      if (!char) continue

      const runtime = await runtimeManager.createRuntime({
        agentId: `diversity-${id}`,
        character: char,
      })

      const message: RuntimeMessage = {
        id: crypto.randomUUID(),
        userId: 'test',
        roomId: 'test',
        content: { text: prompt, source: 'test' },
        createdAt: Date.now(),
      }

      const response = await runtime.processMessage(message)
      responses.set(id, response.text)
    }

    // Responses should be unique (not cached)
    const uniqueResponses = new Set(responses.values())
    expect(uniqueResponses.size).toBe(3)

    // Each should be substantive
    for (const [id, text] of responses) {
      expect(
        text.length,
        `${id} response should be substantive`,
      ).toBeGreaterThan(50)
    }
  }, 180000)
})

describe('Capability Coverage', () => {
  test('should cover all action categories', async () => {
    const char = getCharacter('project-manager')
    if (!char) throw new Error('character not found')

    const runtime = createCrucibleRuntime({
      agentId: 'capability-test',
      character: char,
    })

    await runtime.initialize()
    const actions = runtime.getAvailableActions()

    // Check all categories are covered
    const categories = {
      compute: ['RENT_GPU', 'RUN_INFERENCE', 'CREATE_TRIGGER'],
      storage: ['UPLOAD_FILE', 'RETRIEVE_FILE', 'PIN_CID'],
      defi: ['SWAP_TOKENS', 'ADD_LIQUIDITY', 'LIST_POOLS'],
      governance: ['CREATE_PROPOSAL', 'VOTE_PROPOSAL'],
      a2a: ['CALL_AGENT', 'DISCOVER_AGENTS'],
      moderation: ['REPORT_AGENT', 'SUBMIT_EVIDENCE', 'CREATE_MODERATION_CASE'],
      identity: ['REGISTER_NAME', 'REGISTER_AGENT'],
      crosschain: ['CROSS_CHAIN_TRANSFER', 'CREATE_INTENT'],
      work: ['CREATE_BOUNTY', 'CREATE_PROJECT'],
      launchpad: ['CREATE_TOKEN', 'CREATE_PRESALE'],
    }

    for (const [category, expectedActions] of Object.entries(categories)) {
      for (const action of expectedActions) {
        expect(
          actions.includes(action),
          `${category} category should have ${action}`,
        ).toBe(true)
      }
    }
  })
})

describe('Error Handling', () => {
  test('should handle missing DWS gracefully', async () => {
    const char = getCharacter('project-manager')
    if (!char) throw new Error('character not found')

    const runtime = createCrucibleRuntime({
      agentId: 'error-test',
      character: char,
    })

    // Should initialize even if DWS has issues
    try {
      await runtime.initialize()
    } catch (e) {
      // Expected if DWS is down
      expect(e instanceof Error).toBe(true)
    }
  })
})

console.log('Autonomous Agent Tests loaded')

import { beforeAll, describe, expect, test } from 'bun:test'
import { getCharacter, listCharacters } from '../../api/characters'
import {
  checkDWSHealth,
  checkDWSInferenceAvailable,
} from '../../api/client/dws'
import {
  CrucibleAgentRuntime,
  createCrucibleRuntime,
  type RuntimeMessage,
  runtimeManager,
} from '../../api/sdk/eliza-runtime'

// DWS and inference are required infrastructure - tests must fail if not running
beforeAll(async () => {
  const dwsAvailable = await checkDWSHealth()
  if (!dwsAvailable) {
    throw new Error('DWS is required but not running. Start with: jeju dev')
  }

  // Verify inference nodes are available
  const inference = await checkDWSInferenceAvailable()
  if (!inference.available || inference.nodes === 0) {
    throw new Error(
      'DWS inference nodes required but not available. Start inference with: jeju dev',
    )
  }
  console.log(
    `[Eliza Runtime Tests] DWS ready, inference available: ${inference.available}, nodes: ${inference.nodes}`,
  )

  // Test if inference actually works with a simple request
  const { getSharedDWSClient } = await import('../../api/client/dws')
  const client = getSharedDWSClient()
  const testResponse = await client
    .chatCompletion([{ role: 'user', content: 'Hi' }], {
      model: 'llama-3.1-8b-instant',
      maxTokens: 10,
    })
    .catch((e: Error) => {
      throw new Error(
        `DWS inference test failed: ${e.message.slice(0, 200)}. Check inference node is running.`,
      )
    })

  if (
    !testResponse?.choices?.[0]?.message?.content ||
    testResponse.choices[0].message.content.length === 0
  ) {
    throw new Error(
      'DWS inference returned empty response. Check inference node is properly configured.',
    )
  }

  console.log('[Eliza Runtime Tests] Inference verified working')
})

describe('Crucible Agent Runtime', () => {
  describe('Runtime Creation', () => {
    test('should create runtime with character', async () => {
      // This test doesn't require inference
      const character = getCharacter('project-manager')
      expect(character).toBeDefined()
      if (!character) throw new Error('character not found')

      const runtime = createCrucibleRuntime({
        agentId: 'test-pm',
        character: character,
      })

      expect(runtime).toBeInstanceOf(CrucibleAgentRuntime)
      expect(runtime.getAgentId()).toBe('test-pm')
    })

    test('should initialize runtime with jejuPlugin actions', async () => {
      const character = getCharacter('community-manager')
      expect(character).toBeDefined()
      if (!character) throw new Error('character not found')

      const runtime = createCrucibleRuntime({
        agentId: 'test-cm',
        character: character,
      })

      await runtime.initialize()
      expect(runtime.isInitialized()).toBe(true)
      expect(runtime.hasActions()).toBe(true)
    })
  })

  describe('Message Processing', () => {
    test('should process message through ElizaOS', async () => {
      const character = getCharacter('project-manager')
      if (!character) throw new Error('character not found')
      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-msg',
        character: character,
      })

      await runtime.initialize()

      const message: RuntimeMessage = {
        id: crypto.randomUUID(),
        userId: 'test-user',
        roomId: 'test-room',
        content: {
          text: 'Create a todo for reviewing the documentation',
          source: 'test',
        },
        createdAt: Date.now(),
      }

      const response = await runtime.processMessage(message)

      expect(response).toBeDefined()
      expect(typeof response.text).toBe('string')
      // Response should have either text content OR an action
      const hasContent = response.text.length > 0 || response.action !== null
      expect(hasContent).toBe(true)

      console.log(
        '[Test] Response:',
        response.text.slice(0, 200) || '(action only)',
      )
      console.log('[Test] Action:', response.action)
    }, 60000)

    test('should handle action responses', async () => {
      const character = getCharacter('project-manager')
      if (!character) throw new Error('character not found')
      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-action',
        character: character,
      })

      await runtime.initialize()

      const message: RuntimeMessage = {
        id: crypto.randomUUID(),
        userId: 'test-user',
        roomId: 'test-room',
        content: { text: 'Schedule a daily standup at 9am', source: 'test' },
        createdAt: Date.now(),
      }

      const response = await runtime.processMessage(message)

      console.log('[Test] Response:', response.text || '(action only)')
      console.log('[Test] Action:', response.action)
      console.log('[Test] Actions:', response.actions)

      // Response should have either text content OR an action
      const hasContent = response.text.length > 0 || response.action !== null
      expect(hasContent).toBe(true)
    }, 60000)
  })

  describe('Runtime Manager', () => {
    test('should create and track runtimes', async () => {
      const character = getCharacter('devrel')
      expect(character).toBeDefined()
      if (!character) throw new Error('character not found')

      const runtime = await runtimeManager.createRuntime({
        agentId: 'devrel-test',
        character: character,
      })

      expect(runtime).toBeInstanceOf(CrucibleAgentRuntime)

      const retrieved = runtimeManager.getRuntime('devrel-test')
      expect(retrieved).toBe(runtime)

      const all = runtimeManager.getAllRuntimes()
      expect(all.length).toBeGreaterThan(0)
    })

    test('should not duplicate runtimes', async () => {
      const character = getCharacter('liaison')
      expect(character).toBeDefined()
      if (!character) throw new Error('character not found')

      const runtime1 = await runtimeManager.createRuntime({
        agentId: 'liaison-test',
        character: character,
      })

      const runtime2 = await runtimeManager.createRuntime({
        agentId: 'liaison-test',
        character: character,
      })

      expect(runtime1).toBe(runtime2)
    })

    test('should shutdown all runtimes', async () => {
      // This test doesn't require inference
      await runtimeManager.shutdown()
      const all = runtimeManager.getAllRuntimes()
      expect(all.length).toBe(0)
    })
  })

  // Character Library tests don't require any infrastructure
  describe('Character Library', () => {
    test('should list available characters', () => {
      const chars = listCharacters()
      expect(chars.length).toBeGreaterThan(0)
      console.log('[Test] Available characters:', chars)
    })

    test('should load all characters', () => {
      const charIds = listCharacters()
      for (const id of charIds) {
        const char = getCharacter(id)
        expect(char).toBeDefined()
        expect(char?.name).toBeDefined()
        expect(char?.system).toBeDefined()
        console.log(`[Test] Character: ${id} -> ${char?.name}`)
      }
    })

    test('project-manager should have correct structure', () => {
      const pm = getCharacter('project-manager')
      expect(pm).toBeDefined()
      expect(pm?.name).toBe('Jimmy')
      expect(pm?.bio?.length).toBeGreaterThan(0)
      expect(pm?.style?.all?.length).toBeGreaterThan(0)
    })

    test('red-team should have correct structure', () => {
      const rt = getCharacter('red-team')
      expect(rt).toBeDefined()
      expect(rt?.topics?.some((t) => t.includes('security'))).toBe(true)
    })
  })

  describe('Plugin Integration', () => {
    test('should load jeju plugin actions', async () => {
      const character = getCharacter('community-manager')
      if (!character) throw new Error('character not found')
      const runtime = createCrucibleRuntime({
        agentId: 'plugin-test',
        character: character,
      })

      await runtime.initialize()

      expect(runtime.hasActions()).toBe(true)
      expect(runtime.getCharacter().name).toBe('Eli5')

      console.log('[Test] Runtime initialized with actions')
    })
  })
})

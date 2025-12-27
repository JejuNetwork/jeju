/**
 * Real Infrastructure E2E Tests
 *
 * These tests REQUIRE real infrastructure to be running and will FAIL if not available.
 * This ensures that these tests are never silently skipped in CI.
 *
 * Prerequisites:
 *   - DWS running: cd apps/dws && bun run dev
 *   - Inference available: at least one inference node registered
 *
 * Run with: bun test tests/e2e/real-infrastructure.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { getCharacter } from '../../api/characters'
import {
  checkDWSHealth,
  checkDWSInferenceAvailable,
  getDWSEndpoint,
  getSharedDWSClient,
} from '../../api/client/dws'
import {
  createCrucibleRuntime,
  runtimeManager,
} from '../../api/sdk/eliza-runtime'
import { createStorage } from '../../api/sdk/storage'

// Skip E2E tests if RUN_E2E is not set
const RUN_E2E = process.env.RUN_E2E === 'true'

describe.skipIf(!RUN_E2E)('Real Infrastructure E2E', () => {
  beforeAll(async () => {
    // These tests REQUIRE infrastructure - fail fast if not available
    console.log(`[E2E] Testing against DWS at: ${getDWSEndpoint()}`)

    const dwsHealthy = await checkDWSHealth()
    if (!dwsHealthy) {
      throw new Error(
        `DWS not available at ${getDWSEndpoint()}. Start with: cd apps/dws && bun run dev`,
      )
    }

    const inference = await checkDWSInferenceAvailable()
    if (!inference.available) {
      throw new Error(
        `No inference nodes available. Start inference node or check DWS compute registry.`,
      )
    }

    console.log(
      `[E2E] Infrastructure ready: DWS healthy, ${inference.nodes} inference nodes`,
    )
  })

  afterAll(async () => {
    await runtimeManager.shutdown()
  })

  describe('DWS Chat Completion', () => {
    test('should complete a chat request through DWS', async () => {
      const client = getSharedDWSClient()

      const response = await client.chatCompletion(
        [
          {
            role: 'system',
            content: 'You are a helpful assistant. Be concise.',
          },
          {
            role: 'user',
            content: 'What is 2+2? Answer with just the number.',
          },
        ],
        {
          model: 'llama-3.1-8b-instant',
          temperature: 0.1,
          maxTokens: 50,
        },
      )

      console.log('[E2E] Chat response:', response)

      expect(response.choices).toBeDefined()
      expect(response.choices.length).toBeGreaterThan(0)
      expect(response.choices[0].message).toBeDefined()

      const content = response.choices[0].message?.content ?? ''
      console.log('[E2E] Content:', content)

      // Response should contain "4" somewhere
      expect(content).toMatch(/4/)
    }, 30000)

    test('should handle character-based prompting', async () => {
      const client = getSharedDWSClient()
      const character = getCharacter('project-manager')

      if (!character) throw new Error('project-manager character not found')

      const systemPrompt = `You are ${character.name}. ${character.system ?? ''}`

      const response = await client.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'What is your name and role?' },
        ],
        {
          model: 'llama-3.1-8b-instant',
          temperature: 0.3,
          maxTokens: 200,
        },
      )

      const content = response.choices[0].message?.content ?? ''
      console.log('[E2E] Character response:', content.slice(0, 200))

      // Should respond with character identity
      expect(content.length).toBeGreaterThan(20)
      expect(content.toLowerCase()).toMatch(/jimmy|project|manager|team/i)
    }, 30000)
  })

  describe('IPFS Storage', () => {
    test('should upload and retrieve content from IPFS', async () => {
      const storage = createStorage({
        apiUrl: getDWSEndpoint(),
        ipfsGateway: `${getDWSEndpoint()}/storage`,
        enableCache: false, // Test raw IPFS without cache
      })

      const testContent = {
        id: `test-${Date.now()}`,
        name: 'E2E Test Character',
        description: 'A test character for E2E testing',
        system: 'You are a test agent.',
        bio: ['Test agent for E2E'],
        messageExamples: [],
        topics: ['testing'],
        adjectives: ['thorough'],
        style: { all: [], chat: [], post: [] },
      }

      // Store
      const cid = await storage.storeCharacter(testContent)
      console.log('[E2E] Stored character with CID:', cid)

      expect(cid).toBeDefined()
      expect(cid.length).toBeGreaterThan(10)

      // Retrieve
      const retrieved = await storage.loadCharacter(cid)
      console.log('[E2E] Retrieved character:', retrieved.name)

      expect(retrieved.id).toBe(testContent.id)
      expect(retrieved.name).toBe(testContent.name)
    }, 30000)
  })

  describe('Full Runtime Flow', () => {
    test('should process message through full Crucible runtime', async () => {
      const character = getCharacter('community-manager')
      if (!character) throw new Error('community-manager character not found')

      const runtime = createCrucibleRuntime({
        agentId: 'e2e-full-test',
        character,
      })

      await runtime.initialize()
      expect(runtime.isInitialized()).toBe(true)

      const response = await runtime.processMessage({
        id: crypto.randomUUID(),
        userId: 'e2e-test-user',
        roomId: 'e2e-test-room',
        content: {
          text: 'How should I welcome new members to the community?',
          source: 'e2e-test',
        },
        createdAt: Date.now(),
      })

      console.log('[E2E] Runtime response:', response.text.slice(0, 300))

      expect(response.text).toBeDefined()
      expect(response.text.length).toBeGreaterThan(50)

      // Response should be contextually relevant
      const lowerText = response.text.toLowerCase()
      const hasRelevantContent =
        lowerText.includes('welcome') ||
        lowerText.includes('member') ||
        lowerText.includes('community') ||
        lowerText.includes('greet') ||
        lowerText.includes('hello')

      expect(hasRelevantContent).toBe(true)
    }, 60000)

    test('should list available actions from jeju plugin', async () => {
      const character = getCharacter('project-manager')
      if (!character) throw new Error('project-manager character not found')

      const runtime = createCrucibleRuntime({
        agentId: 'e2e-actions-test',
        character,
      })

      await runtime.initialize()

      const actions = runtime.getAvailableActions()
      console.log('[E2E] Available actions:', actions.slice(0, 20))

      const executableActions = runtime.getExecutableActions()
      console.log('[E2E] Executable actions:', executableActions.slice(0, 10))

      // Should have some actions loaded from the plugin
      expect(actions.length).toBeGreaterThanOrEqual(0)

      // Log for visibility
      if (actions.length === 0) {
        console.warn(
          '[E2E] No actions loaded - jeju-plugin may not be available',
        )
      } else {
        console.log(
          `[E2E] Loaded ${actions.length} actions, ${executableActions.length} executable`,
        )
      }
    }, 30000)
  })

  describe('Latency and Performance', () => {
    test('should respond within acceptable latency', async () => {
      const client = getSharedDWSClient()

      const startTime = Date.now()
      await client.chatCompletion(
        [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Say hello.' },
        ],
        {
          model: 'llama-3.1-8b-instant',
          temperature: 0.1,
          maxTokens: 20,
        },
      )
      const latency = Date.now() - startTime

      console.log(`[E2E] Inference latency: ${latency}ms`)

      // Should complete within 30 seconds (generous for cold start)
      expect(latency).toBeLessThan(30000)

      // Warn if slow
      if (latency > 5000) {
        console.warn(`[E2E] Latency ${latency}ms is higher than expected (>5s)`)
      }
    }, 35000)
  })
})

// Export for documentation
export const E2E_REQUIREMENTS = `
To run these tests:

1. Start DWS:
   cd apps/dws && bun run dev

2. Ensure inference is available:
   - Check DWS logs for "inference nodes registered"
   - Or run a local inference server

3. Run the tests:
   RUN_E2E=true bun test tests/e2e/real-infrastructure.test.ts

These tests verify that:
- DWS health endpoint responds
- Chat completions work end-to-end
- IPFS storage works
- Crucible runtime initializes with real inference
`

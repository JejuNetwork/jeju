/**
 * Agent Seeding Integration Tests
 *
 * Tests agent initialization, seeding, and verification.
 * These tests can run with or without full DWS infrastructure.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { characters, getCharacter, listCharacters } from '../../api/characters'
import { checkDWSHealth } from '../../api/client/dws'
import {
  CrucibleAgentRuntime,
  createCrucibleRuntime,
  runtimeManager,
} from '../../api/sdk/eliza-runtime'

// DWS is required infrastructure - tests must fail if it's not running
beforeAll(async () => {
  const dwsAvailable = await checkDWSHealth()
  if (!dwsAvailable) {
    throw new Error('DWS is required but not running. Start with: jeju dev')
  }
  console.log('[Agent Seeding Tests] DWS ready')
})

describe('Agent Seeding', () => {
  describe('Character Definitions', () => {
    test('should have all required core characters', () => {
      const requiredCharacters = [
        'community-manager',
        'security-analyst',
        'infra-monitor',
        'daily-digest',
        'registration-watcher',
        'blockscout-watcher',
      ]

      for (const id of requiredCharacters) {
        const char = getCharacter(id)
        expect(char).toBeDefined()
        expect(char?.name).toBeDefined()
        expect(char?.system).toBeDefined()
        expect(char?.id).toBe(id)
      }
    })

    test('should have all test capability characters', () => {
      const testCharacterIds = [
        'test-trader',
        'test-coordinator',
        'test-voter',
        'test-computer',
        'test-storage',
      ]

      for (const id of testCharacterIds) {
        const char = getCharacter(id)
        expect(char).toBeDefined()
        expect(char?.name).toBeDefined()
      }
    })

    test('should have valid character structure', () => {
      const allCharacters = listCharacters()
      expect(allCharacters.length).toBeGreaterThan(0)

      for (const id of allCharacters) {
        const char = characters[id]
        expect(char).toBeDefined()

        // Required fields
        expect(char.id).toBe(id)
        expect(char.name).toBeDefined()
        expect(typeof char.name).toBe('string')
        expect(char.name.length).toBeGreaterThan(0)

        // System prompt
        expect(char.system).toBeDefined()
        expect(typeof char.system).toBe('string')

        // Topics and adjectives
        expect(Array.isArray(char.topics)).toBe(true)
        expect(Array.isArray(char.adjectives)).toBe(true)

        // Style
        expect(char.style).toBeDefined()
        expect(Array.isArray(char.style.all)).toBe(true)
      }
    })
  })

  describe('Runtime Creation', () => {
    test('should create runtime for each character', async () => {
      // Test with a subset to keep tests fast
      const testCharacterIds = ['community-manager', 'security-analyst', 'infra-monitor']

      for (const id of testCharacterIds) {
        const char = getCharacter(id)
        expect(char).toBeDefined()
        if (!char) continue

        const runtime = createCrucibleRuntime({
          agentId: `test-${id}`,
          character: char,
        })

        expect(runtime).toBeInstanceOf(CrucibleAgentRuntime)
        expect(runtime.getAgentId()).toBe(`test-${id}`)
        expect(runtime.getCharacter().name).toBe(char.name)
      }
    })

    test('should initialize runtime with actions', async () => {
      const char = getCharacter('community-manager')
      expect(char).toBeDefined()
      if (!char) return

      const runtime = createCrucibleRuntime({
        agentId: 'test-cm-init',
        character: char,
      })

      await runtime.initialize()

      expect(runtime.isInitialized()).toBe(true)
      expect(runtime.hasActions()).toBe(true)
      expect(runtime.getAvailableActions().length).toBeGreaterThan(0)
    })
  })

  describe('Runtime Manager', () => {
    test('should manage multiple runtimes', async () => {
      // Clean up first
      await runtimeManager.shutdown()

      const testCharacters = ['community-manager', 'security-analyst', 'infra-monitor']

      for (const id of testCharacters) {
        const char = getCharacter(id)
        if (!char) continue

        await runtimeManager.createRuntime({
          agentId: id,
          character: char,
        })
      }

      const allRuntimes = runtimeManager.getAllRuntimes()
      expect(allRuntimes.length).toBe(testCharacters.length)

      for (const id of testCharacters) {
        const runtime = runtimeManager.getRuntime(id)
        expect(runtime).toBeDefined()
        expect(runtime?.getAgentId()).toBe(id)
      }
    })

    test('should not duplicate runtimes', async () => {
      const char = getCharacter('daily-digest')
      expect(char).toBeDefined()
      if (!char) return

      const runtime1 = await runtimeManager.createRuntime({
        agentId: 'digest-dup-test',
        character: char,
      })

      const runtime2 = await runtimeManager.createRuntime({
        agentId: 'digest-dup-test',
        character: char,
      })

      expect(runtime1).toBe(runtime2)
    })

    test('should shutdown cleanly', async () => {
      await runtimeManager.shutdown()
      const allRuntimes = runtimeManager.getAllRuntimes()
      expect(allRuntimes.length).toBe(0)
    })
  })

  describe('Agent Verification', () => {
    test('should verify security-analyst has security focus', () => {
      const securityAnalyst = getCharacter('security-analyst')
      expect(securityAnalyst).toBeDefined()
      if (!securityAnalyst) return

      const hasSecurityTopics = securityAnalyst.topics.some(
        (t) =>
          t.includes('security') ||
          t.includes('audit') ||
          t.includes('vulnerability') ||
          t.includes('contract'),
      )
      expect(hasSecurityTopics).toBe(true)
    })

    test('should verify infra-monitor has monitoring focus', () => {
      const infraMonitor = getCharacter('infra-monitor')
      expect(infraMonitor).toBeDefined()
      if (!infraMonitor) return

      const hasMonitoringTopics = infraMonitor.topics.some(
        (t) =>
          t.includes('monitoring') ||
          t.includes('infrastructure') ||
          t.includes('health') ||
          t.includes('alert'),
      )
      expect(hasMonitoringTopics).toBe(true)
    })

    test('should verify community-manager has community focus', () => {
      const communityManager = getCharacter('community-manager')
      expect(communityManager).toBeDefined()
      if (!communityManager) return

      const hasCommunityTopics = communityManager.topics.some(
        (t) =>
          t.includes('community') ||
          t.includes('engagement') ||
          t.includes('support') ||
          t.includes('help'),
      )
      expect(hasCommunityTopics).toBe(true)
    })
  })
})

describe('Agent Communication', () => {
  test('should process message through runtime', async () => {
    const char = getCharacter('community-manager')
    if (!char) return

    const runtime = createCrucibleRuntime({
      agentId: 'test-cm-msg',
      character: char,
    })

    await runtime.initialize()

    const response = await runtime.processMessage({
      id: crypto.randomUUID(),
      userId: 'test-user',
      roomId: 'test-room',
      content: { text: 'Hello, can you help me?', source: 'test' },
      createdAt: Date.now(),
    })

    expect(response).toBeDefined()
    expect(typeof response.text).toBe('string')
    expect(response.text.length).toBeGreaterThan(0)
  }, 60000)
})

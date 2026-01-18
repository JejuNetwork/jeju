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
        'project-manager',
        'community-manager',
        'devrel',
        'liaison',
        'social-media-manager',
      ]

      for (const id of requiredCharacters) {
        const char = getCharacter(id)
        expect(char).toBeDefined()
        expect(char?.name).toBeDefined()
        expect(char?.system).toBeDefined()
        expect(char?.id).toBe(id)
      }
    })

    test('should have all blue team characters', () => {
      // Blue team: defensive security and moderation focused
      const blueTeamIds = ['blue-team', 'moderator', 'security-analyst']

      for (const id of blueTeamIds) {
        const char = getCharacter(id)
        expect(char).toBeDefined()
        expect(char?.name).toBeDefined()
      }
    })

    test('should have all red team characters', () => {
      // Red team: adversarial security testing focused
      const redTeamIds = ['red-team', 'qa-engineer']

      for (const id of redTeamIds) {
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
      const testCharacterIds = ['project-manager', 'blue-team', 'red-team']

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
      const char = getCharacter('project-manager')
      expect(char).toBeDefined()
      if (!char) return

      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-init',
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

      const testCharacters = ['project-manager', 'community-manager', 'devrel']

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
      const char = getCharacter('liaison')
      expect(char).toBeDefined()
      if (!char) return

      const runtime1 = await runtimeManager.createRuntime({
        agentId: 'liaison-dup-test',
        character: char,
      })

      const runtime2 = await runtimeManager.createRuntime({
        agentId: 'liaison-dup-test',
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
    test('should verify character has required capabilities', () => {
      const pm = getCharacter('project-manager')
      expect(pm).toBeDefined()
      if (!pm) return

      // Project manager should have topics related to project management
      const hasRelevantTopics = pm.topics.some(
        (t) =>
          t.includes('project') ||
          t.includes('management') ||
          t.includes('planning') ||
          t.includes('todo'),
      )
      expect(hasRelevantTopics).toBe(true)
    })

    test('should verify red team characters have security focus', () => {
      const securityResearcher = getCharacter('security-researcher')
      expect(securityResearcher).toBeDefined()
      if (!securityResearcher) return

      const hasSecurityTopics = securityResearcher.topics.some(
        (t) =>
          t.includes('security') ||
          t.includes('vulnerability') ||
          t.includes('exploit'),
      )
      expect(hasSecurityTopics).toBe(true)
    })

    test('should verify blue team characters have defense focus', () => {
      const moderator = getCharacter('moderator')
      expect(moderator).toBeDefined()
      if (!moderator) return

      const hasDefenseTopics = moderator.topics.some(
        (t) =>
          t.includes('moderation') ||
          t.includes('safety') ||
          t.includes('protection') ||
          t.includes('defense'),
      )
      expect(hasDefenseTopics).toBe(true)
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

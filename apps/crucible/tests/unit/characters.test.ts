import { describe, expect, it } from 'bun:test'
import {
  characters,
  communityManagerCharacter,
  getCharacter,
  listCharacters,
} from '../../api/characters'
import type { AgentCharacter } from '../../lib/types'

describe('Character Definitions', () => {
  describe('Character Registry', () => {
    it('should list all available characters', () => {
      const ids = listCharacters()

      // Active characters
      expect(ids).toContain('community-manager')
      expect(ids).toContain('daily-digest')
      expect(ids).toContain('infra-monitor')
      expect(ids).toContain('registration-watcher')
      expect(ids).toContain('security-analyst')
      expect(ids).toContain('blockscout-watcher')
      expect(ids).toContain('test-trader')
      expect(ids).toContain('test-coordinator')
      expect(ids).toContain('test-voter')
      expect(ids).toContain('test-computer')
      expect(ids.length).toBe(10)
    })

    it('should get character by ID', () => {
      const character = getCharacter('community-manager')

      expect(character).toBeDefined()
      expect(character?.name).toBe('Eli5')
    })

    it('should return null for unknown character', () => {
      const character = getCharacter('unknown-character')
      expect(character).toBeNull()
    })

    it('should have all characters in registry', () => {
      expect(Object.keys(characters).length).toBe(10)
    })
  })

  describe('Character Structure Validation', () => {
    it('all characters should have required fields', () => {
      const ids = listCharacters()

      for (const id of ids) {
        const character = getCharacter(id)
        expect(character).toBeDefined()
        if (!character) continue

        expect(character.id).toBeDefined()
        expect(typeof character.id).toBe('string')
        expect(character.id.length).toBeGreaterThan(0)

        expect(character.name).toBeDefined()
        expect(typeof character.name).toBe('string')
        expect(character.name.length).toBeGreaterThan(0)

        expect(character.description).toBeDefined()
        expect(typeof character.description).toBe('string')

        expect(character.system).toBeDefined()
        expect(typeof character.system).toBe('string')
        expect(character.system.length).toBeGreaterThan(50)

        expect(Array.isArray(character.bio)).toBe(true)
        expect(character.bio.length).toBeGreaterThan(0)

        expect(Array.isArray(character.messageExamples)).toBe(true)

        expect(Array.isArray(character.topics)).toBe(true)
        expect(character.topics.length).toBeGreaterThan(0)

        expect(Array.isArray(character.adjectives)).toBe(true)
        expect(character.adjectives.length).toBeGreaterThan(0)

        expect(character.style).toBeDefined()
        expect(Array.isArray(character.style.all)).toBe(true)
        expect(Array.isArray(character.style.chat)).toBe(true)
        expect(Array.isArray(character.style.post)).toBe(true)
      }
    })
  })

  describe('Community Manager (Eli5)', () => {
    it('should have correct identity', () => {
      expect(communityManagerCharacter.id).toBe('community-manager')
      expect(communityManagerCharacter.name).toBe('Eli5')
    })

    it('should have warm personality adjectives', () => {
      const adjectives = communityManagerCharacter.adjectives

      expect(adjectives).toContain('warm')
      expect(adjectives).toContain('approachable')
      expect(adjectives).toContain('empathetic')
    })
  })

  describe('Model Preferences', () => {
    it('all characters should have model preferences', () => {
      const ids = listCharacters()

      for (const id of ids) {
        const character = getCharacter(id)
        expect(character?.modelPreferences).toBeDefined()
        expect(character?.modelPreferences?.small).toBeDefined()
        expect(character?.modelPreferences?.large).toBeDefined()
      }
    })
  })
})

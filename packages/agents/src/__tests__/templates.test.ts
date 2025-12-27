/**
 * Agent Templates Tests
 *
 * Tests the agent template system for archetypes.
 */

import { describe, expect, test } from 'bun:test'
import {
  AGENT_TEMPLATES,
  DEGEN_TEMPLATE,
  getAgentTemplate,
  getAvailableTemplates,
  RESEARCHER_TEMPLATE,
  SOCIAL_BUTTERFLY_TEMPLATE,
  TRADER_TEMPLATE,
} from '../templates/archetypes'

describe('Agent Templates', () => {
  describe('AGENT_TEMPLATES', () => {
    test('has expected archetypes', () => {
      expect(AGENT_TEMPLATES.trader).toBeDefined()
      expect(AGENT_TEMPLATES.researcher).toBeDefined()
      expect(AGENT_TEMPLATES.degen).toBeDefined()
      expect(AGENT_TEMPLATES['social-butterfly']).toBeDefined()
    })

    test('each template has required fields', () => {
      for (const [key, template] of Object.entries(AGENT_TEMPLATES)) {
        expect(template.archetype).toBe(key)
        expect(template.name).toBeDefined()
        expect(template.name.length).toBeGreaterThan(0)
        expect(template.bio).toBeDefined()
        expect(template.bio.length).toBeGreaterThan(0)
        expect(template.personality).toBeDefined()
        expect(template.system).toBeDefined()
      }
    })
  })

  describe('getAgentTemplate', () => {
    test('returns trader template', () => {
      const template = getAgentTemplate('trader')
      expect(template).toBeDefined()
      expect(template?.archetype).toBe('trader')
    })

    test('returns researcher template', () => {
      const template = getAgentTemplate('researcher')
      expect(template).toBeDefined()
      expect(template?.archetype).toBe('researcher')
    })

    test('returns degen template', () => {
      const template = getAgentTemplate('degen')
      expect(template).toBeDefined()
      expect(template?.archetype).toBe('degen')
    })

    test('returns social-butterfly template', () => {
      const template = getAgentTemplate('social-butterfly')
      expect(template).toBeDefined()
      expect(template?.archetype).toBe('social-butterfly')
    })

    test('returns null for unknown archetype', () => {
      const template = getAgentTemplate('unknown-archetype')
      expect(template).toBeNull()
    })

    test('is case-insensitive', () => {
      const template = getAgentTemplate('TRADER')
      expect(template?.archetype).toBe('trader')
    })
  })

  describe('getAvailableTemplates', () => {
    test('returns array of template names', () => {
      const templates = getAvailableTemplates()
      expect(Array.isArray(templates)).toBe(true)
      expect(templates.length).toBeGreaterThan(0)
    })

    test('includes all known archetypes', () => {
      const templates = getAvailableTemplates()
      expect(templates).toContain('trader')
      expect(templates).toContain('researcher')
      expect(templates).toContain('degen')
      expect(templates).toContain('social-butterfly')
    })
  })

  describe('Exported Templates', () => {
    test('TRADER_TEMPLATE has correct archetype', () => {
      expect(TRADER_TEMPLATE.archetype).toBe('trader')
      expect(TRADER_TEMPLATE.name).toBe('Trader')
      expect(TRADER_TEMPLATE.system.toLowerCase()).toContain('trad')
    })

    test('RESEARCHER_TEMPLATE has correct archetype', () => {
      expect(RESEARCHER_TEMPLATE.archetype).toBe('researcher')
      expect(RESEARCHER_TEMPLATE.name).toBe('Researcher')
    })

    test('DEGEN_TEMPLATE has correct archetype', () => {
      expect(DEGEN_TEMPLATE.archetype).toBe('degen')
      expect(DEGEN_TEMPLATE.name).toBe('Degen')
    })

    test('SOCIAL_BUTTERFLY_TEMPLATE has correct archetype', () => {
      expect(SOCIAL_BUTTERFLY_TEMPLATE.archetype).toBe('social-butterfly')
      expect(SOCIAL_BUTTERFLY_TEMPLATE.name).toBe('Social Butterfly')
    })
  })
})

describe('Template Content Quality', () => {
  test('trader template has trading-related content', () => {
    const template = getAgentTemplate('trader')
    const content = `${template?.system} ${template?.bio} ${template?.personality}`
    const lowerContent = content.toLowerCase()

    expect(
      lowerContent.includes('trade') ||
        lowerContent.includes('market') ||
        lowerContent.includes('invest'),
    ).toBe(true)
  })

  test('researcher template has research-related content', () => {
    const template = getAgentTemplate('researcher')
    const content = `${template?.system} ${template?.bio} ${template?.personality}`
    const lowerContent = content.toLowerCase()

    expect(
      lowerContent.includes('research') ||
        lowerContent.includes('analyz') ||
        lowerContent.includes('data'),
    ).toBe(true)
  })

  test('degen template has degen-related content', () => {
    const template = getAgentTemplate('degen')
    const content = `${template?.system} ${template?.bio} ${template?.personality}`
    const lowerContent = content.toLowerCase()

    expect(
      lowerContent.includes('degen') ||
        lowerContent.includes('risk') ||
        lowerContent.includes('leverage'),
    ).toBe(true)
  })

  test('social-butterfly template has social-related content', () => {
    const template = getAgentTemplate('social-butterfly')
    const content = `${template?.system} ${template?.bio} ${template?.personality}`
    const lowerContent = content.toLowerCase()

    expect(
      lowerContent.includes('social') ||
        lowerContent.includes('community') ||
        lowerContent.includes('connect') ||
        lowerContent.includes('engage'),
    ).toBe(true)
  })

  test('all templates have non-empty system prompts', () => {
    for (const template of Object.values(AGENT_TEMPLATES)) {
      expect(template.system.length).toBeGreaterThan(50)
    }
  })

  test('all templates have personality traits', () => {
    for (const template of Object.values(AGENT_TEMPLATES)) {
      expect(template.personality.length).toBeGreaterThan(10)
    }
  })

  test('all templates have priority metrics', () => {
    for (const template of Object.values(AGENT_TEMPLATES)) {
      expect(template.priorityMetrics).toBeDefined()
      const metrics = template.priorityMetrics
      expect(Array.isArray(metrics)).toBe(true)
      expect(metrics?.length).toBeGreaterThan(0)
    }
  })
})

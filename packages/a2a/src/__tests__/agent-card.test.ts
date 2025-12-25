/**
 * AgentCardGenerator Tests
 *
 * Tests for A2A agent card generation
 */

import { describe, expect, it } from 'bun:test'
import {
  AgentCardGenerator,
  createAgentCard,
  DEFAULT_MESSAGING_SKILLS,
  DEFAULT_SOCIAL_SKILLS,
  DEFAULT_TRADING_SKILLS,
} from '../sdk/agent-card'

describe('AgentCardGenerator', () => {
  const baseConfig = {
    baseUrl: 'https://example.com',
    organization: 'Test Organization',
    organizationUrl: 'https://example.com',
  }

  describe('generate', () => {
    it('should generate valid agent card with required fields', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent for testing',
      })

      expect(card.name).toBe('Test Agent')
      expect(card.description).toBe('A test agent for testing')
      expect(card.url).toBe('https://example.com/api/agents/agent-123/a2a')
      expect(card.preferredTransport).toBe('JSONRPC')
      expect(card.protocolVersion).toBe('0.3.0')
    })

    it('should include provider information', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.provider.organization).toBe('Test Organization')
      expect(card.provider.url).toBe('https://example.com')
    })

    it('should use default icon URL when not provided', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.iconUrl).toBe('https://example.com/logo.svg')
    })

    it('should use agent-specific icon URL when provided', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
        iconUrl: 'https://custom-icon.com/icon.png',
      })

      expect(card.iconUrl).toBe('https://custom-icon.com/icon.png')
    })

    it('should use config default icon URL', () => {
      const generator = new AgentCardGenerator({
        ...baseConfig,
        defaultIconUrl: 'https://default-icon.com/icon.svg',
      })

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.iconUrl).toBe('https://default-icon.com/icon.svg')
    })

    it('should include security schemes', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.securitySchemes).toBeDefined()
      expect(card.securitySchemes?.apiKey).toBeDefined()
      expect(card.securitySchemes?.apiKey.type).toBe('apiKey')
      expect(card.securitySchemes?.apiKey.in).toBe('header')
      expect(card.securitySchemes?.apiKey.name).toBe('X-API-Key')
    })

    it('should allow custom security scheme configuration', () => {
      const generator = new AgentCardGenerator({
        ...baseConfig,
        securitySchemeName: 'bearerAuth',
        securityHeaderName: 'Authorization',
        securityDescription: 'Bearer token authentication',
      })

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.securitySchemes?.bearerAuth).toBeDefined()
      expect(card.securitySchemes?.bearerAuth.name).toBe('Authorization')
      expect(card.securitySchemes?.bearerAuth.description).toBe(
        'Bearer token authentication',
      )
    })

    it('should set capabilities correctly', () => {
      const generator = new AgentCardGenerator({
        ...baseConfig,
        enableStreaming: true,
        enablePushNotifications: true,
        enableStateTransitionHistory: false,
      })

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.capabilities.streaming).toBe(true)
      expect(card.capabilities.pushNotifications).toBe(true)
      expect(card.capabilities.stateTransitionHistory).toBe(false)
    })

    it('should use default capabilities when not specified', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.capabilities.streaming).toBe(false)
      expect(card.capabilities.pushNotifications).toBe(false)
      expect(card.capabilities.stateTransitionHistory).toBe(true)
    })

    it('should include agent skills', () => {
      const generator = new AgentCardGenerator(baseConfig)
      const customSkill = {
        id: 'custom',
        name: 'Custom Skill',
        description: 'A custom skill',
        tags: ['custom'],
        examples: ['Do custom thing'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      }

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
        skills: [customSkill],
      })

      expect(card.skills).toHaveLength(1)
      expect(card.skills[0].id).toBe('custom')
      expect(card.skills[0].name).toBe('Custom Skill')
    })

    it('should use default skills from config when agent has none', () => {
      const generator = new AgentCardGenerator({
        ...baseConfig,
        defaultSkills: DEFAULT_TRADING_SKILLS,
      })

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.skills).toHaveLength(1)
      expect(card.skills[0].id).toBe('trading')
    })

    it('should include documentation URL', () => {
      const generator = new AgentCardGenerator({
        ...baseConfig,
        documentationUrl: 'https://docs.example.com',
      })

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.documentationUrl).toBe('https://docs.example.com')
    })

    it('should use default documentation URL when not provided', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.documentationUrl).toBe('https://example.com/docs')
    })

    it('should include version from agent data', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
        version: '2.0.0',
      })

      expect(card.version).toBe('2.0.0')
    })

    it('should use default version when not provided', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.version).toBe('1.0.0')
    })

    it('should include additional interfaces', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.additionalInterfaces).toHaveLength(1)
      expect(card.additionalInterfaces?.[0].transport).toBe('JSONRPC')
    })

    it('should set supportsAuthenticatedExtendedCard to false', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.supportsAuthenticatedExtendedCard).toBe(false)
    })

    it('should include default input/output modes', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(card.defaultInputModes).toContain('text/plain')
      expect(card.defaultInputModes).toContain('application/json')
      expect(card.defaultOutputModes).toContain('application/json')
    })
  })

  describe('generateSync', () => {
    it('should work identically to generate', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const syncCard = generator.generateSync({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      const asyncCard = generator.generate({
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
      })

      expect(syncCard).toEqual(asyncCard)
    })
  })

  describe('generateWithSkills', () => {
    it('should merge agent skills with additional skills', () => {
      const generator = new AgentCardGenerator(baseConfig)

      const card = generator.generateWithSkills(
        {
          id: 'agent-123',
          name: 'Test Agent',
          description: 'A test agent',
          skills: DEFAULT_TRADING_SKILLS,
        },
        DEFAULT_SOCIAL_SKILLS,
      )

      expect(card.skills).toHaveLength(2)
      expect(card.skills.map((s) => s.id)).toContain('trading')
      expect(card.skills.map((s) => s.id)).toContain('social')
    })

    it('should use default skills when agent has none', () => {
      const generator = new AgentCardGenerator({
        ...baseConfig,
        defaultSkills: DEFAULT_MESSAGING_SKILLS,
      })

      const card = generator.generateWithSkills(
        {
          id: 'agent-123',
          name: 'Test Agent',
          description: 'A test agent',
        },
        DEFAULT_TRADING_SKILLS,
      )

      expect(card.skills).toHaveLength(2)
      expect(card.skills.map((s) => s.id)).toContain('messaging')
      expect(card.skills.map((s) => s.id)).toContain('trading')
    })
  })
})

describe('createAgentCard', () => {
  it('should create agent card without instantiating generator', () => {
    const card = createAgentCard(
      {
        baseUrl: 'https://example.com',
        organization: 'Test Org',
        organizationUrl: 'https://example.com',
      },
      {
        id: 'agent-1',
        name: 'Quick Agent',
        description: 'A quick test agent',
      },
    )

    expect(card.name).toBe('Quick Agent')
    expect(card.url).toBe('https://example.com/api/agents/agent-1/a2a')
  })
})

describe('Default Skills', () => {
  it('DEFAULT_TRADING_SKILLS should have required properties', () => {
    expect(DEFAULT_TRADING_SKILLS).toHaveLength(1)
    expect(DEFAULT_TRADING_SKILLS[0].id).toBe('trading')
    expect(DEFAULT_TRADING_SKILLS[0].tags).toContain('trading')
    expect(DEFAULT_TRADING_SKILLS[0].examples.length).toBeGreaterThan(0)
  })

  it('DEFAULT_SOCIAL_SKILLS should have required properties', () => {
    expect(DEFAULT_SOCIAL_SKILLS).toHaveLength(1)
    expect(DEFAULT_SOCIAL_SKILLS[0].id).toBe('social')
    expect(DEFAULT_SOCIAL_SKILLS[0].tags).toContain('social')
  })

  it('DEFAULT_MESSAGING_SKILLS should have required properties', () => {
    expect(DEFAULT_MESSAGING_SKILLS).toHaveLength(1)
    expect(DEFAULT_MESSAGING_SKILLS[0].id).toBe('messaging')
    expect(DEFAULT_MESSAGING_SKILLS[0].tags).toContain('messaging')
  })
})

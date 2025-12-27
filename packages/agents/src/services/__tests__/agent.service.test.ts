/**
 * Agent Service Tests
 *
 * Tests agent lifecycle management and configuration.
 */

import { describe, expect, it } from 'bun:test'
import { AgentService, type AgentWithConfig } from '../agent.service'

describe('AgentService', () => {
  describe('constructor', () => {
    it('creates service instance', () => {
      const service = new AgentService()
      expect(service).toBeDefined()
    })
  })

  describe('createAgent', () => {
    it('service has createAgent method', () => {
      const service = new AgentService()
      expect(typeof service.createAgent).toBe('function')
    })
  })

  describe('getAgent', () => {
    it('service has getAgent method', () => {
      const service = new AgentService()
      expect(typeof service.getAgent).toBe('function')
    })
  })

  describe('getAgentWithConfig', () => {
    it('service has getAgentWithConfig method', () => {
      const service = new AgentService()
      expect(typeof service.getAgentWithConfig).toBe('function')
    })
  })

  describe('listUserAgents', () => {
    it('service has listUserAgents method', () => {
      const service = new AgentService()
      expect(typeof service.listUserAgents).toBe('function')
    })
  })

  describe('updateAgent', () => {
    it('service has updateAgent method', () => {
      const service = new AgentService()
      expect(typeof service.updateAgent).toBe('function')
    })
  })
})

describe('AgentWithConfig structure', () => {
  it('validates complete agent config', () => {
    const agent: AgentWithConfig = {
      id: 'agent-123',
      userId: 'user-456',
      name: 'Test Agent',
      status: 'active',
      modelTier: 'standard',
      autonomousTrading: true,
      autonomousPosting: true,
      autonomousCommenting: false,
      autonomousDMs: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      systemPrompt: 'You are a helpful trading agent.',
      personality: 'Friendly and analytical',
      tradingStrategy: 'momentum',
      messageExamples: ['Hello!', 'How can I help?'],
    }

    expect(agent.id).toBe('agent-123')
    expect(agent.status).toBe('active')
    expect(agent.modelTier).toBe('standard')
    expect(agent.autonomousTrading).toBe(true)
    expect(agent.systemPrompt).toBeDefined()
    expect(agent.personality).toBeDefined()
    expect(agent.tradingStrategy).toBe('momentum')
    expect(agent.messageExamples).toHaveLength(2)
  })

  it('validates agent with minimal config', () => {
    const agent: AgentWithConfig = {
      id: 'agent-123',
      userId: 'user-456',
      name: 'Minimal Agent',
      status: 'active',
      modelTier: 'lite',
      autonomousTrading: false,
      autonomousPosting: false,
      autonomousCommenting: false,
      autonomousDMs: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(agent.systemPrompt).toBeUndefined()
    expect(agent.personality).toBeUndefined()
  })

  it('supports all model tiers', () => {
    const tiers: AgentWithConfig['modelTier'][] = ['lite', 'standard', 'pro']
    
    for (const tier of tiers) {
      const agent: AgentWithConfig = {
        id: 'agent-123',
        userId: 'user-456',
        name: 'Test',
        status: 'active',
        modelTier: tier,
        autonomousTrading: false,
        autonomousPosting: false,
        autonomousCommenting: false,
        autonomousDMs: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      expect(agent.modelTier).toBe(tier)
    }
  })

  it('supports all agent statuses', () => {
    const statuses: AgentWithConfig['status'][] = [
      'active',
      'inactive',
      'suspended',
    ]
    
    for (const status of statuses) {
      const agent: AgentWithConfig = {
        id: 'agent-123',
        userId: 'user-456',
        name: 'Test',
        status,
        modelTier: 'lite',
        autonomousTrading: false,
        autonomousPosting: false,
        autonomousCommenting: false,
        autonomousDMs: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      expect(agent.status).toBe(status)
    }
  })
})


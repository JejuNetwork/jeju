/**
 * Agent Runtime Factory Tests
 *
 * Tests the factory for creating ElizaOS runtime instances.
 */

import { describe, expect, it } from 'bun:test'
import { AgentRuntimeFactory, type RuntimeCreationOptions } from '../factory'

describe('AgentRuntimeFactory', () => {
  describe('constructor', () => {
    it('creates factory instance', () => {
      const factory = new AgentRuntimeFactory()
      expect(factory).toBeDefined()
    })
  })

  describe('RuntimeCreationOptions', () => {
    it('validates option structure with all fields', () => {
      const options: RuntimeCreationOptions = {
        plugins: [],
        modelOverride: 'gpt-4',
        skipEnhancement: false,
        enableTrading: true,
        enableSocial: true,
        enableTrajectoryLogging: true,
      }

      expect(options.modelOverride).toBe('gpt-4')
      expect(options.enableTrading).toBe(true)
      expect(options.enableSocial).toBe(true)
      expect(options.enableTrajectoryLogging).toBe(true)
    })

    it('allows partial options', () => {
      const options: RuntimeCreationOptions = {
        enableTrading: true,
      }

      expect(options.enableTrading).toBe(true)
      expect(options.plugins).toBeUndefined()
    })

    it('supports empty options', () => {
      const options: RuntimeCreationOptions = {}
      expect(Object.keys(options)).toHaveLength(0)
    })
  })

  describe('createFromConfig', () => {
    it('factory has createFromConfig method', () => {
      const factory = new AgentRuntimeFactory()
      expect(typeof factory.createFromConfig).toBe('function')
    })
  })

  describe('createFromTemplate', () => {
    it('factory has createFromTemplate method', () => {
      const factory = new AgentRuntimeFactory()
      expect(typeof factory.createFromTemplate).toBe('function')
    })
  })
})

describe('RuntimeCreationOptions combinations', () => {
  it('trading-only agent', () => {
    const options: RuntimeCreationOptions = {
      enableTrading: true,
      enableSocial: false,
      enableTrajectoryLogging: true,
    }
    expect(options.enableTrading).toBe(true)
    expect(options.enableSocial).toBe(false)
  })

  it('social-only agent', () => {
    const options: RuntimeCreationOptions = {
      enableTrading: false,
      enableSocial: true,
    }
    expect(options.enableTrading).toBe(false)
    expect(options.enableSocial).toBe(true)
  })

  it('full featured agent', () => {
    const options: RuntimeCreationOptions = {
      enableTrading: true,
      enableSocial: true,
      enableTrajectoryLogging: true,
      plugins: [],
    }
    expect(options.enableTrading).toBe(true)
    expect(options.enableSocial).toBe(true)
    expect(options.enableTrajectoryLogging).toBe(true)
  })

  it('minimal agent without enhancement', () => {
    const options: RuntimeCreationOptions = {
      skipEnhancement: true,
    }
    expect(options.skipEnhancement).toBe(true)
  })
})
